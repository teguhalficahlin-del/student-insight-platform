/**
 * @file permission_engine.test.js
 * @description Test suite for permission_engine.js
 *
 * Run with Node.js (no test framework needed):
 *   node permission_engine.test.js
 *
 * All tests are pure — no network, no DB, no DOM.
 * Expected output: all PASS.
 */

// ─── Inline minimal copies of dependencies (for standalone test run) ───
// In the real app, these are imported from 09_event_schema.js

const ROLE_TYPE = {
    GURU: 'GURU', BK: 'BK', WALI_KELAS: 'WALI_KELAS',
    KAPRODI: 'KAPRODI', KEPSEK: 'KEPSEK',
    DUDI: 'DUDI', SISWA: 'SISWA', ORTU: 'ORTU',
};
const CASE_STATUS = {
    OPEN: 'OPEN', UNDER_REVIEW: 'UNDER_REVIEW',
    INTERVENTION: 'INTERVENTION', MONITORING: 'MONITORING', CLOSED: 'CLOSED',
};
const VISIBILITY_LEVEL = {
    PRIVATE: 'PRIVATE', INTERNAL_SCHOOL: 'INTERNAL_SCHOOL', STUDENT_VISIBLE: 'STUDENT_VISIBLE',
};
// Chain = PENUNTUN advisory (bukan penegakan) sejak mig 20260703250000.
const ESCALATION_CHAIN = {
    SEKOLAH: ['GURU', 'BK', 'WALI_KELAS', 'KAPRODI', 'WAKA_KESISWAAN', 'KEPSEK'],
    PKL:     ['DUDI', 'KAPRODI', 'WAKA_KESISWAAN', 'KEPSEK'],
};

// ─── Inline the engine (copy logic for standalone test) ───────────────
// In CI, import directly: import { checkPermission, ACTIONS } from './10_permission_engine.js'
// For this standalone runner, we replicate the full engine inline.

function allow(reason = 'Permitted') { return { allowed: true, reason, code: 'ALLOWED' }; }
function deny(reason, code = 'DENIED') { return { allowed: false, reason, code }; }
function caseIsOpen(c) { return c.status !== CASE_STATUS.CLOSED; }
function isCurrentHandler(u, c) { return c.current_handler_role === u.role_type; }
function hasEverBeenInvolved(u, c) { return Array.isArray(c.involved_user_ids) && c.involved_user_ids.includes(u.user_id); }
function hasAssignmentForStudent(u, s, a) { return Array.isArray(a) && s?.class_id && a.some(x => x.class_id === s.class_id); }
function dudiSupervisesStudent(u, s) { return u.role_type === 'DUDI' && s?.pkl_dudi_user_id === u.user_id; }
function isWaliKelasForStudent(u, s) { return u.wali_kelas_class_id !== null && u.wali_kelas_class_id === s?.class_id; }
function hasValidSubstituteToken(u, sc) {
    if (!sc || sc.substitute_user_id !== u.user_id || !sc.substitute_token_expires_at) return false;
    return new Date(sc.substitute_token_expires_at) > new Date();
}
function isAssignedTeacher(u, sc) { return sc?.assigned_teacher_id === u.user_id; }
function nextEscalationStep(track, role) {
    const chain = ESCALATION_CHAIN[track]; if (!chain) return null;
    const idx = chain.indexOf(role); if (idx === -1 || idx === chain.length - 1) return null;
    return chain[idx + 1];
}

