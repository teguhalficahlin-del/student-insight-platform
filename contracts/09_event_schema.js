/**
 * @file event_schema.js
 * @module EventSchema
 * @version 1.0.0
 *
 * Single source of truth for all event payload contracts.
 * Used by:
 *   - Main app: validate before POST
 *   - Service Worker: validate before enqueue to offline queue
 *   - Edge Function (via schema mirror): validate on receipt
 *
 * STRUCTURE:
 *   SCHEMA_VERSION         — bump on any breaking change
 *   CASE_EVENT_TYPES       — enum of all 11 case event types
 *   OFFLINE_QUEUE_TYPES    — enum of offline queue operation types
 *   CASE_EVENT_SCHEMAS     — payload schema per case event type
 *   OFFLINE_QUEUE_SCHEMAS  — payload schema per offline queue type
 *   validate()             — generic validator function
 *   buildCaseEventEnvelope()  — constructs a validated case event
 *   buildOfflineQueueItem()   — constructs a validated offline queue item
 *   ERROR_ENVELOPE         — standard error response shape
 */

// ─────────────────────────────────────────────────────────────
// VERSION
// Bump MINOR for additive changes (new optional fields).
// Bump MAJOR for breaking changes (removed/renamed fields).
// ─────────────────────────────────────────────────────────────
export const SCHEMA_VERSION = '1.0.0';


// ─────────────────────────────────────────────────────────────
// ENUMS
// Mirror of Postgres enums. Single source of truth for JS layer.
// ─────────────────────────────────────────────────────────────

export const ROLE_TYPE = Object.freeze({
    GURU:           'GURU',
    BK:             'BK',
    WALI_KELAS:     'WALI_KELAS',
    KAPRODI:        'KAPRODI',
    KEPSEK:         'KEPSEK',
    WAKA_KESISWAAN: 'WAKA_KESISWAAN',
    WAKA_HUMAS:     'WAKA_HUMAS',
    DUDI:           'DUDI',
    SISWA:          'SISWA',
    ORTU:           'ORTU',
    ADMINISTRATIVE: 'ADMINISTRATIVE',
});

export const CASE_STATUS = Object.freeze({
    OPEN:         'OPEN',
    UNDER_REVIEW: 'UNDER_REVIEW',
    INTERVENTION: 'INTERVENTION',
    MONITORING:   'MONITORING',
    CLOSED:       'CLOSED',
});

export const CASE_TRACK = Object.freeze({
    SEKOLAH: 'SEKOLAH',
    PKL:     'PKL',
});

export const VISIBILITY_LEVEL = Object.freeze({
    PRIVATE:         'PRIVATE',
    INTERNAL_SCHOOL: 'INTERNAL_SCHOOL',
    STUDENT_VISIBLE: 'STUDENT_VISIBLE',
});

export const CASE_EVENT_TYPES = Object.freeze({
    COMMENT_ADDED:          'COMMENT_ADDED',
    STATUS_CHANGED:         'STATUS_CHANGED',
    DECISION_ESCALATE:      'DECISION_ESCALATE',
    DECISION_CLOSE:         'DECISION_CLOSE',
    FINAL_DECISION_MADE:    'FINAL_DECISION_MADE',
    STUDENT_UPDATE_ADDED:   'STUDENT_UPDATE_ADDED',
    PARENT_MESSAGE_RECEIVED:'PARENT_MESSAGE_RECEIVED',
    PARENT_MESSAGE_LINKED:  'PARENT_MESSAGE_LINKED',
    PARENT_REPLY_SENT:      'PARENT_REPLY_SENT',
    CASE_LOCKED:            'CASE_LOCKED',
    CASE_UNLOCKED:          'CASE_UNLOCKED',
});

export const OFFLINE_QUEUE_TYPES = Object.freeze({
    ATTENDANCE_BATCH:    'ATTENDANCE_BATCH',
    OBSERVATION_CREATE:  'OBSERVATION_CREATE',
    JOURNAL_CREATE:      'JOURNAL_CREATE',
    CASE_EVENT_CREATE:   'CASE_EVENT_CREATE',
    CASE_CREATE:         'CASE_CREATE',
});

export const ATTENDANCE_STATUS = Object.freeze({
    HADIR:       'HADIR',
    TIDAK_HADIR: 'TIDAK_HADIR',
    IZIN:        'IZIN',
    SAKIT:       'SAKIT',
    // EKSKUL dihapus (mig 20260703220000) — siswa ekskul ditandai HADIR
});

export const ATTENDANCE_SOURCE = Object.freeze({
    AUTO_DETECTED:   'AUTO_DETECTED',
    MANUAL_OVERRIDE: 'MANUAL_OVERRIDE',
    TEACHER_DECLARED:'TEACHER_DECLARED',
});

export const OBSERVATION_SENTIMENT = Object.freeze({
    POSITIF: 'POSITIF',
    NEGATIF: 'NEGATIF',
});

