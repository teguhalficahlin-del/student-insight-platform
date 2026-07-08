-- Migration: 20260708060000_audience_student_parent.sql
--
-- LATAR BELAKANG:
-- Fitur audience RESTRICTED diperluas: selain aktor staf internal, guru kini
-- bisa menambahkan SISWA SUBJEK kasus/observasi dan ORANG TUA siswa tersebut
-- ke daftar audiens. Akses siswa/ortu ke kasus RESTRICTED diubah dari otomatis
-- (berdasar student_id/FK ortu) menjadi opt-in eksplisit per-item oleh guru.
-- Akses ke observasi RESTRICTED via observation_audience_members juga dibuka
-- untuk siswa/ortu yang ditambahkan secara eksplisit.
--
-- DAFTAR PERUBAHAN:
-- A. Catatan: client mengirim added_by_user_id (fix di client-code, bukan SQL)
-- B. ADD COLUMN added_by_user_id ke observation_audience_members
-- C. Fungsi baru: fn_is_case_subject_or_parent(case_id, user_id)
-- D. Fungsi baru: fn_is_observation_subject_or_parent(obs_id, user_id)
-- E. Perluas rls_cam_insert: tambah OR subjek/ortu kasus
-- F. Perketat + perluas rls_obs_audience_insert: added_by_user_id + subjek/ortu
-- G. DROP rls_cases_read_student + rls_cases_read_parent (ganti ke opt-in via
--    rls_cases_read_staff + fn_can_see_case + case_audience_members)
-- H. Policy SELECT baru: rls_observations_read_student (opt-in via OAM)
-- I. Policy SELECT baru: rls_observations_read_parent (opt-in via OAM)
-- J. Policy SELECT baru: rls_obs_audience_read_own (siswa/ortu lihat baris
--    milik sendiri — diperlukan agar EXISTS di Bagian H/I bisa berjalan;
--    RLS tabel target berlaku juga untuk subquery inline policy)
--
-- ROLLBACK:
--   DROP FUNCTION public.fn_is_case_subject_or_parent(uuid,uuid);
--   DROP FUNCTION public.fn_is_observation_subject_or_parent(uuid,uuid);
--   DROP POLICY rls_cam_insert ON public.case_audience_members;
--   <re-create rls_cam_insert dari migration 20260708030000>
--   DROP POLICY rls_obs_audience_insert ON public.observation_audience_members;
--   <re-create rls_obs_audience_insert dari migration 20260706130001>
--   DROP POLICY rls_observations_read_student ON public.observations;
--   DROP POLICY rls_observations_read_parent ON public.observations;
--   DROP POLICY rls_obs_audience_read_own ON public.observation_audience_members;
--   <re-create rls_cases_read_student + rls_cases_read_parent>
--   ALTER TABLE public.observation_audience_members DROP COLUMN added_by_user_id;

-- ═══════════════════════════════════════════════════════════════════
-- BAGIAN A — Catatan client fix (tidak ada SQL di sini)
-- ═══════════════════════════════════════════════════════════════════
-- addCaseAudienceMember dan addObsAudienceMember sekarang mengirim
-- added_by_user_id: currentUser.user_id dari dashboard.js.
-- rls_cam_insert (migration 20260708030000) sudah cek added_by_user_id;
-- yang sebelumnya hilang adalah nilai dari client. Setelah migration ini,
-- rls_obs_audience_insert (Bagian F) juga mensyaratkan added_by_user_id.

-- ═══════════════════════════════════════════════════════════════════
-- BAGIAN B — Tambah kolom added_by_user_id ke observation_audience_members
-- ═══════════════════════════════════════════════════════════════════
ALTER TABLE public.observation_audience_members
    ADD COLUMN IF NOT EXISTS added_by_user_id uuid REFERENCES public.users(user_id);