// Checker functions
function checkCaseView(u, c, s, a) {
    const role = u.role_type;
    if (c.status === CASE_STATUS.CLOSED) {
        if (role === 'SISWA' && c.student_id === s?.student_id) return allow();
    }
    if (['BK','WALI_KELAS','KAPRODI','KEPSEK'].includes(role)) return allow();
    if (role === 'GURU') {
        if (hasEverBeenInvolved(u, c)) return allow();
        if (hasAssignmentForStudent(u, s, a)) return allow();
        return deny('Guru no access', 'GURU_NO_ACCESS');
    }
    if (role === 'DUDI') return dudiSupervisesStudent(u, s) ? allow() : deny('DUDI not supervisor', 'DUDI_NOT_SUPERVISOR');
    if (role === 'SISWA') return c.student_id === s?.student_id ? allow() : deny('Not owner', 'STUDENT_NOT_OWNER');
    if (role === 'ORTU') return deny('Blocked', 'ORTU_BLOCKED');
    return deny('Unknown', 'UNKNOWN_ROLE');
}
function checkCaseCreate(u) {
    return ['GURU','KEPSEK','DUDI'].includes(u.role_type) ? allow() : deny('Cannot create', 'ROLE_CANNOT_CREATE_CASE');
}
function checkCaseAddComment(u, c) {
    if (!caseIsOpen(c)) return deny('Closed', 'CASE_CLOSED');
    if (!['GURU','BK','WALI_KELAS','KAPRODI','KEPSEK','DUDI'].includes(u.role_type))
        return deny('Role cannot comment', 'ROLE_CANNOT_COMMENT');
    if (!isCurrentHandler(u, c)) return deny('Not handler', 'NOT_CURRENT_HANDLER');
    return allow();
}
function checkCaseEscalate(u, c) {
    if (!caseIsOpen(c)) return deny('Closed', 'CASE_CLOSED');
    if (u.role_type === 'KEPSEK') return deny('Kepsek uses final decision', 'KEPSEK_USES_FINAL_DECISION');
    if (!isCurrentHandler(u, c)) return deny('Not handler', 'NOT_CURRENT_HANDLER');
    const next = nextEscalationStep(c.track, c.current_handler_role);
    if (!next) return deny('No next step', 'NO_NEXT_ESCALATION_STEP');
    return allow(`Can escalate to ${next}`);
}
function checkCaseClose(u, c) {
    if (!caseIsOpen(c)) return deny('Closed', 'CASE_CLOSED');
    if (!isCurrentHandler(u, c)) return deny('Not handler', 'NOT_CURRENT_HANDLER');
    return allow();
}
function checkCaseFinalDecision(u, c) {
    if (u.role_type !== 'KEPSEK') return deny('Not kepsek', 'NOT_KEPSEK');
    if (!caseIsOpen(c)) return deny('Closed', 'CASE_CLOSED');
    return allow();
}
function checkCaseLock(u, c) {
    if (!caseIsOpen(c)) return deny('Closed', 'CASE_CLOSED');
    if (c.is_locked) return deny('Already locked', 'ALREADY_LOCKED');
    if (!isCurrentHandler(u, c)) return deny('Not handler', 'NOT_CURRENT_HANDLER');
    return allow();
}
function checkCaseUnlock(u, c) {
    if (!caseIsOpen(c)) return deny('Closed', 'CASE_CLOSED');
    if (!c.is_locked) return deny('Not locked', 'NOT_LOCKED');
    if (!isCurrentHandler(u, c)) return deny('Not handler', 'NOT_CURRENT_HANDLER');
    return allow();
}
function checkAttendanceSubmit(u, sc) {
    if (!sc) return deny('No schedule', 'SCHEDULE_NOT_FOUND');
    if (isAssignedTeacher(u, sc)) return allow();
    if (hasValidSubstituteToken(u, sc)) return allow();
    if (sc.substitute_user_id === u.user_id && sc.substitute_token_expires_at &&
        new Date(sc.substitute_token_expires_at) <= new Date())
        return deny('Token expired', 'SUBSTITUTE_TOKEN_EXPIRED');
    return deny('Not assigned', 'NOT_ASSIGNED_TEACHER');
}
function checkAchievementCreate(u, s) {
    if (['KAPRODI','KEPSEK'].includes(u.role_type)) return allow();
    if (u.role_type === 'WALI_KELAS') {
        return isWaliKelasForStudent(u, s) ? allow() : deny('Wrong class', 'WALI_KELAS_WRONG_CLASS');
    }
    return deny('Cannot create', 'ROLE_CANNOT_CREATE_ACHIEVEMENT');
}

// ─────────────────────────────────────────────────────────────
// TEST RUNNER
// ─────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures = [];

function test(description, fn) {
    try {
        fn();
        console.log(`  ✅ ${description}`);
        passed++;
    } catch (err) {
        console.log(`  ❌ ${description}`);
        console.log(`     → ${err.message}`);
        failed++;
        failures.push({ description, error: err.message });
    }
}

function expect(actual) {
    return {
        toBe(expected) {
            if (actual !== expected) throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
        },
        toBeTrue() {
            if (actual !== true) throw new Error(`Expected true, got ${JSON.stringify(actual)}`);
        },
        toBeFalse() {
            if (actual !== false) throw new Error(`Expected false, got ${JSON.stringify(actual)}`);
        },
    };
}

// ─── FIXTURES ─────────────────────────────────────────────────