export const OBSERVATION_DIMENSION = Object.freeze({
    AKADEMIK:   'AKADEMIK',
    KEHADIRAN:  'KEHADIRAN',
    PERILAKU:   'PERILAKU',
    SOSIAL:     'SOSIAL',
    AFEKTIF:    'AFEKTIF',
    BAKAT_MINAT:'BAKAT_MINAT',
    FISIK:      'FISIK',
    LAINNYA:    'LAINNYA',
});

// Escalation chains — PENUNTUN (advisory) untuk urutan yang DIHARAPKAN, bukan
// gembok. Sejak desain kasus Langkah A (mig 20260703250000) eskalasi antar-
// aktor-internal BEBAS (arah mana pun, boleh lompat). Server hanya mengunci:
//   (a) target wajib salah satu 6 peran internal kasus (bukan SISWA/ORTU/dst),
//   (b) DUDI hanya boleh -> KAPRODI.
// TN-05 lama ("maju tepat satu langkah") SUDAH DIBATALKAN.
export const ESCALATION_CHAIN = Object.freeze({
    SEKOLAH: ['GURU', 'BK', 'WALI_KELAS', 'KAPRODI', 'WAKA_KESISWAAN', 'KEPSEK'],
    PKL:     ['DUDI', 'KAPRODI', 'WAKA_KESISWAAN', 'KEPSEK'],
});

// Peran internal yang boleh menjadi PENANGAN/target eskalasi kasus (6 peran).
export const INTERNAL_CASE_ROLES = Object.freeze(
    ['GURU', 'BK', 'WALI_KELAS', 'KAPRODI', 'WAKA_KESISWAAN', 'KEPSEK']
);


// ─────────────────────────────────────────────────────────────
// FIELD TYPE VALIDATORS
// Primitive validators reused across schemas.
// Each returns { valid: boolean, error?: string }
// ─────────────────────────────────────────────────────────────

const FieldType = {
    uuid: (v, name) => {
        const ok = typeof v === 'string'
            && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
        return ok ? null : `${name} must be a valid UUID, got: ${JSON.stringify(v)}`;
    },

    nonEmptyString: (v, name, min = 1, max = Infinity) => {
        if (typeof v !== 'string' || v.trim().length < min)
            return `${name} must be a non-empty string (min ${min} chars), got: ${JSON.stringify(v)}`;
        if (v.length > max)
            return `${name} exceeds max length ${max}, got length ${v.length}`;
        return null;
    },

    enum: (v, name, enumObj) => {
        const values = Object.values(enumObj);
        return values.includes(v)
            ? null
            : `${name} must be one of [${values.join(', ')}], got: ${JSON.stringify(v)}`;
    },

    isoDate: (v, name) => {
        const ok = typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(Date.parse(v));
        return ok ? null : `${name} must be an ISO date string (YYYY-MM-DD), got: ${JSON.stringify(v)}`;
    },

    isoTimestamp: (v, name) => {
        const ok = typeof v === 'string' && !isNaN(Date.parse(v));
        return ok ? null : `${name} must be a valid ISO timestamp string, got: ${JSON.stringify(v)}`;
    },

    boolean: (v, name) =>
        typeof v === 'boolean' ? null : `${name} must be boolean, got: ${JSON.stringify(v)}`,

    arrayOf: (v, name, itemValidator) => {
        if (!Array.isArray(v)) return `${name} must be an array, got: ${JSON.stringify(v)}`;
        const errors = v.flatMap((item, i) => {
            const err = itemValidator(item, `${name}[${i}]`);
            return err ? [err] : [];
        });
        return errors.length ? errors.join('; ') : null;
    },

    positiveInteger: (v, name) => {
        return Number.isInteger(v) && v > 0
            ? null
            : `${name} must be a positive integer, got: ${JSON.stringify(v)}`;
    },
};


// ─────────────────────────────────────────────────────────────
// CASE EVENT SCHEMAS
// Each schema defines:
//   requiredPayloadFields: [ [fieldName, validatorFn], ... ]
//   optionalPayloadFields: [ [fieldName, validatorFn], ... ]
//   requiredEnvelopeFields: fields required on the outer envelope
//     beyond the base (case_id, author, event_type are always required)
//   privacyDefault: default visibility_level for this event type
//   allowedRoles: which roles can emit this event type
//     (secondary guard — primary is RLS; this runs client-side first)
// ─────────────────────────────────────────────────────────────

