/**
 * @file api_contract.js
 * @module ApiContract
 * @version 1.0.0
 *
 * HTTP client layer for all Supabase Edge Function calls.
 * Handles: request building, response parsing, error normalization,
 *          retry logic for transient failures, and offline detection.
 *
 * DOES NOT handle: IndexedDB queuing (that is offline_sync_contract.js).
 * This module is called by the sync layer AFTER the item is dequeued.
 *
 * USAGE (online path):
 *   import { Api } from './api_contract.js';
 *   const api = new Api({ baseUrl, getToken });
 *   const result = await api.syncAttendanceBatch(payload);
 *   if (!result.ok) handleError(result.error);
 *
 * USAGE (offline sync path, from Service Worker):
 *   Same API — the caller decides whether to enqueue or call directly.
 */

import {
    SCHEMA_VERSION,
    buildErrorEnvelope,
    ERROR_CODES,
    validate,
    OFFLINE_QUEUE_SCHEMAS,
    OFFLINE_QUEUE_TYPES,
} from './09_event_schema.js';

import {
    checkPermission,
    ACTIONS,
} from './10_permission_engine.js';


// ─────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────

export const HTTP_STATUS = Object.freeze({
    OK:                  200,
    BAD_REQUEST:         400,
    UNAUTHORIZED:        401,
    FORBIDDEN:           403,
    NOT_FOUND:           404,
    CONFLICT:            409,
    UNPROCESSABLE:       422,   // Domain invariant violation
    TOO_MANY_REQUESTS:   429,
    INTERNAL_ERROR:      500,
    SERVICE_UNAVAILABLE: 503,
});

// HTTP status codes that are safe to retry
const RETRYABLE_STATUSES = new Set([
    HTTP_STATUS.TOO_MANY_REQUESTS,
    HTTP_STATUS.INTERNAL_ERROR,
    HTTP_STATUS.SERVICE_UNAVAILABLE,
]);

// Default retry configuration
const DEFAULT_RETRY = {
    maxAttempts:    3,
    baseDelayMs:    500,
    maxDelayMs:     8000,
    backoffFactor:  2,
};

// Request timeout (ms) — critical for low-end Android devices on unstable networks
const REQUEST_TIMEOUT_MS = 15000;


// ─────────────────────────────────────────────────────────────
// RESULT TYPE
// All API methods return ApiResult — never throw.
// Callers check result.ok before using result.data.
// ─────────────────────────────────────────────────────────────

/**
 * @typedef {{ ok: true,  data: Object,       status: number }} ApiSuccess
 * @typedef {{ ok: false, error: ErrorObject, status: number }} ApiFailure
 * @typedef {ApiSuccess | ApiFailure} ApiResult
 */

function success(data, status = HTTP_STATUS.OK) {
    return { ok: true, data, status };
}

function failure(error, status = HTTP_STATUS.BAD_REQUEST) {
    return { ok: false, error, status };
}


// ─────────────────────────────────────────────────────────────
// API CLIENT CLASS
// ─────────────────────────────────────────────────────────────

export class Api {
    /**
     * @param {Object}   config
     * @param {string}   config.baseUrl      — Supabase Edge Function base URL
     * @param {Function} config.getToken     — async () => string JWT
     * @param {Object}   [config.retry]      — retry config override
     * @param {Function} [config.onOffline]  — called when request fails due to offline
     * @param {Function} [config.onError]    — global error hook for logging
     */
    constructor({ baseUrl, getToken, retry = {}, onOffline = null, onError = null }) {
        if (!baseUrl) throw new Error('Api: baseUrl is required');
        if (!getToken) throw new Error('Api: getToken is required');

        this._baseUrl   = baseUrl.replace(/\/$/, '');
        this._getToken  = getToken;
        this._retry     = { ...DEFAULT_RETRY, ...retry };
        this._onOffline = onOffline;
        this._onError   = onError;
    }


    // ── PRIVATE: core fetch with timeout, retry, error normalization ──

