/**
 * @file permission_engine.js
 * @module PermissionEngine
 * @version 1.0.0
 *
 * Offline-capable, pure permission checking engine.
 * No DOM, no network, no async. Runs in main thread and Service Worker.
 *
 * SINGLE SOURCE OF TRUTH for all client-side permission decisions.
 * Server-side enforcement is via RLS (06_rls_policies.sql).
 * This engine mirrors that logic for offline pre-flight checks.
 *
 * USAGE:
 *   import { checkPermission, ACTIONS } from './permission_engine.js';
 *
 *   const result = checkPermission(ACTIONS.CASE_ADD_COMMENT, userCtx, {
 *     case: caseCtx,
 *   });
 *
 *   if (!result.allowed) {
 *     showError(result.reason);
 *     return;
 *   }
 *
 * ─────────────────────────────────────────────────────────────
 * CONTEXT SHAPES (all fields required unless marked optional)
 * ─────────────────────────────────────────────────────────────
 *
 * UserContext:
 *   user_id               string  UUID
 *   role_type             string  one of ROLE_TYPE
 *   wali_kelas_class_id   string|null  UUID or null (TN-01)
 *   program_id            string|null  UUID or null
 *
 * CaseContext:
 *   case_id               string  UUID
 *   status                string  one of CASE_STATUS
 *   current_handler_role  string  one of ROLE_TYPE
 *   is_locked             boolean
 *   track                 string  'SEKOLAH' | 'PKL'
 *   student_id            string  UUID
 *   initiated_by_role     string  one of ROLE_TYPE
 *   involved_user_ids     string[]  UUIDs of users who authored any event
 *
 * StudentContext:
 *   student_id            string  UUID
 *   student_status        string  'AKTIF' | 'PKL' | 'LULUS' | 'KELUAR'
 *   class_id              string|null  current active enrollment class
 *   pkl_dudi_user_id      string|null  UUID of DUDI supervisor (if PKL)
 *
 * ScheduleContext:
 *   schedule_id           string  UUID
 *   class_id              string  UUID
 *   session_date          string  YYYY-MM-DD
 *   assigned_teacher_id   string  UUID
 *   substitute_user_id    string|null  UUID
 *   substitute_token_expires_at string|null  ISO timestamp
 *   meeting_status        string
 *
 * AssignmentContext:  (array of active assignments for current user)
 *   [ { class_id: string, subject_id: string } ]
 */

import {
    ROLE_TYPE,
    CASE_STATUS,
    CASE_EVENT_TYPES,
    ESCALATION_CHAIN,
    VISIBILITY_LEVEL,
} from './09_event_schema.js';


// ─────────────────────────────────────────────────────────────
// ACTIONS ENUM
// Every discrete action that requires a permission check.
// UI components and queue handlers reference these constants —
// never raw strings.
// ─────────────────────────────────────────────────────────────

export const ACTIONS = Object.freeze({
    // Case actions
    CASE_VIEW:               'CASE_VIEW',
    CASE_CREATE:             'CASE_CREATE',
    CASE_ADD_COMMENT:        'CASE_ADD_COMMENT',
    CASE_ESCALATE:           'CASE_ESCALATE',
    CASE_CLOSE:              'CASE_CLOSE',
    CASE_FINAL_DECISION:     'CASE_FINAL_DECISION',
    CASE_LOCK:               'CASE_LOCK',
    CASE_UNLOCK:             'CASE_UNLOCK',
    CASE_ADD_STUDENT_UPDATE: 'CASE_ADD_STUDENT_UPDATE',

    // Attendance actions
    ATTENDANCE_SUBMIT:       'ATTENDANCE_SUBMIT',
    ATTENDANCE_VIEW:         'ATTENDANCE_VIEW',

    // Observation actions
    OBSERVATION_CREATE:      'OBSERVATION_CREATE',
    OBSERVATION_VIEW_ALL:    'OBSERVATION_VIEW_ALL',      // staff: all visibility levels
    OBSERVATION_VIEW_PUBLIC: 'OBSERVATION_VIEW_PUBLIC',   // student: STUDENT_VISIBLE only

    // Achievement actions
    ACHIEVEMENT_CREATE:      'ACHIEVEMENT_CREATE',
    ACHIEVEMENT_VIEW:        'ACHIEVEMENT_VIEW',
    ACHIEVEMENT_VOID:        'ACHIEVEMENT_VOID',

    // Parent message actions
    PARENT_MSG_SEND:         'PARENT_MSG_SEND',           // ORTU only
    PARENT_MSG_REPLY:        'PARENT_MSG_REPLY',          // staff only
    PARENT_MSG_VIEW:         'PARENT_MSG_VIEW',

    // Journal actions
    JOURNAL_CREATE:          'JOURNAL_CREATE',
    JOURNAL_VIEW:            'JOURNAL_VIEW',

    // Dashboard actions
    DASHBOARD_KEPSEK:        'DASHBOARD_KEPSEK',
    DASHBOARD_GURU:          'DASHBOARD_GURU',
    DASHBOARD_STUDENT:       'DASHBOARD_STUDENT',
});


