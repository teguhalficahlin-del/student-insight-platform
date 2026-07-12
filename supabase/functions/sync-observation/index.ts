/**
 * @file sync-observation/index.ts
 * @edge-function sync-observation
 *
 * Menyimpan satu observasi siswa (idempoten).
 * Dipanggil oleh guru/js/offline.js saat online atau flush antrian.
 *
 * CONTRACT:
 *   POST /functions/v1/sync-observation
 *   Body: ObservationPayload (lihat OBSERVATION_SCHEMA di _shared/validate.ts)
 *   Idempoten: keyed pada idempotency_key via sync_idempotency
 */

import { handleCors, corsHeaders }     from '../_shared/cors.ts';
import { ok, badRequest, unauthorized,
         forbidden, internalError,
         checkSchemaVersion }          from '../_shared/response.ts';
import { resolveAuth, isAuthError }    from '../_shared/auth.ts';
import { validatePayload,
         OBSERVATION_SCHEMA }          from '../_shared/validate.ts';
import { getAdminClient }              from '../_shared/db.ts';

const ALLOWED_ROLES = ['GURU'];

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
            return forbidden('Hanya guru mata pelajaran yang dapat menyimpan catatan siswa');
        }

        let body: Record<string, unknown>;
        try { body = await req.json(); }
        catch { return badRequest('Request body harus berupa JSON yang valid'); }

        const validation = validatePayload(OBSERVATION_SCHEMA, body);
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

        // Pastikan author_user_id cocok dengan user yang login
        if (body['author_user_id'] !== user.user_id) {
            return forbidden('author_user_id harus sesuai dengan akun yang login');
        }

        const { error: rpcError } = await admin.rpc('fn_sync_observation', {
            p_idempotency_key: idempotencyKey,
            p_observation_id:  body['observation_id'] as string,
            p_author_user_id:  user.user_id,
            p_student_id:      body['student_id']    as string,
            p_sentiment:       body['sentiment']     as string,
            p_dimension:       body['dimension']     as string,
            p_visibility:      body['visibility']    as string,
            p_content:         body['content']       as string,
            p_observed_at:     body['observed_at']   as string,
            p_schedule_id:     (body['schedule_id']  as string | undefined) ?? null,
            p_class_id:        (body['class_id']     as string | undefined) ?? null,
        });

        if (rpcError) {
            const msg = (rpcError as { message?: string }).message ?? '';
            if (msg.includes('author_not_found')) return badRequest('Penulis tidak ditemukan');
            console.error('[sync-observation] RPC error:', rpcError);
            return internalError(rpcError);
        }

        return ok({ observation_id: body['observation_id'], was_duplicate: false });

    } catch (err) {
        return internalError(err);
    }
});
