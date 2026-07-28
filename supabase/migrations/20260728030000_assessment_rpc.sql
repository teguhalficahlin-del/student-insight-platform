-- RPC untuk fitur penilaian Kurikulum Merdeka
-- A. fn_calculate_grade_summary — kalkulasi nilai akhir per siswa per kelas
-- B. fn_get_grade_summary       — ambil nilai akhir + breakdown TP untuk portal

-- ============================================================
-- A. fn_calculate_grade_summary
--    Dipanggil guru saat klik "Hitung Nilai Akhir".
--    Hitung nilai akhir semua siswa yang sudah punya tp_assessments
--    untuk subject+class+year+semester ini, lalu upsert ke grade_summaries.
-- ============================================================

CREATE OR REPLACE FUNCTION fn_calculate_grade_summary(
    p_subject_id    UUID,
    p_class_id      UUID,
    p_academic_year VARCHAR(9),
    p_semester      INTEGER
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_school_id    UUID;
    v_teacher_id   UUID;
    v_gs           grading_settings%ROWTYPE;
    v_ref_lo_id    UUID;
    v_now          TIMESTAMPTZ;
    v_updated      INTEGER := 0;
    v_student      RECORD;
    v_avg_sumatif  NUMERIC;
    v_avg_formatif NUMERIC;
    v_nilai_akhir  NUMERIC;
    v_predikat     TEXT;
BEGIN
    v_school_id  := fn_current_school_id();
    v_teacher_id := fn_current_user_id();
    v_now        := NOW();

    -- Guard: hanya GURU
    IF fn_current_user_role() <> 'GURU'::role_type THEN
        RETURN jsonb_build_object(
            'success', false,
            'error',   'Hanya guru yang dapat menghitung nilai akhir'
        );
    END IF;

    -- Ambil grading_settings milik guru ini untuk konteks ini
    SELECT * INTO v_gs
    FROM grading_settings
    WHERE school_id       = v_school_id
      AND teacher_user_id = v_teacher_id
      AND subject_id      = p_subject_id
      AND class_id        = p_class_id
      AND academic_year   = p_academic_year
      AND semester        = p_semester;

    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'success', false,
            'error',   'Pengaturan kalkulasi belum diisi — buat grading_settings terlebih dahulu'
        );
    END IF;

    -- Ambil LO pertama sebagai referensi lookup predikat (KKTP per TP = skala yang sama)
    SELECT learning_objective_id INTO v_ref_lo_id
    FROM learning_objectives
    WHERE school_id       = v_school_id
      AND teacher_user_id = v_teacher_id
      AND subject_id      = p_subject_id
      AND academic_year   = p_academic_year
      AND semester        = p_semester
    ORDER BY urutan
    LIMIT 1;

    -- Iterasi tiap siswa yang punya tp_assessments pada konteks ini
    FOR v_student IN
        SELECT DISTINCT tpa.student_id
        FROM tp_assessments tpa
        JOIN learning_objectives lo
          ON lo.learning_objective_id = tpa.learning_objective_id
        WHERE tpa.school_id       = v_school_id
          AND tpa.teacher_user_id = v_teacher_id
          AND tpa.class_id        = p_class_id
          AND lo.subject_id       = p_subject_id
          AND lo.academic_year    = p_academic_year
          AND lo.semester         = p_semester
        ORDER BY tpa.student_id
    LOOP
        -- Hitung AVG sumatif dan formatif lintas semua TP mapel ini
        SELECT
            AVG(tpa.nilai_angka) FILTER (WHERE tpa.tipe = 'SUMATIF'  AND NOT tpa.is_void),
            AVG(tpa.nilai_angka) FILTER (WHERE tpa.tipe = 'FORMATIF' AND NOT tpa.is_void)
        INTO v_avg_sumatif, v_avg_formatif
        FROM tp_assessments tpa
        JOIN learning_objectives lo
          ON lo.learning_objective_id = tpa.learning_objective_id
        WHERE tpa.school_id       = v_school_id
          AND tpa.teacher_user_id = v_teacher_id
          AND tpa.class_id        = p_class_id
          AND tpa.student_id      = v_student.student_id
          AND lo.subject_id       = p_subject_id
          AND lo.academic_year    = p_academic_year
          AND lo.semester         = p_semester;

        -- Kalkulasi nilai_akhir sesuai metode di grading_settings
        IF NOT v_gs.is_formatif_included THEN
            v_nilai_akhir := v_avg_sumatif;
        ELSIF v_gs.metode_formatif = 'BOBOT' THEN
            -- Jika salah satu komponen NULL → nilai_akhir NULL (belum bisa dihitung)
            IF v_avg_sumatif IS NULL OR v_avg_formatif IS NULL THEN
                v_nilai_akhir := NULL;
            ELSE
                v_nilai_akhir :=
                    v_avg_formatif * v_gs.bobot_formatif / 100.0
                  + v_avg_sumatif  * v_gs.bobot_sumatif  / 100.0;
            END IF;
        ELSE
            -- KONTEKS_SAJA: formatif tidak mempengaruhi angka
            v_nilai_akhir := v_avg_sumatif;
        END IF;

        -- Cari predikat dari assessment_criteria berdasarkan LO referensi
        v_predikat := NULL;
        IF v_ref_lo_id IS NOT NULL AND v_nilai_akhir IS NOT NULL THEN
            SELECT predikat INTO v_predikat
            FROM assessment_criteria
            WHERE learning_objective_id = v_ref_lo_id
              AND batas_bawah           <= v_nilai_akhir
              AND batas_atas            >= v_nilai_akhir
            LIMIT 1;
        END IF;

        -- UPSERT ke grade_summaries
        -- DO UPDATE hanya jika is_auto_calculate = TRUE (tidak timpa nilai manual)
        INSERT INTO grade_summaries (
            school_id, student_id, teacher_user_id, subject_id,
            class_id, academic_year, semester,
            nilai_akhir, predikat, is_auto_calculate,
            last_calculated_at, updated_at
        ) VALUES (
            v_school_id, v_student.student_id, v_teacher_id, p_subject_id,
            p_class_id, p_academic_year, p_semester,
            v_nilai_akhir, v_predikat, TRUE,
            v_now, v_now
        )
        ON CONFLICT (school_id, student_id, subject_id, class_id, academic_year, semester)
        DO UPDATE SET
            nilai_akhir        = EXCLUDED.nilai_akhir,
            predikat           = EXCLUDED.predikat,
            last_calculated_at = EXCLUDED.last_calculated_at,
            updated_at         = EXCLUDED.updated_at
        WHERE grade_summaries.is_auto_calculate = TRUE;

        v_updated := v_updated + 1;
    END LOOP;

    RETURN jsonb_build_object('success', true, 'updated', v_updated);
