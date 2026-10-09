// Execute the migration with real PostgreSQL RLS in memory, without Supabase writes.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const read = file => readFileSync(new URL('../supabase/migrations/' + file, import.meta.url), 'utf8');
const id = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const db = await PGlite.create();
let passed = 0;
async function test(label, fn) { await fn(); console.log(`PASS SQL ${++passed}: ${label}`); }
function definition(file, name) {
    const source = read(file);
    const start = source.search(new RegExp(`CREATE OR REPLACE FUNCTION (?:public\\.)?${name}\\(`));
    assert(start >= 0, name);
    return source.slice(start).match(/^[\s\S]*?AS (\$\w*\$)[\s\S]*?\1;/)[0];
}
async function caller(n) {
    await db.exec('RESET ROLE');
    await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [id(n)]);
    await db.exec('SET ROLE authenticated');
}
const recap = async () => (await db.query('SELECT * FROM fn_pkl_attendance_recap($1,$2,$3)',
    [[id(101),id(102),id(103),id(104)],'2026-10-01','2026-10-07'])).rows;
try {
    await db.exec(`
        CREATE ROLE authenticated; CREATE ROLE anon; CREATE ROLE service_role;
        CREATE ROLE unrelated;
        CREATE SCHEMA auth;
        CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
            SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid;
        $$;
        GRANT USAGE ON SCHEMA auth TO authenticated, anon;
        CREATE TYPE role_type AS ENUM ('GURU','WAKA_HUMAS','KAPRODI','KEPSEK','BK',
            'WAKA_KURIKULUM','WAKA_KESISWAAN','ADMINISTRATIVE','SISWA','ORTU','DUDI');
        CREATE TABLE users(user_id uuid PRIMARY KEY,auth_user_id uuid,school_id uuid,
            role_type role_type,is_active boolean DEFAULT true,deleted_at timestamptz,
            is_waka_humas boolean DEFAULT false,kaprodi_program_id uuid,program_id uuid,
            is_bk boolean DEFAULT false,is_kepsek boolean DEFAULT false,
            is_waka_kurikulum boolean DEFAULT false,is_waka_kesiswaan boolean DEFAULT false);
        CREATE TABLE students(student_id uuid PRIMARY KEY,school_id uuid,program_id uuid,student_status text);
        CREATE TABLE pkl_placements(placement_id uuid,school_id uuid,student_id uuid,is_active boolean);
        CREATE TABLE observations(observation_id uuid,school_id uuid,student_id uuid,visibility text,is_void boolean);
        CREATE TABLE pkl_attendance(pkl_attendance_id uuid,school_id uuid,student_id uuid,status text,attendance_date date);
        ALTER TABLE students ENABLE ROW LEVEL SECURITY;
        ALTER TABLE pkl_placements ENABLE ROW LEVEL SECURITY;
        ALTER TABLE observations ENABLE ROW LEVEL SECURITY;
        ALTER TABLE pkl_attendance ENABLE ROW LEVEL SECURITY;
        GRANT SELECT,INSERT,UPDATE,DELETE ON students,pkl_placements,observations,pkl_attendance TO authenticated;
    `);
    for (const [n,role,flag,active,deleted,school,program] of [
        [1,'WAKA_HUMAS',false,true,false,901,null],
        [2,'GURU',true,true,false,901,null],
        [3,'WAKA_HUMAS',false,false,false,901,null],
        [4,'GURU',true,false,false,901,null],
        [5,'WAKA_HUMAS',false,true,true,901,null],
        [6,'GURU',false,true,false,901,null],
        [7,'WAKA_HUMAS',false,true,false,902,null],
        [8,'KAPRODI',false,true,false,901,201],
        [9,'KEPSEK',false,true,false,901,null],
        [10,'ADMINISTRATIVE',false,true,false,901,null],
        [11,'SISWA',false,true,false,901,null],
        [12,'DUDI',false,true,false,901,null],
    ]) await db.query('INSERT INTO users(user_id,auth_user_id,school_id,role_type,is_waka_humas,is_active,deleted_at,program_id) VALUES($1,$1,$2,$3,$4,$5,$6,$7)',
        [id(n),id(school),role,flag,active,deleted?'2026-10-01':null,program?id(program):null]);
    for (const [n,school,program,status] of [[101,901,201,'PKL'],[102,901,202,'PKL'],[103,901,201,'AKTIF'],[104,902,201,'PKL']]) {
        await db.query('INSERT INTO students VALUES($1,$2,$3,$4)',[id(n),id(school),id(program),status]);
        await db.query('INSERT INTO pkl_placements VALUES($1,$2,$3,true)',[id(n+200),id(school),id(n)]);
        await db.query("INSERT INTO observations VALUES($1,$2,$3,'RESTRICTED',false)",[id(n+300),id(school),id(n)]);
    }
    await db.query("INSERT INTO observations VALUES($1,$2,$3,'RESTRICTED',true),($4,$2,$3,'SISWA_SAJA',false)",
        [id(500),id(901),id(101),id(501)]);
    for (const [i,status] of ['HADIR','HADIR','HADIR','HADIR','ALPA','IZIN','SAKIT'].entries())
        await db.query("INSERT INTO pkl_attendance VALUES($1,$2,$3,$4,'2026-10-02')",[id(600+i),id(901),id(101),status]);
    await db.query("INSERT INTO pkl_attendance VALUES($1,$2,$3,'ALPA','2026-10-02'),($4,$5,$3,'ALPA','2026-09-01')",
        [id(700),id(902),id(101),id(701),id(901)]);
    for (const [file,names] of [
        ['20250624000002_security_definer_search_path.sql',['fn_current_user_role']],
        ['20260701120000_school_id_functions_triggers.sql',['fn_current_school_id']],
        ['20260701280000_rls_isolate_staff_read.sql',['fn_kaprodi_program_id']],
        ['20260712040000_fix_fn_is_schoolwide_observer.sql',['fn_is_schoolwide_observer']],
        ['20261008120000_kaprodi_access_hardening.sql',['fn_pkl_attendance_recap']],
    ]) for (const name of names) await db.exec(definition(file,name));
    await test('baseline RPC returns no recap for Waka Humas',async()=>{
        await caller(1); assert.equal((await recap()).length,0); await db.exec('RESET ROLE');
    });
    const migration=read('20261009120000_waka_humas_pkl_read_access.sql');
    await test('migration is rollback-safe and idempotent',async()=>{
        await db.exec('BEGIN'); await db.exec(migration); await db.exec('ROLLBACK');
        assert.equal((await db.query("SELECT 1 FROM pg_policies WHERE policyname='rls_students_read_waka_humas_pkl'")).rows.length,0);
        await db.exec(migration); await db.exec(migration);
    });
    for (const n of [1,2]) await test('role/flag Waka '+n+' reads all local PKL programs and accurate recap',async()=>{
        await caller(n);
        assert.deepEqual((await db.query('SELECT student_id FROM students ORDER BY student_id')).rows.map(r=>r.student_id),[id(101),id(102)]);
        const rows=await recap();
        assert.deepEqual(rows.map(r=>r.student_id).sort(),[id(101),id(102)]);
        const row=rows.find(r=>r.student_id===id(101));
        assert.deepEqual([row.hadir,row.alpa,row.izin,row.sakit,row.total].map(Number),[4,1,1,1,7]);
        assert.equal(Number(rows.find(r=>r.student_id===id(102)).total),0);
        assert.equal((await db.query('SELECT * FROM pkl_placements')).rows.length,3);
        assert.equal((await db.query('SELECT * FROM observations')).rows.length,3);
        assert.equal((await db.query('SELECT * FROM pkl_attendance')).rows.length,0);
        assert.equal((await db.query('UPDATE students SET student_status=student_status RETURNING student_id')).rows.length,0);
        assert.equal((await db.query('DELETE FROM pkl_placements RETURNING placement_id')).rows.length,0);
    });
    for (const n of [3,4,5,6,11,12]) await test('inactive, deleted and unassigned identity '+n+' gains no Waka access',async()=>{
        await caller(n); assert.equal((await recap()).length,0);
        for (const table of ['students','pkl_placements','observations']) assert.equal((await db.query('SELECT * FROM '+table)).rows.length,0);
    });
    await test('foreign-school Waka cannot read school A',async()=>{
        await caller(7);assert.deepEqual((await recap()).map(r=>r.student_id),[id(104)]);
        assert.deepEqual((await db.query('SELECT student_id FROM students')).rows.map(r=>r.student_id),[id(104)]);
    });
    await test('existing Kaprodi, Kepsek and admin recap scopes are preserved',async()=>{
        for (const [n,expected] of [[8,[101,103]],[9,[101,102,103]],[10,[101,102,103]]]) {
            await caller(n);assert.deepEqual((await recap()).map(r=>r.student_id).sort(),expected.map(id));
        }
    });
    await test('anon and PUBLIC cannot execute either function',async()=>{
        await db.exec('RESET ROLE');
        for (const name of ['fn_is_waka_humas()','fn_pkl_attendance_recap(uuid[],date,date)']) {
            const row=(await db.query("SELECT has_function_privilege('anon',$1,'EXECUTE') AS anon,has_function_privilege('unrelated',$1,'EXECUTE') AS public,has_function_privilege('authenticated',$1,'EXECUTE') AS authenticated",[name])).rows[0];
            assert.deepEqual(row,{anon:false,public:false,authenticated:true});
        }
    });
    console.log(`WAKA_HUMAS_SQL_COMPLETE: ${passed} checks passed; in-memory PostgreSQL only.`);
} finally { await db.close(); }
