/**
 * @file offline_queue.js
 * @module OfflineQueue
 * @version 1.0.0
 *
 * Manages the offline operation queue stored in IndexedDB.
 * Used by BOTH the main thread (enqueue) and Service Worker (dequeue/process).
 *
 * QUEUE ITEM LIFECYCLE:
 *
 *   [User Action]
 *       ↓ enqueue()
 *   PENDING  ──→  PROCESSING  ──→  DONE (deleted from queue)
 *                     │
 *                     ├──→  FAILED (retry_count < max_retries → back to PENDING)
 *                     ├──→  CONFLICT (server returned 409 → conflict_queue)
 *                     └──→  DEAD (retry_count >= max_retries → dead_letter)
 *
 * ITEM STATUS VALUES (_status field):
 *   PENDING     — waiting to be sent
 *   PROCESSING  — currently being sent (lock against double-processing)
 *   FAILED      — last attempt failed, will retry
 *
 * PROCESSING LOCK:
 *   When a SW picks up an item, it sets _status = PROCESSING.
 *   If SW dies mid-sync, a watchdog resets stale PROCESSING items
 *   (items in PROCESSING for > PROCESSING_TIMEOUT_MS) back to PENDING.
 */

import {
    STORE,
    STORE_MAX_ITEMS,
    CACHE_KEY,
    CACHE_TTL,
    META_KEY,
    openIdb,
    idbTx,
    idbGet,
    idbPut,
    idbDelete,
    idbGetAll,
    idbCount,
    cacheWrite,
    cacheRead,
    cacheEvictExpired,
    IdbError,
} from './12_idb_schema.js';

import { SCHEMA_VERSION, OFFLINE_QUEUE_TYPES } from './09_event_schema.js';


// ─────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────

export const QUEUE_STATUS = Object.freeze({
    PENDING:    'PENDING',
    PROCESSING: 'PROCESSING',
    FAILED:     'FAILED',
});

// Items stuck in PROCESSING for longer than this are considered stale
// (Service Worker died mid-sync). Reset to PENDING by watchdog.
const PROCESSING_TIMEOUT_MS = 60 * 1000; // 60 seconds

// Processing order by queue_type priority
// Lower index = processed first
const PROCESSING_ORDER = [
    OFFLINE_QUEUE_TYPES.ATTENDANCE_BATCH,    // highest — time-sensitive
    OFFLINE_QUEUE_TYPES.CASE_CREATE,
    OFFLINE_QUEUE_TYPES.CASE_EVENT_CREATE,
    OFFLINE_QUEUE_TYPES.OBSERVATION_CREATE,
    OFFLINE_QUEUE_TYPES.JOURNAL_CREATE,      // lowest — purely private
];


// ─────────────────────────────────────────────────────────────
// QUEUE MANAGER CLASS
// ─────────────────────────────────────────────────────────────

export class OfflineQueue {
    /**
     * @param {IDBDatabase} db — opened IDB instance
     */
    constructor(db) {
        if (!db) throw new Error('OfflineQueue: db is required');
        this._db = db;
    }

    /** Factory: opens IDB and returns an OfflineQueue instance. */
    static async open() {
        const db = await openIdb();
        return new OfflineQueue(db);
    }


    // ─────────────────────────────────────────────────────────
    // ENQUEUE
    // Called by main thread when user performs a Category A action.
    //
    // The item must already be validated by buildOfflineQueueItem()
    // from event_schema.js before calling enqueue().
    //
    // Guards:
    //   1. Duplicate idempotency_key → silently ignore (already queued)
    //   2. Queue full → evict oldest FAILED items, then retry
    //   3. Schema version mismatch → reject (should not happen in practice)
    // ─────────────────────────────────────────────────────────

