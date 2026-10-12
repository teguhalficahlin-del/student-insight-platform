import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const migration = readFileSync(new URL('../supabase/migrations/20261012100000_parent_portal_hardening.sql', import.meta.url), 'utf8');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const db = await PGlite.create();
let passed = 0;
const test = async (name, run) => { await run(); console.log(`PASS PARENT SQL ${++passed}: ${name}`); };

try {
    await db.exec(`
        CREATE ROLE authenticated;
        CREATE ROLE anon;
        CREATE SCHEMA auth;
        CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
            SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
        $$;
        CREATE TYPE role_type AS ENUM ('ORTU','GURU','BK','WALI_KELAS');
        CREATE TABLE users(
            user_id uuid PRIMARY KEY, auth_user_id uuid, school_id uuid,
            role_type role_type, wali_kelas_class_id uuid,
            is_active boolean DEFAULT true, deleted_at timestamptz
        );
        CREATE TABLE students(student_id uuid PRIMARY KEY, school_id uuid);
        CREATE TABLE student_parents(student_id uuid, parent_user_id uuid, school_id uuid);
        CREATE TABLE class_enrollments(student_id uuid, class_id uuid, school_id uuid,
            academic_year text, withdrawn_at timestamptz);
        CREATE TABLE bk_class_assignments(bk_user_id uuid, class_id uuid,
            school_id uuid, is_active boolean);
        CREATE TABLE guru_wali_assignments(guru_user_id uuid, student_id uuid,
            school_id uuid, academic_year text, is_active boolean);
        CREATE TABLE teaching_schedules(scheduled_teacher_id uuid, class_id uuid,
            school_id uuid, session_date date);
        CREATE TABLE forum_posts(post_id uuid PRIMARY KEY, author_user_id uuid,
            school_id uuid, academic_year text);
        CREATE TABLE forum_post_subjects(post_id uuid, student_id uuid, school_id uuid);
        CREATE TABLE forum_post_audience(post_id uuid, user_id uuid, school_id uuid);
        GRANT SELECT ON users, students, student_parents, class_enrollments,
            bk_class_assignments, guru_wali_assignments, teaching_schedules, forum_posts
            TO authenticated;
        GRANT SELECT, INSERT ON forum_post_audience TO authenticated;
        CREATE FUNCTION fn_current_user_id() RETURNS uuid LANGUAGE sql STABLE AS $$
            SELECT user_id FROM users WHERE auth_user_id = auth.uid();
        $$;
        CREATE FUNCTION fn_current_user_role() RETURNS role_type LANGUAGE sql STABLE AS $$
            SELECT role_type FROM users WHERE auth_user_id = auth.uid();
        $$;
        GRANT USAGE ON SCHEMA auth TO authenticated, anon;
        GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated, anon;
    `);
    await db.exec(migration);

    await db.query("INSERT INTO users(user_id,auth_user_id,school_id,role_type) VALUES ($1,$1,$2,'ORTU')", [id(1), id(100)]);
    await db.query("INSERT INTO users(user_id,auth_user_id,school_id,role_type) VALUES ($1,$1,$2,'WALI_KELAS')", [id(2), id(100)]);
    await db.query("INSERT INTO users(user_id,auth_user_id,school_id,role_type) VALUES ($1,$1,$2,'GURU'),($3,$3,$2,'GURU')", [id(3), id(100), id(4)]);
    await db.query('INSERT INTO students(student_id,school_id) VALUES ($1,$2),($3,$2),($4,$2)', [id(10), id(100), id(11), id(12)]);
    await db.query('INSERT INTO student_parents VALUES ($1,$2,$3),($4,$2,$3)', [id(10), id(1), id(100), id(11)]);
    await db.query("INSERT INTO class_enrollments VALUES ($1,$2,$3,'2026/2027',NULL),($4,$2,$3,'2026/2027',NULL)", [id(10), id(20), id(100), id(11)]);
    await db.query('UPDATE users SET wali_kelas_class_id=$1 WHERE user_id=$2', [id(20), id(2)]);
    await db.query("INSERT INTO guru_wali_assignments VALUES ($1,$2,$3,'2026/2027',true),($4,$5,$3,'2026/2027',true)", [id(3), id(10), id(100), id(4), id(11)]);
    await db.query('INSERT INTO forum_posts VALUES ($1,$2,$3,\'2026/2027\')', [id(90), id(1), id(100)]);
    await db.query('INSERT INTO forum_post_subjects VALUES ($1,$2,$3)', [id(90), id(10), id(100)]);

    await db.query('SELECT set_config(\'request.jwt.claim.sub\',$1,false)', [id(1)]);
    await db.exec('SET ROLE authenticated');
    await test('wali kelas and selected-child guru wali are accepted', async () => {
        await db.query('INSERT INTO forum_post_audience VALUES ($1,$2,$3),($1,$4,$3)',
            [id(90), id(2), id(100), id(3)]);
    });
    await test('guru wali of an unrelated child is rejected', async () => {
        await assert.rejects(
            db.query('INSERT INTO forum_post_audience VALUES ($1,$2,$3)', [id(90), id(4), id(100)]),
            error => error.code === '42501'
        );
    });
    console.log(`PARENT_SQL_COMPLETE: ${passed} passed; PGlite only`);
} finally {
    await db.close();
}
