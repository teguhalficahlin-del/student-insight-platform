-- ============================================================================
-- Cleanup: 99 akun ORTU salah-tenant di SMK Negeri 3 Rambah
-- ============================================================================
--
-- KONTEKS
-- Pada 4 Agt 2026 07:26 UTC, 99 akun ORTU masuk ke tenant SMK Negeri 3 Rambah
-- (561cc906-e6e0-40c7-a5b0-d8f69a15258a) lewat insert langsung DI LUAR edge
-- function (SQL editor / skrip service_role). Kedua importer resmi terbukti
-- bukan penyebabnya:
--   * bulk-import-parents me-resolve nis_siswa dengan filter school_id caller.
--     Siswa Rambah baru dibuat 27 Agt 2026 — tiga minggu SESUDAH impor ini —
--     jadi saat itu semua baris pasti gagal "Siswa dengan NIS ... tidak
--     ditemukan" dan tidak satu akun pun terbuat.
--   * bulk-import-users menolak role_type=ORTU sejak commit a88c5b4
--     (30 Jun 2026), sebulan sebelum insiden.
-- Ciri baris:
--   * login_identifier berpola 'N3-2026-{NIS}' — NIS-nya milik siswa
--     SMK N 1 Ujungbatu (244e389c-de7d-4d70-ac95-346d33a5d02c), bukan Rambah
--   * nol baris di student_parents (tidak terhubung ke siswa manapun)
--   * nol baris di 53 kolom FK yang mereferensi public.users
--   * nol baris di 7 tabel public yang mereferensi auth.users
--   * auth.users.last_sign_in_at semua NULL (belum pernah dipakai login)
--
-- Karena data tidak valid dan tidak pernah dipakai, baris dihapus permanen
-- (hard delete), bukan soft delete.
--
-- TIDAK DISENTUH
--   * login_identifier = '1406031504780001' (Jannatun) — satu-satunya ORTU
--     sah di Rambah: NIK asli + terhubung ke siswa Dude Herlino
--   * sekolah lain, termasuk SMK N 1 Ujungbatu
--   * auth.users.encrypted_password baris manapun
--
-- CATATAN TEKNIS
--   * app.bypass_users_guard di-set LOCAL. trg_guard_users_protected_columns
--     hanya BEFORE UPDATE sehingga tidak menghalangi DELETE, tapi flag ini
--     disertakan agar setiap trigger/audit path yang melakukan UPDATE turunan
--     tidak menabrak allowlist default-deny.
--   * auth.identities dihapus eksplisit lebih dulu meski FK-nya sudah
--     ON DELETE CASCADE dari auth.users — urutan eksplisit agar niat jelas.
--   * Tidak ada email yang di-UPDATE di migration ini, sehingga tidak ada
--     kewajiban sinkronisasi auth.identities.identity_data.
--
-- IDEMPOTEN
--   Dijalankan ulang: tidak ada baris berpola 'N3-2026-%' tersisa, blok
--   keluar lewat RAISE NOTICE tanpa mengubah apapun.
-- ============================================================================

DO $cleanup$
DECLARE
    v_school     uuid := '561cc906-e6e0-40c7-a5b0-d8f69a15258a';
    v_pola       text := 'N3-2026-%';
    v_jannatun   text := '1406031504780001';
    v_user_ids   uuid[];
    v_auth_ids   uuid[];
    v_n          integer;
    v_n_auth     integer;
    v_pelanggar  integer;
    v_del_ident  integer;
    v_del_auth   integer;
    v_del_users  integer;
