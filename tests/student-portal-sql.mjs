// Synthetic PostgreSQL only. Never connects to Supabase or reads real user data.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
const root = new URL('../supabase/migrations/', import.meta.url);
const migration = readFileSync(new URL('20261010003737_student_portal_hardening.sql', root), 'utf8');
const id = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
function definition(name) {
    for (const file of readdirSync(root).filter(f => f.endsWith('.sql')).sort().reverse()) {
        const source = readFileSync(new URL(file, root), 'utf8');
        const start = source.search(new RegExp(`CREATE OR REPLACE FUNCTION (?:public\\.)?${name}\\s*\\(`, 'i'));
        if (start >= 0) {
            const match = source.slice(start).match(/^[\s\S]*?AS\s+(\$\w*\$)[\s\S]*?\1\s*;/i);
            assert(match, name+' in '+file);
            return match[0];
        }
    }
    throw new Error('Missing function ' + name);
}
const db = await PGlite.create();
let passed = 0;
const test = async (name, run) => { await run(); console.log(`PASS STUDENT SQL ${++passed}: ${name}`); };
const query = async (sql, args = []) => (await db.query(sql, args)).rows;
const caller = async n => {
    await db.exec('RESET ROLE');
    await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [n ? id(n) : '']);
    await db.exec('SET ROLE authenticated');
};
const grades = async (student = null, year = null, semester = null) =>
    (await query('SELECT fn_get_all_grades_summary($1,$2,$3) AS data', [student, year, semester]))[0].data;
const labels = async ids => query('SELECT * FROM fn_portal_user_labels($1)', [ids.map(id)]);
const history = async (student = 10, start = null, end = null) =>
    (await query('SELECT fn_portal_attendance($1,$2,$3) AS data', [id(student), start, end]))[0].data;