// ─────────────────────────────────────────────────────────────
// RESULT BUILDER
// ─────────────────────────────────────────────────────────────

/**
 * @typedef {{ allowed: boolean, reason: string, code: string }} PermissionResult
 */

function allow(reason = 'Permitted') {
    return { allowed: true, reason, code: 'ALLOWED' };
}

function deny(reason, code = 'DENIED') {
    return { allowed: false, reason, code };
}


// ─────────────────────────────────────────────────────────────
// PRIMITIVE CHECKERS
// Pure functions. Each takes minimal context.
// ─────────────────────────────────────────────────────────────

/**
 * True if the case is not CLOSED.
 */
function caseIsOpen(caseCtx) {
    return caseCtx.status !== CASE_STATUS.CLOSED;
}

/**
 * True if user's role matches the current handler role of the case.
 * INV-3: current_handler_role is always non-null for open cases.
 */
function isCurrentHandler(userCtx, caseCtx) {
    return caseCtx.current_handler_role === userCtx.role_type;
}

/**
 * True if user has ever been involved in this case:
 *   - created the case, OR
 *   - authored any event in the case
 * Maps to permission matrix footnote †
 */
function hasEverBeenInvolved(userCtx, caseCtx) {
    if (!Array.isArray(caseCtx.involved_user_ids)) return false;
    return caseCtx.involved_user_ids.includes(userCtx.user_id);
}

/**
 * True if GURU user has an active teaching assignment
 * for the class the student is enrolled in.
 * Maps to permission matrix footnote †
 */
function hasAssignmentForStudent(userCtx, studentCtx, assignmentCtx) {
    if (!Array.isArray(assignmentCtx)) return false;
    if (!studentCtx?.class_id) return false;
    return assignmentCtx.some(a => a.class_id === studentCtx.class_id);
}

/**
 * True if DUDI user supervises this student's PKL placement.
 * Maps to permission matrix footnote ‡
 */
function dudiSupervisesStudent(userCtx, studentCtx) {
    return (
        userCtx.role_type === ROLE_TYPE.DUDI &&
        studentCtx?.pkl_dudi_user_id === userCtx.user_id
    );
}

/**
 * True if user is the Wali Kelas for the student's current class.
 */
function isWaliKelasForStudent(userCtx, studentCtx) {
    return (
        userCtx.wali_kelas_class_id !== null &&
        userCtx.wali_kelas_class_id === studentCtx?.class_id
    );
}

/**
 * True if the substitute token for a schedule is valid (not expired)
 * and belongs to the current user.
 */
function hasValidSubstituteToken(userCtx, scheduleCtx) {
    if (!scheduleCtx) return false;
    if (scheduleCtx.substitute_user_id !== userCtx.user_id) return false;
    if (!scheduleCtx.substitute_token_expires_at) return false;
    return new Date(scheduleCtx.substitute_token_expires_at) > new Date();
}

/**
 * True if user is assigned teacher for this schedule.
 */
function isAssignedTeacher(userCtx, scheduleCtx) {
    return scheduleCtx?.assigned_teacher_id === userCtx.user_id;
}

/**
 * PENUNTUN (advisory): peran "berikutnya yang disarankan" di rantai — untuk
 * saran UI saja. Sejak desain Langkah A (mig 20260703250000) eskalasi antar-
 * internal BEBAS (tak dibatasi urutan ini); penegakan sesungguhnya di server
 * (target wajib peran internal; DUDI hanya -> KAPRODI). Null bila di ujung.
 */
