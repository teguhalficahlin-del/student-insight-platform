-- Tambah subject_label ke teaching_schedules
-- Disalin dari schedule_templates saat generate sesi
ALTER TABLE teaching_schedules
  ADD COLUMN IF NOT EXISTS subject_label VARCHAR(50);

-- Isi subject_label dari schedule_templates yang matching
-- Match berdasarkan: school_id, class_id, scheduled_teacher_id,
-- day_of_week (dari session_date), start_time (dari session_start)
UPDATE teaching_schedules ts
SET subject_label = st.subject_label
FROM schedule_templates st
WHERE ts.school_id = st.school_id
  AND ts.class_id = st.class_id
  AND ts.scheduled_teacher_id = st.teacher_id
  AND st.day_of_week = CASE EXTRACT(DOW FROM ts.session_date)
    WHEN 1 THEN 'SENIN'::day_of_week
    WHEN 2 THEN 'SELASA'::day_of_week
    WHEN 3 THEN 'RABU'::day_of_week
    WHEN 4 THEN 'KAMIS'::day_of_week
    WHEN 5 THEN 'JUMAT'::day_of_week
    WHEN 6 THEN 'SABTU'::day_of_week
  END
  AND st.start_time = ts.session_start
  AND st.subject_label IS NOT NULL;
