-- ============================================================
-- DROPOUT-1 (Tema I audit absensi) — roster absensi hanya siswa AKTIF
-- ============================================================
-- Siswa KELUAR (drop-out) hanya diubah student_status='KELUAR' tanpa menutup
-- enrolmen (withdrawn_at tetap NULL). Roster absensi (online + offline) hanya
-- menyaring withdrawn_at, sehingga siswa KELUAR tetap muncul & terus ditandai.
-- Perbaikan: view manifest offline hanya memuat siswa student_status='AKTIF'.
-- (Sisi online: guru/js/api.js getEnrolledStudents; sisi edge: sync-attendance-batch.)
-- Visibilitas/riwayat TIDAK diubah — staf tetap bisa melihat catatan lama.
-- Keputusan: roster kelas = AKTIF saja (PKL diabsen via pkl_attendance).
-- ============================================================

CREATE OR REPLACE VIEW v_offline_sync_manifest_guru
    WITH (security_invoker = true) AS
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
     JOIN students st ON st.student_id = ce.student_id AND st.student_status = 'AKTIF'
     LEFT JOIN attendance a ON a.schedule_id = ts.schedule_id AND a.student_id = st.student_id AND a.is_void = false
  WHERE ts.session_date >= CURRENT_DATE AND ts.session_date <= (CURRENT_DATE + '7 days'::interval)
  GROUP BY ts.schedule_id, ts.session_date, ts.session_start, ts.session_end, ts.class_id, c.name, ts.subject_id, s.name, ts.scheduled_teacher_id, ts.meeting_status;

CREATE OR REPLACE VIEW v_offline_sync_manifest_substitute
    WITH (security_invoker = true) AS
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
     JOIN students st ON st.student_id = ce.student_id AND st.student_status = 'AKTIF'
     LEFT JOIN attendance a ON a.schedule_id = ts.schedule_id AND a.student_id = st.student_id AND a.is_void = false
  WHERE ss.sync_token_expires_at > now()
  GROUP BY ts.schedule_id, ts.session_date, ts.session_start, ts.session_end, ts.class_id, c.name, ts.subject_id, s.name, ss.substitute_user_id, ss.sync_token, ss.sync_token_expires_at, ts.meeting_status;