export const CASE_EVENT_SCHEMAS = Object.freeze({

    // ── COMMENT_ADDED ─────────────────────────────────────────
    // Who: current_handler_role (all applicable roles)
    // Blocked when: case.is_locked AND author != current_handler_role (INV-4)
    // Privacy default: INTERNAL_SCHOOL
    COMMENT_ADDED: {
        privacyDefault: VISIBILITY_LEVEL.INTERNAL_SCHOOL,
        allowedRoles: ['GURU', 'BK', 'WALI_KELAS', 'KAPRODI', 'KEPSEK', 'DUDI'],
        requiresCurrentHandler: true,
        lockBlocks: true,
        requiredPayloadFields: [
            ['text', (v) => FieldType.nonEmptyString(v, 'payload.text', 10, 2000)],
        ],
        optionalPayloadFields: [],
        requiredEnvelopeFields: [],
    },

    // ── STATUS_CHANGED ────────────────────────────────────────
    // Who: current_handler_role
    // Used for intermediate status transitions not triggered by ESCALATE/CLOSE
    // new_status must differ from current case status (validated in buildCaseEventEnvelope)
    STATUS_CHANGED: {
        privacyDefault: VISIBILITY_LEVEL.INTERNAL_SCHOOL,
        allowedRoles: ['GURU', 'BK', 'WALI_KELAS', 'KAPRODI', 'KEPSEK', 'DUDI'],
        requiresCurrentHandler: true,
        lockBlocks: false,
        requiredPayloadFields: [
            ['reason', (v) => FieldType.nonEmptyString(v, 'payload.reason', 5, 500)],
        ],
        optionalPayloadFields: [],
        requiredEnvelopeFields: [
            ['new_status', (v) => FieldType.enum(v, 'new_status', CASE_STATUS)],
            ['previous_status', (v) => FieldType.enum(v, 'previous_status', CASE_STATUS)],
        ],
    },

    // ── DECISION_ESCALATE ─────────────────────────────────────
    // Who: current_handler_role (cannot be KEPSEK — last in chain)
    // INV-2: new_handler_role != previous_handler_role
    // TN-05: new_handler_role must be next step in ESCALATION_CHAIN
    DECISION_ESCALATE: {
        privacyDefault: VISIBILITY_LEVEL.INTERNAL_SCHOOL,
        allowedRoles: ['GURU', 'BK', 'WALI_KELAS', 'KAPRODI', 'DUDI'],
        requiresCurrentHandler: true,
        lockBlocks: false,
        requiredPayloadFields: [
            ['reason', (v) => FieldType.nonEmptyString(v, 'payload.reason', 10, 1000)],
        ],
        optionalPayloadFields: [],
        requiredEnvelopeFields: [
            ['previous_handler_role', (v) => FieldType.enum(v, 'previous_handler_role', ROLE_TYPE)],
            ['new_handler_role',      (v) => FieldType.enum(v, 'new_handler_role', ROLE_TYPE)],
            ['previous_status',       (v) => FieldType.enum(v, 'previous_status', CASE_STATUS)],
            ['new_status',            (v) => FieldType.enum(v, 'new_status', CASE_STATUS)],
        ],
    },

    // ── DECISION_CLOSE ────────────────────────────────────────
    // Who: current_handler_role (any role that is current handler)
    // After this event: case.status → CLOSED (via trigger)
    DECISION_CLOSE: {
        privacyDefault: VISIBILITY_LEVEL.INTERNAL_SCHOOL,
        allowedRoles: ['GURU', 'BK', 'WALI_KELAS', 'KAPRODI', 'KEPSEK', 'DUDI'],
        requiresCurrentHandler: true,
        lockBlocks: false,
        requiredPayloadFields: [
            ['summary',  (v) => FieldType.nonEmptyString(v, 'payload.summary', 20, 2000)],
            ['outcome',  (v) => FieldType.nonEmptyString(v, 'payload.outcome', 5, 500)],
        ],
        optionalPayloadFields: [],
        requiredEnvelopeFields: [
            ['previous_status', (v) => FieldType.enum(v, 'previous_status', CASE_STATUS)],
        ],
    },

    // ── FINAL_DECISION_MADE ───────────────────────────────────
    // Who: KEPSEK only — any time status != CLOSED (bypasses handler check)
    // After this event: case.status → CLOSED regardless of current_handler_role
    FINAL_DECISION_MADE: {
        privacyDefault: VISIBILITY_LEVEL.INTERNAL_SCHOOL,
        allowedRoles: ['KEPSEK'],
        requiresCurrentHandler: false,   // explicit bypass
        lockBlocks: false,               // INV-4: Kepsek always passes
        requiredPayloadFields: [
            ['decision', (v) => FieldType.nonEmptyString(v, 'payload.decision', 20, 2000)],
            ['notes',    (v) => FieldType.nonEmptyString(v, 'payload.notes', 10, 2000)],
        ],
        optionalPayloadFields: [],
        requiredEnvelopeFields: [
            ['previous_status', (v) => FieldType.enum(v, 'previous_status', CASE_STATUS)],
        ],
    },

    // ── STUDENT_UPDATE_ADDED ──────────────────────────────────
    // Who: current_handler_role
    // Privacy: always STUDENT_VISIBLE (enforced by DB constraint + here)
    // Also creates a row in student_updates table (same transaction)
    STUDENT_UPDATE_ADDED: {
        privacyDefault: VISIBILITY_LEVEL.STUDENT_VISIBLE,
        allowedRoles: ['GURU', 'BK', 'WALI_KELAS', 'KAPRODI', 'KEPSEK', 'DUDI'],
        requiresCurrentHandler: true,
        lockBlocks: false,
        requiredPayloadFields: [
            ['text', (v) => FieldType.nonEmptyString(v, 'payload.text', 10, 1000)],
        ],
        optionalPayloadFields: [],
        requiredEnvelopeFields: [],
        privacyFixed: true,   // privacy_level cannot be overridden
    },

    // ── PARENT_MESSAGE_RECEIVED ───────────────────────────────
    // System event: recorded when an ORTU submits a parent_message
    // linked to this case. Written by Edge Function, not by client directly.
    // Client creates the parent_message; Edge Function appends this event.
    PARENT_MESSAGE_RECEIVED: {
        privacyDefault: VISIBILITY_LEVEL.INTERNAL_SCHOOL,
        allowedRoles: [],               // system-only (Edge Function / service role)
        requiresCurrentHandler: false,
        lockBlocks: true,               // INV-4: blocked when case is locked
        requiredPayloadFields: [
            ['parent_user_id',  (v) => FieldType.uuid(v, 'payload.parent_user_id')],
            ['student_id',      (v) => FieldType.uuid(v, 'payload.student_id')],
            ['message_preview', (v) => FieldType.nonEmptyString(v, 'payload.message_preview', 1, 200)],
        ],
        optionalPayloadFields: [],
        requiredEnvelopeFields: [
            ['parent_message_id', (v) => FieldType.uuid(v, 'parent_message_id')],
        ],
        systemOnly: true,
    },

    // ── PARENT_MESSAGE_LINKED ─────────────────────────────────
    // System event: recorded when staff links an existing parent_message to a case.
    PARENT_MESSAGE_LINKED: {
        privacyDefault: VISIBILITY_LEVEL.INTERNAL_SCHOOL,
        allowedRoles: ['GURU', 'BK', 'WALI_KELAS', 'KAPRODI', 'KEPSEK'],
        requiresCurrentHandler: false,
        lockBlocks: false,
        requiredPayloadFields: [
            ['linked_by_note', (v) => FieldType.nonEmptyString(v, 'payload.linked_by_note', 0, 500)],
        ],
        optionalPayloadFields: [],
        requiredEnvelopeFields: [
            ['parent_message_id', (v) => FieldType.uuid(v, 'parent_message_id')],
        ],
    },

    // ── PARENT_REPLY_SENT ─────────────────────────────────────
    // System event: recorded when a staff member sends a reply to an ORTU.
    // Also creates an OUTBOUND parent_message row (same transaction).
    PARENT_REPLY_SENT: {
        privacyDefault: VISIBILITY_LEVEL.INTERNAL_SCHOOL,
        allowedRoles: ['GURU', 'BK', 'WALI_KELAS', 'KAPRODI', 'KEPSEK'],
        requiresCurrentHandler: false,
        lockBlocks: false,
        requiredPayloadFields: [
            ['reply_preview', (v) => FieldType.nonEmptyString(v, 'payload.reply_preview', 1, 200)],
        ],
        optionalPayloadFields: [],
        requiredEnvelopeFields: [
            ['parent_message_id', (v) => FieldType.uuid(v, 'parent_message_id')],
        ],
    },

    // ── CASE_LOCKED ───────────────────────────────────────────
    // Who: current_handler_role
    // After this event: case.is_locked → true (via trigger TN-04)
    CASE_LOCKED: {
        privacyDefault: VISIBILITY_LEVEL.INTERNAL_SCHOOL,
        allowedRoles: ['GURU', 'BK', 'WALI_KELAS', 'KAPRODI', 'KEPSEK', 'DUDI'],
        requiresCurrentHandler: true,
        lockBlocks: false,
        requiredPayloadFields: [
            ['reason', (v) => FieldType.nonEmptyString(v, 'payload.reason', 5, 500)],
        ],
        optionalPayloadFields: [],
        requiredEnvelopeFields: [],
    },

    // ── CASE_UNLOCKED ─────────────────────────────────────────
    // Who: current_handler_role
    // After this event: case.is_locked → false (via trigger TN-04)
    CASE_UNLOCKED: {
        privacyDefault: VISIBILITY_LEVEL.INTERNAL_SCHOOL,
        allowedRoles: ['GURU', 'BK', 'WALI_KELAS', 'KAPRODI', 'KEPSEK', 'DUDI'],
        requiresCurrentHandler: true,
        lockBlocks: false,
        requiredPayloadFields: [
            ['reason', (v) => FieldType.nonEmptyString(v, 'payload.reason', 5, 500)],
        ],
        optionalPayloadFields: [],
        requiredEnvelopeFields: [],
    },
});


