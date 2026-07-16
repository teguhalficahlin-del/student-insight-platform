/**
 * @file _shared/validate.ts
 *
 * Payload validators for Edge Functions.
 * Deno/TypeScript port of the field validators in event_schema.js.
 *
 * These are intentionally simple — no external schema libraries.
 * The schema is small and stable; hand-written validators are
 * more readable and easier to maintain for a solo dev.
 *
 * Usage:
 *   const result = validatePayload(ATTENDANCE_BATCH_SCHEMA, body);
 *   if (!result.valid) return badRequest('Payload tidak valid', result.errors);
 */

// ─────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────

type FieldValidator = (value: unknown, field: string) => string | null;
type FieldDef       = [string, FieldValidator, required?: boolean];

export interface ValidationResult {
    valid:  boolean;
    errors: string[];
}


// ─────────────────────────────────────────────────────────────
// PRIMITIVE VALIDATORS
// Each returns null (valid) or an error string (invalid).
// ─────────────────────────────────────────────────────────────

export const V = {
    uuid: (v: unknown, f: string): string | null =>
        typeof v === 'string' &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
            ? null
            : `${f} harus berupa UUID yang valid, diterima: ${JSON.stringify(v)}`,

    str: (min = 1, max = Infinity) =>
        (v: unknown, f: string): string | null =>
            typeof v === 'string' && v.trim().length >= min && v.length <= max
                ? null
                : `${f} harus berupa string (min ${min}, max ${max} karakter)`,

    enum: (values: readonly string[]) =>
        (v: unknown, f: string): string | null =>
            values.includes(v as string)
                ? null
                : `${f} harus salah satu dari [${values.join(', ')}], diterima: ${JSON.stringify(v)}`,

    isoDate: (v: unknown, f: string): string | null => {
        if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || isNaN(Date.parse(v))) {
            return `${f} harus berupa tanggal ISO (YYYY-MM-DD), diterima: ${JSON.stringify(v)}`;
        }
        return null;
    },

    bool: (v: unknown, f: string): string | null =>
        typeof v === 'boolean'
            ? null
            : `${f} harus berupa boolean, diterima: ${JSON.stringify(v)}`,

    positiveInt: (v: unknown, f: string): string | null =>
        Number.isInteger(v) && (v as number) > 0
            ? null
            : `${f} harus berupa bilangan bulat positif, diterima: ${JSON.stringify(v)}`,

    nonNegInt: (v: unknown, f: string): string | null =>
        Number.isInteger(v) && (v as number) >= 0
            ? null
            : `${f} harus berupa bilangan bulat >= 0, diterima: ${JSON.stringify(v)}`,

    arrayOf: (itemValidator: FieldValidator, minLen = 1) =>
        (v: unknown, f: string): string | null => {
            if (!Array.isArray(v)) return `${f} harus berupa array`;
            if (v.length < minLen) return `${f} harus memiliki minimal ${minLen} item`;
            const errors: string[] = [];
            v.forEach((item, i) => {
                const err = itemValidator(item, `${f}[${i}]`);
                if (err) errors.push(err);
            });
            return errors.length ? errors.join('; ') : null;
        },
};


// ─────────────────────────────────────────────────────────────
// VALIDATE PAYLOAD
// Runs all field validators against a parsed JSON body.
// ─────────────────────────────────────────────────────────────

/**
 * @param schema  Array of [fieldName, validator, isRequired=true]
 * @param data    Parsed request body (already JSON.parsed)
 */
export function validatePayload(
    schema: FieldDef[],
    data:   Record<string, unknown>,
): ValidationResult {
    const errors: string[] = [];

    if (!data || typeof data !== 'object' || Array.isArray(data)) {
        return { valid: false, errors: ['Request body harus berupa JSON object'] };
    }

    for (const [field, validator, required = true] of schema) {
        const present = field in data && data[field] !== null && data[field] !== undefined;

        if (!present) {
            if (required) errors.push(`Field wajib tidak ada: ${field}`);
            continue; // skip validation for missing optional fields
        }

        const err = validator(data[field], field);
        if (err) errors.push(err);
    }

    return { valid: errors.length === 0, errors };
}


// ─────────────────────────────────────────────────────────────
// ENUM CONSTANTS
// Mirror of Postgres enums and event_schema.js.
// ─────────────────────────────────────────────────────────────