function nextEscalationStep(track, currentHandlerRole) {
    const chain = ESCALATION_CHAIN[track];
    if (!chain) return null;
    const idx = chain.indexOf(currentHandlerRole);
    if (idx === -1 || idx === chain.length - 1) return null;
    return chain[idx + 1];
}


// ─────────────────────────────────────────────────────────────
// CASE PERMISSION CHECKS
// ─────────────────────────────────────────────────────────────

function checkCaseView(userCtx, caseCtx, studentCtx, assignmentCtx) {
    const role = userCtx.role_type;

    // CLOSED cases: student can view their own (§)
    if (caseCtx.status === CASE_STATUS.CLOSED) {
        if (role === ROLE_TYPE.SISWA && caseCtx.student_id === studentCtx?.student_id) {
            return allow('Siswa dapat melihat kasus yang sudah ditutup');
        }
    }

    // Admin roles: always
    if ([ROLE_TYPE.BK, ROLE_TYPE.WALI_KELAS, ROLE_TYPE.KAPRODI, ROLE_TYPE.KEPSEK]
            .includes(role)) {
        return allow();
    }

    // GURU: must have assignment for student's class OR have been involved
    if (role === ROLE_TYPE.GURU) {
        if (hasEverBeenInvolved(userCtx, caseCtx)) return allow('Pernah terlibat dalam kasus');
        if (hasAssignmentForStudent(userCtx, studentCtx, assignmentCtx)) {
            return allow('Memiliki assignment untuk kelas siswa ini');
        }
        return deny(
            'Guru hanya dapat melihat kasus siswa yang diajarnya atau kasus yang pernah melibatkannya',
            'GURU_NO_ACCESS'
        );
    }

    // DUDI: only their PKL students (‡)
    if (role === ROLE_TYPE.DUDI) {
        if (dudiSupervisesStudent(userCtx, studentCtx)) return allow();
        return deny('DUDI hanya dapat melihat kasus siswa PKL yang dibimbingnya', 'DUDI_NOT_SUPERVISOR');
    }

    // SISWA: own cases only (§), non-closed only here (closed handled above)
    if (role === ROLE_TYPE.SISWA) {
        if (caseCtx.student_id === studentCtx?.student_id) return allow();
        return deny('Siswa hanya dapat melihat kasusnya sendiri', 'STUDENT_NOT_OWNER');
    }

    // ORTU: blocked entirely
    if (role === ROLE_TYPE.ORTU) {
        return deny('Orang tua tidak memiliki akses ke detail kasus', 'ORTU_BLOCKED');
    }

    return deny('Role tidak dikenali', 'UNKNOWN_ROLE');
}


function checkCaseCreate(userCtx) {
    const role = userCtx.role_type;
    if ([ROLE_TYPE.GURU, ROLE_TYPE.KEPSEK, ROLE_TYPE.DUDI].includes(role)) {
        return allow();
    }
    return deny(
        `Role '${role}' tidak dapat membuat kasus baru. Hanya GURU, KEPSEK, atau DUDI.`,
        'ROLE_CANNOT_CREATE_CASE'
    );
}


function checkCaseAddComment(userCtx, caseCtx) {
    // INV-1
    if (!caseIsOpen(caseCtx)) {
        return deny('Kasus sudah ditutup. Tidak dapat menambahkan komentar.', 'CASE_CLOSED');
    }

    const role = userCtx.role_type;

    // Must be a role that participates in cases
    const participatingRoles = [
        ROLE_TYPE.GURU, ROLE_TYPE.BK, ROLE_TYPE.WALI_KELAS,
        ROLE_TYPE.KAPRODI, ROLE_TYPE.KEPSEK, ROLE_TYPE.DUDI,
    ];
    if (!participatingRoles.includes(role)) {
        return deny(`Role '${role}' tidak dapat menambahkan komentar ke kasus`, 'ROLE_CANNOT_COMMENT');
    }

    // Must be current handler
    if (!isCurrentHandler(userCtx, caseCtx)) {
        return deny(
            `Hanya current handler (${caseCtx.current_handler_role}) yang dapat menambahkan komentar saat ini`,
            'NOT_CURRENT_HANDLER'
        );
    }

    // INV-4: lock check — current handler can still comment even when locked
    // (lock blocks OTHER roles, not current handler)
    // So if we reach here, we're current handler — lock does not block us.

    return allow('Current handler dapat menambahkan komentar');
}