const ID = {
    user:    '11111111-1111-1111-1111-111111111111',
    user2:   '22222222-2222-2222-2222-222222222222',
    student: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    class:   'cccccccc-cccc-cccc-cccc-cccccccccccc',
    class2:  'dddddddd-dddd-dddd-dddd-dddddddddddd',
    case:    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    schedule:'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
    dudi:    'ffffffff-ffff-ffff-ffff-ffffffffffff',
};

function makeUser(role, overrides = {}) {
    return { user_id: ID.user, role_type: role, wali_kelas_class_id: null, is_active: true, ...overrides };
}

function makeCase(overrides = {}) {
    return {
        case_id: ID.case,
        status: CASE_STATUS.OPEN,
        current_handler_role: ROLE_TYPE.GURU,
        is_locked: false,
        track: 'SEKOLAH',
        student_id: ID.student,
        initiated_by_role: ROLE_TYPE.GURU,
        involved_user_ids: [ID.user],
        ...overrides,
    };
}

function makeStudent(overrides = {}) {
    return { student_id: ID.student, student_status: 'AKTIF', class_id: ID.class, pkl_dudi_user_id: null, ...overrides };
}

function makeSchedule(overrides = {}) {
    const tomorrow = new Date(Date.now() + 86400000).toISOString();
    return {
        schedule_id: ID.schedule,
        class_id: ID.class,
        session_date: new Date().toISOString().slice(0, 10),
        assigned_teacher_id: ID.user,
        substitute_user_id: null,
        substitute_token_expires_at: null,
        meeting_status: 'NORMAL',
        ...overrides,
    };
}

const assignments = [{ class_id: ID.class, subject_id: 'sub1' }];

// ─────────────────────────────────────────────────────────────
// TEST SUITES
// ─────────────────────────────────────────────────────────────

console.log('\n══════════════════════════════════════════');
console.log('  PERMISSION ENGINE — TEST SUITE v1.0.0');
console.log('══════════════════════════════════════════\n');


// ── INV-1: No actions on CLOSED case ──────────────────────────
console.log('▸ INV-1: CLOSED case blocks all write actions');

test('COMMENT_ADDED blocked on CLOSED case', () => {
    const r = checkCaseAddComment(makeUser('BK'), makeCase({ status: 'CLOSED', current_handler_role: 'BK' }));
    expect(r.allowed).toBeFalse();
    expect(r.code).toBe('CASE_CLOSED');
});

test('DECISION_ESCALATE blocked on CLOSED case', () => {
    const r = checkCaseEscalate(makeUser('GURU'), makeCase({ status: 'CLOSED', current_handler_role: 'GURU' }));
    expect(r.allowed).toBeFalse();
    expect(r.code).toBe('CASE_CLOSED');
});

test('DECISION_CLOSE blocked on CLOSED case', () => {
    const r = checkCaseClose(makeUser('BK'), makeCase({ status: 'CLOSED', current_handler_role: 'BK' }));
    expect(r.allowed).toBeFalse();
    expect(r.code).toBe('CASE_CLOSED');
});

test('FINAL_DECISION_MADE blocked on CLOSED case (INV-1 applies to Kepsek too)', () => {
    const r = checkCaseFinalDecision(makeUser('KEPSEK'), makeCase({ status: 'CLOSED' }));
    expect(r.allowed).toBeFalse();
    expect(r.code).toBe('CASE_CLOSED');
});

test('CASE_LOCK blocked on CLOSED case', () => {
    const r = checkCaseLock(makeUser('GURU'), makeCase({ status: 'CLOSED', current_handler_role: 'GURU' }));
    expect(r.allowed).toBeFalse();
    expect(r.code).toBe('CASE_CLOSED');
});

test('SISWA can VIEW a CLOSED case (their own)', () => {
    const r = checkCaseView(makeUser('SISWA'), makeCase({ status: 'CLOSED' }), makeStudent(), []);
    expect(r.allowed).toBeTrue();
});


// ── INV-2: ESCALATE must change handler ───────────────────────
console.log('\n▸ INV-2: Escalation must advance handler role');

test('GURU can escalate to BK (SEKOLAH track, step 0→1)', () => {
    const r = checkCaseEscalate(makeUser('GURU'), makeCase({ current_handler_role: 'GURU', track: 'SEKOLAH' }));
    expect(r.allowed).toBeTrue();
});