export const ATTENDANCE_STATUS  = ['HADIR','ALPA','IZIN','SAKIT'] as const;  // EKSKUL dihapus (mig 20260703220000); TIDAK_HADIR → ALPA (mig 20260716164801)
export const ATTENDANCE_SOURCE  = ['AUTO_DETECTED','MANUAL_OVERRIDE','TEACHER_DECLARED'] as const;
export const MEETING_STATUS     = ['NORMAL','KEGIATAN_SEKOLAH','GURU_TIDAK_HADIR'] as const;
export const ROLE_TYPE          = ['GURU','BK','WALI_KELAS','KAPRODI','KEPSEK','WAKA_KURIKULUM','WAKA_KESISWAAN','WAKA_HUMAS','STAKEHOLDER','DUDI','SISWA','ORTU','ADMINISTRATIVE'] as const;
export const CASE_STATUS        = ['OPEN','UNDER_REVIEW','INTERVENTION','MONITORING','CLOSED'] as const;
export const CASE_TRACK         = ['SEKOLAH','PKL'] as const;
export const CASE_AUDIENCE      = ['PRIVATE','RESTRICTED','PUBLIC'] as const;

// Peran yang boleh jadi target eskalasi (internal kasus + WAKA_HUMAS untuk jalur PKL)
export const INTERNAL_CASE_ROLES = ['GURU','BK','WALI_KELAS','KAPRODI','WAKA_KESISWAAN','WAKA_HUMAS','KEPSEK'] as const;

/**
 * Validasi aturan eskalasi di lapisan edge (pertahanan berlapis).
 * - Target harus peran internal kasus
 * - DUDI hanya boleh ke KAPRODI
 * Returns error string atau null jika valid.
 */
export function validateEscalationTarget(
    authorRole: string,
    newHandlerRole: string,
    caseTrack?: string,
): string | null {
    if (!(INTERNAL_CASE_ROLES as readonly string[]).includes(newHandlerRole)) {
        return `Target eskalasi tidak valid: ${newHandlerRole}. Harus salah satu dari [${INTERNAL_CASE_ROLES.join(', ')}]`;
    }
    if (authorRole === 'DUDI' && newHandlerRole !== 'KAPRODI') {
        return 'DUDI hanya dapat meneruskan kasus ke KAPRODI';
    }
    // KAPRODI hanya bisa eskalasi ke WAKA_HUMAS jika kasus PKL
    if (authorRole === 'KAPRODI' && newHandlerRole === 'WAKA_HUMAS' && caseTrack !== 'PKL') {
        return 'Eskalasi ke WAKA_HUMAS hanya untuk kasus jalur PKL';
    }
    // WAKA_HUMAS tidak bisa jadi target eskalasi kasus non-PKL
    if (newHandlerRole === 'WAKA_HUMAS' && caseTrack !== 'PKL') {
        return 'WAKA_HUMAS hanya menangani kasus jalur PKL';
    }
    return null;
}

/**
 * Validasi aturan audiens di lapisan edge.
 * DUDI selalu PRIVATE, tidak boleh ubah ke lain.
 */
export function validateAudienceForRole(
    authorRole: string,
    audience: string,
): string | null {
    if (authorRole === 'DUDI' && audience !== 'PRIVATE') {
        return 'DUDI hanya dapat membuat kasus dengan audiens PRIVATE';
    }
    return null;
}
export const VISIBILITY_LEVEL   = ['PRIVATE','RESTRICTED','PUBLIC','INTERNAL_SCHOOL','STUDENT_VISIBLE','SISWA_SAJA','ORTU_SAJA','SISWA_DAN_ORTU'] as const;
export const OBSERVATION_SENTIMENT  = ['POSITIF','NEGATIF'] as const;
export const OBSERVATION_DIMENSION  = ['AKADEMIK','KEHADIRAN','PERILAKU','SOSIAL','AFEKTIF','BAKAT_MINAT','FISIK','LAINNYA'] as const;


// ─────────────────────────────────────────────────────────────
// ATTENDANCE BATCH SCHEMA
// ─────────────────────────────────────────────────────────────

