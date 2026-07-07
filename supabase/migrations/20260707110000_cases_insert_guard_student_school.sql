-- Fix 🔴 CELAH: rls_cases_insert memungkinkan staff sekolah A meng-INSERT
-- kasus dengan school_id=A tapi student_id milik siswa sekolah B.
--
-- Akar masalah: WITH CHECK hanya memvalidasi PKL-status via fn_student_is_on_pkl,
-- yang selalu false untuk siswa sekolah lain → NOT false = true → INSERT lolos.
-- Tidak ada kondisi yang memvalidasi student_id ↔ school_id kepemilikan.
--
-- Fix: tambah kondisi EXISTS yang memastikan student_id yang di-INSERT
-- memang dimiliki sekolah yang sama dengan school_id di row tersebut.
-- Seluruh logika PKL dan role yang sudah ada TIDAK diubah.
--
-- JANGAN ubah fn_student_is_on_pkl — fungsi itu benar untuk tujuannya sendiri.

DROP POLICY IF EXISTS rls_cases_insert ON public.cases;

CREATE POLICY rls_cases_insert
  ON public.cases
  FOR INSERT
  WITH CHECK (
    school_id = fn_current_school_id()
    -- Guard baru: student_id harus milik sekolah yang sama (tutup celah cross-tenant)
    AND EXISTS (
      SELECT 1 FROM students st
      WHERE st.student_id = cases.student_id
        AND st.school_id  = fn_current_school_id()
    )
    AND (
      (fn_current_user_role() = 'DUDI'::role_type)
      OR (
        fn_current_user_role() = ANY (ARRAY[
          'GURU'::role_type, 'BK'::role_type, 'WALI_KELAS'::role_type,
          'KAPRODI'::role_type, 'KEPSEK'::role_type,
          'WAKA_KESISWAAN'::role_type, 'WAKA_HUMAS'::role_type
        ])
        AND NOT fn_student_is_on_pkl(student_id)
      )
      OR (fn_is_bk()             AND NOT fn_student_is_on_pkl(student_id))
      OR (fn_is_kepsek()         AND NOT fn_student_is_on_pkl(student_id))
      OR (fn_is_waka_kesiswaan() AND NOT fn_student_is_on_pkl(student_id))
    )
  );