    async enqueue(item) {
        _assertValidQueueItem(item);

        return idbTx(this._db, [STORE.OFFLINE_QUEUE], 'readwrite', async (stores) => {
            const queue = stores[STORE.OFFLINE_QUEUE];

            // Guard 1: duplicate
            const existing = await idbGet(queue, item.idempotency_key);
            if (existing) {
                return { enqueued: false, reason: 'DUPLICATE', idempotency_key: item.idempotency_key };
            }

            // Guard 2: queue capacity
            const count = await idbCount(queue);
            if (count >= STORE_MAX_ITEMS[STORE.OFFLINE_QUEUE]) {
                await _evictOldestFailed(queue);
                const countAfter = await idbCount(queue);
                if (countAfter >= STORE_MAX_ITEMS[STORE.OFFLINE_QUEUE]) {
                    throw new IdbError(
                        `Queue at capacity (${STORE_MAX_ITEMS[STORE.OFFLINE_QUEUE]} items). ` +
                        'Clear pending items before adding more.'
                    );
                }
            }

            // Stamp with queue metadata
            const record = {
                ...item,
                _status:        QUEUE_STATUS.PENDING,
                _enqueued_at:   new Date().toISOString(),
                _processing_at: null,
                _last_error:    null,
            };

            await idbPut(queue, record);
            return { enqueued: true, idempotency_key: item.idempotency_key };
        });
    }


    // ─────────────────────────────────────────────────────────
    // DEQUEUE BATCH
    // Called by Service Worker during sync.
    // Returns up to `limit` PENDING items in priority order.
    // Atomically marks them as PROCESSING to prevent double-processing.
    //
    // Items are returned in PROCESSING_ORDER priority, then FIFO within
    // each type.
    // ─────────────────────────────────────────────────────────

    async dequeueBatch(limit = 10) {
        return idbTx(this._db, [STORE.OFFLINE_QUEUE], 'readwrite', async (stores) => {
            const queue   = stores[STORE.OFFLINE_QUEUE];
            const pending = await idbGetAll(queue, 'by_status', QUEUE_STATUS.PENDING);

            // Sort by priority order then by created_offline_at (FIFO)
            pending.sort((a, b) => {
                const pa = PROCESSING_ORDER.indexOf(a.queue_type);
                const pb = PROCESSING_ORDER.indexOf(b.queue_type);
                const priorityDiff = (pa === -1 ? 99 : pa) - (pb === -1 ? 99 : pb);
                if (priorityDiff !== 0) return priorityDiff;
                return a.created_offline_at < b.created_offline_at ? -1 : 1;
            });

            const batch = pending.slice(0, limit);

            // Mark as PROCESSING
            const now = new Date().toISOString();
            for (const item of batch) {
                await idbPut(queue, {
                    ...item,
                    _status:        QUEUE_STATUS.PROCESSING,
                    _processing_at: now,
                });
            }

            return batch;
        });
    }


    // ─────────────────────────────────────────────────────────
    // MARK SUCCESS
    // Called after API returns 200. Removes item from queue.
    // ─────────────────────────────────────────────────────────

    async markSuccess(idempotencyKey) {
        return idbTx(this._db, [STORE.OFFLINE_QUEUE], 'readwrite', async (stores) => {
            await idbDelete(stores[STORE.OFFLINE_QUEUE], idempotencyKey);
            return { removed: true };
        });
    }


    // ─────────────────────────────────────────────────────────
    // MARK FAILED
    // Called after a retryable error (network, 5xx).
    // Increments retry_count and resets to PENDING if below max_retries.
    // Moves to dead_letter if max_retries exceeded.
    // ─────────────────────────────────────────────────────────

    async markFailed(idempotencyKey, errorSummary) {
        return idbTx(
            this._db,
            [STORE.OFFLINE_QUEUE, STORE.DEAD_LETTER],
            'readwrite',
            async (stores) => {
                const queue  = stores[STORE.OFFLINE_QUEUE];
                const dead   = stores[STORE.DEAD_LETTER];

                const item = await idbGet(queue, idempotencyKey);
                if (!item) return { action: 'NOT_FOUND' };

                const newRetryCount = (item.retry_count ?? 0) + 1;

                if (newRetryCount >= item.max_retries) {
                    // Move to dead_letter
                    await idbPut(dead, {
                        ...item,
                        retry_count:   newRetryCount,
                        _status:       'DEAD',
                        dead_at:       new Date().toISOString(),
                        _death_reason: errorSummary,
                    });
                    await idbDelete(queue, idempotencyKey);
                    return { action: 'DEAD_LETTERED', retry_count: newRetryCount };
                }

                // Reset to PENDING for retry
                await idbPut(queue, {
                    ...item,
                    retry_count:    newRetryCount,
                    _status:        QUEUE_STATUS.PENDING,
                    _processing_at: null,
                    _last_error:    errorSummary,
                });

                return { action: 'RETRYING', retry_count: newRetryCount };
            }
        );
    }