function checkCaseEscalate(userCtx, caseCtx) {
    // INV-1
    if (!caseIsOpen(caseCtx)) {
        return deny('Kasus sudah ditutup. Tidak dapat eskalasi.', 'CASE_CLOSED');
    }

    // KEPSEK tidak eskalasi — mereka pakai FINAL_DECISION_MADE
    if (userCtx.role_type === ROLE_TYPE.KEPSEK) {
        return deny('Kepsek tidak melakukan eskalasi. Gunakan Keputusan Final.', 'KEPSEK_USES_FINAL_DECISION');
    }

    // Must be current handler
    if (!isCurrentHandler(userCtx, caseCtx)) {
        return deny(
            `Hanya current handler (${caseCtx.current_handler_role}) yang dapat mengeskalasi kasus`,
            'NOT_CURRENT_HANDLER'
        );
    }

    // Check there is a next step in chain (TN-05)
    const next = nextEscalationStep(caseCtx.track, caseCtx.current_handler_role);
    if (!next) {
        return deny(
            `Tidak ada langkah eskalasi berikutnya untuk track '${caseCtx.track}'. ` +
            `Gunakan Tutup Kasus atau Keputusan Final (Kepsek).`,
            'NO_NEXT_ESCALATION_STEP'
        );
    }

    return allow(`Dapat eskalasi ke ${next}`);
}


function checkCaseClose(userCtx, caseCtx) {
    // INV-1
    if (!caseIsOpen(caseCtx)) {
        return deny('Kasus sudah ditutup.', 'CASE_CLOSED');
    }

    // Must be current handler
    if (!isCurrentHandler(userCtx, caseCtx)) {
        return deny(
            `Hanya current handler (${caseCtx.current_handler_role}) yang dapat menutup kasus`,
            'NOT_CURRENT_HANDLER'
        );
    }

    return allow('Current handler dapat menutup kasus');
}


function checkCaseFinalDecision(userCtx, caseCtx) {
    // Only KEPSEK
    if (userCtx.role_type !== ROLE_TYPE.KEPSEK) {
        return deny('Hanya Kepala Sekolah yang dapat membuat Keputusan Final', 'NOT_KEPSEK');
    }

    // INV-1: cannot act on CLOSED
    if (!caseIsOpen(caseCtx)) {
        return deny('Kasus sudah ditutup. Keputusan Final tidak dapat dilakukan.', 'CASE_CLOSED');
    }

    // Passes regardless of is_locked (INV-4 exception for KEPSEK)
    return allow('Kepala Sekolah dapat membuat Keputusan Final kapan saja selama kasus belum ditutup');
}


function checkCaseLock(userCtx, caseCtx) {
    if (!caseIsOpen(caseCtx)) {
        return deny('Kasus sudah ditutup.', 'CASE_CLOSED');
    }

    if (caseCtx.is_locked) {
        return deny('Kasus sudah terkunci. Gunakan Buka Kunci terlebih dahulu.', 'ALREADY_LOCKED');
    }

    if (!isCurrentHandler(userCtx, caseCtx)) {
        return deny(
            `Hanya current handler (${caseCtx.current_handler_role}) yang dapat mengunci kasus`,
            'NOT_CURRENT_HANDLER'
        );
    }

    return allow();
}


function checkCaseUnlock(userCtx, caseCtx) {
    if (!caseIsOpen(caseCtx)) {
        return deny('Kasus sudah ditutup.', 'CASE_CLOSED');
    }

    if (!caseCtx.is_locked) {
        return deny('Kasus tidak dalam kondisi terkunci.', 'NOT_LOCKED');
    }

    if (!isCurrentHandler(userCtx, caseCtx)) {
        return deny(
            `Hanya current handler (${caseCtx.current_handler_role}) yang dapat membuka kunci kasus`,
            'NOT_CURRENT_HANDLER'
        );
    }

    return allow();
}