// ─────────────────────────────────────────────────────────────
// OFFLINE QUEUE SCHEMAS
// Category A operations buffered in IndexedDB.
//
// Every offline queue item has a mandatory base envelope:
//   idempotency_key  — UUID v4 generated client-side at creation
//   queue_type       — one of OFFLINE_QUEUE_TYPES
//   created_offline_at — ISO timestamp (device clock)
//   schema_version   — SCHEMA_VERSION at time of creation
//   retry_count      — starts at 0, incremented per failed replay attempt
//   max_retries      — default 5; item dead-lettered after this
//
// The server uses idempotency_key to detect and reject duplicate replays.
// ─────────────────────────────────────────────────────────────

export const OFFLINE_QUEUE_BASE_FIELDS = [
    ['idempotency_key',    (v) => FieldType.uuid(v, 'idempotency_key')],
    ['queue_type',         (v) => FieldType.enum(v, 'queue_type', OFFLINE_QUEUE_TYPES)],
    ['created_offline_at', (v) => FieldType.isoTimestamp(v, 'created_offline_at')],
    ['schema_version',     (v) => FieldType.nonEmptyString(v, 'schema_version', 1, 20)],
    ['retry_count',        (v) => (Number.isInteger(v) && v >= 0) ? null : 'retry_count must be a non-negative integer'],
    ['max_retries',        (v) => FieldType.positiveInteger(v, 'max_retries')],
];

