/**
 * @file guru/js/offline.js
 * Lapisan offline untuk absensi, observasi, dan jurnal mengajar guru.
 *
 * Prinsip:
 *   - Satu jalur idempoten per fitur: edge function sync-* (aman dikirim ulang).
 *   - Online-first: coba kirim; kalau JARINGAN gagal → antrikan ke
 *     IndexedDB + status jujur "Menunggu sinkron" (bukan "Tersimpan").
 *   - Penolakan nyata server (400/403) TIDAK diantrikan — tampilkan error.
 *   - Flush otomatis saat halaman dibuka & saat koneksi kembali ('online').
 *
 * Tidak memakai Background Sync API (butuh SW) demi keandalan v1.
 */

import { supabase as _supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from './api.js';

const DB_NAME    = 'smkhr-guru-offline';
const STORE_ATT  = 'att_queue';
const STORE_OBS  = 'obs_queue';
const STORE_JRN  = 'jrn_queue';
const STORE_CASE = 'case_queue';

// Versi schema antrian. Naikkan saat format payload berubah secara breaking.
// Item lama dengan versi berbeda akan di-discard (bukan dikirim) saat flush.
// Item tanpa tag (dari sebelum LF-8) dianggap kompatibel dengan versi saat ini.
const OFFLINE_SCHEMA_VER = 'v2';

// Alias lama untuk kompatibilitas mundur dengan kode yang sudah ada
const STORE = STORE_ATT;

// ── IndexedDB helpers ─────────────────────────────────────────
function openDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 3); // v3 tambah case_queue
        req.onupgradeneeded = (e) => {
            const db = req.result;
            if (!db.objectStoreNames.contains(STORE_ATT)) {
                db.createObjectStore(STORE_ATT, { keyPath: 'idempotency_key' });
            }
            if (!db.objectStoreNames.contains(STORE_OBS)) {
                db.createObjectStore(STORE_OBS, { keyPath: 'idempotency_key' });
            }
            if (!db.objectStoreNames.contains(STORE_JRN)) {
                db.createObjectStore(STORE_JRN, { keyPath: 'idempotency_key' });
            }
            if (!db.objectStoreNames.contains(STORE_CASE)) {
                db.createObjectStore(STORE_CASE, { keyPath: 'idempotency_key' });
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror   = () => reject(req.error);
    });
}
function txStore(db, storeName, mode) { return db.transaction(storeName, mode).objectStore(storeName); }
// Alias lama (absensi tetap pakai STORE_ATT)
function tx(db, mode) { return txStore(db, STORE_ATT, mode); }

async function idbPutTo(storeName, item) {
    const db = await openDB();
    return new Promise((res, rej) => {
        const t = txStore(db, storeName, 'readwrite').put(item);
        t.onsuccess = () => res(); t.onerror = () => rej(t.error);
    });
}
async function idbGetAllFrom(storeName) {
    const db = await openDB();
    return new Promise((res, rej) => {
        const t = txStore(db, storeName, 'readonly').getAll();
        t.onsuccess = () => res(t.result ?? []); t.onerror = () => rej(t.error);
    });
}
async function idbDeleteFrom(storeName, key) {
    const db = await openDB();
    return new Promise((res, rej) => {
        const t = txStore(db, storeName, 'readwrite').delete(key);
        t.onsuccess = () => res(); t.onerror = () => rej(t.error);
    });
}

// Wrappers lama untuk absensi (kompatibilitas mundur)
async function idbPut(batch)       { return idbPutTo(STORE_ATT, batch); }
async function idbGetAll()         { return idbGetAllFrom(STORE_ATT); }
async function idbDelete(key)      { return idbDeleteFrom(STORE_ATT, key); }