    async _fetch(endpoint, body, options = {}) {
        const { skipRetry = false } = options;
        let lastResult = null;

        const maxAttempts = skipRetry ? 1 : this._retry.maxAttempts;

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                const token = await this._getToken();

                const controller = new AbortController();
                const timeoutId  = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

                let response;
                try {
                    response = await fetch(`${this._baseUrl}/${endpoint}`, {
                        method:  'POST',
                        headers: {
                            'Content-Type':  'application/json',
                            'Authorization': `Bearer ${token}`,
                            'x-schema-version': SCHEMA_VERSION,
                        },
                        body:   JSON.stringify(body),
                        signal: controller.signal,
                    });
                } finally {
                    clearTimeout(timeoutId);
                }

                const json = await _safeParseJson(response);

                if (response.ok) {
                    return success(json?.data ?? json, response.status);
                }

                // Non-retryable client errors — return immediately
                if (!RETRYABLE_STATUSES.has(response.status)) {
                    lastResult = failure(
                        _normalizeError(json, response.status),
                        response.status
                    );
                    break;
                }

                // Retryable — record and possibly wait
                lastResult = failure(
                    _normalizeError(json, response.status),
                    response.status
                );

            } catch (err) {
                // Network error or timeout
                const isOffline = !navigator.onLine || err.name === 'AbortError';

                if (isOffline && this._onOffline) {
                    this._onOffline({ endpoint, body });
                }

                lastResult = failure(
                    buildErrorEnvelope(
                        isOffline ? 'NETWORK_OFFLINE' : 'NETWORK_ERROR',
                        isOffline
                            ? 'Tidak ada koneksi internet. Data akan disimpan untuk dikirim ulang.'
                            : `Network error: ${err.message}`,
                    ).error,
                    0
                );

                if (isOffline) break; // No point retrying when offline
            }

