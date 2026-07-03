-- ============================================================
-- Migration 20260703250000: Model AUDIENS kasus + kunci ESKALASI
-- (Langkah A dari desain kasus/eskalasi — lihat memory
--  project-case-escalation-design)
--
-- Keputusan (disepakati user, 3 Jul 2026):
--  1) Audiens per-kasus ala-Facebook, diatur PEMBUAT:
--       PRIVATE (default) / RESTRICTED (orang tertentu) / PUBLIC.
--     Kasus LAHIR privat.
--  2) "Aktor internal kasus" = 6 peran: GURU, BK, WALI_KELAS,
--     KAPRODI, WAKA_KESISWAAN, KEPSEK. (Waka Kurikulum & TU BUKAN
--     aktor kasus.) Semua 6 boleh BUAT kasus (+ DUDI utk siswa PKL-nya).
--  3) Eskalasi BEBAS antar-internal (TANPA kunci rantai — rantai
--     hanya penuntun di UI). Dua kunci KERAS server:
--       - target eskalasi WAJIB salah satu dari 6 peran internal
--         (tolak SISWA/ORTU/STAKEHOLDER/DUDI/WAKA_KURIKULUM/TU);
--       - DUDI hanya boleh eskalasi ke KAPRODI.
--  4) Baca kasus jadi AUDIENS-AWARE & konsisten (cases + case_events):
--       terlibat/penangan → selalu; PUBLIC → semua internal;
--       RESTRICTED → anggota; DUDI → siswa binaannya.
--     Ini MENGGANTIKAN visibilitas lama berbasis fn_can_see_student —
--     pengetatan yang DISENGAJA (disetujui user): kasus PRIVAT tak
--     lagi ter-intip oleh siapa pun yang sekadar "bisa lihat siswa".
--
-- Pra-launch: 3 kasus uji + 2 event uji live → semua jadi PRIVATE
-- (default kolom). Tanpa data nyata, tanpa risiko.
--
-- Basis: introspeksi LIVE (bukan contracts yg basi) — role_type live
-- SUDAH punya WAKA_KESISWAAN; fn_case_sync_handler live tak punya
-- kunci rantai; rls_cases_insert live hanya (GURU,KEPSEK,DUDI).
--
-- ROLLBACK: lihat blok komentar di bawah COMMIT.
-- ============================================================

BEGIN;

-- ── 1. Enum audiens kasus ───────────────────────────────────
CREATE TYPE case_audience AS ENUM ('PRIVATE', 'RESTRICTED', 'PUBLIC');

-- ── 2. Kolom audiens (kasus LAHIR privat) ───────────────────
ALTER TABLE cases
    ADD COLUMN audience case_audience NOT NULL DEFAULT 'PRIVATE';

COMMENT ON COLUMN cases.audience IS
    'Audiens kasus (ala-FB), diatur pembuat/penangan: PRIVATE (hanya terlibat) / '
    'RESTRICTED (case_audience_members) / PUBLIC (semua aktor internal kasus). '
    'DUDI selalu PRIVATE. Lahir PRIVATE.';

-- ── 3. Daftar "orang tertentu" untuk audiens RESTRICTED ─────
CREATE TABLE case_audience_members (
    case_id          UUID        NOT NULL REFERENCES cases(case_id) ON DELETE CASCADE,
    user_id          UUID        NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    school_id        UUID        NOT NULL,
    added_by_user_id UUID        REFERENCES users(user_id) ON DELETE SET NULL,
    added_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (case_id, user_id)
);
CREATE INDEX idx_case_audience_user ON case_audience_members(user_id);
CREATE INDEX idx_case_audience_case ON case_audience_members(case_id);

COMMENT ON TABLE case_audience_members IS
    'Penonton pilihan untuk kasus audiens RESTRICTED ("orang tertentu"). '
    'Hanya aktor internal kasus yang boleh jadi anggota (fn_user_is_internal_case_actor).';