try {
    await db.exec(`
        CREATE ROLE authenticated; CREATE ROLE anon; CREATE ROLE unrelated;
        CREATE SCHEMA auth; CREATE SCHEMA storage;
        CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
            SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid; $$;
        CREATE TYPE role_type AS ENUM ('SISWA','ORTU','GURU','BK','WALI_KELAS','KAPRODI','KEPSEK',
            'WAKA_KURIKULUM','WAKA_KESISWAAN','WAKA_HUMAS','ADMINISTRATIVE','TU','DUDI','STAKEHOLDER');
        CREATE TABLE users(user_id uuid PRIMARY KEY,auth_user_id uuid,school_id uuid,role_type role_type,
            full_name text,email text,login_identifier text,dudi_org_name text,is_active boolean DEFAULT true,
            deleted_at timestamptz,is_kepsek boolean DEFAULT false,is_waka_kesiswaan boolean DEFAULT false,
            program_id uuid,kaprodi_program_id uuid,wali_kelas_class_id uuid);
        CREATE TABLE students(student_id uuid PRIMARY KEY,user_id uuid,school_id uuid,student_status text);
        CREATE TABLE classes(class_id uuid PRIMARY KEY,school_id uuid,program_id uuid);
        CREATE TABLE class_enrollments(student_id uuid,class_id uuid,school_id uuid,academic_year text,withdrawn_at timestamptz);
        CREATE TABLE teaching_schedules(schedule_id uuid PRIMARY KEY,class_id uuid,school_id uuid,
            scheduled_teacher_id uuid,session_date date,session_start time,session_end time,block_group_id uuid,subject_id uuid);
        CREATE TABLE attendance(attendance_id uuid PRIMARY KEY,schedule_id uuid,student_id uuid,school_id uuid,
            status text,is_void boolean DEFAULT false,notes text);
        CREATE TABLE teaching_assignments(user_id uuid,class_id uuid,academic_year text,is_active boolean,school_id uuid);
        CREATE TABLE guru_wali_assignments(student_id uuid,guru_user_id uuid,academic_year text,is_active boolean,school_id uuid);
        CREATE TABLE bk_class_assignments(bk_user_id uuid,class_id uuid,academic_year text,is_active boolean,school_id uuid);
        CREATE TABLE student_parents(student_id uuid,parent_user_id uuid,school_id uuid);
        CREATE TABLE pkl_placements(placement_id uuid,student_id uuid,school_id uuid,dudi_user_id uuid);
        CREATE TABLE forum_posts(post_id uuid PRIMARY KEY,class_id uuid,academic_year text,visibility text,
            author_user_id uuid,school_id uuid,is_withdrawn boolean DEFAULT false,scope_type text,deleted_at timestamptz,attachment_path text);
        CREATE TABLE forum_post_audience(post_id uuid,user_id uuid);
        CREATE TABLE forum_post_subjects(post_id uuid,student_id uuid,school_id uuid);
        CREATE TABLE storage.objects(id uuid PRIMARY KEY,bucket_id text,name text,owner_id text);
        CREATE FUNCTION storage.foldername(text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
            SELECT (string_to_array($1,'/'))[1:array_length(string_to_array($1,'/'),1)-1]; $$;
        CREATE TABLE subjects(subject_id uuid PRIMARY KEY,name text,school_id uuid);
        CREATE TABLE assessments(id uuid PRIMARY KEY,subject_id uuid,school_id uuid,class_id uuid,
            academic_year varchar,semester integer,is_visible_siswa boolean DEFAULT false,is_visible_ortu boolean DEFAULT false,
            jenis text,instrumen text,tanggal date);
        CREATE TABLE assessment_results(id uuid PRIMARY KEY,school_id uuid,class_id uuid,student_id uuid,assessment_id uuid,
            nilai numeric,status text,umpan_balik text,catatan text,updated_at timestamptz DEFAULT now());
        CREATE TABLE learning_objectives(id uuid PRIMARY KEY,school_id uuid,class_id uuid,subject_id uuid,academic_year varchar,semester integer);
        CREATE TABLE grade_recap(id uuid PRIMARY KEY,school_id uuid,class_id uuid,student_id uuid,learning_objective_id uuid,
            academic_year text,semester integer,nilai_akhir numeric,deskripsi_capaian text,updated_at timestamptz DEFAULT now());
        GRANT USAGE ON SCHEMA public,auth,storage TO authenticated,anon,unrelated;
        GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;
        GRANT SELECT,INSERT,DELETE ON storage.objects TO authenticated;
    `);
    for (const name of ['fn_current_user_id','fn_current_user_role','fn_current_school_id','fn_current_student_id',
        'fn_has_teaching_schedule','fn_can_read_forum_post']) await db.exec(definition(name));
    await db.exec(`
        ALTER TABLE users ENABLE ROW LEVEL SECURITY;
        CREATE POLICY own_account ON users FOR SELECT TO authenticated USING
            (auth_user_id=auth.uid() AND school_id=fn_current_school_id());
        CREATE POLICY staff_accounts ON users FOR SELECT TO authenticated USING
            (school_id=fn_current_school_id() AND fn_current_user_role()='GURU');
        CREATE POLICY rls_users_read_staff_names ON users FOR SELECT TO authenticated USING
            (school_id=fn_current_school_id() AND fn_current_user_role() IN ('SISWA','ORTU') AND fn_has_teaching_schedule(user_id));
        ALTER TABLE assessment_results ENABLE ROW LEVEL SECURITY;
        ALTER TABLE grade_recap ENABLE ROW LEVEL SECURITY;
        CREATE POLICY teacher_results ON assessment_results FOR SELECT TO authenticated USING
            (school_id=fn_current_school_id() AND fn_current_user_role()='GURU');
        CREATE POLICY teacher_recaps ON grade_recap FOR SELECT TO authenticated USING
            (school_id=fn_current_school_id() AND fn_current_user_role()='GURU');
        ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
        CREATE POLICY forum_attachments_upload ON storage.objects FOR INSERT TO authenticated WITH CHECK
            (bucket_id='forum-attachments' AND (storage.foldername(name))[1]=fn_current_school_id()::text);
    `);
    for (const [n, school, role] of [[1,100,'SISWA'],[2,100,'GURU'],[3,100,'DUDI'],[4,200,'GURU'],
        [5,100,'ORTU'],[6,100,'SISWA'],[7,100,'TU'],[8,100,'KEPSEK'],[9,100,'SISWA'],
        [12,200,'SISWA'],[13,200,'ORTU'],[14,100,'SISWA'],[15,100,'DUDI'],[16,100,'GURU']]) {
        await db.query(`INSERT INTO users(user_id,auth_user_id,school_id,role_type,full_name,email,login_identifier,dudi_org_name)
            VALUES($1,$1,$2,$3,$4,'private@example.invalid','PRIVATE-NIP','Mitra Sintetis')`, [id(n),id(school),role,'Nama '+n]);
    }
    await db.query('UPDATE users SET is_active=false WHERE user_id=$1', [id(9)]);
    await db.query('UPDATE users SET deleted_at=now() WHERE user_id=$1', [id(14)]);
    await db.query('UPDATE users SET is_kepsek=true WHERE user_id=$1', [id(16)]);
    for (const [n, user, school] of [[10,1,100],[11,6,100],[110,12,200]])
        await db.query("INSERT INTO students VALUES($1,$2,$3,'AKTIF')", [id(n),id(user),id(school)]);
    await db.query('INSERT INTO student_parents VALUES($1,$2,$3),($4,$5,$6)', [id(10),id(5),id(100),id(110),id(13),id(200)]);
    await db.query('INSERT INTO pkl_placements VALUES($1,$2,$3,$4)', [id(201),id(10),id(100),id(3)]);
    await db.query('INSERT INTO subjects VALUES($1,$2,$3)', [id(60),'Mapel Sintetis',id(100)]);
    for (const [n, cl, school, date] of [[30,20,100,'2026-06-01'],[31,21,100,'2026-10-10'],[32,22,100,'2026-10-10'],[33,120,200,'2026-10-10']])
        await db.query("INSERT INTO teaching_schedules VALUES($1,$2,$3,$4,$5,'07:00','08:00',$1,$6)", [id(n),id(cl),id(school),id(2),date,id(60)]);
    for (const [n,sched,student,school,voided] of [[40,30,10,100,false],[41,31,10,100,false],[42,32,11,100,false],[43,33,110,200,false],[44,31,10,100,true]])
        await db.query("INSERT INTO attendance VALUES($1,$2,$3,$4,'HADIR',$5,'Sintetis')", [id(n),id(sched),id(student),id(school),voided]);
    await db.query("INSERT INTO class_enrollments VALUES($1,$2,$3,'2025/2026','2026-07-01')", [id(10),id(20),id(100)]);
    for (const [n, school, suffix, withdrawn, deleted, author] of [[80,100,'allowed',false,false,7],[81,100,'private',false,false,7],
        [82,100,'withdrawn',true,false,7],[83,100,'deleted',false,true,7],[84,200,'foreign',false,false,4],[85,100,'parent',false,false,5]]) {
        await db.query(`INSERT INTO forum_posts(post_id,school_id,scope_type,author_user_id,is_withdrawn,deleted_at,attachment_path)
            VALUES($1,$2,'SEKOLAH',$3,$4,CASE WHEN $5 THEN now() END,$6)`, [id(n),id(school),id(author),withdrawn,deleted,id(school)+'/'+suffix+'.pdf']);
        if (n !== 81) await db.query('INSERT INTO forum_post_audience VALUES($1,$2)', [id(n),id(1)]);
        await db.query("INSERT INTO storage.objects VALUES($1,'forum-attachments',$2,$3)", [id(n),id(school)+'/'+suffix+'.pdf',id(author)]);
    }
    await db.query('INSERT INTO forum_post_audience VALUES($1,$2)', [id(80),id(5)]);
    await db.query("INSERT INTO storage.objects VALUES($1,'forum-attachments',$2,$3)", [id(55),id(100)+'/orphan.pdf',id(2)]);
    await db.query("INSERT INTO storage.objects VALUES($1,'forum-attachments',$2,NULL)", [id(56),id(100)+'/allowed.pdf']);
    for (const [n, school, visS, visO, kind] of [[70,100,true,false,'SUMATIF'],[71,100,false,false,'SUMATIF'],[72,100,false,true,'FORMATIF'],[170,200,true,true,'SUMATIF']])
        await db.query("INSERT INTO assessments VALUES($1,$2,$3,$4,'2026/2027',1,$5,$6,$7,'Instrumen','2026-10-10')", [id(n),id(60),id(school),id(21),visS,visO,kind]);
    for (const [n,student,a,school,value] of [[90,10,70,100,82],[91,10,71,100,98],[92,11,70,100,22],[93,10,170,100,99],[94,10,72,100,75]])
        await db.query("INSERT INTO assessment_results(id,school_id,class_id,student_id,assessment_id,nilai,status,umpan_balik,catatan) VALUES($1,$2,$3,$4,$5,$6,'Tuntas','Umpan balik','Internal')", [id(n),id(school),id(21),id(student),id(a),value]);
    await db.query("INSERT INTO learning_objectives VALUES($1,$2,$3,$4,'2026/2027',1)", [id(180),id(100),id(21),id(60)]);
    await db.query("INSERT INTO grade_recap(id,school_id,class_id,student_id,learning_objective_id,academic_year,semester,nilai_akhir,deskripsi_capaian) VALUES($1,$2,$3,$4,$5,'2026/2027',1,88,'Capaian tersimpan')", [id(200),id(100),id(21),id(10),id(180)]);
    await test('migration can roll back and can be applied twice', async () => {
        const body = migration.replace(/^BEGIN;\s*$/m,'').replace(/^COMMIT;\s*$/m,'');
        await db.exec('BEGIN;'+body+'ROLLBACK;');
        assert.equal((await query("SELECT to_regprocedure('fn_portal_attendance(uuid,date,date)') AS fn"))[0].fn,null);
        await db.exec(migration); await db.exec(migration);
    });
    await caller(1);
    await test('teacher account columns blocked; own account retained', async () => {
        assert.equal((await query('SELECT * FROM users')).length,1);
        assert.equal((await query('SELECT * FROM users'))[0].user_id,id(1));
    });
    await test('safe names include teacher, TU, linked DUDI and readable parent author', async () => {
        assert.equal((await labels([2,3,7,5])).length,4);
        assert.deepEqual(Object.keys((await labels([2]))[0]).sort(),['dudi_org_name','full_name','role_type','user_id']);
    });
    await test('directory denies foreign, unrelated child and unlinked DUDI identities', async () => {
        assert.equal((await labels([4,6,12,15])).length,0);
        assert.equal((await labels(Array(101).fill(2))).length,0);
    });
    await test('student reads only published own assessment result', async () => {
        const rows = await query('SELECT * FROM assessment_results');
        assert.equal(rows.length,1); assert.equal(rows[0].id,id(90));
    });
    await test('RPC uses actual assessment score without legacy rows or invented grade', async () => {
        const result = await grades(); assert.equal(result.success,true); assert.equal(result.grades.length,1);
        assert.equal(result.grades[0].nilai_akhir,82); assert.equal(result.grades[0].kind,'ASESMEN');
        assert.equal(result.grades[0].deskripsi_naratif,'Umpan balik');
        assert(!JSON.stringify(result).includes('Internal'));
    });
    await test('year, semester and forged student parameters cannot bypass scope', async () => {
        assert.equal((await grades(id(11))).success,false);
        assert.equal((await grades(null,'2025/2026')).grades.length,0);
        assert.equal((await grades(null,null,2)).grades.length,0);
    });
    await test('recap hidden if any possibly contributing SUMATIF is hidden', async () => {
        assert.equal((await query('SELECT * FROM grade_recap')).length,0);
    });
    await test('historical own attendance survives withdrawn class, excludes void and other pupils', async () => {
        const rows = await history(); assert.equal(rows.length,2);
        assert.equal(rows[1].session_date,'2026-06-01'); assert.equal(rows[1].teacher.full_name,'Nama 2');
        assert.equal((await history(11)).length,0); assert.equal((await history(110)).length,0);
        assert.equal((await history(10,'2026-10-01','2026-10-10')).length,1);
    });
    await test('attachment recipient reads permitted file, including legacy ownerless file, but cannot delete it', async () => {
        assert.equal((await query('SELECT * FROM storage.objects')).length,3);
        assert.equal((await query('DELETE FROM storage.objects RETURNING id')).length,0);
    });
    await test('private, withdrawn, deleted and foreign attachments cannot be read', async () => {
        const names=(await query('SELECT name FROM storage.objects')).map(r=>r.name);
        assert(names.every(n=>[id(100)+'/allowed.pdf',id(100)+'/parent.pdf'].includes(n)));
    });
    await caller(2);
    await test('uploader can sign and clean own orphan after a failed post', async () => {
        assert.equal((await query('SELECT * FROM storage.objects WHERE id=$1',[id(55)])).length,1);
        await db.exec('BEGIN'); assert.equal((await query('DELETE FROM storage.objects WHERE id=$1 RETURNING id',[id(55)])).length,1); await db.exec('ROLLBACK');
    });
    await test('unrelated teacher cannot sign a staff-only attachment owned by another author', async () => {
        assert.equal((await query('SELECT * FROM storage.objects WHERE id=$1',[id(81)])).length,0);
        assert.equal((await query('DELETE FROM storage.objects WHERE id=$1 RETURNING id',[id(81)])).length,0);
    });
    await test('teacher read policies are unchanged by student restrictions', async () => {
        assert.equal((await query('SELECT * FROM assessment_results')).length,5);
        assert.equal((await query('SELECT * FROM grade_recap')).length,1);
    });
    await caller(7);
    await test('TU author can clean their own attachment even after the post is deleted', async () => {
        await db.exec('RESET ROLE; BEGIN');
        await db.query('DELETE FROM forum_posts WHERE post_id=$1',[id(81)]);
        await db.exec('SET ROLE authenticated');
        assert.equal((await query('DELETE FROM storage.objects WHERE id=$1 RETURNING id',[id(81)])).length,1);
        await db.exec('ROLLBACK');
    });
    for (const n of [8,16]) {
        await caller(n);
        await test('authorized moderator can clean same-tenant attachments: '+n, async () => {
            await db.exec('BEGIN'); const rows=await query('DELETE FROM storage.objects RETURNING name');
            assert.equal(rows.length,7); assert(rows.every(r=>r.name.startsWith(id(100)+'/'))); await db.exec('ROLLBACK');
        });
    }
    await caller(5);
    await test('parent publication flag and linked child scope are independent', async () => {
        assert.equal((await query('SELECT * FROM users')).length,1);
        const rows=await query('SELECT * FROM assessment_results'); assert.equal(rows.length,1); assert.equal(rows[0].id,id(94));
        assert.equal((await grades()).success,false); assert.equal((await grades(id(11))).success,false);
        assert.equal((await grades(id(10))).grades[0].nilai_akhir,75);
        assert.equal((await history()).length,2); assert.equal((await history(11)).length,0);
        assert.equal((await labels([3])).length,1);
    });
    await db.exec('RESET ROLE');
    await db.query('UPDATE assessments SET is_visible_siswa=true WHERE id=$1',[id(71)]);
    await caller(1);
    await test('published recap returns exactly teacher-saved value and description', async () => {
        const r=(await grades()).grades; assert.equal(r.length,3);
        const recap=r.find(g=>g.kind==='REKAP'); assert.equal(recap.nilai_akhir,88);
        assert.equal(recap.deskripsi_naratif,'Capaian tersimpan'); assert.equal(recap.predikat,null);
    });
    for (const n of [9,14,null,13]) {
        await caller(n);
        await test('inactive, deleted, unauthenticated or foreign caller blocked: '+n, async () => {
            assert.equal((await history()).length,0); assert.equal((await labels([2,3,7])).length,0);
            assert.equal((await grades(id(10))).success,false); assert.equal((await query('SELECT * FROM storage.objects')).length,0);
        });
    }
    await db.exec('RESET ROLE');
    await test('all new privileged functions revoke anon and PUBLIC execution', async () => {
        const rows=await query(`SELECT p.oid::regprocedure::text AS name,
            has_function_privilege('authenticated',p.oid,'EXECUTE') AS auth,
            has_function_privilege('anon',p.oid,'EXECUTE') AS anon,
            has_function_privilege('unrelated',p.oid,'EXECUTE') AS unrelated
            FROM pg_proc p WHERE proname IN ('fn_portal_can_read_student','fn_portal_user_labels',
            'fn_portal_assessment_visible','fn_portal_recap_visible','fn_portal_attendance',
            'fn_get_all_grades_summary','fn_forum_attachment_moderator','fn_forum_attachment_readable')`);
        assert.equal(rows.length,8); assert(rows.every(r=>r.auth&&!r.anon&&!r.unrelated));
    });
    console.log(`STUDENT_SQL_COMPLETE: ${passed} passed; synthetic only`);
} finally { await db.close(); }
