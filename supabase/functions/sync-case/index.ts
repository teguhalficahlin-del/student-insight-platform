/**
 * @file sync-case/index.ts
 * @edge-function sync-case
 *
 * Membuat kasus baru secara idempoten.
 * Dipanggil oleh guru/js/offline.js saat online atau flush antrian.
 *
 * CONTRACT:
 *   POST /functions/v1/sync-case
 *   Body: CaseCreatePayload (lihat CASE_CREATE_SCHEMA di _shared/validate.ts)
 *   Idempoten: keyed pada idempotency_key via sync_idempotency
 */

import { handleCors, corsHeaders }     from '../_shared/cors.ts';
import { ok, badRequest,
         forbidden, internalError,
         checkSchemaVersion }          from '../_shared/response.ts';
import { resolveAuth, isAuthError }    from '../_shared/auth.ts';
import { validatePayload,
         CASE_CREATE_SCHEMA,
         validateAudienceForRole }     from '../_shared/validate.ts';
import { getAdminClient }              from '../_shared/db.ts';

// peran internal + DUDI boleh buat kasus; WAKA_KURIKULUM & TU dikecualikan
const ALLOWED_ROLES = ['GURU','WALI_KELAS','BK','KAPRODI','KEPSEK','WAKA_KESISWAAN','WAKA_HUMAS','DUDI'];

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

        if (!ALLOWED_ROLES.includes(user.role_type)) {
            return forbidden('Hanya staf sekolah yang dapat membuat kasus');
        }

        let body: Record<string, unknown>;
        try { body = await req.json(); }
        catch { return badRequest('Request body harus berupa JSON yang valid'); }

        const validation = validatePayload(CASE_CREATE_SCHEMA, body);
        if (!validation.valid) return badRequest('Payload tidak valid', validation.errors);

        const idempotencyKey = body['idempotency_key'] as string;

        // Idempotency check
        const { data: existing } = await admin
            .from('sync_idempotency')
            .select('idempotency_key, result_json')
            .eq('idempotency_key', idempotencyKey)
            .maybeSingle();

        if (existing) {
            return ok({ ...(existing.result_json ?? {}), was_duplicate: true });
        }

        if (body['created_by_user_id'] !== user.user_id) {
            return forbidden('created_by_user_id harus sesuai dengan akun yang login');
        }

        // DUDI selalu PRIVATE; internal boleh pilih; default PRIVATE jika tidak dikirim
        const audience = user.role_type === 'DUDI'
            ? 'PRIVATE'
            : (body['audience'] as string | undefined) ?? 'PRIVATE';

        const audErr = validateAudienceForRole(user.role_type, audience);
        if (audErr) return badRequest(audErr);

        const { error: rpcError } = await admin.rpc('fn_sync_case', {
            p_idempotency_key:    idempotencyKey,
            p_case_id:            body['case_id']            as string,
            p_student_id:         body['student_id']         as string,
            p_created_by_user_id: user.user_id,
            p_initiated_by_role:  body['initiated_by_role']  as string,
            p_track:              body['track']               as string,
            p_title:              body['title']               as string,
            p_description:        body['description']         as string,
            p_audience:           audience,
        });

        if (rpcError) {
            const msg = (rpcError as { message?: string }).message ?? '';
            if (msg.includes('author_not_found')) return badRequest('Pembuat kasus tidak ditemukan');
            console.error('[sync-case] RPC error:', rpcError);
            return internalError(rpcError);
        }

        return ok({ case_id: body['case_id'], was_duplicate: false });

    } catch (err) {
        return internalError(err);
    }
});
