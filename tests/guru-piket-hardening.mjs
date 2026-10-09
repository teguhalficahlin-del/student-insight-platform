import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const migration = readFileSync(new URL('../supabase/migrations/20261009150000_guru_piket_hardening.sql', import.meta.url), 'utf8');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const db = await PGlite.create();
let passed = 0;

async function test(label, fn) {
    await fn();
    console.log(`PASS SQL ${++passed}: ${label}`);
}

async function asUser(n) {
    await db.exec('RESET ROLE');
    await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [id(n)]);
    await db.exec('SET ROLE authenticated');
}

try {
    await db.exec(`
        CREATE ROLE authenticated;
        CREATE ROLE anon;
        CREATE ROLE service_role;
        CREATE SCHEMA auth;
        CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
            SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
        $$;
        GRANT USAGE ON SCHEMA auth TO authenticated, anon;
        GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated, anon;
        CREATE TYPE role_type AS ENUM ('GURU','ADMINISTRATIVE');
        CREATE TYPE day_of_week AS ENUM ('SENIN','SELASA','RABU','KAMIS','JUMAT','SABTU');
        CREATE TABLE users (
            user_id uuid PRIMARY KEY,
            auth_user_id uuid NOT NULL,
            school_id uuid NOT NULL,
            role_type role_type NOT NULL,
            is_active boolean NOT NULL DEFAULT true,
            deleted_at timestamptz
        );
        CREATE TABLE school_config (
            school_id uuid PRIMARY KEY,
            current_academic_year text NOT NULL,
            current_semester text NOT NULL
        );
        CREATE TABLE duty_schedules (
            duty_id uuid PRIMARY KEY,
            school_id uuid NOT NULL,
            user_id uuid NOT NULL,
            day_of_week day_of_week NOT NULL,
            academic_year text NOT NULL,
            semester integer NOT NULL,
            is_active boolean NOT NULL DEFAULT true
        );
        CREATE TABLE students (
            student_id uuid PRIMARY KEY,
            school_id uuid NOT NULL
        );
        CREATE TABLE class_enrollments (
            enrollment_id uuid PRIMARY KEY,
            school_id uuid NOT NULL,
            student_id uuid NOT NULL
        );
        CREATE TABLE late_arrivals (
            late_id uuid PRIMARY KEY,
            school_id uuid NOT NULL,
            student_id uuid NOT NULL,
            recorded_by uuid NOT NULL,
            late_date date NOT NULL,
            arrival_time time NOT NULL,
            reason text
        );
        CREATE TABLE student_exits (
            exit_id uuid PRIMARY KEY,
            school_id uuid NOT NULL,
            student_id uuid NOT NULL,
            recorded_by uuid NOT NULL,
            exit_date date NOT NULL,
            exit_time time NOT NULL,
            reason text
        );
        ALTER TABLE students ENABLE ROW LEVEL SECURITY;
        ALTER TABLE class_enrollments ENABLE ROW LEVEL SECURITY;
        ALTER TABLE late_arrivals ENABLE ROW LEVEL SECURITY;
        ALTER TABLE student_exits ENABLE ROW LEVEL SECURITY;
        GRANT SELECT, INSERT ON students, class_enrollments, late_arrivals, student_exits TO authenticated;
        GRANT SELECT ON users, school_config, duty_schedules TO authenticated;

        CREATE FUNCTION fn_current_user_id() RETURNS uuid
        LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
            SELECT user_id FROM users WHERE auth_user_id = auth.uid() LIMIT 1;
        $$;
        CREATE FUNCTION fn_current_school_id() RETURNS uuid
        LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
            SELECT school_id FROM users WHERE auth_user_id = auth.uid() LIMIT 1;
        $$;
        CREATE FUNCTION fn_student_in_current_school(p_student_id uuid) RETURNS boolean
        LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
            SELECT EXISTS (
                SELECT 1 FROM students
                WHERE student_id = p_student_id
                  AND school_id = fn_current_school_id()
            );
        $$;
        GRANT EXECUTE ON FUNCTION fn_current_user_id() TO authenticated;
        GRANT EXECUTE ON FUNCTION fn_current_school_id() TO authenticated;
        GRANT EXECUTE ON FUNCTION fn_student_in_current_school(uuid) TO authenticated;
    `);

    const day = (await db.query("SELECT CASE EXTRACT(ISODOW FROM NOW() AT TIME ZONE 'Asia/Jakarta')::int WHEN 1 THEN 'SENIN' WHEN 2 THEN 'SELASA' WHEN 3 THEN 'RABU' WHEN 4 THEN 'KAMIS' WHEN 5 THEN 'JUMAT' WHEN 6 THEN 'SABTU' END AS day")).rows[0].day;
    const today = (await db.query("SELECT (NOW() AT TIME ZONE 'Asia/Jakarta')::date AS today")).rows[0].today;

    await db.query('INSERT INTO users VALUES ($1,$1,$2,$3,true,NULL),($4,$4,$2,$3,false,NULL),($5,$5,$6,$3,true,NULL)',
        [id(1), id(10), 'GURU', id(2), id(3), id(20)]);
    await db.query('INSERT INTO school_config VALUES ($1,$2,$3)', [id(10), '2026/2027', '1']);
    await db.query('INSERT INTO students VALUES ($1,$2),($3,$4)', [id(101), id(10), id(102), id(20)]);
    await db.query('INSERT INTO duty_schedules VALUES ($1,$2,$3,$4,$5,$6,true)',
        [id(201), id(10), id(1), day, '2026/2027', 1]);

    await db.exec(migration);

    await test('akun aktif mendapat tenant scope dan status piket', async () => {
        await asUser(1);
        assert.equal((await db.query('SELECT fn_current_school_id() AS school_id')).rows[0].school_id, id(10));
        assert.equal((await db.query('SELECT fn_is_on_duty_today() AS on_duty')).rows[0].on_duty, true);
    });

    await test('jadwal periode lama tidak mengaktifkan piket', async () => {
        await db.exec('RESET ROLE');
        await db.exec("UPDATE duty_schedules SET academic_year = '2025/2026'");
        await asUser(1);
        assert.equal((await db.query('SELECT fn_is_on_duty_today() AS on_duty')).rows[0].on_duty, false);
        await db.exec('RESET ROLE');
        await db.exec("UPDATE duty_schedules SET academic_year = '2026/2027'");
    });

    await test('insert keterlambatan siswa satu sekolah diterima', async () => {
        await asUser(1);
        await db.query('INSERT INTO late_arrivals VALUES ($1,$2,$3,$4,$5,$6,NULL)',
            [id(301), id(10), id(101), id(1), today, '07:20']);
        await db.exec('RESET ROLE');
        assert.equal((await db.query('SELECT count(*)::int AS count FROM late_arrivals')).rows[0].count, 1);
    });

    await test('insert keterlambatan siswa lintas sekolah ditolak', async () => {
        await asUser(1);
        await assert.rejects(
            db.query('INSERT INTO late_arrivals VALUES ($1,$2,$3,$4,$5,$6,NULL)',
                [id(302), id(10), id(102), id(1), today, '07:20']),
            /row-level security|violates/i
        );
    });

    await test('akun nonaktif kehilangan tenant scope dan piket', async () => {
        await asUser(2);
        assert.equal((await db.query('SELECT fn_current_school_id() AS school_id')).rows[0].school_id, null);
        assert.equal((await db.query('SELECT fn_is_on_duty_today() AS on_duty')).rows[0].on_duty, false);
    });

    await test('migration tidak melakukan cast MINGGU ke enum Senin-Sabtu', async () => {
        assert.match(migration, /ELSE NULL::public\.day_of_week/);
        assert.doesNotMatch(migration, /THEN 'MINGGU'/);
    });

    console.log(`GURU_PIKET_HARDENING_SQL_COMPLETE: ${passed} checks passed; in-memory PostgreSQL only.`);
} finally {
    await db.close();
}
