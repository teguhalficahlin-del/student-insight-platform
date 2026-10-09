// Real PostgreSQL policies and RPCs, synthetic data, no remote connections.
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
    const found = source.slice(start).match(/^[\s\S]*?AS (\$\w*\$)[\s\S]*?\1\s*;/);
    assert(found, name + ' dollar-quoted body'); return found[0];
}
function policy(file, name) {
    const found = read(file).match(new RegExp(`CREATE POLICY ${name}\\s[\\s\\S]*?;`));
    assert(found, name); return found[0];
}
async function caller(n) {
    await db.exec('RESET ROLE');
    await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [n ? id(n) : '']);
    await db.exec('SET ROLE authenticated');
}
const candidates = async (group = 'SEMUA_GURU', program = null, cls = null) =>
    (await db.query('SELECT * FROM fn_get_forum_recipient_candidates($1,$2,$3,NULL::smallint,$4)',
        [group, program, cls, '2026/2027'])).rows;
const comment = async (post = 501, school = 901, author = 1) => db.query(
    'INSERT INTO forum_post_comments(post_id,school_id,author_user_id,body) VALUES($1,$2,$3,$4)',
    [id(post), id(school), id(author), 'Synthetic comment']);
const rejectRls = fn => assert.rejects(fn, error => error.code === '42501');
const tuMigration = '20260722050000_role_tu_rls.sql';
const forumInitial = '20260710020000_forum_kelas_initial.sql';
const migration = read('20261009140000_tu_portal_access_and_forum.sql');
try {
    await db.exec(`
        CREATE ROLE authenticated; CREATE ROLE anon; CREATE ROLE service_role; CREATE ROLE unrelated;
        CREATE SCHEMA auth;
        CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
            SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid;
        $$;
        GRANT USAGE ON SCHEMA auth TO authenticated,anon,service_role;
        CREATE TYPE role_type AS ENUM ('TU','GURU','BK','WALI_KELAS','KAPRODI','KEPSEK',
            'WAKA_KESISWAAN','WAKA_KURIKULUM','WAKA_HUMAS','ADMINISTRATIVE','ORTU','SISWA','DUDI','STAKEHOLDER');
        CREATE TYPE day_of_week AS ENUM ('SENIN','SELASA','RABU','KAMIS','JUMAT','SABTU');
        CREATE TABLE users(user_id uuid PRIMARY KEY,auth_user_id uuid,school_id uuid,role_type role_type,
            full_name text,is_active boolean,deleted_at timestamptz,wali_kelas_class_id uuid,
            kaprodi_program_id uuid,program_id uuid,is_bk boolean DEFAULT false,is_kepsek boolean DEFAULT false,
            is_waka_kurikulum boolean DEFAULT false,is_waka_kesiswaan boolean DEFAULT false,is_waka_humas boolean DEFAULT false);
        CREATE TABLE programs(program_id uuid PRIMARY KEY,school_id uuid,name text,is_active boolean);
        CREATE TABLE classes(class_id uuid PRIMARY KEY,school_id uuid,program_id uuid,name text,is_active boolean);
        CREATE TABLE students(student_id uuid PRIMARY KEY,user_id uuid,school_id uuid,program_id uuid,student_status text);
        CREATE TABLE class_enrollments(student_id uuid,class_id uuid,academic_year text,withdrawn_at timestamptz);
        CREATE TABLE student_parents(student_id uuid,parent_user_id uuid,school_id uuid);
        CREATE TABLE guru_wali_assignments(guru_user_id uuid,school_id uuid,academic_year text,is_active boolean);
        CREATE TABLE duty_schedules(school_id uuid,user_id uuid,day_of_week day_of_week,academic_year text,is_active boolean);
        CREATE TABLE late_arrivals(school_id uuid);
        CREATE TABLE teaching_schedules(schedule_id uuid PRIMARY KEY,school_id uuid);
        CREATE TABLE attendance(schedule_id uuid,is_void boolean);
        CREATE TABLE student_exits(school_id uuid);
        CREATE TABLE forum_posts(post_id uuid PRIMARY KEY,school_id uuid,author_user_id uuid,class_id uuid,
            academic_year text,visibility text,is_withdrawn boolean,scope_type text,attachment_path text);
        CREATE TABLE forum_post_audience(post_id uuid,user_id uuid,school_id uuid);
        CREATE TABLE forum_post_comments(comment_id uuid DEFAULT gen_random_uuid(),post_id uuid NOT NULL,
            school_id uuid NOT NULL,author_user_id uuid NOT NULL,body text NOT NULL);
        CREATE TABLE forum_post_acknowledgements(post_id uuid,user_id uuid,school_id uuid);
        CREATE SCHEMA storage;
        CREATE TABLE storage.objects(bucket_id text,name text);
        CREATE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
            SELECT (string_to_array(name,'/'))[1:array_length(string_to_array(name,'/'),1)-1];
        $$;
        ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
        GRANT USAGE ON SCHEMA storage TO authenticated;
        GRANT SELECT,INSERT,DELETE ON storage.objects TO authenticated;
    `);
    const roles = ['TU','TU','TU','TU','GURU','ORTU','SISWA','DUDI','STAKEHOLDER','ADMINISTRATIVE',
        'GURU','BK','WALI_KELAS','KAPRODI','KEPSEK','WAKA_KESISWAAN','WAKA_KURIKULUM','WAKA_HUMAS'];
    for (let n = 1; n <= roles.length; n++) await db.query(
        'INSERT INTO users(user_id,auth_user_id,school_id,role_type,full_name,is_active,deleted_at) VALUES($1,$1,$2,$3,$4,$5,$6)',
        [id(n), id(n === 4 ? 902 : 901), roles[n-1], 'Synthetic User ' + n, ![2,11].includes(n), n === 3 ? '2026-10-01' : null]);
    for (const school of [901,902]) {
        const user = school === 901 ? 1 : 4;
        await db.query('INSERT INTO programs VALUES($1,$2,$3,true)',[id(school+100),id(school),'Program '+school]);
        await db.query('INSERT INTO classes VALUES($1,$2,$3,$4,true)',[id(school+200),id(school),id(school+100),'Class '+school]);
        await db.query('INSERT INTO students VALUES($1,$2,$3,$4,$5)',[id(school+300),id(user),id(school),id(school+100),'AKTIF']);
        await db.query('INSERT INTO class_enrollments VALUES($1,$2,$3,NULL)',[id(school+300),id(school+200),'2026/2027']);
        await db.query('INSERT INTO student_parents VALUES($1,$2,$3)',[id(school+300),id(school === 901 ? 6 : 4),id(school)]);
        await db.query("INSERT INTO duty_schedules VALUES($1,$2,'SENIN','2026/2027',true)",[id(school),id(user)]);
        await db.query('INSERT INTO late_arrivals VALUES($1)',[id(school)]);
        await db.query('INSERT INTO teaching_schedules VALUES($1,$2)',[id(school),id(school)]);
        await db.query('INSERT INTO attendance VALUES($1,false)',[id(school)]);
        await db.query('INSERT INTO student_exits VALUES($1)',[id(school)]);
    }
    for (const [post,school,author] of [[500,901,1],[501,901,5],[502,902,4],[503,901,5],[504,901,6]]) {
        await db.query("INSERT INTO forum_posts VALUES($1,$2,$3,NULL,'2026/2027','INTERNAL',false,'SEKOLAH',NULL)",
            [id(post),id(school),id(author)]);
        if (post !== 503) await db.query('INSERT INTO forum_post_audience VALUES($1,$2,$3)',[id(post),id(school === 901 ? 1 : 4),id(school)]);
        await db.query('INSERT INTO forum_post_comments(post_id,school_id,author_user_id,body) VALUES($1,$2,$3,$4)',
            [id(post),id(school),id(author),'Original comment']);
    }
    await db.exec(definition('20250624000002_security_definer_search_path.sql','fn_current_user_role'));
    await db.exec(definition('20250624000002_security_definer_search_path.sql','fn_current_user_id'));
    await db.exec(definition('20260701120000_school_id_functions_triggers.sql','fn_current_school_id'));
    await db.exec(definition(tuMigration,'fn_is_tu'));
    await db.exec(definition('20260828010000_forum-tarik-posting-seragam-scope.sql','fn_can_read_forum_post'));
    const tables = ['users','students','duty_schedules','late_arrivals','teaching_schedules','attendance',
        'student_exits','forum_posts','forum_post_audience','forum_post_comments','forum_post_acknowledgements'];
    for (const table of tables) await db.exec(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY; GRANT ALL ON ${table} TO authenticated;`);
    for (const name of ['rls_duty_schedules_read_tu','rls_late_arrivals_read_tu','rls_attendance_read_tu',
        'rls_schedules_read_tu','rls_users_read_tu','rls_students_read_tu']) await db.exec(policy(tuMigration,name));
    await db.exec(policy('20260723020000_student_exits.sql','rls_exits_read_tu'));
    for (const name of ['rls_forum_posts_read_tu','rls_forum_post_audience_read_tu','rls_forum_post_comments_read_tu'])
        await db.exec(policy('20260723010000_forum_rls_tu.sql',name));
    for (const name of ['rls_forum_aud_read','rls_forum_ack_read','rls_forum_ack_insert','rls_forum_comments_read','rls_forum_posts_read'])
        await db.exec(policy(forumInitial,name));
    await db.exec(read('20260717090054_fix_forum_comments_insert_allowlist.sql'));
    await db.exec(read('20260729191250_fn-forum-recipient-add-per-kelas-jurusan.sql'));
    await db.exec(read('20260827010000_forum-storage-isolasi-tenant.sql'));
    await db.exec(policy('20260824120000_tu04-forum-attachments-delete-policy.sql','"forum_attachments_delete"'));
    for (const school of [901,902]) await db.query('INSERT INTO storage.objects VALUES($1,$2)',
        ['forum-attachments',id(school)+'/existing.pdf']);
    await test('baseline reproduces inactive TU access, denied comment and student directory access',async()=>{
        await caller(2); assert.equal((await db.query('SELECT * FROM late_arrivals')).rows.length,1);
        await caller(1); await rejectRls(()=>comment());
        await caller(7); assert.equal((await candidates()).length,1);
    });
    await db.exec('RESET ROLE'); await db.exec(migration); await db.exec(migration);
    await test('migration is repeatable and PostgreSQL definitions contain the active TU guard',async()=>{
        const row = (await db.query("SELECT pg_get_functiondef('fn_current_school_id()'::regprocedure) AS definition")).rows[0];
        assert(row.definition.includes('is_active IS TRUE')); assert(row.definition.includes('deleted_at IS NULL'));
    });
    await test('active TU reads its own school across every portal section and forum',async()=>{
        await caller(1);
        for (const table of tables.filter(t=>!['users','forum_post_acknowledgements'].includes(t))) {
            const rows = (await db.query(`SELECT * FROM ${table}`)).rows;
            assert(rows.length > 0,table);
            assert(rows.every(row=>!row.school_id || row.school_id === id(901)),table);
        }
        assert.equal((await db.query('SELECT fn_is_tu() AS allowed')).rows[0].allowed,true);
    });
    for (const n of [2,3]) await test(`inactive/deleted TU ${n} cannot read portal data or comment`,async()=>{
        await caller(n);
        for (const table of tables) assert.equal((await db.query(`SELECT * FROM ${table}`)).rows.length,0,table);
        assert.deepEqual((await db.query('SELECT fn_current_school_id() AS school,fn_is_tu() AS allowed')).rows[0],{school:null,allowed:false});
        await rejectRls(()=>comment(501,901,n)); await rejectRls(()=>candidates());
    });
    await test('same JWT loses access immediately after admin disables the TU account',async()=>{
        await caller(1); assert.equal((await db.query('SELECT * FROM late_arrivals')).rows.length,1);
        await db.exec('RESET ROLE'); await db.query('UPDATE users SET is_active=false WHERE user_id=$1',[id(1)]);
        await db.exec('SET ROLE authenticated'); assert.equal((await db.query('SELECT * FROM late_arrivals')).rows.length,0);
        await rejectRls(()=>comment());
        await db.exec('RESET ROLE'); await db.query('UPDATE users SET is_active=true WHERE user_id=$1',[id(1)]);
    });
    await test('TU comments succeed for received and own posts with explicit author identity',async()=>{
        await caller(1); await comment(); await comment(500);
        const rows = (await db.query("SELECT * FROM forum_post_comments WHERE body='Synthetic comment'")).rows;
        assert.equal(rows.length,2); assert(rows.every(row=>row.author_user_id === id(1)));
    });
    await test('cross-school posts, forged author and non-recipient posts reject comments',async()=>{
        await caller(1); await rejectRls(()=>comment(502)); await rejectRls(()=>comment(501,902));
        await rejectRls(()=>comment(501,901,5)); await rejectRls(()=>comment(503));
    });
    await test('parent comment behavior and non-TU tenant scope are preserved',async()=>{
        await caller(6); await comment(504,901,6);
        for (const n of [5,6,7,8,9,10,11]) {
            await caller(n); assert.equal((await db.query('SELECT fn_current_school_id() AS school')).rows[0].school,id(901));
        }
    });
    await test('all ten authorized staff roles retain recipient access',async()=>{
        for (const n of [1,5,10,12,13,14,15,16,17,18]) { await caller(n); assert.deepEqual((await candidates()).map(r=>r.user_id),[id(5)]); }
    });
    await test('student/parent/DUDI/stakeholder/inactive staff and unidentified caller cannot enumerate recipients',async()=>{
        for (const n of [6,7,8,9,11,null]) { await caller(n); await rejectRls(()=>candidates()); }
    });
    await test('recipient class/program groups preserve tenant filtering',async()=>{
        await caller(1);
        assert.equal((await candidates('SISWA_PER_KELAS',null,id(1101))).length,1);
        assert.equal((await candidates('SISWA_PER_KELAS',null,id(1102))).length,0);
        assert.equal((await candidates('ORTU_PER_JURUSAN',id(1001))).length,1);
        assert.equal((await candidates('ORTU_PER_JURUSAN',id(1002))).length,0);
        await caller(4); assert.equal((await db.query('SELECT * FROM late_arrivals')).rows[0].school_id,id(902));
        assert.equal((await candidates('SISWA_PER_KELAS',null,id(1101))).length,0);
    });
    await test('active TU storage access stays in its tenant',async()=>{
        await caller(1);
        assert.deepEqual((await db.query('SELECT name FROM storage.objects')).rows.map(r=>r.name),[id(901)+'/existing.pdf']);
        await rejectRls(()=>db.query('INSERT INTO storage.objects VALUES($1,$2)',['forum-attachments',id(902)+'/forged.pdf']));
        await db.query('INSERT INTO storage.objects VALUES($1,$2)',['forum-attachments',id(901)+'/own.pdf']);
        assert.equal((await db.query('DELETE FROM storage.objects WHERE name=$1 RETURNING name',[id(901)+'/own.pdf'])).rows.length,1);
    });
    await test('inactive/deleted TU cannot read, upload or delete forum attachments',async()=>{
        for (const n of [2,3]) {
            await caller(n);assert.equal((await db.query('SELECT * FROM storage.objects')).rows.length,0);
            await rejectRls(()=>db.query('INSERT INTO storage.objects VALUES($1,$2)',['forum-attachments',id(901)+'/forged.pdf']));
            assert.equal((await db.query('DELETE FROM storage.objects RETURNING name')).rows.length,0);
        }
    });
    await test('anonymous and PUBLIC execution is revoked; staff and service grants remain',async()=>{
        await db.exec('RESET ROLE');
        for (const signature of ['fn_current_school_id()','fn_is_tu()',
            'fn_get_forum_recipient_candidates(text,uuid,uuid,smallint,text)']) {
            const row = (await db.query("SELECT has_function_privilege('anon',$1,'EXECUTE') AS anon,has_function_privilege('unrelated',$1,'EXECUTE') AS public,has_function_privilege('authenticated',$1,'EXECUTE') AS authenticated,has_function_privilege('service_role',$1,'EXECUTE') AS service",[signature])).rows[0];
            assert.deepEqual(row,{anon:false,public:false,authenticated:true,service:true});
        }
    });
    console.log(`TU_PORTAL_SQL_COMPLETE: ${passed} checks passed; in-memory PostgreSQL only.`);
} finally { await db.close(); }
