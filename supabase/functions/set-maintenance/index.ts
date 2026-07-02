/**
 * @file set-maintenance/index.ts
 * @edge-function set-maintenance
 *
 * Nyalakan / matikan banner pemeliharaan platform-wide.
 * Hanya bisa dipanggil oleh superadmin (X-Superadmin-Key).
 *
 * GET   — baca status saat ini { active, message }
 * PATCH — Body: { active: boolean, message?: string }
 */

import { handleCors, corsHeaders } from '../_shared/cors.ts';
import { getAdminClient }          from '../_shared/db.ts';

function json(data: unknown, status = 200): Response {
    return new Response(JSON.stringify(data), {
        status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
}

Deno.serve(async (req: Request): Promise<Response> => {
    if (req.method === 'OPTIONS') return handleCors();

    const superadminKey = Deno.env.get('SUPERADMIN_KEY');
    const reqKey        = req.headers.get('x-superadmin-key');
    if (!superadminKey || reqKey !== superadminKey) {
        return json({ error: 'Unauthorized' }, 401);
    }

    const admin = getAdminClient();

    if (req.method === 'GET') {
        const { data, error } = await admin
            .from('platform_config')
            .select('maintenance_active, maintenance_message, updated_at')
            .eq('id', 1)
            .maybeSingle();
        if (error) return json({ error: error.message }, 500);
        return json({
            active:  data?.maintenance_active ?? false,
            message: data?.maintenance_message ?? '',
            updated_at: data?.updated_at ?? null,
        });
    }

    if (req.method === 'PATCH') {
        let body: { active?: boolean; message?: string };
        try { body = await req.json(); }
        catch { return json({ error: 'Body harus JSON: { active, message }' }, 400); }

        if (typeof body.active !== 'boolean') {
            return json({ error: 'Field active wajib boolean' }, 400);
        }

        const { error } = await admin
            .from('platform_config')
            .update({
                maintenance_active:  body.active,
                maintenance_message: body.message?.trim() || null,
                updated_at:          new Date().toISOString(),
            })
            .eq('id', 1);

        if (error) {
            console.error('[set-maintenance]', error);
            return json({ error: error.message }, 500);
        }
        return json({ success: true, active: body.active });
    }

    return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });
});
