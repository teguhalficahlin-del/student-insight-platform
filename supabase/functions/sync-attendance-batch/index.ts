/**
 * @file sync-attendance-batch/index.ts
 * @edge-function sync-attendance-batch
 * @version 1.0.0
 *
 * Submits attendance for one complete teaching session.
 *
 * CONTRACT (from 11_api_contract_reference.md):
 *   POST /functions/v1/sync-attendance-batch
 *   Idempotent: UPSERT keyed on (schedule_id, student_id)
 *   One call per session — not per student
 *
 * PROCESSING SEQUENCE:
 *   1.  CORS preflight
 *   2.  Schema version check
 *   3.  Auth: verify JWT + resolve user row
 *   4.  Parse + validate request body
 *   5.  Idempotency check (was this batch already processed?)
 *   6.  Permission check: is this user allowed to submit for this schedule?
 *   7.  Schedule verification: does the schedule exist, is it not CLOSED?
 *   8.  Substitute token validation (if provided)
 *   9.  DB transaction:
 *         a. UPSERT attendance records
 *         b. UPDATE teaching_schedules.meeting_status (if provided)
 *         c. INSERT teacher_attendance_log signal
 *  10.  Response
 *
 * IDEMPOTENCY:
 *   Keyed on idempotency_key stored in a dedicated column on
 *   attendance records (added via migration if not present).
 *   If the same idempotency_key is received twice, return 200
 *   with { was_duplicate: true } and the original result.
 *   The DB UPSERT itself is safe to replay regardless.
 */

import { handleCors, corsHeaders }     from '../_shared/cors.ts';
import { ok, badRequest, unauthorized,
         forbidden, internalError,
         checkSchemaVersion }          from '../_shared/response.ts';
import { resolveAuth, isAuthError }    from '../_shared/auth.ts';
import { validatePayload,
         ATTENDANCE_BATCH_SCHEMA }     from '../_shared/validate.ts';
import { getAdminClient }              from '../_shared/db.ts';


// ─────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────

interface AttendanceRecord {
    student_id: string;
    status:     string;
    source:     string;
    notes?:     string;
}

interface AttendanceBatchPayload {
    idempotency_key:  string;
    schedule_id:      string;
    submitted_by:     string;
    session_date:     string;
    records:          AttendanceRecord[];
    substitute_token?: string;
    meeting_status?:  string;
}

interface ScheduleRow {
    schedule_id:          string;
    class_id:             string;
    scheduled_teacher_id: string;
    session_date:         string;
    meeting_status:       string;
    teacher_indicator:    string;
    academic_year:        string;
    semester:             string;
}

interface SubstituteRow {
    substitute_id:              string;
    substitute_user_id:         string;
    sync_token:                 string;
    sync_token_expires_at:      string;
}


// ─────────────────────────────────────────────────────────────
// MAIN HANDLER
// ─────────────────────────────────────────────────────────────

