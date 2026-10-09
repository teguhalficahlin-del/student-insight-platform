// Actual RPC definitions in PostgreSQL; all identities/data are synthetic and local.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const read = file => readFileSync(new URL('../supabase/migrations/' + file, import.meta.url), 'utf8');
const migration = read('20261009160000_stakeholder_summary_and_monitoring.sql');
const id = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
function definition(source, name) {
    const start = source.search(new RegExp(`CREATE OR REPLACE FUNCTION (?:public\\.)?${name}\\(`));
    assert(start >= 0, name);
    const found = source.slice(start).match(/^[\s\S]*?AS (\$\w*\$)[\s\S]*?\1\s*;/);
    assert(found, name); return found[0];
}
const db = await PGlite.create();
let passed = 0;
async function test(label, fn) { await fn(); console.log(`PASS SQL ${++passed}: ${label}`); }
async function caller(n) {
    await db.exec('RESET ROLE');
    await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [n ? id(n) : '']);
    await db.exec('SET ROLE authenticated');
}
const summary = async () => (await db.query('SELECT fn_stakeholder_summary() AS data')).rows[0].data;
const monitoring = async (period = 'hari_ini', year = null, start = null, end = null) =>
    (await db.query('SELECT fn_kepsek_monitoring($1,$2,$3,$4) AS data', [period, year, start, end])).rows[0].data;