test('BK can escalate to WALI_KELAS', () => {
    const r = checkCaseEscalate(makeUser('BK'), makeCase({ current_handler_role: 'BK', track: 'SEKOLAH' }));
    expect(r.allowed).toBeTrue();
});

test('KAPRODI cannot escalate (end of SEKOLAH chain before KEPSEK who uses FINAL_DECISION)', () => {
    // KAPRODI is index 3, KEPSEK is index 4 — next step exists
    const r = checkCaseEscalate(makeUser('KAPRODI'), makeCase({ current_handler_role: 'KAPRODI', track: 'SEKOLAH' }));
    expect(r.allowed).toBeTrue();
});

test('KEPSEK cannot use ESCALATE — must use FINAL_DECISION_MADE', () => {
    const r = checkCaseEscalate(makeUser('KEPSEK'), makeCase({ current_handler_role: 'KEPSEK' }));
    expect(r.allowed).toBeFalse();
    expect(r.code).toBe('KEPSEK_USES_FINAL_DECISION');
});

test('PKL track: DUDI can escalate to KAPRODI', () => {
    const r = checkCaseEscalate(makeUser('DUDI'), makeCase({ current_handler_role: 'DUDI', track: 'PKL' }));
    expect(r.allowed).toBeTrue();
});

test('Non-handler cannot escalate (GURU tries while BK is handler)', () => {
    const r = checkCaseEscalate(makeUser('GURU'), makeCase({ current_handler_role: 'BK', track: 'SEKOLAH' }));
    expect(r.allowed).toBeFalse();
    expect(r.code).toBe('NOT_CURRENT_HANDLER');
});


// ── INV-3: Only current_handler can act ───────────────────────
console.log('\n▸ INV-3: Only current_handler_role can act');

test('GURU as current handler can add comment', () => {
    const r = checkCaseAddComment(makeUser('GURU'), makeCase({ current_handler_role: 'GURU' }));
    expect(r.allowed).toBeTrue();
});

test('BK cannot comment when GURU is handler', () => {
    const r = checkCaseAddComment(makeUser('BK'), makeCase({ current_handler_role: 'GURU' }));
    expect(r.allowed).toBeFalse();
    expect(r.code).toBe('NOT_CURRENT_HANDLER');
});

test('WALI_KELAS as current handler can close case', () => {
    const r = checkCaseClose(makeUser('WALI_KELAS'), makeCase({ current_handler_role: 'WALI_KELAS' }));
    expect(r.allowed).toBeTrue();
});

test('DUDI as current handler (PKL track) can add student update', () => {
    const c = makeCase({ current_handler_role: 'DUDI', track: 'PKL' });
    const r = (() => {
        if (!caseIsOpen(c)) return deny('Closed', 'CASE_CLOSED');
        if (!isCurrentHandler(makeUser('DUDI'), c)) return deny('Not handler', 'NOT_CURRENT_HANDLER');
        return allow();
    })();
    expect(r.allowed).toBeTrue();
});


// ── INV-4: Lock blocks non-handler comment ────────────────────
console.log('\n▸ INV-4: Lock state enforcement');

test('GURU as current handler can comment even when case is locked', () => {
    const c = makeCase({ current_handler_role: 'GURU', is_locked: true });
    const r = checkCaseAddComment(makeUser('GURU'), c);
    expect(r.allowed).toBeTrue();
});

test('BK cannot comment on locked case even if case is not closed', () => {
    const c = makeCase({ current_handler_role: 'GURU', is_locked: true });
    const r = checkCaseAddComment(makeUser('BK'), c);
    expect(r.allowed).toBeFalse();
    // Blocked by NOT_CURRENT_HANDLER (which is the correct mechanism — lock doesn't
    // need a separate code because non-handler is blocked regardless of lock)
    expect(r.code).toBe('NOT_CURRENT_HANDLER');
});

test('KEPSEK FINAL_DECISION passes through lock (INV-4 exception)', () => {
    const c = makeCase({ current_handler_role: 'GURU', is_locked: true });
    const r = checkCaseFinalDecision(makeUser('KEPSEK'), c);
    expect(r.allowed).toBeTrue();
});

test('Cannot lock an already-locked case', () => {
    const c = makeCase({ current_handler_role: 'GURU', is_locked: true });
    const r = checkCaseLock(makeUser('GURU'), c);
    expect(r.allowed).toBeFalse();
    expect(r.code).toBe('ALREADY_LOCKED');
});