    // ─────────────────────────────────────────────────────────
    // MARK CONFLICT
    // Called when server returns 409 CONFLICT_CASE_STATE.
    // Moves item to conflict_queue. User must resolve manually.
    // ─────────────────────────────────────────────────────────

    async markConflict(idempotencyKey, serverCurrentState) {
        return idbTx(
            this._db,
            [STORE.OFFLINE_QUEUE, STORE.CONFLICT_QUEUE],
            'readwrite',
            async (stores) => {
                const queue    = stores[STORE.OFFLINE_QUEUE];
                const conflict = stores[STORE.CONFLICT_QUEUE];

                const item = await idbGet(queue, idempotencyKey);
                if (!item) return { action: 'NOT_FOUND' };

                await idbPut(conflict, {
                    ...item,
                    _status:              'CONFLICT',
                    _conflict_at:         new Date().toISOString(),
                    _server_current_state: serverCurrentState,
                });
                await idbDelete(queue, idempotencyKey);

                return { action: 'MOVED_TO_CONFLICT' };
            }
        );
    }


    // ─────────────────────────────────────────────────────────
    // RESOLVE CONFLICT
    // Called when user chooses to discard a conflicted item.
    // ─────────────────────────────────────────────────────────

    async resolveConflict(idempotencyKey, resolution) {
        if (!['DISCARD', 'REQUEUE'].includes(resolution)) {
            throw new Error(`Invalid resolution: '${resolution}'. Must be DISCARD or REQUEUE.`);
        }

        return idbTx(
            this._db,
            [STORE.OFFLINE_QUEUE, STORE.CONFLICT_QUEUE],
            'readwrite',
            async (stores) => {
                const queue    = stores[STORE.OFFLINE_QUEUE];
                const conflict = stores[STORE.CONFLICT_QUEUE];

                const item = await idbGet(conflict, idempotencyKey);
                if (!item) return { action: 'NOT_FOUND' };

                if (resolution === 'DISCARD') {
                    await idbDelete(conflict, idempotencyKey);
                    return { action: 'DISCARDED' };
                }

                // REQUEUE: put back with reset retry_count and PENDING status
                // Caller must have updated the payload to reflect current server state
                const newItem = {
                    ...item,
                    retry_count:    0,
                    _status:        QUEUE_STATUS.PENDING,
                    _processing_at: null,
                    _last_error:    null,
                    _conflict_at:   null,
                    _server_current_state: null,
                };
                await idbDelete(conflict, idempotencyKey);
                await idbPut(queue, newItem);
                return { action: 'REQUEUED' };
            }
        );
    }


    // ─────────────────────────────────────────────────────────
    // WATCHDOG: Reset stale PROCESSING items
    // Items that have been in PROCESSING for > PROCESSING_TIMEOUT_MS
    // are assumed to have been abandoned by a dead SW. Reset to PENDING.
    // Call at the start of every sync cycle.
    // ─────────────────────────────────────────────────────────

    async resetStaleProcessing() {
        const cutoff = new Date(Date.now() - PROCESSING_TIMEOUT_MS).toISOString();

        return idbTx(this._db, [STORE.OFFLINE_QUEUE], 'readwrite', async (stores) => {
            const queue      = stores[STORE.OFFLINE_QUEUE];
            const processing = await idbGetAll(queue, 'by_status', QUEUE_STATUS.PROCESSING);
            const stale      = processing.filter(
                item => item._processing_at && item._processing_at < cutoff
            );

            for (const item of stale) {
                await idbPut(queue, {
                    ...item,
                    _status:        QUEUE_STATUS.PENDING,
                    _processing_at: null,
                    _last_error:    `Stale processing reset at ${new Date().toISOString()}`,
                });
            }

            return { reset: stale.length };
        });
    }


