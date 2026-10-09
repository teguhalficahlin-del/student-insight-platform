// Synthetic PostgreSQL/RLS and API regressions. No remote credentials or writes.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const id = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const db = await PGlite.create();
let passed = 0;
async function test(label, run) { await run(); console.log(`PASS DUDI ${++passed}: ${label}`); }
function definition(file, name) {
    const source = read('supabase/migrations/' + file);
    const start = source.search(new RegExp(`CREATE OR REPLACE FUNCTION (?:public\\.)?${name}\\(`));
    assert(start >= 0, name);
    return source.slice(start).match(/^[\s\S]*?AS (\$\w*\$)[\s\S]*?\1;/)[0];
}
async function caller(n) {
    await db.exec('RESET ROLE');
    await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [n ? id(n) : '']);
    await db.exec('SET ROLE authenticated');
}
const rows = async sql => (await db.query(sql)).rows;
async function record(placement = 21, student = 10, date = 'CURRENT_DATE', author = 2, school = 100) {
    return db.query(`INSERT INTO pkl_attendance(placement_id,student_id,school_id,recorded_by_user_id,attendance_date,status)
        VALUES($1,$2,$3,$4,${date},'HADIR') ON CONFLICT(placement_id,attendance_date)
        DO UPDATE SET status='SAKIT',recorded_by_user_id=EXCLUDED.recorded_by_user_id`,
    [id(placement), id(student), id(school), id(author)]);
}
try {
    await db.exec(`
        SET timezone = 'Asia/Jakarta';
        CREATE ROLE authenticated; CREATE ROLE anon; CREATE ROLE service_role; CREATE ROLE unrelated;
        CREATE SCHEMA auth;
        CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
            SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid;
        $$;
        CREATE TYPE role_type AS ENUM ('DUDI','GURU','ORTU','SISWA','KAPRODI','KEPSEK','ADMINISTRATIVE','WAKA_HUMAS');
        CREATE TYPE visibility_level AS ENUM ('RESTRICTED','PRIVATE');
        CREATE TABLE users(user_id uuid PRIMARY KEY,auth_user_id uuid,school_id uuid,role_type role_type,
            teacher_code text,is_active boolean DEFAULT true,deleted_at timestamptz);
        CREATE TABLE students(student_id uuid PRIMARY KEY,school_id uuid,full_name text,nis varchar);
        CREATE TABLE pkl_placements(placement_id uuid PRIMARY KEY,student_id uuid REFERENCES students,
            school_id uuid,dudi_user_id uuid REFERENCES users,is_active boolean,start_date date,end_date date);
        CREATE TABLE pkl_attendance(placement_id uuid REFERENCES pkl_placements,student_id uuid REFERENCES students,
            school_id uuid,recorded_by_user_id uuid REFERENCES users,attendance_date date,status text,
            UNIQUE(placement_id,attendance_date));
        CREATE TABLE observations(observation_id uuid PRIMARY KEY,student_id uuid REFERENCES students,school_id uuid,
            author_user_id uuid REFERENCES users,visibility visibility_level,is_void boolean DEFAULT false,
            content text CHECK(length(content) BETWEEN 10 AND 1000));
        CREATE TABLE academic_periods(school_id uuid,start_date date,end_date date,status text);
        CREATE FUNCTION fn_current_user_id() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
            SELECT user_id FROM users WHERE auth_user_id=auth.uid();
        $$;
        CREATE FUNCTION fn_current_user_role() RETURNS role_type LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
            SELECT role_type FROM users WHERE auth_user_id=auth.uid();
        $$;
        CREATE FUNCTION fn_student_in_current_school(uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
            SELECT EXISTS(SELECT 1 FROM students WHERE student_id=$1 AND school_id=fn_current_school_id());
        $$;
    `.replace(/CREATE FUNCTION fn_student_in_current_school[\s\S]*?\$\$;/, ''));
    await db.exec(definition('20261009150000_guru_piket_hardening.sql', 'fn_current_school_id'));
    await db.exec(`CREATE FUNCTION fn_student_in_current_school(uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
        SELECT EXISTS(SELECT 1 FROM students WHERE student_id=$1 AND school_id=fn_current_school_id()); $$;`);
    await db.exec(definition('20260827510000_fix_f01_f02_tenant_guards.sql', 'fn_dudi_supervises_student'));
    await db.exec(definition('20260630130000_pkl_attendance.sql', 'trg_pkl_attendance_student_match'));
    await db.exec(definition('20260704030000_attendance_audit_fixes.sql', 'fn_is_period_closed'));
    await db.exec(definition('20260704030000_attendance_audit_fixes.sql', 'fn_pkl_attendance_period_lock'));
    await db.exec(`
        CREATE TRIGGER trg_pkl_attendance_period_lock BEFORE INSERT OR UPDATE ON pkl_attendance
            FOR EACH ROW EXECUTE FUNCTION fn_pkl_attendance_period_lock();
        CREATE TRIGGER trg_pkl_attendance_student_match_check BEFORE INSERT OR UPDATE ON pkl_attendance
            FOR EACH ROW EXECUTE FUNCTION trg_pkl_attendance_student_match();
        GRANT USAGE ON SCHEMA public,auth TO authenticated,anon,unrelated;
        GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
        ALTER TABLE pkl_attendance ENABLE ROW LEVEL SECURITY;
        ALTER TABLE pkl_placements ENABLE ROW LEVEL SECURITY;
        ALTER TABLE students ENABLE ROW LEVEL SECURITY;
        ALTER TABLE observations ENABLE ROW LEVEL SECURITY;
        CREATE POLICY dudi_students ON students FOR SELECT USING(school_id=fn_current_school_id() AND fn_current_user_role()='DUDI' AND fn_dudi_supervises_student(student_id));
        CREATE POLICY dudi_placements ON pkl_placements FOR SELECT USING(school_id=fn_current_school_id() AND fn_current_user_role()='DUDI' AND dudi_user_id=fn_current_user_id());
        CREATE POLICY staff_attendance ON pkl_attendance FOR SELECT USING(school_id=fn_current_school_id() AND fn_current_user_role()='WAKA_HUMAS');
    `);
    await db.exec(read('supabase/migrations/20260704130000_fix_pkl_attendance_recorded_by_check.sql'));
    for (const [n, school, role, active, deleted] of [[1,100,'DUDI',true,false],[2,100,'DUDI',true,false],
        [3,101,'DUDI',true,false],[4,100,'DUDI',false,false],[5,100,'DUDI',true,true],
        [6,100,'GURU',true,false],[7,100,'WAKA_HUMAS',true,false]]) {
        await db.query('INSERT INTO users(user_id,auth_user_id,school_id,role_type,is_active,deleted_at) VALUES($1,$1,$2,$3,$4,$5)',
            [id(n),id(school),role,active,deleted?'2026-01-01':null]);
    }
    await db.query("INSERT INTO students VALUES($1,$2,'SYNTHETIC A','001'),($3,$2,'SYNTHETIC B','002'),($4,$5,'SYNTHETIC C','003')",
        [id(10),id(100),id(11),id(12),id(101)]);
    for (const [n, student, school, owner, active, start, end] of [
        [20,10,100,1,false,-80,-31],[21,10,100,2,true,-30,30],[22,11,100,2,true,-80,-31],
        [23,12,101,3,true,-30,30],[24,12,100,2,true,-30,30],
        [25,11,100,4,true,-30,30],[26,11,100,5,true,-30,30],
    ]) await db.query(`INSERT INTO pkl_placements VALUES($1,$2,$3,$4,$5,CURRENT_DATE+$6::int,CURRENT_DATE+$7::int)`,
        [id(n),id(student),id(school),id(owner),active,start,end]);
    await record(20,10,'CURRENT_DATE-40',1);
    await db.query("INSERT INTO observations VALUES($1,$2,$3,$4,'RESTRICTED',false,'Own historical observation')",[id(30),id(10),id(100),id(1)]);
    await test('baseline exposes foreign historical attendance',async()=>{
        await caller(2); assert.equal((await rows(`SELECT * FROM pkl_attendance WHERE placement_id='${id(20)}'`)).length,1);
    });
    await db.exec('RESET ROLE');
    const migration = read('supabase/migrations/20261009171045_dudi_portal_hardening.sql');
    await test('migration is rollback-safe and idempotent without changing existing data',async()=>{
        await db.exec('BEGIN'); await db.exec(migration.replace(/^\s*(BEGIN|COMMIT);/gm,'')); await db.exec('ROLLBACK');
        assert.equal((await rows("SELECT 1 FROM pg_proc WHERE proname='fn_dudi_placements'")).length,0);
        await db.exec(migration); await db.exec(migration);
        assert.equal((await rows('SELECT * FROM pkl_attendance')).length,1);
        assert.equal((await rows('SELECT * FROM observations')).length,1);
    });
    await caller(2);
    await test('placements RPC returns only owned, tenant-consistent identities including history',async()=>{
        assert.deepEqual((await rows('SELECT * FROM fn_dudi_placements()')).map(r=>r.placement_id),[id(22),id(21)]);
    });
    await test('new DUDI cannot read previous DUDI attendance for the same student',async()=>{
        assert.equal((await rows(`SELECT * FROM pkl_attendance WHERE placement_id='${id(20)}'`)).length,0);
    });
    await test('foreign attendance update affects zero rows',async()=>{
        assert.equal((await db.query("UPDATE pkl_attendance SET status='ALPA',recorded_by_user_id=$1 WHERE placement_id=$2",[id(2),id(20)])).affectedRows,0);
    });
    await test('foreign attendance insert rejected even though student is currently supervised',async()=>{
        await assert.rejects(record(20,10,'CURRENT_DATE-40',2),e=>e.code==='42501');
    });
    await test('own daily insert and upsert succeed',async()=>{
        await record(); await record();
        assert.equal((await rows(`SELECT status FROM pkl_attendance WHERE placement_id='${id(21)}'`))[0].status,'SAKIT');
    });
    for (const [name, placement, student, date, author, school, code] of [
        ['before start',21,10,'CURRENT_DATE-31',2,100,'42501'],
        ['future within period',21,10,'CURRENT_DATE+1',2,100,'42501'],
        ['after end',22,11,'CURRENT_DATE-30',2,100,'42501'],
        ['wrong student',21,11,'CURRENT_DATE',2,100,'23514'],
        ['wrong school',21,10,'CURRENT_DATE',2,101,'23514'],
        ['spoofed author',21,10,'CURRENT_DATE-1',1,100,'42501'],
        ['foreign tenant',23,12,'CURRENT_DATE',2,101,'42501'],
        ['inconsistent placement tenant',24,12,'CURRENT_DATE',2,100,'23503'],
        ['missing placement',999,10,'CURRENT_DATE',2,100,'23503'],
    ]) await test(name+' is rejected',async()=>{await assert.rejects(record(placement,student,date,author,school),e=>e.code===code);});
    await test('placement start and past end dates are inclusive',async()=>{await record(21,10,'CURRENT_DATE-30');await record(22,11,'CURRENT_DATE-31');});
    await test('cannot move attendance identity to another date',async()=>{
        await assert.rejects(db.query("UPDATE pkl_attendance SET attendance_date=CURRENT_DATE-2 WHERE placement_id=$1 AND attendance_date=CURRENT_DATE",[id(21)]),e=>e.code==='42501');
    });
    await test('DUDI cannot delete attendance',async()=>{assert.equal((await db.query('DELETE FROM pkl_attendance')).affectedRows,0);});
    await test('active DUDI saves and reads its own restricted observation',async()=>{
        await db.query("INSERT INTO observations VALUES($1,$2,$3,$4,'RESTRICTED',false,'Valid synthetic observation')",[id(31),id(10),id(100),id(2)]);
        assert.deepEqual((await rows('SELECT observation_id FROM observations')).map(r=>r.observation_id),[id(31)]);
    });
    await test('expired placement cannot receive a new observation',async()=>{
        await assert.rejects(db.query("INSERT INTO observations VALUES($1,$2,$3,$4,'RESTRICTED',false,'Valid synthetic observation')",[id(32),id(11),id(100),id(2)]),e=>e.code==='42501');
    });
    await test('database rejects too-short observation content',async()=>{
        await assert.rejects(db.query("INSERT INTO observations VALUES($1,$2,$3,$4,'RESTRICTED',false,'abc')",[id(33),id(10),id(100),id(2)]),e=>e.code==='23514');
    });
    await caller(1);
    await test('former DUDI reads own placement, attendance and observation history',async()=>{
        assert.equal((await rows('SELECT * FROM fn_dudi_placements()')).length,1);
        assert.equal((await rows('SELECT * FROM pkl_attendance')).length,1);
        assert.deepEqual((await rows('SELECT observation_id FROM observations')).map(r=>r.observation_id),[id(30)]);
        assert.equal((await rows('SELECT * FROM students')).length,0);
    });
    await test('completed placement history is read-only',async()=>{
        await assert.rejects(record(20,10,'CURRENT_DATE-40',1),e=>e.code==='42501');
    });
    for (const n of [3,4,5,6]) await test('tenant, inactive, deleted and non-DUDI boundaries: '+n,async()=>{
        await caller(n);
        const pp=await rows('SELECT * FROM fn_dudi_placements()');
        assert.equal(pp.length,n===3?1:0);
        assert.equal((await rows('SELECT * FROM pkl_attendance')).length,0);
        assert.equal((await rows('SELECT * FROM observations')).length,0);
        await assert.rejects(record(21,10,'CURRENT_DATE',n),e=>e.code==='42501');
    });
    await caller(7);
    await test('existing Waka Humas read access remains intact',async()=>{assert.equal((await rows('SELECT * FROM pkl_attendance')).length,4);});
    await db.exec('RESET ROLE');
    await db.query("INSERT INTO academic_periods VALUES($1,CURRENT_DATE-1,CURRENT_DATE,'CLOSED')",[id(100)]);
    await caller(2);
    await test('closed period remains locked',async()=>{await assert.rejects(record(21,10,'CURRENT_DATE-1'),e=>e.code==='P0001');});
    await db.exec('RESET ROLE');
    await test('helpers and history RPC deny anon and PUBLIC execution',async()=>{
        for (const role of ['anon','unrelated']) {
            await db.exec('SET ROLE '+role);
            await assert.rejects(db.query('SELECT * FROM fn_dudi_placements()'),e=>e.code==='42501');
            await assert.rejects(db.query('SELECT fn_dudi_owns_placement($1,$2)',[id(21),id(10)]),e=>e.code==='42501');
            await assert.rejects(db.query('SELECT fn_dudi_can_record_attendance($1,$2,CURRENT_DATE)',[id(21),id(10)]),e=>e.code==='42501');
            await db.exec('RESET ROLE');
        }
    });
    const source=read('dudi/js/api.js');
    const names=['fetchMyPlacements','fetchAttendanceForDate','fetchRecentAttendance','saveObservation'];
    const functions=names.map(name=>source.match(new RegExp(`export async function ${name}\\([\\s\\S]*?\\n}`))[0].replace(/^export /,'')).join('\n');
    let queries=[], inserts=[];
    const client={rpc:async name=>({data:[{placement_id:'past',is_active:false}],error:null}),from(table){
        const q={select(){return q;},in(k,v){queries.push(['in',k,v]);return q;},eq(){return q;},gte(k,v){queries.push(['gte',k,v]);return q;},lte(k,v){queries.push(['lte',k,v]);return q;},
            order(){return q;},insert(v){inserts.push(v);return q;},then(resolve,reject){return Promise.resolve({data:[{placement_id:'past',student_id:'s',status:'HADIR'}],error:null}).then(resolve,reject);}};return q;
    }};
    const api=new Function('supabase','localDateStr',functions+`;return {${names.join(',')}};`)(client,()=> '2026-10-10');
    await test('API includes inactive placements and keys daily records by placement',async()=>{
        assert.equal((await api.fetchMyPlacements())[0].is_active,false);
        const data=await api.fetchAttendanceForDate(['past'],'2026-10-10');assert.equal(data.get('past').status,'HADIR');
        assert.deepEqual(queries[0],['in','placement_id',['past']]);
    });
    await test('API bounds history by placement and today',async()=>{
        queries=[];await api.fetchRecentAttendance(['past'],90);
        assert.deepEqual(queries.find(q=>q[0]==='in'),['in','placement_id',['past']]);
        assert.deepEqual(queries.find(q=>q[0]==='lte'),['lte','attendance_date','2026-10-10']);
    });
    await test('API validates trimmed observation length before writing',async()=>{
        for(const content of ['abc',' '.repeat(20),'a'.repeat(1001)]) await assert.rejects(api.saveObservation({content}),/10 sampai 1000/);
        assert.equal(inserts.length,0);await api.saveObservation({content:'  Valid observation  '});assert.equal(inserts[0].content,'Valid observation');
    });
    console.log(`DUDI PostgreSQL/API: ${passed} passed`);
} finally { await db.close(); }