Deno.serve(async (req: Request): Promise<Response> => {

    // ── 1. CORS preflight ─────────────────────────────────────
    if (req.method === 'OPTIONS') return handleCors();
    if (req.method !== 'POST') {
        return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });
    }

    try {
        // ── 2. Schema version ──────────────────────────────────
        const versionError = checkSchemaVersion(req);
        if (versionError) return versionError;

        // ── 3. Auth ───────────────────────────────────────────
        const admin      = getAdminClient();
        const authResult = await resolveAuth(req, admin);
        if (isAuthError(authResult)) return authResult;
        const { user } = authResult;

        // ── 4. Parse + validate body ──────────────────────────
        let body: Record<string, unknown>;
        try {
            body = await req.json();
        } catch {
            return badRequest('Request body harus berupa JSON yang valid');
        }

        const validation = validatePayload(ATTENDANCE_BATCH_SCHEMA, body);
        if (!validation.valid) {
            return badRequest('Payload tidak valid', validation.errors);
        }

        const payload = body as unknown as AttendanceBatchPayload;

        // ── 5. Idempotency check ──────────────────────────────
        // Check if we already have any attendance rows from this idempotency_key.
        // We store idempotency_key as metadata on the first record of the batch.
        // Using a dedicated idempotency table is cleaner but adds complexity —
        // for attendance, UPSERT itself is idempotent, so we check for existing
        // records with this key via a side-channel metadata column approach.
        //
        // Implementation: store idempotency_key in a sync_idempotency table.
        const { data: existingKey } = await admin
            .from('sync_idempotency')
            .select('idempotency_key, result_json')
            .eq('idempotency_key', payload.idempotency_key)
            .maybeSingle();

        if (existingKey) {
            // Already processed — return the original result
            return ok({
                ...(existingKey.result_json ?? {
                    schedule_id:      payload.schedule_id,
                    records_upserted: payload.records.length,
                }),
                was_duplicate: true,
            });
        }

        // ── 6. Permission check ───────────────────────────────
        // Fetch the schedule to verify teacher assignment
        const { data: schedule, error: schedErr } = await admin
            .from('teaching_schedules')
            .select('schedule_id, class_id, scheduled_teacher_id, session_date, meeting_status, teacher_indicator, academic_year, semester')
            .eq('schedule_id', payload.schedule_id)
            .maybeSingle() as { data: ScheduleRow | null; error: unknown };

        if (schedErr || !schedule) {
            return badRequest(`Jadwal tidak ditemukan: ${payload.schedule_id}`);
        }

        // Permission: must be assigned teacher or valid substitute
        const isAssignedTeacher = schedule.scheduled_teacher_id === user.user_id;
        let   isValidSubstitute = false;

        if (!isAssignedTeacher) {
            // Check substitute_schedules
            const { data: substitute } = await admin
                .from('substitute_schedules')
                .select('substitute_id, substitute_user_id, sync_token, sync_token_expires_at')
                .eq('schedule_id', payload.schedule_id)
                .eq('substitute_user_id', user.user_id)
                .maybeSingle() as { data: SubstituteRow | null; error: unknown };

            if (substitute) {
                // Validate token if provided
                if (payload.substitute_token && payload.substitute_token !== substitute.sync_token) {
                    return forbidden('Token guru pengganti tidak valid');
                }
                // Validate expiry
                if (new Date(substitute.sync_token_expires_at) <= new Date()) {
                    return forbidden(
                        'Token guru pengganti sudah kedaluwarsa. ' +
                        'Hubungi administrator untuk mendapatkan token baru.'
                    );
                }
                isValidSubstitute = true;
            }
        }

        if (!isAssignedTeacher && !isValidSubstitute) {
            return forbidden(
                'Hanya guru yang bertugas atau guru pengganti yang valid ' +
                'dapat mengisi absensi untuk jadwal ini'
            );
        }

        // ── 7. Schedule state check ───────────────────────────
        // Cannot submit attendance for a session that already has
        // meeting_status = KEGIATAN_SEKOLAH (no students expected)
        if (schedule.meeting_status === 'KEGIATAN_SEKOLAH') {
            return forbidden(
                'Tidak dapat mengisi absensi untuk sesi kegiatan sekolah'
            );
        }

        // ── 8. Validate student IDs exist in this class ───────
        // Fetch enrolled student IDs for this class + period
        const { data: enrollments } = await admin
            .from('class_enrollments')
            .select('student_id')
            .eq('class_id', schedule.class_id)
            .eq('academic_year', schedule.academic_year)
            .eq('semester', schedule.semester)
            .is('withdrawn_at', null);

        const enrolledIds = new Set((enrollments ?? []).map((e: { student_id: string }) => e.student_id));
        const invalidStudents = payload.records
            .filter(r => !enrolledIds.has(r.student_id))
            .map(r => r.student_id);

        if (invalidStudents.length > 0) {
            return badRequest(
                `${invalidStudents.length} siswa tidak terdaftar di kelas ini`,
                invalidStudents.map(id => `student_id tidak terdaftar: ${id}`)
            );
        }

        // DROPOUT-1 (Tema I): tolak siswa non-AKTIF (KELUAR/LULUS/PKL). Roster
        // online+offline sudah menyaringnya, tetapi klien offline yang basi bisa
        // saja masih menyimpan siswa yang keluar — cegah di sini.
        const { data: statusRows } = await admin
            .from('students')
            .select('student_id, student_status')
            .in('student_id', payload.records.map(r => r.student_id));

        const nonAktif = (statusRows ?? [])
            .filter((s: { student_status: string }) => s.student_status !== 'AKTIF')
            .map((s: { student_id: string }) => s.student_id);

        if (nonAktif.length > 0) {
            return badRequest(
                `${nonAktif.length} siswa tidak berstatus AKTIF (mis. sudah keluar/PKL) — tidak diabsen di kelas`,
                nonAktif.map(id => `student_id non-aktif: ${id}`)
            );
        }

        // ── 9. DB Transaction ─────────────────────────────────
        // Supabase JS does not support multi-statement transactions.
        // We use a Postgres RPC function to atomically:
        //   a. UPSERT attendance records
        //   b. UPDATE meeting_status if provided
        //   c. INSERT teacher_attendance_log
        //   d. INSERT idempotency record

        const rpcParams = {
            p_schedule_id:      payload.schedule_id,
            p_submitted_by:     user.user_id,
            p_records:          payload.records,
            p_meeting_status:   payload.meeting_status ?? null,
            p_idempotency_key:  payload.idempotency_key,
            p_is_substitute:    isValidSubstitute,
        };

        const { data: rpcResult, error: rpcError } = await admin
            .rpc('fn_sync_attendance_batch', rpcParams);

        if (rpcError) {
            // Check for known domain errors from DB
            const msg = (rpcError as { message?: string }).message ?? '';

            if (msg.includes('domain_invariant_violation')) {
                return forbidden(`Pelanggaran aturan domain: ${msg}`);
            }

            console.error('[sync-attendance-batch] RPC error:', rpcError);
            return internalError(rpcError);
        }

        // ── 10. Response ──────────────────────────────────────
        const result = {
            schedule_id:      payload.schedule_id,
            records_upserted: (rpcResult as { records_upserted?: number })?.records_upserted
                              ?? payload.records.length,
            was_duplicate:    false,
        };

        return ok(result);

    } catch (err) {
        return internalError(err);
    }
});


