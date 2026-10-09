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
let queueWork = Promise.resolve();
let activeSubmission = null;

// Serialize save/flush across tabs on supported browsers, with a same-page fallback.
function withQueueLock(work) {
    if (navigator.locks) return navigator.locks.request(DB_NAME, work);
    const result = queueWork.then(work, work);
    queueWork = result.catch(() => {});
    return result;
}

function belongsTo(item, owner) {
    return !!owner?.userId && !!owner?.schoolId
        && item.recorded_by_user_id === owner.userId && item.school_id === owner.schoolId;
}

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
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    activeSubmission = { ...payload, controller };
    try {
        const { error } = await supabase
            .from('pkl_attendance')
            .upsert(payload, { onConflict: 'placement_id,attendance_date' })
            .abortSignal(controller.signal);
        if (!error) return { ok: true };
        // Penolakan nyata server (constraint, auth, dll)
        const isNetwork = /fetch|network|abort|timeout|timed out/i.test(error.message ?? '');
        return { ok: false, networkError: isNetwork, error: error.message };
    } catch (e) {
        return { ok: false, networkError: true, error: String(e) };
    } finally {
        clearTimeout(timeout);
        activeSubmission = null;
    }
}

// ── API publik ─────────────────────────────────────────────────

/**
 * Simpan satu absensi PKL. Online-first, antre bila jaringan gagal.
 * @returns {{status:'synced'|'queued'|'error', error?:string}}
 */
export async function saveAttendanceOffline({ placementId, studentId, date, status, notes, userId, schoolId }) {
    return withQueueLock(() => saveOne({ placementId, studentId, date, status, notes, userId, schoolId }));
}

async function saveOne({ placementId, studentId, date, status, notes, userId, schoolId }) {
    const payload = {
        placement_id:        placementId,
        student_id:          studentId,
        attendance_date:     date,
        status,
        notes:               notes || null,
        recorded_by_user_id: userId,
        school_id:           schoolId,
    };

    if (navigator.onLine) {
        const r = await submitOne({ idempotency_key: `${placementId}_${date}`, _schema_ver: OFFLINE_SCHEMA_VER, ...payload });
        if (r.ok) {
            await idbPurgeSlot(placementId, date);
            return { status: 'synced' };
        }
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
 *
 * DUD-05: entry yang DITOLAK server (bukan gagal jaringan) tetap dihapus dari
 * antrian — mengirim ulang hanya akan ditolak lagi — tapi sekarang dikembalikan
 * lewat `failed` dan TIDAK lagi dihitung sebagai `synced`. Tanpa ini, absensi
 * yang ditolak hilang permanen sambil dilaporkan "tersinkron" ke user.
 *
 * @returns {{synced:number, remaining:number, failed:Array<object>}}
 */
export async function flushPending(owner) {
    if (!owner?.userId || !owner?.schoolId) return { synced: 0, remaining: 0, failed: [] };
    return withQueueLock(() => flushOwned(owner));
}

async function flushOwned(owner) {
    const pending = (await idbGetAll()).filter(item => belongsTo(item, owner));
    if (pending.length === 0) return { synced: 0, remaining: 0, failed: [] };
    if (!navigator.onLine)    return { synced: 0, remaining: pending.length, failed: [] };

    let synced = 0;
    const failed = [];
    for (const item of pending) {
        // Sisa antrian dari versi schema lama: dibuang, bukan kegagalan user —
        // jadi tidak masuk `failed`.
        if (item._schema_ver && item._schema_ver !== OFFLINE_SCHEMA_VER) {
            await idbDelete(item.idempotency_key);
            synced++;
            continue;
        }
        const r = await submitOne(item);
        if (r.ok) {
            await idbDelete(item.idempotency_key);
            synced++;
        } else if (!r.networkError) {
            await idbDelete(item.idempotency_key);
            failed.push({
                key:             item.idempotency_key,
                placement_id:    item.placement_id,
                student_id:      item.student_id,
                attendance_date: item.attendance_date,
                status:          item.status,
                error:           r.error ?? 'Ditolak server.',
            });
        } else break;
    }
    return { synced, remaining: await pendingCount(owner), failed };
}

/**
 * Jumlah item tertunda di antrian offline.
 */
export async function pendingCount(owner) {
    return (await idbGetAll()).filter(item => belongsTo(item, owner)).length;
}

/**
 * Hapus semua antrian offline (dipanggil saat logout).
 */
export async function clearOfflineQueue(owner) {
    if (activeSubmission && belongsTo(activeSubmission, owner)) activeSubmission.controller.abort();
    return withQueueLock(async () => {
        for (const item of await idbGetAll()) {
            if (belongsTo(item, owner)) await idbDelete(item.idempotency_key);
        }
    });
}