            // Backoff before next attempt
            if (attempt < maxAttempts) {
                const delay = Math.min(
                    this._retry.baseDelayMs * Math.pow(this._retry.backoffFactor, attempt - 1),
                    this._retry.maxDelayMs
                );
                await _sleep(delay);
            }
        }

        if (this._onError && lastResult && !lastResult.ok) {
            this._onError({ endpoint, body, result: lastResult });
        }

        return lastResult;
    }


    // ─────────────────────────────────────────────────────────
    // ENDPOINT: sync-attendance-batch
    //
    // POST /functions/v1/sync-attendance-batch
    //
    // Submits attendance for one complete teaching session.
    // Idempotent: server applies UPSERT keyed on schedule_id.
    // One call per session — not per student.
    //
    // Client-side pre-flight:
    //   1. Validate payload against OFFLINE_QUEUE_SCHEMAS.ATTENDANCE_BATCH
    //   2. checkPermission(ATTENDANCE_SUBMIT, userCtx, { schedule: scheduleCtx })
    //
    // Server behavior:
    //   1. Verify JWT + RLS (teacher must own schedule or have valid substitute token)
    //   2. Validate substitute_token if provided (TN-07)
    //   3. BEGIN TRANSACTION
    //      a. UPSERT attendance rows (one per student record)
    //      b. Update teaching_schedules.meeting_status if provided
    //      c. INSERT teacher_attendance_log signal
    //   4. COMMIT
    //
    // Idempotency: safe to replay. UPSERT means no duplicates.
    // ─────────────────────────────────────────────────────────

    async syncAttendanceBatch(payload, userCtx, scheduleCtx) {
        // Pre-flight: permission
        const perm = checkPermission(ACTIONS.ATTENDANCE_SUBMIT, userCtx, { schedule: scheduleCtx });
        if (!perm.allowed) {
            return failure(
                buildErrorEnvelope(ERROR_CODES.FORBIDDEN, perm.reason).error,
                HTTP_STATUS.FORBIDDEN
            );
        }

        // Pre-flight: schema
        const schema = OFFLINE_QUEUE_SCHEMAS[OFFLINE_QUEUE_TYPES.ATTENDANCE_BATCH];
        const valid  = validate(schema.requiredFields, schema.optionalFields, payload);
        if (!valid.valid) {
            return failure(
                buildErrorEnvelope(ERROR_CODES.VALIDATION_FAILED, 'Payload tidak valid', valid.errors).error,
                HTTP_STATUS.BAD_REQUEST
            );
        }

        return this._fetch('sync-attendance-batch', {
            ...payload,
            _schema_version: SCHEMA_VERSION,
        });
    }


    // ─────────────────────────────────────────────────────────
    // ENDPOINT: sync-observation
    //
    // POST /functions/v1/sync-observation
    //
    // Creates one observation record.
    // Server inserts into `observations` table.
    // If schedule_id provided, also inserts teacher_attendance_log signal.
    //
    // Idempotency: keyed on idempotency_key.
    //   Server: INSERT ... ON CONFLICT (idempotency_key) DO NOTHING
    //   Returns 200 with existing record if duplicate detected.
    // ─────────────────────────────────────────────────────────

    async syncObservation(payload, userCtx) {
        const perm = checkPermission(ACTIONS.OBSERVATION_CREATE, userCtx);
        if (!perm.allowed) {
            return failure(
                buildErrorEnvelope(ERROR_CODES.FORBIDDEN, perm.reason).error,
                HTTP_STATUS.FORBIDDEN
            );
        }

        const schema = OFFLINE_QUEUE_SCHEMAS[OFFLINE_QUEUE_TYPES.OBSERVATION_CREATE];
        const valid  = validate(schema.requiredFields, schema.optionalFields, payload);
        if (!valid.valid) {
            return failure(
                buildErrorEnvelope(ERROR_CODES.VALIDATION_FAILED, 'Payload tidak valid', valid.errors).error,
                HTTP_STATUS.BAD_REQUEST
            );
        }

        return this._fetch('sync-observation', {
            ...payload,
            _schema_version: SCHEMA_VERSION,
        });
    }


    // ─────────────────────────────────────────────────────────
    // ENDPOINT: sync-journal
    //
    // POST /functions/v1/sync-journal
    //
    // Creates one teacher journal entry. Private — RLS ensures
    // only the owner's JWT can write this row.
    //
    // Idempotency: keyed on idempotency_key.
    // ─────────────────────────────────────────────────────────

    async syncJournal(payload, userCtx) {
        const perm = checkPermission(ACTIONS.JOURNAL_CREATE, userCtx);
        if (!perm.allowed) {
            return failure(
                buildErrorEnvelope(ERROR_CODES.FORBIDDEN, perm.reason).error,
                HTTP_STATUS.FORBIDDEN
            );
        }

        const schema = OFFLINE_QUEUE_SCHEMAS[OFFLINE_QUEUE_TYPES.JOURNAL_CREATE];
        const valid  = validate(schema.requiredFields, schema.optionalFields, payload);
        if (!valid.valid) {
            return failure(
                buildErrorEnvelope(ERROR_CODES.VALIDATION_FAILED, 'Payload tidak valid', valid.errors).error,
                HTTP_STATUS.BAD_REQUEST
            );
        }

        return this._fetch('sync-journal', {
            ...payload,
            _schema_version: SCHEMA_VERSION,
        });
    }


    // ─────────────────────────────────────────────────────────
    // ENDPOINT: sync-case-event
    //
    // POST /functions/v1/sync-case-event
    //
    // Appends one event to a case's event log.
    // Most complex endpoint — must enforce all 4 invariants server-side.
    //
    // Server behavior:
    //   1. Verify JWT
    //   2. SELECT case FOR UPDATE (locks the row)
    //   3. Re-validate all invariants against CURRENT server state:
    //      a. INV-1: status != CLOSED
    //      b. INV-3: author_role == current_handler_role
    //         (except FINAL_DECISION_MADE: skip handler check)
    //         (except PARENT_MESSAGE_LINKED: skip handler check)
    //      c. INV-4: if is_locked, only current_handler can COMMENT_ADDED
    //      d. INV-2: if DECISION_ESCALATE, new_handler != previous_handler
    //   4. Compare snapshot fields against current state:
    //      If mismatch → return 409 CONFLICT_CASE_STATE with current state
    //   5. BEGIN TRANSACTION
    //      a. INSERT case_events row
    //      b. trigger trg_case_sync_handler fires → updates cases row
    //      c. If STUDENT_UPDATE_ADDED → INSERT student_updates row
    //      d. If PARENT_MESSAGE_LINKED → UPDATE parent_messages.case_id
    //   6. COMMIT
    //
    // Conflict policy: REJECT_WITH_DIFF (409 returns current case state)
    // Idempotency: keyed on idempotency_key
    //   Server: check idempotency_key in case_events before insert.
    //   If found → return 200 with existing event_id (already applied).
    // ─────────────────────────────────────────────────────────

    async syncCaseEvent(payload, userCtx, caseCtx) {
        // Pre-flight: schema validation only — permission is event-type-specific
        // and already validated when the event was built via buildCaseEventEnvelope()
        const schema = OFFLINE_QUEUE_SCHEMAS[OFFLINE_QUEUE_TYPES.CASE_EVENT_CREATE];
        const valid  = validate(schema.requiredFields, schema.optionalFields, payload);
        if (!valid.valid) {
            return failure(
                buildErrorEnvelope(ERROR_CODES.VALIDATION_FAILED, 'Payload tidak valid', valid.errors).error,
                HTTP_STATUS.BAD_REQUEST
            );
        }

        const result = await this._fetch('sync-case-event', {
            ...payload,
            _schema_version: SCHEMA_VERSION,
        });

        // 409 CONFLICT: server returns current case state
        // Caller must handle this — show conflict resolution UI
        if (!result.ok && result.status === HTTP_STATUS.CONFLICT) {
            return {
                ...result,
                conflict: true,
                currentState: result.error?.context ?? null,
            };
        }

        return result;
    }


    // ─────────────────────────────────────────────────────────
    // ENDPOINT: sync-case-create
    //
    // POST /functions/v1/sync-case-create
    //
    // Creates a new case. case_id is client-generated UUID.
    //
    // Server behavior:
    //   BEGIN TRANSACTION
    //     INSERT INTO cases (case_id = payload.case_id, ...)
    //     INSERT INTO case_events (event_type = 'STATUS_CHANGED',
    //       new_status = 'OPEN', ...) — initial audit event
    //   ON CONFLICT (case_id) DO NOTHING
    //   COMMIT
    //
    // Idempotency: case_id is the key. Safe to replay.
    // ─────────────────────────────────────────────────────────

    async syncCaseCreate(payload, userCtx) {
        const perm = checkPermission(ACTIONS.CASE_CREATE, userCtx);
        if (!perm.allowed) {
            return failure(
                buildErrorEnvelope(ERROR_CODES.FORBIDDEN, perm.reason).error,
                HTTP_STATUS.FORBIDDEN
            );
        }

        const schema = OFFLINE_QUEUE_SCHEMAS[OFFLINE_QUEUE_TYPES.CASE_CREATE];
        const valid  = validate(schema.requiredFields, schema.optionalFields, payload);
        if (!valid.valid) {
            return failure(
                buildErrorEnvelope(ERROR_CODES.VALIDATION_FAILED, 'Payload tidak valid', valid.errors).error,
                HTTP_STATUS.BAD_REQUEST
            );
        }

        return this._fetch('sync-case-create', {
            ...payload,
            _schema_version: SCHEMA_VERSION,
        });
    }


    // ─────────────────────────────────────────────────────────
    // ENDPOINT: send-parent-reply
    //
    // POST /functions/v1/send-parent-reply
    //
    // Sends a reply to an ORTU message.
    // NOT in the offline queue — requires online (Category B).
    //
    // Server behavior:
    //   BEGIN TRANSACTION
    //     INSERT INTO parent_messages (direction = OUTBOUND, ...)
    //     If case_id provided:
    //       INSERT INTO case_events (PARENT_REPLY_SENT, ...)
    //   COMMIT
    //
    // Idempotency: NOT idempotent (each call creates a new reply).
    // Caller must prevent double-submit via UI guard.
    // ─────────────────────────────────────────────────────────

    async sendParentReply(payload, userCtx) {
        const perm = checkPermission(ACTIONS.PARENT_MSG_REPLY, userCtx);
        if (!perm.allowed) {
            return failure(
                buildErrorEnvelope(ERROR_CODES.FORBIDDEN, perm.reason).error,
                HTTP_STATUS.FORBIDDEN
            );
        }

        const valid = validate(PARENT_REPLY_FIELDS, [], payload);
        if (!valid.valid) {
            return failure(
                buildErrorEnvelope(ERROR_CODES.VALIDATION_FAILED, 'Payload tidak valid', valid.errors).error,
                HTTP_STATUS.BAD_REQUEST
            );
        }

        return this._fetch('send-parent-reply', payload, { skipRetry: true });
    }


    // ─────────────────────────────────────────────────────────
    // ENDPOINT: provision-user
    //
    // POST /functions/v1/provision-user
    //
    // Creates a new user (auth.users + users in one transaction).
    // Requires service-role key OR KEPSEK JWT with admin scope.
    // NOT available offline.
    //
    // Server behavior:
    //   1. Verify caller is KEPSEK or service role
    //   2. BEGIN TRANSACTION
    //      a. supabase.auth.admin.createUser({ email, password })
    //      b. INSERT INTO users (auth_user_id, role_type, ...)
    //      c. If SISWA: INSERT INTO students if student_id not provided
    //   3. COMMIT
    //   4. Send welcome email via Supabase Auth
    //
    // Idempotency: keyed on email. Duplicate email returns existing user.
    // ─────────────────────────────────────────────────────────

    async provisionUser(payload, userCtx) {
        if (userCtx.role_type !== 'KEPSEK') {
            return failure(
                buildErrorEnvelope(ERROR_CODES.FORBIDDEN, 'Hanya Kepsek yang dapat membuat akun pengguna').error,
                HTTP_STATUS.FORBIDDEN
            );
        }

        const valid = validate(PROVISION_USER_FIELDS, PROVISION_USER_OPTIONAL, payload);
        if (!valid.valid) {
            return failure(
                buildErrorEnvelope(ERROR_CODES.VALIDATION_FAILED, 'Payload tidak valid', valid.errors).error,
                HTTP_STATUS.BAD_REQUEST
            );
        }

        return this._fetch('provision-user', payload, { skipRetry: false });
    }


    // ─────────────────────────────────────────────────────────
    // ENDPOINT: evaluate-teacher-indicators (CRON)
    //
    // POST /functions/v1/evaluate-teacher-indicators
    //
    // Resolves all PENDING_EVALUATION teacher indicators for a date.
    // Called by Supabase cron scheduler at end of school day (17:00 WIB).
    // Also callable manually by KEPSEK for a specific date.
    //
    // Server behavior:
    //   CALL fn_evaluate_teacher_indicators(p_session_date)
    //   Returns list of resolved schedule_ids and their new indicator value.
    //
    // Auth: service role (cron) OR KEPSEK JWT.
    // ─────────────────────────────────────────────────────────

    async evaluateTeacherIndicators(sessionDate, userCtx) {
        if (userCtx && userCtx.role_type !== 'KEPSEK') {
            return failure(
                buildErrorEnvelope(ERROR_CODES.FORBIDDEN, 'Akses ditolak').error,
                HTTP_STATUS.FORBIDDEN
            );
        }

        const dateErr = _validateIsoDate(sessionDate);
        if (dateErr) {
            return failure(
                buildErrorEnvelope(ERROR_CODES.VALIDATION_FAILED, dateErr).error,
                HTTP_STATUS.BAD_REQUEST
            );
        }

        return this._fetch('evaluate-teacher-indicators', { session_date: sessionDate });
    }


    // ─────────────────────────────────────────────────────────
    // HEALTH CHECK
    //
    // GET /functions/v1/health
    // Returns { status: 'ok', version: '...' }
    // Used by Service Worker to detect connectivity.
    // ─────────────────────────────────────────────────────────

    async healthCheck() {
        try {
            const controller = new AbortController();
            const timeoutId  = setTimeout(() => controller.abort(), 5000);
            try {
                const response = await fetch(`${this._baseUrl}/health`, {
                    method: 'GET',
                    signal: controller.signal,
                });
                return { online: response.ok, status: response.status };
            } finally {
                clearTimeout(timeoutId);
            }
        } catch {
            return { online: false, status: 0 };
        }
    }
}


