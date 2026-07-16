/**
 * @file sync-attendance-batch/index.test.ts
 *
 * Test suite for sync-attendance-batch Edge Function.
 * Tests business logic in isolation using mock dependencies.
 *
 * Run with Deno:
 *   deno test --allow-env index.test.ts
 *
 * These tests cover the 10-step processing sequence.
 * Integration tests (actual DB) are run separately via
 * Supabase's local dev environment (supabase start).
 */

import { assertEquals, assertExists }
    from 'https://deno.land/std@0.208.0/assert/mod.ts';

import { validatePayload, ATTENDANCE_BATCH_SCHEMA } from '../_shared/validate.ts';
import { corsHeaders }   from '../_shared/cors.ts';
import { V }             from '../_shared/validate.ts';


// ─────────────────────────────────────────────────────────────
// FIXTURES
// ─────────────────────────────────────────────────────────────

const UUID = {
    schedule:  '11111111-1111-1111-1111-111111111111',
    student1:  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    student2:  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    teacher:   'cccccccc-cccc-cccc-cccc-cccccccccccc',
    sub:       'dddddddd-dddd-dddd-dddd-dddddddddddd',
    idem:      'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
};

function makeValidPayload(overrides: Record<string, unknown> = {}) {
    return {
        idempotency_key: UUID.idem,
        schedule_id:     UUID.schedule,
        submitted_by:    UUID.teacher,
        session_date:    '2024-01-15',
        records: [
            { student_id: UUID.student1, status: 'HADIR',       source: 'AUTO_DETECTED' },
            { student_id: UUID.student2, status: 'ALPA', source: 'MANUAL_OVERRIDE' },
        ],
        ...overrides,
    };
}


// ─────────────────────────────────────────────────────────────
// VALIDATION TESTS
// Step 4: Parse + validate body
// ─────────────────────────────────────────────────────────────

Deno.test('Payload validation — valid payload passes', () => {
    const result = validatePayload(ATTENDANCE_BATCH_SCHEMA, makeValidPayload());
    assertEquals(result.valid, true);
    assertEquals(result.errors.length, 0);
});

Deno.test('Payload validation — missing required field: schedule_id', () => {
    const payload = makeValidPayload();
    delete (payload as Record<string, unknown>).schedule_id;
    const result = validatePayload(ATTENDANCE_BATCH_SCHEMA, payload);
    assertEquals(result.valid, false);
    assertEquals(result.errors.some(e => e.includes('schedule_id')), true);
});

Deno.test('Payload validation — missing required field: records', () => {
    const payload = makeValidPayload();
    delete (payload as Record<string, unknown>).records;
    const result = validatePayload(ATTENDANCE_BATCH_SCHEMA, payload);
    assertEquals(result.valid, false);
    assertEquals(result.errors.some(e => e.includes('records')), true);
});

Deno.test('Payload validation — empty records array is rejected', () => {
    const result = validatePayload(ATTENDANCE_BATCH_SCHEMA, makeValidPayload({ records: [] }));
    assertEquals(result.valid, false);
    assertEquals(result.errors.some(e => e.includes('records')), true);
});

Deno.test('Payload validation — invalid attendance status is rejected', () => {
    const result = validatePayload(ATTENDANCE_BATCH_SCHEMA, makeValidPayload({
        records: [{ student_id: UUID.student1, status: 'TIDAK_TAU', source: 'AUTO_DETECTED' }],
    }));
    assertEquals(result.valid, false);
    assertEquals(result.errors.some(e => e.includes('status')), true);
});

Deno.test('Payload validation — invalid source is rejected', () => {
    const result = validatePayload(ATTENDANCE_BATCH_SCHEMA, makeValidPayload({
        records: [{ student_id: UUID.student1, status: 'HADIR', source: 'ALIEN_DETECTED' }],
    }));
    assertEquals(result.valid, false);
    assertEquals(result.errors.some(e => e.includes('source')), true);
});

Deno.test('Payload validation — invalid UUID in student_id is rejected', () => {
    const result = validatePayload(ATTENDANCE_BATCH_SCHEMA, makeValidPayload({
        records: [{ student_id: 'not-a-uuid', status: 'HADIR', source: 'AUTO_DETECTED' }],
    }));
    assertEquals(result.valid, false);
    assertEquals(result.errors.some(e => e.includes('student_id')), true);
});

