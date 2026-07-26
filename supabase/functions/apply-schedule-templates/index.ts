/**
 * @file apply-schedule-templates/index.ts
 *
 * Tombol "Terapkan Jadwal" dan "Terapkan Ulang Jadwal" di visual schedule builder.
 *
 * Mode default (tanpa ?mode):
 *   Panggil fn_apply_schedule_templates — generate sesi dari template,
 *   ON CONFLICT DO NOTHING (tidak sentuh sesi yang sudah ada).
 *   Cocok untuk awal semester.
 *
 * Mode reapply (?mode=reapply):
 *   Panggil fn_reapply_schedule_templates — hapus sesi masa depan tanpa
 *   absensi lalu generate ulang dari template terkini.
 *   Cocok setelah perubahan template mid-semester (ganti guru, ganti slot).
 *
 * Mode finalize (?mode=finalize):
 *   FASE 3 batch reapply — generate sesi baru setelah FASE 1+2 selesai.
 *   Body: { job_id: string }
 *   Cross-tenant guard di TypeScript sebelum panggil RPC fn_finalize_reapply_job.
 *
 * CONTRACT:
 *   POST /functions/v1/apply-schedule-templates[?mode=reapply|finalize]
 *   Body: kosong (default/reapply) | { job_id } (finalize)
 *   Auth: ADMINISTRATIVE
 *   Response: { templates_found, assignments_upserted,
 *               schedules_total, schedules_generated, sessions_deleted? }
 */

import { handleCors, corsHeaders } from '../_shared/cors.ts';
import { ok, badRequest, forbidden, internalError, checkSchemaVersion } from '../_shared/response.ts';
import { resolveAuth, isAuthError } from '../_shared/auth.ts';
import { getAdminClient } from '../_shared/db.ts';