// Only the clock expression is substituted in local copies, exercising real date branches at boundaries.
async function freezeClock(instant) {
    await db.exec('RESET ROLE');
    assert.match(instant, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    await db.exec(migration.replaceAll("(now() AT TIME ZONE 'Asia/Jakarta')::date",
        `('${instant}'::timestamptz AT TIME ZONE 'Asia/Jakarta')::date`));
}
try {
    await db.exec(`
        CREATE ROLE authenticated; CREATE ROLE anon; CREATE ROLE service_role; CREATE ROLE unrelated;
        CREATE SCHEMA auth;
        CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
            SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid;
        $$;
        GRANT USAGE ON SCHEMA auth TO authenticated,anon,service_role;
        CREATE TYPE role_type AS ENUM ('STAKEHOLDER','KEPSEK','GURU','SISWA','ORTU','DUDI','ADMINISTRATIVE');
        CREATE TABLE users(user_id uuid PRIMARY KEY,auth_user_id uuid,school_id uuid,role_type role_type,
            is_active boolean,deleted_at timestamptz,is_kepsek boolean DEFAULT false);
        CREATE TABLE students(student_id uuid PRIMARY KEY,school_id uuid,student_status text);
        CREATE TABLE programs(program_id uuid PRIMARY KEY,school_id uuid,is_active boolean);
        CREATE TABLE classes(class_id uuid PRIMARY KEY,school_id uuid,is_active boolean);
        CREATE TABLE teaching_schedules(schedule_id uuid PRIMARY KEY,school_id uuid,session_date date,
            scheduled_teacher_id uuid,meeting_status text);
        CREATE TABLE attendance(schedule_id uuid,student_id uuid,school_id uuid,status text,is_void boolean);
        CREATE TABLE late_arrivals(school_id uuid,late_date date);
        CREATE TABLE student_exits(school_id uuid,exit_date date);
        CREATE FUNCTION fn_current_user_role() RETURNS role_type LANGUAGE sql STABLE SECURITY DEFINER
            SET search_path=public AS $$ SELECT role_type FROM users WHERE auth_user_id=auth.uid() LIMIT 1 $$;
        CREATE FUNCTION fn_current_school_id() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER
            SET search_path=public AS $$ SELECT school_id FROM users WHERE auth_user_id=auth.uid() LIMIT 1 $$;
    `);
    const actors = [
        [1,'STAKEHOLDER',true,null,false,901], [2,'STAKEHOLDER',false,null,false,901],
        [3,'STAKEHOLDER',true,'2026-09-01',false,901], [4,'KEPSEK',true,null,false,901],
        [5,'GURU',true,null,true,901], [6,'GURU',true,null,false,901],
        [7,'KEPSEK',false,null,false,901], [8,'STAKEHOLDER',true,null,false,902],
        [9,'STAKEHOLDER',true,null,false,903], [10,'GURU',false,null,false,901],
        [11,'GURU',true,'2026-09-01',false,901], [12,'GURU',true,null,false,902],
        [13,'STAKEHOLDER',null,null,false,901],
    ];
    for (const [n,role,active,deleted,flag,school] of actors) await db.query(
        'INSERT INTO users VALUES($1,$1,$2,$3,$4,$5,$6)', [id(n),id(school),role,active,deleted,flag]);
    for (const [n,school,status] of [[101,901,'AKTIF'],[102,901,'PKL'],[103,901,'LULUS'],[201,902,'AKTIF']])
        await db.query('INSERT INTO students VALUES($1,$2,$3)',[id(n),id(school),status]);
    for (const table of ['programs','classes']) for (const [n,school,active] of [[1,901,true],[2,901,false],[3,902,true]])
        await db.query(`INSERT INTO ${table} VALUES($1,$2,$3)`,[id(n),id(school),active]);
    for (const [n,school,date,teacher,status] of [
        [301,901,'2026-09-30',6,'NORMAL'],[302,901,'2026-10-01',6,'NORMAL'],
        [303,901,'2026-10-01',5,'NORMAL'],[304,901,'2026-10-01',6,'NORMAL'],
        [305,901,'2026-10-01',6,'CANCELLED'],[401,902,'2026-10-01',12,'NORMAL'],
    ]) await db.query('INSERT INTO teaching_schedules VALUES($1,$2,$3,$4,$5)',[id(n),id(school),date,id(teacher),status]);
    for (const [schedule,student,school,status,isVoid] of [
        [301,101,901,'HADIR',false],[302,101,901,'HADIR',false],
        [303,101,901,'ALPA',false],[304,102,901,'HADIR',true],[401,201,902,'HADIR',false],
    ]) await db.query('INSERT INTO attendance VALUES($1,$2,$3,$4,$5)',[id(schedule),id(student),id(school),status,isVoid]);
    for (const table of ['late_arrivals','student_exits']) for (const [school,date] of [[901,'2026-09-30'],[901,'2026-10-01'],[902,'2026-10-01']])
        await db.query(`INSERT INTO ${table} VALUES($1,$2)`,[id(school),date]);
    const kepsekSource = read('20261009090000_kepsek_monitoring_and_admin_hardening.sql');
    await test('shared monitoring definition changes only its school-date clock',async()=>{
        const original = definition(kepsekSource,'fn_kepsek_monitoring').replaceAll('\r\n','\n');
        const expected = original.replace('    v_school_id   uuid;',
            "    v_today       date := (now() AT TIME ZONE 'Asia/Jakarta')::date;\n    v_school_id   uuid;")
            .replaceAll('CURRENT_DATE','v_today');
        assert.equal(definition(migration,'fn_kepsek_monitoring'),expected);
    });
    await db.exec(definition(kepsekSource, 'fn_is_kepsek'));
    await db.exec(definition(read('20261003110000_fix-stakeholder-summary-session-date.sql'), 'fn_stakeholder_summary'));
    await db.exec(definition(kepsekSource, 'fn_kepsek_monitoring'));
    await test('baseline proves disabled/deleted stakeholder summary remains accessible', async () => {
        for (const actor of [2,3]) { await caller(actor); assert.equal((await summary()).total_siswa,1); }
    });
    await db.exec('RESET ROLE'); await db.exec(migration); await db.exec(migration);
    await test('repeatable migration revokes anonymous and inherited public execution', async () => {
        const rows = (await db.query(`SELECT p.oid::regprocedure::text AS name,
            has_function_privilege('anon',p.oid,'EXECUTE') AS anon,
            has_function_privilege('unrelated',p.oid,'EXECUTE') AS unrelated,
            has_function_privilege('authenticated',p.oid,'EXECUTE') AS allowed,
            p.prosecdef,p.proconfig FROM pg_proc p
            WHERE p.proname IN ('fn_stakeholder_summary','fn_kepsek_monitoring')`)).rows;
        assert.equal(rows.length,2);
        for (const row of rows) {
            assert.equal(row.anon,false); assert.equal(row.unrelated,false); assert.equal(row.allowed,true);
            assert.equal(row.prosecdef,true); assert(row.proconfig.includes('search_path=public'));
        }
    });
    await test('disabled, deleted, null-active, wrong-role and missing callers denied', async () => {
        for (const actor of [2,3,6,7,13,999,null]) {
            await caller(actor);
            await assert.rejects(summary, error => error.code === '42501');
            await assert.rejects(() => monitoring());
        }
    });
    await test('real clock presets use school date regardless of session timezone', async () => {
        for (const zone of ['UTC','Pacific/Honolulu','Pacific/Kiritimati']) {
            await db.exec('RESET ROLE'); await db.query("SELECT set_config('TimeZone',$1,false)",[zone]);
            const today = (await db.query("SELECT (now() AT TIME ZONE 'Asia/Jakarta')::date::text AS date")).rows[0].date;
            await caller(1); const data = await monitoring();
            assert.equal(data.date_start,today); assert.equal(data.date_end,today);
        }
        await db.exec("RESET ROLE; SET TimeZone='UTC'");
    });
    await freezeClock('2026-09-30T17:30:00Z');
    await test('WIB midnight switches summary day/month; active counts exclude retired records', async () => {
        await caller(1); const s = await summary();
        assert.equal(s.total_siswa,1); assert.equal(s.total_pkl,1); assert.equal(s.total_staf,3);
        assert.equal(s.total_program,1); assert.equal(s.total_kelas,1);
        assert.equal(s.sesi_hari_ini,4); assert.equal(s.hadir_hari_ini,1); assert.equal(s.kehadiran_bulan_pct,50);
    });
    await test('WIB presets retain day, week and month boundaries', async () => {
        await caller(1);
        for (const [period,start,end] of [
            ['hari_ini','2026-10-01','2026-10-01'],['7_hari','2026-09-25','2026-10-01'],
            ['minggu_lalu','2026-09-21','2026-09-27'],['bulan_lalu','2026-09-01','2026-09-30'],
        ]) {
            const d = await monitoring(period); assert.equal(d.date_start,start,period); assert.equal(d.date_end,end,period);
        }
    });
    await test('stakeholder, Kepsek role and Kepsek flag share identical aggregates', async () => {
        let expected;
        for (const actor of [1,4,5]) {
            await caller(actor); const d = await monitoring();
            expected ??= d; assert.deepEqual(d,expected); assert.equal((await summary()).total_staf,3);
        }
        assert.equal(expected.summary.pct_siswa,50); assert.equal(expected.summary.pct_guru,100);
        assert.equal(expected.summary.count_late,1); assert.equal(expected.summary.count_exits,1);
        assert.equal(expected.chart.length,1);
    });
    await test('other school summary/monitoring cannot include school A data', async () => {
        await caller(8); const s = await summary(), d = await monitoring();
        assert.equal(s.total_staf,1); assert.equal(s.sesi_hari_ini,1); assert.equal(s.kehadiran_bulan_pct,100);
        assert.equal(d.summary.siswa_total,1); assert.equal(d.summary.pct_siswa,100); assert.equal(d.summary.guru_total,1);
        assert.equal(d.data_earliest,'2026-10-01');
        assert(!JSON.stringify(d).includes(id(901)));
    });
    await test('empty denominator stays null while actual absence remains zero', async () => {
        await caller(9); const d = await monitoring();
        assert.equal(d.summary.pct_siswa,null); assert.equal(d.summary.pct_guru,null); assert.deepEqual(d.chart,[]);
        assert.equal((await summary()).kehadiran_bulan_pct,null);
        await caller(1); const emptyRange = await monitoring('rentang',null,'2026-09-01','2026-09-02');
        assert.equal(emptyRange.summary.pct_siswa,0); assert.equal(emptyRange.summary.pct_guru,null);
    });
    await test('row attendance ratio is preserved, distinct monitoring formula is unchanged', async () => {
        await caller(1); const d = await monitoring('7_hari');
        assert.equal((await summary()).kehadiran_bulan_pct,50);
        assert.equal(d.summary.pct_siswa,50); assert.equal(d.summary.siswa_hadir,1);
        assert.equal(d.summary.siswa_total,2); assert.equal(d.chart.length,2);
    });
    await test('custom/year periods and partial-month clipping retain date arguments', async () => {
        await caller(1);
        const d = await monitoring('rentang',null,'2026-09-30','2026-12-05');
        assert.equal(d.by_month,true); assert.equal(d.summary.count_late,2);
        assert.equal(d.chart[0].count_late,1);
        const year = await monitoring('tahun_ajaran_lalu','2025/2026');
        assert.equal(year.date_start,'2025-07-01'); assert.equal(year.date_end,'2026-06-30');
        await assert.rejects(() => monitoring('tahun_ajaran_lalu'));
        await assert.rejects(() => monitoring('rentang',null,'2026-10-02','2026-10-01'), error => error.code === '22007');
    });
    await freezeClock('2026-09-30T16:59:00Z');
    await test('before midnight WIB summary still belongs to September', async () => {
        await caller(1); assert.equal((await monitoring()).date_start,'2026-09-30');
        assert.equal((await summary()).sesi_hari_ini,1);
    });
    await freezeClock('2026-10-04T17:01:00Z');
    await test('Monday WIB previous-week preset excludes the new week', async () => {
        await caller(4); const d = await monitoring('minggu_lalu');
        assert.equal(d.date_start,'2026-09-28'); assert.equal(d.date_end,'2026-10-04');
    });
    await db.exec('RESET ROLE; BEGIN'); await db.exec(migration); await db.exec('ROLLBACK');
    console.log(`${passed} stakeholder PostgreSQL tests passed; no remote writes.`);
} finally { await db.close(); }
