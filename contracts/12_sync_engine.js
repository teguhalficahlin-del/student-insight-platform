/**
 * @file sync_engine.js
 * @module SyncEngine
 * @version 1.0.0
 *
 * Service Worker sync lifecycle orchestrator.
 * Entry point for Background Sync API events.
 *
 * RESPONSIBILITIES:
 *   1. Process offline queue (send queued items to server)
 *   2. Pull fresh data into sync_cache for offline rendering
 *   3. Handle conflict items (flag for user resolution)
 *   4. Schema version guard on startup
 *
 * USAGE (in service_worker.js):
 *
 *   import { SyncEngine } from './sync_engine.js';
 *
 *   // Background Sync API
 *   self.addEventListener('sync', (event) => {
 *     if (event.tag === SyncEngine.SYNC_TAGS.QUEUE_FLUSH) {
 *       event.waitUntil(SyncEngine.flushQueue());
 *     }
 *     if (event.tag === SyncEngine.SYNC_TAGS.DATA_PULL) {
 *       event.waitUntil(SyncEngine.pullData());
 *     }
 *   });
 *
 *   // Periodic Sync (if available)
 *   self.addEventListener('periodicsync', (event) => {
 *     if (event.tag === SyncEngine.SYNC_TAGS.DATA_PULL) {
 *       event.waitUntil(SyncEngine.pullData());
 *     }
 *   });
 *
 * USAGE (main thread — trigger manual sync):
 *
 *   import { SyncEngine } from './sync_engine.js';
 *   await SyncEngine.requestSync(); // registers background sync tag
 *
 * DATA PULL SCOPE (Category A offline data):
 *   - Teacher's schedules for next 7 days
 *   - Enrolled students per class
 *   - Active cases where user is current_handler
 *   - Case events for those cases
 *   - User's own profile + assignments
 *   - Substitute schedules (if any, for current day)
 */

import { OfflineQueue, QUEUE_STATUS } from './12_offline_queue.js';
import { Api, HTTP_STATUS }           from './11_api_contract.js';
import { CACHE_KEY, CACHE_TTL, META_KEY, STORE } from './12_idb_schema.js';
import { SCHEMA_VERSION, OFFLINE_QUEUE_TYPES }   from './09_event_schema.js';


// ─────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────

const SYNC_TAGS = Object.freeze({
    QUEUE_FLUSH: 'smk-queue-flush',
    DATA_PULL:   'smk-data-pull',
});

// Max items to process per sync cycle
// Keeps each sync run short enough to complete before SW is killed
const BATCH_SIZE = 10;

// Supabase PostgREST base URL for read-only fetches
// Set via SW message from main thread on registration
let _postgrestUrl  = null;
let _functionsUrl  = null;
let _getToken      = null;
let _currentUserId = null;
let _currentUserRole = null;


// ─────────────────────────────────────────────────────────────
// SYNC ENGINE
// ─────────────────────────────────────────────────────────────

