-- ============================================================
-- FORUM-DEL-01 — Hapus posting forum secara permanen (hard delete)
--
-- KEPUTUSAN:
--   Romo memutuskan "tarik posting" diganti menjadi hard delete.
--   Bentuk akhir yang disepakati: SATU tombol "Hapus Posting" yang
--   benar-benar menghapus permanen; tombol "Tarik Posting" dibuang
--   dari seluruh portal. Hak akses: penulis ATAU moderator.
--
-- MENGAPA LEWAT RPC, BUKAN .delete() LANGSUNG:
--   1. notifications TIDAK punya policy DELETE (default-deny), jadi
--      klien tidak akan pernah bisa membersihkan notifikasi terkait.
--      Tanpa ini, notifications.forum_post_id di-SET NULL oleh FK dan
--      teks notifikasi tetap nongkrong di lonceng penerima menunjuk
--      posting yang sudah tidak ada ("pengumuman hantu").
--   2. Policy rls_forum_posts_delete yang ada hanya mengenali
--      role_type KEPSEK/WAKA_KESISWAAN — tidak mencakup ADMINISTRATIVE
--      maupun flag jabatan tambahan is_kepsek/is_waka_kesiswaan.
--      Definisi moderator di sini disamakan persis dengan
--      fn_toggle_forum_post_withdrawn (migration 20260828170000).
--   3. attachment_path harus dibaca SEBELUM baris hilang, lalu
--      dikembalikan ke klien supaya file di storage bisa ikut dihapus.
--      Tanpa ini file jadi sampah permanen yang tidak bisa ditemukan
--      lagi oleh siapa pun.
--
-- YANG IKUT TERHAPUS (ON DELETE CASCADE, sudah ada di skema):
--   forum_post_audience, forum_post_comments,
--   forum_post_acknowledgements, forum_post_subjects
--   notifications dihapus eksplisit di fungsi ini (FK-nya SET NULL,
--   bukan CASCADE, sehingga tidak ikut terhapus dengan sendirinya).
--
--   Penghapusan bersifat PERMANEN dan tidak dapat dibatalkan.
--
-- KOLOM is_withdrawn:
--   Sengaja TIDAK diubah. Dua posting yang terlanjur ditarik tetap
--   berstatus ditarik dan tetap tersembunyi dari penerima; penulis dan
--   moderator masih bisa melihatnya (via gerbang di
--   fn_can_read_forum_post) dan kini bisa menghapusnya permanen.
--   Me-reset is_withdrawn akan memunculkan kembali pengumuman lama ke
--   74 penerima tanpa diminta — efek samping yang tidak dikehendaki.
--
-- IDEMPOTENSI:
--   CREATE OR REPLACE FUNCTION.
--
-- PRIVILEGE (CLAUDE.md §6c — SECURITY DEFINER baru):
--   GRANT EXECUTE TO authenticated + REVOKE dari anon + REVOKE dari
--   PUBLIC. REVOKE dari PUBLIC saja tidak cukup karena Supabase memberi
--   grant eksplisit ke anon yang tidak ikut tercabut.
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_delete_forum_post(p_post_id uuid)
RETURNS TABLE(deleted_post_id uuid, attachment_path text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    v_caller    uuid := public.fn_current_user_id();
    v_school    uuid := public.fn_current_school_id();
    v_author    uuid;
    v_path      text;
    v_moderator boolean := false;
BEGIN
    IF p_post_id IS NULL THEN
        RAISE EXCEPTION 'post_id wajib diisi.'
            USING ERRCODE = '22004';
    END IF;

    -- Tenant-safe: posting di luar sekolah caller dianggap tidak ada.
    SELECT fp.author_user_id, fp.attachment_path
    INTO   v_author, v_path
    FROM   public.forum_posts fp
    WHERE  fp.post_id   = p_post_id
      AND  fp.school_id = v_school;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Posting tidak ditemukan.'
            USING ERRCODE = 'P0002';
    END IF;

    SELECT EXISTS (
        SELECT 1
        FROM public.users u
        WHERE u.user_id    = v_caller
          AND u.school_id  = v_school
          AND u.is_active  = true
          AND u.deleted_at IS NULL
          AND (
              u.role_type IN ('KEPSEK', 'WAKA_KESISWAAN', 'ADMINISTRATIVE')
              OR u.is_kepsek = true
              OR u.is_waka_kesiswaan = true
          )
    ) INTO v_moderator;

    -- v_caller NULL (tidak terautentikasi) selalu jatuh ke cabang tolak:
    -- NULL IS DISTINCT FROM <apapun> bernilai true, dan v_moderator false.
    IF v_caller IS DISTINCT FROM v_author AND NOT v_moderator THEN
        RAISE EXCEPTION 'Akses ditolak: hanya penulis atau moderator yang dapat menghapus posting.'
            USING ERRCODE = '42501';
    END IF;

    -- Notifikasi dibersihkan lebih dulu. FK-nya ON DELETE SET NULL,
    -- jadi tanpa baris ini notifikasinya bertahan sebagai rujukan kosong.
    DELETE FROM public.notifications
    WHERE forum_post_id = p_post_id
      AND school_id     = v_school;

    -- Tabel anak (audience, comments, acknowledgements, subjects)
    -- ikut terhapus lewat ON DELETE CASCADE.
    DELETE FROM public.forum_posts
    WHERE post_id   = p_post_id
      AND school_id = v_school;

    RETURN QUERY SELECT p_post_id, v_path;
END;
$function$;

GRANT  EXECUTE ON FUNCTION public.fn_delete_forum_post(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_delete_forum_post(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.fn_delete_forum_post(uuid) FROM PUBLIC;

COMMIT;