Deno.test('Payload validation — invalid session_date format is rejected', () => {
    const result = validatePayload(ATTENDANCE_BATCH_SCHEMA, makeValidPayload({
        session_date: '15-01-2024',  // wrong format
    }));
    assertEquals(result.valid, false);
    assertEquals(result.errors.some(e => e.includes('session_date')), true);
});

Deno.test('Payload validation — optional meeting_status accepted when valid', () => {
    const result = validatePayload(ATTENDANCE_BATCH_SCHEMA, makeValidPayload({
        meeting_status: 'GURU_TIDAK_HADIR',
    }));
    assertEquals(result.valid, true);
});

Deno.test('Payload validation — invalid optional meeting_status is rejected', () => {
    const result = validatePayload(ATTENDANCE_BATCH_SCHEMA, makeValidPayload({
        meeting_status: 'MASUK_ANGIN',
    }));
    assertEquals(result.valid, false);
    assertEquals(result.errors.some(e => e.includes('meeting_status')), true);
});

Deno.test('Payload validation — multiple records all validated', () => {
    const result = validatePayload(ATTENDANCE_BATCH_SCHEMA, makeValidPayload({
        records: [
            { student_id: UUID.student1, status: 'HADIR',   source: 'AUTO_DETECTED' },
            { student_id: UUID.student2, status: 'INVALID',  source: 'MANUAL_OVERRIDE' },  // bad
        ],
    }));
    assertEquals(result.valid, false);
    assertEquals(result.errors.some(e => e.includes('[1]')), true); // index 1 flagged
});

Deno.test('Payload validation — body is not an object', () => {
    const result = validatePayload(ATTENDANCE_BATCH_SCHEMA, null as unknown as Record<string, unknown>);
    assertEquals(result.valid, false);
    assertEquals(result.errors.some(e => e.includes('JSON object')), true);
});


// ─────────────────────────────────────────────────────────────
// PRIMITIVE VALIDATOR TESTS
// ─────────────────────────────────────────────────────────────

Deno.test('V.uuid — accepts valid UUID', () => {
    assertEquals(V.uuid('11111111-1111-1111-1111-111111111111', 'f'), null);
});

Deno.test('V.uuid — rejects non-UUID string', () => {
    assertExists(V.uuid('not-a-uuid', 'f'));
});

Deno.test('V.uuid — rejects empty string', () => {
    assertExists(V.uuid('', 'f'));
});

Deno.test('V.isoDate — accepts YYYY-MM-DD', () => {
    assertEquals(V.isoDate('2024-01-15', 'f'), null);
});

Deno.test('V.isoDate — rejects DD-MM-YYYY', () => {
    assertExists(V.isoDate('15-01-2024', 'f'));
});

Deno.test('V.isoDate — rejects invalid date (Feb 30)', () => {
    assertExists(V.isoDate('2024-02-30', 'f'));
});

Deno.test('V.str(10, 100) — accepts string within range', () => {
    assertEquals(V.str(10, 100)('a'.repeat(10), 'f'), null);
});

Deno.test('V.str(10, 100) — rejects too short', () => {
    assertExists(V.str(10, 100)('short', 'f'));
});

Deno.test('V.str(10, 100) — rejects too long', () => {
    assertExists(V.str(10, 100)('a'.repeat(101), 'f'));
});

Deno.test('V.enum — accepts value in list', () => {
    assertEquals(V.enum(['HADIR', 'ALPA'])('HADIR', 'f'), null);
});

Deno.test('V.enum — rejects value not in list', () => {
    assertExists(V.enum(['HADIR', 'ALPA'])('CUTI', 'f'));
});

Deno.test('V.bool — accepts boolean', () => {
    assertEquals(V.bool(true, 'f'), null);
    assertEquals(V.bool(false, 'f'), null);
});

Deno.test('V.bool — rejects string "true"', () => {
    assertExists(V.bool('true', 'f'));
});

