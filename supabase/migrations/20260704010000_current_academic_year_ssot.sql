-- ============================================================
-- TEMUAN-3 (Audit Referential Integrity 2026-07-04) — Langkah 1 (additif)
-- "Tahun berjalan" dilacak di banyak tempat: school_config.current_academic_year,
-- academic_periods.status='ACTIVE', dan string classes.academic_year. Saat rollover
-- tahun, ketiganya bisa tak selaras (pernah picu 600 baris impor jadwal gagal,
-- lihat mig 20260703170000).
--
-- Perbaikan langkah-1 (tanpa mengubah alur import/rollover yang ada, agar aman):
--   (a) fn_current_academic_year(school_id): SATU sumber turunan tahun berjalan,
--       diambil dari academic_periods ACTIVE (otoritatif), fallback school_config.
--   (b) v_academic_year_drift: guard-rail — memunculkan sekolah yang tahun-berjalan
--       di school_config-nya menyimpang dari periode ACTIVE, atau punya kelas aktif
--       yang academic_year-nya tertinggal. Dipakai untuk deteksi dini sebelum import.
-- Langkah-2 (mengalihkan importer membaca fn ini) menyusul dengan pengujian sendiri.
-- ============================================================

CREATE OR REPLACE FUNCTION public.fn_current_academic_year(p_school_id UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
    SELECT COALESCE(
        (SELECT ap.academic_year
           FROM academic_periods ap
          WHERE ap.school_id = p_school_id
            AND ap.status = 'ACTIVE'
          ORDER BY ap.start_date DESC
          LIMIT 1),
        (SELECT sc.current_academic_year
           FROM school_config sc
          WHERE sc.school_id = p_school_id
          LIMIT 1)
    );
$$;

COMMENT ON FUNCTION public.fn_current_academic_year(UUID) IS
    'TEMUAN-3: sumber tunggal turunan "tahun berjalan" per sekolah. '
    'Prioritas academic_periods ACTIVE, fallback school_config.current_academic_year.';

-- Guard-rail: deteksi ketidakselarasan tahun-berjalan per sekolah.
CREATE OR REPLACE VIEW public.v_academic_year_drift
    WITH (security_invoker = true) AS
SELECT
    sc.school_id,
    sc.current_academic_year                      AS config_year,
    ap.academic_year                              AS active_period_year,
    (sc.current_academic_year IS DISTINCT FROM ap.academic_year) AS config_vs_period_drift,
    (SELECT COUNT(*) FROM classes c
       WHERE c.school_id = sc.school_id
         AND c.is_active = TRUE
         AND c.academic_year IS DISTINCT FROM ap.academic_year) AS active_classes_lagging
FROM school_config sc
LEFT JOIN LATERAL (
    SELECT p.academic_year
      FROM academic_periods p
     WHERE p.school_id = sc.school_id
       AND p.status = 'ACTIVE'
     ORDER BY p.start_date DESC
     LIMIT 1
) ap ON TRUE;

COMMENT ON VIEW public.v_academic_year_drift IS
    'TEMUAN-3 guard-rail: baris dengan config_vs_period_drift=true atau '
    'active_classes_lagging>0 menandakan "tahun berjalan" tidak selaras — '
    'perbaiki sebelum menjalankan impor jadwal/enrolment.';
