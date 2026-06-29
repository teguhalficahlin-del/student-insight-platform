/**
 * @file _shared/response.ts
 *
 * Standard response builders for all Edge Functions.
 * All responses use the error envelope defined in API Contract.
 *
 * NEVER construct a Response directly in business logic —
 * always use these builders. This guarantees format consistency.
 */

import { corsHeaders } from './cors.ts';

const SCHEMA_VERSION = '1.0.0';

// ─────────────────────────────────────────────────────────────
// SUCCESS
// ─────────────────────────────────────────────────────────────

export function ok(data: unknown, status = 200): Response {
    return new Response(
        JSON.stringify({ data }),
        {
            status,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
    );
}


// ─────────────────────────────────────────────────────────────
// ERROR RESPONSES
// Each maps to an HTTP status and an error code from API Contract.
// ─────────────────────────────────────────────────────────────

interface ErrorOptions {
    code:     string;
    message:  string;
    details?: string[];
    context?: unknown;
}

function errorResponse(status: number, opts: ErrorOptions): Response {
    return new Response(
        JSON.stringify({
            error: {
                code:           opts.code,
                message:        opts.message,
                details:        opts.details ?? [],
                context:        opts.context ?? null,
                schema_version: SCHEMA_VERSION,
                timestamp:      new Date().toISOString(),
            }
        }),
        {
            status,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
    );
}

/** 400 — payload validation failed */
export function badRequest(message: string, details: string[] = []): Response {
    return errorResponse(400, { code: 'VALIDATION_FAILED', message, details });
}

/** 401 — missing or invalid JWT */
export function unauthorized(message = 'Autentikasi diperlukan'): Response {
    return errorResponse(401, { code: 'UNAUTHORIZED', message });
}

/** 403 — authenticated but not permitted */
export function forbidden(message: string): Response {
    return errorResponse(403, { code: 'FORBIDDEN', message });
}

/** 409 — case state conflict */
export function conflict(message: string, context: unknown): Response {
    return errorResponse(409, { code: 'CONFLICT_CASE_STATE', message, context });
}

/** 422 — domain invariant violation */
export function unprocessable(code: string, message: string): Response {
    return errorResponse(422, { code, message });
}

/** 400 — schema version mismatch (major) */
export function schemaMismatch(clientVersion: string): Response {
    return errorResponse(400, {
        code:    'SCHEMA_VERSION_MISMATCH',
        message: 'Versi aplikasi Anda sudah usang. Silakan perbarui aplikasi.',
        context: { client_version: clientVersion, server_version: SCHEMA_VERSION },
    });
}

/** 500 — unexpected server error */
export function internalError(err: unknown): Response {
    // Never expose raw error messages to client in production.
    // Log the real error server-side, return generic message.
    console.error('[EdgeFunction] Internal error:', err);
    return errorResponse(500, {
        code:    'INTERNAL_ERROR',
        message: 'Terjadi kesalahan pada server. Silakan coba lagi.',
    });
}


// ─────────────────────────────────────────────────────────────
// SCHEMA VERSION CHECK
// Extracts x-schema-version header and validates major version.
// Returns null if OK, or a Response to return immediately if not.
// ─────────────────────────────────────────────────────────────

export function checkSchemaVersion(req: Request): Response | null {
    const clientVersion = req.headers.get('x-schema-version');
    if (!clientVersion) return null; // Tolerate missing header (older clients)

    const clientMajor = parseInt(clientVersion.split('.')[0], 10);
    const serverMajor = parseInt(SCHEMA_VERSION.split('.')[0], 10);

    if (isNaN(clientMajor) || clientMajor !== serverMajor) {
        return schemaMismatch(clientVersion);
    }

    return null;
}
