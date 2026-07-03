/**
 * @file provision-school/index.ts
 *
 * Mendaftarkan sekolah baru ke platform + membuat akun admin pertama.
 * Hanya bisa dipanggil oleh superadmin (vendor/developer).
 *
 * Auth: Header  X-Superadmin-Key: <SUPERADMIN_KEY>
 *       (set via: supabase secrets set SUPERADMIN_KEY=xxx)
 *
 * Deploy:
 *   supabase functions deploy provision-school --no-verify-jwt
 *
 * Request body (JSON):
 *   {
 *     school_name:       string,   // wajib
 *     npsn:              string,   // opsional
 *     address:           string,   // opsional
 *     phone:             string,   // opsional
 *     admin_name:        string,   // nama lengkap admin IT
 *     admin_identifier:  string,   // NIP/NIK admin
 *   }
 *
 * Response (JSON):
 *   {
 *     school_id:          string,
 *     admin_identifier:   string,
 *     admin_password:     string,  // password sementara — tampilkan sekali
 *   }
 */

import { handleCors, corsHeaders } from '../_shared/cors.ts';
import { internalError }           from '../_shared/response.ts';
import { getAdminClient }          from '../_shared/db.ts';
import { toInternalEmail, generateSlug } from '../_shared/identifier.ts';

function json(data: unknown, status = 200): Response {
    return new Response(JSON.stringify(data), {
        status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
}

function randomPassword(len = 12): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#';
    return Array.from(crypto.getRandomValues(new Uint8Array(len)))
        .map(b => chars[b % chars.length]).join('');
}

Deno.serve(async (req: Request): Promise<Response> => {
    if (req.method === 'OPTIONS') return handleCors();

    // ── Autentikasi superadmin ────────────────────────────────
    const superadminKey = Deno.env.get('SUPERADMIN_KEY');
    const reqKey        = req.headers.get('x-superadmin-key');

    if (!superadminKey || reqKey !== superadminKey) {
        return json({ error: 'Unauthorized' }, 401);
    }

    try {
        const body = await req.json();
        const { school_name, npsn, address, phone, admin_name, admin_identifier,
                slug, logo_url, primary_color, secondary_color } = body;

        if (!school_name || !admin_name || !admin_identifier) {
            return json({ error: 'school_name, admin_name, dan admin_identifier wajib diisi' }, 400);
        }

        const admin = getAdminClient();

        // ── 1. Idempotency: cek NPSN sudah terdaftar ─────────
        if (npsn) {
            const { data: existing } = await admin
                .from('schools')
                .select('school_id, name')
                .eq('npsn', npsn)
                .maybeSingle();

            if (existing) {
                return json({ error: `NPSN ${npsn} sudah terdaftar (${existing.name})` }, 409);
            }
        }

        // ── 2. Buat record schools ────────────────────────────
        const resolvedSlug = slug || generateSlug(school_name);
        const { data: school, error: schoolErr } = await admin
            .from('schools')
            .insert({
                name:            school_name,
                npsn:            npsn            || null,
                address:         address         || null,
                phone:           phone           || null,
                slug:            resolvedSlug,
                logo_url:        logo_url        || null,
                primary_color:   primary_color   || '#1a56db',
                secondary_color: secondary_color || '#1e40af',
            })
            .select('school_id')
            .single();

        if (schoolErr) throw schoolErr;
        const schoolId = school.school_id;

        // ── 3. Buat school_config default ─────────────────────
        const currentYear = new Date().getFullYear();
        const { error: configErr } = await admin
            .from('school_config')
            .insert({
                school_id:            schoolId,
                school_name:          school_name,
                current_academic_year: `${currentYear}/${currentYear + 1}`,
                current_semester:     1,
                setup_completed:      false,
                password_changed:     false,
            });

        if (configErr) throw configErr;

        // ── 4. Buat Auth user untuk admin ─────────────────────
        const adminEmail    = toInternalEmail(admin_identifier, 'NIK', schoolId);
        const adminPassword = randomPassword();

        const { data: authData, error: authErr } = await admin.auth.admin.createUser({
            email:         adminEmail,
            password:      adminPassword,
            email_confirm: true,
        });

        if (authErr) {
            // Rollback schools + config
            await admin.from('school_config').delete().eq('school_id', schoolId);
            await admin.from('schools').delete().eq('school_id', schoolId);
            throw authErr;
        }

        // ── 5. Buat record public.users ───────────────────────
        const { error: userErr } = await admin
            .from('users')
            .insert({
                auth_user_id:     authData.user!.id,
                school_id:        schoolId,
                login_identifier: admin_identifier,
                identifier_type:  'NIK',
                role_type:        'ADMINISTRATIVE',
                full_name:        admin_name,
                email:            adminEmail,
            });

        if (userErr) {
            // Rollback
            await admin.auth.admin.deleteUser(authData.user!.id);
            await admin.from('school_config').delete().eq('school_id', schoolId);
            await admin.from('schools').delete().eq('school_id', schoolId);
            throw userErr;
        }

        // ── 6. Return kredensial ──────────────────────────────
        return json({
            success:          true,
            school_id:        schoolId,
            school_name,
            slug:             resolvedSlug,
            admin_identifier,
            admin_password:   adminPassword,
            login_url:        `https://teguhalficahlin-del.github.io/student-insight-platform/admin/?school=${resolvedSlug}`,
            note:             'Simpan password ini — tidak bisa dilihat lagi.',
        });

    } catch (err) {
        return internalError(err);
    }
});
