/**
 * @file shared/ack-queue.js
 * NOTIF-01 — antrean retry acknowledgement lintas portal.
 *
 * MASALAH YANG DIPERBAIKI
 *   Semua portal memanggil ack dengan pola `...().catch(() => {})`:
 *     - markNotificationsRead([id])        (guru, student, parent, dudi)
 *     - addForumSekolahAck(postId, ...)    (guru, student, parent, tu)
 *   Kegagalan jaringan/timeout dibuang diam-diam. Badge sudah terlanjur
 *   di-nol-kan secara optimistic, tapi baris `is_read` di DB tidak pernah
 *   berubah — notifikasi muncul lagi sebagai unread saat halaman dimuat
 *   ulang, tanpa satu pun percobaan ulang.
 *
 * DESAIN
 *   - Ack dieksekusi lewat `ackWithRetry()`. Sukses → selesai.
 *     Gagal → entri masuk antrean persisten (localStorage) dan UI tetap
 *     optimistic (fungsi TIDAK melempar).
 *   - Antrean di-flush saat: modul di-init (halaman dimuat), event `online`,
 *     tab kembali terlihat, dan timer mundur setelah kegagalan.
 *   - Rollback hanya terjadi bila entri habis jatah percobaan
 *     (MAX_ATTEMPTS) atau kedaluwarsa (TTL). Saat itu event
 *     `sip:ack-flushed` dengan `detail.dropped === true` dikirim supaya
 *     portal me-refresh badge — notifikasi kembali tampil unread.
 *
 * AMAN DARI DUPLIKAT (self-review #4)
 *   Kedua jenis ack idempoten di sisi server:
 *     - notif_read → UPDATE notifications SET is_read = true (set, bukan increment)
 *     - forum_ack  → upsert forum_post_acknowledgements dengan ignoreDuplicates
 *   Jadi retry berulang tidak pernah menghasilkan efek ganda.
 *
 * AMAN LINTAS AKUN
 *   Semua portal berbagi origin yang sama di GitHub Pages, jadi localStorage
 *   pun sama. Setiap entri menyimpan `userId` pemiliknya dan hanya di-flush
 *   ketika user aktif cocok — entri milik akun lain dibiarkan utuh, tidak
 *   dieksekusi dan tidak dibuang.
 */

const STORAGE_KEY  = 'sip_ack_queue_v1';
const MAX_ATTEMPTS = 5;
const RETRY_DELAY  = 15000;              // 15 detik
const TTL_MS       = 7 * 24 * 60 * 60 * 1000;  // 7 hari

/** kind -> async fn(payload) */
const _handlers = new Map();

let _activeUserId = null;
let _flushing     = false;
let _timer        = null;
let _initialized  = false;

// Fallback in-memory bila localStorage tidak tersedia (mode privat, kuota penuh).
let _useStorage = true;
let _mem        = [];

function _read() {
    if (!_useStorage) return _mem.slice();
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return [];
        const arr = JSON.parse(raw);
        return Array.isArray(arr) ? arr : [];
    } catch {
        _useStorage = false;
        return _mem.slice();
    }
}

function _write(list) {
    if (!_useStorage) { _mem = list; return; }
    try {
        if (list.length) localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
        else             localStorage.removeItem(STORAGE_KEY);
    } catch {
        _useStorage = false;
        _mem = list;
    }
}

function _emit(dropped) {
    try {
        window.dispatchEvent(new CustomEvent('sip:ack-flushed', { detail: { dropped } }));
    } catch { /* lingkungan tanpa window — abaikan */ }
}

function _scheduleFlush(delay = RETRY_DELAY) {
    if (_timer) return;
    try {
        _timer = setTimeout(() => { _timer = null; flushAckQueue(); }, delay);
    } catch { _timer = null; }
}

function _enqueue(entry) {
    const list = _read().filter(e => e.key !== entry.key);
    list.push({
        key:      entry.key,
        kind:     entry.kind,
        payload:  entry.payload,
        userId:   entry.userId ?? null,
        attempts: 0,
        queuedAt: Date.now(),
    });
    _write(list);
}

