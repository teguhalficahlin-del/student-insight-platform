/**
 * @file guru/js/offline.js
 * Lapisan offline untuk absensi guru (Kelompok 6 / Brick 2).
 *
 * Prinsip:
 *   - Satu jalur idempoten: edge function sync-attendance-batch
 *     (aman dikirim ulang — was_duplicate:true bila sudah masuk).
 *   - Online-first: coba kirim; kalau JARINGAN gagal → antrikan ke
 *     IndexedDB + status jujur "Menunggu sinkron" (bukan "Tersimpan").
 *   - Penolakan nyata server (400/403) TIDAK diantrikan — tampilkan error.
 *   - Flush otomatis saat halaman dibuka & saat koneksi kembali ('online').
 *
 * Tidak memakai Background Sync API (butuh SW) demi keandalan v1 —
 * sinkronisasi terjadi selama aplikasi terbuka / dibuka kembali online.
 */

import { supabase } from './api.js';

const SUPABASE_URL      = 'https://xovvuuwexoweoqyltepq.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhvdnZ1dXdleG93ZW9xeWx0ZXBxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIyMDk0NzUsImV4cCI6MjA5Nzc4NTQ3NX0.mFwmVfSqYM7ITURtLC143BsurK6Yr31WFViJe5PFGN8';

const DB_NAME = 'smkhr-guru-offline';
const STORE   = 'att_queue';

// ── IndexedDB helpers ─────────────────────────────────────────
function openDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(STORE)) {
                db.createObjectStore(STORE, { keyPath: 'idempotency_key' });
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror   = () => reject(req.error);
    });
}
function tx(db, mode) { return db.transaction(STORE, mode).objectStore(STORE); }
async function idbPut(batch) {
    const db = await openDB();
    return new Promise((res, rej) => { const t = tx(db, 'readwrite').put(batch);
        t.onsuccess = () => res(); t.onerror = () => rej(t.error); });
}
async function idbGetAll() {
    const db = await openDB();
    return new Promise((res, rej) => { const t = tx(db, 'readonly').getAll();
        t.onsuccess = () => res(t.result ?? []); t.onerror = () => rej(t.error); });
}
async function idbDelete(key) {
    const db = await openDB();
    return new Promise((res, rej) => { const t = tx(db, 'readwrite').delete(key);
        t.onsuccess = () => res(); t.onerror = () => rej(t.error); });
}

// ── Kirim satu batch ke server ────────────────────────────────
// return { ok, networkError, wasDuplicate, status, error }
async function submitBatch(batch) {
    const { data: sess } = await supabase.auth.getSession();
    const token = sess?.session?.access_token;
    if (!token) return { ok: false, networkError: false, status: 401, error: 'Sesi tidak valid' };

    let res;
    try {
        res = await fetch(`${SUPABASE_URL}/functions/v1/sync-attendance-batch`, {
            method:  'POST',
            headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body:    JSON.stringify(batch),
        });
    } catch (e) {
        return { ok: false, networkError: true, error: String(e) };  // jaringan mati
    }
    const json = await res.json().catch(() => ({}));
    if (res.ok) return { ok: true, wasDuplicate: json?.data?.was_duplicate ?? false };
    return { ok: false, networkError: false, status: res.status, error: json?.error?.message ?? `HTTP ${res.status}` };
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
        if (!r.networkError) return { status: 'error', error: r.error }; // ditolak server → jangan antre
        // jaringan gagal walau onLine=true → jatuh ke antre
    }
    await idbPut(batch);
    return { status: 'queued' };
}

/** Kirim semua batch tertunda. @returns {{synced:number, remaining:number}} */
export async function flushPending() {
    const pending = await idbGetAll();
    if (pending.length === 0) return { synced: 0, remaining: 0 };
    if (!navigator.onLine)    return { synced: 0, remaining: pending.length };

    let synced = 0;
    for (const batch of pending) {
        const r = await submitBatch(batch);
        if (r.ok) { await idbDelete(batch.idempotency_key); synced++; }
        else if (!r.networkError) {
            // Ditolak permanen (mis. sesi ditutup) — buang agar tak retry selamanya.
            console.warn('[offline] batch ditolak, dibuang:', batch.idempotency_key, r.error);
            await idbDelete(batch.idempotency_key); synced++;
        } else break; // jaringan mati — hentikan, coba lagi nanti
    }
    const remaining = (await idbGetAll()).length;
    return { synced, remaining };
}

export async function pendingCount() {
    return (await idbGetAll()).length;
}
