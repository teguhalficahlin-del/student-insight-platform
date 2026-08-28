/**
 * @file delete-school/index.ts
 * @edge-function delete-school
 *
 * Hapus sekolah nonaktif beserta data tenant-nya secara batch dan resumable.
 */

import { handleCors, corsHeaders } from '../_shared/cors.ts';
import { getAdminClient } from '../_shared/db.ts';

const BATCH_SIZE = 200;
const AUTH_BATCH_SIZE = 50;
const TIMEOUT_GUARD_MS = 25_000;

type CursorStrategy = 'keyset' | 'remaining-set' | 'coaching-rpc' | 'null-document-refs' | 'auth';
type ManifestEntry = { table: string; pk: string[]; strategy: CursorStrategy };
type ResumeFrom = {
    table: string;
    last_id: string | null;
    deleted_so_far: number;
    total: number;
};
type RequestBody = { school_id?: string; resume_from?: Partial<ResumeFrom> };

const table = (name: string, pk: string, strategy: CursorStrategy = 'keyset'): ManifestEntry => ({
    table: name,
    pk: [pk],
    strategy,
});

// Child tables precede every NO ACTION/RESTRICT parent. Tables connected only
// by CASCADE are also explicit so progress totals remain deterministic.
const DELETE_MANIFEST: ManifestEntry[] = [
    table('coaching_case_events', 'event_id', 'coaching-rpc'),
    table('attendance', 'attendance_id'),
    table('observations', 'observation_id'),
    table('substitute_schedules', 'substitute_id'),
    table('teacher_attendance_log', 'log_id'),
    table('ld_documents', 'document_id'),
    table('evaluation_logs', 'log_id'),
    table('assessment_rubric_results', 'id'),
    table('assessment_results', 'id'),
    table('student_grades', 'id'),
    table('assessment_rubric_criteria', 'id'),
    table('assessment_criteria', 'id'),
    table('grade_recap', 'id'),
    { table: 'forum_post_acknowledgements', pk: ['post_id', 'user_id'], strategy: 'remaining-set' },
    { table: 'forum_post_audience', pk: ['post_id', 'user_id'], strategy: 'remaining-set' },
    table('forum_post_comments', 'comment_id'),
    { table: 'forum_post_subjects', pk: ['post_id', 'student_id'], strategy: 'remaining-set' },
    table('notifications', 'notification_id'),
    table('forum_posts', 'post_id'),
    table('generation_jobs', 'job_id'),
    table('teacher_document_approvals', 'approval_id'),
    table('teacher_document_classes', 'id'),
    table('__teacher_document_refs', 'doc_id', 'null-document-refs'),
    table('teacher_documents', 'doc_id'),
    table('schedule_reapply_targets', 'target_id', 'remaining-set'),
    table('schedule_reapply_jobs', 'job_id'),
    table('pkl_attendance', 'pkl_attendance_id'),
    table('pkl_placements', 'placement_id'),
    table('bk_class_assignments', 'assignment_id'),
    table('class_enrollments', 'enrollment_id'),
    table('coaching_case_handlers', 'handler_id'),
    table('coaching_cases', 'case_id'),
    table('coaching_case_templates', 'template_id'),
    table('guru_wali_assignments', 'assignment_id'),
    table('late_arrivals', 'late_id'),
    table('student_exits', 'exit_id'),
    table('student_parents', 'id'),
    table('student_groups', 'id'),
    table('student_updates', 'update_id'),
    table('duty_schedules', 'duty_id'),
    table('ld_context_snapshots', 'snapshot_id'),
    table('ld_program_knowledge_school', 'knowledge_id'),
    table('learning_objectives', 'id'),
    table('teaching_schedules', 'schedule_id'),
    table('schedule_templates', 'template_id'),
    table('teaching_contexts', 'context_id'),
    table('tp_taught_status', 'id'),
    table('teaching_assignments', 'assignment_id'),
    table('schedule_time_slots', 'slot_id'),
    table('capaian_pembelajaran', 'cp_id'),
    table('tujuan_pembelajaran', 'tp_id'),
    table('subject_code_aliases', 'alias_id'),
    table('subject_cp_mapping', 'mapping_id'),
    table('login_devices', 'device_id'),
    table('teacher_journals', 'journal_id'),
    table('teacher_piket_assignments', 'assignment_id'),
    table('teacher_profiles', 'profile_id'),
    table('academic_periods', 'id'),
    table('assessments', 'id'),
    table('students', 'student_id'),
    table('__auth_users', 'user_id', 'auth'),
    table('users', 'user_id'),
    table('classes', 'class_id'),
    table('subjects', 'subject_id'),
    table('programs', 'program_id'),
    table('school_config', 'config_id'),
    table('sync_idempotency', 'idempotency_key', 'remaining-set'),
    table('audit_log', 'id', 'remaining-set'),
];