-- ── 4. Predikat pembantu ────────────────────────────────────
-- Aktor internal kasus = 6 peran (via role_type ATAU jabatan-flag).
CREATE OR REPLACE FUNCTION fn_is_internal_case_actor()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
    SELECT fn_current_user_role() = ANY (ARRAY['GURU','BK','WALI_KELAS','KAPRODI','WAKA_KESISWAAN','KEPSEK']::role_type[])
        OR fn_is_bk() OR fn_is_kepsek() OR fn_is_waka_kesiswaan();
$$;

-- Apakah user (by id) aktor internal kasus — untuk validasi anggota audiens.
CREATE OR REPLACE FUNCTION fn_user_is_internal_case_actor(p_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
    SELECT EXISTS (
        SELECT 1 FROM users u
        WHERE u.user_id = p_user_id
          AND ( u.role_type = ANY (ARRAY['GURU','BK','WALI_KELAS','KAPRODI','WAKA_KESISWAAN','KEPSEK']::role_type[])
                OR u.is_bk OR u.is_kepsek OR u.is_waka_kesiswaan )
    );
$$;

-- Boleh-lihat-kasus TERPADU (dipakai baca cases & case_events → konsisten).
-- Penting: sertakan fn_matches_case_handler agar penangan yang BARU dieskalasi
-- (belum menulis event) tetap bisa melihat kasus PRIVAT-nya.
CREATE OR REPLACE FUNCTION fn_can_see_case(p_case_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
    SELECT EXISTS (
        SELECT 1 FROM cases c
        WHERE c.case_id   = p_case_id
          AND c.school_id = fn_current_school_id()
          AND (
                fn_involved_in_case(p_case_id)                                 -- pembuat / penulis event
             OR fn_matches_case_handler(c.current_handler_role, c.student_id)  -- penangan kini
             OR (c.audience = 'PUBLIC'     AND fn_is_internal_case_actor())     -- publik → semua internal
             OR (c.audience = 'RESTRICTED' AND EXISTS (
                    SELECT 1 FROM case_audience_members m
                    WHERE m.case_id = p_case_id AND m.user_id = fn_current_user_id()))
             OR (fn_current_user_role() = 'DUDI' AND fn_dudi_supervises_student(c.student_id))
          )
    );
$$;

-- ── 5. Perluas PEMBUAT kasus ke semua aktor internal + DUDI ─
--     (live lama hanya GURU/KEPSEK/DUDI). DUDI wajib PRIVATE.
DROP POLICY IF EXISTS rls_cases_insert ON cases;
CREATE POLICY rls_cases_insert ON cases
    FOR INSERT WITH CHECK (
        school_id              = fn_current_school_id()
        AND created_by_user_id = fn_current_user_id()
        AND initiated_by_role  = fn_current_user_role()
        AND (
              fn_current_user_role() = ANY (ARRAY['GURU','BK','WALI_KELAS','KAPRODI','WAKA_KESISWAAN','KEPSEK']::role_type[])
           OR (fn_current_user_role() = 'DUDI' AND fn_dudi_supervises_student(student_id))
        )
        -- DUDI tak boleh publikasi: kasusnya selalu PRIVATE
        AND (fn_current_user_role() <> 'DUDI' OR audience = 'PRIVATE')
    );

-- ── 6. Baca kasus & event jadi audiens-aware (konsisten) ────
DROP POLICY IF EXISTS rls_cases_read_staff ON cases;
CREATE POLICY rls_cases_read_staff ON cases
    FOR SELECT USING (
        school_id = fn_current_school_id() AND fn_can_see_case(case_id)
    );

DROP POLICY IF EXISTS rls_case_events_read_staff ON case_events;
CREATE POLICY rls_case_events_read_staff ON case_events
    FOR SELECT USING (
        school_id = fn_current_school_id() AND fn_can_see_case(case_id)
    );

-- ── 7. Ubah AUDIENS (publik⇄privat) oleh aktor internal ─────
--     Policy UPDATE tambahan. Kolom lain tetap dijaga trigger
--     immutable/guard (status/handler/lock/title/dst) — jadi
--     efektifnya policy ini hanya mengizinkan ganti `audience`.
--     school_id dipatok (USING+CHECK) → tak bisa pindah tenant.
CREATE POLICY rls_cases_update_audience ON cases
    FOR UPDATE
    USING (
        school_id = fn_current_school_id()
        AND fn_is_internal_case_actor()
        AND fn_can_see_case(case_id)
    )
    WITH CHECK (
        school_id = fn_current_school_id()
        AND fn_is_internal_case_actor()
        AND fn_can_see_case(case_id)
    );

-- ── 8. RLS + policy untuk case_audience_members ─────────────
ALTER TABLE case_audience_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY rls_cam_read ON case_audience_members
    FOR SELECT USING (
        school_id = fn_current_school_id() AND fn_can_see_case(case_id)
    );

CREATE POLICY rls_cam_insert ON case_audience_members
    FOR INSERT WITH CHECK (
        school_id            = fn_current_school_id()
        AND added_by_user_id = fn_current_user_id()
        AND fn_is_internal_case_actor()
        AND fn_can_see_case(case_id)
        AND fn_user_is_internal_case_actor(user_id)   -- hanya aktor internal boleh jadi audiens
    );

CREATE POLICY rls_cam_delete ON case_audience_members
    FOR DELETE USING (
        school_id = fn_current_school_id()
        AND fn_is_internal_case_actor()
        AND fn_can_see_case(case_id)
    );

GRANT SELECT, INSERT, DELETE ON case_audience_members TO authenticated;
GRANT ALL                    ON case_audience_members TO service_role;

-- ── 9. Kunci KERAS eskalasi (trigger BEFORE INSERT) ─────────
CREATE OR REPLACE FUNCTION fn_case_validate_escalate()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.event_type = 'DECISION_ESCALATE' THEN
        -- (a) target WAJIB salah satu 6 peran internal penangan kasus
        IF NEW.new_handler_role IS NULL
           OR NOT (NEW.new_handler_role = ANY (ARRAY['GURU','BK','WALI_KELAS','KAPRODI','WAKA_KESISWAAN','KEPSEK']::role_type[]))
        THEN
            RAISE EXCEPTION
                'escalate_target_invalid: % bukan peran internal penangan kasus', NEW.new_handler_role
                USING ERRCODE = 'check_violation';
        END IF;
        -- (b) DUDI hanya boleh eskalasi ke KAPRODI
        IF NEW.author_role_at_time = 'DUDI' AND NEW.new_handler_role <> 'KAPRODI' THEN
            RAISE EXCEPTION
                'escalate_dudi_only_kaprodi: DUDI hanya boleh eskalasi ke KAPRODI'
                USING ERRCODE = 'check_violation';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_case_validate_escalate ON case_events;
CREATE TRIGGER trg_case_validate_escalate
    BEFORE INSERT ON case_events
    FOR EACH ROW EXECUTE FUNCTION fn_case_validate_escalate();

COMMIT;

-- ============================================================
-- ROLLBACK (manual):
--   BEGIN;
--   DROP TRIGGER  IF EXISTS trg_case_validate_escalate ON case_events;
--   DROP FUNCTION IF EXISTS fn_case_validate_escalate();
--   DROP POLICY   IF EXISTS rls_cam_delete ON case_audience_members;
--   DROP POLICY   IF EXISTS rls_cam_insert ON case_audience_members;
--   DROP POLICY   IF EXISTS rls_cam_read   ON case_audience_members;
--   DROP TABLE    IF EXISTS case_audience_members;
--   DROP POLICY   IF EXISTS rls_cases_update_audience ON cases;
--   DROP FUNCTION IF EXISTS fn_can_see_case(uuid);
--   DROP FUNCTION IF EXISTS fn_user_is_internal_case_actor(uuid);
--   DROP FUNCTION IF EXISTS fn_is_internal_case_actor();
--   ALTER TABLE cases DROP COLUMN IF EXISTS audience;
--   DROP TYPE IF EXISTS case_audience;
--   -- lalu pulihkan policy lama dari git:
--   --   rls_cases_insert  (GURU,KEPSEK,DUDI + dudi supervises)
--   --   rls_cases_read_staff (fn_can_see_student OR fn_involved_in_case)
--   --   rls_case_events_read_staff (role IN 6 + case exists)
--   COMMIT;
-- ============================================================
