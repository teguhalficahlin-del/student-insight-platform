-- Migration: 20260709010000_fix_case_events_student_updates_rls.sql
--
-- Menutup regresi ke-3 dari migration 20260708060000 (Rule 3 violation):
-- rls_case_events_read_student, rls_case_events_read_parent, dan
-- rls_student_updates_read_student menggunakan EXISTS langsung ke tabel
-- `cases` di dalam USING clause. EXISTS itu tunduk RLS pemanggil (Rule 3).
-- Setelah 20260708060000 men-DROP rls_cases_read_student/parent, SISWA dan
-- ORTU tidak lagi punya SELECT policy di tabel `cases` → EXISTS selalu
-- false → ketiga policy NON-FUNGSIONAL: siswa/ortu tidak bisa baca apapun
-- dari case_events/student_updates, bahkan jika ada di audience.
--
-- Fix: ganti EXISTS langsung ke `cases` dengan fn_can_see_case(case_id).
-- fn_can_see_case adalah SECURITY DEFINER — bypass RLS pemanggil (Rule 3
-- aman), dan sudah mengandung pengecekan case_audience_members untuk kasus
-- RESTRICTED. Branch 4 di fn_can_see_case tidak punya filter role sehingga
-- mencakup ORTU secara implisit — tidak perlu modifikasi fn_can_see_case.
--
-- (e) rls_student_updates_read_parent BELUM diaktifkan — menunggu keputusan
-- Romo apakah ORTU perlu lihat student_updates. Uncomment jika ya.
--
-- Investigasi Langkah 1 (8 Juli 2026):
--   - student_updates TIDAK punya kolom privacy_level (kolom tidak exist)
--   - Tidak ada client code yang menulis langsung ke student_updates — hanya
--     via trigger/edge function (event_type STUDENT_UPDATE_ADDED)
--   - Tidak ada UI guru untuk memilih privacy_level di student_updates

-- (b) Fix rls_case_events_read_student
DROP POLICY IF EXISTS rls_case_events_read_student ON public.case_events;
CREATE POLICY rls_case_events_read_student ON public.case_events
  FOR SELECT USING (
    school_id = fn_current_school_id()
    AND fn_current_user_role() = 'SISWA'::role_type
    AND privacy_level = 'STUDENT_VISIBLE'::visibility_level
    AND fn_can_see_case(case_id)
  );

-- (c) Fix rls_case_events_read_parent
DROP POLICY IF EXISTS rls_case_events_read_parent ON public.case_events;
CREATE POLICY rls_case_events_read_parent ON public.case_events
  FOR SELECT USING (
    school_id = fn_current_school_id()
    AND fn_current_user_role() = 'ORTU'::role_type
    AND privacy_level = 'STUDENT_VISIBLE'::visibility_level
    AND fn_can_see_case(case_id)
  );

-- (d) Fix rls_student_updates_read_student
-- student_updates tidak punya kolom privacy_level — tidak ada filter privacy
DROP POLICY IF EXISTS rls_student_updates_read_student ON public.student_updates;
CREATE POLICY rls_student_updates_read_student ON public.student_updates
  FOR SELECT USING (
    school_id = fn_current_school_id()
    AND fn_current_user_role() = 'SISWA'::role_type
    AND fn_can_see_case(case_id)
  );

-- (e) rls_student_updates_read_parent
-- ORTU yang diundang eksplisit ke kasus RESTRICTED bisa membaca student_updates
-- (narasi perkembangan siswa) — simetris dengan rls_case_events_read_parent.
-- Keputusan Romo: YA, aktifkan. T4 memverifikasi 1 baris (✓ LULUS).
DROP POLICY IF EXISTS rls_student_updates_read_parent ON public.student_updates;
CREATE POLICY rls_student_updates_read_parent ON public.student_updates
  FOR SELECT USING (
    school_id = fn_current_school_id()
    AND fn_current_user_role() = 'ORTU'::role_type
    AND fn_can_see_case(case_id)
  );

-- (f) Fix rls_case_events_read_staff — tambah role restriction untuk blokir SISWA/ORTU
--
-- TEMUAN (uji BEGIN...ROLLBACK 8 Juli 2026):
-- rls_case_events_read_staff TIDAK punya filter role — USING clause-nya hanya
-- `school_id = fn_current_school_id() AND fn_can_see_case(case_id)`.
-- Setelah migration 20260708060000, fn_can_see_case bisa return TRUE untuk
-- SISWA/ORTU yang ada di case_audience_members kasus RESTRICTED.
-- Akibatnya, RLS OR-ing: policy staff (tanpa filter privacy_level) override
-- policy siswa/ortu (dengan filter STUDENT_VISIBLE) → siswa/ortu bisa baca
-- event INTERNAL_SCHOOL. Ini BUG LIVE sekarang.
--
-- Fix: tambah NOT IN (SISWA, ORTU) ke USING clause rls_case_events_read_staff.
-- Siswa/ortu tetap bisa baca via rls_case_events_read_student/parent
-- (yang punya filter privacy_level = STUDENT_VISIBLE).
DROP POLICY IF EXISTS rls_case_events_read_staff ON public.case_events;
CREATE POLICY rls_case_events_read_staff ON public.case_events
  FOR SELECT USING (
    school_id = fn_current_school_id()
    AND fn_current_user_role() NOT IN ('SISWA'::role_type, 'ORTU'::role_type)
    AND fn_can_see_case(case_id)
  );
