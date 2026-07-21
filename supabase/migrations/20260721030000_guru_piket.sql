-- SIP SMK: Guru Piket — duty_schedules + late_arrivals
-- Mencakup: tabel, fungsi helper, RLS (4 policy duty + 5 policy late)

-- ── 1. Tabel duty_schedules ──────────────────────────────────────
CREATE TABLE public.duty_schedules (
    duty_id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id           UUID NOT NULL REFERENCES schools(school_id),
    user_id             UUID NOT NULL REFERENCES users(user_id),
    day_of_week         day_of_week NOT NULL,
    academic_year       TEXT NOT NULL,
    semester            INT NOT NULL CHECK (semester IN (1,2)),
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    assigned_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    assigned_by_user_id UUID REFERENCES users(user_id),
    UNIQUE (school_id, user_id, day_of_week, academic_year, semester)
);
ALTER TABLE duty_schedules ENABLE ROW LEVEL SECURITY;

-- ── 2. Tabel late_arrivals ───────────────────────────────────────
CREATE TABLE public.late_arrivals (
    late_id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id           UUID NOT NULL REFERENCES schools(school_id),
    student_id          UUID NOT NULL REFERENCES students(student_id),
    recorded_by         UUID NOT NULL REFERENCES users(user_id),
    late_date           DATE NOT NULL DEFAULT CURRENT_DATE,
    arrival_time        TIME NOT NULL,
    reason              TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE late_arrivals ENABLE ROW LEVEL SECURITY;

-- ── 3. Fungsi helper ─────────────────────────────────────────────
-- Cek apakah user sedang bertugas piket hari ini
CREATE OR REPLACE FUNCTION fn_is_on_duty_today()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM duty_schedules ds
        WHERE ds.user_id      = fn_current_user_id()
          AND ds.school_id    = fn_current_school_id()
          AND ds.day_of_week  = (
              CASE EXTRACT(ISODOW FROM NOW())
                WHEN 1 THEN 'SENIN'::day_of_week
                WHEN 2 THEN 'SELASA'::day_of_week
                WHEN 3 THEN 'RABU'::day_of_week
                WHEN 4 THEN 'KAMIS'::day_of_week
                WHEN 5 THEN 'JUMAT'::day_of_week
                WHEN 6 THEN 'SABTU'::day_of_week
              END
          )
          AND ds.is_active = TRUE
    );
$$;
REVOKE EXECUTE ON FUNCTION fn_is_on_duty_today() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION fn_is_on_duty_today() FROM anon;
GRANT  EXECUTE ON FUNCTION fn_is_on_duty_today() TO authenticated;

-- ── 4. RLS duty_schedules ────────────────────────────────────────
-- Baca: semua staf sekolah bisa lihat jadwal piket
CREATE POLICY rls_duty_schedules_read ON duty_schedules
FOR SELECT USING (
    school_id = fn_current_school_id()
    AND fn_current_user_role() = ANY (ARRAY[
        'GURU','BK','WALI_KELAS','KEPSEK',
        'WAKA_KURIKULUM','WAKA_KESISWAAN','WAKA_HUMAS','ADMINISTRATIVE'
    ]::role_type[])
);
-- Write: hanya admin/kepsek yang bisa assign
CREATE POLICY rls_duty_schedules_write ON duty_schedules
FOR ALL USING (
    school_id = fn_current_school_id()
    AND (fn_current_user_role() = 'ADMINISTRATIVE'::role_type OR fn_is_kepsek())
);

-- ── 5. RLS late_arrivals ─────────────────────────────────────────
-- Baca staf: guru piket hari ini + kepsek + waka kesiswaan
CREATE POLICY rls_late_arrivals_read_staff ON late_arrivals
FOR SELECT USING (
    school_id = fn_current_school_id()
    AND (
        fn_is_on_duty_today()
        OR fn_is_kepsek()
        OR fn_is_waka_kesiswaan()
        OR fn_current_user_role() = 'ADMINISTRATIVE'::role_type
    )
);
-- Baca siswa: hanya keterlambatan diri sendiri
CREATE POLICY rls_late_arrivals_read_student ON late_arrivals
FOR SELECT USING (
    school_id = fn_current_school_id()
    AND fn_current_user_role() = 'SISWA'::role_type
    AND EXISTS (
        SELECT 1 FROM students s
        WHERE s.student_id = late_arrivals.student_id
          AND s.user_id    = fn_current_user_id()
          AND s.school_id  = fn_current_school_id()
    )
);
-- Baca ortu: keterlambatan anak sendiri
CREATE POLICY rls_late_arrivals_read_parent ON late_arrivals
FOR SELECT USING (
    school_id = fn_current_school_id()
    AND fn_current_user_role() = 'ORTU'::role_type
    AND EXISTS (
        SELECT 1 FROM student_parents sp
        WHERE sp.student_id    = late_arrivals.student_id
          AND sp.parent_user_id = fn_current_user_id()
    )
);
-- Insert: hanya guru piket hari ini
CREATE POLICY rls_late_arrivals_insert ON late_arrivals
FOR INSERT WITH CHECK (
    school_id = fn_current_school_id()
    AND fn_is_on_duty_today()
    AND recorded_by = fn_current_user_id()
);