Deno.serve(async (req: Request): Promise<Response> => {
    if (req.method === 'OPTIONS') return handleCors();
    if (req.method !== 'POST') {
        return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });
    }

    try {
        const versionError = checkSchemaVersion(req);
        if (versionError) return versionError;

        const admin      = getAdminClient();
        const authResult = await resolveAuth(req, admin);
        if (isAuthError(authResult)) return authResult;
        const { user } = authResult;

        if (user.role_type !== 'ADMINISTRATIVE') {
            return forbidden('Hanya akun ADMINISTRATIVE yang dapat menerapkan jadwal');
        }

        const url  = new URL(req.url);
        const mode = url.searchParams.get('mode');

        // ── Mode finalize: FASE 3 batch reapply ──────────────────────────────
        // Dipanggil setelah FASE 1+2 (client langsung via .rpc()) selesai.
        // Body: { job_id: string }
        if (mode === 'finalize') {
            let body: { job_id?: string };
            try {
                body = await req.json();
            } catch {
                return badRequest('Request body harus JSON dengan field job_id');
            }

            const jobId = body?.job_id;
            if (!jobId) return badRequest('Field job_id wajib diisi');

            // Cross-tenant guard di TypeScript — RPC tidak bisa cek auth.uid()
            // karena dipanggil service_role (uid() = NULL di context SECURITY DEFINER).
            const { data: job, error: jobErr } = await admin
                .from('schedule_reapply_jobs')
                .select('school_id, status')
                .eq('job_id', jobId)
                .maybeSingle();

            if (jobErr || !job) {
                return badRequest('Job tidak ditemukan');
            }

            if (job.school_id !== user.school_id) {
                return forbidden('Job ini bukan milik sekolah Anda');
            }

            const { data: result, error: rpcErr } = await admin.rpc(
                'fn_finalize_reapply_job',
                { p_job_id: jobId },
            );

            if (rpcErr) return internalError(rpcErr);

            return ok({
                templates_found:      result.templates_found,
                assignments_upserted: result.assignments_upserted,
                schedules_total:      result.schedules_generated,
                schedules_generated:  result.schedules_generated,
            });
        }

        const isReapply = mode === 'reapply';

        // Periode aktif: academic_year dari fn_current_academic_year (SSoT),
        // semester dari school_config.
        const { data: config, error: configErr } = await admin
            .from('school_config')
            .select('current_academic_year, current_semester')
            .eq('school_id', user.school_id)
            .maybeSingle();

        if (configErr || !config) {
            return internalError(configErr ?? new Error('school_config tidak ditemukan'));
        }

        const { data: authYear } = await admin.rpc('fn_current_academic_year', { p_school_id: user.school_id });
        const academicYear = (authYear as string) || config.current_academic_year;
        const semester     = config.current_semester;

        const rpcName = isReapply ? 'fn_reapply_schedule_templates' : 'fn_apply_schedule_templates';
        const { data: result, error: rpcErr } = await admin.rpc(rpcName, {
            p_academic_year: academicYear,
            p_semester:      semester,
            p_school_id:     user.school_id,
        });

        if (rpcErr) return internalError(rpcErr);

        if (!result || result.templates_found === 0) {
            return badRequest('Belum ada template jadwal untuk periode ini. Susun jadwal terlebih dahulu.');
        }

        // ── Resolve subject_code_aliases → subject_cp_mapping (non-fatal) ──
        // Petakan singkatan di subject_label (mis. 'B.INGG') ke core_subject_id
        // via tabel subject_code_aliases yang diisi admin per sekolah.
        try {
            const { data: templates } = await admin
                .from('schedule_templates')
                .select('subject_label')
                .eq('school_id', user.school_id)
                .eq('academic_year', academicYear)
                .eq('semester', semester)
                .not('subject_label', 'is', null);

            const kodes = [...new Set(
                (templates ?? [])
                    .map((t: { subject_label: string }) => t.subject_label?.toUpperCase())
                    .filter(Boolean)
            )];

            if (kodes.length > 0) {
                const { data: aliases } = await admin
                    .from('subject_code_aliases')
                    .select('kode, core_subject_id')
                    .eq('school_id', user.school_id)
                    .in('kode', kodes);

                for (const alias of aliases ?? []) {
                    if (!alias.core_subject_id) continue;
                    const { data: pubSubs } = await admin
                        .from('subjects')
                        .select('subject_id')
                        .eq('school_id', user.school_id)
                        .ilike('name', alias.kode);

                    for (const ps of pubSubs ?? []) {
                        const { data: existing } = await admin
                            .from('subject_cp_mapping')
                            .select('mapping_id')
                            .eq('school_id', user.school_id)
                            .eq('subject_id', ps.subject_id)
                            .eq('core_subject_id', alias.core_subject_id)
                            .maybeSingle();
                        if (existing) continue;
                        await admin.from('subject_cp_mapping').insert({
                            school_id:       user.school_id,
                            subject_id:      ps.subject_id,
                            core_subject_id: alias.core_subject_id,
                            mapping_type:    'ALIAS',
                            is_active:       true,
                        });
                    }
                }
            }
        } catch (aliasErr) {
            console.warn('[apply-schedule-templates] resolve alias gagal (non-fatal):', aliasErr);
        }

        // ── Auto-mapping subject_cp_mapping (non-fatal) ──────────────────
        // Setelah RPC berhasil, coba link public.subjects → core.subjects
        // untuk setiap mapel yang dipakai di teaching_assignments periode ini.
        try {
            // Ambil semua subject_id unik dari teaching_assignments periode ini
            const { data: assignments } = await admin
                .from('teaching_assignments')
                .select('subject_id')
                .eq('school_id', user.school_id)
                .eq('academic_year', academicYear)
                .eq('semester', semester);

            const subjectIds = [...new Set((assignments ?? []).map((a: { subject_id: string }) => a.subject_id).filter(Boolean))];

            if (subjectIds.length > 0) {
                // Ambil nama mapel dari public.subjects
                const { data: pubSubjects } = await admin
                    .from('subjects')
                    .select('subject_id, name')
                    .in('subject_id', subjectIds);

                for (const ps of pubSubjects ?? []) {
                    if (!ps.name) continue;

                    // Cari 1:1 match di core.subjects (exact, case-insensitive)
                    const { data: coreMatches } = await admin
                        .schema('core')
                        .from('subjects')
                        .select('subject_id')
                        .ilike('name', ps.name);

                    if (!coreMatches || coreMatches.length !== 1) continue;
                    const coreSubjectId = coreMatches[0].subject_id;

                    // Cek apakah mapping sudah ada
                    const { data: existing } = await admin
                        .from('subject_cp_mapping')
                        .select('mapping_id')
                        .eq('school_id', user.school_id)
                        .eq('subject_id', ps.subject_id)
                        .eq('core_subject_id', coreSubjectId)
                        .maybeSingle();

                    if (existing) continue;

                    await admin.from('subject_cp_mapping').insert({
                        school_id:       user.school_id,
                        subject_id:      ps.subject_id,
                        core_subject_id: coreSubjectId,
                        mapping_type:    'AUTO',
                        is_active:       true,
                    });
                }
            }
        } catch (mappingErr) {
            console.warn('[apply-schedule-templates] auto-mapping subject_cp_mapping gagal (non-fatal):', mappingErr);
        }

        return ok({
            templates_found:      result.templates_found,
            assignments_upserted: result.assignments_upserted,
            schedules_total:      result.schedules_generated,
            schedules_generated:  result.schedules_generated,
            ...(isReapply && { sessions_deleted: result.sessions_deleted }),
        });

    } catch (err) {
        return internalError(err);
    }
});
