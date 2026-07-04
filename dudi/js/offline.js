/**
 * @file dudi/js/offline.js
 * Lapisan offline untuk absensi PKL DUDI.
 *
 * Prinsip (sama dengan guru/js/offline.js):
 *   - Online-first: coba upsert langsung; kalau JARINGAN gagal → antrikan
 *     ke IndexedDB + status jujur "Menunggu sinkron" (bukan "Tersimpan").
 *   - Penolakan nyata server (400/403) TIDAK diantrikan — tampilkan error.
 *   - Flush otomatis saat halaman dibuka & saat koneksi kembali ('online').
 *   - Idempoten: upsert dengan onConflict 'placement_id,attendance_date' →
 *     aman dikirim ulang berkali-kali.
 */

import { supabase } from './api.js';

const DB_NAME       = 'smkhr-dudi-offline';
const STORE_ATT     = 'pkl_att_queue';
const OFFLINE_SCHEMA_VER = 'v1';

// ── IndexedDB helpers ──────────────────────────────────────────
function openDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => {
            if (!req.result.objectStoreNames.contains(STORE_ATT)) {
                req.result.createObjectStore(STORE_ATT, { keyPath: 'idempotency_key' });
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror   = () => reject(req.error);
    });
}

async function idbPut(item) {
    const db = await openDB();
    return new Promise((res, rej) => {
        const t = db.transaction(STORE_ATT, 'readwrite').objectStore(STORE_ATT).put(item);
        t.onsuccess = () => res(); t.onerror = () => rej(t.error);
    });
}

async function idbGetAll() {
    const db = await openDB();
    return new Promise((res, rej) => {
        const t = db.transaction(STORE_ATT, 'readonly').objectStore(STORE_ATT).getAll();
        t.onsuccess = () => res(t.result ?? []); t.onerror = () => rej(t.error);
    });
}

async function idbDelete(key) {
    const db = await openDB();
    return new Promise((res, rej) => {
        const t = db.transaction(STORE_ATT, 'readwrite').objectStore(STORE_ATT).delete(key);
        t.onsuccess = () => res(); t.onerror = () => rej(t.error);
    });
}

// Supersede: satu placement + tanggal hanya boleh ada satu antrean
async function idbPurgeSlot(placementId, date) {
    const all = await idbGetAll();
    for (const item of all) {
        if (item.placement_id === placementId && item.attendance_date === date) {
            await idbDelete(item.idempotency_key);
        }
    }
}

// ── Kirim satu item ke Supabase (idempoten) ────────────────────
async function submitOne(item) {
    const { idempotency_key: _k, _schema_ver: _v, ...payload } = item;
    try {
        const { error } = await supabase
            .from('pkl_attendance')
            .upsert(payload, { onConflict: 'placement_id,attendance_date' });
        if (!error) return { ok: true };
        // Penolakan nyata server (constraint, auth, dll)
        const isNetwork = /fetch|network|failed to fetch/i.test(error.message ?? '');
        return { ok: false, networkError: isNetwork, error: error.message };
    } catch (e) {
        return { ok: false, networkError: true, error: String(e) };
    }
}

// ── API publik ─────────────────────────────────────────────────

/**
 * Simpan satu absensi PKL. Online-first, antre bila jaringan gagal.
 * @returns {{status:'synced'|'queued'|'error', error?:string}}
 */
export async function saveAttendanceOffline({ placementId, studentId, date, status, notes, userId }) {
    const payload = {
        placement_id:        placementId,
        student_id:          studentId,
        attendance_date:     date,
        status,
        notes:               notes || null,
        recorded_by_user_id: userId,
    };

    if (navigator.onLine) {
        const r = await submitOne({ idempotency_key: `${placementId}_${date}`, _schema_ver: OFFLINE_SCHEMA_VER, ...payload });
        if (r.ok) return { status: 'synced' };
        if (!r.networkError) return { status: 'error', error: r.error };
    }

    // Jaringan gagal atau offline — supersede lalu antrikan
    await idbPurgeSlot(placementId, date);
    await idbPut({
        idempotency_key: `${placementId}_${date}`,
        _schema_ver: OFFLINE_SCHEMA_VER,
        ...payload,
    });
    return { status: 'queued' };
}

/**
 * Kirim semua absensi yang tertunda ke Supabase.
 * @returns {{synced:number, remaining:number}}
 */
export async function flushPending() {
    const pending = await idbGetAll();
    if (pending.length === 0) return { synced: 0, remaining: 0 };
    if (!navigator.onLine)    return { synced: 0, remaining: pending.length };

    let synced = 0;
    for (const item of pending) {
        if (item._schema_ver && item._schema_ver !== OFFLINE_SCHEMA_VER) {
            await idbDelete(item.idempotency_key);
            synced++;
            continue;
        }
        const r = await submitOne(item);
        if (r.ok) { await idbDelete(item.idempotency_key); synced++; }
        else if (!r.networkError) { await idbDelete(item.idempotency_key); synced++; }
        else break;
    }
    return { synced, remaining: (await idbGetAll()).length };
}

/**
 * Jumlah item tertunda di antrian offline.
 */
export async function pendingCount() {
    return (await idbGetAll()).length;
}

/**
 * Hapus semua antrian offline (dipanggil saat logout).
 */
export async function clearOfflineQueue() {
    const db = await openDB();
    return new Promise((res, rej) => {
        const t = db.transaction(STORE_ATT, 'readwrite').objectStore(STORE_ATT).clear();
        t.onsuccess = () => res(); t.onerror = () => rej(t.error);
    });
}