export const OFFLINE_QUEUE_SCHEMAS = Object.freeze({

    // ── ATTENDANCE_BATCH ──────────────────────────────────────
    // Submits attendance for all students in one session.
    // One queue item = one full session batch (not per-student).
    // Server applies as upsert (ON CONFLICT DO UPDATE).
    // idempotency_key keyed on: schedule_id (one batch per session).
    ATTENDANCE_BATCH: {
        requiredFields: [
            ['schedule_id',  (v) => FieldType.uuid(v, 'schedule_id')],
            ['submitted_by', (v) => FieldType.uuid(v, 'submitted_by')],
            ['session_date', (v) => FieldType.isoDate(v, 'session_date')],
            ['records', (v) => FieldType.arrayOf(v, 'records', (item, name) => {
                const errs = [];
                const sid = FieldType.uuid(item.student_id, `${name}.student_id`);
                const sts = FieldType.enum(item.status, `${name}.status`, ATTENDANCE_STATUS);
                const src = FieldType.enum(item.source, `${name}.source`, ATTENDANCE_SOURCE);
                if (sid) errs.push(sid);
                if (sts) errs.push(sts);
                if (src) errs.push(src);
                return errs.length ? errs.join('; ') : null;
            })],
        ],
        optionalFields: [
            ['substitute_token', (v) => typeof v === 'string' ? null : 'substitute_token must be a string'],
            ['meeting_status',   (v) => FieldType.enum(v, 'meeting_status', {
                NORMAL: 'NORMAL', KEGIATAN_SEKOLAH: 'KEGIATAN_SEKOLAH', GURU_TIDAK_HADIR: 'GURU_TIDAK_HADIR'
            })],
        ],
        // Server endpoint: POST /functions/v1/sync-attendance-batch
        serverEndpoint: '/functions/v1/sync-attendance-batch',
        idempotencyScope: 'schedule_id',   // one successful sync per schedule_id
    },

    // ── OBSERVATION_CREATE ────────────────────────────────────
    // Creates one observation record.
    // idempotency_key is random UUID — observations are not deduplicated by content.
    OBSERVATION_CREATE: {
        requiredFields: [
            ['student_id',     (v) => FieldType.uuid(v, 'student_id')],
            ['author_user_id', (v) => FieldType.uuid(v, 'author_user_id')],
            ['sentiment',      (v) => FieldType.enum(v, 'sentiment', OBSERVATION_SENTIMENT)],
            ['dimension',      (v) => FieldType.enum(v, 'dimension', OBSERVATION_DIMENSION)],
            ['content',        (v) => FieldType.nonEmptyString(v, 'content', 10, 1000)],
            ['visibility',     (v) => FieldType.enum(v, 'visibility', VISIBILITY_LEVEL)],
            ['observed_at',    (v) => FieldType.isoDate(v, 'observed_at')],
        ],
        optionalFields: [
            ['schedule_id', (v) => FieldType.uuid(v, 'schedule_id')],
            ['class_id',    (v) => FieldType.uuid(v, 'class_id')],
        ],
        serverEndpoint: '/functions/v1/sync-observation',
        idempotencyScope: 'idempotency_key',
    },

    // ── JOURNAL_CREATE ────────────────────────────────────────
    // Creates one teacher journal entry.
    // Private — only the owner's device should queue this.
    JOURNAL_CREATE: {
        requiredFields: [
            ['owner_user_id', (v) => FieldType.uuid(v, 'owner_user_id')],
            ['content',       (v) => FieldType.nonEmptyString(v, 'content', 1, 10000)],
            ['entry_date',    (v) => FieldType.isoDate(v, 'entry_date')],
        ],
        optionalFields: [
            ['schedule_id', (v) => FieldType.uuid(v, 'schedule_id')],
            ['class_id',    (v) => FieldType.uuid(v, 'class_id')],
        ],
        serverEndpoint: '/functions/v1/sync-journal',
        idempotencyScope: 'idempotency_key',
    },

    // ── CASE_EVENT_CREATE ─────────────────────────────────────
    // Queues a case event created while offline.
    // Contains the full envelope + payload (validated against CASE_EVENT_SCHEMAS).
    // Server re-validates everything on receipt before committing.
    // CRITICAL: case status and handler state are unknown offline.
    //   The server must reject if the case has changed state incompatibly.
    //   Client shows a conflict resolution UI on rejection.
    CASE_EVENT_CREATE: {
        requiredFields: [
            ['case_id',           (v) => FieldType.uuid(v, 'case_id')],
            ['event_type',        (v) => FieldType.enum(v, 'event_type', CASE_EVENT_TYPES)],
            ['author_user_id',    (v) => FieldType.uuid(v, 'author_user_id')],
            ['author_role',       (v) => FieldType.enum(v, 'author_role', ROLE_TYPE)],
            ['privacy_level',     (v) => FieldType.enum(v, 'privacy_level', VISIBILITY_LEVEL)],
            ['payload',           (v) => (v !== null && typeof v === 'object' && !Array.isArray(v))
                                            ? null : 'payload must be a JSON object'],
            // Snapshot of case state at time of offline action
            // Used by server for conflict detection
            ['case_status_snapshot',         (v) => FieldType.enum(v, 'case_status_snapshot', CASE_STATUS)],
            ['current_handler_snapshot',     (v) => FieldType.enum(v, 'current_handler_snapshot', ROLE_TYPE)],
            ['is_locked_snapshot',           (v) => FieldType.boolean(v, 'is_locked_snapshot')],
        ],
        optionalFields: [
            ['previous_handler_role', (v) => FieldType.enum(v, 'previous_handler_role', ROLE_TYPE)],
            ['new_handler_role',      (v) => FieldType.enum(v, 'new_handler_role', ROLE_TYPE)],
            ['previous_status',       (v) => FieldType.enum(v, 'previous_status', CASE_STATUS)],
            ['new_status',            (v) => FieldType.enum(v, 'new_status', CASE_STATUS)],
            ['parent_message_id',     (v) => FieldType.uuid(v, 'parent_message_id')],
        ],
        serverEndpoint: '/functions/v1/sync-case-event',
        idempotencyScope: 'idempotency_key',
        // Server conflict policy: REJECT_WITH_DIFF
        // Returns current case state so client can resolve.
        conflictPolicy: 'REJECT_WITH_DIFF',
    },

    // ── CASE_CREATE ───────────────────────────────────────────
    // Creates a new case while offline.
    // Offline case creation is rare but allowed (Category A).
    // idempotency_key becomes the case_id on the server (client-generated UUID).
    CASE_CREATE: {
        requiredFields: [
            ['case_id',           (v) => FieldType.uuid(v, 'case_id')],  // client-generated, becomes PK
            ['student_id',        (v) => FieldType.uuid(v, 'student_id')],
            ['created_by_user_id',(v) => FieldType.uuid(v, 'created_by_user_id')],
            ['initiated_by_role', (v) => FieldType.enum(v, 'initiated_by_role', ROLE_TYPE)],
            ['track',             (v) => FieldType.enum(v, 'track', CASE_TRACK)],
            ['title',             (v) => FieldType.nonEmptyString(v, 'title', 5, 200)],
            ['description',       (v) => FieldType.nonEmptyString(v, 'description', 20, 5000)],
        ],
        optionalFields: [],
        serverEndpoint: '/functions/v1/sync-case-create',
        // idempotency: case_id is client-generated UUID used as PK
        // Server uses INSERT ... ON CONFLICT (case_id) DO NOTHING
        idempotencyScope: 'case_id',
        conflictPolicy: 'IDEMPOTENT_INSERT',
    },
});


