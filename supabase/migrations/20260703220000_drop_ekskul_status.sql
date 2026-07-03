-- ============================================================
-- Migration 20260703220000: Hapus TOTAL status EKSKUL dari absensi
--
-- Keputusan 3 Juli 2026: EKSKUL dihapus. Status absensi resmi kini
-- hanya HADIR / TIDAK_HADIR (Alpa) / IZIN / SAKIT. Siswa yang ikut
-- kegiatan ekstrakurikuler cukup ditandai HADIR.
--
-- Konteks: platform masih tahap penyempurnaan, belum ada sekolah yang
-- memakai. Introspeksi live: 0 baris attendance, 0 baris EKSKUL → tanpa
-- risiko data.
--
-- Dependensi enum attendance_status (diverifikasi via pg_depend + pg_rewrite):
--   Kolom: attendance.status, pkl_attendance.status (default HADIR).
--   View yang menyentuh attendance.status (harus di-drop sebelum retype):
--     - v_attendance_daily_summary  (punya kolom ekskul → DIHAPUS)
--     - v_kepsek_exception_dashboard (bergantung pd summary; pakai hadir_pct)
--     - v_offline_sync_manifest_guru       (pass-through COALESCE(status,'HADIR'))
--     - v_offline_sync_manifest_substitute (idem)
--   TIDAK ada fungsi ber-argumen/return bertipe attendance_status.
--   Semua view: owner postgres, reloptions null (bukan security_invoker);
--   grant di-reproduksi otomatis oleh default privileges (seperti view lain).
--
-- ROLLBACK:
--   ALTER TYPE attendance_status ADD VALUE 'EKSKUL';
--   lalu recreate v_attendance_daily_summary + v_kepsek_exception_dashboard
--   dengan kolom ekskul (versi sebelum commit ini di contracts/07).
-- ============================================================

BEGIN;

-- 1. Amankan: konversi sisa EKSKUL (0 diharapkan) → HADIR
UPDATE attendance     SET status = 'HADIR' WHERE status = 'EKSKUL';
UPDATE pkl_attendance SET status = 'HADIR' WHERE status = 'EKSKUL';

-- 2. Drop semua view yang bergantung pada attendance.status (urut dependensi)
DROP VIEW IF EXISTS v_kepsek_exception_dashboard;
DROP VIEW IF EXISTS v_offline_sync_manifest_guru;
DROP VIEW IF EXISTS v_offline_sync_manifest_substitute;
DROP VIEW IF EXISTS v_attendance_daily_summary;

-- 3. Recreate enum TANPA 'EKSKUL' (Postgres tak bisa DROP VALUE langsung)
ALTER TYPE attendance_status RENAME TO attendance_status_old;
CREATE TYPE attendance_status AS ENUM ('HADIR', 'TIDAK_HADIR', 'IZIN', 'SAKIT');

ALTER TABLE attendance     ALTER COLUMN status DROP DEFAULT;
ALTER TABLE attendance     ALTER COLUMN status TYPE attendance_status USING status::text::attendance_status;
ALTER TABLE attendance     ALTER COLUMN status SET DEFAULT 'HADIR';

ALTER TABLE pkl_attendance ALTER COLUMN status DROP DEFAULT;
ALTER TABLE pkl_attendance ALTER COLUMN status TYPE attendance_status USING status::text::attendance_status;
ALTER TABLE pkl_attendance ALTER COLUMN status SET DEFAULT 'HADIR';

DROP TYPE attendance_status_old;

-- 4. Recreate v_attendance_daily_summary TANPA kolom ekskul
CREATE VIEW v_attendance_daily_summary AS
SELECT
    ts.schedule_id,
    ts.session_date,
    ts.class_id,
    c.name                                              AS class_name,
    ts.scheduled_teacher_id,
    u.full_name                                         AS teacher_name,
    ts.meeting_status,
    ts.teacher_indicator,
    count(a.attendance_id) FILTER (WHERE a.is_void = false)                              AS total_students,
    count(a.attendance_id) FILTER (WHERE a.status = 'HADIR'       AND a.is_void = false) AS hadir,
    count(a.attendance_id) FILTER (WHERE a.status = 'TIDAK_HADIR' AND a.is_void = false) AS tidak_hadir,
    count(a.attendance_id) FILTER (WHERE a.status = 'IZIN'        AND a.is_void = false) AS izin,
    count(a.attendance_id) FILTER (WHERE a.status = 'SAKIT'       AND a.is_void = false) AS sakit,
    round(
        count(a.attendance_id) FILTER (WHERE a.status = 'HADIR' AND a.is_void = false)::numeric
        / NULLIF(count(a.attendance_id) FILTER (WHERE a.is_void = false), 0)::numeric * 100::numeric,
        1
    )                                                   AS hadir_pct
FROM teaching_schedules ts
    JOIN classes c ON c.class_id = ts.class_id
    JOIN users u   ON u.user_id  = ts.scheduled_teacher_id
    LEFT JOIN attendance a ON a.schedule_id = ts.schedule_id
GROUP BY ts.schedule_id, ts.session_date, ts.class_id, c.name,
         ts.scheduled_teacher_id, u.full_name, ts.meeting_status, ts.teacher_indicator;

COMMENT ON VIEW v_attendance_daily_summary IS
    'Per-schedule attendance aggregation. Used by Kepsek exception dashboard and Wali Kelas class view. RLS inherited from underlying tables.';