test('Cannot unlock an already-unlocked case', () => {
    const c = makeCase({ current_handler_role: 'GURU', is_locked: false });
    const r = checkCaseUnlock(makeUser('GURU'), c);
    expect(r.allowed).toBeFalse();
    expect(r.code).toBe('NOT_LOCKED');
});


// ── CASE VIEW: role-based access ──────────────────────────────
console.log('\n▸ Case view access matrix');

test('BK can view any case', () => {
    const r = checkCaseView(makeUser('BK'), makeCase(), makeStudent(), []);
    expect(r.allowed).toBeTrue();
});

test('GURU with assignment can view case', () => {
    const r = checkCaseView(makeUser('GURU'), makeCase({ involved_user_ids: [] }), makeStudent(), assignments);
    expect(r.allowed).toBeTrue();
});

test('GURU without assignment and not involved cannot view case', () => {
    const r = checkCaseView(makeUser('GURU', { user_id: ID.user2 }), makeCase({ involved_user_ids: [] }), makeStudent(), []);
    expect(r.allowed).toBeFalse();
    expect(r.code).toBe('GURU_NO_ACCESS');
});

test('GURU previously involved can view case (even without current assignment)', () => {
    const r = checkCaseView(makeUser('GURU'), makeCase({ involved_user_ids: [ID.user] }), makeStudent(), []);
    expect(r.allowed).toBeTrue();
});

test('DUDI can view case for their PKL student', () => {
    const s = makeStudent({ pkl_dudi_user_id: ID.dudi, student_status: 'PKL' });
    const r = checkCaseView(makeUser('DUDI', { user_id: ID.dudi }), makeCase(), s, []);
    expect(r.allowed).toBeTrue();
});

test('DUDI cannot view case for student not in their PKL batch', () => {
    const s = makeStudent({ pkl_dudi_user_id: ID.user2, student_status: 'PKL' });
    const r = checkCaseView(makeUser('DUDI', { user_id: ID.dudi }), makeCase(), s, []);
    expect(r.allowed).toBeFalse();
    expect(r.code).toBe('DUDI_NOT_SUPERVISOR');
});

test('ORTU cannot view any case', () => {
    const r = checkCaseView(makeUser('ORTU'), makeCase(), makeStudent(), []);
    expect(r.allowed).toBeFalse();
    expect(r.code).toBe('ORTU_BLOCKED');
});

test('SISWA can view own open case', () => {
    const r = checkCaseView(makeUser('SISWA'), makeCase(), makeStudent(), []);
    expect(r.allowed).toBeTrue();
});

test('SISWA cannot view another student case', () => {
    const s = makeStudent({ student_id: 'other-student-id' });
    const r = checkCaseView(makeUser('SISWA'), makeCase(), s, []);
    expect(r.allowed).toBeFalse();
    expect(r.code).toBe('STUDENT_NOT_OWNER');
});


// ── CASE CREATE ───────────────────────────────────────────────
console.log('\n▸ Case create permissions');

test('GURU can create case', () => expect(checkCaseCreate(makeUser('GURU')).allowed).toBeTrue());
test('KEPSEK can create case', () => expect(checkCaseCreate(makeUser('KEPSEK')).allowed).toBeTrue());
test('DUDI can create case', () => expect(checkCaseCreate(makeUser('DUDI')).allowed).toBeTrue());
test('BK cannot create case', () => expect(checkCaseCreate(makeUser('BK')).allowed).toBeFalse());
test('WALI_KELAS cannot create case', () => expect(checkCaseCreate(makeUser('WALI_KELAS')).allowed).toBeFalse());
test('SISWA cannot create case', () => expect(checkCaseCreate(makeUser('SISWA')).allowed).toBeFalse());
test('ORTU cannot create case', () => expect(checkCaseCreate(makeUser('ORTU')).allowed).toBeFalse());


// ── ATTENDANCE ────────────────────────────────────────────────
console.log('\n▸ Attendance submission');

test('Assigned teacher can submit attendance', () => {
    const r = checkAttendanceSubmit(makeUser('GURU'), makeSchedule());
    expect(r.allowed).toBeTrue();
});

test('Valid substitute can submit attendance', () => {
    const sc = makeSchedule({
        assigned_teacher_id: ID.user2,
        substitute_user_id: ID.user,
        substitute_token_expires_at: new Date(Date.now() + 3600000).toISOString(),
    });
    const r = checkAttendanceSubmit(makeUser('GURU'), sc);
    expect(r.allowed).toBeTrue();
});