// ─────────────────────────────────────────────────────────────
// GENERIC VALIDATOR
// validate(schema, data) → { valid: boolean, errors: string[] }
// ─────────────────────────────────────────────────────────────

/**
 * Validates a data object against a field schema definition.
 * @param {Array<[string, Function]>} requiredFields
 * @param {Array<[string, Function]>} optionalFields
 * @param {Object} data
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validate(requiredFields, optionalFields, data) {
    const errors = [];

    if (data === null || typeof data !== 'object' || Array.isArray(data)) {
        return { valid: false, errors: ['data must be a non-null object'] };
    }

    for (const [field, validator] of requiredFields) {
        if (!(field in data)) {
            errors.push(`Missing required field: ${field}`);
            continue;
        }
        const err = validator(data[field], field);
        if (err) errors.push(err);
    }

    for (const [field, validator] of optionalFields) {
        if (field in data && data[field] !== null && data[field] !== undefined) {
            const err = validator(data[field], field);
            if (err) errors.push(err);
        }
    }

    return { valid: errors.length === 0, errors };
}


// ─────────────────────────────────────────────────────────────
// buildCaseEventEnvelope()
// Constructs and validates a complete case event envelope.
// Returns { valid, errors, envelope } — envelope is null if invalid.
//
// Additional cross-field validations beyond field-level:
//   - STUDENT_UPDATE_ADDED: forces privacy_level = STUDENT_VISIBLE
//   - DECISION_ESCALATE: validates escalation chain order (TN-05)
//   - DECISION_ESCALATE: validates new_handler != previous_handler (INV-2)
// ─────────────────────────────────────────────────────────────

/**
 * @param {Object} params
 * @param {string} params.case_id
 * @param {string} params.event_type  — one of CASE_EVENT_TYPES
 * @param {string} params.author_user_id
 * @param {string} params.author_role_at_time  — one of ROLE_TYPE
 * @param {string} [params.privacy_level]      — overrides default if provided
 * @param {Object} params.payload
 * @param {Object} [params.envelope_extra]     — additional envelope fields
 *   (new_handler_role, previous_handler_role, new_status, previous_status,
 *    parent_message_id)
 * @param {string} [params.case_track]         — required for DECISION_ESCALATE
 * @returns {{ valid: boolean, errors: string[], envelope: Object|null }}
 */
