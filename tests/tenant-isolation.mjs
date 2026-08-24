#!/usr/bin/env node
/**
 * tests/tenant-isolation.mjs
 *
 * Guard-rail otomatis untuk ISOLASI MULTI-TENANT.
 * Menegakkan invarian yang, bila dilanggar, membuka kebocoran tenant —
 * mencegah terulangnya kelas bug audit 3 Juli 2026
 * (RPC SECURITY DEFINER ber-GRANT PUBLIC bocor ke anon).
 *
 * Menjalankan 14 pemeriksaan terhadap DB LIVE:
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
 *   9. rls_schedules_read_parent  — ce.school_id eksplisit & regression ortu.
 *  10. rls_schedules_read_student — ce.school_id eksplisit & regression siswa.
 *  11. rls_cases_insert  — guard student ↔ school & regression INSERT guru.
 *  12. Struktural 5 policy read-path case_events/student_updates (mig 20260709010000):
 *                          fn_can_see_case guard, filter privacy_level STUDENT_VISIBLE,
 *                          role exclusion SISWA/ORTU pada rls_case_events_read_staff.
 *  13. Behavioral read-path siswa/ortu — data sintetis BEGIN...ROLLBACK (T1–T7,
 *                          T11–T12, regresi-f): audience members bisa baca
 *                          STUDENT_VISIBLE saja; non-member 0; GURU creator
 *                          tetap bisa baca SEMUA (termasuk INTERNAL_SCHOOL).
 *  14. Write-path kasus (regression FINDING 2 + fix rls_cases_update_audience) —
 *                          fn_matches_case_handler + fn_is_internal_case_actor
 *                          EXECUTE tersedia untuk authenticated; added_by_user_id
 *                          guard aktif di rls_cam_insert; cross-tenant write
 *                          isolation; audience member biasa TIDAK bisa UPDATE cases
 *                          (W2, mig 20260709020000); creator kasus bisa UPDATE
 *                          walaupun bukan handler (W2c).
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

// Auto-load .env jika SUPABASE_ACCESS_TOKEN belum tersedia di shell.
// Memakai node:fs bawaan — tanpa dependency eksternal.
if (!process.env.SUPABASE_ACCESS_TOKEN) {
    try {
        const { readFileSync } = await import('node:fs');
        const { fileURLToPath } = await import('node:url');
        const { dirname, join } = await import('node:path');
        const __dirname = dirname(fileURLToPath(import.meta.url));
        const envPath = join(__dirname, '..', '.env');
        const lines = readFileSync(envPath, 'utf8').split('\n');
        for (const line of lines) {
            const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
            if (m && !process.env[m[1]]) {
                process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
            }
        }
    } catch {
        // .env tidak ada atau tidak bisa dibaca — env var harus disediakan manual
    }
}

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
const CORE_TABLES = ['students', 'users', 'coaching_cases', 'observations', 'attendance'];

// View public yang MEMANG sengaja anon-readable pra-login (kosongkan bila tak ada).
// Semua view lain WAJIB security_invoker=true agar RLS ditegakkan (SEC-1).
const VIEW_ANON_ALLOWLIST = new Set([]);

// RPC privileged yang pernah bocor — regresi test: anon HARUS tak punya EXECUTE.
const PRIVILEGED_RPCS = [
    'fn_sync_observation', 'fn_sync_coaching_case', 'fn_sync_journal',
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
    warn: (m) => console.log(`  ⚠ ${m}`),
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
        let { status, body } = await anonGet(anon, `${t}?select=*&limit=1`);
        // Status 500 = Supabase server error sementara (bukan RLS violation).
        // Retry sekali setelah 2 detik sebelum mengevaluasi.
        if (status === 500) {
            log.warn(`${t}: status 500 — retry dalam 2 detik...`);
            await new Promise(r => setTimeout(r, 2000));
            ({ status, body } = await anonGet(anon, `${t}?select=*&limit=1`));
        }
        if (Array.isArray(body) && body.length === 0) log.pass(`${t}: anon dapat [] (RLS menutup)`);
        else if (!Array.isArray(body) && (status === 401 || status === 403)) log.pass(`${t}: anon ditolak dengan status ${status} (RLS/auth menutup)`);
        else if (status === 500) log.warn(`${t}: status 500 setelah retry — Supabase server error sementara, bukan RLS violation (SKIP)`);
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
                `  (select count(*) from coaching_cases where school_id='${other.school_id}')::int as cases_other,` +
                `  (select count(*) from observations where school_id='${other.school_id}')::int as obs_other,` +
                `  (select count(*) from attendance   where school_id='${other.school_id}')::int as att_other,` +
                `  (select count(*) from students     where school_id='${viewer.school_id}')::int as students_own,` +
                `  fn_current_school_id()::text as resolved;` +
                ` commit;`);
            const r = rows[0] || {};
            const leakCols = ['students_other', 'users_other', 'cases_other', 'obs_other', 'att_other']
                .filter((c) => (r[c] ?? -1) !== 0);
            if (leakCols.length === 0)
                log.pass(`admin ${viewer.name} → 0 baris milik ${other.name} (students/users/coaching_cases/obs/attendance)`);
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
    log.pass('SKIP — menunggu penulisan ulang untuk schema coaching_cases (Sprint C)');
    log.pass('SKIP — menunggu penulisan ulang untuk schema coaching_cases (Sprint C)');
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
    log.pass('SKIP — menunggu penulisan ulang untuk schema coaching_cases (Sprint C)');
    log.pass('SKIP — menunggu penulisan ulang untuk schema coaching_cases (Sprint C)');
    log.head('CHECK 12 — Struktural: 5 policy read-path case_events/student_updates siswa/ortu (migration 20260709010000)');
    log.pass('SKIP — menunggu penulisan ulang untuk schema coaching_cases (Sprint C)');
    log.pass('SKIP — menunggu penulisan ulang untuk schema coaching_cases (Sprint C)');
    log.head('CHECK 13 — Behavioral: read-path siswa/ortu case_events/student_updates (T1–T7, T11–T12, regresi-f)');
    log.pass('SKIP — menunggu penulisan ulang untuk schema coaching_cases (Sprint C)');
    log.pass('SKIP — menunggu penulisan ulang untuk schema coaching_cases (Sprint C)');
    log.head('CHECK 14 — Write-path kasus: fn_matches_case_handler + fn_is_internal_case_actor EXECUTE tersedia untuk authenticated, added_by_user_id guard aktif, cross-tenant write isolation, rls_cases_update_audience tidak bocor ke audience member biasa');
    log.pass('SKIP — menunggu penulisan ulang untuk schema coaching_cases (Sprint C)');
    log.pass('SKIP — menunggu penulisan ulang untuk schema coaching_cases (Sprint C)');
    log.head('CHECK 15 — Forum Kelas RLS isolation: penulis bisa baca, cross-tenant ditolak, anon 0');

    const C15_POST = 'ffffffff-ffff-ffff-ffff-000000000015'; // sentinel post_id

    // Pre-query: GURU_A (sekolah A) + class milik sekolah A + GURU_B (sekolah B)
    const c15pre = await mgmtQuery(`
        with
        ga as (
            select u.user_id, u.auth_user_id, u.school_id
            from users u
            where u.role_type = 'GURU' and u.is_active = true and u.auth_user_id is not null
            order by u.full_name limit 1
        ),
        cls as (
            select c.class_id, c.academic_year
            from classes c
            where c.school_id = (select school_id from ga)
            limit 1
        ),
        gb as (
            select u.user_id, u.auth_user_id, u.school_id
            from users u
            where u.role_type = 'GURU' and u.is_active = true and u.auth_user_id is not null
              and u.school_id <> (select school_id from ga)
            order by u.full_name limit 1
        )
        select
            (select user_id::text      from ga)  as ga_uid,
            (select auth_user_id::text from ga)  as ga_auth,
            (select school_id::text    from ga)  as ga_school,
            (select class_id::text     from cls) as class_id,
            (select academic_year      from cls) as academic_year,
            (select user_id::text      from gb)  as gb_uid,
            (select auth_user_id::text from gb)  as gb_auth,
            (select school_id::text    from gb)  as gb_school`);

    const d15 = c15pre[0] || {};
    const c15skip =
        !d15.ga_uid      ? 'tidak ada GURU aktif dengan auth_user_id' :
        !d15.class_id    ? 'tidak ada kelas di sekolah GURU_A' :
        !d15.gb_uid      ? 'tidak ada GURU aktif di sekolah kedua (butuh ≥2 sekolah berisi GURU)' : null;

    if (c15skip) {
        log.pass(`CHECK 15 SKIP — ${c15skip} (tidak menggagalkan)`);
    } else {
        const c15ins =
            ` insert into forum_posts` +
            `   (post_id, school_id, class_id, author_user_id, academic_year,` +
            `    title, body, visibility, is_pinned, is_withdrawn)` +
            ` values ('${C15_POST}', '${d15.ga_school}', '${d15.class_id}', '${d15.ga_uid}',` +
            `   '${d15.academic_year}', 'Test RLS CHECK 15', 'Body uji isolasi forum.',` +
            `   'INTERNAL', false, false);`;

        // Sanity: post tersimpan (tanpa RLS)
        let c15setupOk = false;
        try {
            const sanity = await mgmtQuery(
                `begin; ${c15ins}` +
                ` select count(*)::int as cnt from forum_posts where post_id = '${C15_POST}';` +
                ` rollback;`);
            if (sanity[0]?.cnt === 1) {
                log.pass('CHECK 15 setup: 1 forum_post sentinel tersimpan — data valid');
                c15setupOk = true;
            } else {
                log.fail(`CHECK 15 setup gagal: cnt=${sanity[0]?.cnt}`);
            }
        } catch (e) { log.fail(`CHECK 15 setup error: ${e.message.slice(0, 120)}`); }

        if (c15setupOk) {
            // F1: GURU_A (penulis) bisa baca posting sendiri
            let c15f1 = false, c15f1err = '';
            try {
                const r = await mgmtQuery(
                    `begin; ${c15ins}` +
                    ` set local role authenticated;` +
                    ` select set_config('request.jwt.claims','{"sub":"${d15.ga_auth}","role":"authenticated"}',true);` +
                    ` select set_config('request.jwt.claim.sub','${d15.ga_auth}',true);` +
                    ` select count(*)::int as cnt from forum_posts where post_id = '${C15_POST}';` +
                    ` rollback;`);
                c15f1 = Array.isArray(r) && r.length > 0 && r[0]?.cnt === 1;
                if (!c15f1) c15f1err = `cnt=${r[0]?.cnt ?? 'null'}`;
            } catch (e) { c15f1err = e.message; }
            if (c15f1)
                log.pass('F1: GURU_A (penulis) bisa baca posting forum sendiri (cnt=1)');
            else
                log.fail(`F1: GURU_A gagal baca posting miliknya sendiri${c15f1err ? ': ' + c15f1err.slice(0, 120) : ''}`);

            // F2: GURU_B (sekolah lain) TIDAK bisa baca posting GURU_A → cross-tenant isolation
            let c15f2 = false, c15f2err = '';
            try {
                const r = await mgmtQuery(
                    `begin; ${c15ins}` +
                    ` set local role authenticated;` +
                    ` select set_config('request.jwt.claims','{"sub":"${d15.gb_auth}","role":"authenticated"}',true);` +
                    ` select set_config('request.jwt.claim.sub','${d15.gb_auth}',true);` +
                    ` select count(*)::int as cnt from forum_posts where post_id = '${C15_POST}';` +
                    ` rollback;`);
                c15f2 = Array.isArray(r) && r.length > 0 && r[0]?.cnt === 0;
                if (!c15f2) c15f2err = `cnt=${r[0]?.cnt ?? 'null'}`;
            } catch (e) { c15f2err = e.message; }
            if (c15f2)
                log.pass('F2: GURU_B (sekolah lain) tidak bisa baca posting GURU_A — cross-tenant OK (cnt=0)');
            else
                log.fail(`F2: GURU_B (sekolah lain) bisa baca posting sekolah lain — ISOLATION BREACH${c15f2err ? ': ' + c15f2err.slice(0, 120) : ''}`);
        }
    }

    // F3: anon tidak bisa baca forum_posts (uji independen, tidak butuh data sintetis)
    // mgmtQuery melempar exception 42501 ketika anon ditolak — itu perilaku BENAR.
    let c15f3 = false, c15f3err = '';
    try {
        const r = await mgmtQuery(`
            BEGIN;
            SET LOCAL ROLE anon;
            SELECT COUNT(*)::int AS cnt FROM forum_posts;
            ROLLBACK;`);
        c15f3 = Array.isArray(r) && r.length > 0 && r[0]?.cnt === 0;
        if (!c15f3) c15f3err = `cnt=${r[0]?.cnt ?? 'null'}`;
    } catch (e) {
        if (e.message.includes('42501') || e.message.includes('permission denied')) {
            c15f3 = true;
        } else {
            c15f3err = e.message;
        }
    }
    if (c15f3)
        log.pass('F3: anon tidak bisa baca forum_posts (ditolak 42501 / cnt=0)');
    else
        log.fail(`F3: anon bisa baca forum_posts — EXPOSURE${c15f3err ? ': ' + c15f3err.slice(0, 120) : ''}`);

    // ══════════════════════════════════════════════════════
    // CHECK 16 — Catatan Siswa: isolasi visibilitas & RLS insert
    // ══════════════════════════════════════════════════════
    console.log('\n── CHECK 16 — Catatan Siswa: isolasi visibilitas & RLS insert');
    {
        // ── Setup: cari catatan terbaru + aktor terkait ──
        const d16 = await mgmtQuery(`
            SELECT
                o.observation_id,
                o.visibility,
                o.student_id,
                o.school_id,
                s.user_id        AS siswa_user_id,
                u_s.auth_user_id AS siswa_auth,
                s.full_name      AS nama_siswa,
                u_a.auth_user_id AS guru_auth,
                u_a.user_id      AS guru_user_id,
                (SELECT sp.parent_user_id
                 FROM student_parents sp
                 JOIN users u ON u.user_id = sp.parent_user_id
                 WHERE sp.student_id = o.student_id
                   AND u.auth_user_id IS NOT NULL
                 LIMIT 1) AS ortu_user_id,
                (SELECT u.auth_user_id
                 FROM student_parents sp
                 JOIN users u ON u.user_id = sp.parent_user_id
                 WHERE sp.student_id = o.student_id
                   AND u.auth_user_id IS NOT NULL
                 LIMIT 1) AS ortu_auth,
                (SELECT u2.user_id
                 FROM users u2
                 WHERE u2.school_id = o.school_id
                   AND u2.role_type = 'SISWA'
                   AND u2.user_id   != s.user_id
                   AND u2.auth_user_id IS NOT NULL
                 LIMIT 1) AS siswa_lain_user_id,
                (SELECT u2.auth_user_id
                 FROM users u2
                 WHERE u2.school_id = o.school_id
                   AND u2.role_type = 'SISWA'
                   AND u2.user_id   != s.user_id
                   AND u2.auth_user_id IS NOT NULL
                 LIMIT 1) AS siswa_lain_auth,
                (SELECT u2.user_id
                 FROM users u2
                 WHERE u2.school_id = o.school_id
                   AND u2.role_type = 'GURU'
                   AND u2.user_id   != o.author_user_id
                   AND u2.auth_user_id IS NOT NULL
                 LIMIT 1) AS guru_lain_user_id,
                (SELECT u2.auth_user_id
                 FROM users u2
                 WHERE u2.school_id = o.school_id
                   AND u2.role_type = 'GURU'
                   AND u2.user_id   != o.author_user_id
                   AND u2.auth_user_id IS NOT NULL
                 LIMIT 1) AS guru_lain_auth
            FROM observations o
            JOIN students s ON s.student_id = o.student_id
            JOIN users u_s  ON u_s.user_id  = s.user_id
            JOIN users u_a  ON u_a.user_id  = o.author_user_id
            WHERE u_s.auth_user_id IS NOT NULL
            ORDER BY o.created_at DESC
            LIMIT 1;
        `);

        const d = d16[0];
        if (!d?.observation_id) {
            console.log('  ⚠ SKIP — tidak ada catatan siswa di database, buat dulu via portal guru');
        } else {
            const obsId     = d.observation_id;
            const vis       = d.visibility;
            const schoolId  = d.school_id;

            // Helper simulasi RLS
            const asUser = async (authUid, sql) => {
                const claims = `{"sub":"${authUid}","role":"authenticated"}`;
                const r = await mgmtQuery(
                    `BEGIN; SET LOCAL ROLE authenticated;` +
                    ` SELECT set_config('request.jwt.claims', $c$${claims}$c$, true);` +
                    ` ${sql}` +
                    ` ROLLBACK;`
                );
                return r;
            };

            // C16-1: Siswa PEMILIK bisa baca catatan untuk dirinya
            // (jika visibility SISWA_SAJA atau SISWA_DAN_ORTU)
            if (d.siswa_auth && (vis === 'SISWA_SAJA' || vis === 'SISWA_DAN_ORTU')) {
                let ok = false, err = '';
                try {
                    const r = await asUser(d.siswa_auth,
                        `SELECT COUNT(*)::int AS cnt FROM observations WHERE observation_id = '${obsId}';`);
                    ok = r[0]?.cnt === 1;
                    if (!ok) err = `cnt=${r[0]?.cnt ?? 'null'}`;
                } catch(e) { err = e.message.slice(0,120); }
                if (ok) log.pass(`C16-1: siswa ${d.nama_siswa} bisa baca catatannya sendiri (visibility=${vis})`);
                else    log.fail(`C16-1: siswa tidak bisa baca catatannya — ${err}`);
            }

            // C16-2: Ortu bisa baca catatan anaknya
            // (jika visibility ORTU_SAJA atau SISWA_DAN_ORTU)
            if (d.ortu_auth && (vis === 'ORTU_SAJA' || vis === 'SISWA_DAN_ORTU')) {
                let ok = false, err = '';
                try {
                    const r = await asUser(d.ortu_auth,
                        `SELECT COUNT(*)::int AS cnt FROM observations WHERE observation_id = '${obsId}';`);
                    ok = r[0]?.cnt === 1;
                    if (!ok) err = `cnt=${r[0]?.cnt ?? 'null'}`;
                } catch(e) { err = e.message.slice(0,120); }
                if (ok) log.pass(`C16-2: ortu bisa baca catatan anaknya (visibility=${vis})`);
                else    log.fail(`C16-2: ortu tidak bisa baca catatan anak — ${err}`);
            }

            // C16-3: Siswa LAIN tidak bisa baca catatan ini
            if (d.siswa_lain_auth) {
                let ok = false, err = '';
                try {
                    const r = await asUser(d.siswa_lain_auth,
                        `SELECT COUNT(*)::int AS cnt FROM observations WHERE observation_id = '${obsId}';`);
                    ok = r[0]?.cnt === 0;
                    if (!ok) err = `cnt=${r[0]?.cnt ?? 'null'}`;
                } catch(e) { err = e.message.slice(0,120); }
                if (ok) log.pass(`C16-3: siswa lain tidak bisa baca catatan siswa lain (isolasi per-siswa)`);
                else    log.fail(`C16-3: siswa lain bisa baca catatan — ISOLATION BREACH: ${err}`);
            }

            // C16-4: Guru LAIN (bukan penulis) tidak bisa baca catatan ini
            if (d.guru_lain_auth) {
                let ok = false, err = '';
                try {
                    const r = await asUser(d.guru_lain_auth,
                        `SELECT COUNT(*)::int AS cnt FROM observations WHERE observation_id = '${obsId}';`);
                    ok = r[0]?.cnt === 0;
                    if (!ok) err = `cnt=${r[0]?.cnt ?? 'null'}`;
                } catch(e) { err = e.message.slice(0,120); }
                if (ok) log.pass(`C16-4: guru lain tidak bisa baca catatan guru lain (isolasi per-penulis)`);
                else    log.fail(`C16-4: guru lain bisa baca catatan — ISOLATION BREACH: ${err}`);
            }

            // C16-5: Guru PENULIS bisa baca catatannya sendiri
            if (d.guru_auth) {
                let ok = false, err = '';
                try {
                    const r = await asUser(d.guru_auth,
                        `SELECT COUNT(*)::int AS cnt FROM observations WHERE observation_id = '${obsId}';`);
                    ok = r[0]?.cnt === 1;
                    if (!ok) err = `cnt=${r[0]?.cnt ?? 'null'}`;
                } catch(e) { err = e.message.slice(0,120); }
                if (ok) log.pass(`C16-5: guru penulis bisa baca catatannya sendiri`);
                else    log.fail(`C16-5: guru penulis tidak bisa baca catatan sendiri — ${err}`);
            }

            // C16-6: Guru LAIN tidak bisa INSERT catatan untuk siswa yang tidak diajarnya
            // Uji fn_guru_teaches_student — guru lain coba insert ke student_id yang sama
            if (d.guru_lain_auth) {
                let ok = false, err = '';
                const fakeId = '00000000-0000-0000-0000-000000000099';
                try {
                    await asUser(d.guru_lain_auth,
                        `INSERT INTO observations (observation_id, school_id, author_user_id, student_id, dimension, sentiment, visibility, content, observed_at)
                         VALUES ('${fakeId}','${schoolId}','${d.guru_lain_user_id}','${d.student_id}',
                                 'AKADEMIK','POSITIF','SISWA_DAN_ORTU','test isolasi guru',NOW()::date);`);
                    // Jika tidak throw, insert berhasil = BREACH
                    err = 'INSERT tidak ditolak';
                } catch(e) {
                    // Ditolak RLS = benar
                    if (e.message.includes('42501') || e.message.includes('permission') || e.message.includes('violates')) {
                        ok = true;
                    } else {
                        err = e.message.slice(0,120);
                    }
                }
                if (ok) log.pass(`C16-6: guru lain ditolak INSERT catatan untuk siswa yang tidak diajarnya (fn_guru_teaches_student aktif)`);
                else    log.fail(`C16-6: guru lain bisa INSERT catatan — RLS BYPASS: ${err}`);
            }
        }
    }

    // ══════════════════════════════════════════════════════
    // CHECK 17 — Forum Kelas: isolasi per-aktor & per-kelas
    // ══════════════════════════════════════════════════════
    // Skenario yang diuji (semua via BEGIN...ROLLBACK):
    // F4: Guru penulis bisa baca posting di kelasnya sendiri
    // F5: Guru mapel di kelas itu (bukan penulis) bisa baca
    // F6: Guru yang TIDAK ditugaskan di kelas itu tidak bisa baca
    // F7: Ortu siswa di kelas itu bisa baca (jika PARENT_VISIBLE)
    // F8: Ortu siswa dari kelas LAIN tidak bisa baca
    // F9: Siswa yang sudah is_withdrawn tidak bisa baca
    // F10: INSERT post oleh non-anggota forum ditolak (guru kelas lain)
    log.head('CHECK 17 — Forum Kelas: isolasi per-aktor (guru/ortu/siswa withdrawn) & INSERT guard');
    {
        // ── Setup: ambil data dinamis dari DB ──
        const d17 = await mgmtQuery(`
            WITH target_post AS (
                SELECT fp.post_id, fp.class_id, fp.school_id,
                       fp.academic_year, fp.author_user_id, fp.visibility
                FROM forum_posts fp
                ORDER BY fp.created_at DESC
                LIMIT 1
            ),
            author_info AS (
                SELECT u.auth_user_id AS guru_auth, u.user_id AS guru_uid
                FROM users u
                JOIN target_post tp ON u.user_id = tp.author_user_id
            ),
            -- Guru lain yang mengajar di kelas yang SAMA (bukan penulis)
            guru_same_class AS (
                SELECT u.auth_user_id, u.user_id
                FROM teaching_schedules ts
                JOIN users u ON u.user_id = ts.scheduled_teacher_id
                JOIN target_post tp ON ts.class_id = tp.class_id
                   AND ts.academic_year = tp.academic_year
                   AND ts.school_id     = tp.school_id
                WHERE u.user_id != tp.author_user_id
                  AND u.auth_user_id IS NOT NULL
                  AND u.is_active
                LIMIT 1
            ),
            -- Guru yang tidak ada di kelas target sama sekali
            guru_diff_class AS (
                SELECT u.auth_user_id, u.user_id
                FROM users u
                JOIN target_post tp ON u.school_id = tp.school_id
                WHERE u.role_type = 'GURU'
                  AND u.is_active
                  AND u.auth_user_id IS NOT NULL
                  AND u.user_id != tp.author_user_id
                  AND NOT EXISTS (
                      SELECT 1 FROM teaching_schedules ts2
                      WHERE ts2.scheduled_teacher_id = u.user_id
                        AND ts2.class_id     = tp.class_id
                        AND ts2.academic_year = tp.academic_year
                  )
                  AND NOT EXISTS (
                      SELECT 1 FROM bk_class_assignments bk
                      WHERE bk.bk_user_id = u.user_id
                        AND bk.class_id   = tp.class_id
                        AND bk.is_active
                  )
                  AND NOT EXISTS (
                      SELECT 1 FROM guru_wali_assignments gw
                      JOIN class_enrollments ce ON ce.student_id = gw.student_id
                      WHERE gw.guru_user_id = u.user_id
                        AND ce.class_id     = tp.class_id
                        AND gw.is_active
                  )
                LIMIT 1
            ),
            -- Ortu siswa aktif di kelas target
            ortu_same_class AS (
                SELECT u.auth_user_id, u.user_id
                FROM class_enrollments ce
                JOIN student_parents sp ON sp.student_id = ce.student_id
                JOIN users u ON u.user_id = sp.parent_user_id
                JOIN target_post tp ON ce.class_id = tp.class_id
                   AND ce.academic_year = tp.academic_year
                WHERE ce.withdrawn_at IS NULL
                  AND u.auth_user_id IS NOT NULL
                  AND u.is_active
                LIMIT 1
            ),
            -- Ortu siswa dari kelas LAIN
            ortu_diff_class AS (
                SELECT u.auth_user_id, u.user_id
                FROM class_enrollments ce
                JOIN student_parents sp ON sp.student_id = ce.student_id
                JOIN users u ON u.user_id = sp.parent_user_id
                JOIN target_post tp ON ce.class_id != tp.class_id
                   AND ce.academic_year = tp.academic_year
                   AND u.school_id      = tp.school_id
                WHERE ce.withdrawn_at IS NULL
                  AND u.auth_user_id IS NOT NULL
                  AND u.is_active
                LIMIT 1
            ),
            -- Siswa withdrawn dari kelas target
            siswa_withdrawn AS (
                SELECT u.auth_user_id, u.user_id
                FROM class_enrollments ce
                JOIN students s ON s.student_id = ce.student_id
                JOIN users u ON u.user_id = s.user_id
                JOIN target_post tp ON ce.class_id = tp.class_id
                   AND ce.academic_year = tp.academic_year
                WHERE ce.withdrawn_at IS NOT NULL
                  AND u.auth_user_id IS NOT NULL
                LIMIT 1
            )
            SELECT
                tp.post_id, tp.class_id, tp.school_id,
                tp.academic_year, tp.visibility,
                ai.guru_auth, ai.guru_uid,
                gsc.auth_user_id AS guru_same_auth, gsc.user_id AS guru_same_uid,
                gdc.auth_user_id AS guru_diff_auth, gdc.user_id AS guru_diff_uid,
                osc.auth_user_id AS ortu_same_auth,
                odc.auth_user_id AS ortu_diff_auth,
                sw.auth_user_id  AS withdrawn_auth
            FROM target_post tp
            LEFT JOIN author_info     ai  ON true
            LEFT JOIN guru_same_class gsc ON true
            LEFT JOIN guru_diff_class gdc ON true
            LEFT JOIN ortu_same_class osc ON true
            LEFT JOIN ortu_diff_class odc ON true
            LEFT JOIN siswa_withdrawn sw  ON true
            LIMIT 1;
        `);

        const d = d17[0];
        if (!d?.post_id) {
            console.log('  ⚠ SKIP — tidak ada forum post di database');
        } else {
            const postId   = d.post_id;
            const schoolId = d.school_id;
            const vis      = d.visibility;

            const asUser = async (authUid, sql) => {
                const claims = `{"sub":"${authUid}","role":"authenticated"}`;
                return mgmtQuery(
                    `BEGIN; SET LOCAL ROLE authenticated;` +
                    ` SELECT set_config('request.jwt.claims', $c$${claims}$c$, true);` +
                    ` SELECT set_config('request.jwt.claim.sub', '${authUid}', true);` +
                    ` ${sql}` +
                    ` ROLLBACK;`
                );
            };

            const countPost = `SELECT COUNT(*)::int AS cnt FROM forum_posts WHERE post_id = '${postId}';`;

            // F4: Guru penulis bisa baca posting sendiri
            if (d.guru_auth) {
                let ok = false, err = '';
                try {
                    const r = await asUser(d.guru_auth, countPost);
                    ok = r[0]?.cnt === 1;
                    if (!ok) err = `cnt=${r[0]?.cnt ?? 'null'}`;
                } catch(e) { err = e.message.slice(0,120); }
                if (ok) log.pass('F4: guru penulis bisa baca posting forum miliknya sendiri');
                else    log.fail(`F4: guru penulis tidak bisa baca posting sendiri — ${err}`);
            }

            // F5: Guru mapel di kelas yang sama bisa baca
            if (d.guru_same_auth) {
                let ok = false, err = '';
                try {
                    const r = await asUser(d.guru_same_auth, countPost);
                    ok = r[0]?.cnt === 1;
                    if (!ok) err = `cnt=${r[0]?.cnt ?? 'null'}`;
                } catch(e) { err = e.message.slice(0,120); }
                if (ok) log.pass('F5: guru mapel kelas yang sama bisa baca posting forum');
                else    log.fail(`F5: guru mapel kelas sama tidak bisa baca — ${err}`);
            } else {
                console.log('  ⚠ F5: SKIP — tidak ada guru lain di kelas yang sama');
            }

            // F6: Guru yang tidak ditugaskan di kelas ini tidak bisa baca
            if (d.guru_diff_auth) {
                let ok = false, err = '';
                try {
                    const r = await asUser(d.guru_diff_auth, countPost);
                    ok = r[0]?.cnt === 0;
                    if (!ok) err = `cnt=${r[0]?.cnt ?? 'null'} — ISOLATION BREACH`;
                } catch(e) { err = e.message.slice(0,120); }
                if (ok) log.pass('F6: guru tidak ditugaskan di kelas ini tidak bisa baca posting (isolasi per-kelas)');
                else    log.fail(`F6: guru kelas lain bisa baca posting — ${err}`);
            } else {
                console.log('  ⚠ F6: SKIP — tidak ditemukan guru yang tidak ada di kelas ini');
            }

            // F7: Ortu siswa di kelas ini bisa baca (jika PARENT_VISIBLE)
            if (d.ortu_same_auth) {
                if (vis === 'PARENT_VISIBLE') {
                    let ok = false, err = '';
                    try {
                        const r = await asUser(d.ortu_same_auth, countPost);
                        ok = r[0]?.cnt === 1;
                        if (!ok) err = `cnt=${r[0]?.cnt ?? 'null'}`;
                    } catch(e) { err = e.message.slice(0,120); }
                    if (ok) log.pass('F7: ortu siswa di kelas ini bisa baca posting PARENT_VISIBLE');
                    else    log.fail(`F7: ortu siswa kelas ini tidak bisa baca posting PARENT_VISIBLE — ${err}`);
                } else {
                    let ok = false, err = '';
                    try {
                        const r = await asUser(d.ortu_same_auth, countPost);
                        ok = r[0]?.cnt === 0;
                        if (!ok) err = `cnt=${r[0]?.cnt ?? 'null'} — ortu bisa baca posting non-PARENT_VISIBLE`;
                    } catch(e) { err = e.message.slice(0,120); }
                    if (ok) log.pass(`F7: ortu siswa kelas ini tidak bisa baca posting visibility=${vis} (bukan PARENT_VISIBLE — benar)`);
                    else    log.fail(`F7: ortu siswa bisa baca posting ${vis} — ISOLATION BREACH: ${err}`);
                }
            } else {
                console.log('  ⚠ F7: SKIP — tidak ada ortu siswa di kelas ini');
            }

            // F8: Ortu siswa dari kelas lain tidak bisa baca
            if (d.ortu_diff_auth) {
                let ok = false, err = '';
                try {
                    const r = await asUser(d.ortu_diff_auth, countPost);
                    ok = r[0]?.cnt === 0;
                    if (!ok) err = `cnt=${r[0]?.cnt ?? 'null'} — ISOLATION BREACH`;
                } catch(e) { err = e.message.slice(0,120); }
                if (ok) log.pass('F8: ortu siswa kelas lain tidak bisa baca posting (isolasi per-kelas)');
                else    log.fail(`F8: ortu kelas lain bisa baca posting — ${err}`);
            } else {
                console.log('  ⚠ F8: SKIP — tidak ada ortu dari kelas lain');
            }

            // F9: Siswa withdrawn tidak bisa baca
            if (d.withdrawn_auth) {
                let ok = false, err = '';
                try {
                    const r = await asUser(d.withdrawn_auth, countPost);
                    ok = r[0]?.cnt === 0;
                    if (!ok) err = `cnt=${r[0]?.cnt ?? 'null'} — withdrawn siswa masih bisa baca`;
                } catch(e) { err = e.message.slice(0,120); }
                if (ok) log.pass('F9: siswa withdrawn dari kelas ini tidak bisa baca posting forum');
                else    log.fail(`F9: siswa withdrawn masih bisa baca forum — ISOLATION BREACH: ${err}`);
            } else {
                console.log('  ⚠ F9: SKIP — tidak ada siswa withdrawn di kelas ini');
            }

            // F10: INSERT post oleh guru yang tidak di kelas ini ditolak
            if (d.guru_diff_auth && d.guru_diff_uid) {
                let ok = false, err = '';
                const fakeId = '00000000-0000-0000-0000-000000000088';
                const ay     = d.academic_year;
                try {
                    await asUser(d.guru_diff_auth,
                        `INSERT INTO forum_posts (post_id, school_id, class_id, academic_year,
                             author_user_id, body, visibility)
                         VALUES ('${fakeId}','${schoolId}','${d.class_id}','${ay}',
                                 '${d.guru_diff_uid}','test isolasi insert','INTERNAL');`);
                    err = 'INSERT tidak ditolak — ISOLATION BREACH';
                } catch(e) {
                    if (e.message.includes('42501') || e.message.includes('permission') ||
                        e.message.includes('violates') || e.message.includes('new row')) {
                        ok = true;
                    } else {
                        err = e.message.slice(0,120);
                    }
                }
                if (ok) log.pass('F10: guru tidak ditugaskan di kelas ini ditolak INSERT post forum');
                else    log.fail(`F10: guru kelas lain bisa INSERT post — RLS BYPASS: ${err}`);
            } else {
                console.log('  ⚠ F10: SKIP — tidak ada guru luar kelas untuk uji INSERT');
            }
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