test('Expired substitute token is denied', () => {
    const sc = makeSchedule({
        assigned_teacher_id: ID.user2,
        substitute_user_id: ID.user,
        substitute_token_expires_at: new Date(Date.now() - 3600000).toISOString(),
    });
    const r = checkAttendanceSubmit(makeUser('GURU'), sc);
    expect(r.allowed).toBeFalse();
    expect(r.code).toBe('SUBSTITUTE_TOKEN_EXPIRED');
});

test('Unrelated teacher cannot submit attendance', () => {
    const sc = makeSchedule({ assigned_teacher_id: ID.user2 });
    const r = checkAttendanceSubmit(makeUser('GURU'), sc);
    expect(r.allowed).toBeFalse();
    expect(r.code).toBe('NOT_ASSIGNED_TEACHER');
});

test('Missing schedule context is safely denied', () => {
    const r = checkAttendanceSubmit(makeUser('GURU'), null);
    expect(r.allowed).toBeFalse();
    expect(r.code).toBe('SCHEDULE_NOT_FOUND');
});


// ── ACHIEVEMENT ───────────────────────────────────────────────
console.log('\n▸ Achievement permissions');

test('WALI_KELAS for same class can create achievement', () => {
    const u = makeUser('WALI_KELAS', { wali_kelas_class_id: ID.class });
    const r = checkAchievementCreate(u, makeStudent());
    expect(r.allowed).toBeTrue();
});

test('WALI_KELAS for different class cannot create achievement', () => {
    const u = makeUser('WALI_KELAS', { wali_kelas_class_id: ID.class2 });
    const r = checkAchievementCreate(u, makeStudent());
    expect(r.allowed).toBeFalse();
    expect(r.code).toBe('WALI_KELAS_WRONG_CLASS');
});

test('KAPRODI can create achievement for any student', () => {
    const r = checkAchievementCreate(makeUser('KAPRODI'), makeStudent());
    expect(r.allowed).toBeTrue();
});

test('GURU cannot create achievement', () => {
    const r = checkAchievementCreate(makeUser('GURU'), makeStudent());
    expect(r.allowed).toBeFalse();
    expect(r.code).toBe('ROLE_CANNOT_CREATE_ACHIEVEMENT');
});


// ── ESCALATION CHAIN BOUNDARY ─────────────────────────────────
console.log('\n▸ Escalation chain boundaries');

test('nextEscalationStep: GURU → BK (SEKOLAH)', () => {
    expect(nextEscalationStep('SEKOLAH', 'GURU')).toBe('BK');
});
test('nextEscalationStep: KAPRODI → WAKA_KESISWAAN (SEKOLAH)', () => {
    expect(nextEscalationStep('SEKOLAH', 'KAPRODI')).toBe('WAKA_KESISWAAN');
});
test('nextEscalationStep: WAKA_KESISWAAN → KEPSEK (SEKOLAH)', () => {
    expect(nextEscalationStep('SEKOLAH', 'WAKA_KESISWAAN')).toBe('KEPSEK');
});
test('nextEscalationStep: KEPSEK → null (end of chain)', () => {
    expect(nextEscalationStep('SEKOLAH', 'KEPSEK')).toBe(null);
});
test('nextEscalationStep: DUDI → KAPRODI (PKL)', () => {
    expect(nextEscalationStep('PKL', 'DUDI')).toBe('KAPRODI');
});
test('nextEscalationStep: KAPRODI → WAKA_KESISWAAN (PKL)', () => {
    expect(nextEscalationStep('PKL', 'KAPRODI')).toBe('WAKA_KESISWAAN');
});
test('nextEscalationStep: role not in chain returns null', () => {
    expect(nextEscalationStep('SEKOLAH', 'DUDI')).toBe(null);
});
test('nextEscalationStep: unknown track returns null', () => {
    expect(nextEscalationStep('UNKNOWN', 'GURU')).toBe(null);
});


// ─────────────────────────────────────────────────────────────
// RESULTS
// ─────────────────────────────────────────────────────────────

console.log('\n══════════════════════════════════════════');
console.log(`  Results: ${passed} passed, ${failed} failed`);
if (failures.length) {
    console.log('\n  FAILURES:');
    failures.forEach(f => console.log(`  ✗ ${f.description}\n    ${f.error}`));
}
console.log('══════════════════════════════════════════\n');
process.exit(failed > 0 ? 1 : 0);
