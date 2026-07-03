#!/usr/bin/env node
/**
 * tests/tenant-isolation.mjs
 *
 * Guard-rail otomatis untuk ISOLASI MULTI-TENANT.
 * Menegakkan invarian yang, bila dilanggar, membuka kebocoran tenant —
 * mencegah terulangnya kelas bug audit 3 Juli 2026
 * (RPC SECURITY DEFINER ber-GRANT PUBLIC bocor ke anon).
 *
 * Menjalankan 4 pemeriksaan terhadap DB LIVE:
 *   1. RLS coverage      — SEMUA tabel public wajib RLS enabled.
 *   2. RPC exposure      — TIDAK boleh ada fungsi SECURITY DEFINER `fn_*`
 *                          VOLATILE (menulis, non-trigger) yang EXECUTE-nya
 *                          dipegang `anon`, kecuali allowlist branding-publik.
 *                          (Predikat read-only STABLE spt fn_is_kepsek DIKECUALIKAN
 *                           — RLS memanggilnya, jadi memang harus anon-callable.)
 *   3. Anon read baseline— anon tak boleh membaca baris tabel inti (RLS).
 *   4. RPC regression    — RPC privileged spesifik (yang pernah bocor) wajib
 *                          has_function_privilege('anon', ...) = false.
 *   5. Cross-tenant      — admin Sekolah A TIDAK dapat membaca data Sekolah B.
 *                          Simulasi konteks RLS pengguna nyata via SET ROLE
 *                          authenticated + request.jwt.claims (cara auth.uid()
 *                          dievaluasi) — tanpa membuat user/login palsu.
 *
 * CARA JALANKAN:
 *   SUPABASE_ACCESS_TOKEN=sbp_xxx node tests/tenant-isolation.mjs
 *   (opsional: PROJECT_REF=... ; default = xovvuuwexoweoqyltepq)
 *   Token = access token CLI Supabase (Windows Credential Manager:
 *   "Supabase CLI:supabase", blob UTF-8). anon key diambil otomatis
 *   via Management API — jadi cukup satu env secret.
 *
 * EXIT CODE: 0 = semua lulus, 1 = ada pelanggaran (cocok untuk CI).
 */

const REF   = process.env.PROJECT_REF || 'xovvuuwexoweoqyltepq';
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const MGMT  = `https://api.supabase.com/v1/projects/${REF}`;
const BASE  = `https://${REF}.supabase.co`;

// Fungsi VOLATILE SECURITY DEFINER yang MEMANG sengaja anon (branding publik
// di halaman login by slug — hanya name/logo/warna, aman ditampilkan pra-login).
const ANON_RPC_ALLOWLIST = new Set([
    'fn_school_branding',
]);

// Tabel inti yang anon TIDAK boleh baca satu baris pun.
const CORE_TABLES = ['students', 'users', 'cases', 'observations', 'attendance'];

// RPC privileged yang pernah bocor — regresi test: anon HARUS tak punya EXECUTE.
const PRIVILEGED_RPCS = [
    'fn_sync_observation', 'fn_sync_case', 'fn_sync_journal',
    'fn_batalkan_tahun_ajaran', 'fn_apply_schedule_templates',
    'fn_deactivate_stale_staff', 'fn_get_stale_staff',
    'fn_stakeholder_summary', 'fn_update_school_branding',
];

if (!TOKEN) {
    console.error('FATAL: env SUPABASE_ACCESS_TOKEN wajib diisi.');
    process.exit(2);
}

let failures = 0;
const log = {
    pass: (m) => console.log(`  ✓ ${m}`),
    fail: (m) => { failures++; console.log(`  ✗ FAIL: ${m}`); },
    head: (m) => console.log(`\n── ${m}`),
};

async function mgmtQuery(sql) {
    const res = await fetch(`${MGMT}/database/query`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: sql }),
    });
    if (!res.ok) throw new Error(`mgmtQuery ${res.status}: ${await res.text()}`);
    return res.json();
}

async function getAnonKey() {
    const res = await fetch(`${MGMT}/api-keys`, { headers: { Authorization: `Bearer ${TOKEN}` } });
    if (!res.ok) throw new Error(`api-keys ${res.status}`);
    const keys = await res.json();
    const anon = keys.find((k) => k.name === 'anon');
    if (!anon) throw new Error('anon key tidak ditemukan');
    return anon.api_key;
}

