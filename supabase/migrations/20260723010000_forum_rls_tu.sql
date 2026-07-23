-- ============================================================
-- Migration 20260723010000: Forum RLS untuk TU
--
-- TU (Tata Usaha) perlu akses baca forum kelas untuk keperluan
-- administrasi sekolah. TU bukan anggota forum aktif (tidak masuk
-- fn_get_forum_members), sehingga tidak ada di forum_post_audience.
--
-- Policy ini memberi TU akses SELECT ke seluruh forum sekolahnya
-- (setara level KEPSEK/WAKA_KESISWAAN), tanpa hak INSERT/UPDATE/DELETE.
--
-- Standing rules (audit-handoff §3a):
--   - school_id = fn_current_school_id() wajib di setiap policy
--   - Tidak ada SECURITY DEFINER baru di migration ini
-- ============================================================

-- ── 1. forum_posts: TU bisa baca semua posting di sekolahnya ──
CREATE POLICY rls_forum_posts_read_tu ON forum_posts
FOR SELECT USING (
    school_id = fn_current_school_id()
    AND fn_current_user_role() = 'TU'::role_type
);

-- ── 2. forum_post_audience: TU bisa baca daftar audience ──────
CREATE POLICY rls_forum_post_audience_read_tu ON forum_post_audience
FOR SELECT USING (
    school_id = fn_current_school_id()
    AND fn_current_user_role() = 'TU'::role_type
);

-- ── 3. forum_post_comments: TU bisa baca komentar ─────────────
CREATE POLICY rls_forum_post_comments_read_tu ON forum_post_comments
FOR SELECT USING (
    school_id = fn_current_school_id()
    AND fn_current_user_role() = 'TU'::role_type
);