export function buildCaseEventEnvelope({
    case_id,
    event_type,
    author_user_id,
    author_role_at_time,
    privacy_level,
    payload = {},
    envelope_extra = {},
    case_track,
}) {
    const errors = [];

    // 1. Base envelope field validation
    const baseErr = [
        FieldType.uuid(case_id,            'case_id'),
        FieldType.enum(event_type,         'event_type', CASE_EVENT_TYPES),
        FieldType.uuid(author_user_id,     'author_user_id'),
        FieldType.enum(author_role_at_time,'author_role_at_time', ROLE_TYPE),
    ].filter(Boolean);
    errors.push(...baseErr);

    if (errors.length) return { valid: false, errors, envelope: null };

    // 2. Resolve schema for this event type
    const schema = CASE_EVENT_SCHEMAS[event_type];

    // 3. Role permission check (client-side pre-flight)
    if (schema.allowedRoles.length > 0 && !schema.allowedRoles.includes(author_role_at_time)) {
        errors.push(
            `Role '${author_role_at_time}' is not permitted to emit '${event_type}'. ` +
            `Allowed: [${schema.allowedRoles.join(', ')}]`
        );
    }

    // 4. Privacy level
    let resolvedPrivacy = privacy_level ?? schema.privacyDefault;
    if (schema.privacyFixed && resolvedPrivacy !== schema.privacyDefault) {
        errors.push(
            `privacy_level for '${event_type}' is fixed to '${schema.privacyDefault}' and cannot be overridden`
        );
        resolvedPrivacy = schema.privacyDefault;
    }
    const privacyErr = FieldType.enum(resolvedPrivacy, 'privacy_level', VISIBILITY_LEVEL);
    if (privacyErr) errors.push(privacyErr);

    // 5. Payload validation
    const payloadResult = validate(
        schema.requiredPayloadFields,
        schema.optionalPayloadFields,
        payload
    );
    if (!payloadResult.valid) {
        errors.push(...payloadResult.errors.map(e => `payload: ${e}`));
    }

    // 6. Required envelope extra fields
    if (schema.requiredEnvelopeFields.length > 0) {
        const envResult = validate(schema.requiredEnvelopeFields, [], envelope_extra);
        if (!envResult.valid) {
            errors.push(...envResult.errors.map(e => `envelope: ${e}`));
        }
    }

    // 7. Cross-field invariant: DECISION_ESCALATE (INV-2 + kunci target)
    //    Desain Langkah A (mig 20260703250000): eskalasi BEBAS arah/lompat.
    //    Yang divalidasi hanya BATAS, bukan urutan rantai (TN-05 dibatalkan):
    //      - INV-2: new_handler_role != previous_handler_role
    //      - target wajib salah satu 6 peran internal kasus (INTERNAL_CASE_ROLES)
    //    Kunci DUDI->KAPRODI ditegakkan server (trigger trg_case_validate_escalate)
    //    karena butuh peran author; tak selalu tersedia di validator klien ini.
    if (event_type === CASE_EVENT_TYPES.DECISION_ESCALATE && !errors.length) {
        const { previous_handler_role, new_handler_role } = envelope_extra;

        // INV-2: must differ
        if (previous_handler_role === new_handler_role) {
            errors.push(
                `INV-2 violation: new_handler_role must differ from previous_handler_role. ` +
                `Both are '${new_handler_role}'`
            );
        }

        // Kunci target: hanya peran internal kasus yang boleh jadi penangan.
        if (!INTERNAL_CASE_ROLES.includes(new_handler_role)) {
            errors.push(
                `escalate_target_invalid: new_handler_role '${new_handler_role}' ` +
                `bukan peran internal penangan kasus (${INTERNAL_CASE_ROLES.join(', ')})`
            );
        }
    }

    if (errors.length) return { valid: false, errors, envelope: null };

    // 8. Assemble envelope
    const envelope = {
        case_id,
        event_type,
        author_user_id,
        author_role_at_time,
        privacy_level: resolvedPrivacy,
        payload,
        ...envelope_extra,
    };

    return { valid: true, errors: [], envelope };
}


