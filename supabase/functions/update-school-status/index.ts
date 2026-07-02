/**
 * @file update-school-status/index.ts
 * @edge-function update-school-status
 *
 * Aktifkan atau nonaktifkan sekolah.
 * Hanya bisa dipanggil oleh superadmin (X-Superadmin-Key).
 *
 * PATCH Body: { school_id, is_active: true | false }
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
    if (req.method !== 'PATCH') {
        return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });
    }

    const superadminKey = Deno.env.get('SUPERADMIN_KEY');
    const reqKey        = req.headers.get('x-superadmin-key');
    if (!superadminKey || reqKey !== superadminKey) {
        return json({ error: 'Unauthorized' }, 401);
    }

    let body: { school_id?: string; is_active?: boolean };
    try { body = await req.json(); }
    catch { return json({ error: 'Body harus JSON: { school_id, is_active }' }, 400); }

    const { school_id, is_active } = body;
    if (!school_id)          return json({ error: 'school_id wajib diisi' }, 400);
    if (is_active === undefined) return json({ error: 'is_active wajib diisi (true/false)' }, 400);

    const admin = getAdminClient();

    const { error } = await admin
        .from('schools')
        .update({ is_active })
        .eq('school_id', school_id);

    if (error) {
        console.error('[update-school-status]', error);
        return json({ error: error.message }, 500);
    }

    return json({ success: true, school_id, is_active });
});
