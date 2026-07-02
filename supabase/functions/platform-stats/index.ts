/**
 * @file platform-stats/index.ts
 * @edge-function platform-stats
 *
 * Statistik infrastruktur untuk konsol superadmin (X-Superadmin-Key).
 * GET → { db_size_bytes, db_size_pretty, tables:[...] }
 *
 * Dipakai untuk monitoring penyimpanan (kemungkinan_buruk.md 6.5).
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
    if (req.method !== 'GET') {
        return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });
    }

    const superadminKey = Deno.env.get('SUPERADMIN_KEY');
    const reqKey        = req.headers.get('x-superadmin-key');
    if (!superadminKey || reqKey !== superadminKey) {
        return json({ error: 'Unauthorized' }, 401);
    }

    const admin = getAdminClient();
    const { data, error } = await admin.rpc('fn_platform_storage');
    if (error) {
        console.error('[platform-stats]', error);
        return json({ error: error.message }, 500);
    }

    return json(data);
});
