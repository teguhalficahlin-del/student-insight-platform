// Local PostgreSQL regression tests. Requires @electric-sql/pglite; no remote database.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const { PGlite } = createRequire(import.meta.url)('@electric-sql/pglite');
const root = new URL('../', import.meta.url);
const read = file => readFileSync(new URL(file, root), 'utf8');
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const [school, foreignSchool, classId, otherClass, foreignClass, program] = [1,2,3,4,5,6].map(uuid);
const [wali, teacher, unrelated, studentUser, parent, dudi, inactive, bk, kaprodi, foreignWali] = [10,11,12,13,14,15,16,17,18,19].map(uuid);
const [student, otherStudent, foreignStudent, pkl, withdrawn, graduated] = [20,21,22,23,24,25].map(uuid);
const db = new PGlite();
let passed = 0;
async function test(name, fn) { await fn(); console.log(`PASS ${++passed}: ${name}`); }
function definition(file, name) {
    const sql = read(file);
    const start = sql.search(new RegExp(`CREATE OR REPLACE FUNCTION (?:public\\.)?${name}\\(`));
    assert(start >= 0, `Missing helper ${name}`);
    const match = sql.slice(start).match(/^[\s\S]*?AS (\$\w*\$)[\s\S]*?\1;/);
    assert(match, `Missing body ${name}`);
    return match[0];
}
await db.exec(`
    CREATE ROLE authenticated; CREATE ROLE anon; CREATE ROLE service_role;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
        SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
    $$;
    GRANT USAGE ON SCHEMA auth TO authenticated, anon;
    CREATE TYPE role_type AS ENUM ('GURU','WALI_KELAS','BK','KAPRODI','KEPSEK','WAKA_KURIKULUM','WAKA_KESISWAAN','WAKA_HUMAS','SISWA','ORTU','DUDI','STAKEHOLDER');
    CREATE TYPE attendance_status AS ENUM ('HADIR','ALPA','IZIN','SAKIT');
    CREATE TABLE users (user_id uuid PRIMARY KEY, auth_user_id uuid, school_id uuid, role_type role_type,
        full_name varchar(150), is_active boolean DEFAULT true, wali_kelas_class_id uuid,
        kaprodi_program_id uuid, program_id uuid, is_bk boolean DEFAULT false, is_kepsek boolean DEFAULT false,
        is_waka_kurikulum boolean DEFAULT false, is_waka_kesiswaan boolean DEFAULT false);
    CREATE TABLE classes (class_id uuid PRIMARY KEY, school_id uuid);
    CREATE TABLE students (student_id uuid PRIMARY KEY, school_id uuid, full_name varchar(150),
        nis varchar(20), student_status text, program_id uuid);
    CREATE TABLE class_enrollments (student_id uuid, school_id uuid, class_id uuid, academic_year text, withdrawn_at timestamptz);
    CREATE TABLE teaching_assignments (class_id uuid, school_id uuid, user_id uuid, is_active boolean);
    CREATE TABLE teaching_schedules (schedule_id uuid PRIMARY KEY, school_id uuid, class_id uuid,
        academic_year text, scheduled_teacher_id uuid, session_date date, session_start time,
        session_end time, subject_label varchar(100));
    CREATE TABLE attendance (attendance_id uuid PRIMARY KEY, schedule_id uuid, school_id uuid,
        student_id uuid, status attendance_status, notes text, is_void boolean DEFAULT false);
    INSERT INTO classes VALUES ('${classId}','${school}'),('${otherClass}','${school}'),('${foreignClass}','${foreignSchool}');
    INSERT INTO users (user_id,auth_user_id,school_id,role_type,full_name,wali_kelas_class_id,is_active) VALUES
        ('${wali}','${wali}','${school}','GURU','Wali','${classId}',true),
        ('${teacher}','${teacher}','${school}','GURU','Teacher',NULL,true),
        ('${unrelated}','${unrelated}','${school}','GURU','Unrelated',NULL,true),
        ('${studentUser}','${studentUser}','${school}','SISWA','Student','${classId}',true),
        ('${parent}','${parent}','${school}','ORTU','Parent',NULL,true),
        ('${dudi}','${dudi}','${school}','DUDI','DUDI',NULL,true),
        ('${inactive}','${inactive}','${school}','WALI_KELAS','Inactive','${classId}',false),
        ('${bk}','${bk}','${school}','BK','BK',NULL,true),
        ('${kaprodi}','${kaprodi}','${school}','GURU','Kaprodi',NULL,true),
        ('${foreignWali}','${foreignWali}','${foreignSchool}','GURU','Foreign Wali','${foreignClass}',true);
    UPDATE users SET kaprodi_program_id='${program}' WHERE user_id='${kaprodi}';
    INSERT INTO students VALUES
        ('${student}','${school}','Active','001','AKTIF','${program}'),
        ('${otherStudent}','${school}','Other class','002','AKTIF',NULL),
        ('${foreignStudent}','${foreignSchool}','Foreign','003','AKTIF',NULL),
        ('${pkl}','${school}','PKL','004','PKL',NULL),
        ('${withdrawn}','${school}','Withdrawn','005','AKTIF',NULL),
        ('${graduated}','${school}','Graduated','006','LULUS',NULL);
    INSERT INTO class_enrollments VALUES
        ('${student}','${school}','${classId}','2026/2027',NULL),
        ('${student}','${school}','${classId}','2025/2026',NULL),
        ('${otherStudent}','${school}','${otherClass}','2026/2027',NULL),
        ('${foreignStudent}','${foreignSchool}','${foreignClass}','2026/2027',NULL),
        ('${pkl}','${school}','${classId}','2026/2027',NULL),
        ('${withdrawn}','${school}','${classId}','2026/2027',now()),
        ('${graduated}','${school}','${classId}','2026/2027',NULL);
    INSERT INTO teaching_assignments VALUES ('${classId}','${school}','${teacher}',true);
    GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;
`);
for (const [file, names] of [
    ['20250624000002_security_definer_search_path.sql',['fn_current_user_id','fn_wali_kelas_class_id']],
    ['20260701120000_school_id_functions_triggers.sql',['fn_current_school_id']],
    ['20260701280000_rls_isolate_staff_read.sql',['fn_kaprodi_program_id']],
    ['20260712040000_fix_fn_is_schoolwide_observer.sql',['fn_is_schoolwide_observer']],
    ['20260707120000_cases_insert_fix_v2_student_school_fn.sql',['fn_student_in_current_school']],
    ['20260827510000_fix_f01_f02_tenant_guards.sql',['fn_teaches_student','fn_wali_of_student','fn_kaprodi_of_student','fn_can_see_student']],
]) for (const name of names) await db.exec(definition(`supabase/migrations/${file}`, name));