-- 4b. Recreate v_kepsek_exception_dashboard (isi identik)
CREATE VIEW v_kepsek_exception_dashboard AS
 SELECT 'LOW_ATTENDANCE'::text          AS exception_type,
    ads.class_id::text                  AS entity_id,
    ads.class_name                      AS entity_label,
    ads.session_date::text              AS context_date,
    ('Kehadiran '::text || ads.hadir_pct) || '%'::text AS detail
   FROM v_attendance_daily_summary ads
  WHERE ads.session_date = CURRENT_DATE AND ads.meeting_status = 'NORMAL' AND ads.hadir_pct < 80::numeric
UNION ALL
 SELECT 'STALE_CASE'::text              AS exception_type,
    c.case_id::text                     AS entity_id,
    c.title                             AS entity_label,
    c.updated_at::date::text            AS context_date,
    ((('Handler: '::text || c.current_handler_role::text) || ' · '::text) || EXTRACT(day FROM now() - c.updated_at)::integer::text) || ' hari'::text AS detail
   FROM cases c
  WHERE c.status <> 'CLOSED'::case_status AND c.updated_at < (now() - '3 days'::interval)
UNION ALL
 SELECT 'TEACHER_ABSENT'::text          AS exception_type,
    ts.scheduled_teacher_id::text       AS entity_id,
    u.full_name                         AS entity_label,
    ts.session_date::text               AS context_date,
    'Kelas: '::text || c.name::text     AS detail
   FROM teaching_schedules ts
     JOIN users u   ON u.user_id  = ts.scheduled_teacher_id
     JOIN classes c ON c.class_id = ts.class_id
  WHERE ts.session_date = CURRENT_DATE AND ts.teacher_indicator = 'TIDAK_HADIR' AND ts.meeting_status = 'NORMAL'
    AND NOT (EXISTS ( SELECT 1 FROM substitute_schedules ss WHERE ss.schedule_id = ts.schedule_id));

COMMENT ON VIEW v_kepsek_exception_dashboard IS
    'Exception-based Kepsek dashboard. Three exception types: LOW_ATTENDANCE, STALE_CASE, TEACHER_ABSENT. Returns only anomalies — not full records.';

-- 4c. Recreate v_offline_sync_manifest_guru (pass-through, isi identik)
CREATE VIEW v_offline_sync_manifest_guru AS
 SELECT ts.schedule_id,
    ts.session_date,
    ts.session_start,
    ts.session_end,
    ts.class_id,
    c.name AS class_name,
    ts.subject_id,
    s.name AS subject_name,
    ts.scheduled_teacher_id,
    ts.meeting_status,
    json_agg(json_build_object('student_id', st.student_id, 'nis', st.nis, 'full_name', st.full_name, 'att_status', COALESCE(a.status, 'HADIR'::attendance_status), 'att_source', COALESCE(a.source::text, 'AUTO_DETECTED'::text), 'att_id', a.attendance_id) ORDER BY st.full_name) AS students_json
   FROM teaching_schedules ts
     JOIN classes c ON c.class_id = ts.class_id
     JOIN subjects s ON s.subject_id = ts.subject_id
     JOIN class_enrollments ce ON ce.class_id = ts.class_id AND ce.academic_year::text = ts.academic_year::text AND ce.semester = ts.semester AND ce.withdrawn_at IS NULL
     JOIN students st ON st.student_id = ce.student_id
     LEFT JOIN attendance a ON a.schedule_id = ts.schedule_id AND a.student_id = st.student_id AND a.is_void = false
  WHERE ts.session_date >= CURRENT_DATE AND ts.session_date <= (CURRENT_DATE + '7 days'::interval)
  GROUP BY ts.schedule_id, ts.session_date, ts.session_start, ts.session_end, ts.class_id, c.name, ts.subject_id, s.name, ts.scheduled_teacher_id, ts.meeting_status;

-- 4d. Recreate v_offline_sync_manifest_substitute (pass-through, isi identik)
CREATE VIEW v_offline_sync_manifest_substitute AS
 SELECT ts.schedule_id,
    ts.session_date,
    ts.session_start,
    ts.session_end,
    ts.class_id,
    c.name AS class_name,
    ts.subject_id,
    s.name AS subject_name,
    ss.substitute_user_id,
    ss.sync_token,
    ss.sync_token_expires_at,
    ts.meeting_status,
    json_agg(json_build_object('student_id', st.student_id, 'nis', st.nis, 'full_name', st.full_name, 'att_status', COALESCE(a.status, 'HADIR'::attendance_status), 'att_source', COALESCE(a.source::text, 'AUTO_DETECTED'::text), 'att_id', a.attendance_id) ORDER BY st.full_name) AS students_json
   FROM substitute_schedules ss
     JOIN teaching_schedules ts ON ts.schedule_id = ss.schedule_id
     JOIN classes c ON c.class_id = ts.class_id
     JOIN subjects s ON s.subject_id = ts.subject_id
     JOIN class_enrollments ce ON ce.class_id = ts.class_id AND ce.academic_year::text = ts.academic_year::text AND ce.semester = ts.semester AND ce.withdrawn_at IS NULL
     JOIN students st ON st.student_id = ce.student_id
     LEFT JOIN attendance a ON a.schedule_id = ts.schedule_id AND a.student_id = st.student_id AND a.is_void = false
  WHERE ss.sync_token_expires_at > now()
  GROUP BY ts.schedule_id, ts.session_date, ts.session_start, ts.session_end, ts.class_id, c.name, ts.subject_id, s.name, ss.substitute_user_id, ss.sync_token, ss.sync_token_expires_at, ts.meeting_status;

COMMIT;
