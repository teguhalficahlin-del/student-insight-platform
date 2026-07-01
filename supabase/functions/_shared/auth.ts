/**
 * @file _shared/auth.ts
 *
 * JWT verification and authenticated user resolution.
 *
 * FLOW:
 *   1. Extract Bearer token from Authorization header
 *   2. Verify via Supabase Auth (getUser) — validates signature + expiry
 *   3. Resolve user row from `users` table (role_type, wali_kelas_class_id, etc.)
 *   4. Return typed AuthUser or an error Response
 *
 * WHY NOT USE JWT CLAIMS DIRECTLY:
 *   JWT claims are set at login time. role_type and wali_kelas_class_id
 *   could have changed since then. Always resolve from DB for authoritative
 *   values. The DB query is cheap — single row by auth_user_id with index.
 *
 * Usage:
 *   const authResult = await resolveAuth(req, supabaseAdmin);
 *   if (authResult instanceof Response) return authResult; // auth failed
 *   const { user } = authResult;
 */

import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { unauthorized }   from './response.ts';

// ─────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────

export interface AuthUser {
    user_id:              string;
    auth_user_id:         string;
    full_name:            string;
    email:                string;
    role_type:            string;
    wali_kelas_class_id:  string | null;
    program_id:           string | null;
    school_id:            string;
    is_active:            boolean;
}

export type AuthResult = { user: AuthUser } | Response;


// ─────────────────────────────────────────────────────────────
// RESOLVE AUTH
// Returns { user } or a Response (to return immediately).
// ─────────────────────────────────────────────────────────────

export async function resolveAuth(
    req: Request,
    supabaseAdmin: SupabaseClient,
): Promise<AuthResult> {
    // 1. Extract token
    const authHeader = req.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return unauthorized('Authorization header hilang atau tidak valid');
    }

    const token = authHeader.slice('Bearer '.length).trim();
    if (!token) {
        return unauthorized('Token tidak ditemukan');
    }

    // 2. Verify token via Supabase Auth
    // getUser() validates signature and expiry server-side
    const { data: { user: authUser }, error: authError } =
        await supabaseAdmin.auth.getUser(token);

    if (authError || !authUser) {
        // Log for server-side debugging; do not expose detail to client
        console.warn('[auth] Token verification failed:', authError?.message);
        return unauthorized('Token tidak valid atau sudah kedaluwarsa');
    }

    // 3. Resolve user row from DB
    const { data: userRow, error: dbError } = await supabaseAdmin
        .from('users')
        .select('user_id, auth_user_id, full_name, email, role_type, wali_kelas_class_id, program_id, school_id, is_active')
        .eq('auth_user_id', authUser.id)
        .single();

    if (dbError || !userRow) {
        console.error('[auth] User row not found for auth_user_id:', authUser.id);
        return unauthorized('Akun pengguna tidak ditemukan. Hubungi administrator.');
    }

    // 4. Active check
    if (!userRow.is_active) {
        return unauthorized('Akun pengguna tidak aktif. Hubungi administrator.');
    }

    return { user: userRow as AuthUser };
}


// ─────────────────────────────────────────────────────────────
// TYPE GUARD
// Use after resolveAuth() to narrow the return type.
// ─────────────────────────────────────────────────────────────

export function isAuthError(result: AuthResult): result is Response {
    return result instanceof Response;
}