export const SyncEngine = {

    SYNC_TAGS,

    /**
     * Configure the engine. Called once from the SW activate event
     * after receiving a 'SW_CONFIG' message from the main thread.
     *
     * @param {Object} config
     * @param {string} config.postgrestUrl
     * @param {string} config.functionsUrl
     * @param {Function} config.getToken  — async () => jwt string
     * @param {string} config.userId
     * @param {string} config.userRole
     */
    configure({ postgrestUrl, functionsUrl, getToken, userId, userRole }) {
        _postgrestUrl    = postgrestUrl;
        _functionsUrl    = functionsUrl;
        _getToken        = getToken;
        _currentUserId   = userId;
        _currentUserRole = userRole;
    },

    isConfigured() {
        return Boolean(_postgrestUrl && _functionsUrl && _getToken && _currentUserId);
    },


    // ─────────────────────────────────────────────────────────
    // REQUEST SYNC
    // Called from main thread to register a background sync tag.
    // Falls back to immediate execution if Background Sync API
    // is not available.
    // ─────────────────────────────────────────────────────────

    async requestSync(tag = SYNC_TAGS.QUEUE_FLUSH) {
        if (!('serviceWorker' in navigator) || !('SyncManager' in window)) {
            // Background Sync not supported — run immediately if online
            if (navigator.onLine) {
                await SyncEngine.flushQueue();
            }
            return;
        }

        const swReg = await navigator.serviceWorker.ready;
        await swReg.sync.register(tag);
    },


    // ─────────────────────────────────────────────────────────
    // FLUSH QUEUE
    // Main sync loop. Processes one batch per call.
    // Background Sync API will call this repeatedly until
    // the queue is empty or the call succeeds.
    //
    // FAILURE CONTRACT:
    //   - Returns true  → sync complete, SW unregisters the tag
    //   - Throws        → sync incomplete, SW retries later
    //
    // We throw only for transient errors (network down).
    // Non-retryable errors (4xx) are handled item-by-item and
    // do not cause the whole batch to fail.
    // ─────────────────────────────────────────────────────────

    async flushQueue() {
        if (!SyncEngine.isConfigured()) {
            console.warn('[SyncEngine] Not configured. Skipping flush.');
            return true;
        }

        const queue = await OfflineQueue.open();
        const api   = _buildApi();

        // Schema version guard
        await queue.checkSchemaVersion();

        // Watchdog: reset stale PROCESSING items from a previous dead SW
        const { reset } = await queue.resetStaleProcessing();
        if (reset > 0) {
            console.log(`[SyncEngine] Reset ${reset} stale PROCESSING items`);
        }

        const batch = await queue.dequeueBatch(BATCH_SIZE);
        if (batch.length === 0) return true; // Queue empty

        console.log(`[SyncEngine] Processing batch of ${batch.length} items`);

        let hasNetworkError = false;

        for (const item of batch) {
            const result = await _processItem(item, api, queue);
            if (result.networkError) {
                hasNetworkError = true;
                break; // No point continuing — network is down
            }
        }

        if (hasNetworkError) {
            // Signal to Background Sync that we need a retry
            throw new Error('[SyncEngine] Network unavailable during sync — will retry');
        }

        // Check if more items remain
        const summary = await queue.getQueueSummary();
        if (summary.pending > 0) {
            // More items exist — throw to trigger another sync cycle
            throw new Error(`[SyncEngine] ${summary.pending} items remaining — requesting another cycle`);
        }

        // Notify main thread that sync is complete
        _broadcastToClients({ type: 'SYNC_COMPLETE', summary });

        return true;
    },


    // ─────────────────────────────────────────────────────────
    // PULL DATA
    // Fetches fresh data from Supabase and writes to sync_cache.
    // Called on login, on periodic sync, and after flushQueue completes.
    //
    // Scope: only data needed for this user's offline operation.
    // Not a full database dump.
    // ─────────────────────────────────────────────────────────

    async pullData() {
        if (!SyncEngine.isConfigured()) return;

        const queue = await OfflineQueue.open();

        // Check storage before pulling — don't fill up device
        const estimate = await OfflineQueue.storageEstimate();
        if (estimate.usagePercent !== null && estimate.usagePercent > 80) {
            console.warn('[SyncEngine] Storage > 80%. Evicting cache before pull.');
            await queue.evictExpiredCache();
        }

        const results = await Promise.allSettled([
            _pullUserProfile(queue),
            _pullSchedules(queue),
            _pullCases(queue),
            _pullAssignments(queue),
        ]);

        const errors = results
            .filter(r => r.status === 'rejected')
            .map(r => r.reason?.message ?? String(r.reason));

        if (errors.length > 0) {
            console.warn('[SyncEngine] Some pull operations failed:', errors);
        }

        await queue.setMeta(META_KEY.LAST_FULL_SYNC, new Date().toISOString());

        _broadcastToClients({
            type:   'DATA_PULL_COMPLETE',
            errors: errors.length > 0 ? errors : null,
        });
    },


    // ─────────────────────────────────────────────────────────
    // QUEUE STATUS (main thread utility)
    // Returns current queue summary for UI sync indicator.
    // ─────────────────────────────────────────────────────────

    async getQueueStatus() {
        const queue = await OfflineQueue.open();
        return queue.getQueueSummary();
    },


    // ─────────────────────────────────────────────────────────
    // CONFLICT LIST (main thread utility)
    // Returns all items in the conflict_queue for user resolution UI.
    // ─────────────────────────────────────────────────────────

    async getConflicts() {
        const queue = await OfflineQueue.open();
        return queue.cacheRead('__conflict_list__') ?? [];
    },
};


