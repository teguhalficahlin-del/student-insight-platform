-- ============================================================
-- Batalkan buka tahun ajaran (kemungkinan_buruk.md 4.3)
-- ============================================================
-- Admin salah pilih tahun/semester saat buka tahun ajaran → dulu harus
-- perbaiki manual di DB. Fungsi ini membalik "buka tahun ajaran" TERAKHIR
-- secara transaksional & presisi:
--   1. Pulihkan enrollment tahun lama HANYA untuk siswa yang benar-benar
--      naik kelas (yang punya enrollment tahun baru) → siswa yang keluar
--      (mutasi) tidak ikut diaktifkan lagi.
--   2. Hapus enrollment tahun baru (hasil kenaikan kelas).
--   3. Hapus academic_periods tahun baru.
--   4. Kembalikan school_config ke tahun/semester sebelumnya.
--
-- TIDAK menyentuh status kelulusan siswa (LULUS) — itu langkah terpisah.
-- Guard: hanya membatalkan tahun yang SEDANG aktif di school_config, dan
-- menolak bila tidak ada tahun sebelumnya untuk dipulihkan.
-- ============================================================

CREATE OR REPLACE FUNCTION public.fn_batalkan_tahun_ajaran(p_config_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    v_school_id       UUID;
    v_cur_year        TEXT;
    v_cur_sem         semester;
    v_prev_year       TEXT;
    v_prev_sem        semester;
    v_deleted_enroll  INTEGER := 0;
    v_restored        INTEGER := 0;
    v_deleted_periods INTEGER := 0;
BEGIN
    SELECT school_id, current_academic_year, current_semester
        INTO v_school_id, v_cur_year, v_cur_sem
        FROM school_config WHERE config_id = p_config_id;
    IF v_school_id IS NULL THEN
        RAISE EXCEPTION 'school_config dengan id % tidak ditemukan', p_config_id;
    END IF;

    -- Tahun/semester sebelumnya (untuk dipulihkan ke school_config)
    SELECT academic_year, semester INTO v_prev_year, v_prev_sem
    FROM academic_periods
    WHERE school_id = v_school_id
      AND (academic_year < v_cur_year
           OR (academic_year = v_cur_year AND semester < v_cur_sem))
    ORDER BY academic_year DESC, semester DESC
    LIMIT 1;

    IF v_prev_year IS NULL THEN
        RAISE EXCEPTION 'Tidak ada tahun ajaran sebelumnya untuk dipulihkan. Pembatalan dihentikan demi keamanan.';
    END IF;

    -- (1) Pulihkan enrollment tahun lama untuk siswa yang naik kelas
    UPDATE class_enrollments
        SET withdrawn_at = NULL, updated_at = now()
    WHERE school_id = v_school_id
      AND academic_year = v_prev_year
      AND withdrawn_at IS NOT NULL
      AND student_id IN (
          SELECT student_id FROM class_enrollments
          WHERE school_id = v_school_id AND academic_year = v_cur_year
      );
    GET DIAGNOSTICS v_restored = ROW_COUNT;

    -- (2) Hapus enrollment tahun baru (hasil kenaikan kelas)
    DELETE FROM class_enrollments
    WHERE school_id = v_school_id AND academic_year = v_cur_year;
    GET DIAGNOSTICS v_deleted_enroll = ROW_COUNT;

    -- (3) Hapus periode tahun baru (semua semester tahun tsb)
    DELETE FROM academic_periods
    WHERE school_id = v_school_id AND academic_year = v_cur_year;
    GET DIAGNOSTICS v_deleted_periods = ROW_COUNT;

    -- (4) Kembalikan school_config ke tahun/semester sebelumnya
    UPDATE school_config
        SET current_academic_year = v_prev_year,
            current_semester      = v_prev_sem,
            updated_at            = now()
    WHERE config_id = p_config_id;

    RETURN jsonb_build_object(
        'success',              true,
        'cancelled_year',       v_cur_year,
        'cancelled_semester',   v_cur_sem,
        'restored_year',        v_prev_year,
        'restored_semester',    v_prev_sem,
        'deleted_enrollments',  v_deleted_enroll,
        'restored_enrollments', v_restored,
        'deleted_periods',      v_deleted_periods
    );
END;
$function$;