async function anonGet(anon, path) {
    const res = await fetch(`${BASE}/rest/v1/${path}`, {
        headers: { apikey: anon, Authorization: `Bearer ${anon}` },
    });
    return { status: res.status, body: await res.json().catch(() => null) };
}

async function anonRpc(anon, fn, params) {
    const res = await fetch(`${BASE}/rest/v1/rpc/${fn}`, {
        method: 'POST',
        headers: { apikey: anon, Authorization: `Bearer ${anon}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
    });
    return { status: res.status, body: await res.json().catch(() => null) };
}

async function main() {
    console.log(`Tenant-isolation audit → project ${REF}`);
    const anon = await getAnonKey();

    // ── CHECK 1: RLS coverage ────────────────────────────────────
    log.head('CHECK 1 — RLS enabled di semua tabel public');
    const noRls = await mgmtQuery(`
        select t.tablename
        from pg_tables t
        join pg_class c on c.relname = t.tablename
                       and c.relnamespace = 'public'::regnamespace
        where t.schemaname = 'public' and not c.relrowsecurity
        order by 1;`);
    if (noRls.length === 0) log.pass('semua tabel public RLS enabled');
    else noRls.forEach((r) => log.fail(`tabel tanpa RLS: ${r.tablename}`));

    // ── CHECK 2: RPC exposure (kelas bug audit) ──────────────────
    log.head('CHECK 2 — tak ada fn_* SECURITY DEFINER VOLATILE yang executable oleh anon (di luar allowlist)');
    const anonExec = await mgmtQuery(`
        select p.proname
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.prosecdef
          and p.proname ~ '^fn_'
          and p.provolatile = 'v'
          and p.prorettype <> 'pg_catalog.trigger'::regtype
          and has_function_privilege('anon', p.oid, 'EXECUTE')
        order by 1;`);
    const leaks = anonExec.map((r) => r.proname).filter((n) => !ANON_RPC_ALLOWLIST.has(n));
    if (leaks.length === 0) log.pass(`tak ada RPC penulis bocor ke anon (allowlist: ${[...ANON_RPC_ALLOWLIST].join(', ')})`);
    else leaks.forEach((n) => log.fail(`fn VOLATILE SECURITY DEFINER executable oleh anon: ${n} — REVOKE dari PUBLIC/anon`));

    // ── CHECK 3: anon read baseline ──────────────────────────────
    log.head('CHECK 3 — anon tak bisa membaca tabel inti');
    for (const t of CORE_TABLES) {
        const { status, body } = await anonGet(anon, `${t}?select=*&limit=1`);
        if (Array.isArray(body) && body.length === 0) log.pass(`${t}: anon dapat [] (RLS menutup)`);
        else log.fail(`${t}: anon TIDAK kosong (status ${status}, rows ${Array.isArray(body) ? body.length : '?'})`);
    }

    // ── CHECK 4: regresi RPC privileged (anon EXECUTE = false) ───
    log.head('CHECK 4 — RPC privileged yang pernah bocor: anon TANPA EXECUTE');
    const rpcList = PRIVILEGED_RPCS.map((n) => `'${n}'`).join(',');
    const rpcPriv = await mgmtQuery(`
        select p.proname, bool_or(has_function_privilege('anon', p.oid, 'EXECUTE')) as anon_exec
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname in (${rpcList})
        group by p.proname order by p.proname;`);
    const seen = new Set(rpcPriv.map((r) => r.proname));
    for (const fn of PRIVILEGED_RPCS) {
        if (!seen.has(fn)) { log.fail(`${fn}: fungsi tidak ditemukan di DB (regresi/hilang?)`); continue; }
    }
    for (const r of rpcPriv) {
        if (r.anon_exec === false) log.pass(`${r.proname}: anon tanpa EXECUTE`);
        else log.fail(`${r.proname}: anon MASIH punya EXECUTE — REVOKE dari PUBLIC/anon`);
    }
    // Bukti perilaku tambahan: satu probe live harus ditolak (42501/PGRST202).
    const probe = await anonRpc(anon, 'fn_batalkan_tahun_ajaran', { p_config_id: '00000000-0000-0000-0000-0000000000aa' });
    const denied = probe.body && (probe.body.code === '42501' || probe.body.code === 'PGRST202'
                 || String(probe.body.message || '').includes('permission denied'));
    if (denied) log.pass(`probe live fn_batalkan_tahun_ajaran ditolak (code ${probe.body.code})`);
    else log.fail(`probe live fn_batalkan_tahun_ajaran TIDAK ditolak (code ${probe.body?.code})`);

    // ── CHECK 5: Cross-Tenant Test (A3) ──────────────────────────
    // Simulasikan konteks RLS admin tiap sekolah (SET ROLE authenticated +
    // request.jwt.claims.sub = auth_user_id) lalu buktikan ia melihat 0 baris
    // milik sekolah lain, TAPI tetap melihat data sekolahnya (uji tak vacuous).
    log.head('CHECK 5 — Cross-Tenant: admin Sekolah A tidak dapat membaca data Sekolah B');
    const schools = await mgmtQuery(`
        select s.school_id, s.name,
               (select u.auth_user_id from users u
                 where u.school_id = s.school_id and u.role_type = 'ADMINISTRATIVE' and u.is_active
                 limit 1) as admin_auid,
               (select count(*) from students st where st.school_id = s.school_id) as n_students
        from schools s
        where exists (select 1 from users u where u.school_id = s.school_id
                        and u.role_type = 'ADMINISTRATIVE' and u.is_active)
          and exists (select 1 from students st where st.school_id = s.school_id)
        order by n_students desc
        limit 2;`);

    if (schools.length < 2) {
        log.pass(`SKIP — hanya ${schools.length} sekolah berdata; cross-tenant butuh ≥2 (tidak menggagalkan)`);
    } else {
        const [A, B] = schools;
        for (const [viewer, other] of [[A, B], [B, A]]) {
            const claims = `{"sub":"${viewer.admin_auid}","role":"authenticated"}`;
            const rows = await mgmtQuery(
                `begin; set local role authenticated;` +
                ` select set_config('request.jwt.claims', $claims$${claims}$claims$, true);` +
                ` select` +
                `  (select count(*) from students     where school_id='${other.school_id}')::int as students_other,` +
                `  (select count(*) from users        where school_id='${other.school_id}')::int as users_other,` +
                `  (select count(*) from cases        where school_id='${other.school_id}')::int as cases_other,` +
                `  (select count(*) from observations where school_id='${other.school_id}')::int as obs_other,` +
                `  (select count(*) from attendance   where school_id='${other.school_id}')::int as att_other,` +
                `  (select count(*) from students     where school_id='${viewer.school_id}')::int as students_own,` +
                `  fn_current_school_id()::text as resolved;` +
                ` commit;`);
            const r = rows[0] || {};
            const leakCols = ['students_other', 'users_other', 'cases_other', 'obs_other', 'att_other']
                .filter((c) => (r[c] ?? -1) !== 0);
            if (leakCols.length === 0)
                log.pass(`admin ${viewer.name} → 0 baris milik ${other.name} (students/users/cases/obs/attendance)`);
            else
                leakCols.forEach((c) => log.fail(`BOCOR: admin ${viewer.name} melihat ${r[c]} baris ${other.name} (${c})`));

            if ((r.students_own ?? 0) > 0)
                log.pass(`admin ${viewer.name} tetap melihat sekolahnya (${r.students_own} siswa) — uji tidak vacuous`);
            else
                log.fail(`admin ${viewer.name}: students_own=0 — uji vacuous / akun tak punya visibilitas`);

            if (r.resolved === viewer.school_id) log.pass(`fn_current_school_id() = ${viewer.name} (benar)`);
            else log.fail(`fn_current_school_id() salah: ${r.resolved} ≠ ${viewer.school_id}`);
        }
    }

    // ── Ringkasan ────────────────────────────────────────────────
    console.log(`\n${'='.repeat(52)}`);
    if (failures === 0) {
        console.log('✅ LULUS — invarian isolasi tenant utuh.');
        process.exit(0);
    } else {
        console.log(`❌ GAGAL — ${failures} pelanggaran isolasi tenant.`);
        process.exit(1);
    }
}

main().catch((err) => { console.error('ERROR:', err.message); process.exit(2); });
