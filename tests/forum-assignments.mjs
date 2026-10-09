import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const migration = read('supabase/migrations/20261009170000_forum_assignments_hardening.sql');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const db = await PGlite.create();
let passed = 0;
async function test(label, fn) {
    await fn();
    console.log(`PASS ${++passed}: ${label}`);
}
async function asUser(n) {
    await db.exec('RESET ROLE');
    await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [n ? id(n) : '']);
    await db.exec('SET ROLE authenticated');
}
function extractFunction(source, name) {
    const definition = source.match(new RegExp(`export async function ${name}\\([\\s\\S]*?\\n}`))?.[0];
    assert.ok(definition, name);
    return definition.replace(/^export /, '');
}

// Exercise the real API functions against local PostgreSQL, not an assignment mock.
let lookupError = null;
const client = {
    async rpc(name) {
        try { return { data: (await db.query(`SELECT * FROM ${name}()`)).rows, error: null }; }
        catch (error) { return { data: null, error }; }
    },
    from(table) {
        let operation = 'select', columns = '*', value, order;
        const filters = [];
        const query = {
            select(v) { columns = v; return query; },
            eq(k, v) { filters.push([k, '=', v]); return query; },
            is(k, v) { filters.push([k, 'is', v]); return query; },
            in(k, v) { filters.push([k, 'in', v]); return query; },
            order(k) { order = k; return query; },
            insert(v) { operation = 'insert'; value = v; return query; },
            update(v) { operation = 'update'; value = v; return query; },
            maybeSingle() { return run(true); },
            single() { return run(true); },
            then(resolve, reject) { return run(false).then(resolve, reject); },
        };
        async function run(single) {
            try {
                if (operation === 'select' && lookupError) throw lookupError;
                let parameters = [];
                const parameter = v => { parameters.push(v); return `$${parameters.length}`; };
                const where = filters.map(([column, op, v]) => {
                    if (op === 'is' && v === null) return `${column} IS NULL`;
                    if (op === 'in') return `${column} IN (${v.map(parameter).join(',')})`;
                    return `${column} = ${parameter(v)}`;
                }).join(' AND ');
                let sql;
                if (operation === 'select') {
                    sql = `SELECT ${columns} FROM ${table}${where ? ` WHERE ${where}` : ''}${order ? ` ORDER BY ${order}` : ''}`;
                } else if (operation === 'insert') {
                    parameters = [];
                    sql = `INSERT INTO ${table} (${Object.keys(value).join(',')}) VALUES (${Object.values(value).map(parameter).join(',')}) RETURNING ${columns}`;
                } else {
                    const updates = Object.entries(value).map(([k, v]) => `${k} = ${parameter(v)}`);
                    sql = `UPDATE ${table} SET ${updates.join(',')}${where ? ` WHERE ${where}` : ''} RETURNING ${columns}`;
                }
                const { rows } = await db.query(sql, parameters);
                if (single && rows.length > 1) throw new Error('multiple rows');
                return { data: single ? rows[0] ?? null : rows, error: null };
            } catch (error) { return { data: null, error }; }
        }
        return query;
    },
};
const names = ['getForumBkStaff', 'getForumGuruWaliCandidates', 'assignBkToClass', 'revokeBkFromClass',
    'assignGuruWaliToStudent', 'revokeGuruWaliFromStudent', 'assignDutySchedule', 'revokeDutySchedule'];
const source = read('admin/js/api.js');
const api = new Function('supabase', `${names.map(n => extractFunction(source, n)).join('\n')}\nreturn {${names.join(',')}};`)(client);

