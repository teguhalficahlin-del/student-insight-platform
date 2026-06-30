/**
 * @file _shared/cors.ts
 *
 * CORS headers required by Supabase Edge Functions.
 * All functions must handle OPTIONS preflight.
 *
 * Usage:
 *   import { corsHeaders, handleCors } from '../_shared/cors.ts';
 *
 *   if (req.method === 'OPTIONS') return handleCors();
 *   return new Response(body, { headers: corsHeaders });
 */

export const corsHeaders: Record<string, string> = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Headers': [
        'authorization',
        'x-client-info',
        'apikey',
        'content-type',
        'x-schema-version',
        'x-superadmin-key',
    ].join(', '),
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
};

/**
 * Returns a 204 response for OPTIONS preflight requests.
 * Call this before any other logic in every Edge Function.
 */
export function handleCors(): Response {
    return new Response(null, { status: 204, headers: corsHeaders });
}
