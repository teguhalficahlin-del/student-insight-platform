/**
 * @file _shared/db.ts
 *
 * Supabase client factory for Edge Functions.
 *
 * TWO CLIENTS:
 *
 *   supabaseAdmin   — service role key, bypasses RLS
 *                     Used for: auth verification, idempotency checks,
 *                     transaction writes that need cross-table access.
 *                     NEVER pass this to user-facing queries.
 *
 *   supabaseUser    — anon key + user JWT, respects RLS
 *                     Used for: reads where we want RLS to filter rows.
 *                     (Not used in sync functions — we validate
 *                     permissions in application code instead.)
 *
 * IMPORTANT:
 *   - SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected by
 *     Supabase at runtime via Deno.env. Never hardcode them.
 *   - The service role key must NEVER be returned to the client
 *     in any response body or header.
 */

import { createClient, SupabaseClient }
    from 'https://esm.sh/@supabase/supabase-js@2';

let _adminClient: SupabaseClient | null = null;

/**
 * Returns a singleton Supabase admin client (service role).
 * Bypasses RLS — use only for server-side operations.
 */
export function getAdminClient(): SupabaseClient {
    if (_adminClient) return _adminClient;

    const url     = Deno.env.get('SUPABASE_URL');
    const key     = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!url || !key) {
        throw new Error(
            'SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set. ' +
            'Check Supabase project settings > Edge Functions > Secrets.'
        );
    }

    _adminClient = createClient(url, key, {
        auth: {
            autoRefreshToken:  false,
            persistSession:    false,
            detectSessionInUrl: false,
        },
    });

    return _adminClient;
}


/**
 * Returns a Supabase client using the user's JWT.
 * Respects RLS policies.
 * Creates a new instance per request — do not cache.
 *
 * @param userJwt  — the raw Bearer token from the request
 */
export function getUserClient(userJwt: string): SupabaseClient {
    const url    = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

    return createClient(url, anonKey, {
        global: {
            headers: { Authorization: `Bearer ${userJwt}` },
        },
        auth: {
            autoRefreshToken:  false,
            persistSession:    false,
            detectSessionInUrl: false,
        },
    });
}


// ─────────────────────────────────────────────────────────────
// TRANSACTION HELPER
// Executes a raw SQL transaction using the admin client.
// Supabase JS does not support multi-statement transactions
// natively — we use a stored procedure or rpc() for atomicity.
//
// For sync functions, we use the rpc() pattern to call
// transaction functions defined in 05_triggers_functions.sql.
//
// Alternatively, for simpler cases, we rely on the DB triggers
// to maintain consistency (e.g. trg_case_sync_handler).
// ─────────────────────────────────────────────────────────────

/**
 * Executes a Postgres function via rpc() with the admin client.
 * All sync operations that need multi-table atomicity should use this.
 *
 * @param funcName  — name of the Postgres function
 * @param params    — function parameters
 */
export async function rpcAdmin(
    funcName: string,
    params:   Record<string, unknown>,
): Promise<{ data: unknown; error: unknown }> {
    const admin = getAdminClient();
    return admin.rpc(funcName, params);
}
