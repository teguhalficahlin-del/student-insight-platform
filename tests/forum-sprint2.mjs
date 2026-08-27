/**
 * @file tests/forum-sprint2.mjs
 * Targeted test Sprint Forum-2 — FUNC-01, FUNC-02, FUNC-03, NOTIF-01.
 *
 * Dijalankan TANPA koneksi database:
 *   node tests/forum-sprint2.mjs
 *
 * Cakupan per item:
 *   NOTIF-01 — BEHAVIORAL. shared/ack-queue.js diimpor dan dijalankan
 *              sungguhan di atas stub localStorage/window/document.
 *   FUNC-01  — STRUKTURAL. Alur upload/attach ada di dalam submitForumPost
 *              yang terikat DOM, jadi yang diuji adalah invarian sumbernya:
 *              setiap jalur keluar yang gagal wajib menghapus file yang
 *              terlanjur ter-upload, dan penanda orphan hanya boleh
 *              di-null-kan SETELAH lampiran benar-benar terpasang.
 *   FUNC-02  — STRUKTURAL atas SQL migration: urutan gerbang is_withdrawn
 *              terhadap short-circuit scope SEKOLAH.
 *   FUNC-03  — STRUKTURAL atas SQL migration: kolom, unique index parsial,
 *              parameter RPC, dan handler race condition.
 *
 * Catatan jujur: FUNC-02 dan FUNC-03 baru bisa dibuktikan runtime setelah
 * migration di-deploy. Sprint ini dibatasi "no deploy", jadi buktinya di
 * sini berhenti di tingkat sumber SQL.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = p => readFileSync(join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
function ok(cond, label) {
    if (cond) { pass++; console.log(`  ✓ ${label}`); }
    else      { fail++; console.log(`  ✗ ${label}`); }
}
function section(t) { console.log(`\n── ${t}`); }

// ═══════════════════════════════════════════════════════════════
// Stub lingkungan browser untuk shared/ack-queue.js
// ═══════════════════════════════════════════════════════════════
const _store = new Map();
globalThis.localStorage = {
    getItem:    k => (_store.has(k) ? _store.get(k) : null),
    setItem:    (k, v) => { _store.set(k, String(v)); },
    removeItem: k => { _store.delete(k); },
};
class FakeCustomEvent {
    constructor(type, init = {}) { this.type = type; this.detail = init.detail; }
}
globalThis.CustomEvent = FakeCustomEvent;
const emitted = [];
globalThis.window = {
    addEventListener: () => {},
    dispatchEvent:    ev => { emitted.push(ev); return true; },
};
globalThis.document  = { addEventListener: () => {}, visibilityState: 'visible' };
// Node 24 mendefinisikan navigator sebagai getter-only — pakai defineProperty.
Object.defineProperty(globalThis, 'navigator', {
    value: { onLine: true }, configurable: true, writable: true,
});

const { registerAckHandler, initAckQueue, ackWithRetry, flushAckQueue, pendingAckCount } =
    await import('../shared/ack-queue.js');

// ═══════════════════════════════════════════════════════════════
section('NOTIF-01 — antrean retry acknowledgement (behavioral)');
// ═══════════════════════════════════════════════════════════════

let calls = [];
let mode  = 'ok';                       // 'ok' | 'fail'
registerAckHandler('notif_read', ids => {
    calls.push(ids);
    if (mode === 'fail') throw new Error('network down');
    return Promise.resolve();
});
initAckQueue({ userId: 'user-A' });

// N1 — ack sukses tidak menyisakan apa pun di antrean
calls = []; mode = 'ok';
let r = await ackWithRetry('notif_read', ['n1'], 'k:n1');
ok(r === true && calls.length === 1 && pendingAckCount() === 0,
   'N1: ack sukses → handler dipanggil 1x, antrean kosong');

// N2 — ack gagal masuk antrean dan TIDAK melempar (UI tetap optimistic)
calls = []; mode = 'fail';
r = await ackWithRetry('notif_read', ['n2'], 'k:n2');
ok(r === false && pendingAckCount() === 1,
   'N2: ack gagal → tidak melempar, 1 entri tertunda');

// N3 — dedup: kegagalan berulang dengan key sama tetap 1 entri
await ackWithRetry('notif_read', ['n2'], 'k:n2');
await ackWithRetry('notif_read', ['n2'], 'k:n2');
ok(pendingAckCount() === 1, 'N3: key sama gagal 3x → tetap 1 entri (tidak menumpuk)');

// N4 — koneksi pulih: flush menghabiskan antrean + emit event
mode = 'ok'; emitted.length = 0; calls = [];
await flushAckQueue();
ok(pendingAckCount() === 0 && calls.length === 1,
   'N4: koneksi pulih → flush mengirim ulang 1x, antrean kosong');
ok(emitted.some(e => e.type === 'sip:ack-flushed' && e.detail.dropped === false),
   'N4b: event sip:ack-flushed terkirim dengan dropped=false (tanpa rollback)');

// N5 — entri yang sudah sukses tidak dikirim ulang (tidak ada ack ganda)
calls = [];
await flushAckQueue();
ok(calls.length === 0, 'N5: flush kedua tidak memanggil handler lagi — tidak ada ack ganda');

// N6 — gagal terus → dibuang setelah MAX_ATTEMPTS, emit dropped=true (rollback)
mode = 'fail'; emitted.length = 0;
await ackWithRetry('notif_read', ['n6'], 'k:n6');
ok(pendingAckCount() === 1, 'N6a: entri gagal masuk antrean');
for (let i = 0; i < 5; i++) await flushAckQueue();
ok(pendingAckCount() === 0, 'N6b: entri dibuang setelah jatah percobaan habis');
ok(emitted.some(e => e.type === 'sip:ack-flushed' && e.detail.dropped === true),
   'N6c: event dropped=true dikirim → UI bisa rollback badge ke unread');

// N7 — isolasi antar-akun: entri milik user lain tidak dieksekusi & tidak dibuang
mode = 'fail';
await ackWithRetry('notif_read', ['nX'], 'k:nX');     // milik user-A
initAckQueue({ userId: 'user-B' });                   // ganti akun aktif
mode = 'ok'; calls = [];
await flushAckQueue();
ok(calls.length === 0 && pendingAckCount() === 1,
   'N7: entri milik akun lain tidak dieksekusi dan tidak dibuang');
initAckQueue({ userId: 'user-A' });
await flushAckQueue();
ok(pendingAckCount() === 0, 'N7b: kembali ke akun pemilik → entri terkirim');

// ═══════════════════════════════════════════════════════════════
section('FUNC-01 — atomisitas lampiran forum (struktural)');
// ═══════════════════════════════════════════════════════════════

const guruApi  = read('guru/js/api.js');
const guruDash = read('guru/js/dashboard.js');

ok(/export async function setForumAttachment\(/.test(guruApi),
   'F1-1: guru/js/api.js mengekspor setForumAttachment (melempar saat gagal)');
ok(/export async function setForumAttachment\([\s\S]{0,400}?if \(error\) throw error;/.test(guruApi),
   'F1-2: setForumAttachment memeriksa error dan melempar — bukan swallow');

const createFn = guruApi.match(
    /export async function createForumSekolahPost\([\s\S]*?\n}/)?.[0] ?? '';
ok(createFn.length > 0 && !/attachment_url:/.test(createFn),
   'F1-3: createForumSekolahPost tidak lagi meng-update lampiran diam-diam');

const submitFn = guruDash.match(
    /async function submitForumPost\(\)[\s\S]*?\n}\r?\n/)?.[0] ?? '';
ok(submitFn.length > 0, 'F1-4: submitForumPost ditemukan di guru/js/dashboard.js');
ok(/let uploadedPath = null;/.test(submitFn),
   'F1-5: ada penanda uploadedPath untuk melacak file calon orphan');
ok(/if \(upErr\) throw upErr;/.test(submitFn),
   'F1-6: upload gagal → throw sebelum menyentuh DB (tidak ada insert)');

// Penanda orphan hanya boleh dinolkan SETELAH setForumAttachment resolve.
const attachThenClear =
    /await setForumAttachment\([\s\S]{0,200}?\);\s*\n\s*uploadedPath = null;/g;
ok((submitFn.match(attachThenClear) ?? []).length === 2,
   'F1-7: uploadedPath dinolkan hanya SETELAH setForumAttachment berhasil (2 jalur: buat + edit)');

const catchBlock = submitFn.match(/\} catch \(err\) \{[\s\S]*?\n    \} finally/)?.[0] ?? '';
ok(/if \(uploadedPath\) \{[\s\S]{0,300}?remove\(\[uploadedPath\]\)/.test(catchBlock),
   'F1-8: setiap kegagalan menghapus kembali file yang terlanjur ter-upload');
ok(/postSaved/.test(catchBlock),
   'F1-9: catch membedakan "gagal kirim" vs "terkirim, lampiran gagal" — mencegah kirim ulang → duplikat');
ok(/remove\(\[oldPath\]\)/.test(submitFn),
   'F1-10: jalur edit menghapus lampiran lama yang digantikan (tidak menumpuk orphan)');
ok(/setForumAttachment\(_forumEditPostId/.test(submitFn),
   'F1-11: jalur edit benar-benar memasang lampiran baru (sebelumnya tidak pernah)');

// TU sudah punya pola yang sama sejak TU-04/05/07 — pastikan tidak regresi.
const tuPortal = read('tu/js/portal.js');
ok(/remove\(\[uploadedPath\]\)/.test(tuPortal),
   'F1-12: portal TU tetap punya cleanup orphan (tidak ada regresi)');

// ═══════════════════════════════════════════════════════════════
section('FUNC-02 — tarik posting seragam KELAS & SEKOLAH (struktural SQL)');
// ═══════════════════════════════════════════════════════════════

const mig02 = read('supabase/migrations/20260828010000_forum-tarik-posting-seragam-scope.sql');
// Buang baris komentar: blok header sengaja mengutip URUTAN LAMA sebagai
// dokumentasi masalah, dan kutipan itu tidak boleh ikut dinilai.
const sql02 = mig02.replace(/^[ \t]*--.*$/gm, '');
const iWithdrawn = sql02.indexOf('IF v_is_withdrawn THEN');
const iSekolah   = sql02.indexOf("IF v_scope_type = 'SEKOLAH' THEN");
ok(iWithdrawn > 0 && iSekolah > 0, 'F2-1: kedua gerbang ada di badan SQL migration');
ok(iWithdrawn < iSekolah,
   'F2-2: gerbang is_withdrawn dievaluasi SEBELUM short-circuit SEKOLAH — inti fix');
ok((sql02.match(/IF v_is_withdrawn THEN/g) ?? []).length === 1,
   'F2-3: hanya satu gerbang is_withdrawn — tidak ada cabang kembar');
ok(/CREATE OR REPLACE FUNCTION public\.fn_can_read_forum_post\(p_post_id uuid\)/.test(mig02),
   'F2-4: idempoten — CREATE OR REPLACE dengan signature identik');
ok(/GRANT  EXECUTE ON FUNCTION public\.fn_can_read_forum_post\(uuid\) TO authenticated;/.test(mig02)
   && /REVOKE EXECUTE ON FUNCTION public\.fn_can_read_forum_post\(uuid\) FROM anon;/.test(mig02)
   && /REVOKE EXECUTE ON FUNCTION public\.fn_can_read_forum_post\(uuid\) FROM PUBLIC;/.test(mig02),
   'F2-5: SECURITY DEFINER → GRANT + REVOKE anon + REVOKE PUBLIC lengkap');
ok(/^BEGIN;/m.test(mig02) && /^COMMIT;/m.test(mig02),
   'F2-6: dibungkus BEGIN/COMMIT');

// ═══════════════════════════════════════════════════════════════
section('FUNC-03 — idempotency key fn_create_forum_post (struktural SQL)');
// ═══════════════════════════════════════════════════════════════

const mig03 = read('supabase/migrations/20260828020000_forum-idempotency-key.sql');
ok(/ADD COLUMN IF NOT EXISTS idempotency_key uuid;/.test(mig03),
   'F3-1: kolom idempotency_key ditambahkan secara idempoten');
ok(/CREATE UNIQUE INDEX IF NOT EXISTS uq_forum_posts_idempotency[\s\S]{0,200}?WHERE idempotency_key IS NOT NULL;/.test(mig03),
   'F3-2: unique index PARSIAL — baris lama (key NULL) tidak terpengaruh');
ok(/ON public\.forum_posts \(school_id, author_user_id, idempotency_key\)/.test(mig03),
   'F3-3: kunci di-scope per tenant + per penulis — UUID kembar antar-akun aman');
ok(/DROP FUNCTION IF EXISTS public\.fn_create_forum_post\(\s*uuid, text, text, text, uuid\[\], text, uuid\[\], text, uuid\[\], text, text\);/.test(mig03),
   'F3-4: signature lama 11-argumen di-DROP → tidak ada "function is not unique"');
ok(/p_idempotency_key uuid DEFAULT NULL::uuid/.test(mig03),
   'F3-5: parameter baru punya DEFAULT → klien lama tetap kompatibel');
ok(/IF p_idempotency_key IS NOT NULL THEN[\s\S]{0,400}?RETURN v_existing_id;/.test(mig03),
   'F3-6: lookup awal → request ulang mengembalikan posting lama tanpa INSERT');
const raceHandlers = mig03.match(/EXCEPTION WHEN unique_violation THEN/g) ?? [];
ok(raceHandlers.length === 2,
   'F3-7: race condition ditangani di KEDUA path (SEKOLAH + KELAS)');
ok((mig03.match(/IF v_existing_id IS NOT NULL THEN\n\s*RETURN v_existing_id;\n\s*END IF;\n\s*RAISE;/g) ?? []).length === 2,
   'F3-8: unique_violation dari constraint lain di-RAISE ulang, tidak ditelan');
ok((mig03.match(/audience_type, audience_type_2, scope_type, idempotency_key/g) ?? []).length === 2,
   'F3-9: kolom idempotency_key ikut di-INSERT pada kedua path');
const sig12 = 'public.fn_create_forum_post(uuid, text, text, text, uuid[], text, uuid[], text, uuid[], text, text, uuid)';
ok(mig03.includes(`GRANT  EXECUTE ON FUNCTION ${sig12} TO authenticated;`)
   && mig03.includes(`REVOKE EXECUTE ON FUNCTION ${sig12} FROM anon;`)
   && mig03.includes(`REVOKE EXECUTE ON FUNCTION ${sig12} FROM PUBLIC;`),
   'F3-10: GRANT + dua REVOKE dipasang pada signature BARU 12-argumen');

// Sisi klien: kunci dibuat per draft, bukan per klik.
for (const [label, file, openFn] of [
    ['guru',   'guru/js/dashboard.js', 'openForumModal'],
    ['tu',     'tu/js/portal.js',      'openForumModal'],
    ['ortu',   'parent/js/portal.js',  'openForumBuat'],
]) {
    const src = read(file);
    ok(/let _forumIdemKey/.test(src) && new RegExp(`function ${openFn}\\(`).test(src)
       && /_forumIdemKey\s*=\s*(postId \? null : )?newIdemKey\(\)/.test(src),
       `F3-11 (${label}): kunci dibuat saat modal dibuka — double-click memakai kunci sama`);
    ok(/_forumIdemKey\s*=\s*null;/.test(src),
       `F3-12 (${label}): kunci dibersihkan saat modal ditutup`);
}
ok(/p_idempotency_key:\s*idempotencyKey/.test(read('guru/js/api.js'))
   && /p_idempotency_key:\s*idempotencyKey/.test(read('tu/js/api.js'))
   && /p_idempotency_key:\s*idempotencyKey/.test(read('parent/js/api.js')),
   'F3-13: ketiga portal penulis mengirim p_idempotency_key ke RPC');

// ═══════════════════════════════════════════════════════════════
console.log('\n' + '='.repeat(52));
if (fail === 0) console.log(`✅ LULUS — ${pass} assertion, 0 gagal.`);
else            console.log(`❌ GAGAL — ${pass} lulus, ${fail} gagal.`);
console.log('='.repeat(52));
process.exit(fail === 0 ? 0 : 1);
