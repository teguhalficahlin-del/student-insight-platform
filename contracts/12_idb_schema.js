/**
 * @file idb_schema.js
 * @module IdbSchema
 * @version 1.0.0
 *
 * Single source of truth for all IndexedDB store definitions.
 * Import this everywhere IDB is opened — never open IDB directly
 * with a hardcoded version number or store name.
 *
 * UPGRADE RULE: bump IDB_VERSION and add a new case to upgradeDb()
 * for every schema change. Never modify existing cases.
 *
 * STORE INVENTORY:
 *
 *   offline_queue     — Category A operations waiting to be sent
 *   sync_cache        — read-only data for offline rendering
 *   conflict_queue    — items rejected by server due to state conflict
 *   sync_meta         — last_sync_at and schema metadata per store
 *   dead_letter       — items that exceeded max_retries or schema mismatch
 */

// ─────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────

export const IDB_NAME    = 'flaf_smk';
export const IDB_VERSION = 1;   // Bump on every schema change

export const STORE = Object.freeze({
    OFFLINE_QUEUE:   'offline_queue',
    SYNC_CACHE:      'sync_cache',
    CONFLICT_QUEUE:  'conflict_queue',
    SYNC_META:       'sync_meta',
    DEAD_LETTER:     'dead_letter',
});

// Cache TTL per data type (milliseconds)
export const CACHE_TTL = Object.freeze({
    SCHEDULES:    7 * 24 * 60 * 60 * 1000,   // 7 days
    STUDENTS:     7 * 24 * 60 * 60 * 1000,   // 7 days
    CASES:            24 * 60 * 60 * 1000,   // 1 day
    OBSERVATIONS:     24 * 60 * 60 * 1000,   // 1 day
    ASSIGNMENTS:   7 * 24 * 60 * 60 * 1000,  // 7 days
    ENROLLMENTS:   7 * 24 * 60 * 60 * 1000,  // 7 days
    USER_PROFILE:  7 * 24 * 60 * 60 * 1000,  // 7 days
});

// Max items allowed in each store (eviction guard for low-end devices)
export const STORE_MAX_ITEMS = Object.freeze({
    [STORE.OFFLINE_QUEUE]:  500,
    [STORE.SYNC_CACHE]:    2000,
    [STORE.CONFLICT_QUEUE]:  50,
    [STORE.DEAD_LETTER]:     100,
});

// Cache key prefixes — all cache keys must use these
export const CACHE_KEY = Object.freeze({
    SCHEDULE:       (id)          => `schedule:${id}`,
    SCHEDULE_LIST:  (teacherId, date) => `schedule_list:${teacherId}:${date}`,
    STUDENT:        (id)          => `student:${id}`,
    STUDENT_LIST:   (classId)     => `student_list:${classId}`,
    CASE:           (id)          => `case:${id}`,
    CASE_EVENTS:    (id)          => `case_events:${id}`,
    CASE_LIST:      (studentId)   => `case_list:${studentId}`,
    OBSERVATION_LIST:(studentId)  => `obs_list:${studentId}`,
    ASSIGNMENT_LIST: (userId)     => `assignment_list:${userId}`,
    ENROLLMENT_LIST: (classId)    => `enrollment_list:${classId}`,
    USER_PROFILE:   (userId)      => `user_profile:${userId}`,
    SUBSTITUTE:     (scheduleId)  => `substitute:${scheduleId}`,
});

// Sync meta keys
export const META_KEY = Object.freeze({
    LAST_SYNC:           (store) => `last_sync:${store}`,
    SCHEMA_VERSION:      'schema_version',
    USER_ID:             'user_id',
    LAST_FULL_SYNC:      'last_full_sync',
});


// ─────────────────────────────────────────────────────────────
// IDB OPEN + UPGRADE
// ─────────────────────────────────────────────────────────────

/**
 * Opens the IDB database. Creates/upgrades stores as needed.
 * Returns a Promise<IDBDatabase>.
 *
 * Usage:
 *   const db = await openIdb();
 *   const tx = db.transaction(STORE.OFFLINE_QUEUE, 'readwrite');
 */
export function openIdb() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(IDB_NAME, IDB_VERSION);

        request.onupgradeneeded = (event) => {
            upgradeDb(event.target.result, event.oldVersion, event.newVersion);
        };

        request.onsuccess  = (e) => resolve(e.target.result);
        request.onerror    = (e) => reject(new IdbError('Failed to open IDB', e.target.error));
        request.onblocked  = ()  => {
            // Another tab has the DB open with an older version.
            // This should not happen in production — we only have one tab at a time.
            // Log and reject so the caller can surface a "please close other tabs" message.
            reject(new IdbError('IDB upgrade blocked — close other tabs and reload'));
        };
    });
}