// Buang batch absensi tertunda untuk sesi yang SAMA (schedule_id + session_date).
// Absensi = snapshot satu sesi utuh → simpan-ulang harus MENGGANTIKAN, bukan
// menumpuk. Tanpa ini, dua batch sesi sama bisa flush di urutan acak (kunci =
// UUID) dan batch basi menimpa yang terkoreksi → koreksi hilang senyap (E1-1).
async function idbPurgeAttSession(scheduleId, sessionDate) {
    const all = await idbGetAllFrom(STORE_ATT);
    for (const b of all) {
        if (b.schedule_id === scheduleId && b.session_date === sessionDate) {
            await idbDeleteFrom(STORE_ATT, b.idempotency_key);
        }
    }
}

// ── Helper: ambil token JWT ────────────────────────────────────
async function getToken() {
    const { data: sess } = await _supabase.auth.getSession();
    return sess?.session?.access_token ?? null;
}

// ── Helper: POST ke edge function ─────────────────────────────
// return { ok, networkError, wasDuplicate, status, error }
async function postEdgeFn(path, payload) {
    const token = await getToken();
    if (!token) return { ok: false, networkError: false, status: 401, error: 'Sesi tidak valid' };
    let res;
    try {
        res = await fetch(`${SUPABASE_URL}/functions/v1/${path}`, {
            method:  'POST',
            headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body:    JSON.stringify(payload),
        });
    } catch (e) {
        return { ok: false, networkError: true, error: String(e) };
    }
    const json = await res.json().catch(() => ({}));
    if (res.ok) return { ok: true, wasDuplicate: json?.data?.was_duplicate ?? false };
    return { ok: false, networkError: false, status: res.status, error: json?.error?.message ?? `HTTP ${res.status}` };
}

// ── Kirim satu batch absensi ke server ───────────────────────
async function submitBatch(batch) {
    return postEdgeFn('sync-attendance-batch', batch);
}

// ── Kirim satu observasi ke server ────────────────────────────
async function submitObservation(obs) {
    return postEdgeFn('sync-observation', obs);
}

// ── Kirim satu jurnal ke server ───────────────────────────────
async function submitJournal(jrn) {
    return postEdgeFn('sync-journal', jrn);
}

// ── Kirim satu kasus ke server ────────────────────────────────
async function submitCase(cs) {
    return postEdgeFn('sync-case', cs);
}

// ── Helper flush untuk satu store ────────────────────────────
async function flushStore(storeName, submitFn) {
    const pending = await idbGetAllFrom(storeName);
    if (pending.length === 0) return { synced: 0, remaining: 0 };
    if (!navigator.onLine)    return { synced: 0, remaining: pending.length };

    let synced = 0;
    for (const item of pending) {
        // Item dengan versi schema eksplisit yang berbeda → discard, jangan kirim
        if (item._schema_ver && item._schema_ver !== OFFLINE_SCHEMA_VER) {
            console.warn('[offline] discard item schema lama:', item.idempotency_key, item._schema_ver);
            await idbDeleteFrom(storeName, item.idempotency_key);
            synced++;
            continue;
        }
        const r = await submitFn(item);
        if (r.ok) { await idbDeleteFrom(storeName, item.idempotency_key); synced++; }
        else if (r.status === 401) {
            // Token habis — antrian dipertahankan, hentikan flush, minta login ulang
            console.warn('[offline] sesi habis, antrian ditahan sampai login ulang');
            const remaining = (await idbGetAllFrom(storeName)).length;
            return { synced, remaining, sessionExpired: true };
        }
        else if (!r.networkError) {
            console.warn(`[offline][${storeName}] ditolak server, dibuang:`, item.idempotency_key, r.error);
            await idbDeleteFrom(storeName, item.idempotency_key); synced++;
        } else break;
    }
    const remaining = (await idbGetAllFrom(storeName)).length;
    return { synced, remaining };
}

// ── API publik ────────────────────────────────────────────────

/**
 * Simpan satu batch absensi (satu sesi). Online-first, antre bila offline.
 * @returns {{status:'synced'|'queued'|'error', error?:string}}
 */