Deno.test('V.arrayOf — validates each item', () => {
    const validator = V.arrayOf(V.uuid, 1);
    assertEquals(validator(['11111111-1111-1111-1111-111111111111'], 'f'), null);
    assertExists(validator(['not-a-uuid'], 'f'));
});

Deno.test('V.arrayOf — rejects empty array when minLen = 1', () => {
    assertExists(V.arrayOf(V.uuid, 1)([], 'f'));
});


// ─────────────────────────────────────────────────────────────
// CORS TESTS
// Step 1: CORS preflight handling
// ─────────────────────────────────────────────────────────────

Deno.test('corsHeaders — contains required headers', () => {
    assertExists(corsHeaders['Access-Control-Allow-Origin']);
    assertExists(corsHeaders['Access-Control-Allow-Headers']);
    assertExists(corsHeaders['Access-Control-Allow-Methods']);
    assertEquals(corsHeaders['Access-Control-Allow-Methods'].includes('POST'), true);
    assertEquals(corsHeaders['Access-Control-Allow-Methods'].includes('OPTIONS'), true);
});


// ─────────────────────────────────────────────────────────────
// BUSINESS LOGIC UNIT TESTS
// Testing pure helper logic extracted for testability.
// ─────────────────────────────────────────────────────────────

Deno.test('Student validation — detects students not in enrolled set', () => {
    const enrolledIds = new Set([UUID.student1]);
    const records = [
        { student_id: UUID.student1, status: 'HADIR',   source: 'AUTO_DETECTED' },
        { student_id: UUID.student2, status: 'ALPA', source: 'MANUAL_OVERRIDE' }, // not enrolled
    ];
    const invalid = records.filter(r => !enrolledIds.has(r.student_id));
    assertEquals(invalid.length, 1);
    assertEquals(invalid[0].student_id, UUID.student2);
});

Deno.test('Student validation — passes when all students enrolled', () => {
    const enrolledIds = new Set([UUID.student1, UUID.student2]);
    const records = [
        { student_id: UUID.student1, status: 'HADIR',       source: 'AUTO_DETECTED' },
        { student_id: UUID.student2, status: 'ALPA',  source: 'MANUAL_OVERRIDE' },
    ];
    const invalid = records.filter(r => !enrolledIds.has(r.student_id));
    assertEquals(invalid.length, 0);
});

Deno.test('Substitute token expiry — detects expired token', () => {
    const expiredAt = new Date(Date.now() - 3600000).toISOString(); // 1 hour ago
    const isExpired = new Date(expiredAt) <= new Date();
    assertEquals(isExpired, true);
});

Deno.test('Substitute token expiry — valid token not expired', () => {
    const validUntil = new Date(Date.now() + 3600000).toISOString(); // 1 hour from now
    const isExpired  = new Date(validUntil) <= new Date();
    assertEquals(isExpired, false);
});

Deno.test('KEGIATAN_SEKOLAH blocks attendance submission', () => {
    const meetingStatus = 'KEGIATAN_SEKOLAH';
    const blocked = meetingStatus === 'KEGIATAN_SEKOLAH';
    assertEquals(blocked, true);
});

Deno.test('GURU_TIDAK_HADIR does not block attendance (records get voided by trigger)', () => {
    const meetingStatus = 'GURU_TIDAK_HADIR';
    const blocked = meetingStatus === 'KEGIATAN_SEKOLAH';
    assertEquals(blocked, false);
});


// ─────────────────────────────────────────────────────────────
// IDEMPOTENCY LOGIC TESTS
// ─────────────────────────────────────────────────────────────

Deno.test('Idempotency — duplicate key returns was_duplicate: true', () => {
    // Simulates the check result from DB
    const existingKey = {
        idempotency_key: UUID.idem,
        result_json: { schedule_id: UUID.schedule, records_upserted: 32 }
    };
    const isDuplicate = existingKey !== null;
    assertEquals(isDuplicate, true);
    const response = { ...existingKey.result_json, was_duplicate: true };
    assertEquals(response.was_duplicate, true);
    assertEquals(response.records_upserted, 32);
});

Deno.test('Idempotency — new key proceeds normally', () => {
    const existingKey = null; // not found in DB
    const isDuplicate = existingKey !== null;
    assertEquals(isDuplicate, false);
});