function checkCaseAddStudentUpdate(userCtx, caseCtx) {
    if (!caseIsOpen(caseCtx)) {
        return deny('Kasus sudah ditutup.', 'CASE_CLOSED');
    }

    if (!isCurrentHandler(userCtx, caseCtx)) {
        return deny(
            `Hanya current handler (${caseCtx.current_handler_role}) yang dapat menambahkan update untuk siswa`,
            'NOT_CURRENT_HANDLER'
        );
    }

    return allow();
}


// ─────────────────────────────────────────────────────────────
// ATTENDANCE PERMISSION CHECKS
// ─────────────────────────────────────────────────────────────

function checkAttendanceSubmit(userCtx, scheduleCtx) {
    if (!scheduleCtx) {
        return deny('Jadwal tidak ditemukan.', 'SCHEDULE_NOT_FOUND');
    }

    // Assigned teacher
    if (isAssignedTeacher(userCtx, scheduleCtx)) {
        return allow('Guru yang bertugas dapat mengisi absensi');
    }

    // Valid substitute
    if (hasValidSubstituteToken(userCtx, scheduleCtx)) {
        return allow('Guru pengganti dengan token aktif dapat mengisi absensi');
    }

    // Substitute token exists but expired
    if (scheduleCtx.substitute_user_id === userCtx.user_id &&
        scheduleCtx.substitute_token_expires_at &&
        new Date(scheduleCtx.substitute_token_expires_at) <= new Date()) {
        return deny(
            'Token guru pengganti sudah kedaluwarsa. Hubungi admin untuk pembaruan.',
            'SUBSTITUTE_TOKEN_EXPIRED'
        );
    }

    return deny(
        'Hanya guru yang bertugas atau guru pengganti yang dapat mengisi absensi untuk jadwal ini',
        'NOT_ASSIGNED_TEACHER'
    );
}


function checkAttendanceView(userCtx) {
    const role = userCtx.role_type;

    if ([ROLE_TYPE.GURU, ROLE_TYPE.BK, ROLE_TYPE.WALI_KELAS,
         ROLE_TYPE.KAPRODI, ROLE_TYPE.KEPSEK].includes(role)) {
        return allow();
    }

    // SISWA: can view own (checked at query level, this is role-level gate)
    if (role === ROLE_TYPE.SISWA) return allow('Siswa dapat melihat absensi dirinya sendiri');

    return deny('Role ini tidak memiliki akses ke data absensi', 'ROLE_CANNOT_VIEW_ATTENDANCE');
}


// ─────────────────────────────────────────────────────────────
// OBSERVATION PERMISSION CHECKS
// ─────────────────────────────────────────────────────────────

function checkObservationCreate(userCtx) {
    const role = userCtx.role_type;
    if ([ROLE_TYPE.GURU, ROLE_TYPE.WALI_KELAS, ROLE_TYPE.BK,
         ROLE_TYPE.KAPRODI, ROLE_TYPE.KEPSEK].includes(role)) {
        return allow();
    }
    return deny(
        `Role '${role}' tidak dapat membuat observasi`,
        'ROLE_CANNOT_CREATE_OBSERVATION'
    );
}

function checkObservationViewAll(userCtx) {
    const role = userCtx.role_type;
    if ([ROLE_TYPE.GURU, ROLE_TYPE.BK, ROLE_TYPE.WALI_KELAS,
         ROLE_TYPE.KAPRODI, ROLE_TYPE.KEPSEK].includes(role)) {
        return allow();
    }
    return deny('Akses ditolak', 'ROLE_CANNOT_VIEW_ALL_OBSERVATIONS');
}

function checkObservationViewPublic(userCtx) {
    // SISWA melihat STUDENT_VISIBLE observations miliknya (difilter di query level)
    if (userCtx.role_type === ROLE_TYPE.SISWA) return allow();
    return deny('Endpoint ini hanya untuk siswa', 'NOT_STUDENT');
}


// ─────────────────────────────────────────────────────────────
// ACHIEVEMENT PERMISSION CHECKS
// ─────────────────────────────────────────────────────────────