    // ─────────────────────────────────────────────────────────
    // QUEUE STATUS SUMMARY
    // Returns count of items in each status.
    // Used by main thread to show sync indicator in UI.
    // ─────────────────────────────────────────────────────────

    async getQueueSummary() {
        const [allQueue, allConflict, allDead] = await Promise.all([
            idbTx(this._db, [STORE.OFFLINE_QUEUE], 'readonly',
                (s) => idbGetAll(s[STORE.OFFLINE_QUEUE])),
            idbTx(this._db, [STORE.CONFLICT_QUEUE], 'readonly',
                (s) => idbGetAll(s[STORE.CONFLICT_QUEUE])),
            idbTx(this._db, [STORE.DEAD_LETTER], 'readonly',
                (s) => idbGetAll(s[STORE.DEAD_LETTER])),
        ]);

        const byStatus = { PENDING: 0, PROCESSING: 0, FAILED: 0 };
        for (const item of allQueue) {
            byStatus[item._status] = (byStatus[item._status] ?? 0) + 1;
        }

        return {
            pending:   byStatus.PENDING,
            processing:byStatus.PROCESSING,
            failed:    byStatus.FAILED,
            conflict:  allConflict.length,
            dead:      allDead.length,
            total:     allQueue.length,
        };
    }


    // ─────────────────────────────────────────────────────────
    // CACHE: Write data to sync_cache
    // ─────────────────────────────────────────────────────────

    async cacheWrite(cacheKey, dataType, data, ttlMs) {
        return idbTx(this._db, [STORE.SYNC_CACHE], 'readwrite', (stores) =>
            cacheWrite(stores[STORE.SYNC_CACHE], cacheKey, dataType, data, ttlMs)
        );
    }


    // ─────────────────────────────────────────────────────────
    // CACHE: Read data from sync_cache
    // Returns null if not found or expired.
    // ─────────────────────────────────────────────────────────

    async cacheRead(cacheKey) {
        return idbTx(this._db, [STORE.SYNC_CACHE], 'readonly', (stores) =>
            cacheRead(stores[STORE.SYNC_CACHE], cacheKey)
        );
    }


    // ─────────────────────────────────────────────────────────
    // CACHE: Write sync_cache entries from server fetch response
    // Convenience method for caching a full schedule list
    // plus individual schedule entries in one transaction.
    // ─────────────────────────────────────────────────────────

    async cacheSchedules(teacherId, date, schedules) {
        return idbTx(this._db, [STORE.SYNC_CACHE], 'readwrite', async (stores) => {
            const store = stores[STORE.SYNC_CACHE];
            const ttl   = CACHE_TTL.SCHEDULES;

            // Write the list
            await cacheWrite(store,
                CACHE_KEY.SCHEDULE_LIST(teacherId, date),
                'schedule_list',
                schedules,
                ttl
            );

            // Write individual entries
            for (const schedule of schedules) {
                await cacheWrite(store,
                    CACHE_KEY.SCHEDULE(schedule.schedule_id),
                    'schedule',
                    schedule,
                    ttl
                );

                // Cache enrolled students per schedule
                if (schedule.students_json) {
                    await cacheWrite(store,
                        CACHE_KEY.STUDENT_LIST(schedule.class_id),
                        'student_list',
                        schedule.students_json,
                        ttl
                    );
                }
            }
        });
    }


    // ─────────────────────────────────────────────────────────
    // SYNC META: Read/write sync metadata
    // ─────────────────────────────────────────────────────────

    async getMeta(metaKey) {
        const result = await idbTx(this._db, [STORE.SYNC_META], 'readonly',
            (s) => idbGet(s[STORE.SYNC_META], metaKey)
        );
        return result?.value ?? null;
    }

    async setMeta(metaKey, value) {
        return idbTx(this._db, [STORE.SYNC_META], 'readwrite',
            (s) => idbPut(s[STORE.SYNC_META], { meta_key: metaKey, value })
        );
    }


