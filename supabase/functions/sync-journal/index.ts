/**
 * @file sync-journal/index.ts
 * @edge-function sync-journal
 *
 * Menyimpan satu entri jurnal mengajar (idempoten).
 * Dipanggil oleh guru/js/offline.js saat online atau flush antrian.
 *
 * CONTRACT:
 *   POST /functions/v1/sync-journal
 *   Body: JournalPayload (lihat JOURNAL_SCHEMA di _shared/validate.ts)
 *   Idempoten: keyed pada idempotency_key via sync_idempotency
 */

import { handleCors, corsHeaders }     from '../_shared/cors.ts';
import { ok, badRequest,
         forbidden, internalError,
         checkSchemaVersion }          from '../_shared/response.ts';
import { resolveAuth, isAuthError }    from '../_shared/auth.ts';
import { validatePayload,
         JOURNAL_SCHEMA }              from '../_shared/validate.ts';
import { getAdminClient }              from '../_shared/db.ts';

const STAFF_ROLES = ['GURU','WALI_KELAS','BK','KAPRODI','KEPSEK','WAKA_KURIKULUM','WAKA_KESISWAAN','ADMINISTRATIVE'];

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

        if (!STAFF_ROLES.includes(user.role_type)) {
            return forbidden('Hanya staf sekolah yang dapat menyimpan jurnal');
        }

        let body: Record<string, unknown>;
        try { body = await req.json(); }
        catch { return badRequest('Request body harus berupa JSON yang valid'); }

        const validation = validatePayload(JOURNAL_SCHEMA, body);
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

        // Pastikan owner_user_id cocok dengan user yang login
        if (body['owner_user_id'] !== user.user_id) {
            return forbidden('owner_user_id harus sesuai dengan akun yang login');
        }

        const { error: rpcError } = await admin.rpc('fn_sync_journal', {
            p_idempotency_key: idempotencyKey,
            p_journal_id:      body['journal_id']    as string,
            p_owner_user_id:   user.user_id,
            p_entry_date:      body['entry_date']    as string,
            p_content:         body['content']       as string,
            p_schedule_id:     (body['schedule_id']  as string | undefined) ?? null,
            p_class_id:        (body['class_id']     as string | undefined) ?? null,
        });

        if (rpcError) {
            const msg = (rpcError as { message?: string }).message ?? '';
            if (msg.includes('owner_not_found')) return badRequest('Pemilik jurnal tidak ditemukan');
            console.error('[sync-journal] RPC error:', rpcError);
            return internalError(rpcError);
        }

        return ok({ journal_id: body['journal_id'], was_duplicate: false });

    } catch (err) {
        return internalError(err);
    }
});