function checkAchievementCreate(userCtx, studentCtx) {
    const role = userCtx.role_type;

    if ([ROLE_TYPE.KAPRODI, ROLE_TYPE.KEPSEK].includes(role)) return allow();

    if (role === ROLE_TYPE.WALI_KELAS) {
        if (isWaliKelasForStudent(userCtx, studentCtx)) {
            return allow('Wali Kelas dapat mencatat prestasi siswa di kelasnya');
        }
        return deny(
            'Wali Kelas hanya dapat mencatat prestasi siswa di kelasnya sendiri',
            'WALI_KELAS_WRONG_CLASS'
        );
    }

    return deny(
        `Role '${role}' tidak dapat mencatat prestasi. Hanya Wali Kelas, Kaprodi, atau Kepsek.`,
        'ROLE_CANNOT_CREATE_ACHIEVEMENT'
    );
}

function checkAchievementView(userCtx) {
    const role = userCtx.role_type;
    // All staff + SISWA (own, filtered at query)
    if ([ROLE_TYPE.GURU, ROLE_TYPE.BK, ROLE_TYPE.WALI_KELAS,
         ROLE_TYPE.KAPRODI, ROLE_TYPE.KEPSEK, ROLE_TYPE.SISWA].includes(role)) {
        return allow();
    }
    return deny('Role ini tidak memiliki akses ke data prestasi', 'ROLE_CANNOT_VIEW_ACHIEVEMENTS');
}

function checkAchievementVoid(userCtx) {
    if ([ROLE_TYPE.KAPRODI, ROLE_TYPE.KEPSEK].includes(userCtx.role_type)) {
        return allow();
    }
    return deny('Hanya Kaprodi atau Kepsek yang dapat membatalkan pencatatan prestasi', 'ROLE_CANNOT_VOID');
}


// ─────────────────────────────────────────────────────────────
// PARENT MESSAGE PERMISSION CHECKS
// ─────────────────────────────────────────────────────────────

function checkParentMsgSend(userCtx) {
    if (userCtx.role_type === ROLE_TYPE.ORTU) return allow();
    return deny('Hanya orang tua yang dapat mengirim pesan', 'NOT_ORTU');
}

function checkParentMsgReply(userCtx) {
    const role = userCtx.role_type;
    if ([ROLE_TYPE.GURU, ROLE_TYPE.BK, ROLE_TYPE.WALI_KELAS,
         ROLE_TYPE.KAPRODI, ROLE_TYPE.KEPSEK].includes(role)) {
        return allow();
    }
    return deny('Role ini tidak dapat membalas pesan orang tua', 'ROLE_CANNOT_REPLY');
}

function checkParentMsgView(userCtx) {
    // Visibility is enforced per-row by visible_to_user_ids (TN-08).
    // This check is role-level gate only.
    const role = userCtx.role_type;
    if (role === ROLE_TYPE.ORTU) return allow('Orang tua dapat melihat pesan yang ditujukan untuknya');
    if ([ROLE_TYPE.GURU, ROLE_TYPE.BK, ROLE_TYPE.WALI_KELAS,
         ROLE_TYPE.KAPRODI, ROLE_TYPE.KEPSEK].includes(role)) {
        return allow('Staf dapat melihat pesan yang ditujukan untuknya');
    }
    return deny('Role ini tidak memiliki akses ke pesan orang tua', 'ROLE_CANNOT_VIEW_MESSAGES');
}


// ─────────────────────────────────────────────────────────────
// JOURNAL PERMISSION CHECKS
// ─────────────────────────────────────────────────────────────

function checkJournalCreate(userCtx) {
    if ([ROLE_TYPE.GURU, ROLE_TYPE.WALI_KELAS].includes(userCtx.role_type)) return allow();
    return deny('Hanya guru yang dapat membuat jurnal mengajar', 'ROLE_CANNOT_CREATE_JOURNAL');
}

function checkJournalView(userCtx) {
    // Journal is strictly private — owner only (enforced at query level).
    // Role gate: only GURU roles can have journals.
    if ([ROLE_TYPE.GURU, ROLE_TYPE.WALI_KELAS].includes(userCtx.role_type)) return allow();
    return deny('Jurnal hanya dapat dilihat oleh pemiliknya sendiri', 'ROLE_CANNOT_VIEW_JOURNAL');
}


// ─────────────────────────────────────────────────────────────
// DASHBOARD PERMISSION CHECKS
// ─────────────────────────────────────────────────────────────

function checkDashboardKepsek(userCtx) {
    if (userCtx.role_type === ROLE_TYPE.KEPSEK) return allow();
    return deny('Dashboard Kepala Sekolah hanya untuk Kepsek', 'NOT_KEPSEK');
}

