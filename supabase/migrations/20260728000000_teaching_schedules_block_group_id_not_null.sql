-- Safeguard: block_group_id wajib diisi di setiap INSERT baru
-- ke teaching_schedules. Mencegah silent NULL yang menyebabkan
-- undercounting di fn_class_attendance_summary, fn_kepsek_monitoring,
-- dan fn_attendance_recap_per_class (semua pakai COUNT DISTINCT block_group_id).
-- Prerequisite: semua 29.241 rows sudah terisi (dikonfirmasi 28 Jul 2026).

ALTER TABLE public.teaching_schedules
    ALTER COLUMN block_group_id SET NOT NULL;
