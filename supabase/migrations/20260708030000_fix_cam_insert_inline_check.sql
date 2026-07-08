-- Migration: 20260708030000_fix_cam_insert_inline_check.sql
--
-- LATAR BELAKANG:
-- rls_cam_insert WITH CHECK memanggil fn_user_is_internal_case_actor(user_id)
-- yang sengaja dikunci total (migration 20260707140000) karena terbukti
-- exploitable lintas-sekolah (siswa bisa cek status jabatan orang di sekolah
-- lain). Akibatnya INSERT case_audience_members error 42501 sejak saat itu
-- untuk semua authenticated — fitur tambah anggota audience RESTRICTED rusak.
--
-- FIX: Ganti pemanggilan fungsi terkunci dengan inline EXISTS check yang
-- setara secara fungsional TAPI otomatis dibatasi ke fn_current_school_id()
-- — lebih ketat dari fungsi asli yang tidak punya guard school_id sama sekali.
-- TIDAK meng-grant kembali fn_user_is_internal_case_actor ke authenticated.
--
-- DEFINISI ASLI (verified live 8 Juli 2026, TARGET 1):
-- with_check: (school_id = fn_current_school_id())
--             AND (added_by_user_id = fn_current_user_id())
--             AND fn_is_internal_case_actor()
--             AND fn_can_see_case(case_id)
--             AND fn_user_is_internal_case_actor(user_id)   ← diganti inline

DROP POLICY IF EXISTS rls_cam_insert ON public.case_audience_members;

CREATE POLICY rls_cam_insert ON public.case_audience_members
FOR INSERT
TO public
WITH CHECK (
    school_id = fn_current_school_id()
    AND added_by_user_id = fn_current_user_id()
    AND fn_is_internal_case_actor()
    AND fn_can_see_case(case_id)
    AND EXISTS (
        SELECT 1 FROM public.users u
        WHERE u.user_id = case_audience_members.user_id
          AND u.school_id = fn_current_school_id()
          AND (
              u.role_type IN (
                  'GURU','BK','WALI_KELAS','KAPRODI','WAKA_KESISWAAN','KEPSEK'
              )
              OR u.is_bk
              OR u.is_kepsek
              OR u.is_waka_kesiswaan
          )
    )
);