try {
    await db.exec(`
        CREATE ROLE authenticated; CREATE ROLE anon; CREATE ROLE service_role;
        CREATE SCHEMA auth;
        CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
            SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
        $$;
        GRANT USAGE ON SCHEMA auth TO authenticated, anon;
        GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated, anon;
        CREATE TYPE role_type AS ENUM ('GURU','BK','WALI_KELAS','KAPRODI','KEPSEK',
            'WAKA_KURIKULUM','WAKA_KESISWAAN','WAKA_HUMAS','ADMINISTRATIVE','SISWA','ORTU','DUDI','STAKEHOLDER','TU');
        CREATE TYPE day_of_week AS ENUM ('SENIN','SELASA','RABU','KAMIS','JUMAT','SABTU');
        CREATE TABLE schools(school_id uuid PRIMARY KEY);
        CREATE TABLE users(user_id uuid PRIMARY KEY, auth_user_id uuid, school_id uuid,
            full_name text, role_type role_type, is_active boolean DEFAULT true, deleted_at timestamptz,
            login_identifier text, wali_kelas_class_id uuid, program_id uuid, kaprodi_program_id uuid,
            is_waka_kesiswaan boolean DEFAULT false, is_kepsek boolean DEFAULT false, is_bk boolean DEFAULT false);
        CREATE TABLE classes(class_id uuid PRIMARY KEY, school_id uuid, program_id uuid);
        CREATE TABLE students(student_id uuid PRIMARY KEY, school_id uuid, full_name text, nis text, student_status text);
        CREATE TABLE teaching_assignments(user_id uuid, class_id uuid, academic_year text, is_active boolean, school_id uuid);
        CREATE TABLE class_enrollments(student_id uuid, class_id uuid, academic_year text, withdrawn_at timestamptz, school_id uuid);
        CREATE TABLE student_parents(student_id uuid, parent_user_id uuid, school_id uuid);
        CREATE FUNCTION fn_current_user_role() RETURNS role_type LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
            SELECT role_type FROM users WHERE auth_user_id = auth.uid();
        $$;
    `);
    const currentSchool = read('supabase/migrations/20261009150000_guru_piket_hardening.sql')
        .match(/CREATE OR REPLACE FUNCTION public\.fn_current_school_id\(\)[\s\S]*?\$\$;/)[0];
    await db.exec(currentSchool);
    const base = read('supabase/migrations/20260710020000_forum_kelas_initial.sql');
    for (const table of ['bk_class_assignments', 'guru_wali_assignments']) {
        await db.exec(base.match(new RegExp(`CREATE TABLE ${table} \\([\\s\\S]*?\\n\\);`))[0]);
        await db.exec(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;
            GRANT SELECT,INSERT,UPDATE ON ${table} TO authenticated;
            CREATE POLICY tenant_read ON ${table} FOR SELECT USING (school_id = fn_current_school_id());`);
    }
    await db.exec(read('supabase/migrations/20260711020000_fix_forum_assignment_rls.sql'));
    const duty = read('supabase/migrations/20260721030000_guru_piket.sql');
    await db.exec(duty.match(/CREATE TABLE public\.duty_schedules \([\s\S]*?\n\);/)[0]);
    await db.exec(`ALTER TABLE duty_schedules ENABLE ROW LEVEL SECURITY;
        GRANT SELECT,INSERT,UPDATE ON duty_schedules TO authenticated;
        CREATE POLICY tenant_read ON duty_schedules FOR SELECT USING (school_id = fn_current_school_id());
        CREATE POLICY admin_write ON duty_schedules FOR ALL TO authenticated
            USING (school_id = fn_current_school_id() AND fn_current_user_role() = 'ADMINISTRATIVE')
            WITH CHECK (school_id = fn_current_school_id() AND fn_current_user_role() = 'ADMINISTRATIVE');
        ALTER TABLE users ENABLE ROW LEVEL SECURITY;
        CREATE POLICY tenant_read ON users FOR SELECT USING (school_id = fn_current_school_id());
        CREATE VIEW v_users_staff_directory WITH (security_invoker = true) AS
            SELECT user_id, school_id, full_name, role_type, login_identifier, is_active, deleted_at FROM users;
        GRANT SELECT ON users, v_users_staff_directory TO authenticated;
    `);
    const autoSchool = read('supabase/migrations/20260701250000_smart_auto_school_id.sql')
        .match(/CREATE OR REPLACE FUNCTION fn_auto_set_school_id\(\)[\s\S]*?\$\$;/)[0];
    await db.exec(autoSchool);
    await db.exec(read('supabase/migrations/20260711030000_forum_assignment_auto_school_id.sql'));
    await db.query('INSERT INTO schools VALUES ($1),($2)', [id(1), id(2)]);
    for (const [n, school, role, active, deleted, bk] of [
        [10,1,'ADMINISTRATIVE',true,false,false], [11,1,'BK',true,false,false],
        [12,1,'GURU',true,false,true], [13,1,'GURU',false,false,false], [14,1,'GURU',true,false,false],
        [15,1,'GURU',true,true,true], [16,1,'ADMINISTRATIVE',false,false,false],
        [17,1,'ADMINISTRATIVE',true,true,false], [18,1,'ORTU',true,false,false],
        [20,2,'GURU',true,false,true], [21,2,'ORTU',true,false,false],
    ]) {
        await db.query(`INSERT INTO users(user_id,auth_user_id,school_id,full_name,role_type,is_active,deleted_at,is_bk,login_identifier)
            VALUES ($1,$1,$2,$3,$4,$5,$6,$7,$8)`,
        [id(n), id(school), `SYNTHETIC-${n}`, role, active, deleted ? '2026-01-01' : null, bk, `00${n}`]);
    }
    await db.query('INSERT INTO classes VALUES ($1,$2,NULL),($3,$4,NULL)', [id(30),id(1),id(31),id(2)]);
    await db.query("INSERT INTO students VALUES ($1,$2,'SYNTHETIC-A','001','AKTIF'),($3,$4,'SYNTHETIC-B','002','AKTIF')",
        [id(40),id(1),id(41),id(2)]);
    for (const [student, cls, school, parent] of [[40,30,1,18],[41,31,2,21]]) {
        await db.query("INSERT INTO class_enrollments VALUES ($1,$2,'2026/2027',NULL,$3)", [id(student),id(cls),id(school)]);
        await db.query('INSERT INTO student_parents VALUES ($1,$2,$3)', [id(student),id(parent),id(school)]);
    }
    // Legacy bad reference fixture: migration must not rewrite it and revocation must remain possible.
    await db.query(`INSERT INTO bk_class_assignments(school_id,bk_user_id,class_id,academic_year)
        VALUES ($1,$2,$3,'2025/2026')`, [id(1),id(20),id(30)]);
    await db.exec(migration);
    await test('migration can be applied twice without data changes', async () => {
        await db.exec(migration);
        assert.equal((await db.query('SELECT count(*)::int AS n FROM bk_class_assignments')).rows[0].n, 1);
    });
    await asUser(10);
    await test('BK candidates include GURU + is_bk, exclude foreign/deleted users', async () => {
        assert.deepEqual((await api.getForumBkStaff()).map(u => u.user_id), [id(11),id(12)]);
        assert.equal((await api.getForumBkStaff())[1].login_identifier, '0012');
    });
    await test('Guru Wali candidates exclude inactive/deleted/foreign staff', async () => {
        assert.deepEqual((await api.getForumGuruWaliCandidates()).map(u => u.user_id), [id(11),id(12),id(14)]);
    });
    let bkId, gwId, dutyId;
    await test('BK insert fills school_id before tenant validation', async () => {
        bkId = await api.assignBkToClass(id(30),id(12),'2026/2027',id(10));
        assert.ok(bkId);
    });
    await test('active BK duplicate is skipped', async () => {
        assert.equal(await api.assignBkToClass(id(30),id(12),'2026/2027',id(10)), 'exists');
    });
    await test('revoked BK reuses its original assignment', async () => {
        await api.revokeBkFromClass(bkId);
        assert.equal(await api.assignBkToClass(id(30),id(12),'2026/2027',id(10)), bkId);
    });
    await test('Guru Wali initial insert and duplicate work', async () => {
        gwId = await api.assignGuruWaliToStudent(id(40),id(12),'2026/2027',id(10));
        assert.equal(await api.assignGuruWaliToStudent(id(40),id(12),'2026/2027',id(10)), 'exists');
    });
    await test('revoked Guru Wali can be assigned again to the same teacher', async () => {
        await api.revokeGuruWaliFromStudent(gwId);
        assert.equal(await api.assignGuruWaliToStudent(id(40),id(12),'2026/2027',id(10)), gwId);
    });
    await test('active Guru Wali is never silently replaced', async () => {
        await assert.rejects(api.assignGuruWaliToStudent(id(40),id(14),'2026/2027',id(10)), /Cabut penugasan/);
    });
    await test('revoked Guru Wali can be replaced without unique violation', async () => {
        await api.revokeGuruWaliFromStudent(gwId);
        assert.equal(await api.assignGuruWaliToStudent(id(40),id(14),'2026/2027',id(10)), gwId);
    });
    await test('duty assignment insert/revoke/reactivation still works', async () => {
        dutyId = await api.assignDutySchedule(id(14),'SENIN','2026/2027',1,id(10),id(1));
        await api.revokeDutySchedule(dutyId);
        assert.equal(await api.assignDutySchedule(id(14),'SENIN','2026/2027',1,id(10),id(1)), dutyId);
    });
    for (const assign of [
        () => api.assignBkToClass(id(30),id(11),'2027/2028',id(10)),
        () => api.assignGuruWaliToStudent(id(40),id(12),'2027/2028',id(10)),
    ]) {
        await test('lookup errors propagate instead of proceeding to INSERT', async () => {
            lookupError = new Error('synthetic lookup failure');
            try { await assert.rejects(assign(), /synthetic lookup failure/); }
            finally { lookupError = null; }
        });
    }
    const forbidden = [
        ['BK foreign class', () => api.assignBkToClass(id(31),id(11),'2026/2027',id(10))],
        ['BK foreign staff', () => api.assignBkToClass(id(30),id(20),'2026/2027',id(10))],
        ['BK foreign assigner', () => api.assignBkToClass(id(30),id(11),'2026/2027',id(20))],
        ['Guru Wali foreign student', () => api.assignGuruWaliToStudent(id(41),id(12),'2026/2027',id(10))],
        ['Guru Wali foreign teacher', () => api.assignGuruWaliToStudent(id(40),id(20),'2027/2028',id(10))],
        ['Guru Wali foreign assigner', () => api.assignGuruWaliToStudent(id(40),id(12),'2027/2028',id(20))],
        ['duty foreign teacher', () => api.assignDutySchedule(id(20),'SENIN','2026/2027',1,id(10),id(1))],
        ['duty foreign assigner', () => api.assignDutySchedule(id(12),'SENIN','2026/2027',1,id(20),id(1))],
    ];
    for (const [label, fn] of forbidden) {
        await test(`${label} rejected on insert`, () => assert.rejects(fn(), error => error.code === '23514'));
    }
    for (const [table, pk, rowId, columns] of [
        ['bk_class_assignments','assignment_id',bkId,{ bk_user_id:20, class_id:31, assigned_by_user_id:20, school_id:2 }],
        ['guru_wali_assignments','assignment_id',gwId,{ guru_user_id:20, student_id:41, assigned_by_user_id:20, school_id:2 }],
        ['duty_schedules','duty_id',dutyId,{ user_id:20, assigned_by_user_id:20, school_id:2 }],
    ]) {
        for (const [column, foreignId] of Object.entries(columns)) {
            await test(`${table}.${column} rejects foreign tenant on UPDATE`, () => assert.rejects(
                db.query(`UPDATE ${table} SET ${column}=$1 WHERE ${pk}=$2`, [id(foreignId),rowId]),
                error => error.code === '23514' || error.code === '42501'
            ));
        }
    }
    await test('bad legacy assignment can be revoked but not reactivated', async () => {
        await db.exec("UPDATE bk_class_assignments SET is_active=false WHERE academic_year='2025/2026'");
        await assert.rejects(db.exec("UPDATE bk_class_assignments SET is_active=true WHERE academic_year='2025/2026'"),
            error => error.code === '23514');
    });
    await test('API reactivation rejects foreign references and leaves revoked rows inactive', async () => {
        await api.revokeBkFromClass(bkId);
        await assert.rejects(api.assignBkToClass(id(30),id(12),'2026/2027',id(20)), error => error.code === '23514');
        await api.revokeGuruWaliFromStudent(gwId);
        await assert.rejects(api.assignGuruWaliToStudent(id(40),id(20),'2026/2027',id(10)), error => error.code === '23514');
        await api.revokeDutySchedule(dutyId);
        await assert.rejects(api.assignDutySchedule(id(14),'SENIN','2026/2027',1,id(20),id(1)), error => error.code === '23514');
        for (const [table, pk, rowId] of [['bk_class_assignments','assignment_id',bkId],
            ['guru_wali_assignments','assignment_id',gwId],['duty_schedules','duty_id',dutyId]]) {
            assert.equal((await db.query(`SELECT is_active FROM ${table} WHERE ${pk}=$1`, [rowId])).rows[0].is_active, false);
        }
        await api.assignBkToClass(id(30),id(12),'2026/2027',id(10));
        await api.assignGuruWaliToStudent(id(40),id(14),'2026/2027',id(10));
        await api.assignDutySchedule(id(14),'SENIN','2026/2027',1,id(10),id(1));
    });
    await test('same-school forum member details still include parent and student name', async () => {
        const { rows } = await db.query("SELECT * FROM fn_get_forum_member_details($1,'2026/2027')", [id(30)]);
        assert.ok(rows.some(u => u.user_id === id(18) && u.student_name === 'SYNTHETIC-A'));
        assert.ok(rows.some(u => u.user_id === id(12)));
        assert.ok(rows.some(u => u.user_id === id(14)));
    });
    await test('foreign-school forum member details return no names', async () => {
        assert.equal((await db.query("SELECT * FROM fn_get_forum_member_details($1,'2026/2027')", [id(31)])).rows.length, 0);
    });
    await test('same-school member details exclude legacy foreign teacher/parent references', async () => {
        await db.exec('RESET ROLE');
        await db.query("INSERT INTO teaching_assignments VALUES ($1,$2,'2026/2027',true,$3)", [id(20),id(30),id(1)]);
        await db.query('INSERT INTO student_parents VALUES ($1,$2,$3)', [id(40),id(21),id(1)]);
        await asUser(10);
        const { rows } = await db.query("SELECT * FROM fn_get_forum_member_details($1,'2026/2027')", [id(30)]);
        assert.ok(!rows.some(u => u.user_id === id(20) || u.user_id === id(21)));
    });
    for (const n of [null,16,17]) {
        await test(`missing/inactive/deleted caller ${n} receives no member details or BK candidates`, async () => {
            await asUser(n);
            assert.equal((await db.query("SELECT * FROM fn_get_forum_member_details($1,'2026/2027')", [id(30)])).rows.length, 0);
            assert.equal((await api.getForumBkStaff()).length, 0);
        });
    }
    await test('non-admin cannot retrieve the admin BK candidate directory', async () => {
        await asUser(12);
        assert.equal((await api.getForumBkStaff()).length, 0);
    });
    await test('anon has no execute privilege; trigger is not a public RPC', async () => {
        await db.exec('RESET ROLE');
        const { rows } = await db.query(`SELECT
            has_function_privilege('anon','fn_get_forum_bk_staff()','EXECUTE') AS bk_anon,
            has_function_privilege('anon','fn_get_forum_member_details(uuid,text)','EXECUTE') AS details_anon,
            has_function_privilege('authenticated','fn_guard_forum_assignment_tenant()','EXECUTE') AS guard_auth,
            has_function_privilege('service_role','fn_guard_forum_assignment_tenant()','EXECUTE') AS guard_service`);
        assert.deepEqual(rows[0], { bk_anon:false, details_anon:false, guard_auth:false, guard_service:true });
    });
    console.log(`TOTAL ${passed} tests passed; synthetic in-memory PostgreSQL only.`);
} finally { await db.close(); }