    // ─────────────────────────────────────────────────────────
    // SCHEMA VERSION GUARD
    // Call on app start. If stored schema version differs from
    // current SCHEMA_VERSION (major), clear all queues and force re-sync.
    // ─────────────────────────────────────────────────────────

    async checkSchemaVersion() {
        const stored = await this.getMeta(META_KEY.SCHEMA_VERSION);

        if (!stored) {
            // First run
            await this.setMeta(META_KEY.SCHEMA_VERSION, SCHEMA_VERSION);
            return { action: 'INITIALIZED', version: SCHEMA_VERSION };
        }

        const storedMajor  = parseInt(stored.split('.')[0], 10);
        const currentMajor = parseInt(SCHEMA_VERSION.split('.')[0], 10);

        if (storedMajor !== currentMajor) {
            // Major version mismatch — clear queues (items are incompatible)
            await this._clearQueuesForMigration();
            await this.setMeta(META_KEY.SCHEMA_VERSION, SCHEMA_VERSION);
            return {
                action:  'MAJOR_VERSION_MIGRATION',
                from:    stored,
                to:      SCHEMA_VERSION,
                warning: 'Offline queue cleared due to breaking schema change.',
            };
        }

        return { action: 'OK', version: stored };
    }

    async _clearQueuesForMigration() {
        // Clear offline_queue and conflict_queue.
        // dead_letter is preserved for debugging.
        // sync_cache is preserved (data format unchanged for minor/major version).
        for (const storeName of [STORE.OFFLINE_QUEUE, STORE.CONFLICT_QUEUE]) {
            await idbTx(this._db, [storeName], 'readwrite', (stores) =>
                new Promise((resolve, reject) => {
                    const req = stores[storeName].clear();
                    req.onsuccess = resolve;
                    req.onerror   = (e) => reject(new IdbError('Clear failed', e.target.error));
                })
            );
        }
    }


    // ─────────────────────────────────────────────────────────
    // MAINTENANCE: Evict expired cache entries
    // Call during idle time or when storage estimate exceeds threshold.
    // ─────────────────────────────────────────────────────────

    async evictExpiredCache() {
        return idbTx(this._db, [STORE.SYNC_CACHE], 'readwrite',
            (s) => cacheEvictExpired(s[STORE.SYNC_CACHE])
        );
    }


    // ─────────────────────────────────────────────────────────
    // STORAGE ESTIMATE
    // Uses StorageManager API (available in modern browsers).
    // Returns { usageBytes, quotaBytes, usagePercent }.
    // ─────────────────────────────────────────────────────────

    static async storageEstimate() {
        if (!navigator?.storage?.estimate) {
            return { usageBytes: null, quotaBytes: null, usagePercent: null };
        }
        const { usage, quota } = await navigator.storage.estimate();
        return {
            usageBytes:    usage,
            quotaBytes:    quota,
            usagePercent:  quota > 0 ? Math.round((usage / quota) * 100) : null,
        };
    }
}


// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────

function _assertValidQueueItem(item) {
    if (!item || typeof item !== 'object') {
        throw new Error('Queue item must be a non-null object');
    }
    if (!item.idempotency_key || typeof item.idempotency_key !== 'string') {
        throw new Error('Queue item must have a valid idempotency_key string');
    }
    if (!item.queue_type || !Object.values(OFFLINE_QUEUE_TYPES).includes(item.queue_type)) {
        throw new Error(`Queue item has invalid queue_type: '${item.queue_type}'`);
    }
    if (!item.schema_version) {
        throw new Error('Queue item must have schema_version');
    }
}

async function _evictOldestFailed(queueStore) {
    // Evict FAILED items oldest-first to make room
    const failed = await idbGetAll(queueStore, 'by_status', QUEUE_STATUS.FAILED);
    failed.sort((a, b) => (a.created_offline_at < b.created_offline_at ? -1 : 1));
    const toEvict = failed.slice(0, 50);
    for (const item of toEvict) {
        await idbDelete(queueStore, item.idempotency_key);
    }
}