// ─────────────────────────────────────────────────────────────
// ITEM PROCESSOR
// Routes a single queue item to the correct API method.
// Returns { networkError: boolean }.
// ─────────────────────────────────────────────────────────────

async function _processItem(item, api, queue) {
    const userCtx = { user_id: _currentUserId, role_type: _currentUserRole, is_active: true };

    let result;

    try {
        switch (item.queue_type) {

            case OFFLINE_QUEUE_TYPES.ATTENDANCE_BATCH:
                result = await api.syncAttendanceBatch(item, userCtx, {
                    schedule_id:                item.schedule_id,
                    assigned_teacher_id:        _currentUserId,
                    substitute_user_id:         item.substitute_token ? _currentUserId : null,
                    substitute_token_expires_at: item.substitute_token
                        ? new Date(Date.now() + 3600000).toISOString()
                        : null,
                });
                break;

            case OFFLINE_QUEUE_TYPES.OBSERVATION_CREATE:
                result = await api.syncObservation(item, userCtx);
                break;

            case OFFLINE_QUEUE_TYPES.JOURNAL_CREATE:
                result = await api.syncJournal(item, userCtx);
                break;

            case OFFLINE_QUEUE_TYPES.CASE_EVENT_CREATE:
                result = await api.syncCaseEvent(item, userCtx, {
                    case_id:              item.case_id,
                    status:               item.case_status_snapshot,
                    current_handler_role: item.current_handler_snapshot,
                    is_locked:            item.is_locked_snapshot,
                    track:                item._case_track,
                    student_id:           item._student_id,
                    involved_user_ids:    item._involved_user_ids ?? [],
                });
                break;

            case OFFLINE_QUEUE_TYPES.CASE_CREATE:
                result = await api.syncCaseCreate(item, userCtx);
                break;

            default:
                console.error(`[SyncEngine] Unknown queue_type: ${item.queue_type}`);
                await queue.markFailed(item.idempotency_key, `Unknown queue_type: ${item.queue_type}`);
                return { networkError: false };
        }
    } catch (err) {
        // Unexpected exception from api method — treat as transient failure
        await queue.markFailed(item.idempotency_key, `Exception: ${err.message}`);
        return { networkError: false };
    }

    // ── Handle result ──────────────────────────────────────────

    // Network offline
    if (!result.ok && result.status === 0) {
        // Reset to PENDING (don't increment retry_count for network errors)
        await queue.markFailed(item.idempotency_key, 'Network unavailable');
        return { networkError: true };
    }

    // Success (200) or idempotent duplicate
    if (result.ok) {
        await queue.markSuccess(item.idempotency_key);
        _broadcastToClients({
            type:             'ITEM_SYNCED',
            queue_type:       item.queue_type,
            idempotency_key:  item.idempotency_key,
            was_duplicate:    result.data?.was_duplicate ?? false,
        });
        return { networkError: false };
    }

    // 409 Conflict (case state changed)
    if (result.status === HTTP_STATUS.CONFLICT && result.conflict) {
        await queue.markConflict(item.idempotency_key, result.currentState);
        _broadcastToClients({
            type:             'ITEM_CONFLICT',
            idempotency_key:  item.idempotency_key,
            case_id:          item.case_id,
            currentState:     result.currentState,
        });
        return { networkError: false };
    }

    // 400 Bad Request or 422 Invariant Violation — non-retryable
    if (result.status === HTTP_STATUS.BAD_REQUEST ||
        result.status === HTTP_STATUS.UNPROCESSABLE ||
        result.status === HTTP_STATUS.FORBIDDEN) {
        await queue.markFailed(item.idempotency_key,
            `Non-retryable error ${result.status}: ${result.error?.message}`);
        // Will be dead-lettered after max_retries if it keeps failing
        return { networkError: false };
    }

    // 5xx or 429 — retryable
    await queue.markFailed(item.idempotency_key,
        `Server error ${result.status}: ${result.error?.message}`);
    return { networkError: false };
}


// ─────────────────────────────────────────────────────────────
// DATA PULL HELPERS
// Each function fetches one category of data and writes to cache.
// All use Supabase PostgREST with the user's JWT for RLS.
// ─────────────────────────────────────────────────────────────