// ─────────────────────────────────────────────────────────────
// ADDITIONAL PAYLOAD SCHEMAS
// (not in OFFLINE_QUEUE_SCHEMAS because these are online-only)
// ─────────────────────────────────────────────────────────────

import { FieldType as _F } from './09_event_schema.js';

// Inline FieldType re-export for local use
// (In real project, FieldType is exported from event_schema.js)
const FT = {
    uuid:          (v, n) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
                                ? null : `${n} must be a valid UUID`,
    str:           (v, n, min=1, max=Infinity) => typeof v === 'string' && v.trim().length >= min && v.length <= max
                                ? null : `${n} must be a string (min ${min}, max ${max} chars)`,
    enum:          (v, n, vals) => vals.includes(v) ? null : `${n} must be one of [${vals.join(', ')}]`,
    bool:          (v, n) => typeof v === 'boolean' ? null : `${n} must be boolean`,
};

const PARENT_REPLY_FIELDS = [
    ['reply_to_message_id', (v) => FT.uuid(v, 'reply_to_message_id')],
    ['body',                (v) => FT.str(v, 'body', 1, 5000)],
    ['student_id',          (v) => FT.uuid(v, 'student_id')],
];

const PROVISION_USER_FIELDS = [
    ['email',     (v) => (typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v))
                            ? null : 'email must be a valid email address'],
    ['full_name', (v) => FT.str(v, 'full_name', 2, 150)],
    ['role_type', (v) => FT.enum(v, 'role_type',
                    ['GURU','BK','WALI_KELAS','KAPRODI','KEPSEK','DUDI','SISWA','ORTU',
                     'ADMINISTRATIVE','STAKEHOLDER','WAKA_KURIKULUM','WAKA_KESISWAAN'])],
];

