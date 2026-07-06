-- Langkah 2/2: Tabel, migrasi data, dan RLS untuk model
-- visibilitas observasi PRIVATE/RESTRICTED/PUBLIC.

-- ── 1. Tabel anggota audiens observasi ───────────────────────
CREATE TABLE IF NOT EXISTS observation_audience_members (
    id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    observation_id uuid        NOT NULL REFERENCES observations(observation_id) ON DELETE CASCADE,
    user_id        uuid        NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    school_id      uuid        NOT NULL,
    added_at       timestamptz NOT NULL DEFAULT now(),
    UNIQUE (observation_id, user_id)
);

ALTER TABLE observation_audience_members ENABLE ROW LEVEL SECURITY;

-- ── 2. Migrasi data lama → PUBLIC ────────────────────────────
-- Bypass trigger immutabilitas lama agar bisa update visibility.
-- session_replication_role=replica menonaktifkan user trigger pada sesi ini.
SET session_replication_role = 'replica';
UPDATE observations
SET visibility = 'PUBLIC'::visibility_level
WHERE visibility IN ('INTERNAL_SCHOOL'::visibility_level, 'STUDENT_VISIBLE'::visibility_level);
SET session_replication_role = 'origin';

-- ── 3. Perbarui RLS observations ─────────────────────────────
DROP POLICY IF EXISTS rls_observations_read_staff   ON observations;
DROP POLICY IF EXISTS rls_observations_read_waka    ON observations;
DROP POLICY IF EXISTS rls_observations_read_student ON observations;
DROP POLICY IF EXISTS rls_observations_read_parent  ON observations;

-- Staf internal: baca berdasarkan PRIVATE / RESTRICTED / PUBLIC
CREATE POLICY rls_observations_read_staff ON observations FOR SELECT
    USING (
        school_id = fn_current_school_id()
        AND fn_current_user_role() = ANY (
            ARRAY['GURU','BK','WALI_KELAS','KAPRODI','KEPSEK',
                  'WAKA_KESISWAAN','WAKA_KURIKULUM']::role_type[]
        )
        AND (
            visibility = 'PUBLIC'::visibility_level
            OR (visibility = 'PRIVATE'::visibility_level
                AND author_user_id = fn_current_user_id())
            OR (visibility = 'RESTRICTED'::visibility_level
                AND (
                    author_user_id = fn_current_user_id()
                    OR EXISTS (
                        SELECT 1 FROM observation_audience_members oam
                        WHERE oam.observation_id = observations.observation_id
                          AND oam.user_id        = fn_current_user_id()
                    )
                ))
        )
    );

-- Penulis observasi boleh memperbarui visibilitas miliknya
DROP POLICY IF EXISTS rls_observations_update_author ON observations;
CREATE POLICY rls_observations_update_author ON observations FOR UPDATE
    USING  (school_id = fn_current_school_id() AND author_user_id = fn_current_user_id())
    WITH CHECK (school_id = fn_current_school_id() AND author_user_id = fn_current_user_id());

-- ── 4. RLS observation_audience_members ──────────────────────
CREATE POLICY rls_obs_audience_read ON observation_audience_members FOR SELECT
    USING (
        school_id = fn_current_school_id()
        AND fn_current_user_role() = ANY (
            ARRAY['GURU','BK','WALI_KELAS','KAPRODI','KEPSEK',
                  'WAKA_KESISWAAN','WAKA_KURIKULUM']::role_type[]
        )
    );

CREATE POLICY rls_obs_audience_insert ON observation_audience_members FOR INSERT
    WITH CHECK (
        school_id = fn_current_school_id()
        AND EXISTS (
            SELECT 1 FROM observations o
            WHERE o.observation_id = observation_audience_members.observation_id
              AND o.author_user_id = fn_current_user_id()
        )
    );

CREATE POLICY rls_obs_audience_delete ON observation_audience_members FOR DELETE
    USING (
        school_id = fn_current_school_id()
        AND EXISTS (
            SELECT 1 FROM observations o
            WHERE o.observation_id = observation_audience_members.observation_id
              AND o.author_user_id = fn_current_user_id()
        )
    );
