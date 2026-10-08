// Requires @electric-sql/pglite. Runs the actual migration in memory, never on Supabase.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const id = n => '00000000-0000-0000-0000-' + String(n).padStart(12, '0');
const db = await PGlite.create();
const schoolA = id(9001), schoolB = id(9002), teacher = id(101), otherTeacher = id(104);
let passed = 0;
async function test(label, fn) { await fn(); console.log('PASS SQL ' + (++passed) + ': ' + label); }
async function caller(n, role = 'authenticated') {
    await db.exec('RESET ROLE;');
    await db.query("SELECT set_config('request.jwt.claim.sub', $1, false);", [n == null ? '' : id(n + 1000)]);
    await db.exec('SET ROLE ' + role + ';');
}
const calls = [
    "SELECT * FROM fn_waka_kur_stats('2026-10-01','2026-10-02');",
    "SELECT * FROM fn_pending_sessions_by_teacher('2026-10-01','2026-10-02');",
    "SELECT * FROM fn_pending_attendance_sessions('2026-10-02');",
    "SELECT * FROM fn_pending_sessions_detail('" + teacher + "','2026-10-01','2026-10-02');",
];
try {
    await db.exec(`
        CREATE ROLE authenticated;
        CREATE ROLE anon;
        CREATE ROLE unrelated;
        CREATE SCHEMA auth;
        CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
            SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid;
        $$;
        GRANT USAGE ON SCHEMA auth TO authenticated,anon;
        CREATE TABLE users(user_id uuid PRIMARY KEY,auth_user_id uuid UNIQUE,school_id uuid,
            full_name varchar(200),role_type varchar(30),is_active boolean,
            is_waka_kurikulum boolean DEFAULT false,is_kepsek boolean DEFAULT false);
        CREATE TABLE subjects(subject_id uuid PRIMARY KEY,name varchar(200));
        CREATE TABLE classes(class_id uuid PRIMARY KEY,school_id uuid,name varchar(200));
        CREATE TABLE teaching_schedules(schedule_id uuid PRIMARY KEY,school_id uuid,
            scheduled_teacher_id uuid,subject_id uuid,class_id uuid,meeting_status varchar(30),
            session_date date,session_start time,session_end time);
        CREATE TABLE attendance(schedule_id uuid,is_void boolean);
        CREATE FUNCTION fn_current_school_id() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER AS $$
            SELECT school_id FROM users WHERE auth_user_id=auth.uid() LIMIT 1;
        $$;
    `);
    const users = [
        [1,'WAKA_KURIKULUM',true,false,false], [2,'GURU',true,true,false],
        [3,'KEPSEK',true,false,false], [4,'ADMINISTRATIVE',true,false,false],
        [5,'SISWA',true,false,false], [6,'ORTU',true,false,false],
        [7,'GURU',true,false,false], [8,'WAKA_KURIKULUM',false,false,false],
        [9,'GURU',false,true,false], [10,'WAKA_KURIKULUM',true,false,false],
        [11,'GURU',true,false,true], [12,'KEPSEK',false,false,false],
        [13,'ADMINISTRATIVE',false,false,false], [14,'DUDI',true,false,false],
        [15,'STAKEHOLDER',true,false,false],
        ...[101,102,103,104].map(n => [n,'GURU',true,false,false]),
    ];
    for (const [n,role,active,waka,kepsek] of users) {
        await db.query('INSERT INTO users VALUES($1,$2,$3,$4,$5,$6,$7,$8);',
            [id(n),id(n+1000),[10,104].includes(n)?schoolB:schoolA,'Fixture '+n,role,active,waka,kepsek]);
    }
    await db.query('INSERT INTO subjects VALUES($1,$2);',[id(301),'Math']);
    await db.query('INSERT INTO classes VALUES($1,$2,$3),($4,$5,$6);',[id(401),schoolA,'Class A',id(402),schoolB,'Class B']);
    const schedules = [[1,101,'2026-10-01','NORMAL'],[2,101,'2026-10-02','NORMAL'],
        [3,102,'2026-10-02','NORMAL'],[4,103,'2026-10-02','NORMAL'],
        [5,103,'2026-10-03','CANCELLED'],[6,104,'2026-10-02','NORMAL']];
    for (const [n,t,date,status] of schedules) {
        await db.query("INSERT INTO teaching_schedules VALUES($1,$2,$3,$4,$5,$6,$7,'08:00','09:00');",
            [id(n+500),t===104?schoolB:schoolA,id(t),id(301),t===104?id(402):id(401),status,date]);
    }
    await db.query('INSERT INTO attendance VALUES($1,false),($2,true),($3,false);',[id(501),id(503),id(504)]);
    for (const file of ['20260803070000_fn-waka-kur-stats.sql','20260803080000_fix-pending-sessions-exists.sql',
        '20260803090000_fn-pending-attendance-sessions-v2.sql']) {
        await db.exec(read('supabase/migrations/' + file));
    }
    await test('baseline reproduces student access and undercounts partially filled teachers', async () => {
        await caller(5);
        assert.equal((await db.query(calls[1])).rows.length,2);
        const old = (await db.query(calls[0])).rows[0];
        assert.equal(Number(old.guru_belum),1);
    });
    await caller(null,'authenticated');
    await db.exec('RESET ROLE;');
    const migration = read('supabase/migrations/20261008180000_waka_kurikulum_monitoring_hardening.sql');
    await test('migration applies over existing signatures and can be applied twice', async () => {
        await db.exec(migration);await db.exec(migration);
    });
    await test('anon and unrelated roles have no EXECUTE, authenticated retains EXECUTE', async () => {
        const functions = ['fn_waka_kur_stats(date,date)','fn_pending_sessions_by_teacher(date,date)',
            'fn_pending_attendance_sessions(date)','fn_pending_sessions_detail(uuid,date,date)'];
        for (const fn of functions) {
            const row = (await db.query("SELECT has_function_privilege('anon',$1,'EXECUTE') AS anon,"
                + "has_function_privilege('unrelated',$1,'EXECUTE') AS public,"
                + "has_function_privilege('authenticated',$1,'EXECUTE') AS authenticated;",[fn])).rows[0];
            assert.deepEqual(row,{anon:false,public:false,authenticated:true});
        }
        await caller(null,'anon');
        for (const sql of calls) await assert.rejects(db.query(sql),err=>err.code==='42501');
    });
    for (const [n,label] of [[5,'student'],[6,'parent'],[7,'unassigned teacher'],[8,'inactive Waka'],
        [9,'inactive additional Waka'],[12,'inactive principal'],[13,'inactive admin'],[14,'DUDI'],[15,'stakeholder'],[null,'missing identity']]) {
        await test('all four RPCs reject ' + label,async()=>{
            await caller(n);
            for (const sql of calls) await assert.rejects(db.query(sql),err=>err.code==='42501');
        });
    }
    for (const [n,label] of [[1,'Waka'],[2,'teacher with additional Waka assignment'],[3,'principal'],[4,'school admin'],[11,'teacher with principal assignment']]) {
        await test('all four RPCs accept active ' + label,async()=>{
            await caller(n);
            for (const sql of calls) assert((await db.query(sql)).rows.length>0);
        });
    }
    await test('partial teacher remains pending while participation percentage stays unchanged',async()=>{
        await caller(1);
        const row=(await db.query(calls[0])).rows[0];
        assert.deepEqual([row.guru_hadir,row.guru_total,row.guru_belum,row.pct_hadir].map(Number),[2,3,2,66.7]);
        const list=(await db.query(calls[1])).rows;
        assert.equal(list.length,Number(row.guru_belum));
        assert(list.some(r=>r.teacher_id===teacher));
    });
    await test('void attendance remains pending and cancelled meetings are excluded',async()=>{
        const rows=(await db.query("SELECT * FROM fn_pending_sessions_by_teacher(NULL,NULL);")).rows;
        assert.deepEqual(rows.map(r=>[r.teacher_id,Number(r.jumlah)]).sort(),[[id(101),1],[id(102),1]]);
    });
    await test('school filter blocks other-school teacher detail and data aggregation',async()=>{
        assert.equal((await db.query('SELECT * FROM fn_pending_sessions_detail($1,NULL,NULL);',[otherTeacher])).rows.length,0);
        await caller(10);
        const row=(await db.query(calls[0])).rows[0];
        assert.deepEqual([row.guru_hadir,row.guru_total,row.guru_belum].map(Number),[0,1,1]);
        assert.equal((await db.query('SELECT * FROM fn_pending_sessions_detail($1,NULL,NULL);',[teacher])).rows.length,0);
    });
    await test('null endpoints have the same range semantics for statistics, groups and detail',async()=>{
        await caller(1);
        for (const [start,end] of [[null,null],[null,'2026-10-02'],['2026-10-02',null]]) {
            const stats=(await db.query('SELECT * FROM fn_waka_kur_stats($1,$2);',[start,end])).rows[0];
            const groups=(await db.query('SELECT * FROM fn_pending_sessions_by_teacher($1,$2);',[start,end])).rows;
            assert.equal(groups.length,Number(stats.guru_belum));
            for (const group of groups) assert.equal((await db.query('SELECT * FROM fn_pending_sessions_detail($1,$2,$3);',
                [group.teacher_id,start,end])).rows.length,Number(group.jumlah));
        }
    });
    await test('reversed ranges are rejected by all range RPCs',async()=>{
        const reversed=["SELECT * FROM fn_waka_kur_stats('2026-10-03','2026-10-01');",
            "SELECT * FROM fn_pending_sessions_by_teacher('2026-10-03','2026-10-01');",
            "SELECT * FROM fn_pending_sessions_detail('"+teacher+"','2026-10-03','2026-10-01');"];
        for (const sql of reversed) await assert.rejects(db.query(sql),err=>err.code==='22007');
    });
    await test('empty range has zero teachers, zero pending and no participation percentage',async()=>{
        const row=(await db.query("SELECT * FROM fn_waka_kur_stats('2026-11-01','2026-11-02');")).rows[0];
        assert.deepEqual([row.guru_hadir,row.guru_total,row.guru_belum].map(Number),[0,0,0]);
        assert.equal(row.pct_hadir,null);
    });
    console.log('SQL_COMPLETE: '+passed+' checks passed; in-memory PostgreSQL, no Supabase writes.');
} finally { await db.close(); }
