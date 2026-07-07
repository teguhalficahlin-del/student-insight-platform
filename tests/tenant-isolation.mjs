#!/usr/bin/env node
/**
 * tests/tenant-isolation.mjs
 *
 * Guard-rail otomatis untuk ISOLASI MULTI-TENANT.
 * Menegakkan invarian yang, bila dilanggar, membuka kebocoran tenant —
 * mencegah terulangnya kelas bug audit 3 Juli 2026
 * (RPC SECURITY DEFINER ber-GRANT PUBLIC bocor ke anon).
 *
 * Menjalankan 7 pemeriksaan terhadap DB LIVE:
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
 *   6. View exposure     — SEMUA view public wajib security_invoker=true
 *                          (menegakkan RLS penanya) DAN anon tak boleh membaca
 *                          barisnya. Menutup SEC-1 (view bypass RLS ke anon).
 *   7. Kunci eskalasi    — target DECISION_ESCALATE wajib salah satu 6 peran
 *                          internal kasus (tolak SISWA/ORTU/STAKEHOLDER/dst),
 *                          dan DUDI hanya boleh eskalasi ke KAPRODI (E3-1 /
 *                          desain kasus Langkah A).
 *   8. PKL ortu x-tenant — ortu Sekolah A TIDAK bisa baca pkl_placements /
 *                          pkl_attendance Sekolah B, bahkan dengan anomali
 *                          student_parents lintas-sekolah (mig 190000).
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

// View public yang MEMANG sengaja anon-readable pra-login (kosongkan bila tak ada).
// Semua view lain WAJIB security_invoker=true agar RLS ditegakkan (SEC-1).
const VIEW_ANON_ALLOWLIST = new Set([]);

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

    // ── CHECK 6: View publik bypass RLS ke anon (SEC-1) ──────────
    // Root cause SEC-1: view public tanpa security_invoker berjalan sebagai
    // owner (postgres) → MELEWATI RLS; anon punya SELECT → baca lintas-tenant.
    // Invarian: SEMUA view public wajib security_invoker=true (struktural),
    // dan anon harus dapat [] dari tiap view (bukti perilaku).
    log.head('CHECK 6 — semua view public security_invoker & tak terbaca anon (SEC-1)');
    const views = await mgmtQuery(`
        select c.relname,
               ('security_invoker=true' = ANY(c.reloptions)) as si_on
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'v'
        order by c.relname;`);
    for (const v of views) {
        if (VIEW_ANON_ALLOWLIST.has(v.relname)) { log.pass(`${v.relname}: di allowlist anon (dilewati)`); continue; }
        // (a) struktural: security_invoker wajib menyala
        if (v.si_on === true) log.pass(`${v.relname}: security_invoker=true`);
        else log.fail(`${v.relname}: security_invoker TIDAK menyala — view bypass RLS (ALTER VIEW ... SET (security_invoker=true))`);
        // (b) perilaku: anon tak boleh dapat baris
        const { status, body } = await anonGet(anon, `${v.relname}?select=*&limit=1`);
        if (Array.isArray(body) && body.length === 0) log.pass(`${v.relname}: anon dapat [] (RLS ditegakkan)`);
        else if (!Array.isArray(body)) log.pass(`${v.relname}: anon ditolak (status ${status})`);
        else log.fail(`${v.relname}: anon BOCOR ${body.length} baris (status ${status})`);
    }

    // ── CHECK 7: Kunci eskalasi kasus (E3-1 / Langkah A) ─────────
    // Bukti PERILAKU trigger trg_case_validate_escalate: target eskalasi
    // wajib salah satu 6 peran internal kasus; DUDI hanya boleh → KAPRODI.
    // Uji via INSERT DECISION_ESCALATE dalam transaksi yang di-ROLLBACK
    // (as postgres → RLS dilewati, jadi yang teruji murni triggernya).
    log.head('CHECK 7 — kunci eskalasi: target internal-only & DUDI→Kaprodi');
    const c7 = await mgmtQuery(
        `select case_id::text, school_id::text, created_by_user_id::text
           from cases where status <> 'CLOSED' limit 1;`);
    if (c7.length === 0) {
        log.pass('SKIP — tak ada kasus non-closed untuk uji perilaku (tidak menggagalkan)');
    } else {
        const { case_id, school_id, created_by_user_id } = c7[0];
        // previous='WALI_KELAS' → tak pernah sama dgn target yg diuji (hindari
        // chk_escalate_handler_differs jadi noise di jalur positif).
        const esc = async (authorRole, target) => {
            const sql = `begin;`
                + ` insert into case_events (case_id, event_type, author_user_id, author_role_at_time,`
                + ` school_id, previous_handler_role, new_handler_role)`
                + ` values ('${case_id}','DECISION_ESCALATE','${created_by_user_id}','${authorRole}',`
                + ` '${school_id}','WALI_KELAS','${target}');`
                + ` rollback;`;
            try { await mgmtQuery(sql); return null; }
            catch (e) { return e.message; }
        };
        // Ditolak HANYA jika oleh kunci kita (bukan constraint lain).
        const blockedBy = (msg, marker) => !!msg && msg.includes(marker);
        const notOurBlock = (msg) => !msg
            || (!msg.includes('escalate_target_invalid') && !msg.includes('escalate_dudi_only_kaprodi'));
        // 7a: target eksternal (SISWA) → HARUS ditolak
        const e7a = await esc('GURU', 'SISWA');
        if (blockedBy(e7a, 'escalate_target_invalid'))
            log.pass('eskalasi ke SISWA ditolak (escalate_target_invalid)');
        else log.fail(`eskalasi ke SISWA TIDAK ditolak: ${e7a}`);
        // 7b: DUDI → KEPSEK (bukan Kaprodi) → HARUS ditolak
        const e7b = await esc('DUDI', 'KEPSEK');
        if (blockedBy(e7b, 'escalate_dudi_only_kaprodi'))
            log.pass('DUDI→KEPSEK ditolak (escalate_dudi_only_kaprodi)');
        else log.fail(`DUDI→KEPSEK TIDAK ditolak: ${e7b}`);
        // 7c: target internal sah (WAKA_KESISWAAN) → TIDAK ditolak oleh kunci ini
        const e7c = await esc('GURU', 'WAKA_KESISWAAN');
        if (notOurBlock(e7c))
            log.pass('eskalasi ke WAKA_KESISWAAN lolos kunci target (valid internal)');
        else log.fail(`eskalasi ke WAKA_KESISWAAN salah ditolak: ${e7c}`);
        // 7d: DUDI → KAPRODI → TIDAK ditolak oleh kunci DUDI
        const e7d = await esc('DUDI', 'KAPRODI');
        if (notOurBlock(e7d))
            log.pass('DUDI→KAPRODI lolos kunci (sesuai aturan)');
        else log.fail(`DUDI→KAPRODI salah ditolak: ${e7d}`);
    }

    // ── CHECK 8: PKL Ortu Cross-Tenant Isolation ─────────────────
    // Memverifikasi bahwa rls_pkl_attendance_read_ortu dan rls_pkl_read_ortu
    // (yang kini punya school_id = fn_current_school_id() — mig 190000)
    // memblokir ortu di Sekolah A dari membaca PKL Sekolah B bahkan jika
    // ada baris student_parents yang secara anomali menunjuk ke siswa B.
    //
    // PENTING: check ini TIDAK bergantung pada data PKL yang sudah ada.
    // Semua data uji (pkl_placements, pkl_attendance, student_parents silang)
    // dibuat sintetis di dalam satu transaksi yang di-ROLLBACK, sehingga
    // DB production tidak berubah.
    //
    // Syarat minimal: 2 sekolah yang masing-masing punya ortu aktif + siswa.
    // (Tidak perlu PKL asli.)
    log.head('CHECK 8 — PKL ortu cross-tenant: ortu Sekolah A TIDAK bisa baca PKL Sekolah B (sintetis, ROLLBACK)');

    // Cari 2 sekolah dengan ortu aktif + siswa + user DUDI (untuk INSERT sintetis)
    // — TIDAK butuh pkl_placements yang sudah ada.
    const c8Schools = await mgmtQuery(`
        select s.school_id::text,
               s.name,
               (select u.auth_user_id::text from users u
                 where u.school_id = s.school_id and u.role_type = 'ORTU' and u.is_active
                 limit 1) as ortu_auid,
               (select u.user_id::text from users u
                 where u.school_id = s.school_id and u.role_type = 'ORTU' and u.is_active
                 limit 1) as ortu_user_id,
               (select st.student_id::text from students st
                 where st.school_id = s.school_id
                 limit 1) as student_id,
               (select u.user_id::text from users u
                 where u.school_id = s.school_id and u.role_type = 'DUDI' and u.is_active
                 limit 1) as dudi_user_id,
               (select count(*) from students st where st.school_id = s.school_id)::int as n_students
        from schools s
        where exists (select 1 from users u
                       where u.school_id = s.school_id and u.role_type = 'ORTU' and u.is_active)
          and exists (select 1 from students st where st.school_id = s.school_id)
          and exists (select 1 from users u
                       where u.school_id = s.school_id and u.role_type = 'DUDI' and u.is_active)
        order by n_students desc
        limit 2;`);

    const c8Missing = c8Schools.length < 2
        ? `hanya ${c8Schools.length} sekolah berdata (butuh ≥2 dengan ortu+siswa+dudi)`
        : (!c8Schools[0].ortu_auid || !c8Schools[1].ortu_auid)
            ? 'salah satu sekolah tidak punya ortu aktif'
            : (!c8Schools[0].student_id || !c8Schools[1].student_id)
                ? 'salah satu sekolah tidak punya siswa'
                : (!c8Schools[0].dudi_user_id || !c8Schools[1].dudi_user_id)
                    ? 'salah satu sekolah tidak punya dudi aktif'
                    : null;

    if (c8Missing) {
        log.fail(`CHECK 8 SKIP tidak terduga — ${c8Missing} (butuh minimal 2 sekolah berisi ortu+siswa+dudi)`);
    } else {
        const [A, B] = c8Schools; // A = sekolah ortu yg diuji; B = sekolah target PKL
        const claimsA = `{"sub":"${A.ortu_auid}","role":"authenticated"}`;

        // Satu transaksi: INSERT sintetis (sebagai postgres/superuser, bypass RLS)
        // → SET ROLE authenticated (RLS aktif) → SELECT → ROLLBACK (DB bersih)
        //
        // Yang dimasukkan sintetis:
        //   (1) pkl_placements: siswa B, dudi B, school B
        //   (2) pkl_attendance: placement di atas, dicatat dudi B, school B
        //   (3) student_parents: ortu A → siswa B, school A (anomali lintas-tenant)
        //
        // RLS yang diuji:
        //   rls_pkl_read_ortu:            school_id = fn_current_school_id() AND role=ORTU AND EXISTS student_parents
        //   rls_pkl_attendance_read_ortu: school_id = fn_current_school_id() AND role=ORTU AND EXISTS student_parents
        //
        // fn_current_school_id() untuk ortu A → school A.
        // Baris sintetis ada di school B → school_id filter memblokir → 0 baris.

        // Satu transaksi utuh: INSERT sintetis sebagai postgres (bypass RLS)
        // → SET ROLE authenticated (RLS aktif) → SELECT → ROLLBACK (DB bersih).
        // Management API mengembalikan hasil statement terakhir (SELECT).
        let crossRows;
        try {
            crossRows = await mgmtQuery(
                `begin;` +

                // (1) Placement sintetis di Sekolah B (sebagai postgres, bypass RLS)
                // is_active=false agar tidak melanggar EXCLUDE CONSTRAINT
                // uq_active_pkl_per_student (berlaku hanya untuk is_active=true).
                // Policy rls_pkl_read_ortu tidak memfilter is_active, jadi baris
                // tetap terlihat bila school_id guard gagal.
                ` insert into pkl_placements` +
                `   (student_id, dudi_user_id, school_id, start_date, end_date, is_active)` +
                ` values` +
                `   ('${B.student_id}', '${B.dudi_user_id}', '${B.school_id}', '2026-01-01', '2026-06-30', false);` +

                // (2) Attendance sintetis: subquery ke placement yang baru diinsert di txn yang sama
                ` insert into pkl_attendance` +
                `   (placement_id, student_id, attendance_date, recorded_by_user_id, school_id)` +
                ` select pp.placement_id, pp.student_id, '2026-01-02', '${B.dudi_user_id}', '${B.school_id}'` +
                ` from pkl_placements pp` +
                ` where pp.student_id = '${B.student_id}'` +
                `   and pp.school_id  = '${B.school_id}'` +
                `   and pp.start_date = '2026-01-01'` +
                ` limit 1;` +

                // (3) Anomali: student_parents ortu A → siswa B
                //     school_id = sekolah A agar FK schools valid; ini inti uji cross-tenant.
                ` insert into student_parents (student_id, parent_user_id, school_id)` +
                ` values ('${B.student_id}', '${A.ortu_user_id}', '${A.school_id}')` +
                ` on conflict do nothing;` +

                // Beralih ke konteks authenticated ortu A — RLS mulai aktif
                ` set local role authenticated;` +
                ` select set_config('request.jwt.claims', $c$${claimsA}$c$, true);` +

                // Ukur: ortu A mencoba baca PKL Sekolah B
                // Dengan school_id guard: fn_current_school_id() = school A ≠ school B → 0
                ` select` +
                `   (select count(*) from pkl_placements` +
                `     where school_id = '${B.school_id}')::int as p,` +
                `   (select count(*) from pkl_attendance` +
                `     where school_id = '${B.school_id}')::int as a,` +
                `   fn_current_school_id()::text as resolved_school;` +

                ` rollback;`
            );
        } catch (e) {
            log.fail(`CHECK 8 — Transaksi sintetis gagal: ${e.message}`);
            crossRows = null;
        }

        if (crossRows !== null) {
            const cr = crossRows[0] || {};
            const p  = cr.p  ?? -1;
            const a  = cr.a  ?? -1;
            const rs = cr.resolved_school ?? '(null)';

            if (rs === A.school_id)
                log.pass(`fn_current_school_id() → ${A.name} (benar, ortu A dikontekskan)`);
            else
                log.fail(`fn_current_school_id() salah: ${rs} ≠ ${A.school_id}`);

            if (p === 0)
                log.pass(`ortu ${A.name} + anomali student_parents → 0 pkl_placements Sekolah B (school_id guard bekerja)`);
            else
                log.fail(`BOCOR: ortu ${A.name} dengan anomali student_parents melihat ${p} pkl_placements Sekolah B — school_id filter TIDAK bekerja`);

            if (a === 0)
                log.pass(`ortu ${A.name} + anomali student_parents → 0 pkl_attendance Sekolah B (school_id guard bekerja)`);
            else
                log.fail(`BOCOR: ortu ${A.name} dengan anomali student_parents melihat ${a} pkl_attendance Sekolah B — school_id filter TIDAK bekerja`);
        }
    }

    // ── CHECK 9: rls_schedules_read_parent defense-in-depth ──────
    // Memverifikasi dua hal setelah fix fase 2.2:
    //   (a) Struktural: qual policy kini mengandung ce.school_id eksplisit.
    //   (b) Fungsional (regression): ortu dengan anak terdaftar masih bisa
    //       melihat jadwal kelas anaknya — fix tidak mematahkan fitur aktif.
    log.head('CHECK 9 — rls_schedules_read_parent: ce.school_id eksplisit & regression ortu-melihat-jadwal');

    // (a) Cek struktural: qual harus mengandung ce.school_id = fn_current_school_id()
    const c9Policy = await mgmtQuery(`
        select qual from pg_policies
        where schemaname = 'public'
          and tablename  = 'teaching_schedules'
          and policyname = 'rls_schedules_read_parent'`);
    if (c9Policy.length === 0) {
        log.fail('rls_schedules_read_parent tidak ditemukan di pg_policies');
    } else {
        const qual = c9Policy[0].qual || '';
        if (qual.includes('ce.school_id = fn_current_school_id()'))
            log.pass('rls_schedules_read_parent: ce.school_id = fn_current_school_id() hadir di qual (defense-in-depth aktif)');
        else
            log.fail(`rls_schedules_read_parent: ce.school_id TIDAK ada di qual — migrasi mungkin belum ter-apply. Qual: ${qual.slice(0, 200)}`);
    }

    // (b) Regression fungsional: cari ortu yang anaknya punya class_enrollment
    //     aktif dan kelas itu punya teaching_schedules. Simulasikan konteks RLS
    //     ortu via SET ROLE, pastikan ia masih melihat ≥1 jadwal.
    const c9Data = await mgmtQuery(`
        select u.auth_user_id::text as ortu_auid,
               u.school_id::text,
               s2.name as school_name,
               ts.schedule_id::text
        from student_parents sp
        join users u on u.user_id = sp.parent_user_id and u.role_type = 'ORTU' and u.is_active
        join schools s2 on s2.school_id = u.school_id
        join class_enrollments ce on ce.student_id = sp.student_id
                                  and ce.school_id = u.school_id
                                  and ce.withdrawn_at is null
        join teaching_schedules ts on ts.class_id = ce.class_id
                                   and ts.school_id = u.school_id
        where u.auth_user_id is not null
        limit 1`);

    if (c9Data.length === 0) {
        log.pass('CHECK 9b SKIP — tidak ada data (ortu+enrollment+jadwal) untuk regression fungsional (tidak menggagalkan)');
    } else {
        const { ortu_auid, school_id, school_name } = c9Data[0];
        const claims9 = `{"sub":"${ortu_auid}","role":"authenticated"}`;
        let c9Rows;
        try {
            c9Rows = await mgmtQuery(
                `begin;` +
                ` set local role authenticated;` +
                ` select set_config('request.jwt.claims', $c9$${claims9}$c9$, true);` +
                ` select count(*)::int as n_schedules from teaching_schedules` +
                ` where school_id = '${school_id}';` +
                ` commit;`);
        } catch (e) {
            log.fail(`CHECK 9b — transaksi regression gagal: ${e.message}`);
            c9Rows = null;
        }
        if (c9Rows !== null) {
            const n = c9Rows[0]?.n_schedules ?? -1;
            if (n > 0)
                log.pass(`ortu ${school_name} masih melihat ${n} jadwal setelah fix ce.school_id — regression OK`);
            else
                log.fail(`REGRESI: ortu ${school_name} melihat 0 jadwal setelah fix ce.school_id — fitur terganggu`);
        }
    }

    // ── CHECK 10: rls_schedules_read_student defense-in-depth ────
    // Simetris dengan CHECK 9 (rls_schedules_read_parent).
    // Memverifikasi dua hal setelah fix fase 2.2 Kelompok B:
    //   (a) Struktural: qual policy kini mengandung ce.school_id eksplisit.
    //   (b) Fungsional (regression): siswa dengan enrollment aktif masih bisa
    //       melihat jadwal kelas mereka — fix tidak mematahkan fitur aktif.
    log.head('CHECK 10 — rls_schedules_read_student: ce.school_id eksplisit & regression siswa-melihat-jadwal');

    // (a) Cek struktural: qual harus mengandung ce.school_id = fn_current_school_id()
    const c10Policy = await mgmtQuery(`
        select qual from pg_policies
        where schemaname = 'public'
          and tablename  = 'teaching_schedules'
          and policyname = 'rls_schedules_read_student'`);
    if (c10Policy.length === 0) {
        log.fail('rls_schedules_read_student tidak ditemukan di pg_policies');
    } else {
        const qual = c10Policy[0].qual || '';
        if (qual.includes('ce.school_id = fn_current_school_id()'))
            log.pass('rls_schedules_read_student: ce.school_id = fn_current_school_id() hadir di qual (defense-in-depth aktif)');
        else
            log.fail(`rls_schedules_read_student: ce.school_id TIDAK ada di qual — migrasi mungkin belum ter-apply. Qual: ${qual.slice(0, 200)}`);
    }

    // (b) Regression fungsional: cari siswa yang punya class_enrollment aktif
    //     dan kelas itu punya teaching_schedules. Simulasikan konteks RLS
    //     siswa via SET ROLE, pastikan ia masih melihat ≥1 jadwal.
    const c10Data = await mgmtQuery(`
        select u.auth_user_id::text as siswa_auid,
               u.school_id::text,
               s2.name as school_name,
               ts.schedule_id::text
        from students st
        join users u on u.user_id = st.user_id and u.role_type = 'SISWA' and u.is_active
        join schools s2 on s2.school_id = u.school_id
        join class_enrollments ce on ce.student_id = st.student_id
                                  and ce.school_id = u.school_id
                                  and ce.withdrawn_at is null
        join teaching_schedules ts on ts.class_id = ce.class_id
                                   and ts.school_id = u.school_id
        where u.auth_user_id is not null
        limit 1`);

    if (c10Data.length === 0) {
        log.pass('CHECK 10b SKIP — tidak ada data (siswa+enrollment+jadwal) untuk regression fungsional (tidak menggagalkan)');
    } else {
        const { siswa_auid, school_id, school_name } = c10Data[0];
        const claims10 = `{"sub":"${siswa_auid}","role":"authenticated"}`;
        let c10Rows;
        try {
            c10Rows = await mgmtQuery(
                `begin;` +
                ` set local role authenticated;` +
                ` select set_config('request.jwt.claims', $c10$${claims10}$c10$, true);` +
                ` select count(*)::int as n_schedules from teaching_schedules` +
                ` where school_id = '${school_id}';` +
                ` commit;`);
        } catch (e) {
            log.fail(`CHECK 10b — transaksi regression gagal: ${e.message}`);
            c10Rows = null;
        }
        if (c10Rows !== null) {
            const n = c10Rows[0]?.n_schedules ?? -1;
            if (n > 0)
                log.pass(`siswa ${school_name} masih melihat ${n} jadwal setelah fix ce.school_id — regression OK`);
            else
                log.fail(`REGRESI: siswa ${school_name} melihat 0 jadwal setelah fix ce.school_id — fitur terganggu`);
        }
    }

    // ── CHECK 11: rls_cases_insert cross-tenant write guard ──────
    // Memverifikasi fix fase 2.2 Kelompok C — celah INSERT kasus untuk
    // student dari sekolah lain (school_id=A, student_id=B).
    //
    // (a) Struktural: with_check harus mengandung EXISTS student school guard.
    // (b) Serangan: staff sekolah A TIDAK bisa INSERT kasus untuk siswa B.
    // (c) Regression: staff sekolah A MASIH bisa INSERT kasus untuk siswa A.
    // Semua INSERT dalam transaksi yang di-ROLLBACK — DB tidak berubah.
    log.head('CHECK 11 — rls_cases_insert: guard student ↔ school & regression INSERT guru-sekolah-sendiri');

    // (a) Struktural: with_check harus mengandung st.school_id = fn_current_school_id()
    const c11Policy = await mgmtQuery(`
        select with_check from pg_policies
        where schemaname = 'public'
          and tablename  = 'cases'
          and policyname = 'rls_cases_insert'`);
    if (c11Policy.length === 0) {
        log.fail('rls_cases_insert tidak ditemukan di pg_policies');
    } else {
        const wc = c11Policy[0].with_check || '';
        if (wc.includes('fn_student_in_current_school(student_id)'))
            log.pass('rls_cases_insert: fn_student_in_current_school hadir di with_check (cross-tenant guard aktif)');
        else
            log.fail(`rls_cases_insert: fn_student_in_current_school TIDAK ada di with_check — migrasi mungkin belum ter-apply. Snippet: ${wc.slice(0, 200)}`);
    }

    // Data prep: cari 2 sekolah dengan GURU aktif + siswa yang TIDAK sedang PKL aktif
    const c11Schools = await mgmtQuery(`
        select s.school_id::text,
               s.name,
               (select u.auth_user_id::text from users u
                 where u.school_id = s.school_id and u.role_type = 'GURU' and u.is_active
                 limit 1) as guru_auid,
               (select u.user_id::text from users u
                 where u.school_id = s.school_id and u.role_type = 'GURU' and u.is_active
                 limit 1) as guru_user_id,
               (select st.student_id::text from students st
                 where st.school_id = s.school_id
                   and not exists (
                     select 1 from pkl_placements pp
                     where pp.student_id = st.student_id
                       and pp.school_id  = st.school_id
                       and pp.start_date <= current_date
                       and (pp.end_date is null or pp.end_date >= current_date)
                   )
                 limit 1) as student_id,
               (select count(*) from students st where st.school_id = s.school_id)::int as n_students
        from schools s
        where exists (select 1 from users u
                       where u.school_id = s.school_id and u.role_type = 'GURU' and u.is_active)
          and exists (select 1 from students st where st.school_id = s.school_id)
        order by n_students desc
        limit 2`);

    if (c11Schools.length < 2 || !c11Schools[0].guru_auid || !c11Schools[1].student_id) {
        log.pass('CHECK 11b/11c SKIP — tidak ada 2 sekolah dengan guru+siswa untuk uji perilaku (tidak menggagalkan)');
    } else {
        const [A, B] = c11Schools; // A = sekolah guru; B = sekolah target siswa
        const claims11 = `{"sub":"${A.guru_auid}","role":"authenticated"}`;

        // (b) Serangan: guru A mencoba INSERT kasus untuk siswa B → HARUS GAGAL
        let c11AttackErr = null;
        try {
            await mgmtQuery(
                `begin;` +
                ` set local role authenticated;` +
                ` select set_config('request.jwt.claims', $c11a$${claims11}$c11a$, true);` +
                ` insert into cases` +
                `   (school_id, student_id, title, description, track, audience,` +
                `    created_by_user_id, initiated_by_role, current_handler_role)` +
                ` values` +
                `   ('${A.school_id}', '${B.student_id}',` +
                `    'Test cross-tenant insert attack',` +
                `    'Deskripsi uji minimal dua puluh karakter untuk lolos cek.',` +
                `    'SEKOLAH', 'RESTRICTED',` +
                `    '${A.guru_user_id}', 'GURU', 'GURU');` +
                ` rollback;`
            );
        } catch (e) {
            c11AttackErr = e.message;
        }
        const blocked = c11AttackErr && (
            c11AttackErr.includes('42501') ||
            c11AttackErr.includes('row-level security') ||
            c11AttackErr.includes('new row violates')
        );
        if (blocked)
            log.pass(`guru ${A.name} TIDAK bisa INSERT kasus untuk siswa ${B.name} (cross-tenant INSERT ditolak)`);
        else if (c11AttackErr)
            log.fail(`guru ${A.name} → siswa ${B.name}: INSERT gagal tapi bukan karena RLS: ${c11AttackErr.slice(0, 150)}`);
        else
            log.fail(`BOCOR: guru ${A.name} berhasil INSERT kasus untuk siswa ${B.name} — cross-tenant write TIDAK terblokir`);

        // (c) Regression: guru A INSERT kasus untuk siswa A → HARUS BERHASIL
        let c11RegOk = false;
        let c11RegErr = null;
        try {
            const regRows = await mgmtQuery(
                `begin;` +
                ` set local role authenticated;` +
                ` select set_config('request.jwt.claims', $c11r$${claims11}$c11r$, true);` +
                ` insert into cases` +
                `   (school_id, student_id, title, description, track, audience,` +
                `    created_by_user_id, initiated_by_role, current_handler_role)` +
                ` values` +
                `   ('${A.school_id}', '${A.student_id}',` +
                `    'Test regression insert own school',` +
                `    'Deskripsi uji minimal dua puluh karakter untuk lolos cek.',` +
                `    'SEKOLAH', 'RESTRICTED',` +
                `    '${A.guru_user_id}', 'GURU', 'GURU');` +
                // Tidak pakai RETURNING — GURU tidak bisa SELECT kasus yang baru diinsert
                // (rls_cases_read_staff butuh fn_can_see_case). Gunakan SELECT 1 sebagai penanda sukses.
                ` select 1 as inserted_ok;` +
                ` rollback;`
            );
            c11RegOk = Array.isArray(regRows) && regRows.length > 0 && regRows[0]?.inserted_ok === 1;
        } catch (e) {
            c11RegErr = e.message;
        }
        if (c11RegOk)
            log.pass(`guru ${A.name} masih bisa INSERT kasus untuk siswa ${A.name} sendiri — regression OK (ROLLBACK, tidak ada sisa data)`);
        else if (c11RegErr)
            log.fail(`REGRESI: guru ${A.name} INSERT siswa sendiri GAGAL: ${c11RegErr.slice(0, 150)}`);
        else
            log.fail(`REGRESI: guru ${A.name} INSERT siswa sendiri tidak mengembalikan case_id — mungkin gagal diam`);
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
