import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const html = read('guru/dashboard.html');
const js = read('guru/js/dashboard.js');
const edge = read('supabase/functions/manage-admin-account/index.ts');
const sql = read('supabase/migrations/20261009090000_kepsek_monitoring_and_admin_hardening.sql');
let passed = 0;

function test(label, fn) {
    fn();
    console.log(`PASS ${++passed}: ${label}`);
}

test('dokumen pengesahan Kepsek tersembunyi dan tidak diinisialisasi', () => {
    assert.match(html, /id="ks-disahkan-section" hidden/);
    assert.doesNotMatch(js, /await loadKepsekDisahkanDocs\(\);/);
    assert.match(js, /if \(!section \|\| section\.hidden\) return;/);
});

test('preset monitoring memakai tanggal lokal dan rentang terbalik ditolak', () => {
    assert.match(js, /function kepsekLocalRange\(period\)/);
    assert.match(js, /_period\s*= 'rentang'/);
    assert.match(js, /Tanggal awal tidak boleh setelah tanggal akhir/);
    assert.match(sql, /p_date_start tidak boleh setelah p_date_end/);
});

test('monitoring menolak respons lama dan membersihkan data gagal', () => {
    assert.match(js, /let _ksMonitoringSeq = 0/);
    assert.match(js, /if \(seq !== _ksMonitoringSeq\) return;/);
    assert.match(js, /countLate\)\s+countLate\.textContent = '—'/);
    assert.match(js, /countExits\)\s+countExits\.textContent = '—'/);
});

test('Kepsek non-handler dapat memakai kontrol kasus yang memang diizinkan', () => {
    assert.match(js, /const isKepsek = currentUser\.role_type === 'KEPSEK'/);
    assert.match(js, /if \(!isHandler && !isKepsek\)/);
    assert.match(sql, /OR fn_is_kepsek\(\)/);
});

test('akses monitoring dan helper Kepsek mensyaratkan akun aktif', () => {
    assert.match(sql, /u\.is_active IS TRUE/);
    assert.match(sql, /is_active IS TRUE AND deleted_at IS NULL/);
});

test('penghapusan admin didelegasikan ke RPC ber-lock per sekolah', () => {
    assert.match(edge, /admin\.rpc\('fn_remove_school_admin'/);
    assert.match(sql, /pg_advisory_xact_lock\(hashtextextended\(v_school_id::text, 0\)\)/);
    assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.fn_remove_school_admin\(uuid, uuid\) TO service_role/);
});

console.log(`KEPSEK_HARDENING_COMPLETE: ${passed} checks passed; static regression checks only.`);