-- ═══════════════════════════════════════════════════════════════════
-- BAGIAN C — fn_is_case_subject_or_parent(p_case_id, p_user_id)
-- Mengembalikan TRUE jika p_user_id adalah siswa subjek kasus tersebut
-- atau orang tua dari siswa subjek. SECURITY DEFINER agar tidak diblokir
-- RLS saat dipanggil dari dalam WITH CHECK policy.
-- Cek school_id diinline untuk isolasi tenant (fn_current_school_id()
-- berjalan sebagai postgres saat fungsi dipanggil oleh caller authenticated).
-- ═══════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.fn_is_case_subject_or_parent(p_case_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
    SELECT EXISTS (
        SELECT 1 FROM cases c
        JOIN students s ON s.student_id = c.student_id
        WHERE c.case_id   = p_case_id
          AND c.school_id = fn_current_school_id()
          AND (
              s.user_id = p_user_id
              OR EXISTS (
                  SELECT 1 FROM student_parents sp
                  WHERE sp.student_id    = s.student_id
                    AND sp.parent_user_id = p_user_id
              )
          )
    );
$$;
REVOKE EXECUTE ON FUNCTION public.fn_is_case_subject_or_parent(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_is_case_subject_or_parent(uuid, uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.fn_is_case_subject_or_parent(uuid, uuid) TO authenticated;
GRANT  EXECUTE ON FUNCTION public.fn_is_case_subject_or_parent(uuid, uuid) TO service_role;

-- ═══════════════════════════════════════════════════════════════════
-- BAGIAN D — fn_is_observation_subject_or_parent(p_observation_id, p_user_id)
-- Pola identik dengan Bagian C, untuk observasi.
-- ═══════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.fn_is_observation_subject_or_parent(p_observation_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
    SELECT EXISTS (
        SELECT 1 FROM observations o
        JOIN students s ON s.student_id = o.student_id
        WHERE o.observation_id = p_observation_id
          AND o.school_id      = fn_current_school_id()
          AND (
              s.user_id = p_user_id
              OR EXISTS (
                  SELECT 1 FROM student_parents sp
                  WHERE sp.student_id    = s.student_id
                    AND sp.parent_user_id = p_user_id
              )
          )
    );
$$;
REVOKE EXECUTE ON FUNCTION public.fn_is_observation_subject_or_parent(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_is_observation_subject_or_parent(uuid, uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.fn_is_observation_subject_or_parent(uuid, uuid) TO authenticated;
GRANT  EXECUTE ON FUNCTION public.fn_is_observation_subject_or_parent(uuid, uuid) TO service_role;

-- ═══════════════════════════════════════════════════════════════════
-- BAGIAN E — Perluas rls_cam_insert
-- Sebelumnya: hanya role staf internal.
-- Sekarang:   OR siswa subjek kasus / orang tua siswa subjek.
-- fn_is_internal_case_actor() + fn_can_see_case() tetap diperlukan
-- sebagai guard untuk PEMANGGIL (guru yang menambahkan), bukan untuk
-- user_id yang ditambahkan (yang bisa siswa/ortu).
-- ═══════════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS rls_cam_insert ON public.case_audience_members;
CREATE POLICY rls_cam_insert ON public.case_audience_members
FOR INSERT TO public
WITH CHECK (
    school_id          = fn_current_school_id()
    AND added_by_user_id = fn_current_user_id()
    AND fn_is_internal_case_actor()
    AND fn_can_see_case(case_id)
    AND (
        -- Target adalah staf internal
        EXISTS (
            SELECT 1 FROM public.users u
            WHERE u.user_id    = case_audience_members.user_id
              AND u.school_id  = fn_current_school_id()
              AND (
                  u.role_type IN (
                      'GURU','BK','WALI_KELAS','KAPRODI','WAKA_KESISWAAN','KEPSEK'
                  )
                  OR u.is_bk OR u.is_kepsek OR u.is_waka_kesiswaan
              )
        )
        -- ATAU target adalah siswa subjek kasus / orang tua siswa subjek
        OR fn_is_case_subject_or_parent(case_audience_members.case_id, case_audience_members.user_id)
    )
);

-- ═══════════════════════════════════════════════════════════════════
-- BAGIAN F — Perketat + perluas rls_obs_audience_insert
-- Sebelumnya: tidak ada filter pada user_id yang dimasukkan (hanya
-- cek caller adalah author obs). Sekarang: + added_by_user_id + target
-- harus staf internal ATAU siswa/ortu subjek obs.
-- ═══════════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS rls_obs_audience_insert ON public.observation_audience_members;
CREATE POLICY rls_obs_audience_insert ON public.observation_audience_members
FOR INSERT TO public
WITH CHECK (
    school_id            = fn_current_school_id()
    AND added_by_user_id = fn_current_user_id()
    AND EXISTS (
        SELECT 1 FROM public.observations o
        WHERE o.observation_id = observation_audience_members.observation_id
          AND o.author_user_id = fn_current_user_id()
    )
    AND (
        -- Target adalah staf internal
        EXISTS (
            SELECT 1 FROM public.users u
            WHERE u.user_id    = observation_audience_members.user_id
              AND u.school_id  = fn_current_school_id()
              AND (
                  u.role_type IN (
                      'GURU','BK','WALI_KELAS','KAPRODI','WAKA_KESISWAAN','KEPSEK'
                  )
                  OR u.is_bk OR u.is_kepsek OR u.is_waka_kesiswaan
              )
        )
        -- ATAU target adalah siswa subjek observasi / orang tua siswa subjek
        OR fn_is_observation_subject_or_parent(observation_audience_members.observation_id, observation_audience_members.user_id)
    )
);

-- ═══════════════════════════════════════════════════════════════════
-- BAGIAN G — Hapus akses otomatis siswa/ortu ke cases RESTRICTED
-- Akses diganti ke opt-in via rls_cases_read_staff + fn_can_see_case
-- + case_audience_members (guru harus eksplisit menambahkan mereka).
-- fn_can_see_case bersifat SECURITY DEFINER, jadi bisa baca
-- case_audience_members tanpa diblokir RLS — jalur akses tetap terbuka
-- bagi siswa/ortu yang sudah dimasukkan ke CAM via Bagian E.
-- ═══════════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS rls_cases_read_student ON public.cases;
DROP POLICY IF EXISTS rls_cases_read_parent  ON public.cases;

-- ═══════════════════════════════════════════════════════════════════
-- BAGIAN H — Policy SELECT observasi untuk siswa (opt-in via OAM)
-- ═══════════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS rls_observations_read_student ON public.observations;
CREATE POLICY rls_observations_read_student ON public.observations
FOR SELECT TO public
USING (
    school_id = fn_current_school_id()
    AND fn_current_user_role() = 'SISWA'
    AND visibility = 'RESTRICTED'
    AND EXISTS (
        SELECT 1 FROM observation_audience_members oam
        WHERE oam.observation_id = observations.observation_id
          AND oam.user_id        = fn_current_user_id()
    )
);

-- ═══════════════════════════════════════════════════════════════════
-- BAGIAN I — Policy SELECT observasi untuk ortu (opt-in via OAM)
-- ═══════════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS rls_observations_read_parent ON public.observations;
CREATE POLICY rls_observations_read_parent ON public.observations
FOR SELECT TO public
USING (
    school_id = fn_current_school_id()
    AND fn_current_user_role() = 'ORTU'
    AND visibility = 'RESTRICTED'
    AND EXISTS (
        SELECT 1 FROM observation_audience_members oam
        WHERE oam.observation_id = observations.observation_id
          AND oam.user_id        = fn_current_user_id()
    )
);

-- ═══════════════════════════════════════════════════════════════════
-- BAGIAN J — Policy SELECT observation_audience_members untuk siswa/ortu
-- Diperlukan karena EXISTS subquery di Bagian H/I dievaluasi dengan
-- RLS tabel target (observation_audience_members). Tanpa policy ini,
-- siswa/ortu tidak bisa membaca baris OAM mereka sendiri sehingga
-- EXISTS selalu FALSE → observasi tidak pernah terlihat.
-- Scope: hanya baris di mana user_id = dirinya sendiri.
-- ═══════════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS rls_obs_audience_read_own ON public.observation_audience_members;
CREATE POLICY rls_obs_audience_read_own ON public.observation_audience_members
FOR SELECT TO public
USING (
    school_id = fn_current_school_id()
    AND user_id = fn_current_user_id()
    AND fn_current_user_role() = ANY (ARRAY['SISWA'::role_type, 'ORTU'::role_type])
);