END;
$$;

REVOKE EXECUTE ON FUNCTION fn_calculate_grade_summary(UUID,UUID,VARCHAR,INTEGER) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION fn_calculate_grade_summary(UUID,UUID,VARCHAR,INTEGER) FROM anon;
GRANT  EXECUTE ON FUNCTION fn_calculate_grade_summary(UUID,UUID,VARCHAR,INTEGER) TO authenticated;

-- ============================================================
-- B. fn_get_grade_summary
--    Ambil nilai akhir + breakdown per TP per siswa.
--    Visibility dikontrol manual berdasarkan role caller:
--      GURU             → semua siswa, semua nilai (published atau tidak)
--      KEPSEK/WAKA_KUR  → semua siswa, semua nilai (monitoring)
--      WAKA_KESISWAAN   → hanya yang published
--      KAPRODI          → hanya yang published
--      SISWA            → hanya miliknya, hanya jika published
--      ORTU             → hanya milik anaknya, hanya jika published
-- ============================================================

CREATE OR REPLACE FUNCTION fn_get_grade_summary(
    p_subject_id    UUID,
    p_class_id      UUID,
    p_academic_year VARCHAR(9),
    p_semester      INTEGER
) RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_role           role_type;
    v_user_id        UUID;
    v_school_id      UUID;
    v_teacher_id     UUID;     -- NULL = tidak filter per teacher
    v_student_ids    UUID[];   -- NULL = tidak filter per student
    v_published_only BOOLEAN;
    v_result         JSONB;
