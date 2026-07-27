-- ============================================================
-- Fix: fn_apply_schedule_templates — isi block_group_id saat generate sesi
-- Backfill: isi block_group_id untuk semua baris existing yang NULL
--
-- Root cause: fn_apply_schedule_templates tidak pernah menyertakan
-- block_group_id dalam INSERT teaching_schedules sejak kolom ditambahkan
-- di migration 20260715060000. Backfill awal hanya mengisi data existing
-- saat itu; semua sesi yang di-generate setelahnya tetap NULL.
--
-- Logika grouping (identik dengan 20260715060000):
--   PARTITION BY (scheduled_teacher_id, class_id, session_date)
--   ORDER BY session_start ASC
--   Gap threshold: > 40 menit antara prev session_end dan session_start
--   1 UUID per (teacher, class, date, block_number) unik
-- ============================================================

-- ============================================================
-- BAGIAN A: fn_apply_schedule_templates — INSERT dengan block_group_id
-- ============================================================
-- Disalin persis dari 20260726040000, hanya blok INSERT teaching_schedules
-- terakhir yang distrukturisasi ulang menjadi CTE untuk mengisi block_group_id.

CREATE OR REPLACE FUNCTION public.fn_apply_schedule_templates(
    p_academic_year text, p_semester semester, p_school_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    v_kbm_id    uuid;
    v_start     date;
    v_end       date;
    v_templates integer;
    v_assigns   integer;
    v_schedules integer;

    v_label     text;
    v_subj_id   uuid;
BEGIN
    SELECT count(*) INTO v_templates
    FROM schedule_templates
    WHERE academic_year = p_academic_year AND semester = p_semester
      AND school_id = p_school_id;

    IF v_templates = 0 THEN
        RETURN jsonb_build_object('templates_found', 0, 'assignments_upserted', 0, 'schedules_generated', 0);
    END IF;

    SELECT start_date, end_date INTO v_start, v_end
    FROM academic_periods
    WHERE academic_year = p_academic_year AND semester = p_semester
      AND school_id = p_school_id;

    IF v_start IS NULL THEN
        RAISE EXCEPTION 'Periode akademik % semester % belum terdaftar', p_academic_year, p_semester;
    END IF;

    SELECT subject_id INTO v_kbm_id
    FROM subjects WHERE code = 'KBM' AND school_id = p_school_id;
    IF v_kbm_id IS NULL THEN
        INSERT INTO subjects (code, name, is_active, school_id)
        VALUES ('KBM', 'Kegiatan Belajar Mengajar', true, p_school_id)
        RETURNING subject_id INTO v_kbm_id;
    END IF;

    FOR v_label IN
        SELECT DISTINCT subject_label
        FROM schedule_templates
        WHERE academic_year = p_academic_year AND semester = p_semester
          AND school_id = p_school_id
          AND subject_label IS NOT NULL
          AND TRIM(subject_label) <> ''
    LOOP
        SELECT subject_id INTO v_subj_id
        FROM subjects
        WHERE school_id = p_school_id AND is_active = true
          AND name ILIKE v_label
        LIMIT 1;

        IF v_subj_id IS NULL THEN
            SELECT subject_id INTO v_subj_id
            FROM subjects
            WHERE school_id = p_school_id AND is_active = true
              AND code ILIKE v_label
            LIMIT 1;
        END IF;

        IF v_subj_id IS NULL THEN
            INSERT INTO subjects (code, name, is_active, school_id)
            VALUES (
                UPPER(LEFT(REGEXP_REPLACE(v_label, '\s+', '_', 'g'), 20)),
                v_label,
                true,
                p_school_id
            )
            RETURNING subject_id INTO v_subj_id;
        END IF;
    END LOOP;

    INSERT INTO teaching_assignments
        (user_id, class_id, subject_id, academic_year, semester, is_active, school_id)
    SELECT DISTINCT
        t.teacher_id,
        t.class_id,
        COALESCE(
            (SELECT subject_id FROM subjects
             WHERE school_id = p_school_id AND is_active = true
               AND (name ILIKE t.subject_label OR code ILIKE t.subject_label)
             LIMIT 1),
            v_kbm_id
        ),
        p_academic_year,
        p_semester,
        true,
        p_school_id
    FROM schedule_templates t
    WHERE t.academic_year = p_academic_year
      AND t.semester      = p_semester
      AND t.school_id     = p_school_id
    ON CONFLICT (user_id, class_id, subject_id, academic_year, semester)
    DO UPDATE SET is_active = true;
    GET DIAGNOSTICS v_assigns = ROW_COUNT;

    UPDATE teaching_assignments ta
    SET    is_active = false
    WHERE  ta.school_id     = p_school_id
      AND  ta.academic_year = p_academic_year
      AND  ta.semester      = p_semester
      AND  ta.is_active     = true
      AND  NOT EXISTS (
               SELECT 1
               FROM   schedule_templates st
               WHERE  st.school_id     = p_school_id
                 AND  st.academic_year = p_academic_year
                 AND  st.semester      = p_semester
                 AND  st.teacher_id    = ta.user_id
                 AND  st.class_id      = ta.class_id
           );

    -- Sesi harian: generate dengan block_group_id via CTE window function.
    -- raw_slots: set lengkap slot dari template × generate_series
    -- ordered:   tambah LAG(session_end) sebagai prev_end per partisi
    -- flagged:   hitung is_new_block (1 = awal blok baru)
    -- grouped:   running SUM(is_new_block) = block_number per baris
    -- block_uuids: 1 UUID per (teacher,class,date,block_number) unik
    -- INSERT JOIN block_uuids: setiap baris dalam blok yang sama dapat UUID yang sama.
    --
    -- Known limitation: INSERT parsial ke tanggal yang sudah sebagian terisi
    -- dari template yang sama akan menghasilkan block_group_id berbeda dari
    -- sesi lama meski seharusnya satu blok. Tidak terjadi saat ini karena
    -- semua jalur reapply selalu DELETE penuh dulu sebelum re-INSERT.
    INSERT INTO teaching_schedules
        (assignment_id, class_id, subject_id, scheduled_teacher_id,
         session_date, session_start, session_end, subject_label,
         academic_year, semester, meeting_status, teacher_indicator,
         school_id, block_group_id)
    WITH raw_slots AS (
        SELECT
            a.assignment_id,
            t.class_id,
            COALESCE(
                (SELECT subject_id FROM subjects
                 WHERE school_id = p_school_id AND is_active = true
                   AND (name ILIKE t.subject_label OR code ILIKE t.subject_label)
                 LIMIT 1),
                v_kbm_id
            )                          AS subject_id,
            t.teacher_id               AS scheduled_teacher_id,
            gs.d::date                 AS session_date,
            t.start_time               AS session_start,
            t.end_time                 AS session_end,
            t.subject_label,
            p_academic_year            AS academic_year,
            p_semester                 AS semester,
            'NORMAL'::meeting_status   AS meeting_status,
            'PENDING_EVALUATION'::teacher_attendance_indicator AS teacher_indicator,
            p_school_id                AS school_id
        FROM schedule_templates t
        JOIN teaching_assignments a
          ON a.user_id       = t.teacher_id
         AND a.class_id      = t.class_id
         AND a.subject_id    = COALESCE(
                (SELECT subject_id FROM subjects
                 WHERE school_id = p_school_id AND is_active = true
                   AND (name ILIKE t.subject_label OR code ILIKE t.subject_label)
                 LIMIT 1),
                v_kbm_id
             )
         AND a.academic_year = p_academic_year
         AND a.semester      = p_semester
        JOIN generate_series(v_start::timestamp, v_end::timestamp, interval '1 day') gs(d)
          ON extract(isodow from gs.d) = CASE t.day_of_week::text
                WHEN 'SENIN'  THEN 1 WHEN 'SELASA' THEN 2 WHEN 'RABU' THEN 3
                WHEN 'KAMIS'  THEN 4 WHEN 'JUMAT'  THEN 5 WHEN 'SABTU' THEN 6 END
        WHERE t.academic_year = p_academic_year
          AND t.semester      = p_semester
          AND t.school_id     = p_school_id
    ),
    ordered AS (
        SELECT *,
            LAG(session_end) OVER (
                PARTITION BY scheduled_teacher_id, class_id, session_date
                ORDER BY session_start
            ) AS prev_end
        FROM raw_slots
    ),
    flagged AS (
        SELECT *,
            CASE
                WHEN prev_end IS NULL THEN 1
                WHEN EXTRACT(EPOCH FROM (session_start - prev_end)) / 60 > 40 THEN 1
                ELSE 0
            END AS is_new_block
        FROM ordered
    ),
    grouped AS (
        SELECT *,
            SUM(is_new_block) OVER (
                PARTITION BY scheduled_teacher_id, class_id, session_date
                ORDER BY session_start
                ROWS UNBOUNDED PRECEDING
            ) AS block_number
        FROM flagged
    ),
    block_uuids AS (
        SELECT DISTINCT
            scheduled_teacher_id,
            class_id,
            session_date,
            block_number,
            gen_random_uuid() AS block_uuid
        FROM grouped
    )
    SELECT
        g.assignment_id,
        g.class_id,
        g.subject_id,
        g.scheduled_teacher_id,
        g.session_date,
        g.session_start,
        g.session_end,
        g.subject_label,
        g.academic_year,
        g.semester,
        g.meeting_status,
        g.teacher_indicator,
        g.school_id,
        bu.block_uuid
    FROM grouped g
    JOIN block_uuids bu
      ON  bu.scheduled_teacher_id = g.scheduled_teacher_id
      AND bu.class_id             = g.class_id
      AND bu.session_date         = g.session_date
      AND bu.block_number         = g.block_number
    ON CONFLICT (class_id, scheduled_teacher_id, session_date, session_start)
    DO NOTHING;
    GET DIAGNOSTICS v_schedules = ROW_COUNT;

    RETURN jsonb_build_object(
        'templates_found',      v_templates,
        'assignments_upserted', v_assigns,
        'schedules_generated',  v_schedules
    );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.fn_apply_schedule_templates(text, semester, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_apply_schedule_templates(text, semester, uuid) FROM anon;

-- ============================================================
-- BAGIAN B: Backfill baris existing yang block_group_id IS NULL
-- ============================================================
-- EXPLAIN ANALYZE (dijalankan 2026-07-27 sebelum migration ini ditulis):
--   Seq Scan on teaching_schedules
--   Rows scanned: 29.241 total (25.432 NULL + 3.809 sudah terisi)
--   Execution Time: 584 ms → aman single-shot (jauh < threshold 15 detik)
--
-- CATATAN KRITIS — window function scope:
--   CTE ordered di bawah TIDAK filter block_group_id IS NULL di dalamnya.
--   Filter NULL hanya di UPDATE...WHERE akhir.
--   Ini wajib agar LAG() melihat SEMUA baris di partisi (termasuk yang sudah
--   punya block_group_id dari backfill lama 20260715060000), sehingga urutan
--   gap-detection tetap benar secara global per (teacher, class, date).
--
-- CATATAN — block_uuids pakai COALESCE(MIN...FILTER, gen_random_uuid()):
--   Investigasi (2026-07-27) menemukan 16 baris "grup campuran": sebagian
--   baris dalam satu grup (teacher,class,date,block_number) sudah punya UUID
--   dari backfill 20260715060000, sebagian lagi masih NULL. Query konflik
--   (LANGKAH 1) memastikan 0 grup punya >1 UUID berbeda — setiap grup campuran
--   punya tepat satu UUID lama. MIN dipakai murni untuk pilih nilai deterministik
--   itu; gen_random_uuid() hanya fallback untuk grup yang 100% NULL.

WITH ordered AS (
    SELECT
        schedule_id,
        scheduled_teacher_id,
        class_id,
        session_date,
        session_start,
        block_group_id,
        LAG(session_end) OVER (
            PARTITION BY scheduled_teacher_id, class_id, session_date
            ORDER BY session_start
        ) AS prev_end
    FROM teaching_schedules
),
flagged AS (
    SELECT *,
        CASE
            WHEN prev_end IS NULL THEN 1
            WHEN EXTRACT(EPOCH FROM (session_start - prev_end)) / 60 > 40 THEN 1
            ELSE 0
        END AS is_new_block
    FROM ordered
),
grouped AS (
    SELECT
        schedule_id,
        scheduled_teacher_id,
        class_id,
        session_date,
        block_group_id,
        SUM(is_new_block) OVER (
            PARTITION BY scheduled_teacher_id, class_id, session_date
            ORDER BY session_start
            ROWS UNBOUNDED PRECEDING
        ) AS block_number
    FROM flagged
),
block_uuids AS (
    SELECT
        scheduled_teacher_id,
        class_id,
        session_date,
        block_number,
        COALESCE(
            MIN(block_group_id) FILTER (WHERE block_group_id IS NOT NULL),
            gen_random_uuid()
        ) AS block_uuid
    FROM grouped
    GROUP BY scheduled_teacher_id, class_id, session_date, block_number
)
UPDATE teaching_schedules ts
SET    block_group_id = bu.block_uuid
FROM   grouped g
JOIN   block_uuids bu
    ON  bu.scheduled_teacher_id = g.scheduled_teacher_id
    AND bu.class_id             = g.class_id
    AND bu.session_date         = g.session_date
    AND bu.block_number         = g.block_number
WHERE  ts.schedule_id     = g.schedule_id
  AND  ts.block_group_id IS NULL;