/**
 * Upgrade handler. Each version case is additive — never modify existing cases.
 * @param {IDBDatabase} db
 * @param {number} oldVersion
 * @param {number} newVersion
 */
function upgradeDb(db, oldVersion, newVersion) {
    // Version 0 → 1: initial schema
    if (oldVersion < 1) {
        _createV1Stores(db);
    }

    // Version 1 → 2 (future example):
    // if (oldVersion < 2) { _addV2Stores(db); }
}


function _createV1Stores(db) {
    // ── offline_queue ──────────────────────────────────────────
    // keyPath: idempotency_key (client-generated UUID per item)
    // Indexes:
    //   by_queue_type  — for processing a specific type first
    //   by_created_at  — for FIFO ordering within a type
    //   by_status      — for finding PENDING items efficiently
    const queueStore = db.createObjectStore(STORE.OFFLINE_QUEUE, {
        keyPath: 'idempotency_key',
    });
    queueStore.createIndex('by_queue_type',  'queue_type',      { unique: false });
    queueStore.createIndex('by_created_at',  'created_offline_at', { unique: false });
    queueStore.createIndex('by_status',      '_status',         { unique: false });
    // Compound index: process PENDING items in FIFO order per type
    queueStore.createIndex('by_type_status', ['queue_type', '_status'], { unique: false });

    // ── sync_cache ─────────────────────────────────────────────
    // keyPath: cache_key (namespaced string, e.g. "schedule:uuid")
    // Stores arbitrary JSON blobs with TTL metadata.
    const cacheStore = db.createObjectStore(STORE.SYNC_CACHE, {
        keyPath: 'cache_key',
    });
    cacheStore.createIndex('by_expires_at', 'expires_at', { unique: false });
    cacheStore.createIndex('by_type',       'data_type',  { unique: false });

    // ── conflict_queue ─────────────────────────────────────────
    // keyPath: idempotency_key (same as the original queue item)
    // Stores items that were rejected with 409 CONFLICT_CASE_STATE.
    // User must manually resolve these.
    const conflictStore = db.createObjectStore(STORE.CONFLICT_QUEUE, {
        keyPath: 'idempotency_key',
    });
    conflictStore.createIndex('by_case_id',     'case_id',    { unique: false });
    conflictStore.createIndex('by_created_at',  'created_offline_at', { unique: false });

    // ── sync_meta ──────────────────────────────────────────────
    // keyPath: meta_key (string)
    // Stores small metadata values: last_sync timestamps, schema version, user_id.
    db.createObjectStore(STORE.SYNC_META, {
        keyPath: 'meta_key',
    });

    // ── dead_letter ────────────────────────────────────────────
    // keyPath: idempotency_key
    // Items that exhausted max_retries or had schema mismatch.
    // Kept for debugging. Evicted after 30 days.
    const deadStore = db.createObjectStore(STORE.DEAD_LETTER, {
        keyPath: 'idempotency_key',
    });
    deadStore.createIndex('by_dead_at',    'dead_at',    { unique: false });
    deadStore.createIndex('by_queue_type', 'queue_type', { unique: false });
}


// ─────────────────────────────────────────────────────────────
// IDB TRANSACTION HELPER
// Wraps an IDB transaction in a Promise.
// Ensures commit/rollback are handled correctly.
//
// Usage:
//   const result = await idbTx(db, [STORE.OFFLINE_QUEUE], 'readwrite',
//     async (stores) => {
//       const item = await idbGet(stores.offline_queue, key);
//       return item;
//     }
//   );
// ─────────────────────────────────────────────────────────────

/**
 * @param {IDBDatabase} db
 * @param {string[]} storeNames
 * @param {'readonly'|'readwrite'} mode
 * @param {Function} fn  — async fn(stores: Object<storeName, IDBObjectStore>)
 * @returns {Promise<any>}
 */