export async function saveAttendanceBatch(batch) {
    if (navigator.onLine) {
        const r = await submitBatch(batch);
        if (r.ok) return { status: 'synced' };
        if (!r.networkError) return { status: 'error', error: r.error };
    }
    // Supersede: hapus batch tertunda untuk sesi yang sama sebelum antre yang baru,
    // agar hanya ada satu snapshot per sesi (cegah koreksi hilang, E1-1).
    await idbPurgeAttSession(batch.schedule_id, batch.session_date);
    await idbPut({ ...batch, _schema_ver: OFFLINE_SCHEMA_VER });
    return { status: 'queued' };
}

/**
 * Simpan satu observasi siswa. Online-first, antre bila offline.
 * obs harus berisi idempotency_key (UUID v4 buat oleh pemanggil).
 * @returns {{status:'synced'|'queued'|'error', error?:string}}
 */
export async function saveObservation(obs) {
    if (navigator.onLine) {
        const r = await submitObservation(obs);
        if (r.ok) return { status: 'synced' };
        if (!r.networkError) return { status: 'error', error: r.error };
    }
    await idbPutTo(STORE_OBS, { ...obs, _schema_ver: OFFLINE_SCHEMA_VER });
    return { status: 'queued' };
}

/**
 * Simpan satu entri jurnal mengajar. Online-first, antre bila offline.
 * jrn harus berisi idempotency_key (UUID v4 buat oleh pemanggil).
 * @returns {{status:'synced'|'queued'|'error', error?:string}}
 */
export async function saveJournalEntry(jrn) {
    if (navigator.onLine) {
        const r = await submitJournal(jrn);
        if (r.ok) return { status: 'synced' };
        if (!r.networkError) return { status: 'error', error: r.error };
    }
    await idbPutTo(STORE_JRN, { ...jrn, _schema_ver: OFFLINE_SCHEMA_VER });
    return { status: 'queued' };
}

/**
 * Simpan satu kasus baru. Online-first, antre bila offline.
 * cs harus berisi idempotency_key + case_id (UUID v4 dibuat pemanggil).
 * @returns {{status:'synced'|'queued'|'error', case_id?:string, error?:string}}
 */
export async function saveCase(cs) {
    if (navigator.onLine) {
        const r = await submitCase(cs);
        if (r.ok) return { status: 'synced', case_id: cs.case_id };
        if (!r.networkError) return { status: 'error', error: r.error };
    }
    await idbPutTo(STORE_CASE, { ...cs, _schema_ver: OFFLINE_SCHEMA_VER });
    return { status: 'queued', case_id: cs.case_id };
}

/**
 * Kirim semua item tertunda (absensi + observasi + jurnal).
 * @returns {{synced:number, remaining:number}}
 */
export async function flushPending() {
    const [att, obs, jrn, cas] = await Promise.all([
        flushStore(STORE_ATT,  submitBatch),
        flushStore(STORE_OBS,  submitObservation),
        flushStore(STORE_JRN,  submitJournal),
        flushStore(STORE_CASE, submitCase),
    ]);
    return {
        synced:         att.synced    + obs.synced    + jrn.synced    + cas.synced,
        remaining:      att.remaining + obs.remaining + jrn.remaining + cas.remaining,
        sessionExpired: !!(att.sessionExpired || obs.sessionExpired || jrn.sessionExpired || cas.sessionExpired),
    };
}

/**
 * Hapus semua antrian offline (absensi + observasi + jurnal).
 * Dipanggil saat logout agar data sensitif tidak tertinggal di perangkat.
 */
export async function clearOfflineQueue() {
    const db = await openDB();
    await Promise.all([STORE_ATT, STORE_OBS, STORE_JRN, STORE_CASE].map(store =>
        new Promise((res, rej) => {
            const t = txStore(db, store, 'readwrite').clear();
            t.onsuccess = () => res(); t.onerror = () => rej(t.error);
        })
    ));
    console.log('[offline] antrian dibersihkan saat logout');
}

export async function pendingCount() {
    const [att, obs, jrn, cas] = await Promise.all([
        idbGetAllFrom(STORE_ATT),
        idbGetAllFrom(STORE_OBS),
        idbGetAllFrom(STORE_JRN),
        idbGetAllFrom(STORE_CASE),
    ]);
    return att.length + obs.length + jrn.length + cas.length;
}