/** Validator for a single attendance record within the batch */
function validateAttendanceRecord(v: unknown, f: string): string | null {
    if (!v || typeof v !== 'object' || Array.isArray(v)) {
        return `${f} harus berupa object`;
    }
    const rec = v as Record<string, unknown>;
    const errs: string[] = [];

    const sidErr = V.uuid(rec.student_id, `${f}.student_id`);
    if (sidErr) errs.push(sidErr);

    const stsErr = V.enum(ATTENDANCE_STATUS)(rec.status, `${f}.status`);
    if (stsErr) errs.push(stsErr);

    const srcErr = V.enum(ATTENDANCE_SOURCE)(rec.source, `${f}.source`);
    if (srcErr) errs.push(srcErr);

    return errs.length ? errs.join('; ') : null;
}

export const ATTENDANCE_BATCH_SCHEMA: FieldDef[] = [
    ['idempotency_key',  V.uuid,                            true],
    ['schedule_id',      V.uuid,                            true],
    ['submitted_by',     V.uuid,                            true],
    ['session_date',     V.isoDate,                         true],
    ['records',          V.arrayOf(validateAttendanceRecord, 1), true],
    // Optional
    ['substitute_token', V.str(1, 500),                     false],
    ['meeting_status',   V.enum(MEETING_STATUS),            false],
    ['_schema_version',  V.str(1, 20),                      false],
];


// ─────────────────────────────────────────────────────────────
// OBSERVATION SCHEMA
// ─────────────────────────────────────────────────────────────

export const OBSERVATION_SCHEMA: FieldDef[] = [
    ['idempotency_key', V.uuid,                              true],
    ['observation_id',  V.uuid,                              true],
    ['student_id',      V.uuid,                              true],
    ['author_user_id',  V.uuid,                              true],
    ['sentiment',       V.enum(OBSERVATION_SENTIMENT),       true],
    ['dimension',       V.enum(OBSERVATION_DIMENSION),       true],
    ['content',         V.str(10, 1000),                     true],
    ['visibility',      V.enum(VISIBILITY_LEVEL),            true],
    ['observed_at',     V.isoDate,                           true],
    // Optional
    ['schedule_id',     V.uuid,                              false],
    ['class_id',        V.uuid,                              false],
];


// ─────────────────────────────────────────────────────────────
// JOURNAL SCHEMA
// ─────────────────────────────────────────────────────────────

export const JOURNAL_SCHEMA: FieldDef[] = [
    ['idempotency_key', V.uuid,        true],
    ['journal_id',      V.uuid,        true],
    ['owner_user_id',   V.uuid,        true],
    ['content',         V.str(1, 10000), true],
    ['entry_date',      V.isoDate,     true],
    // Optional
    ['schedule_id',     V.uuid,        false],
    ['class_id',        V.uuid,        false],
];


// ─────────────────────────────────────────────────────────────
// CASE CREATE SCHEMA
// ─────────────────────────────────────────────────────────────

export const CASE_CREATE_SCHEMA: FieldDef[] = [
    ['idempotency_key',    V.uuid,                   true],
    ['case_id',            V.uuid,                   true],
    ['student_id',         V.uuid,                   true],
    ['created_by_user_id', V.uuid,                   true],
    ['initiated_by_role',  V.enum(ROLE_TYPE),        true],
    ['track',              V.enum(CASE_TRACK),       true],
    ['title',              V.str(5, 200),            true],
    ['description',        V.str(20, 5000),          true],
    // Optional — default PRIVATE jika tidak dikirim
    ['audience',           V.enum(CASE_AUDIENCE),    false],
];


// ─────────────────────────────────────────────────────────────
// CASE EVENT SCHEMA
// ─────────────────────────────────────────────────────────────

export const CASE_EVENT_SCHEMA: FieldDef[] = [
    ['idempotency_key',          V.uuid,               true],
    ['case_id',                  V.uuid,               true],
    ['event_type',               V.str(1, 50),         true],
    ['author_user_id',           V.uuid,               true],
    ['author_role',              V.enum(ROLE_TYPE),    true],
    ['privacy_level',            V.enum(VISIBILITY_LEVEL), true],
    ['payload',                  (_v, _f) => null,     true], // validated per-type below
    ['case_status_snapshot',     V.enum(CASE_STATUS),  true],
    ['current_handler_snapshot', V.enum(ROLE_TYPE),    true],
    ['is_locked_snapshot',       V.bool,               true],
    // Optional
    ['previous_handler_role',    V.enum(ROLE_TYPE),    false],
    ['new_handler_role',         V.enum(ROLE_TYPE),    false],
    ['previous_status',          V.enum(CASE_STATUS),  false],
    ['new_status',               V.enum(CASE_STATUS),  false],
    ['parent_message_id',        V.uuid,               false],
];