// ─────────────────────────────────────────────────────────────
// buildOfflineQueueItem()
// Constructs and validates a complete offline queue item.
// Adds base envelope fields automatically.
// Returns { valid, errors, item } — item is null if invalid.
// ─────────────────────────────────────────────────────────────

/**
 * @param {string} queue_type  — one of OFFLINE_QUEUE_TYPES
 * @param {Object} data        — the operation-specific payload
 * @returns {{ valid: boolean, errors: string[], item: Object|null }}
 */
export function buildOfflineQueueItem(queue_type, data) {
    const errors = [];

    const typeErr = FieldType.enum(queue_type, 'queue_type', OFFLINE_QUEUE_TYPES);
    if (typeErr) return { valid: false, errors: [typeErr], item: null };

    const schema = OFFLINE_QUEUE_SCHEMAS[queue_type];

    // Build base envelope
    const base = {
        idempotency_key:    data.idempotency_key ?? crypto.randomUUID(),
        queue_type,
        created_offline_at: new Date().toISOString(),
        schema_version:     SCHEMA_VERSION,
        retry_count:        0,
        max_retries:        5,
    };

    const baseResult = validate(OFFLINE_QUEUE_BASE_FIELDS, [], base);
    if (!baseResult.valid) errors.push(...baseResult.errors);

    const dataResult = validate(schema.requiredFields, schema.optionalFields, data);
    if (!dataResult.valid) errors.push(...dataResult.errors);

    if (errors.length) return { valid: false, errors, item: null };

    const item = {
        ...base,
        ...data,
        _meta: {
            serverEndpoint:  schema.serverEndpoint,
            conflictPolicy:  schema.conflictPolicy ?? 'REJECT',
            idempotencyScope: schema.idempotencyScope,
        },
    };

    return { valid: true, errors: [], item };
}


// ─────────────────────────────────────────────────────────────
// ERROR ENVELOPE
// Standard shape for all error responses from Edge Functions
// and for client-side validation failures.
// ─────────────────────────────────────────────────────────────

/**
 * Builds a standard error envelope.
 * @param {string} code        — machine-readable error code
 * @param {string} message     — human-readable summary
 * @param {string[]} [details] — field-level error details
 * @param {Object} [context]   — additional context (e.g. current server state on conflict)
 */
export function buildErrorEnvelope(code, message, details = [], context = null) {
    return {
        error: {
            code,
            message,
            details,
            context,
            schema_version: SCHEMA_VERSION,
            timestamp: new Date().toISOString(),
        }
    };
}

// Standard error codes
export const ERROR_CODES = Object.freeze({
    // Validation
    VALIDATION_FAILED:        'VALIDATION_FAILED',
    MISSING_REQUIRED_FIELD:   'MISSING_REQUIRED_FIELD',
    INVALID_ENUM_VALUE:       'INVALID_ENUM_VALUE',

    // Domain invariants
    CASE_ALREADY_CLOSED:      'CASE_ALREADY_CLOSED',        // INV-1
    ESCALATION_SAME_HANDLER:  'ESCALATION_SAME_HANDLER',    // INV-2
    ESCALATION_WRONG_STEP:    'ESCALATION_WRONG_STEP',      // TN-05
    CASE_LOCKED:              'CASE_LOCKED',                 // INV-4
    NOT_CURRENT_HANDLER:      'NOT_CURRENT_HANDLER',        // INV-3 + permission
    ROLE_NOT_PERMITTED:       'ROLE_NOT_PERMITTED',

    // Offline sync
    IDEMPOTENCY_DUPLICATE:    'IDEMPOTENCY_DUPLICATE',
    CONFLICT_CASE_STATE:      'CONFLICT_CASE_STATE',         // server state diverged
    SCHEMA_VERSION_MISMATCH:  'SCHEMA_VERSION_MISMATCH',
    SYNC_TOKEN_EXPIRED:       'SYNC_TOKEN_EXPIRED',

    // Auth
    UNAUTHORIZED:             'UNAUTHORIZED',
    FORBIDDEN:                'FORBIDDEN',
});
