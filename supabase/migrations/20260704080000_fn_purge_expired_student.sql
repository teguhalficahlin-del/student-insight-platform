-- ============================================================
-- ITEM 7 — fn_purge_expired_student
-- ============================================================
-- Kebijakan retensi data (keputusan 2026-07-04):
--   LULUS : graduated_at > 6 bulan → hapus permanen
--   KELUAR: keluar_at   > 6 bulan → hapus permanen
--   Tidak ada anonimisasi — seluruh data dihapus
--   Termasuk akun auth siswa + akun ortu yg sudah yatim piatu
--
-- Fungsi ini menangani semua hapus DB-level (urut FK).
-- Edge function purge-expired-students yang memanggil ini
-- kemudian menghapus auth.users menggunakan admin API.
-- ============================================================

CREATE OR REPLACE FUNCTION public.fn_purge_expired_student(
    p_student_id uuid,
    p_school_id  uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_student        RECORD;
    v_student_auth   uuid;
    v_parent_uids    uuid[];
    v_orphan_auths   uuid[];
    v_cutoff         TIMESTAMPTZ := NOW() - INTERVAL '6 months';
BEGIN
    -- ── 1. Verifikasi siswa ──────────────────────────────────────
    SELECT student_id, full_name, nis, student_status,
           graduated_at, keluar_at, user_id, school_id
    INTO v_student
    FROM students
    WHERE student_id = p_student_id AND school_id = p_school_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Siswa % tidak ditemukan di sekolah ini', p_student_id;
    END IF;

    IF v_student.student_status NOT IN ('LULUS', 'KELUAR') THEN
        RAISE EXCEPTION 'Siswa "%" masih berstatus %. Hanya LULUS/KELUAR yang bisa dihapus.',
            v_student.full_name, v_student.student_status;
    END IF;

    IF v_student.student_status = 'LULUS' THEN
        IF v_student.graduated_at IS NULL OR v_student.graduated_at > v_cutoff THEN
            RAISE EXCEPTION 'Siswa "%" lulus kurang dari 6 bulan lalu — belum melewati masa retensi.',
                v_student.full_name;
        END IF;
    ELSIF v_student.student_status = 'KELUAR' THEN
        IF v_student.keluar_at IS NULL OR v_student.keluar_at > v_cutoff THEN
            RAISE EXCEPTION 'Siswa "%" keluar kurang dari 6 bulan lalu — belum melewati masa retensi.',
                v_student.full_name;
        END IF;
    END IF;

    -- ── 2. Simpan auth_user_id siswa (untuk dihapus di edge fn) ─
    IF v_student.user_id IS NOT NULL THEN
        SELECT auth_user_id INTO v_student_auth
        FROM users WHERE user_id = v_student.user_id;
    END IF;

    -- ── 3. Simpan parent user_ids untuk cek yatim piatu ─────────
    SELECT ARRAY_AGG(sp.parent_user_id)
    INTO v_parent_uids
    FROM student_parents sp WHERE sp.student_id = p_student_id;

    -- ── 4. Hapus data transaksional (urut FK) ───────────────────

    -- Kasus: hapus case_events lalu cases (notifications auto SET NULL via mig 280000)
    DELETE FROM case_events  WHERE case_id IN (
        SELECT case_id FROM cases
        WHERE  student_id = p_student_id AND school_id = p_school_id
    );
    DELETE FROM cases WHERE student_id = p_student_id AND school_id = p_school_id;

    -- Absensi, observasi, jurnal guru
    DELETE FROM attendance       WHERE student_id = p_student_id;
    DELETE FROM observations     WHERE student_id = p_student_id AND school_id = p_school_id;
    DELETE FROM teacher_journals WHERE student_id = p_student_id;

    -- PKL
    DELETE FROM pkl_attendance WHERE student_id = p_student_id;
    DELETE FROM pkl_placements WHERE student_id = p_student_id AND school_id = p_school_id;

    -- Enrolmen kelas + relasi ortu
    DELETE FROM class_enrollments WHERE student_id = p_student_id;
    DELETE FROM student_parents   WHERE student_id = p_student_id;

    -- Akun portal siswa (baris users)
    IF v_student.user_id IS NOT NULL THEN
        DELETE FROM users WHERE user_id = v_student.user_id;
    END IF;

    -- Baris siswa
    DELETE FROM students WHERE student_id = p_student_id;

    -- ── 5. Cek ortu yatim piatu → hapus baris users mereka ──────
    IF v_parent_uids IS NOT NULL AND array_length(v_parent_uids, 1) > 0 THEN
        -- Ortu yang tidak punya anak lain (student_parents sudah dihapus di atas)
        SELECT ARRAY_AGG(u.auth_user_id)
        INTO v_orphan_auths
        FROM users u
        WHERE u.user_id = ANY(v_parent_uids)
          AND NOT EXISTS (
              SELECT 1 FROM student_parents sp2
              WHERE sp2.parent_user_id = u.user_id
          );

        -- Hapus baris users ortu yatim piatu
        DELETE FROM users
        WHERE user_id = ANY(v_parent_uids)
          AND NOT EXISTS (
              SELECT 1 FROM student_parents sp2
              WHERE sp2.parent_user_id = users.user_id
          );
    END IF;

    RETURN jsonb_build_object(
        'student_id',      p_student_id,
        'full_name',       v_student.full_name,
        'nis',             v_student.nis,
        'status',          v_student.student_status,
        'student_auth_id', v_student_auth,
        'orphan_auth_ids', COALESCE(to_jsonb(v_orphan_auths), '[]'::jsonb)
    );
END;
$$;

GRANT EXECUTE ON FUNCTION fn_purge_expired_student(uuid, uuid) TO authenticated;

COMMENT ON FUNCTION fn_purge_expired_student IS
    'Hapus permanen siswa LULUS/KELUAR yang sudah >6 bulan. '
    'Menghapus semua data terkait (FK-safe). Kembalikan auth_user_ids '
    'yang harus dihapus oleh edge function via admin API.';