async function _pullSchedules(queue) {
    const token = await _getToken();
    const today = new Date().toISOString().slice(0, 10);
    const plus7 = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);

    // Use the v_offline_sync_manifest_guru view (defined in 07_indexes_views.sql)
    const url = `${_postgrestUrl}/v_offline_sync_manifest_guru` +
        `?scheduled_teacher_id=eq.${_currentUserId}` +
        `&session_date=gte.${today}` +
        `&session_date=lte.${plus7}` +
        `&order=session_date.asc`;

    const res  = await _pgFetch(url, token);
    const rows = await res.json();

    await queue.cacheSchedules(_currentUserId, today, rows);

    // Also cache substitute schedules for today
    await _pullSubstituteSchedules(queue, token, today);
}


async function _pullSubstituteSchedules(queue, token, today) {
    const url = `${_postgrestUrl}/v_offline_sync_manifest_substitute` +
        `?substitute_user_id=eq.${_currentUserId}` +
        `&session_date=eq.${today}`;

    const res  = await _pgFetch(url, token);
    const rows = await res.json();

    for (const row of rows) {
        await queue.cacheWrite(
            CACHE_KEY.SUBSTITUTE(row.schedule_id),
            'substitute',
            row,
            CACHE_TTL.SCHEDULES
        );
    }
}


async function _pullCases(queue) {
    const token = await _getToken();

    // Cases where current user is current_handler_role
    // RLS on `cases` table ensures only accessible cases are returned
    const url = `${_postgrestUrl}/cases` +
        `?current_handler_role=eq.${_currentUserRole}` +
        `&status=neq.CLOSED` +
        `&select=*,case_events(*)` +
        `&order=updated_at.desc` +
        `&limit=50`;

    const res   = await _pgFetch(url, token);
    const cases = await res.json();

    for (const c of cases) {
        await queue.cacheWrite(
            CACHE_KEY.CASE(c.case_id),
            'case',
            c,
            CACHE_TTL.CASES
        );
        await queue.cacheWrite(
            CACHE_KEY.CASE_EVENTS(c.case_id),
            'case_events',
            c.case_events ?? [],
            CACHE_TTL.CASES
        );
    }
}


async function _pullAssignments(queue) {
    const token = await _getToken();

    const url = `${_postgrestUrl}/teaching_assignments` +
        `?user_id=eq.${_currentUserId}` +
        `&is_active=eq.true`;

    const res  = await _pgFetch(url, token);
    const rows = await res.json();

    await queue.cacheWrite(
        CACHE_KEY.ASSIGNMENT_LIST(_currentUserId),
        'assignment_list',
        rows,
        CACHE_TTL.ASSIGNMENTS
    );
}


async function _pullUserProfile(queue) {
    const token = await _getToken();

    const url = `${_postgrestUrl}/users` +
        `?user_id=eq.${_currentUserId}` +
        `&select=user_id,full_name,role_type,wali_kelas_class_id,program_id,is_active`;

    const res   = await _pgFetch(url, token);
    const rows  = await res.json();
    const profile = rows[0] ?? null;

    if (profile) {
        await queue.cacheWrite(
            CACHE_KEY.USER_PROFILE(_currentUserId),
            'user_profile',
            profile,
            CACHE_TTL.USER_PROFILE
        );
    }
}


// ─────────────────────────────────────────────────────────────
// UTILITIES
// ─────────────────────────────────────────────────────────────

function _buildApi() {
    return new Api({
        baseUrl:  _functionsUrl,
        getToken: _getToken,
        onError: ({ endpoint, result }) => {
            console.error(`[SyncEngine] API error on ${endpoint}:`, result.error);
        },
    });
}

async function _pgFetch(url, token) {
    const res = await fetch(url, {
        headers: {
            'Authorization': `Bearer ${token}`,
            'apikey':         token,
            'Accept':        'application/json',
        },
    });
    if (!res.ok) {
        throw new Error(`PostgREST fetch failed: ${res.status} ${url}`);
    }
    return res;
}

function _broadcastToClients(message) {
    // Sends message to all open app windows
    // Available in Service Worker context
    if (typeof self !== 'undefined' && self.clients) {
        self.clients.matchAll({ includeUncontrolled: true }).then((clients) => {
            for (const client of clients) {
                client.postMessage({ source: 'sync_engine', ...message });
            }
        });
    }
}