const PROVISION_USER_OPTIONAL = [
    ['program_id',          (v) => FT.uuid(v, 'program_id')],
    ['wali_kelas_class_id', (v) => FT.uuid(v, 'wali_kelas_class_id')],
    ['dudi_org_name',       (v) => FT.str(v, 'dudi_org_name', 2, 150)],
    ['student_id',          (v) => FT.uuid(v, 'student_id')],        // link existing student
    ['parent_student_id',   (v) => FT.uuid(v, 'parent_student_id')], // for ORTU: link to student
];


// ─────────────────────────────────────────────────────────────
// RESPONSE SHAPES (for documentation + client validation)
// ─────────────────────────────────────────────────────────────

export const RESPONSE_SHAPES = Object.freeze({

    syncAttendanceBatch: {
        // 200 OK
        success: {
            schedule_id:      'uuid',
            records_upserted: 'integer',
            was_duplicate:    'boolean',  // true if idempotency key already existed
        },
    },

    syncObservation: {
        // 200 OK
        success: {
            observation_id: 'uuid',
            was_duplicate:  'boolean',
        },
    },

    syncJournal: {
        // 200 OK
        success: {
            journal_id:    'uuid',
            was_duplicate: 'boolean',
        },
    },

    syncCaseEvent: {
        // 200 OK
        success: {
            event_id:             'uuid',
            case_id:              'uuid',
            new_case_status:      'CASE_STATUS | null',
            new_handler_role:     'ROLE_TYPE | null',
            was_duplicate:        'boolean',
        },
        // 409 CONFLICT
        conflict: {
            error: {
                code:    'CONFLICT_CASE_STATE',
                context: {
                    current_status:       'CASE_STATUS',
                    current_handler_role: 'ROLE_TYPE',
                    is_locked:            'boolean',
                    last_event_at:        'ISO timestamp',
                },
            },
        },
    },

    syncCaseCreate: {
        // 200 OK
        success: {
            case_id:       'uuid',
            was_duplicate: 'boolean',
        },
    },

    sendParentReply: {
        // 200 OK
        success: {
            message_id:   'uuid',
            case_event_id: 'uuid | null',
        },
    },

    provisionUser: {
        // 200 OK
        success: {
            user_id:      'uuid',
            auth_user_id: 'uuid',
            was_duplicate: 'boolean',
        },
    },

    evaluateTeacherIndicators: {
        // 200 OK
        success: {
            session_date: 'YYYY-MM-DD',
            resolved:     [{ schedule_id: 'uuid', resolved_to: 'HADIR | TIDAK_HADIR' }],
            total:        'integer',
        },
    },
});