// ─────────────────────────────────────────────────────────────
// COMPANION: Postgres function called by this Edge Function
//
// This function must exist in the DB before this Edge Function
// can be deployed. Add to a migration file or run manually.
//
// File: supabase/migrations/20240115_fn_sync_attendance_batch.sql
// ─────────────────────────────────────────────────────────────

/*
CREATE OR REPLACE FUNCTION fn_sync_attendance_batch(
    p_schedule_id       UUID,
    p_submitted_by      UUID,
    p_records           JSONB,
    p_meeting_status    meeting_status DEFAULT NULL,
    p_idempotency_key   TEXT DEFAULT NULL,
    p_is_substitute     BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER   -- runs as owner, bypasses RLS for writes
AS $$
DECLARE
    v_record        JSONB;
    v_count         INTEGER := 0;
    v_activity_type VARCHAR(50);
BEGIN
    -- a. UPSERT attendance records
    FOR v_record IN SELECT * FROM jsonb_array_elements(p_records)
    LOOP
        INSERT INTO attendance (
            schedule_id, student_id, status, source,
            recorded_by_user_id, is_void
        )
        VALUES (
            p_schedule_id,
            (v_record->>'student_id')::UUID,
            (v_record->>'status')::attendance_status,
            (v_record->>'source')::attendance_source,
            p_submitted_by,
            FALSE
        )
        ON CONFLICT (schedule_id, student_id)
        DO UPDATE SET
            status               = EXCLUDED.status,
            source               = EXCLUDED.source,
            recorded_by_user_id  = EXCLUDED.recorded_by_user_id,
            updated_at           = NOW()
        WHERE attendance.is_void = FALSE;

        v_count := v_count + 1;
    END LOOP;

    -- b. UPDATE meeting_status if provided
    IF p_meeting_status IS NOT NULL THEN
        UPDATE teaching_schedules
        SET meeting_status = p_meeting_status,
            updated_at     = NOW()
        WHERE schedule_id = p_schedule_id;
        -- Note: if GURU_TIDAK_HADIR, trg_void_session_attendance fires automatically
    END IF;

    -- c. INSERT teacher_attendance_log signal
    v_activity_type := CASE
        WHEN p_is_substitute THEN 'SUBSTITUTE_ATTENDANCE_SUBMITTED'
        ELSE 'ATTENDANCE_SUBMITTED'
    END;

    INSERT INTO teacher_attendance_log (schedule_id, user_id, activity_type)
    SELECT p_schedule_id, p_submitted_by, v_activity_type
    WHERE EXISTS (
        SELECT 1 FROM teaching_schedules
        WHERE schedule_id       = p_schedule_id
          AND session_date      = CURRENT_DATE
          AND teacher_indicator = 'PENDING_EVALUATION'
    )
    ON CONFLICT DO NOTHING;

    -- d. Record idempotency key
    IF p_idempotency_key IS NOT NULL THEN
        INSERT INTO sync_idempotency (
            idempotency_key, function_name, result_json, created_at
        ) VALUES (
            p_idempotency_key,
            'sync-attendance-batch',
            jsonb_build_object('schedule_id', p_schedule_id, 'records_upserted', v_count),
            NOW()
        )
        ON CONFLICT (idempotency_key) DO NOTHING;
    END IF;

    RETURN jsonb_build_object('records_upserted', v_count);
END;
$$;
*/