BEGIN
    PERFORM set_config('app.bypass_users_guard', 'on', true);

    -- ── Kumpulkan target sekali, pakai berulang ──────────────────────────
    SELECT array_agg(user_id),
           array_agg(auth_user_id) FILTER (WHERE auth_user_id IS NOT NULL)
      INTO v_user_ids, v_auth_ids
    FROM public.users
    WHERE school_id        = v_school
      AND role_type        = 'ORTU'
      AND login_identifier LIKE v_pola;

    IF v_user_ids IS NULL THEN
        RAISE NOTICE 'Tidak ada akun ORTU berpola % di sekolah % — migration no-op.',
            v_pola, v_school;
        RETURN;
    END IF;

    v_n      := array_length(v_user_ids, 1);
    v_n_auth := COALESCE(array_length(v_auth_ids, 1), 0);

    -- ── GATE 1: jumlah target tidak boleh melebihi temuan audit ─────────
    IF v_n > 99 THEN
        RAISE EXCEPTION 'ABORT: target % baris, melebihi 99 baris hasil audit. Investigasi ulang sebelum lanjut.', v_n;
    END IF;

    -- ── GATE 2: Jannatun tidak boleh ikut terjaring ─────────────────────
    SELECT COUNT(*) INTO v_pelanggar
    FROM public.users
    WHERE user_id = ANY(v_user_ids)
      AND (login_identifier = v_jannatun OR login_identifier NOT LIKE v_pola);
    IF v_pelanggar > 0 THEN
        RAISE EXCEPTION 'ABORT: % baris di luar pola % ikut terjaring (termasuk kemungkinan %).',
            v_pelanggar, v_pola, v_jannatun;
    END IF;

    -- ── GATE 3: tidak boleh ada baris di sekolah lain ───────────────────
    SELECT COUNT(*) INTO v_pelanggar
    FROM public.users
    WHERE user_id = ANY(v_user_ids) AND school_id <> v_school;
    IF v_pelanggar > 0 THEN
        RAISE EXCEPTION 'ABORT: % baris berasal dari sekolah lain.', v_pelanggar;
    END IF;

    -- ── GATE 4: tidak boleh punya link ke siswa manapun ─────────────────
    SELECT COUNT(*) INTO v_pelanggar
    FROM public.student_parents
    WHERE parent_user_id = ANY(v_user_ids);
    IF v_pelanggar > 0 THEN
        RAISE EXCEPTION 'ABORT: % link student_parents ditemukan — akun sudah dipakai, jangan dihapus.', v_pelanggar;
    END IF;

    -- ── GATE 5: tidak boleh ada yang pernah login ───────────────────────
    SELECT COUNT(*) INTO v_pelanggar
    FROM auth.users
    WHERE id = ANY(v_auth_ids) AND last_sign_in_at IS NOT NULL;
    IF v_pelanggar > 0 THEN
        RAISE EXCEPTION 'ABORT: % akun sudah pernah login — jangan dihapus.', v_pelanggar;
    END IF;

    RAISE NOTICE 'Gate 1-5 lulus. Menghapus % baris users / % akun auth.', v_n, v_n_auth;

    -- ── Eksekusi hapus: identities -> auth.users -> public.users ────────
    DELETE FROM auth.identities WHERE user_id = ANY(v_auth_ids);
    GET DIAGNOSTICS v_del_ident = ROW_COUNT;

    DELETE FROM auth.users WHERE id = ANY(v_auth_ids);
    GET DIAGNOSTICS v_del_auth = ROW_COUNT;

    DELETE FROM public.users WHERE user_id = ANY(v_user_ids);
    GET DIAGNOSTICS v_del_users = ROW_COUNT;

    RAISE NOTICE 'Terhapus: auth.identities=%, auth.users=%, public.users=%.',
        v_del_ident, v_del_auth, v_del_users;

    -- ── GATE 6: Jannatun wajib masih ada sesudah delete ─────────────────
    IF NOT EXISTS (
        SELECT 1 FROM public.users
        WHERE school_id = v_school AND role_type = 'ORTU'
          AND login_identifier = v_jannatun AND deleted_at IS NULL
    ) THEN
        RAISE EXCEPTION 'ABORT: akun Jannatun (%) hilang setelah delete — rollback.', v_jannatun;
    END IF;
END
$cleanup$;