for (let i = 1; i <= 54; i++) {
    const old = i === 50, wrongClass = i === 51, voided = i === 52, foreignAttendance = i === 53;
    await db.query(`INSERT INTO teaching_schedules VALUES ($1,$2,$3,$4,$5,'2026-10-01','08:00','09:00','Math')`,
        [uuid(100+i), school, wrongClass ? otherClass : classId, old ? '2025/2026' : '2026/2027', i <= 6 ? wali : teacher]);
    await db.query(`INSERT INTO attendance VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [uuid(200+i), uuid(100+i), foreignAttendance ? foreignSchool : school,
            i === 54 ? otherStudent : student, i % 2 ? 'HADIR' : 'ALPA', 'Local note', voided]);
}
await db.exec(`ALTER TABLE teaching_schedules ENABLE ROW LEVEL SECURITY;
    CREATE POLICY own_sessions ON teaching_schedules TO authenticated
        USING (scheduled_teacher_id=fn_current_user_id());`);
const migration = read('supabase/migrations/20261007160000_wali_attendance_access_and_detail.sql');
await db.exec(read('supabase/migrations/20261007120000_fix_class_attendance_active_enrollment.sql'));
await test('migration transaction rolls back without leaving the new RPC', async () => {
    await db.exec(migration.replace(/COMMIT;\s*$/, 'ROLLBACK;'));
    const result = await db.query("SELECT to_regprocedure('fn_wali_attendance_sessions(uuid,text,uuid,date,date)') AS rpc");
    assert.equal(result.rows[0].rpc,null);
});
await test('migration replaces existing summary and can be applied twice', async () => {
    await db.exec(migration); await db.exec(migration);
});
async function as(user, fn, role='authenticated') {
    await db.exec(`SET ROLE ${role};`);
    await db.query(`SELECT set_config('request.jwt.claim.sub',$1,false)`, [user ?? '']);
    try { return await fn(); } finally { await db.exec('RESET ROLE;'); }
}
const summary = (cls=classId, year='2026/2027', start=null, end=null, teacherId=null) =>
    db.query('SELECT * FROM fn_class_attendance_summary($1,$2,$3,$4,$5)', [cls,year,start,end,teacherId]).then(r=>r.rows);
const detail = (sid=student, cls=classId, year='2026/2027', start=null, end=null) =>
    db.query('SELECT * FROM fn_wali_attendance_sessions($1,$2,$3,$4,$5)', [cls,year,sid,start,end]).then(r=>r.rows);
try {
    for (const [label,user] of [['student',studentUser],['parent',parent],['DUDI',dudi],['inactive staff',inactive],['no user',null]]) {
        await test(`${label} cannot invoke either attendance RPC`, async () => as(user, async()=>{
            await assert.rejects(summary(), {code:'42501'}); await assert.rejects(detail(), {code:'42501'});
        }));
    }
    await test('anonymous execute privilege revoked for both RPCs', async () => as(null, async()=>{
        await assert.rejects(summary(), {code:'42501'}); await assert.rejects(detail(), {code:'42501'});
    },'anon'));
    await test('wali summary and detail both return 49, while direct schedule RLS still returns 6', async () => as(wali, async()=>{
        const rows = await summary(), sessions = await detail();
        assert.equal(rows.length,1); assert.equal(Number(rows[0].total),49); assert.equal(sessions.length,49);
        assert.equal(Number(rows[0].hadir),25); assert.equal(Number(rows[0].alpa),24);
        assert.equal(sessions.filter(r=>r.teacher_full_name==='Teacher').length,43);
        assert(sessions.every(r=>r.notes==='Local note'));
        assert.equal((await db.query('SELECT * FROM teaching_schedules')).rows.length,6);
        assert.equal(Number((await summary(classId,'2026/2027',null,null,wali))[0].total),6);
    }));
    await test('unrelated teacher gets no summary and cannot call wali detail', async () => as(unrelated, async()=>{
        assert.deepEqual(await summary(),[]); await assert.rejects(detail(),{code:'42501'});
    }));
    for (const [label,user] of [['assigned teacher',teacher],['schoolwide BK',bk],['GURU with kaprodi flag',kaprodi]]) {
        await test(`${label} retains authorized summary access without wali detail access`, async () => as(user, async()=>{
            assert.equal(Number((await summary())[0].total),49); await assert.rejects(detail(),{code:'42501'});
        }));
    }
    await test('wali cannot query another class, student or tenant', async () => as(wali, async()=>{
        assert.deepEqual(await summary(otherClass),[]); assert.deepEqual(await summary(foreignClass),[]);
        assert.deepEqual(await detail(otherStudent),[]); assert.deepEqual(await detail(foreignStudent),[]);
        await assert.rejects(detail(otherStudent,otherClass),{code:'42501'});
        await assert.rejects(detail(foreignStudent,foreignClass),{code:'42501'});
    }));
    await test('foreign-school wali cannot read this school', async()=>as(foreignWali,async()=>{
        assert.deepEqual(await summary(),[]); await assert.rejects(detail(),{code:'42501'});
    }));
    await test('detail excludes withdrawn, PKL and graduated students', async()=>as(wali,async()=>{
        for (const sid of [withdrawn,pkl,graduated]) assert.deepEqual(await detail(sid),[]);
    }));
    await test('all eight portal roles retain Wali access when assigned to that class', async()=>{
        for (const role of ['GURU','WALI_KELAS','BK','KAPRODI','KEPSEK','WAKA_KURIKULUM','WAKA_KESISWAAN','WAKA_HUMAS']) {
            await db.query('UPDATE users SET role_type=$1::role_type WHERE user_id=$2',[role,wali]);
            await as(wali,async()=>{
                assert.equal(Number((await summary())[0].total),49);
                assert.equal((await detail()).length,49);
            });
        }
        await db.query("UPDATE users SET role_type='GURU' WHERE user_id=$1",[wali]);
    });
    await test('class/year/date filters and reversed-date error agree between both RPCs', async()=>as(wali,async()=>{
        assert.equal((await detail(student,classId,'2025/2026')).length,1);
        assert.equal(Number((await summary(classId,'2025/2026'))[0].total),1);
        assert.equal((await detail(student,classId,'2026/2027','2026-10-02')).length,0);
        assert.equal(Number((await summary(classId,'2026/2027','2026-10-02'))[0].total),0);
        assert.equal((await detail(student,classId,'2026/2027',null,'2026-09-30')).length,0);
        await assert.rejects(summary(classId,'2026/2027','2026-10-02','2026-10-01'),{code:'22023'});
        await assert.rejects(detail(student,classId,'2026/2027','2026-10-02','2026-10-01'),{code:'22023'});
    }));
    console.log(`${passed} PostgreSQL checks passed in memory; no production connections.`);
} finally { await db.close(); }