function checkDashboardGuru(userCtx) {
    if ([ROLE_TYPE.GURU, ROLE_TYPE.WALI_KELAS, ROLE_TYPE.BK,
         ROLE_TYPE.KAPRODI, ROLE_TYPE.KEPSEK].includes(userCtx.role_type)) {
        return allow();
    }
    return deny('Akses dashboard guru tidak tersedia untuk role ini', 'ROLE_NO_GURU_DASHBOARD');
}

function checkDashboardStudent(userCtx) {
    if (userCtx.role_type === ROLE_TYPE.SISWA) return allow();
    return deny('Dashboard siswa hanya untuk siswa', 'NOT_STUDENT');
}


// ─────────────────────────────────────────────────────────────
// MAIN DISPATCH TABLE
// Maps each ACTION to its checker function signature.
// Keeps checkPermission() clean — add new actions here only.
// ─────────────────────────────────────────────────────────────

/**
 * @typedef {Object} ResourceContext
 * @property {Object}   [case]        CaseContext
 * @property {Object}   [student]     StudentContext
 * @property {Object}   [schedule]    ScheduleContext
 * @property {Array}    [assignments] AssignmentContext[]
 */

const DISPATCH = {
    [ACTIONS.CASE_VIEW]:
        (u, r) => checkCaseView(u, r.case, r.student, r.assignments),

    [ACTIONS.CASE_CREATE]:
        (u)    => checkCaseCreate(u),

    [ACTIONS.CASE_ADD_COMMENT]:
        (u, r) => checkCaseAddComment(u, r.case),

    [ACTIONS.CASE_ESCALATE]:
        (u, r) => checkCaseEscalate(u, r.case),

    [ACTIONS.CASE_CLOSE]:
        (u, r) => checkCaseClose(u, r.case),

    [ACTIONS.CASE_FINAL_DECISION]:
        (u, r) => checkCaseFinalDecision(u, r.case),

    [ACTIONS.CASE_LOCK]:
        (u, r) => checkCaseLock(u, r.case),

    [ACTIONS.CASE_UNLOCK]:
        (u, r) => checkCaseUnlock(u, r.case),

    [ACTIONS.CASE_ADD_STUDENT_UPDATE]:
        (u, r) => checkCaseAddStudentUpdate(u, r.case),

    [ACTIONS.ATTENDANCE_SUBMIT]:
        (u, r) => checkAttendanceSubmit(u, r.schedule),

    [ACTIONS.ATTENDANCE_VIEW]:
        (u)    => checkAttendanceView(u),

    [ACTIONS.OBSERVATION_CREATE]:
        (u)    => checkObservationCreate(u),

    [ACTIONS.OBSERVATION_VIEW_ALL]:
        (u)    => checkObservationViewAll(u),

    [ACTIONS.OBSERVATION_VIEW_PUBLIC]:
        (u)    => checkObservationViewPublic(u),

    [ACTIONS.ACHIEVEMENT_CREATE]:
        (u, r) => checkAchievementCreate(u, r.student),

    [ACTIONS.ACHIEVEMENT_VIEW]:
        (u)    => checkAchievementView(u),

    [ACTIONS.ACHIEVEMENT_VOID]:
        (u)    => checkAchievementVoid(u),

    [ACTIONS.PARENT_MSG_SEND]:
        (u)    => checkParentMsgSend(u),

    [ACTIONS.PARENT_MSG_REPLY]:
        (u)    => checkParentMsgReply(u),

    [ACTIONS.PARENT_MSG_VIEW]:
        (u)    => checkParentMsgView(u),

    [ACTIONS.JOURNAL_CREATE]:
        (u)    => checkJournalCreate(u),

    [ACTIONS.JOURNAL_VIEW]:
        (u)    => checkJournalView(u),

    [ACTIONS.DASHBOARD_KEPSEK]:
        (u)    => checkDashboardKepsek(u),

    [ACTIONS.DASHBOARD_GURU]:
        (u)    => checkDashboardGuru(u),

    [ACTIONS.DASHBOARD_STUDENT]:
        (u)    => checkDashboardStudent(u),
};


// ─────────────────────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────────────────────