function _remove(key) {
    const list = _read();
    const next = list.filter(e => e.key !== key);
    if (next.length !== list.length) _write(next);
}

/**
 * Daftarkan handler untuk satu jenis ack.
 * @param {string}   kind  'notif_read' | 'forum_ack' | ...
 * @param {Function} fn    async (payload) => void; WAJIB melempar saat gagal.
 */
export function registerAckHandler(kind, fn) {
    _handlers.set(kind, fn);
}

/**
 * Pasang listener global + flush pertama. Idempoten: aman dipanggil ulang.
 * @param {{userId: string}} opts
 */
export function initAckQueue({ userId } = {}) {
    _activeUserId = userId ?? null;
    if (!_initialized) {
        _initialized = true;
        try {
            window.addEventListener('online', () => flushAckQueue());
            document.addEventListener('visibilitychange', () => {
                if (document.visibilityState === 'visible') flushAckQueue();
            });
        } catch { /* abaikan */ }
    }
    flushAckQueue();
}

/**
 * Jalankan satu ack; kalau gagal, masukkan antrean retry.
 * TIDAK PERNAH melempar — pemanggil boleh tetap optimistic.
 *
 * @param {string} kind       jenis ack yang sudah diregistrasi
 * @param {*}      payload    argumen handler (harus JSON-serializable)
 * @param {string} [dedupeKey] kunci dedup; default diturunkan dari payload
 * @returns {Promise<boolean>} true bila ack langsung berhasil
 */
export async function ackWithRetry(kind, payload, dedupeKey) {
    let key;
    try { key = dedupeKey ?? `${kind}:${JSON.stringify(payload)}`; }
    catch { key = `${kind}:${Date.now()}`; }

    const fn = _handlers.get(kind);
    if (!fn) {
        console.warn(`[ack-queue] handler "${kind}" belum terdaftar.`);
        return false;
    }
    try {
        await fn(payload);
        _remove(key);
        return true;
    } catch (err) {
        console.warn(`[ack-queue] ack "${kind}" gagal, masuk antrean:`, err?.message ?? err);
        _enqueue({ key, kind, payload, userId: _activeUserId });
        _scheduleFlush();
        return false;
    }
}

/**
 * Coba kirim ulang semua entri antrean milik user aktif.
 * Entri milik akun lain dilewati tanpa dieksekusi dan tanpa dibuang.
 */
export async function flushAckQueue() {
    if (_flushing) return;
    try { if (navigator?.onLine === false) return; } catch { /* abaikan */ }

    const list = _read();
    if (!list.length) return;

    _flushing = true;
    try {
        const now     = Date.now();
        const keep    = [];
        let anyOk     = false;
        let anyDrop   = false;
        let anyRemain = false;

        for (const entry of list) {
            // Kedaluwarsa → buang, hitung sebagai rollback.
            if (now - (entry.queuedAt ?? 0) > TTL_MS) { anyDrop = true; continue; }

            // Milik akun lain / handler tak ada di portal ini → simpan apa adanya.
            const fn = _handlers.get(entry.kind);
            if (!fn || (entry.userId && entry.userId !== _activeUserId)) {
                keep.push(entry);
                continue;
            }

            try {
                await fn(entry.payload);
                anyOk = true;
            } catch {
                entry.attempts = (entry.attempts ?? 0) + 1;
                if (entry.attempts >= MAX_ATTEMPTS) { anyDrop = true; }
                else { keep.push(entry); anyRemain = true; }
            }
        }

        _write(keep);
        if (anyRemain) _scheduleFlush();
        if (anyOk || anyDrop) _emit(anyDrop);
    } finally {
        _flushing = false;
    }
}

/** Jumlah entri tertunda — dipakai test dan diagnostik. */
export function pendingAckCount() {
    return _read().length;
}