BEGIN
    v_role      := fn_current_user_role();
    v_user_id   := fn_current_user_id();
    v_school_id := fn_current_school_id();

    -- Tentukan filter berdasarkan role
    CASE v_role
        WHEN 'GURU'::role_type THEN
            IF fn_wali_kelas_class_id() IS NOT NULL
               AND fn_wali_kelas_class_id() = p_class_id THEN
                v_teacher_id     := NULL;
                v_published_only := FALSE;
            ELSE
                v_teacher_id     := v_user_id;
                v_published_only := FALSE;
            END IF;

        WHEN 'KEPSEK'::role_type, 'WAKA_KURIKULUM'::role_type THEN
            v_teacher_id     := NULL;   -- lihat semua guru
            v_published_only := FALSE;

        WHEN 'KAPRODI'::role_type THEN
            v_teacher_id     := NULL;
            v_published_only := TRUE;

        WHEN 'WAKA_KESISWAAN'::role_type THEN
            v_teacher_id     := NULL;
            v_published_only := TRUE;

        WHEN 'SISWA'::role_type THEN
            v_teacher_id     := NULL;
            v_published_only := TRUE;
            SELECT ARRAY[s.student_id] INTO v_student_ids
            FROM students s
            WHERE s.user_id   = v_user_id
              AND s.school_id = v_school_id;

        WHEN 'ORTU'::role_type THEN
            v_teacher_id     := NULL;
            v_published_only := TRUE;
            SELECT ARRAY_AGG(sp.student_id) INTO v_student_ids
            FROM student_parents sp
            WHERE sp.parent_user_id = v_user_id
              AND sp.school_id      = v_school_id;

        ELSE
            RETURN jsonb_build_object(
                'success', false,
                'error',   'Role tidak memiliki akses ke data penilaian'
            );
    END CASE;

    -- Guard wali kelas: hanya boleh query kelas miliknya
    IF fn_wali_kelas_class_id() IS NOT NULL
       AND v_role NOT IN (
           'KEPSEK'::role_type, 'WAKA_KURIKULUM'::role_type,
           'WAKA_KESISWAAN'::role_type, 'SISWA'::role_type,
           'ORTU'::role_type, 'GURU'::role_type
       )
       AND p_class_id <> fn_wali_kelas_class_id() THEN
        RETURN jsonb_build_object(
            'success', false,
            'error',   'Wali kelas hanya dapat melihat data kelasnya sendiri'
        );
    END IF;

    -- Bangun hasil
    SELECT jsonb_build_object(
        'grading_settings', (
            SELECT to_jsonb(gs) - 'school_id' - 'teacher_user_id'
            FROM grading_settings gs
            WHERE gs.school_id     = v_school_id
              AND gs.subject_id    = p_subject_id
              AND gs.class_id      = p_class_id
              AND gs.academic_year = p_academic_year
              AND gs.semester      = p_semester
              AND (v_teacher_id IS NULL OR gs.teacher_user_id = v_teacher_id)
            LIMIT 1
        ),
        'students', (
            SELECT COALESCE(
                jsonb_agg(
                    jsonb_build_object(
                        'student_id',    gs.student_id,
                        'grade_summary', jsonb_build_object(
                            'grade_summary_id',   gs.grade_summary_id,
                            'nilai_akhir',        gs.nilai_akhir,
                            'predikat',           gs.predikat,
                            'deskripsi_naratif',  gs.deskripsi_naratif,
                            'is_auto_calculate',  gs.is_auto_calculate,
                            'last_calculated_at', gs.last_calculated_at,
                            'published_at',       gs.published_at
                        ),
                        'tp_breakdown', (
                            SELECT COALESCE(
                                jsonb_agg(
                                    jsonb_build_object(
                                        'learning_objective_id', lo.learning_objective_id,
                                        'kode_tp',               lo.kode_tp,
                                        'deskripsi_tp',          lo.deskripsi_tp,
                                        'urutan',                lo.urutan,
                                        'avg_sumatif', (
                                            SELECT AVG(tpa.nilai_angka)
                                            FROM tp_assessments tpa
                                            WHERE tpa.learning_objective_id = lo.learning_objective_id
                                              AND tpa.student_id            = gs.student_id
                                              AND tpa.class_id              = p_class_id
                                              AND tpa.tipe                  = 'SUMATIF'
                                              AND NOT tpa.is_void
                                        ),
                                        'avg_formatif', (
                                            SELECT AVG(tpa.nilai_angka)
                                            FROM tp_assessments tpa
                                            WHERE tpa.learning_objective_id = lo.learning_objective_id
                                              AND tpa.student_id            = gs.student_id
                                              AND tpa.class_id              = p_class_id
                                              AND tpa.tipe                  = 'FORMATIF'
                                              AND NOT tpa.is_void
                                        ),
                                        'assessments', (
                                            SELECT COALESCE(
                                                jsonb_agg(
                                                    jsonb_build_object(
                                                        'assessment_id',    tpa.assessment_id,
                                                        'tipe',             tpa.tipe,
                                                        'judul',            tpa.judul,
                                                        'nilai_angka',      tpa.nilai_angka,
                                                        'nilai_kualitatif', tpa.nilai_kualitatif,
                                                        'tanggal',          tpa.tanggal,
                                                        'is_void',          tpa.is_void
                                                    ) ORDER BY tpa.tanggal, tpa.created_at
                                                ),
                                                '[]'::jsonb
                                            )
                                            FROM tp_assessments tpa
                                            WHERE tpa.learning_objective_id = lo.learning_objective_id
                                              AND tpa.student_id            = gs.student_id
                                              AND tpa.class_id              = p_class_id
                                        )
                                    ) ORDER BY lo.urutan
                                ),
                                '[]'::jsonb
                            )
                            FROM learning_objectives lo
                            WHERE lo.school_id       = v_school_id
                              AND lo.subject_id      = p_subject_id
                              AND lo.academic_year   = p_academic_year
                              AND lo.semester        = p_semester
                              AND (v_teacher_id IS NULL OR lo.teacher_user_id = v_teacher_id)
                        )
                    ) ORDER BY gs.student_id
                ),
                '[]'::jsonb
            )
            FROM grade_summaries gs
            WHERE gs.school_id     = v_school_id
              AND gs.subject_id    = p_subject_id
              AND gs.class_id      = p_class_id
              AND gs.academic_year = p_academic_year
              AND gs.semester      = p_semester
              AND (v_teacher_id IS NULL OR gs.teacher_user_id = v_teacher_id)
              AND (v_student_ids IS NULL OR gs.student_id = ANY(v_student_ids))
              AND (NOT v_published_only OR gs.published_at IS NOT NULL)
        )
    ) INTO v_result;

    RETURN COALESCE(v_result,
        jsonb_build_object('grading_settings', NULL, 'students', '[]'::jsonb));
END;
$$;

REVOKE EXECUTE ON FUNCTION fn_get_grade_summary(UUID,UUID,VARCHAR,INTEGER) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION fn_get_grade_summary(UUID,UUID,VARCHAR,INTEGER) FROM anon;
GRANT  EXECUTE ON FUNCTION fn_get_grade_summary(UUID,UUID,VARCHAR,INTEGER) TO authenticated;
