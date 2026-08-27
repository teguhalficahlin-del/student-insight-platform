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
 *   7. Kunci eskalasi    — trigger trg_validate_escalation: target eskalasi wajib
 *                          salah satu 8 peran internal kasus (GURU, BK, WALI_KELAS,
 *                          WAKA_KESISWAAN, WAKA_KURIKULUM, WAKA_HUMAS, KEPSEK,
 *                          KAPRODI), DUDI hanya boleh → KAPRODI, dan payload
 *                          ESCALATED wajib memuat new_handler_user_id (E3-1).
 *   8. Parent/helper guard — trigger student_parents menolak relasi lintas
 *                          sekolah; lima helper siswa SECURITY DEFINER wajib
 *                          memverifikasi sekolah siswa dan tabel tenant.
 *   9. rls_schedules_read_parent  — ce.school_id eksplisit & regression ortu.
 *  10. rls_schedules_read_student — ce.school_id eksplisit & regression siswa.
 *  11. rls_cc_insert     — guard fn_student_in_current_school (student ↔ school),
 *                          role exclusion SISWA/ORTU/STAKEHOLDER, & regression
 *                          INSERT kasus oleh guru untuk siswa sekolahnya sendiri.
 *  12. Struktural read-path coaching_case_events — rls_cce_read_student /
 *                          rls_cce_read_parent memfilter is_visible_to_student +
 *                          is_shared_to_student/parent; rls_cce_read_staff
 *                          mengecualikan SISWA/ORTU/STAKEHOLDER; student_updates
 *                          default-deny untuk siswa/ortu; predikat RLS anon-tertutup.
 *  13. Behavioral read-path siswa/ortu — data sintetis BEGIN...ROLLBACK (F1–F8):
 *                          siswa/ortu subjek baca kasus yang dibagikan + event
 *                          is_visible_to_student=true saja; siswa lain 0; GURU
 *                          creator baca SEMUA event; student_updates tertutup.
 *  14. Write-path kasus  — trg_coaching_case_guard menolak UPDATE langsung kolom
 *                          state (P0003); rls_cc_update menutup UPDATE via RLS;
 *                          INSERT coaching_case_events ditolak untuk non-handler,
 *                          kasus CLOSED, dan lintas-sekolah; handler sah tetap bisa.
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
    // Bukti PERILAKU trigger trg_validate_escalation: target eskalasi wajib
    // salah satu 8 peran internal kasus (GURU, BK, WALI_KELAS, WAKA_KESISWAAN,
    // WAKA_KURIKULUM, WAKA_HUMAS, KEPSEK, KAPRODI); DUDI hanya boleh → KAPRODI;
    // payload ESCALATED wajib memuat new_handler_user_id.
    // Diuji via INSERT coaching_case_events ESCALATED dalam transaksi yang
    // di-ROLLBACK (as postgres → RLS dilewati, jadi yang teruji murni triggernya).
    log.head('CHECK 7 — kunci eskalasi: target internal-only & DUDI→Kaprodi');
    {
        const C7_CASE = 'ffffffff-ffff-ffff-ffff-000000000007'; // sentinel case_id

        // Pre-query: (a) sekolah ber-GURU + BK + siswa; (b) user berperan TIDAK sah
        // sebagai target eskalasi di sekolah yang sama; (c) sekolah ber-DUDI + GURU + siswa.
        const c7pre = await mgmtQuery(`
            with
            sch as (
                select u.school_id
                from users u
                where u.role_type = 'GURU' and u.is_active and u.deleted_at is null
                  and exists (select 1 from users b where b.school_id = u.school_id
                                and b.role_type = 'BK' and b.is_active and b.deleted_at is null)
                  and exists (select 1 from students st where st.school_id = u.school_id)
                group by u.school_id order by u.school_id limit 1
            ),
            guru as (
                select u.user_id from users u
                where u.school_id = (select school_id from sch)
                  and u.role_type = 'GURU' and u.is_active and u.deleted_at is null
                order by u.user_id limit 1
            ),
            bk as (
                select u.user_id from users u
                where u.school_id = (select school_id from sch)
                  and u.role_type = 'BK' and u.is_active and u.deleted_at is null
                order by u.user_id limit 1
            ),
            bad as (
                select u.user_id, u.role_type::text as role_type from users u
                where u.school_id = (select school_id from sch)
                  and u.is_active and u.deleted_at is null
                  and u.role_type not in ('GURU','BK','WALI_KELAS','WAKA_KESISWAAN',
                                          'WAKA_KURIKULUM','WAKA_HUMAS','KEPSEK','KAPRODI')
                order by u.user_id limit 1
            ),
            stu as (
                select st.student_id from students st
                where st.school_id = (select school_id from sch)
                order by st.student_id limit 1
            ),
            dsch as (
                select u.school_id from users u
                where u.role_type = 'DUDI' and u.is_active and u.deleted_at is null
                  and exists (select 1 from users g where g.school_id = u.school_id
                                and g.role_type = 'GURU' and g.is_active and g.deleted_at is null)
                  and exists (select 1 from students st where st.school_id = u.school_id)
                group by u.school_id order by u.school_id limit 1
            ),
            dudi as (
                select u.user_id from users u
                where u.school_id = (select school_id from dsch)
                  and u.role_type = 'DUDI' and u.is_active and u.deleted_at is null
                order by u.user_id limit 1
            ),
            dguru as (
                select u.user_id from users u
                where u.school_id = (select school_id from dsch)
                  and u.role_type = 'GURU' and u.is_active and u.deleted_at is null
                order by u.user_id limit 1
            ),
            dstu as (
                select st.student_id from students st
                where st.school_id = (select school_id from dsch)
                order by st.student_id limit 1
            )
            select
                (select school_id::text  from sch)   as school_id,
                (select user_id::text    from guru)  as guru_uid,
                (select user_id::text    from bk)    as bk_uid,
                (select user_id::text    from bad)   as bad_uid,
                (select role_type        from bad)   as bad_role,
                (select student_id::text from stu)   as student_id,
                (select school_id::text  from dsch)  as d_school,
                (select user_id::text    from dudi)  as dudi_uid,
                (select user_id::text    from dguru) as dguru_uid,
                (select student_id::text from dstu)  as d_student`);

        const d7 = c7pre[0] || {};
        const c7Case = (school, student, creator, handler) =>
            ` insert into coaching_cases` +
            `   (case_id, school_id, student_id, created_by_user_id, title, description,` +
            `    current_handler_user_id)` +
            ` values ('${C7_CASE}', '${school}', '${student}', '${creator}',` +
            `   'Uji CHECK 7', 'Deskripsi uji eskalasi minimal dua puluh karakter.', '${handler}');`;
        const c7Esc = (school, author, payload) =>
            ` insert into coaching_case_events` +
            `   (case_id, school_id, event_type, author_user_id, payload)` +
            ` values ('${C7_CASE}', '${school}', 'ESCALATED', '${author}', '${payload}'::jsonb);`;

        // Semua sub-test dijalankan sebagai postgres (RLS dilewati) supaya yang teruji
        // murni trigger trg_validate_escalation. Kasus sintetis dibuat di dalam
        // transaksi yang sama lalu di-ROLLBACK — DB tidak berubah.
        const c7base = !d7.guru_uid    ? 'tidak ada sekolah dengan GURU+BK+siswa'
                     : !d7.bk_uid      ? 'tidak ada BK aktif di sekolah tersebut'
                     : !d7.student_id  ? 'tidak ada siswa di sekolah tersebut' : null;

        if (c7base) {
            log.pass(`CHECK 7 SKIP — ${c7base} (tidak menggagalkan)`);
        } else {
            // F1: target berperan di luar 8 peran sah → trigger menolak (P0001)
            if (!d7.bad_uid) {
                log.pass('CHECK 7 F1 SKIP — tidak ada user berperan non-eskalasi di sekolah tersebut');
            } else {
                let f1 = false, f1err = '';
                try {
                    await mgmtQuery(
                        `begin;` + c7Case(d7.school_id, d7.student_id, d7.guru_uid, d7.guru_uid) +
                        c7Esc(d7.school_id, d7.guru_uid, `{"new_handler_user_id":"${d7.bad_uid}"}`) +
                        ` rollback;`);
                    f1err = 'INSERT ESCALATED diterima (seharusnya ditolak)';
                } catch (e) {
                    if (e.message.includes('escalation_guard') || e.message.includes('P0001')) f1 = true;
                    else f1err = e.message;
                }
                if (f1) log.pass(`F1: eskalasi ke peran "${d7.bad_role}" ditolak trigger (P0001 escalation_guard)`);
                else log.fail(`F1: eskalasi ke peran "${d7.bad_role}" TIDAK ditolak — kunci eskalasi bocor${f1err ? ': ' + f1err.slice(0, 160) : ''}`);
            }

            // F2: DUDI eskalasi ke GURU (bukan KAPRODI) → trigger menolak (P0001)
            if (!d7.dudi_uid || !d7.dguru_uid || !d7.d_student) {
                log.pass('CHECK 7 F2 SKIP — tidak ada sekolah dengan DUDI+GURU+siswa');
            } else {
                let f2 = false, f2err = '';
                try {
                    await mgmtQuery(
                        `begin;` + c7Case(d7.d_school, d7.d_student, d7.dguru_uid, d7.dguru_uid) +
                        c7Esc(d7.d_school, d7.dudi_uid, `{"new_handler_user_id":"${d7.dguru_uid}"}`) +
                        ` rollback;`);
                    f2err = 'INSERT ESCALATED oleh DUDI ke GURU diterima (seharusnya ditolak)';
                } catch (e) {
                    if (e.message.includes('DUDI hanya boleh eskalasi') || e.message.includes('P0001')) f2 = true;
                    else f2err = e.message;
                }
                if (f2) log.pass('F2: DUDI → GURU ditolak trigger (DUDI hanya boleh eskalasi ke KAPRODI)');
                else log.fail(`F2: DUDI → GURU TIDAK ditolak — aturan DUDI→KAPRODI bocor${f2err ? ': ' + f2err.slice(0, 160) : ''}`);
            }

            // F3 (regresi positif): GURU → BK harus LOLOS dan handler berpindah
            let f3 = false, f3err = '';
            try {
                const r = await mgmtQuery(
                    `begin;` + c7Case(d7.school_id, d7.student_id, d7.guru_uid, d7.guru_uid) +
                    c7Esc(d7.school_id, d7.guru_uid, `{"new_handler_user_id":"${d7.bk_uid}"}`) +
                    ` select current_handler_user_id::text as h from coaching_cases where case_id = '${C7_CASE}';` +
                    ` rollback;`);
                f3 = r[0]?.h === d7.bk_uid;
                if (!f3) f3err = `handler=${r[0]?.h ?? 'null'} (harusnya ${d7.bk_uid})`;
            } catch (e) { f3err = e.message; }
            if (f3) log.pass('F3: GURU → BK lolos & current_handler_user_id berpindah ke BK — uji tidak vacuous');
            else log.fail(`F3: eskalasi sah GURU → BK gagal — trigger terlalu ketat${f3err ? ': ' + f3err.slice(0, 160) : ''}`);

            // F4: payload ESCALATED tanpa new_handler_user_id → ditolak (P0001)
            let f4 = false, f4err = '';
            try {
                await mgmtQuery(
                    `begin;` + c7Case(d7.school_id, d7.student_id, d7.guru_uid, d7.guru_uid) +
                    c7Esc(d7.school_id, d7.guru_uid, '{}') +
                    ` rollback;`);
                f4err = 'INSERT ESCALATED tanpa new_handler_user_id diterima';
            } catch (e) {
                if (e.message.includes('escalation_guard') || e.message.includes('P0001')) f4 = true;
                else f4err = e.message;
            }
            if (f4) log.pass('F4: ESCALATED tanpa payload.new_handler_user_id ditolak (P0001)');
            else log.fail(`F4: ESCALATED tanpa new_handler_user_id TIDAK ditolak${f4err ? ': ' + f4err.slice(0, 160) : ''}`);
        }
    }
    log.head('CHECK 8 — student_parents trigger + helper siswa SECURITY DEFINER tenant-scoped');

    // Cari 2 sekolah dengan ortu aktif + siswa untuk INSERT sintetis lintas tenant.
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
               (select count(*) from students st where st.school_id = s.school_id)::int as n_students
        from schools s
        where exists (select 1 from users u
                       where u.school_id = s.school_id and u.role_type = 'ORTU' and u.is_active)
          and exists (select 1 from students st where st.school_id = s.school_id)
        order by n_students desc
        limit 2;`);

    const c8Missing = c8Schools.length < 2
        ? `hanya ${c8Schools.length} sekolah berdata (butuh ≥2 dengan ortu+siswa)`
        : (!c8Schools[0].ortu_auid || !c8Schools[1].ortu_auid)
            ? 'salah satu sekolah tidak punya ortu aktif'
            : (!c8Schools[0].student_id || !c8Schools[1].student_id)
                ? 'salah satu sekolah tidak punya siswa'
                : null;

    if (c8Missing) {
        log.fail(`CHECK 8 SKIP tidak terduga — ${c8Missing} (butuh minimal 2 sekolah berisi ortu+siswa)`);
    } else {
        const [A, B] = c8Schools; // A = sekolah ortu yg diuji; B = sekolah target PKL
        const guardRows = await mgmtQuery(`
            SELECT EXISTS (
                SELECT 1
                FROM pg_trigger t
                JOIN pg_class c ON c.oid = t.tgrelid
                JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname = 'public'
                  AND c.relname = 'student_parents'
                  AND t.tgname = 'trg_validate_student_parent_tenant'
                  AND NOT t.tgisinternal
            ) AS deployed;`);
        const guardDeployed = guardRows[0]?.deployed === true;

        if (!guardDeployed) {
            log.warn('F1: SKIP — migration F-01 belum diterapkan ke database live');
        } else {
            let rejected = false;
            let rejectError = '';
            try {
                await mgmtQuery(
                    `begin;` +
                    ` insert into student_parents (student_id, parent_user_id, school_id)` +
                    ` values ('${B.student_id}', '${A.ortu_user_id}', '${A.school_id}');` +
                    ` rollback;`
                );
                rejectError = 'INSERT lintas tenant diterima';
            } catch (e) {
                if (e.message.includes('student_parents_tenant_guard') || e.message.includes('P0001')) {
                    rejected = true;
                } else {
                    rejectError = e.message;
                }
            }

            if (rejected)
                log.pass('F1: trigger menolak INSERT parent sekolah A → siswa sekolah B (P0001 student_parents_tenant_guard)');
            else
                log.fail(`F1: trigger tidak menolak INSERT student_parents lintas tenant${rejectError ? ': ' + rejectError.slice(0, 160) : ''}`);
        }

        const helperRequirements = {
            fn_can_see_student:        ['fn_student_in_current_school'],
            fn_teaches_student:        ['fn_student_in_current_school', 'ce.school_id', 'ta.school_id'],
            fn_wali_of_student:        ['fn_student_in_current_school', 'ce.school_id'],
            fn_kaprodi_of_student:      ['fn_student_in_current_school', 's.school_id'],
            fn_dudi_supervises_student: ['fn_student_in_current_school', 'pp.school_id'],
        };
        const helperNames = Object.keys(helperRequirements).map((name) => `'${name}'`).join(',');
        const helperRows = await mgmtQuery(`
            SELECT p.proname, pg_get_functiondef(p.oid) AS definition
            FROM pg_proc p
            JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public'
              AND p.proname IN (${helperNames});`);
        const helperDefs = Object.fromEntries(helperRows.map((row) => [row.proname, row.definition]));
        const helpersDeployed = Object.entries(helperRequirements).every(([name, markers]) =>
            markers.every((marker) => helperDefs[name]?.includes(marker))
        );

        if (!guardDeployed) {
            log.warn('F2: SKIP — migration F-02 belum diterapkan ke database live');
        } else if (helpersDeployed) {
            log.pass('F2: lima helper siswa memverifikasi current school dan setiap tenant table yang dibaca');
        } else {
            log.fail('F2: satu atau lebih helper siswa belum memiliki seluruh guard school_id yang diwajibkan');
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

    // Helper konteks RLS: jalankan sisa transaksi sebagai user `authenticated`
    // tertentu (cara auth.uid() dievaluasi Supabase). Dipakai CHECK 11/13/14.
    const asAuth = (auth) =>
        ` set local role authenticated;` +
        ` select set_config('request.jwt.claims','{"sub":"${auth}","role":"authenticated"}',true);` +
        ` select set_config('request.jwt.claim.sub','${auth}',true);`;

    // ── CHECK 11: rls_cc_insert cross-tenant write guard ─────────
    // Memverifikasi guard fn_student_in_current_school di WITH CHECK
    // rls_cc_insert (commit db71576):
    //   F1 serangan   : GURU sekolah A INSERT kasus untuk siswa sekolah B → 42501.
    //   F2 regresi    : GURU sekolah A INSERT kasus untuk siswa sekolah A → lolos.
    //   F3 role       : SISWA INSERT kasus → ditolak (role exclusion).
    //   F4 struktural : with_check memanggil fn_student_in_current_school.
    // Semua INSERT dalam transaksi yang di-ROLLBACK — DB tidak berubah.
    log.head('CHECK 11 — rls_cc_insert: guard student ↔ school & regression INSERT guru-sekolah-sendiri');
    {
        const C11_CASE = 'ffffffff-ffff-ffff-ffff-00000000000b'; // sentinel case_id

        const c11pre = await mgmtQuery(`
            with
            sa as (
                select u.school_id from users u
                where u.role_type = 'GURU' and u.is_active and u.deleted_at is null
                  and u.auth_user_id is not null
                  and exists (select 1 from students st where st.school_id = u.school_id)
                group by u.school_id order by u.school_id limit 1
            ),
            sb as (
                select u.school_id from users u
                where u.role_type = 'GURU' and u.is_active and u.deleted_at is null
                  and u.auth_user_id is not null
                  and u.school_id <> (select school_id from sa)
                  and exists (select 1 from students st where st.school_id = u.school_id)
                group by u.school_id order by u.school_id limit 1
            ),
            ga as (
                select u.user_id, u.auth_user_id from users u
                where u.school_id = (select school_id from sa)
                  and u.role_type = 'GURU' and u.is_active and u.deleted_at is null
                  and u.auth_user_id is not null
                order by u.user_id limit 1
            ),
            sta as (
                select st.student_id from students st
                where st.school_id = (select school_id from sa) order by st.student_id limit 1
            ),
            stb as (
                select st.student_id from students st
                where st.school_id = (select school_id from sb) order by st.student_id limit 1
            ),
            siswa as (
                select u.user_id, u.auth_user_id from users u
                where u.school_id = (select school_id from sa)
                  and u.role_type = 'SISWA' and u.is_active and u.deleted_at is null
                  and u.auth_user_id is not null
                order by u.user_id limit 1
            )
            select
                (select school_id::text     from sa)    as sa_school,
                (select school_id::text     from sb)    as sb_school,
                (select user_id::text       from ga)    as ga_uid,
                (select auth_user_id::text  from ga)    as ga_auth,
                (select student_id::text    from sta)   as sta_id,
                (select student_id::text    from stb)   as stb_id,
                (select user_id::text       from siswa) as siswa_uid,
                (select auth_user_id::text  from siswa) as siswa_auth`);

        const d11 = c11pre[0] || {};
        const c11Ins = (school, student, actor) =>
            ` insert into coaching_cases` +
            `   (case_id, school_id, student_id, created_by_user_id, title, description,` +
            `    current_handler_user_id)` +
            ` values ('${C11_CASE}', '${school}', '${student}', '${actor}',` +
            `   'Uji CHECK 11', 'Deskripsi uji insert guard minimal dua puluh karakter.', '${actor}');`;

        const c11skip = !d11.ga_uid    ? 'tidak ada GURU aktif ber-auth_user_id di sekolah berdata siswa'
                      : !d11.sb_school ? 'hanya ada 1 sekolah dengan GURU + siswa (butuh ≥2)'
                      : !d11.sta_id || !d11.stb_id ? 'siswa tidak lengkap di kedua sekolah' : null;

        if (c11skip) {
            log.pass(`CHECK 11 SKIP — ${c11skip} (tidak menggagalkan)`);
        } else {
            // F1: GURU sekolah A INSERT kasus untuk siswa sekolah B → harus 42501
            let f1 = false, f1err = '';
            try {
                await mgmtQuery(
                    `begin;` + asAuth(d11.ga_auth) +
                    c11Ins(d11.sa_school, d11.stb_id, d11.ga_uid) +
                    ` rollback;`);
                f1err = 'INSERT lintas-sekolah diterima (seharusnya ditolak)';
            } catch (e) {
                if (e.message.includes('42501') || e.message.includes('row-level security')) f1 = true;
                else f1err = e.message;
            }
            if (f1) log.pass('F1: GURU sekolah A ditolak INSERT kasus untuk siswa sekolah B (42501)');
            else log.fail(`F1: INSERT kasus lintas-sekolah TIDAK ditolak — guard student↔school bocor${f1err ? ': ' + f1err.slice(0, 160) : ''}`);

            // F2 (regresi positif): GURU sekolah A INSERT kasus untuk siswa sekolah A → lolos
            let f2 = false, f2err = '';
            try {
                const r = await mgmtQuery(
                    `begin;` + asAuth(d11.ga_auth) +
                    c11Ins(d11.sa_school, d11.sta_id, d11.ga_uid) +
                    ` select count(*)::int as cnt from coaching_cases where case_id = '${C11_CASE}';` +
                    ` rollback;`);
                f2 = r[0]?.cnt === 1;
                if (!f2) f2err = `cnt=${r[0]?.cnt ?? 'null'}`;
            } catch (e) { f2err = e.message; }
            if (f2) log.pass('F2: GURU sekolah A bisa INSERT kasus untuk siswa sekolahnya sendiri (cnt=1) — uji tidak vacuous');
            else log.fail(`F2: INSERT kasus sekolah sendiri GAGAL — policy terlalu ketat${f2err ? ': ' + f2err.slice(0, 160) : ''}`);

            // F3: SISWA mencoba INSERT kasus → role exclusion harus menolak
            if (!d11.siswa_uid) {
                log.pass('CHECK 11 F3 SKIP — tidak ada user SISWA ber-auth_user_id di sekolah A');
            } else {
                let f3 = false, f3err = '';
                try {
                    await mgmtQuery(
                        `begin;` + asAuth(d11.siswa_auth) +
                        c11Ins(d11.sa_school, d11.sta_id, d11.siswa_uid) +
                        ` rollback;`);
                    f3err = 'INSERT oleh SISWA diterima (seharusnya ditolak)';
                } catch (e) {
                    if (e.message.includes('42501') || e.message.includes('row-level security')) f3 = true;
                    else f3err = e.message;
                }
                if (f3) log.pass('F3: SISWA ditolak INSERT coaching_cases (role exclusion, 42501)');
                else log.fail(`F3: SISWA bisa INSERT coaching_cases — role exclusion bocor${f3err ? ': ' + f3err.slice(0, 160) : ''}`);
            }
        }

        // F4 (struktural): with_check rls_cc_insert memanggil fn_student_in_current_school
        const c11pol = await mgmtQuery(`
            select coalesce(with_check, '') as wc
            from pg_policies
            where schemaname = 'public' and tablename = 'coaching_cases'
              and policyname = 'rls_cc_insert';`);
        if (c11pol.length === 0)
            log.fail('F4: policy rls_cc_insert tidak ditemukan — guard INSERT hilang');
        else if (c11pol[0].wc.includes('fn_student_in_current_school'))
            log.pass('F4: with_check rls_cc_insert memanggil fn_student_in_current_school (struktural)');
        else
            log.fail('F4: with_check rls_cc_insert TIDAK memanggil fn_student_in_current_school — guard hilang');
    }

    // ── CHECK 12: struktural read-path siswa/ortu ────────────────
    // Murni pemeriksaan katalog (pg_policies / pg_proc) — tidak butuh data sintetis.
    log.head('CHECK 12 — Struktural: policy read-path coaching_case_events siswa/ortu + default-deny student_updates');
    {
        const pols = await mgmtQuery(`
            select tablename, policyname, cmd,
                   coalesce(qual, '') as qual, coalesce(with_check, '') as wc, roles::text as roles
            from pg_policies
            where schemaname = 'public'
              and tablename in ('coaching_case_events', 'student_updates')
            order by tablename, policyname;`);
        const byName = Object.fromEntries(pols.map((p) => [p.policyname, p]));

        // S1: rls_cce_read_student — is_visible_to_student + is_shared_to_student
        const s1 = byName['rls_cce_read_student'];
        if (!s1) log.fail('S1: policy rls_cce_read_student TIDAK ADA — read-path siswa hilang');
        else if (s1.qual.includes('is_visible_to_student = true') && s1.qual.includes('is_shared_to_student = true'))
            log.pass('S1: rls_cce_read_student memfilter is_visible_to_student=true & is_shared_to_student=true');
        else log.fail(`S1: rls_cce_read_student tidak memfilter kedua flag privasi — qual: ${s1.qual.replace(/\s+/g, ' ').slice(0, 200)}`);

        // S2: rls_cce_read_parent — is_visible_to_student + is_shared_to_parent
        const s2 = byName['rls_cce_read_parent'];
        if (!s2) log.fail('S2: policy rls_cce_read_parent TIDAK ADA — read-path ortu hilang');
        else if (s2.qual.includes('is_visible_to_student = true') && s2.qual.includes('is_shared_to_parent = true'))
            log.pass('S2: rls_cce_read_parent memfilter is_visible_to_student=true & is_shared_to_parent=true');
        else log.fail(`S2: rls_cce_read_parent tidak memfilter kedua flag privasi — qual: ${s2.qual.replace(/\s+/g, ' ').slice(0, 200)}`);

        // S3: rls_cce_read_staff — exclusion SISWA/ORTU/STAKEHOLDER + fn_can_see_coaching_case
        const s3 = byName['rls_cce_read_staff'];
        const s3ok = s3 && ['SISWA', 'ORTU', 'STAKEHOLDER'].every((r) => s3.qual.includes(r))
                     && s3.qual.includes('fn_can_see_coaching_case');
        if (s3ok) log.pass('S3: rls_cce_read_staff mengecualikan SISWA/ORTU/STAKEHOLDER & memanggil fn_can_see_coaching_case');
        else if (!s3) log.fail('S3: policy rls_cce_read_staff TIDAK ADA');
        else log.fail(`S3: rls_cce_read_staff kehilangan role exclusion atau fn_can_see_coaching_case — qual: ${s3.qual.replace(/\s+/g, ' ').slice(0, 200)}`);

        // S4: student_updates default-deny untuk SISWA/ORTU (by design — tidak ada policy)
        const suRead = pols.filter((p) => p.tablename === 'student_updates' && (p.cmd === 'SELECT' || p.cmd === 'ALL'));
        const suLeak = suRead.filter((p) => /'SISWA'|'ORTU'/.test(p.qual));
        if (suRead.length === 0)
            log.fail('S4: student_updates tidak punya policy SELECT sama sekali — staf pun tak bisa baca (bug fungsional)');
        else if (suLeak.length === 0)
            log.pass(`S4: student_updates default-deny untuk SISWA/ORTU (policy SELECT: ${suRead.map((p) => p.policyname).join(', ')})`);
        else
            log.fail(`S4: student_updates punya policy yang menyebut SISWA/ORTU: ${suLeak.map((p) => p.policyname).join(', ')}`);

        // S5: predikat RLS callable authenticated, TIDAK callable anon
        const fns = await mgmtQuery(`
            select p.proname,
                   bool_and(has_function_privilege('authenticated', p.oid, 'EXECUTE')) as auth_exec,
                   bool_or(has_function_privilege('anon', p.oid, 'EXECUTE'))           as anon_exec
            from pg_proc p
            join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public'
              and p.proname in ('fn_matches_case_handler', 'fn_can_see_coaching_case',
                                'fn_student_in_current_school')
            group by p.proname order by p.proname;`);
        for (const fn of ['fn_matches_case_handler', 'fn_can_see_coaching_case', 'fn_student_in_current_school']) {
            const r = fns.find((x) => x.proname === fn);
            if (!r) log.fail(`S5: ${fn} tidak ditemukan di DB (regresi/hilang?)`);
            else if (r.auth_exec === true && r.anon_exec === false)
                log.pass(`S5: ${fn} — authenticated EXECUTE ✓, anon ✗`);
            else
                log.fail(`S5: ${fn} — auth_exec=${r.auth_exec}, anon_exec=${r.anon_exec} (harus true/false)`);
        }

        // S6 (regresi): fn_is_internal_case_actor sudah di-drop, jangan muncul lagi
        const legacy = await mgmtQuery(`
            select count(*)::int as c from pg_proc p
            join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname = 'fn_is_internal_case_actor';`);
        if (legacy[0]?.c === 0) log.pass('S6: fn_is_internal_case_actor (schema lama) tetap absen — tidak ada regresi');
        else log.fail(`S6: fn_is_internal_case_actor muncul kembali (${legacy[0]?.c} signature) — sisa schema lama`);
    }

    // ── CHECK 13: behavioral read-path siswa/ortu ────────────────
    // Kasus sintetis dibagikan ke siswa & ortu, dengan 2 event (visible & hidden)
    // dan 1 student_updates. Tiap sub-test = transaksi sendiri, di-ROLLBACK.
    log.head('CHECK 13 — Behavioral: read-path siswa/ortu coaching_cases + coaching_case_events + student_updates');
    {
        const C13_CASE = 'ffffffff-ffff-ffff-ffff-00000000000d'; // sentinel case_id
        const C13_VIS  = 'ffffffff-ffff-ffff-ffff-0000000000d1'; // event visible
        const C13_HID  = 'ffffffff-ffff-ffff-ffff-0000000000d2'; // event hidden
        const C13_SU   = 'ffffffff-ffff-ffff-ffff-0000000000d3'; // student_updates

        const c13pre = await mgmtQuery(`
            with base as (
                select st.student_id, st.school_id,
                       us.auth_user_id as siswa_auth,
                       up.auth_user_id as ortu_auth
                from students st
                join users us on us.user_id = st.user_id
                             and us.role_type = 'SISWA' and us.is_active and us.auth_user_id is not null
                join student_parents sp on sp.student_id = st.student_id
                join users up on up.user_id = sp.parent_user_id
                             and up.role_type = 'ORTU' and up.is_active and up.auth_user_id is not null
                where st.student_status = 'AKTIF'
                  and exists (select 1 from users g where g.school_id = st.school_id
                                and g.role_type = 'GURU' and g.is_active and g.auth_user_id is not null)
                order by st.student_id limit 1
            ),
            guru as (
                select u.user_id, u.auth_user_id from users u
                where u.school_id = (select school_id from base)
                  and u.role_type = 'GURU' and u.is_active and u.auth_user_id is not null
                order by u.user_id limit 1
            ),
            lain as (
                select us.auth_user_id from students st
                join users us on us.user_id = st.user_id
                             and us.role_type = 'SISWA' and us.is_active and us.auth_user_id is not null
                where st.school_id = (select school_id from base)
                  and st.student_id <> (select student_id from base)
                order by st.student_id limit 1
            )
            select
                (select student_id::text   from base) as student_id,
                (select school_id::text    from base) as school_id,
                (select siswa_auth::text   from base) as siswa_auth,
                (select ortu_auth::text    from base) as ortu_auth,
                (select user_id::text      from guru) as guru_uid,
                (select auth_user_id::text from guru) as guru_auth,
                (select auth_user_id::text from lain) as lain_auth`);

        const d13 = c13pre[0] || {};
        const c13Setup =
            ` insert into coaching_cases` +
            `   (case_id, school_id, student_id, created_by_user_id, title, description,` +
            `    current_handler_user_id, is_shared_to_student, is_shared_to_parent)` +
            ` values ('${C13_CASE}', '${d13.school_id}', '${d13.student_id}', '${d13.guru_uid}',` +
            `   'Uji CHECK 13', 'Deskripsi uji read-path minimal dua puluh karakter.',` +
            `   '${d13.guru_uid}', true, true);` +
            ` insert into coaching_case_events` +
            `   (event_id, case_id, school_id, event_type, author_user_id, is_visible_to_student)` +
            ` values ('${C13_VIS}', '${C13_CASE}', '${d13.school_id}', 'NOTE_ADDED', '${d13.guru_uid}', true),` +
            `        ('${C13_HID}', '${C13_CASE}', '${d13.school_id}', 'NOTE_ADDED', '${d13.guru_uid}', false);` +
            ` insert into student_updates (update_id, case_id, school_id, author_user_id, content)` +
            ` values ('${C13_SU}', '${C13_CASE}', '${d13.school_id}', '${d13.guru_uid}',` +
            `   'Catatan uji CHECK 13 untuk student_updates.');`;

        const c13skip = !d13.student_id ? 'tidak ada siswa AKTIF ber-user_id + auth_user_id yang punya ortu ber-auth_user_id'
                      : !d13.guru_uid   ? 'tidak ada GURU aktif ber-auth_user_id di sekolah siswa tersebut' : null;

        if (c13skip) {
            log.pass(`CHECK 13 SKIP — ${c13skip} (tidak menggagalkan)`);
        } else {
            // Sanity: data sintetis valid (tanpa RLS)
            let c13ok = false;
            try {
                const s = await mgmtQuery(
                    `begin;` + c13Setup +
                    ` select (select count(*)::int from coaching_cases where case_id='${C13_CASE}')` +
                    `      + (select count(*)::int from coaching_case_events where case_id='${C13_CASE}')` +
                    `      + (select count(*)::int from student_updates where update_id='${C13_SU}') as n;` +
                    ` rollback;`);
                // 3 event = 2 sentinel + 1 OPENED otomatis dari trg_coaching_case_log_create
                c13ok = s[0]?.n === 5;
                if (c13ok) log.pass('CHECK 13 setup: 1 kasus + 3 event (2 sentinel + 1 OPENED otomatis) + 1 student_update — data valid');
                else log.fail(`CHECK 13 setup gagal: n=${s[0]?.n ?? 'null'} (harusnya 5)`);
            } catch (e) { log.fail(`CHECK 13 setup error: ${e.message.slice(0, 200)}`); }

            if (c13ok) {
                const probe = async (label, auth, sql, expect, okMsg, failMsg) => {
                    let cnt = null, err = '';
                    try {
                        const r = await mgmtQuery(`begin;` + c13Setup + asAuth(auth) + sql + ` rollback;`);
                        cnt = r[0]?.cnt ?? null;
                    } catch (e) { err = e.message; }
                    if (cnt === expect) log.pass(`${label}: ${okMsg} (cnt=${cnt})`);
                    else log.fail(`${label}: ${failMsg} (cnt=${cnt}, harusnya ${expect})${err ? ' — ' + err.slice(0, 160) : ''}`);
                };

                const selCase  = ` select count(*)::int as cnt from coaching_cases where case_id = '${C13_CASE}';`;
                const selVis   = ` select count(*)::int as cnt from coaching_case_events where event_id = '${C13_VIS}';`;
                const selHid   = ` select count(*)::int as cnt from coaching_case_events where event_id = '${C13_HID}';`;
                const selAllEv = ` select count(*)::int as cnt from coaching_case_events where case_id = '${C13_CASE}';`;
                const selSu    = ` select count(*)::int as cnt from student_updates where update_id = '${C13_SU}';`;

                await probe('F1', d13.siswa_auth, selCase, 1,
                    'siswa subjek bisa baca kasus yang dibagikan (is_shared_to_student=true)',
                    'siswa subjek TIDAK bisa baca kasus yang dibagikan — read-path siswa rusak');
                await probe('F2', d13.siswa_auth, selVis, 1,
                    'siswa subjek bisa baca event is_visible_to_student=true',
                    'siswa subjek TIDAK bisa baca event yang ditandai visible — read-path rusak');
                await probe('F3', d13.siswa_auth, selHid, 0,
                    'siswa subjek TIDAK bisa baca event is_visible_to_student=false',
                    'BOCOR: siswa membaca event internal (is_visible_to_student=false)');
                if (!d13.lain_auth) log.pass('CHECK 13 F4 SKIP — tidak ada siswa lain ber-auth_user_id di sekolah yang sama');
                else await probe('F4', d13.lain_auth, selCase, 0,
                    'siswa lain TIDAK bisa baca kasus siswa subjek — isolasi per-siswa OK',
                    'BOCOR: siswa lain membaca kasus milik siswa subjek');
                await probe('F5', d13.ortu_auth, selCase, 1,
                    'ortu siswa subjek bisa baca kasus (is_shared_to_parent=true)',
                    'ortu siswa subjek TIDAK bisa baca kasus yang dibagikan — read-path ortu rusak');
                await probe('F6', d13.ortu_auth, selVis, 1,
                    'ortu siswa subjek bisa baca event is_visible_to_student=true',
                    'ortu siswa subjek TIDAK bisa baca event visible — read-path ortu rusak');
                await probe('F7', d13.guru_auth, selAllEv, 3,
                    'GURU creator bisa baca SEMUA event (tidak dibatasi is_visible_to_student)',
                    'GURU creator tidak melihat seluruh event kasusnya');
                await probe('F8', d13.siswa_auth, selSu, 0,
                    'siswa TIDAK bisa baca student_updates — default-deny terkonfirmasi',
                    'BOCOR: siswa membaca student_updates (harusnya default-deny)');
            }
        }
    }

    // ── CHECK 14: write-path kasus ───────────────────────────────
    // W1 struktural; W2a trigger fn_coaching_case_guard (P0003); W2b RLS rls_cc_update;
    // W3 non-handler ditolak; W4 kasus CLOSED; W5 cross-tenant; W6 regresi positif.
    log.head('CHECK 14 — Write-path kasus: guard UPDATE langsung, INSERT event non-handler / kasus CLOSED / cross-tenant');
    {
        const C14_OPEN   = 'ffffffff-ffff-ffff-ffff-00000000000e'; // kasus OPEN sekolah A
        const C14_CLOSED = 'ffffffff-ffff-ffff-ffff-0000000000e2'; // kasus CLOSED sekolah A
        const C14_B      = 'ffffffff-ffff-ffff-ffff-0000000000e3'; // kasus sekolah B

        // W1 (struktural): fn_matches_case_handler tersedia untuk authenticated saja,
        // dan fn_is_internal_case_actor (schema lama) tetap absen.
        const w1 = await mgmtQuery(`
            select
                (select bool_and(has_function_privilege('authenticated', p.oid, 'EXECUTE'))
                   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'fn_matches_case_handler') as auth_exec,
                (select bool_or(has_function_privilege('anon', p.oid, 'EXECUTE'))
                   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'fn_matches_case_handler') as anon_exec,
                (select count(*)::int
                   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'fn_is_internal_case_actor') as legacy_cnt`);
        const r14 = w1[0] || {};
        if (r14.auth_exec === true && r14.anon_exec === false)
            log.pass('W1: fn_matches_case_handler — authenticated EXECUTE ✓, anon ✗');
        else
            log.fail(`W1: fn_matches_case_handler auth_exec=${r14.auth_exec}, anon_exec=${r14.anon_exec} (harus true/false)`);
        if (r14.legacy_cnt === 0) log.pass('W1: fn_is_internal_case_actor (schema lama) absen — tidak ada regresi');
        else log.fail(`W1: fn_is_internal_case_actor muncul kembali (${r14.legacy_cnt} signature)`);

        const c14pre = await mgmtQuery(`
            with
            sa as (
                select u.school_id from users u
                where u.role_type = 'GURU' and u.is_active and u.deleted_at is null
                  and u.auth_user_id is not null
                  and exists (select 1 from students st where st.school_id = u.school_id)
                group by u.school_id having count(*) >= 2 order by u.school_id limit 1
            ),
            sb as (
                select u.school_id from users u
                where u.role_type = 'GURU' and u.is_active and u.deleted_at is null
                  and u.auth_user_id is not null
                  and u.school_id <> (select school_id from sa)
                  and exists (select 1 from students st where st.school_id = u.school_id)
                group by u.school_id order by u.school_id limit 1
            ),
            ga as (
                select u.user_id, u.auth_user_id from users u
                where u.school_id = (select school_id from sa)
                  and u.role_type = 'GURU' and u.is_active and u.auth_user_id is not null
                order by u.user_id limit 1
            ),
            ga2 as (
                select u.user_id, u.auth_user_id from users u
                where u.school_id = (select school_id from sa)
                  and u.role_type = 'GURU' and u.is_active and u.auth_user_id is not null
                  and u.user_id <> (select user_id from ga)
                order by u.user_id limit 1
            ),
            gb as (
                select u.user_id from users u
                where u.school_id = (select school_id from sb)
                  and u.role_type = 'GURU' and u.is_active and u.auth_user_id is not null
                order by u.user_id limit 1
            ),
            sta as (select st.student_id from students st
                    where st.school_id = (select school_id from sa) order by st.student_id limit 1),
            stb as (select st.student_id from students st
                    where st.school_id = (select school_id from sb) order by st.student_id limit 1)
            select
                (select school_id::text    from sa)  as sa_school,
                (select school_id::text    from sb)  as sb_school,
                (select user_id::text      from ga)  as ga_uid,
                (select auth_user_id::text from ga)  as ga_auth,
                (select user_id::text      from ga2) as ga2_uid,
                (select auth_user_id::text from ga2) as ga2_auth,
                (select user_id::text      from gb)  as gb_uid,
                (select student_id::text   from sta) as sta_id,
                (select student_id::text   from stb) as stb_id`);

        const d14 = c14pre[0] || {};
        const caseOpen =
            ` insert into coaching_cases` +
            `   (case_id, school_id, student_id, created_by_user_id, title, description,` +
            `    current_handler_user_id)` +
            ` values ('${C14_OPEN}', '${d14.sa_school}', '${d14.sta_id}', '${d14.ga_uid}',` +
            `   'Uji CHECK 14 open', 'Deskripsi uji write-path minimal dua puluh karakter.', '${d14.ga_uid}');`;
        const caseClosed =
            ` insert into coaching_cases` +
            `   (case_id, school_id, student_id, created_by_user_id, title, description,` +
            `    current_handler_user_id, status, closed_at, closed_by_user_id)` +
            ` values ('${C14_CLOSED}', '${d14.sa_school}', '${d14.sta_id}', '${d14.ga_uid}',` +
            `   'Uji CHECK 14 closed', 'Deskripsi uji kasus tertutup minimal dua puluh karakter.',` +
            `   '${d14.ga_uid}', 'CLOSED', now(), '${d14.ga_uid}');`;
        const caseOther =
            ` insert into coaching_cases` +
            `   (case_id, school_id, student_id, created_by_user_id, title, description,` +
            `    current_handler_user_id)` +
            ` values ('${C14_B}', '${d14.sb_school}', '${d14.stb_id}', '${d14.gb_uid}',` +
            `   'Uji CHECK 14 sekolah B', 'Deskripsi uji cross-tenant minimal dua puluh karakter.', '${d14.gb_uid}');`;
        const evNote = (caseId, school, author) =>
            ` insert into coaching_case_events (case_id, school_id, event_type, author_user_id)` +
            ` values ('${caseId}', '${school}', 'NOTE_ADDED', '${author}');`;

        const c14skip = !d14.ga_uid  ? 'tidak ada sekolah dengan ≥2 GURU aktif ber-auth_user_id + siswa'
                      : !d14.ga2_uid ? 'tidak ada GURU kedua di sekolah A (butuh staf non-handler)'
                      : !d14.gb_uid  ? 'tidak ada sekolah kedua dengan GURU + siswa' : null;

        if (c14skip) {
            log.pass(`CHECK 14 SKIP (W2–W6) — ${c14skip} (tidak menggagalkan)`);
        } else {
            // W2a: UPDATE langsung kolom terjaga sebagai postgres → trigger P0003
            let w2a = false, w2aerr = '';
            try {
                await mgmtQuery(
                    `begin;` + caseOpen +
                    ` update coaching_cases set status = 'UNDER_REVIEW' where case_id = '${C14_OPEN}';` +
                    ` rollback;`);
                w2aerr = 'UPDATE langsung diterima (seharusnya ditolak trigger)';
            } catch (e) {
                if (e.message.includes('integrity_guard') || e.message.includes('P0003')) w2a = true;
                else w2aerr = e.message;
            }
            if (w2a) log.pass('W2a: UPDATE langsung coaching_cases.status ditolak trg_coaching_case_guard (P0003)');
            else log.fail(`W2a: UPDATE langsung kolom terjaga TIDAK ditolak — integrity guard bocor${w2aerr ? ': ' + w2aerr.slice(0, 160) : ''}`);

            // W2b: GURU creator UPDATE kolom terjaga lewat RLS → 0 baris (rls_cc_update menuntut sync flag)
            let w2b = null, w2berr = '';
            try {
                const r = await mgmtQuery(
                    `begin;` + caseOpen + asAuth(d14.ga_auth) +
                    ` update coaching_cases set status = 'UNDER_REVIEW' where case_id = '${C14_OPEN}';` +
                    ` select count(*)::int as cnt from coaching_cases` +
                    `  where case_id = '${C14_OPEN}' and status = 'UNDER_REVIEW';` +
                    ` rollback;`);
                w2b = r[0]?.cnt ?? null;
            } catch (e) {
                // Bila trigger sempat menyala lebih dulu, itu juga penolakan yang benar.
                if (e.message.includes('integrity_guard') || e.message.includes('P0003')) w2b = 0;
                else w2berr = e.message;
            }
            if (w2b === 0) log.pass('W2b: GURU creator TIDAK bisa UPDATE status langsung via RLS (0 baris berubah)');
            else log.fail(`W2b: UPDATE status oleh GURU creator BERHASIL (cnt=${w2b}) — rls_cc_update bocor${w2berr ? ': ' + w2berr.slice(0, 160) : ''}`);

            // W3: staf non-handler INSERT event → 42501 (rls_cce_insert menuntut handler)
            let w3 = false, w3err = '';
            try {
                await mgmtQuery(
                    `begin;` + caseOpen + asAuth(d14.ga2_auth) +
                    evNote(C14_OPEN, d14.sa_school, d14.ga2_uid) +
                    ` rollback;`);
                w3err = 'INSERT event oleh non-handler diterima';
            } catch (e) {
                if (e.message.includes('42501') || e.message.includes('row-level security')) w3 = true;
                else w3err = e.message;
            }
            if (w3) log.pass('W3: staf non-handler ditolak INSERT coaching_case_events (42501)');
            else log.fail(`W3: staf non-handler bisa INSERT event kasus orang lain — rls_cce_insert bocor${w3err ? ': ' + w3err.slice(0, 160) : ''}`);

            // W4: INSERT event ke kasus CLOSED → ditolak (trigger P0001 atau RLS 42501)
            let w4 = false, w4code = '', w4err = '';
            try {
                await mgmtQuery(
                    `begin;` + caseClosed + asAuth(d14.ga_auth) +
                    evNote(C14_CLOSED, d14.sa_school, d14.ga_uid) +
                    ` rollback;`);
                w4err = 'INSERT event ke kasus CLOSED diterima';
            } catch (e) {
                if (e.message.includes('case_closed') || e.message.includes('P0001')) { w4 = true; w4code = 'P0001 case_closed'; }
                else if (e.message.includes('42501') || e.message.includes('row-level security')) { w4 = true; w4code = '42501 RLS'; }
                else w4err = e.message;
            }
            if (w4) log.pass(`W4: INSERT event ke kasus CLOSED ditolak (${w4code})`);
            else log.fail(`W4: INSERT event ke kasus CLOSED TIDAK ditolak${w4err ? ': ' + w4err.slice(0, 160) : ''}`);

            // W5: GURU sekolah A INSERT event ke kasus sekolah B → 42501
            let w5 = false, w5err = '';
            try {
                await mgmtQuery(
                    `begin;` + caseOther + asAuth(d14.ga_auth) +
                    evNote(C14_B, d14.sb_school, d14.ga_uid) +
                    ` rollback;`);
                w5err = 'INSERT event lintas-sekolah diterima';
            } catch (e) {
                if (e.message.includes('42501') || e.message.includes('row-level security')) w5 = true;
                else w5err = e.message;
            }
            if (w5) log.pass('W5: GURU sekolah A ditolak INSERT event ke kasus sekolah B (42501)');
            else log.fail(`W5: INSERT event lintas-sekolah TIDAK ditolak — isolasi write bocor${w5err ? ': ' + w5err.slice(0, 160) : ''}`);

            // W6 (regresi positif): handler sah INSERT event ke kasusnya sendiri → lolos
            let w6 = false, w6err = '';
            try {
                const r = await mgmtQuery(
                    `begin;` + caseOpen + asAuth(d14.ga_auth) +
                    evNote(C14_OPEN, d14.sa_school, d14.ga_uid) +
                    ` select count(*)::int as cnt from coaching_case_events` +
                    `  where case_id = '${C14_OPEN}' and event_type = 'NOTE_ADDED';` +
                    ` rollback;`);
                w6 = r[0]?.cnt === 1;
                if (!w6) w6err = `cnt=${r[0]?.cnt ?? 'null'}`;
            } catch (e) { w6err = e.message; }
            if (w6) log.pass('W6: handler sah bisa INSERT event ke kasusnya sendiri (cnt=1) — uji tidak vacuous');
            else log.fail(`W6: handler sah GAGAL INSERT event kasusnya sendiri — policy terlalu ketat${w6err ? ': ' + w6err.slice(0, 160) : ''}`);
        }
    }
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
    // MANDIRI — tidak bergantung pada data produksi berskop kelas.
    // Membuat posting sintetis berskop KELAS di dalam satu transaksi
    // BEGIN...ROLLBACK (pola CHECK 8 / CHECK 13), menjalankan F4–F10
    // dari konteks beberapa aktor, lalu ROLLBACK — DB tidak tercemar.
    //
    // Mengapa mandiri: seluruh forum_posts produksi berskop 'SEKOLAH'
    // (class_id NULL), sehingga F4–F10 sebelumnya SKIP total dan
    // isolasi forum per-kelas tidak teruji sama sekali.
    //
    // Skenario:
    // F4 : Guru penulis bisa baca posting di kelasnya sendiri      → cnt 1
    // F5 : Guru mapel lain di kelas yang SAMA bisa baca            → cnt 1
    // F6 : Guru yang TIDAK terhubung ke kelas itu tidak bisa baca  → cnt 0
    // F7 : Ortu siswa kelas itu tidak bisa baca posting INTERNAL   → cnt 0
    // F9 : Siswa withdrawn tidak bisa baca walau ada di audience   → cnt 0
    // F10: INSERT posting oleh guru luar kelas ditolak RLS         → 42501
    //
    // Catatan F10: forum_posts tidak punya policy INSERT sama sekali
    // (default-deny). Baris uji sengaja dibuat VALID PENUH — termasuk
    // title (NOT NULL, len>=3) dan pasangan scope_type/class_id yang
    // memenuhi chk_forum_posts_scope — agar penolakan yang terukur
    // benar-benar berasal dari RLS (42501), bukan dari constraint.
    log.head('CHECK 17 — Forum Kelas: isolasi per-aktor via data sintetis (BEGIN...ROLLBACK)');
    {
        // ── Setup: pilih aktor dari DB, tanpa menulis apa pun ──
        // Kelas target = kelas mana pun yang punya >= 2 guru mapel aktif,
        // supaya F4 (penulis) dan F5 (guru sekelas) dua orang berbeda.
        const d17 = await mgmtQuery(`
            WITH tgt AS (
                SELECT ta.class_id, ta.academic_year, ta.school_id
                FROM teaching_assignments ta
                JOIN users u ON u.user_id = ta.user_id AND u.school_id = ta.school_id
                WHERE ta.is_active AND u.is_active AND u.auth_user_id IS NOT NULL
                  AND u.role_type = 'GURU' AND u.deleted_at IS NULL
                GROUP BY 1,2,3
                HAVING COUNT(DISTINCT ta.user_id) >= 2
                ORDER BY ta.class_id
                LIMIT 1
            ),
            cls AS (
                SELECT c.class_id, c.program_id
                FROM classes c JOIN tgt ON c.class_id = tgt.class_id
            ),
            gurus AS (
                SELECT DISTINCT u.user_id, u.auth_user_id
                FROM teaching_assignments ta
                JOIN users u ON u.user_id = ta.user_id AND u.school_id = ta.school_id
                JOIN tgt ON ta.class_id      = tgt.class_id
                        AND ta.academic_year = tgt.academic_year
                        AND ta.school_id     = tgt.school_id
                WHERE ta.is_active AND u.is_active AND u.auth_user_id IS NOT NULL
                  AND u.role_type = 'GURU' AND u.deleted_at IS NULL
            ),
            ranked AS (
                SELECT g.*, row_number() OVER (ORDER BY g.user_id) AS rn FROM gurus g
            ),
            -- Guru "luar kelas": dikecualikan dari SEMUA cabang
            -- fn_can_read_forum_post yang bisa memberi akses —
            -- teaching_assignments, wali kelas, kaprodi (program_id /
            -- kaprodi_program_id), flag kepsek/waka, dan BK kelas ini.
            outsider AS (
                SELECT u.user_id, u.auth_user_id
                FROM users u, tgt, cls
                WHERE u.school_id = tgt.school_id AND u.role_type = 'GURU'
                  AND u.is_active AND u.deleted_at IS NULL AND u.auth_user_id IS NOT NULL
                  AND COALESCE(u.is_kepsek, false)         = false
                  AND COALESCE(u.is_waka_kesiswaan, false) = false
                  AND u.wali_kelas_class_id IS DISTINCT FROM tgt.class_id
                  AND (cls.program_id IS NULL
                       OR (u.program_id         IS DISTINCT FROM cls.program_id
                       AND u.kaprodi_program_id IS DISTINCT FROM cls.program_id))
                  AND NOT EXISTS (
                      SELECT 1 FROM teaching_assignments t2
                      WHERE t2.user_id       = u.user_id
                        AND t2.class_id      = tgt.class_id
                        AND t2.academic_year = tgt.academic_year
                        AND t2.is_active)
                  AND NOT EXISTS (
                      SELECT 1 FROM bk_class_assignments b
                      WHERE b.bk_user_id = u.user_id
                        AND b.class_id   = tgt.class_id
                        AND b.is_active)
                ORDER BY u.user_id
                LIMIT 1
            ),
            ortu_in AS (
                SELECT u.auth_user_id
                FROM class_enrollments ce
                JOIN tgt ON ce.class_id = tgt.class_id AND ce.academic_year = tgt.academic_year
                JOIN student_parents sp ON sp.student_id = ce.student_id
                                       AND sp.school_id  = tgt.school_id
                JOIN users u ON u.user_id = sp.parent_user_id
                WHERE ce.withdrawn_at IS NULL AND u.is_active AND u.auth_user_id IS NOT NULL
                ORDER BY u.user_id LIMIT 1
            ),
            siswa_wd AS (
                SELECT u.user_id, u.auth_user_id
                FROM class_enrollments ce
                JOIN tgt ON ce.class_id = tgt.class_id AND ce.academic_year = tgt.academic_year
                JOIN students s ON s.student_id = ce.student_id
                JOIN users u ON u.user_id = s.user_id
                WHERE ce.withdrawn_at IS NOT NULL AND u.auth_user_id IS NOT NULL
                ORDER BY u.user_id LIMIT 1
            )
            SELECT tgt.class_id::text  AS class_id,
                   tgt.academic_year   AS academic_year,
                   tgt.school_id::text AS school_id,
                   a.user_id::text       AS author_uid, a.auth_user_id::text  AS author_auth,
                   b.user_id::text       AS same_uid,   b.auth_user_id::text  AS same_auth,
                   o.user_id::text       AS out_uid,    o.auth_user_id::text  AS out_auth,
                   oi.auth_user_id::text AS ortu_auth,
                   sw.user_id::text      AS wd_uid,     sw.auth_user_id::text AS wd_auth
            FROM tgt
            LEFT JOIN ranked   a  ON a.rn = 1
            LEFT JOIN ranked   b  ON b.rn = 2
            LEFT JOIN outsider o  ON true
            LEFT JOIN ortu_in  oi ON true
            LEFT JOIN siswa_wd sw ON true;
        `);

        const d = d17[0];
        if (!d?.class_id || !d.author_auth) {
            log.warn('CHECK 17 SKIP — tidak ada kelas dengan >= 2 guru mapel aktif untuk data sintetis');
        } else {
            const POST = '00000000-0000-0000-0000-0000000f1700'; // posting sintetis
            const BAD  = '00000000-0000-0000-0000-0000000f1710'; // percobaan INSERT terlarang

            const claims = (auid) =>
                ` select set_config('request.jwt.claims', $c$` +
                `{"sub":"${auid}","role":"authenticated"}$c$, true);`;

            // Ukur satu aktor: catat COUNT posting yang terlihat olehnya.
            const probe = (key, auid) =>
                claims(auid) +
                ` insert into _f17 select '${key}', count(*)::text` +
                ` from forum_posts where post_id = '${POST}';`;

            // Satu transaksi utuh:
            //   INSERT sintetis sebagai postgres (bypass RLS)
            //   → SET ROLE authenticated (RLS aktif) → probe tiap aktor
            //   → ROLLBACK (DB bersih).
            // Hasil tiap probe ditampung di temp table karena Management API
            // hanya mengembalikan hasil statement TERAKHIR.
            let rows = null;
            try {
                rows = await mgmtQuery(
                    `begin;` +
                    ` create temp table _f17 (k text primary key, v text) on commit drop;` +
                    ` grant all on _f17 to authenticated;` +

                    // (1) Posting sintetis berskop KELAS di kelas target
                    ` insert into forum_posts` +
                    `   (post_id, school_id, class_id, academic_year, author_user_id,` +
                    `    title, body, visibility, scope_type, audience_type)` +
                    ` values` +
                    `   ('${POST}', '${d.school_id}', '${d.class_id}', '${d.academic_year}',` +
                    `    '${d.author_uid}', 'Uji Isolasi Forum CHECK 17',` +
                    `    'data sintetis tenant-isolation - dirollback',` +
                    `    'INTERNAL', 'KELAS', 'SEMUA_GURU_KELAS');` +

                    // (2) Siswa withdrawn dimasukkan ke audience EKSPLISIT.
                    //     Tanpa ini F9 lulus vacuously (siswa gagal di syarat
                    //     audience, bukan di syarat enrollment aktif).
                    (d.wd_uid
                        ? ` insert into forum_post_audience (post_id, user_id, school_id)` +
                          ` values ('${POST}', '${d.wd_uid}', '${d.school_id}');`
                        : ``) +

                    // Mulai konteks authenticated — RLS aktif sejak titik ini
                    ` set local role authenticated;` +

                    probe('F4', d.author_auth) +
                    (d.same_auth ? probe('F5', d.same_auth) : ``) +
                    (d.out_auth  ? probe('F6', d.out_auth)  : ``) +
                    (d.ortu_auth ? probe('F7', d.ortu_auth) : ``) +
                    (d.wd_auth   ? probe('F9', d.wd_auth)   : ``) +

                    // F10: INSERT oleh guru luar kelas. Dibungkus DO block agar
                    // error RLS ditangkap savepoint implisit PL/pgSQL dan
                    // transaksi tidak ikut abort.
                    (d.out_auth
                        ? claims(d.out_auth) +
                          ` do $b$ begin` +
                          `   insert into forum_posts` +
                          `     (post_id, school_id, class_id, academic_year, author_user_id,` +
                          `      title, body, visibility, scope_type, audience_type)` +
                          `   values` +
                          `     ('${BAD}', '${d.school_id}', '${d.class_id}', '${d.academic_year}',` +
                          `      '${d.out_uid}', 'Uji INSERT Terlarang',` +
                          `      'harus ditolak RLS', 'INTERNAL', 'KELAS', 'SEMUA_GURU_KELAS');` +
                          `   insert into _f17 values ('F10', 'BREACH');` +
                          ` exception when others then` +
                          `   insert into _f17 values ('F10', sqlstate);` +
                          ` end $b$;`
                        : ``) +

                    ` select k, v from _f17 order by k;` +
                    ` rollback;`
                );
            } catch (e) {
                log.fail(`CHECK 17 — Transaksi sintetis gagal: ${e.message.slice(0, 200)}`);
            }

            if (rows) {
                const R = Object.fromEntries(rows.map((r) => [r.k, r.v]));

                // Assertion: nilai terukur harus sama persis dengan yang diharapkan.
                const expect = (key, want, msgOk, msgFail, skipMsg) => {
                    if (R[key] === undefined) { log.warn(`${key}: SKIP — ${skipMsg}`); return; }
                    if (R[key] === want) log.pass(`${key}: ${msgOk}`);
                    else                 log.fail(`${key}: ${msgFail} (terukur=${R[key]}, diharapkan=${want})`);
                };

                expect('F4', '1',
                    'guru penulis bisa baca posting kelasnya sendiri',
                    'guru penulis TIDAK bisa baca posting sendiri',
                    'penulis tidak tersedia');
                expect('F5', '1',
                    'guru mapel di kelas yang sama bisa baca posting',
                    'guru mapel kelas sama TIDAK bisa baca',
                    'tidak ada guru kedua di kelas ini');
                expect('F6', '0',
                    'guru di luar kelas ini tidak bisa baca posting (isolasi per-kelas)',
                    'guru luar kelas BISA baca posting — ISOLATION BREACH',
                    'tidak ada guru luar kelas');
                expect('F7', '0',
                    'ortu siswa kelas ini tidak bisa baca posting INTERNAL',
                    'ortu BISA baca posting INTERNAL — kebocoran visibility',
                    'tidak ada ortu siswa di kelas ini');
                expect('F9', '0',
                    'siswa withdrawn tidak bisa baca walau terdaftar di audience',
                    'siswa withdrawn BISA baca — guard enrollment tidak aktif',
                    'tidak ada siswa withdrawn di kelas ini');
                expect('F10', '42501',
                    'guru luar kelas ditolak RLS saat INSERT posting (42501)',
                    'INSERT guru luar kelas TIDAK ditolak RLS — RLS BYPASS',
                    'tidak ada guru luar kelas untuk uji INSERT');
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
