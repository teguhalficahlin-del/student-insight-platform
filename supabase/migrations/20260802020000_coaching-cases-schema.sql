-- ============================================================
-- Migration: 20260802020000_coaching-cases-schema.sql
-- Coaching Cases — schema fondasi: enum + 4 tabel + semua index.
-- Prerequisite: 20260802010000 (guru_pembimbing_user_id di pkl_placements).
-- Migration berikutnya: triggers/functions, RLS, RPC.
-- ============================================================
--
-- SCOPE: CREATE TYPE coaching_case_event_type + 4 tabel baru.
-- Tidak menyentuh: case_status, case_track (sudah ada).
-- Tidak menyentuh: triggers, functions, RLS — migration terpisah.
--
-- GAP TERCATAT: audit_log di DB berkolom (school_id, table_name,
-- operation, row_id, row_snapshot, deleted_by, deleted_at) —
-- berbeda dari yang dirujuk di fn_coaching_case_audit_delete
-- (actor_user_id, action, target_type, target_id, meta).
-- Harus diselesaikan sebelum migration functions (Migration 3).
-- ============================================================


-- ------------------------------------------------------------
-- ENUM: coaching_case_event_type
-- Idempotent via DO block (CREATE TYPE tidak support IF NOT EXISTS)
-- ------------------------------------------------------------
DO $$ BEGIN
    CREATE TYPE coaching_case_event_type AS ENUM (
        'OPENED',                   -- auto saat kasus dibuat (trigger)
        'NOTE_ADDED',               -- catatan handler (internal atau visible ke siswa/ortu)
        'CASE_EDITED',              -- edit judul atau deskripsi (payload: old/new)
        'ESCALATED',                -- eskalasi ke handler baru (payload: new_handler_user_id, note)
        'STATUS_CHANGED',           -- perubahan status OPEN → UNDER_REVIEW → dst
        'SHARED_TO_STUDENT',        -- handler bagikan ke siswa
        'UNSHARED_FROM_STUDENT',    -- handler tarik dari siswa
        'SHARED_TO_PARENT',         -- handler bagikan ke ortu
        'UNSHARED_FROM_PARENT',     -- handler tarik dari ortu
        'CLOSED'                    -- tutup kasus (permanen)
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END; $$;


-- ------------------------------------------------------------
-- TABEL: coaching_cases
-- Dibuat SEBELUM coaching_case_handlers dan coaching_case_events
-- karena keduanya FK ke tabel ini.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS coaching_cases (
    case_id                 UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
    school_id               UUID            NOT NULL REFERENCES schools(school_id) ON DELETE RESTRICT,
    student_id              UUID            NOT NULL REFERENCES students(student_id) ON DELETE RESTRICT,

    -- Pembuat: immutable setelah INSERT (guard via trigger di migration berikutnya)
    created_by_user_id      UUID            NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
    created_at              TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

    -- Judul & deskripsi: mutable oleh handler aktif, tiap edit tercatat di coaching_case_events
    title                   VARCHAR(200)    NOT NULL,
    description             TEXT            NOT NULL CHECK (length(description) >= 20),

    -- Handler aktif: denormalisasi, disync oleh trigger trg_coaching_case_sync_handler
    -- JANGAN tulis langsung — gunakan INSERT ke coaching_case_events (ESCALATED)
    current_handler_user_id UUID            NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,

    -- Status kasus
    status                  case_status     NOT NULL DEFAULT 'OPEN',

    -- Track: SEKOLAH (normal) atau PKL
    track                   case_track      NOT NULL DEFAULT 'SEKOLAH',

    -- Visibilitas ke siswa dan ortu (toggle oleh handler aktif, dicatat di events)
    is_shared_to_student    BOOLEAN         NOT NULL DEFAULT FALSE,
    is_shared_to_parent     BOOLEAN         NOT NULL DEFAULT FALSE,

    -- Metadata tutup
    closed_at               TIMESTAMPTZ,
    closed_by_user_id       UUID            REFERENCES users(user_id) ON DELETE RESTRICT,

    updated_at              TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_coaching_case_title_not_blank
        CHECK (trim(title) <> ''),
    CONSTRAINT chk_coaching_case_closed_meta
        CHECK (status != 'CLOSED'
               OR (closed_at IS NOT NULL AND closed_by_user_id IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_cc_student    ON coaching_cases(student_id, status);
CREATE INDEX IF NOT EXISTS idx_cc_handler    ON coaching_cases(current_handler_user_id, status)
    WHERE status != 'CLOSED';
CREATE INDEX IF NOT EXISTS idx_cc_created_by ON coaching_cases(created_by_user_id);
CREATE INDEX IF NOT EXISTS idx_cc_school     ON coaching_cases(school_id);
CREATE INDEX IF NOT EXISTS idx_cc_shared_s   ON coaching_cases(student_id)
    WHERE is_shared_to_student = TRUE;
CREATE INDEX IF NOT EXISTS idx_cc_shared_p   ON coaching_cases(student_id)
    WHERE is_shared_to_parent = TRUE;


-- ------------------------------------------------------------
-- TABEL: coaching_case_handlers — Chain of Custody
-- Riwayat seluruh handler yang pernah memegang kasus.
-- Satu baris dengan handover_at IS NULL = handler aktif saat ini.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS coaching_case_handlers (
    handler_id              UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
    case_id                 UUID            NOT NULL
        REFERENCES coaching_cases(case_id) ON DELETE CASCADE,
    school_id               UUID            NOT NULL,

    -- Siapa yang memegang kasus ini
    handler_user_id         UUID            NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,

    -- Kapan mulai memegang (= assigned_at dari ESCALATED event atau created_at untuk pembuat)
    assigned_at             TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

    -- Siapa yang mengeskalasi ke handler ini (NULL untuk pembuat pertama)
    assigned_by_user_id     UUID            REFERENCES users(user_id) ON DELETE SET NULL,

    -- Kapan menyerahkan ke handler berikutnya (NULL = masih aktif)
    handover_at             TIMESTAMPTZ
);

-- Hanya boleh ada SATU baris dengan handover_at IS NULL per kasus
CREATE UNIQUE INDEX IF NOT EXISTS idx_cch_active_handler
    ON coaching_case_handlers(case_id)
    WHERE handover_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_cch_handler_user ON coaching_case_handlers(handler_user_id);
CREATE INDEX IF NOT EXISTS idx_cch_case_history  ON coaching_case_handlers(case_id, assigned_at DESC);


-- ------------------------------------------------------------
-- TABEL: coaching_case_events — Audit Trail / Timeline
-- Append-only: UPDATE dan DELETE diblokir trigger di migration berikutnya.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS coaching_case_events (
    event_id                UUID                        PRIMARY KEY DEFAULT uuid_generate_v4(),
    case_id                 UUID                        NOT NULL
        REFERENCES coaching_cases(case_id) ON DELETE RESTRICT,
    school_id               UUID                        NOT NULL,
    event_type              coaching_case_event_type    NOT NULL,

    -- Siapa yang melakukan aksi ini
    author_user_id          UUID                        NOT NULL
        REFERENCES users(user_id) ON DELETE RESTRICT,

    -- Apakah event ini tampil ke siswa (dan ortu jika kasus juga di-share ke ortu)
    is_visible_to_student   BOOLEAN                     NOT NULL DEFAULT FALSE,

    -- Data spesifik per event_type:
    --   OPENED:               { "text": "<deskripsi awal>" }
    --   NOTE_ADDED:           { "text": "<isi catatan>" }
    --   CASE_EDITED:          { "field": "title"|"description", "old": "...", "new": "..." }
    --   ESCALATED:            { "new_handler_user_id": "<uuid>", "new_handler_name": "...",
    --                           "new_handler_role": "<role>", "note": "..." }
    --   STATUS_CHANGED:       { "old_status": "...", "new_status": "..." }
    --   SHARED_TO_STUDENT:    {}
    --   UNSHARED_FROM_STUDENT:{}
    --   SHARED_TO_PARENT:     {}
    --   UNSHARED_FROM_PARENT: {}
    --   CLOSED:               { "summary": "...", "outcome": "..." }
    payload                 JSONB                       NOT NULL DEFAULT '{}',

    created_at              TIMESTAMPTZ                 NOT NULL DEFAULT NOW()
    -- Append-only: UPDATE dan DELETE diblokir trigger trg_coaching_case_events_immutable
    -- (didefinisikan di migration berikutnya)
);

CREATE INDEX IF NOT EXISTS idx_cce_case    ON coaching_case_events(case_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_cce_author  ON coaching_case_events(author_user_id);
CREATE INDEX IF NOT EXISTS idx_cce_visible ON coaching_case_events(case_id)
    WHERE is_visible_to_student = TRUE;


-- ------------------------------------------------------------
-- TABEL: coaching_case_templates — Dokumen Template
-- Template dokumen yang bisa dipakai saat membuka kasus baru.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS coaching_case_templates (
    template_id             UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
    school_id               UUID            NOT NULL,
    name                    VARCHAR(200)    NOT NULL,
    description             TEXT,

    -- Path ke file template di Supabase Storage
    storage_path            TEXT            NOT NULL,

    is_active               BOOLEAN         NOT NULL DEFAULT TRUE,
    created_by_user_id      UUID            REFERENCES users(user_id) ON DELETE SET NULL,
    created_at              TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_cct_name_not_blank CHECK (trim(name) <> '')
);

CREATE INDEX IF NOT EXISTS idx_cct_school ON coaching_case_templates(school_id)
    WHERE is_active = TRUE;