/**
 * Check whether a user is permitted to perform an action.
 *
 * @param {string}          action      — one of ACTIONS
 * @param {Object}          userCtx     — UserContext
 * @param {ResourceContext} [resourceCtx={}]
 * @returns {PermissionResult}
 */
export function checkPermission(action, userCtx, resourceCtx = {}) {
    // Guard: unknown action
    if (!DISPATCH[action]) {
        return deny(`Action '${action}' tidak terdaftar di permission engine`, 'UNKNOWN_ACTION');
    }

    // Guard: userCtx must be present and valid
    if (!userCtx || !userCtx.user_id || !userCtx.role_type) {
        return deny('User context tidak valid atau tidak lengkap', 'INVALID_USER_CONTEXT');
    }

    // Guard: inactive user
    if (userCtx.is_active === false) {
        return deny('Akun pengguna tidak aktif', 'USER_INACTIVE');
    }

    try {
        return DISPATCH[action](userCtx, resourceCtx);
    } catch (err) {
        // Defensive: checker threw — fail closed
        return deny(
            `Internal permission check error untuk action '${action}': ${err.message}`,
            'PERMISSION_CHECK_ERROR'
        );
    }
}


/**
 * Check multiple actions at once.
 * Useful for rendering a full action bar where multiple buttons
 * need to be shown/hidden simultaneously.
 *
 * @param {string[]}        actions
 * @param {Object}          userCtx
 * @param {ResourceContext} [resourceCtx={}]
 * @returns {Object.<string, PermissionResult>}
 */
export function checkBulk(actions, userCtx, resourceCtx = {}) {
    const results = {};
    for (const action of actions) {
        results[action] = checkPermission(action, userCtx, resourceCtx);
    }
    return results;
}


/**
 * Returns the set of valid next escalation steps for a case,
 * given the current user and case context.
 * Returns null if escalation is not permitted at all.
 *
 * Used by UI to show the escalation target in the button label:
 *   "Eskalasi ke BK" instead of just "Eskalasi"
 *
 * @param {Object} userCtx
 * @param {Object} caseCtx
 * @returns {{ nextRole: string|null, permitted: boolean, reason: string }}
 */
export function getEscalationTarget(userCtx, caseCtx) {
    const permResult = checkPermission(ACTIONS.CASE_ESCALATE, userCtx, { case: caseCtx });
    if (!permResult.allowed) {
        return { nextRole: null, permitted: false, reason: permResult.reason };
    }
    const nextRole = nextEscalationStep(caseCtx.track, caseCtx.current_handler_role);
    return { nextRole, permitted: true, reason: `Eskalasi ke ${nextRole}` };
}


/**
 * Derives the visible section of a case's event timeline
 * for a given user role.
 *
 * Returns a filter function to apply to the event list:
 *   events.filter(visibilityFilter(userCtx))
 *
 * @param {Object} userCtx
 * @returns {Function}  (event: CaseEvent) => boolean
 */
export function caseEventVisibilityFilter(userCtx) {
    const role = userCtx.role_type;

    // KEPSEK sees everything
    if (role === ROLE_TYPE.KEPSEK) return () => true;

    // SISWA sees only STUDENT_VISIBLE
    if (role === ROLE_TYPE.SISWA) {
        return (event) => event.privacy_level === VISIBILITY_LEVEL.STUDENT_VISIBLE;
    }

    // All other staff: see INTERNAL_SCHOOL and STUDENT_VISIBLE, not PRIVATE
    // (PRIVATE events do not currently exist in schema, but guarded for future use)
    return (event) => event.privacy_level !== VISIBILITY_LEVEL.PRIVATE;
}


/**
 * Computes the complete set of actions available for a case,
 * for use in rendering the full case action bar.
 *
 * @param {Object} userCtx
 * @param {Object} caseCtx
 * @returns {Object.<string, PermissionResult>}
 */
export function getCaseActions(userCtx, caseCtx) {
    return checkBulk([
        ACTIONS.CASE_ADD_COMMENT,
        ACTIONS.CASE_ESCALATE,
        ACTIONS.CASE_CLOSE,
        ACTIONS.CASE_FINAL_DECISION,
        ACTIONS.CASE_LOCK,
        ACTIONS.CASE_UNLOCK,
        ACTIONS.CASE_ADD_STUDENT_UPDATE,
    ], userCtx, { case: caseCtx });
}
