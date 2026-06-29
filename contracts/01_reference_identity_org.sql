-- ============================================================
-- FILE: 01_reference_identity_org.sql
-- LAYERS: 1 (reference), 2 (identity), 3 (organizational)
-- APPLY ORDER: After 00_extensions_enums.sql
-- ============================================================


-- ============================================================
-- LAYER 1 — REFERENCE TABLES
-- ============================================================

-- ------------------------------------------------------------
-- TABLE: programs
-- Program Keahlian (e.g., TKJ, Akuntansi, Multimedia).
-- Reference data. Governs CaseTrack = PKL eligibility.
-- ------------------------------------------------------------
CREATE TABLE programs (
    program_id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code                VARCHAR(20)  NOT NULL UNIQUE,
    name                VARCHAR(100) NOT NULL,
    is_active           BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE programs IS
    'Program Keahlian SMK. Reference data. Governs PKL case track eligibility.';


-- ------------------------------------------------------------
-- TABLE: subjects
-- Mata pelajaran. Reference data.
-- ------------------------------------------------------------
CREATE TABLE subjects (
    subject_id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code                VARCHAR(20)  NOT NULL UNIQUE,
    name                VARCHAR(100) NOT NULL,
    is_active           BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE subjects IS
    'Mata pelajaran. Reference data used in teaching_assignments.';


-- ============================================================
-- LAYER 2 — CORE IDENTITY
-- ============================================================

-- ------------------------------------------------------------
-- TABLE: users
-- Represents all human actors in the system.
-- One row per person. Single role per user (no multi-role).
--
-- TN-01: WALI_KELAS designation stored as wali_kelas_class_id
-- nullable FK here — not as a separate role_type value.
-- A user with role_type = GURU can simultaneously be Wali Kelas
-- if wali_kelas_class_id is non-null.
--
-- auth_user_id: FK to Supabase auth.users. 1:1 mapping.
-- dudi_org_name: only relevant when role_type = DUDI.
-- ------------------------------------------------------------
CREATE TABLE users (
    user_id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    auth_user_id        UUID         NOT NULL UNIQUE,  -- FK to auth.users
    full_name           VARCHAR(150) NOT NULL,
    email               VARCHAR(254) NOT NULL UNIQUE,
    login_identifier    VARCHAR(100) NOT NULL UNIQUE,  -- NIP/NIS/NIK/nama usaha slug
    identifier_type     VARCHAR(20)  NOT NULL,
    role_type           role_type    NOT NULL,
    program_id          UUID         REFERENCES programs(program_id) ON DELETE RESTRICT,
    wali_kelas_class_id UUID,        -- FK to classes, set after classes table created
    dudi_org_name       VARCHAR(150),
    -- Short human-readable code for teachers (e.g. "SUSI.M"), used by
    -- schedule_templates CSV import to identify the teacher without
    -- requiring NIP. NULL for non-teaching roles.
    teacher_code        VARCHAR(20)  NULL UNIQUE,
    is_active           BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    -- DUDI users must have an org name
    CONSTRAINT chk_dudi_org_name
        CHECK (role_type != 'DUDI' OR dudi_org_name IS NOT NULL),

    -- wali_kelas_class_id is only valid for GURU role
    CONSTRAINT chk_wali_kelas_role
        CHECK (wali_kelas_class_id IS NULL OR role_type IN ('GURU', 'WALI_KELAS')),

    -- login_identifier kind must be one of the recognized identity document types
    CONSTRAINT chk_identifier_type
        CHECK (identifier_type IN ('NIP', 'NIS', 'NIK', 'NAMA_USAHA'))
);

COMMENT ON TABLE users IS
    'All human actors. Single role per user. Supabase auth.users linked via auth_user_id.';
COMMENT ON COLUMN users.wali_kelas_class_id IS
    'TN-01: Wali Kelas designation. Non-null only for GURU users acting as class guardian.';
COMMENT ON COLUMN users.auth_user_id IS
    'References auth.users(id) in Supabase. Managed by Supabase Auth.';
COMMENT ON COLUMN users.login_identifier IS
    'Public-facing identity document used to log in (NIP/NIS/NIK) or a generated slug (NAMA_USAHA for DUDI).';
COMMENT ON COLUMN users.identifier_type IS
    'Kind of login_identifier: NIP (staff), NIS (siswa), NIK (ortu), NAMA_USAHA (DUDI).';


-- ------------------------------------------------------------
-- TABLE: students
-- Aggregate root. Separate from users — students have their
-- own identity (NIS) and are not system actors by default
-- until a SISWA user account is created for them.
-- ------------------------------------------------------------
CREATE TABLE students (
    student_id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    nis                 VARCHAR(20)    NOT NULL UNIQUE,  -- Nomor Induk Siswa, immutable
    full_name           VARCHAR(150)   NOT NULL,
    program_id          UUID           NOT NULL REFERENCES programs(program_id) ON DELETE RESTRICT,
    student_status      student_status NOT NULL DEFAULT 'AKTIF',
    -- Optional link to a SISWA user account
    user_id             UUID           UNIQUE REFERENCES users(user_id) ON DELETE SET NULL,
    -- Populated only when student_status transitions to LULUS (see setup wizard's
    -- "Tutup Tahun Ajaran" flow). 1:1 with student — no separate graduation table.
    graduated_at             TIMESTAMPTZ NULL,
    graduated_academic_year  VARCHAR(9)  NULL,
    created_at          TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ    NOT NULL DEFAULT NOW(),

    -- NIS is immutable after creation (enforced via trigger trg_student_nis_immutable)
    CONSTRAINT chk_nis_not_empty CHECK (nis <> '')
);

COMMENT ON TABLE students IS
    'Student aggregate root. NIS is immutable (enforced by trigger). '
    'Separate from users — students get a user account only when portal access is provisioned.';
COMMENT ON COLUMN students.nis IS
    'Nomor Induk Siswa. Immutable after first INSERT. Trigger trg_student_nis_immutable enforces this.';


-- ------------------------------------------------------------
-- TABLE: student_parents
-- Many-to-many link between students and ORTU user accounts.
-- Replaces the old students.parent_user_id single-FK column —
-- a student can have multiple guardians (e.g., both parents).
-- ------------------------------------------------------------
CREATE TABLE student_parents (
    id                  UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    student_id          UUID        NOT NULL REFERENCES students(student_id) ON DELETE RESTRICT,
    parent_user_id      UUID        NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_student_parent UNIQUE (student_id, parent_user_id)
);

CREATE INDEX idx_student_parents_student ON student_parents(student_id);
CREATE INDEX idx_student_parents_parent  ON student_parents(parent_user_id);

COMMENT ON TABLE student_parents IS
    'Many-to-many student↔ORTU relation. A student may have more than one linked guardian.';


-- ============================================================
-- LAYER 3 — ORGANIZATIONAL
-- ============================================================

-- ------------------------------------------------------------
-- TABLE: classes
-- Rombel (Rombongan Belajar).
-- ------------------------------------------------------------
CREATE TABLE classes (
    class_id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name                VARCHAR(50)  NOT NULL,            -- e.g., "X TKJ 1"
    program_id          UUID         NOT NULL REFERENCES programs(program_id) ON DELETE RESTRICT,
    academic_year       VARCHAR(9)   NOT NULL,            -- e.g., "2024/2025"
    grade_level         SMALLINT     NOT NULL CHECK (grade_level BETWEEN 10 AND 12),
    is_active           BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_class_name_year UNIQUE (name, academic_year)
);

COMMENT ON TABLE classes IS 'Rombel (Rombongan Belajar). One per class per academic year.';


-- Add FK from users.wali_kelas_class_id now that classes exists
ALTER TABLE users
    ADD CONSTRAINT fk_users_wali_kelas_class
    FOREIGN KEY (wali_kelas_class_id) REFERENCES classes(class_id) ON DELETE SET NULL;


-- ------------------------------------------------------------
-- TABLE: class_enrollments
-- History-preserving. A student can be enrolled in one class
-- per academic_year+semester at a time.
-- Invariant: no overlapping active enrollment for same student.
-- ------------------------------------------------------------
CREATE TABLE class_enrollments (
    enrollment_id       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    student_id          UUID         NOT NULL REFERENCES students(student_id) ON DELETE RESTRICT,
    class_id            UUID         NOT NULL REFERENCES classes(class_id) ON DELETE RESTRICT,
    academic_year       VARCHAR(9)   NOT NULL,
    semester            semester     NOT NULL,
    enrolled_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    withdrawn_at        TIMESTAMPTZ,   -- null = currently enrolled
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    -- A student can only be enrolled once per class per academic period
    CONSTRAINT uq_enrollment_per_period
        UNIQUE (student_id, academic_year, semester),

    -- withdrawn_at must be after enrolled_at if set
    CONSTRAINT chk_withdrawal_after_enrollment
        CHECK (withdrawn_at IS NULL OR withdrawn_at > enrolled_at)
);

CREATE INDEX idx_enrollments_student ON class_enrollments(student_id, academic_year, semester);
CREATE INDEX idx_enrollments_class   ON class_enrollments(class_id, academic_year, semester);

COMMENT ON TABLE class_enrollments IS
    'History-preserving. Invariant: one active enrollment per student per academic period.';


-- ------------------------------------------------------------
-- TABLE: academic_periods
-- One row per (academic_year, semester). The CLOSED status is
-- what locks period-bound data (attendance, observations,
-- journals) by event date — see trg_*_period_lock triggers in
-- 05_triggers_functions.sql. Long-lived records (cases, etc.)
-- are intentionally NOT gated by this table.
-- ------------------------------------------------------------
CREATE TABLE academic_periods (
    id                  UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
    academic_year       VARCHAR(9)   NOT NULL,
    semester            semester     NOT NULL,
    start_date          DATE         NOT NULL,
    end_date            DATE         NOT NULL,
    status              VARCHAR(20)  NOT NULL DEFAULT 'ACTIVE'
        CHECK (status IN ('ACTIVE', 'CLOSED')),
    closed_at           TIMESTAMPTZ  NULL,
    closed_by_user_id   UUID         NULL REFERENCES users(user_id) ON DELETE RESTRICT,
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_academic_period UNIQUE (academic_year, semester),
    CONSTRAINT chk_period_dates CHECK (end_date > start_date)
);

CREATE INDEX idx_academic_periods_status ON academic_periods(status);

COMMENT ON TABLE academic_periods IS
    'Defines the start/end date of each academic_year+semester and whether it '
    'is CLOSED for period-bound data entry (attendance/observations/journals). '
    'Locking is by event date falling inside a CLOSED period, not by record FK.';


-- ------------------------------------------------------------
-- TABLE: pkl_placements
-- Only for students with student_status = PKL.
-- Invariant: status = PKL ⇒ must have active placement.
-- Enforced at application layer + checked via trigger.
-- ------------------------------------------------------------
CREATE TABLE pkl_placements (
    placement_id        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    student_id          UUID        NOT NULL REFERENCES students(student_id) ON DELETE RESTRICT,
    dudi_user_id        UUID        NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
    start_date          DATE        NOT NULL,
    end_date            DATE        NOT NULL,
    is_active           BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_pkl_date_range CHECK (end_date > start_date),

    -- Only one active placement per student at a time
    CONSTRAINT uq_active_pkl_per_student
        EXCLUDE USING gist (student_id WITH =, daterange(start_date, end_date) WITH &&)
        WHERE (is_active = TRUE)
);

CREATE INDEX idx_pkl_placements_student  ON pkl_placements(student_id) WHERE is_active = TRUE;
CREATE INDEX idx_pkl_placements_dudi     ON pkl_placements(dudi_user_id) WHERE is_active = TRUE;

COMMENT ON TABLE pkl_placements IS
    'PKL placement. Invariant: student with status=PKL must have an active placement. '
    'DUDI user scoped via RLS to only see their own students.';


-- ------------------------------------------------------------
-- TABLE: teaching_assignments
-- Links a GURU user to a class and subject for a period.
-- Used for attendance input authorization and permission gating.
-- ------------------------------------------------------------
CREATE TABLE teaching_assignments (
    assignment_id       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id             UUID        NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
    class_id            UUID        NOT NULL REFERENCES classes(class_id) ON DELETE RESTRICT,
    subject_id          UUID        NOT NULL REFERENCES subjects(subject_id) ON DELETE RESTRICT,
    academic_year       VARCHAR(9)  NOT NULL,
    semester            semester    NOT NULL,
    is_active           BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_assignment UNIQUE (user_id, class_id, subject_id, academic_year, semester),

    -- Only GURU users can have assignments
    CONSTRAINT chk_assignment_role
        CHECK (TRUE)  -- Enforced at application layer + RLS; role check via FK join
);

CREATE INDEX idx_assignments_user  ON teaching_assignments(user_id) WHERE is_active = TRUE;
CREATE INDEX idx_assignments_class ON teaching_assignments(class_id) WHERE is_active = TRUE;

COMMENT ON TABLE teaching_assignments IS
    'Relasi guru-kelas-mapel per semester. Only GURU users. '
    'Used for attendance authorization and case visibility († condition).';


-- ============================================================
-- LAYER 4 — SYSTEM CONFIG
-- ============================================================

-- ------------------------------------------------------------
-- TABLE: school_config
-- Singleton-ish config table for the setup wizard. Holds the
-- school's identity and whether onboarding has been completed.
-- ------------------------------------------------------------
CREATE TABLE school_config (
    config_id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    school_name              VARCHAR(150) NOT NULL,
    -- Alamat lengkap sekolah. Diisi saat setup wizard langkah Profil Sekolah.
    -- Ditambahkan via migration 20260629000000_add_address_to_school_config.sql.
    address                  TEXT,
    setup_completed          BOOLEAN      NOT NULL DEFAULT FALSE,
    current_academic_year    VARCHAR(9),
    current_semester         semester,
    created_at                TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at                TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE school_config IS
    'Singleton school configuration set during the ADMINISTRATIVE setup wizard.';
