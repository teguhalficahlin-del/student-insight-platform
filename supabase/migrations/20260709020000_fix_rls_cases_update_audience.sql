-- ══════════════════════════════════════════════════════════════════════════════
-- Migration: 20260709020000_fix_rls_cases_update_audience
-- Tanggal  : 9 Juli 2026
-- Konteks  : Fase 2 audit keamanan — perbaikan policy UPDATE yang terlalu luas
-- ══════════════════════════════════════════════════════════════════════════════
--
-- TEMUAN KEAMANAN:
--   Policy lama rls_cases_update_audience mengizinkan SIAPAPUN staf internal
--   yang ada di audience sebuah kasus untuk UPDATE seluruh kolom tabel cases
--   (termasuk current_handler_role, status, dan kolom sensitif lain).
--   Ini tidak sesuai desain — hanya handler aktif, KEPSEK, atau creator kasus
--   yang seharusnya bisa mengubah data kasus.
--
-- PERBAIKAN:
--   Perketat USING dan WITH CHECK dari "bisa lihat" → "berhak ubah":
--     - fn_matches_case_handler : user adalah handler kasus ini
--     - fn_is_kepsek()          : kepala sekolah (pengawas semua kasus)
--     - created_by_user_id      : creator kasus itu sendiri
--
-- CATATAN:
--   fn_can_see_case untuk KEPSEK pada kasus PRIVATE/RESTRICTED (handler ≠ KEPSEK)
--   saat ini mengembalikan FALSE — ini bug terpisah di fn_can_see_case yang
--   dicatat sebagai BACKLOG (fn_is_kepsek clause 2b). Policy ini sudah benar
--   untuk skenario yang saat ini bisa lolos SELECT RLS.
--
-- ══════════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS rls_cases_update_audience ON public.cases;

CREATE POLICY rls_cases_update_audience ON public.cases
FOR UPDATE
USING (
    school_id = fn_current_school_id()
    AND (
        fn_matches_case_handler(current_handler_role, student_id)
        OR fn_is_kepsek()
        OR created_by_user_id = fn_current_user_id()
    )
)
WITH CHECK (
    school_id = fn_current_school_id()
    AND (
        fn_matches_case_handler(current_handler_role, student_id)
        OR fn_is_kepsek()
        OR created_by_user_id = fn_current_user_id()
    )
);