export function idbTx(db, storeNames, mode, fn) {
    return new Promise((resolve, reject) => {
        const tx     = db.transaction(storeNames, mode);
        const stores = {};
        for (const name of storeNames) {
            stores[name] = tx.objectStore(name);
        }

        let result;
        let fnError;

        // Run the user function; capture result or error
        Promise.resolve()
            .then(() => fn(stores))
            .then((r) => { result = r; })
            .catch((e) => { fnError = e; tx.abort(); });

        tx.oncomplete = () => {
            if (fnError) reject(fnError);
            else resolve(result);
        };

        tx.onerror = (e) => {
            reject(new IdbError('Transaction error', e.target.error));
        };

        tx.onabort = (e) => {
            if (fnError) reject(fnError);
            else reject(new IdbError('Transaction aborted', e.target.error));
        };
    });
}


// ─────────────────────────────────────────────────────────────
// IDB PRIMITIVE OPERATIONS
// Promisified wrappers for IDBObjectStore methods.
// Always use these — never use raw IDB request callbacks.
// ─────────────────────────────────────────────────────────────

export function idbGet(store, key) {
    return new Promise((resolve, reject) => {
        const req   = store.get(key);
        req.onsuccess = (e) => resolve(e.target.result ?? null);
        req.onerror   = (e) => reject(new IdbError('idbGet failed', e.target.error));
    });
}

export function idbPut(store, value) {
    return new Promise((resolve, reject) => {
        const req   = store.put(value);
        req.onsuccess = (e) => resolve(e.target.result);
        req.onerror   = (e) => reject(new IdbError('idbPut failed', e.target.error));
    });
}

export function idbDelete(store, key) {
    return new Promise((resolve, reject) => {
        const req   = store.delete(key);
        req.onsuccess = ()  => resolve();
        req.onerror   = (e) => reject(new IdbError('idbDelete failed', e.target.error));
    });
}

export function idbGetAll(store, indexName = null, query = null) {
    return new Promise((resolve, reject) => {
        const target = indexName ? store.index(indexName) : store;
        const req    = query ? target.getAll(query) : target.getAll();
        req.onsuccess = (e) => resolve(e.target.result ?? []);
        req.onerror   = (e) => reject(new IdbError('idbGetAll failed', e.target.error));
    });
}

export function idbCount(store, indexName = null, query = null) {
    return new Promise((resolve, reject) => {
        const target = indexName ? store.index(indexName) : store;
        const req    = query ? target.count(query) : target.count();
        req.onsuccess = (e) => resolve(e.target.result);
        req.onerror   = (e) => reject(new IdbError('idbCount failed', e.target.error));
    });
}


// ─────────────────────────────────────────────────────────────
// CACHE HELPERS
// ─────────────────────────────────────────────────────────────

/**
 * Writes a value to sync_cache with TTL.
 * @param {IDBObjectStore} cacheStore
 * @param {string} cacheKey
 * @param {string} dataType       — e.g. 'schedule', 'student'
 * @param {any}    data
 * @param {number} ttlMs          — milliseconds from now
 */
export function cacheWrite(cacheStore, cacheKey, dataType, data, ttlMs) {
    const now = Date.now();
    return idbPut(cacheStore, {
        cache_key:  cacheKey,
        data_type:  dataType,
        data,
        cached_at:  new Date(now).toISOString(),
        expires_at: new Date(now + ttlMs).toISOString(),
    });
}

/**
 * Reads from sync_cache. Returns null if not found or expired.
 * @param {IDBObjectStore} cacheStore
 * @param {string} cacheKey
 * @returns {Promise<any|null>}
 */
export async function cacheRead(cacheStore, cacheKey) {
    const entry = await idbGet(cacheStore, cacheKey);
    if (!entry) return null;
    if (new Date(entry.expires_at) <= new Date()) return null; // expired
    return entry.data;
}

/**
 * Evicts all expired entries from sync_cache.
 * Call during idle time or before writing new entries if storage is low.
 * @param {IDBObjectStore} cacheStore
 * @returns {Promise<number>} number of entries evicted
 */
export async function cacheEvictExpired(cacheStore) {
    const now   = new Date().toISOString();
    const range = IDBKeyRange.upperBound(now);
    const all   = await idbGetAll(cacheStore, 'by_expires_at', range);
    for (const entry of all) {
        await idbDelete(cacheStore, entry.cache_key);
    }
    return all.length;
}


// ─────────────────────────────────────────────────────────────
// ERROR CLASS
// ─────────────────────────────────────────────────────────────

export class IdbError extends Error {
    constructor(message, cause = null) {
        super(message);
        this.name    = 'IdbError';
        this.cause   = cause;
        this.message = cause
            ? `${message}: ${cause.message ?? String(cause)}`
            : message;
    }
}