function json(data: unknown, status = 200): Response {
    return new Response(JSON.stringify(data), {
        status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
}

function resumeAt(
    entry: ManifestEntry,
    lastId: string | null,
    deletedSoFar: number,
    total: number,
): ResumeFrom {
    return {
        table: entry.table,
        last_id: lastId,
        deleted_so_far: Math.min(deletedSoFar, total),
        total,
    };
}

Deno.serve(async (req: Request): Promise<Response> => {
    if (req.method === 'OPTIONS') return handleCors();
    if (req.method !== 'DELETE') {
        return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });
    }

    const superadminKey = Deno.env.get('SUPERADMIN_KEY');
    const reqKey = req.headers.get('x-superadmin-key');
    if (!superadminKey || reqKey !== superadminKey) return json({ error: 'Unauthorized' }, 401);

    let body: RequestBody;
    try {
        body = await req.json();
    } catch {
        return json({ error: 'Body harus JSON: { school_id, resume_from? }' }, 400);
    }

    const schoolId = body.school_id;
    if (!schoolId) return json({ error: 'school_id wajib diisi' }, 400);

    const admin = getAdminClient();
    const startedAt = Date.now();
    const timedOut = () => Date.now() - startedAt > TIMEOUT_GUARD_MS;

    const { data: school, error: schoolErr } = await admin
        .from('schools')
        .select('is_active, name')
        .eq('school_id', schoolId)
        .single();
    if (schoolErr || !school) return json({ error: 'Sekolah tidak ditemukan' }, 404);
    if (school.is_active) {
        return json({ error: 'Sekolah harus dinonaktifkan terlebih dahulu sebelum dihapus' }, 409);
    }

    let total: number;
    let deletedSoFar: number;
    let startIndex = 0;
    let initialLastId: string | null = null;

    if (body.resume_from) {
        const resume = body.resume_from;
        startIndex = DELETE_MANIFEST.findIndex(entry => entry.table === resume.table);
        if (
            startIndex < 0 ||
            typeof resume.deleted_so_far !== 'number' || !Number.isFinite(resume.deleted_so_far) || resume.deleted_so_far < 0 ||
            typeof resume.total !== 'number' || !Number.isFinite(resume.total) || resume.total < 1
        ) return json({ error: 'resume_from tidak valid' }, 400);
        initialLastId = typeof resume.last_id === 'string' ? resume.last_id : null;
        deletedSoFar = Math.floor(resume.deleted_so_far);
        total = Math.floor(resume.total);
    } else {
        const countEntries = DELETE_MANIFEST.filter(entry => !entry.table.startsWith('__'));
        let counts: number[];
        try {
            counts = await Promise.all(countEntries.map(async entry => {
                const { count, error } = await admin
                    .from(entry.table)
                    .select('*', { count: 'exact', head: true })
                    .eq('school_id', schoolId);
                if (error) throw new Error(`Gagal menghitung ${entry.table}: ${error.message}`);
                return count ?? 0;
            }));
        } catch (error) {
            return json({ error: error instanceof Error ? error.message : String(error) }, 500);
        }
        const { count: authCount, error: authCountErr } = await admin
            .from('users')
            .select('*', { count: 'exact', head: true })
            .eq('school_id', schoolId)
            .not('auth_user_id', 'is', null);
        if (authCountErr) return json({ error: `Gagal menghitung auth_users: ${authCountErr.message}` }, 500);
        total = counts.reduce((sum, count) => sum + count, 0) + (authCount ?? 0) + 1;
        deletedSoFar = 0;
    }

    try {
        for (let index = startIndex; index < DELETE_MANIFEST.length; index++) {
            const entry = DELETE_MANIFEST[index];
            let lastId = index === startIndex ? initialLastId : null;

            while (true) {
                if (timedOut()) {
                    return json({ deleted: Math.min(deletedSoFar, total), total, status: 'partial', resume_from: resumeAt(entry, lastId, deletedSoFar, total) });
                }

                if (entry.strategy === 'coaching-rpc') {
                    const { data, error } = await admin.rpc('fn_delete_school_coaching_case_events', {
                        p_school_id: schoolId,
                        p_after_event_id: lastId,
                        p_limit: BATCH_SIZE,
                    });
                    if (error) throw new Error(`Gagal menghapus ${entry.table}: ${error.message}`);
                    const result = data?.[0];
                    deletedSoFar += Number(result?.deleted ?? 0);
                    lastId = result?.last_id ?? lastId;
                    if (!result?.has_more) break;
                    continue;
                }

                if (entry.strategy === 'null-document-refs') {
                    let query = admin.from('teacher_documents').select('doc_id')
                        .eq('school_id', schoolId)
                        .or('parent_doc_id.not.is.null,source_doc_id.not.is.null')
                        .order('doc_id').limit(BATCH_SIZE);
                    if (lastId) query = query.gt('doc_id', lastId);
                    const { data: rows, error } = await query;
                    if (error) throw new Error(`Gagal membaca teacher document refs: ${error.message}`);
                    if (!rows?.length) break;
                    const ids = rows.map(row => row.doc_id);
                    const { error: updateError } = await admin.from('teacher_documents')
                        .update({ parent_doc_id: null, source_doc_id: null })
                        .in('doc_id', ids).eq('school_id', schoolId);
                    if (updateError) throw new Error(`Gagal menetralkan teacher document refs: ${updateError.message}`);
                    lastId = ids[ids.length - 1];
                    continue;
                }

                if (entry.strategy === 'auth') {
                    let query = admin.from('users').select('user_id, auth_user_id')
                        .eq('school_id', schoolId).not('auth_user_id', 'is', null)
                        .order('user_id').limit(AUTH_BATCH_SIZE);
                    if (lastId) query = query.gt('user_id', lastId);
                    const { data: rows, error } = await query;
                    if (error) throw new Error(`Gagal membaca auth_users: ${error.message}`);
                    if (!rows?.length) break;
                    const results = await Promise.all(rows.map(row => admin.auth.admin.deleteUser(row.auth_user_id as string)));
                    const failed = results.find(result => result.error && !result.error.message.toLowerCase().includes('not found'));
                    if (failed?.error) throw new Error(`Gagal menghapus auth user: ${failed.error.message}`);
                    deletedSoFar += rows.length;
                    lastId = rows[rows.length - 1].user_id;
                    continue;
                }

                let selectQuery = admin.from(entry.table).select(entry.pk.join(','))
                    .eq('school_id', schoolId).limit(BATCH_SIZE);
                if (entry.strategy === 'keyset') {
                    selectQuery = selectQuery.order(entry.pk[0]);
                    if (lastId) selectQuery = selectQuery.gt(entry.pk[0], lastId);
                }
                const { data: rows, error: selectError } = await selectQuery;
                if (selectError) throw new Error(`Gagal membaca ${entry.table}: ${selectError.message}`);
                if (!rows?.length) break;
                const selectedRows = rows as unknown as Record<string, string | number>[];

                let deleteQuery = admin.from(entry.table).delete().eq('school_id', schoolId);
                if (entry.pk.length === 1) {
                    deleteQuery = deleteQuery.in(entry.pk[0], selectedRows.map(row => row[entry.pk[0]]));
                } else {
                    const filters = selectedRows.map(row => `and(${entry.pk.map(pk => `${pk}.eq.${row[pk]}`).join(',')})`).join(',');
                    deleteQuery = deleteQuery.or(filters);
                }
                const { error: deleteError } = await deleteQuery;
                if (deleteError) throw new Error(`Gagal menghapus ${entry.table}: ${deleteError.message}`);
                deletedSoFar += rows.length;
                if (entry.strategy === 'keyset') lastId = String(selectedRows[selectedRows.length - 1][entry.pk[0]]);
            }
        }

        const { error: schoolDeleteError } = await admin.from('schools').delete().eq('school_id', schoolId);
        if (schoolDeleteError) throw new Error(`Gagal menghapus schools: ${schoolDeleteError.message}`);
        deletedSoFar += 1;
        return json({ deleted: Math.min(deletedSoFar, total), total, status: 'complete', resume_from: null });
    } catch (error) {
        console.error('[delete-school]', error);
        return json({ error: error instanceof Error ? error.message : String(error) }, 500);
    }
});