// ─────────────────────────────────────────────────────────────
// UTILITY FUNCTIONS
// ─────────────────────────────────────────────────────────────

async function _safeParseJson(response) {
    try {
        const text = await response.text();
        if (!text || !text.trim()) return null;
        return JSON.parse(text);
    } catch {
        return null;
    }
}

function _normalizeError(json, status) {
    // Already in our error envelope format
    if (json?.error?.code) return json.error;

    // Supabase error format
    if (json?.message) {
        return buildErrorEnvelope(
            _supabaseCodeToErrorCode(json.code, status),
            json.message,
            json.details ? [json.details] : [],
        ).error;
    }

    // Unknown format
    return buildErrorEnvelope(
        'SERVER_ERROR',
        `Server returned status ${status}`,
    ).error;
}

function _supabaseCodeToErrorCode(pgCode, httpStatus) {
    if (httpStatus === HTTP_STATUS.UNAUTHORIZED)    return ERROR_CODES.UNAUTHORIZED;
    if (httpStatus === HTTP_STATUS.FORBIDDEN)       return ERROR_CODES.FORBIDDEN;
    if (httpStatus === HTTP_STATUS.CONFLICT)        return ERROR_CODES.CONFLICT_CASE_STATE;
    if (pgCode === '23505')                         return ERROR_CODES.IDEMPOTENCY_DUPLICATE;
    if (pgCode === 'P0001')                         return 'DOMAIN_INVARIANT_VIOLATION';
    return 'SERVER_ERROR';
}

function _validateIsoDate(v) {
    if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || isNaN(Date.parse(v))) {
        return `Date must be YYYY-MM-DD, got: ${JSON.stringify(v)}`;
    }
    return null;
}

function _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}


// ─────────────────────────────────────────────────────────────
// FACTORY: create Api instance from Supabase client config
// Convenience function for use in PWA main thread.
// ─────────────────────────────────────────────────────────────

/**
 * @param {Object} supabaseClient — initialized Supabase JS client
 * @param {Object} [options]      — Api constructor options (retry, onOffline, onError)
 * @returns {Api}
 */
export function createApi(supabaseClient, options = {}) {
    const baseUrl = supabaseClient.functionsUrl ??
        `${supabaseClient.supabaseUrl}/functions/v1`;

    return new Api({
        baseUrl,
        getToken: async () => {
            const { data: { session } } = await supabaseClient.auth.getSession();
            if (!session) throw new Error('No active session');
            return session.access_token;
        },
        ...options,
    });
}
