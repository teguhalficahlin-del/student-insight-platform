# RANCANGAN TEKNIS REDESIGN PEMBINAAN SISWA

> **Status:** Rancangan — menunggu konfirmasi Romo sebelum implementasi
> **Dasar:** Keputusan produk final (1 Agustus 2026)
> **Dibaca berdasarkan:** HEAD `bd0f0cf`, kode live

---

## 1. Mapping Existing

### 1.1 Tabel yang DIHAPUS (tidak dilanjutkan)

| Tabel | Alasan |
|-------|--------|
| `cases` | Handler berubah dari role-type ke user_id; title/description sekarang mutable; audience system digantikan boolean flag. Perubahan terlalu fundamental untuk ALTER. |
| `case_events` | Event types berubah total (tidak ada CASE_LOCKED, PARENT_MESSAGE_*, STUDENT_UPDATE_ADDED dalam model baru); privasi per-event berubah dari `privacy_level` enum ke boolean flag. |
| `case_audience_members` | Model audiens PRIVATE/RESTRICTED/PUBLIC digantikan oleh dua boolean `is_shared_to_student` + `is_shared_to_parent`. |

**Catatan data:** Per audit live DB, tabel `cases` berisi hanya 3 kasus uji dan `case_events` hanya 2 event uji (pre-launch, bukan data nyata). DROP aman.

---

### 1.2 Fungsi yang DIHAPUS

| Fungsi | Alasan |
|--------|--------|
| `fn_can_see_case(uuid)` | Digantikan `fn_can_see_coaching_case(uuid)` — model visibilitas baru berbasis user_id handler, bukan role. |
| `fn_is_internal_case_actor()` | Dihapus — desain baru tidak membatasi siapa yang bisa buat kasus. |
| `fn_user_is_internal_case_actor(uuid)` | Dihapus — alasan sama. |
| `fn_case_sync_handler()` trigger | Digantikan `fn_coaching_case_sync_handler()` — sync user_id, bukan role. |
| `fn_case_guard_denormalized()` trigger | Digantikan `fn_coaching_case_guard()`. |
| `fn_case_immutable_fields()` trigger | Dihapus — title/description sekarang mutable (dengan audit trail). |
| `fn_case_validate_escalate()` trigger | Dihapus — eskalasi bebas ke siapapun, validasi berubah total. |
| `fn_case_log_create_event()` trigger | Digantikan `fn_coaching_case_log_create()`. |
| `fn_case_events_immutable()` trigger | Digantikan `fn_coaching_case_events_immutable()`. |
| `fn_sync_case(...)` RPC | Dihapus — offline sync RPC berbasis model lama. |
| `fn_involved_in_case(uuid)` | Digantikan `fn_coaching_case_handler_history(uuid)` check. |
| `fn_matches_case_handler(role, student)` | Dihapus — handler kini by user_id, bukan role + class. |

---

### 1.3 Fungsi yang DIPERTAHANKAN (tidak dimodifikasi)

| Fungsi | Catatan |
|--------|---------|
| `fn_current_user_id()` | Helper umum. |
| `fn_current_school_id()` | Helper umum. |
| `fn_current_user_role()` | Helper umum. |
| `fn_is_kepsek()` | Digunakan di RLS coaching_cases (kepsek lihat semua). |
| `fn_dudi_supervises_student(uuid)` | Dipertahankan — DUDI masih bisa buat kasus PKL. |
| `fn_delete_school_case_events(uuid)` | Diupdate untuk coaching_case_events juga. |
| `fn_wizard_reset()` | Perlu update untuk hapus `coaching_cases` selain `cases` lama. |

---

### 1.4 Komponen UI yang DITULIS ULANG

| Komponen | File | Catatan |
|----------|------|---------|
| Tab Pembinaan Siswa (guru) | `guru/js/dashboard.js` → `initKasusTab()` | Tulis ulang total |
| Section BK di tab BK | `guru/js/dashboard.js` → `initBkTab()` | Tambah section pembinaan |
| Section Wali Kelas | `guru/js/dashboard.js` → `initWaliTab()` | Tambah section pembinaan |
| Section Kaprodi | `guru/js/dashboard.js` → `initKaprodiTab()` | Tambah section pembinaan |
| Section Waka Kesiswaan | `guru/js/dashboard.js` → `initWakaKesiswaanTab()` | Tambah section pembinaan |
| Section Kepsek | `guru/js/dashboard.js` → `initKepsekTab()` | Tambah section pembinaan |
| Section cases siswa | `student/js/dashboard.js` | Tulis ulang |
| Section cases ortu | `parent/js/portal.js` | Tulis ulang |
| API functions kasus | `guru/js/api.js` | Tulis ulang semua fungsi kasus |

---

## 2. Schema Baru (DDL Lengkap)

### 2.1 Enum Baru

```sql
-- ============================================================
-- Event types untuk coaching cases
-- ============================================================
CREATE TYPE coaching_case_event_type AS ENUM (
    'OPENED',                  -- auto saat kasus dibuat (trigger)
    'NOTE_ADDED',              -- catatan handler (internal atau visible ke siswa/ortu)
    'CASE_EDITED',             -- edit judul atau deskripsi (payload: old/new)
    'ESCALATED',               -- eskalasi ke handler baru (payload: new_handler_user_id, note)
    'STATUS_CHANGED',          -- perubahan status OPEN → UNDER_REVIEW → dst
    'SHARED_TO_STUDENT',       -- handler bagikan ke siswa
    'UNSHARED_FROM_STUDENT',   -- handler tarik dari siswa
    'SHARED_TO_PARENT',        -- handler bagikan ke ortu
    'UNSHARED_FROM_PARENT',    -- handler tarik dari ortu
    'CLOSED'                   -- tutup kasus (permanen)
);
```

---

### 2.2 Tabel `coaching_cases`

```sql
CREATE TABLE coaching_cases (
    case_id                 UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
    school_id               UUID            NOT NULL REFERENCES schools(school_id) ON DELETE RESTRICT,
    student_id              UUID            NOT NULL REFERENCES students(student_id) ON DELETE RESTRICT,

    -- Pembuat: immutable setelah INSERT (guard via trigger)
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

CREATE INDEX idx_cc_student     ON coaching_cases(student_id, status);
CREATE INDEX idx_cc_handler     ON coaching_cases(current_handler_user_id, status)
    WHERE status != 'CLOSED';
CREATE INDEX idx_cc_created_by  ON coaching_cases(created_by_user_id);
CREATE INDEX idx_cc_school      ON coaching_cases(school_id);
CREATE INDEX idx_cc_shared_s    ON coaching_cases(student_id)
    WHERE is_shared_to_student = TRUE;
CREATE INDEX idx_cc_shared_p    ON coaching_cases(student_id)
    WHERE is_shared_to_parent = TRUE;
```

---

### 2.3 Tabel `coaching_case_handlers` — Chain of Custody

```sql
CREATE TABLE coaching_case_handlers (
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
CREATE UNIQUE INDEX idx_cch_active_handler
    ON coaching_case_handlers(case_id)
    WHERE handover_at IS NULL;

CREATE INDEX idx_cch_handler_user ON coaching_case_handlers(handler_user_id);
CREATE INDEX idx_cch_case_history ON coaching_case_handlers(case_id, assigned_at DESC);
```

---

### 2.4 Tabel `coaching_case_events` — Audit Trail

```sql
CREATE TABLE coaching_case_events (
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
);

CREATE INDEX idx_cce_case      ON coaching_case_events(case_id, created_at ASC);
CREATE INDEX idx_cce_author    ON coaching_case_events(author_user_id);
CREATE INDEX idx_cce_visible   ON coaching_case_events(case_id)
    WHERE is_visible_to_student = TRUE;
```

---

### 2.5 Tabel `coaching_case_templates` — Dokumen Template

```sql
CREATE TABLE coaching_case_templates (
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

CREATE INDEX idx_cct_school ON coaching_case_templates(school_id)
    WHERE is_active = TRUE;
```

---

### 2.6 Trigger Functions

```sql
-- ── Guard: coaching_case_events append-only ──────────────────────────────────
CREATE OR REPLACE FUNCTION fn_coaching_case_events_immutable()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'coaching_case_events is append-only. DELETE and UPDATE are not permitted.'
        USING ERRCODE = 'P0003';
    RETURN NULL;
END;
$$;

CREATE TRIGGER trg_coaching_case_events_immutable
    BEFORE UPDATE OR DELETE ON coaching_case_events
    FOR EACH ROW EXECUTE FUNCTION fn_coaching_case_events_immutable();


-- ── Guard: blokir INSERT ke kasus yang sudah CLOSED ──────────────────────────
CREATE OR REPLACE FUNCTION fn_coaching_case_events_no_closed()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM coaching_cases
        WHERE case_id = NEW.case_id AND status = 'CLOSED'
    ) THEN
        RAISE EXCEPTION 'case_closed: tidak bisa menambah event ke kasus yang sudah ditutup. case_id=%', NEW.case_id
            USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_coaching_case_events_no_closed
    BEFORE INSERT ON coaching_case_events
    FOR EACH ROW EXECUTE FUNCTION fn_coaching_case_events_no_closed();


-- ── Guard: coaching_cases — blokir UPDATE langsung ke field terproteksi ──────
-- Field yang hanya boleh berubah via INSERT ke coaching_case_events (sync trigger):
--   current_handler_user_id, status, is_shared_to_student, is_shared_to_parent,
--   closed_at, closed_by_user_id
-- Guard dikecualikan saat app.coaching_sync_active = 'true'
CREATE OR REPLACE FUNCTION fn_coaching_case_guard()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
    IF current_setting('app.coaching_sync_active', TRUE) IS DISTINCT FROM 'true' THEN
        IF NEW.current_handler_user_id IS DISTINCT FROM OLD.current_handler_user_id
        OR NEW.status                  IS DISTINCT FROM OLD.status
        OR NEW.is_shared_to_student    IS DISTINCT FROM OLD.is_shared_to_student
        OR NEW.is_shared_to_parent     IS DISTINCT FROM OLD.is_shared_to_parent
        OR NEW.closed_at               IS DISTINCT FROM OLD.closed_at
        OR NEW.closed_by_user_id       IS DISTINCT FROM OLD.closed_by_user_id
        THEN
            RAISE EXCEPTION
                'integrity_guard: gunakan INSERT ke coaching_case_events untuk mengubah state kasus. '
                'Direct UPDATE tidak diizinkan. case_id=%', OLD.case_id
                USING ERRCODE = 'P0003';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_coaching_case_guard
    BEFORE UPDATE ON coaching_cases
    FOR EACH ROW EXECUTE FUNCTION fn_coaching_case_guard();


-- ── Guard: created_by_user_id tidak boleh berubah ────────────────────────────
CREATE OR REPLACE FUNCTION fn_coaching_case_immutable_creator()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.created_by_user_id IS DISTINCT FROM OLD.created_by_user_id
    OR NEW.student_id         IS DISTINCT FROM OLD.student_id
    OR NEW.created_at         IS DISTINCT FROM OLD.created_at
    OR NEW.school_id          IS DISTINCT FROM OLD.school_id
    THEN
        RAISE EXCEPTION
            'immutable_field: created_by_user_id, student_id, created_at, school_id '
            'tidak bisa diubah setelah kasus dibuat. case_id=%', OLD.case_id
            USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_coaching_case_immutable_creator
    BEFORE UPDATE ON coaching_cases
    FOR EACH ROW EXECUTE FUNCTION fn_coaching_case_immutable_creator();


-- ── Sync: auto-log OPENED + buat handler record pertama saat kasus dibuat ───
CREATE OR REPLACE FUNCTION fn_coaching_case_log_create()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
    PERFORM set_config('app.coaching_sync_active', 'true', true);

    INSERT INTO coaching_case_events (
        case_id, school_id, event_type, author_user_id,
        is_visible_to_student, payload
    ) VALUES (
        NEW.case_id, NEW.school_id, 'OPENED', NEW.created_by_user_id,
        FALSE,
        jsonb_build_object('text', NEW.description)
    );

    INSERT INTO coaching_case_handlers (
        case_id, school_id, handler_user_id, assigned_by_user_id
    ) VALUES (
        NEW.case_id, NEW.school_id, NEW.created_by_user_id, NEW.created_by_user_id
    );

    PERFORM set_config('app.coaching_sync_active', 'false', true);
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_coaching_case_log_create
    AFTER INSERT ON coaching_cases
    FOR EACH ROW EXECUTE FUNCTION fn_coaching_case_log_create();


-- ── Sync: sinkronkan state kasus setelah event baru ──────────────────────────
CREATE OR REPLACE FUNCTION fn_coaching_case_sync_handler()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
    v_new_handler_user_id UUID;
    v_new_status          case_status;
BEGIN
    -- NOTE_ADDED, SHARED_*, UNSHARED_* non-destructive → handle via guard bypass
    IF NEW.event_type IN ('NOTE_ADDED', 'OPENED') THEN
        RETURN NEW;
    END IF;

    PERFORM set_config('app.coaching_sync_active', 'true', true);

    IF NEW.event_type = 'ESCALATED' THEN
        v_new_handler_user_id := (NEW.payload->>'new_handler_user_id')::uuid;

        -- Tutup handler aktif sekarang
        UPDATE coaching_case_handlers
        SET handover_at = NOW()
        WHERE case_id = NEW.case_id
          AND handover_at IS NULL;

        -- Buka handler baru
        INSERT INTO coaching_case_handlers (
            case_id, school_id, handler_user_id, assigned_by_user_id
        ) VALUES (
            NEW.case_id, NEW.school_id, v_new_handler_user_id, NEW.author_user_id
        );

        -- Update denormalized field
        UPDATE coaching_cases
        SET current_handler_user_id = v_new_handler_user_id,
            updated_at              = NOW()
        WHERE case_id = NEW.case_id;

    ELSIF NEW.event_type = 'STATUS_CHANGED' THEN
        v_new_status := (NEW.payload->>'new_status')::case_status;
        UPDATE coaching_cases
        SET status     = v_new_status,
            updated_at = NOW()
        WHERE case_id = NEW.case_id;

    ELSIF NEW.event_type = 'CASE_EDITED' THEN
        UPDATE coaching_cases
        SET title       = COALESCE(NULLIF(NEW.payload->>'new_title', ''),       title),
            description = COALESCE(NULLIF(NEW.payload->>'new_description', ''), description),
            updated_at  = NOW()
        WHERE case_id = NEW.case_id;

    ELSIF NEW.event_type = 'SHARED_TO_STUDENT' THEN
        UPDATE coaching_cases SET is_shared_to_student = TRUE,  updated_at = NOW() WHERE case_id = NEW.case_id;

    ELSIF NEW.event_type = 'UNSHARED_FROM_STUDENT' THEN
        UPDATE coaching_cases SET is_shared_to_student = FALSE, updated_at = NOW() WHERE case_id = NEW.case_id;

    ELSIF NEW.event_type = 'SHARED_TO_PARENT' THEN
        UPDATE coaching_cases SET is_shared_to_parent = TRUE,  updated_at = NOW() WHERE case_id = NEW.case_id;

    ELSIF NEW.event_type = 'UNSHARED_FROM_PARENT' THEN
        UPDATE coaching_cases SET is_shared_to_parent = FALSE, updated_at = NOW() WHERE case_id = NEW.case_id;

    ELSIF NEW.event_type = 'CLOSED' THEN
        UPDATE coaching_cases
        SET status            = 'CLOSED',
            closed_at         = NOW(),
            closed_by_user_id = NEW.author_user_id,
            updated_at        = NOW()
        WHERE case_id = NEW.case_id;

    END IF;

    PERFORM set_config('app.coaching_sync_active', 'false', true);
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_coaching_case_sync_handler
    AFTER INSERT ON coaching_case_events
    FOR EACH ROW EXECUTE FUNCTION fn_coaching_case_sync_handler();


-- ── Audit: catat alasan sebelum admin DELETE kasus ────────────────────────────
CREATE OR REPLACE FUNCTION fn_coaching_case_audit_delete()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
    INSERT INTO audit_log (
        school_id, actor_user_id, action, target_type, target_id, meta
    ) VALUES (
        OLD.school_id,
        fn_current_user_id(),
        'DELETE_COACHING_CASE',
        'coaching_cases',
        OLD.case_id,
        jsonb_build_object(
            'title',            OLD.title,
            'student_id',       OLD.student_id,
            'status',           OLD.status,
            'deletion_reason',  current_setting('app.coaching_delete_reason', TRUE)
        )
    );
    RETURN OLD;
END;
$$;

CREATE TRIGGER trg_coaching_case_audit_delete
    BEFORE DELETE ON coaching_cases
    FOR EACH ROW EXECUTE FUNCTION fn_coaching_case_audit_delete();
```

---

### 2.7 Helper Function & RPC

```sql
-- ── fn_can_see_coaching_case: predikat visibilitas untuk staf ─────────────────
-- Staf bisa lihat kasus jika:
--   (a) mereka pembuat kasus, ATAU
--   (b) mereka pernah/sedang menjadi handler (ada di coaching_case_handlers), ATAU
--   (c) mereka ADMINISTRATIVE (Admin sekolah), ATAU
--   (d) mereka KEPSEK
CREATE OR REPLACE FUNCTION fn_can_see_coaching_case(p_case_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
    SELECT EXISTS (
        SELECT 1 FROM coaching_cases c
        WHERE c.case_id   = p_case_id
          AND c.school_id = fn_current_school_id()
          AND (
              c.created_by_user_id = fn_current_user_id()
              OR EXISTS (
                  SELECT 1 FROM coaching_case_handlers h
                  WHERE h.case_id        = p_case_id
                    AND h.handler_user_id = fn_current_user_id()
              )
              OR fn_current_user_role() = 'ADMINISTRATIVE'::role_type
              OR fn_is_kepsek()
          )
    );
$$;

REVOKE EXECUTE ON FUNCTION fn_can_see_coaching_case(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION fn_can_see_coaching_case(uuid) FROM anon;


-- ── fn_admin_delete_coaching_case: satu-satunya jalur DELETE resmi ──────────
-- Memastikan alasan tersimpan sebelum DELETE mengaktifkan audit trigger.
CREATE OR REPLACE FUNCTION fn_admin_delete_coaching_case(
    p_case_id UUID,
    p_reason  TEXT
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
    -- Validasi: hanya ADMINISTRATIVE
    IF fn_current_user_role() != 'ADMINISTRATIVE'::role_type THEN
        RAISE EXCEPTION 'permission_denied: hanya ADMINISTRATIVE yang dapat menghapus kasus'
            USING ERRCODE = 'P0001';
    END IF;

    -- Validasi: kasus ada di sekolah user
    IF NOT EXISTS (
        SELECT 1 FROM coaching_cases
        WHERE case_id = p_case_id AND school_id = fn_current_school_id()
    ) THEN
        RAISE EXCEPTION 'not_found: kasus tidak ditemukan di sekolah ini'
            USING ERRCODE = 'P0004';
    END IF;

    IF p_reason IS NULL OR trim(p_reason) = '' THEN
        RAISE EXCEPTION 'validation_error: alasan penghapusan wajib diisi'
            USING ERRCODE = 'P0001';
    END IF;

    -- Simpan alasan agar bisa diambil oleh audit trigger
    PERFORM set_config('app.coaching_delete_reason', p_reason, true);

    DELETE FROM coaching_cases WHERE case_id = p_case_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION fn_admin_delete_coaching_case(uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION fn_admin_delete_coaching_case(uuid, text) FROM anon;
GRANT  EXECUTE ON FUNCTION fn_admin_delete_coaching_case(uuid, text) TO authenticated;
GRANT  EXECUTE ON FUNCTION fn_admin_delete_coaching_case(uuid, text) TO service_role;


-- ── fn_get_escalation_candidates: daftar penerima eskalasi per kasus ──────────
-- Dipanggil UI saat panel Eskalasi dibuka. Mengembalikan staf yang punya
-- relasi struktural dengan siswa kasus tersebut, sesuai track (SEKOLAH/PKL).
--
-- Sumber data per kategori:
--   Track SEKOLAH:
--     1. Wali Kelas   → users.wali_kelas_class_id = class_enrollments aktif siswa
--     2. Kaprodi      → users.kaprodi_program_id  = students.program_id
--     3. Guru BK      → users.is_bk = TRUE
--     4. Guru Mapel   → teaching_assignments aktif semester berjalan untuk kelas siswa
--     5. Waka Kesiswaan → users.is_waka_kesiswaan = TRUE
--     6. Kepsek       → users.is_kepsek = TRUE
--
--   Track PKL:
--     1. DUDI Supervisor     → pkl_placements.dudi_user_id (placement aktif siswa)
--     2. Guru Pembimbing PKL → pkl_placements.guru_pembimbing_user_id (placement aktif siswa)
--     3. Wali Kelas          → sama dengan SEKOLAH (kelas asal siswa)
--     4. Kaprodi             → sama dengan SEKOLAH
--     5. Waka Humas          → users.is_waka_humas = TRUE
--     6. Kepsek              → sama dengan SEKOLAH
--
-- CATATAN SCHEMA: "Guru Wali Personal" tidak ada sebagai entitas terpisah di schema.
-- Wali kelas dari kelas siswa (users.wali_kelas_class_id = class_enrollments aktif)
-- sudah mencakup konsep wali personal — tidak perlu entri terpisah.
--
-- Deduplikasi: user yang muncul di beberapa kategori hanya muncul sekali,
-- dengan relation_label dari kategori prioritas tertinggi (angka terkecil).
-- Handler aktif saat ini selalu dikecualikan dari hasil.
CREATE OR REPLACE FUNCTION fn_get_escalation_candidates(
    p_case_id UUID
)
RETURNS TABLE (
    user_id         UUID,
    full_name       TEXT,
    role_type       role_type,
    relation_label  TEXT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
    v_student_id         UUID;
    v_track              case_track;
    v_current_handler    UUID;
    v_school_id          UUID;
    v_student_program_id UUID;
    v_student_class_id   UUID;
    v_academic_year      VARCHAR(9);
    v_semester           semester;
BEGIN
    -- Validasi: caller harus bisa lihat kasus ini
    IF NOT fn_can_see_coaching_case(p_case_id) THEN
        RAISE EXCEPTION 'permission_denied: tidak dapat melihat kasus ini'
            USING ERRCODE = 'P0001';
    END IF;

    -- Ambil metadata kasus
    SELECT c.student_id, c.track, c.current_handler_user_id, c.school_id
    INTO   v_student_id, v_track, v_current_handler, v_school_id
    FROM   coaching_cases c
    WHERE  c.case_id = p_case_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'not_found: kasus tidak ditemukan. case_id=%', p_case_id
            USING ERRCODE = 'P0004';
    END IF;

    -- Ambil program studi siswa
    SELECT s.program_id
    INTO   v_student_program_id
    FROM   students s
    WHERE  s.student_id = v_student_id;

    -- Ambil tahun ajaran dan semester berjalan (dari school_config tenant ini)
    SELECT sc.current_academic_year, sc.current_semester
    INTO   v_academic_year, v_semester
    FROM   school_config sc
    WHERE  sc.school_id = v_school_id
    LIMIT  1;

    -- Ambil kelas aktif siswa pada semester berjalan
    -- (NULL jika siswa PKL dan belum/tidak punya enrollment aktif)
    SELECT ce.class_id
    INTO   v_student_class_id
    FROM   class_enrollments ce
    WHERE  ce.student_id    = v_student_id
      AND  ce.academic_year = v_academic_year
      AND  ce.semester      = v_semester
      AND  ce.withdrawn_at  IS NULL
    LIMIT  1;

    -- ─────────────────────────────────────────────────────────────────────────
    IF v_track = 'SEKOLAH' THEN

        RETURN QUERY
        WITH candidates AS (

            -- 1. Wali Kelas (priority 1 — relasi paling langsung dengan kelas siswa)
            SELECT u.user_id,
                   u.full_name::TEXT,
                   u.role_type,
                   'Wali Kelas'::TEXT AS relation_label,
                   1                  AS priority
            FROM   users u
            WHERE  u.school_id           = v_school_id
              AND  u.is_active           = TRUE
              AND  u.wali_kelas_class_id = v_student_class_id
              AND  v_student_class_id    IS NOT NULL

            UNION ALL

            -- 2. Kaprodi program studi siswa
            SELECT u.user_id, u.full_name::TEXT, u.role_type,
                   'Kaprodi'::TEXT, 2
            FROM   users u
            WHERE  u.school_id          = v_school_id
              AND  u.is_active          = TRUE
              AND  u.kaprodi_program_id = v_student_program_id
              AND  v_student_program_id IS NOT NULL

            UNION ALL

            -- 3. Guru BK
            SELECT u.user_id, u.full_name::TEXT, u.role_type,
                   'Guru BK'::TEXT, 3
            FROM   users u
            WHERE  u.school_id = v_school_id
              AND  u.is_active = TRUE
              AND  u.is_bk     = TRUE

            UNION ALL

            -- 4. Guru Mapel yang mengajar kelas siswa semester berjalan
            SELECT DISTINCT
                   u.user_id, u.full_name::TEXT, u.role_type,
                   'Guru Mapel'::TEXT, 4
            FROM   teaching_assignments ta
            JOIN   users u ON u.user_id = ta.user_id
            WHERE  ta.class_id      = v_student_class_id
              AND  ta.academic_year = v_academic_year
              AND  ta.semester      = v_semester
              AND  ta.is_active     = TRUE
              AND  u.school_id      = v_school_id
              AND  u.is_active      = TRUE
              AND  v_student_class_id IS NOT NULL

            UNION ALL

            -- 5. Waka Kesiswaan
            SELECT u.user_id, u.full_name::TEXT, u.role_type,
                   'Waka Kesiswaan'::TEXT, 5
            FROM   users u
            WHERE  u.school_id         = v_school_id
              AND  u.is_active         = TRUE
              AND  u.is_waka_kesiswaan = TRUE

            UNION ALL

            -- 6. Kepsek
            SELECT u.user_id, u.full_name::TEXT, u.role_type,
                   'Kepala Sekolah'::TEXT, 6
            FROM   users u
            WHERE  u.school_id = v_school_id
              AND  u.is_active = TRUE
              AND  u.is_kepsek = TRUE

        ),
        -- Deduplikat: satu baris per user, ambil relation_label dengan priority terkecil
        deduped AS (
            SELECT DISTINCT ON (c.user_id)
                c.user_id, c.full_name, c.role_type, c.relation_label
            FROM candidates c
            ORDER BY c.user_id, c.priority
        )
        SELECT d.user_id, d.full_name, d.role_type, d.relation_label
        FROM   deduped d
        -- Exclude handler aktif — tidak bisa eskalasi ke diri sendiri
        WHERE  d.user_id != v_current_handler
        ORDER  BY d.relation_label, d.full_name;

    -- ─────────────────────────────────────────────────────────────────────────
    ELSIF v_track = 'PKL' THEN

        RETURN QUERY
        WITH candidates AS (

            -- 1. DUDI Supervisor (penempatan PKL aktif siswa)
            SELECT u.user_id, u.full_name::TEXT, u.role_type,
                   'DUDI Supervisor'::TEXT AS relation_label,
                   1                       AS priority
            FROM   pkl_placements pp
            JOIN   users u ON u.user_id = pp.dudi_user_id
            WHERE  pp.student_id = v_student_id
              AND  pp.is_active  = TRUE
              AND  u.school_id   = v_school_id
              AND  u.is_active   = TRUE

            UNION ALL

            -- 2. Guru Pembimbing PKL (guru internal pendamping PKL)
            SELECT u.user_id, u.full_name::TEXT, u.role_type,
                   'Guru Pembimbing PKL'::TEXT, 2
            FROM   pkl_placements pp
            JOIN   users u ON u.user_id = pp.guru_pembimbing_user_id
            WHERE  pp.student_id              = v_student_id
              AND  pp.is_active               = TRUE
              AND  u.school_id                = v_school_id
              AND  u.is_active                = TRUE
              AND  pp.guru_pembimbing_user_id IS NOT NULL

            UNION ALL

            -- 3. Wali Kelas (dari kelas asal siswa, sebelum/selama PKL)
            SELECT u.user_id, u.full_name::TEXT, u.role_type,
                   'Wali Kelas'::TEXT, 3
            FROM   users u
            WHERE  u.school_id           = v_school_id
              AND  u.is_active           = TRUE
              AND  u.wali_kelas_class_id = v_student_class_id
              AND  v_student_class_id    IS NOT NULL

            UNION ALL

            -- 4. Kaprodi program studi siswa
            SELECT u.user_id, u.full_name::TEXT, u.role_type,
                   'Kaprodi'::TEXT, 4
            FROM   users u
            WHERE  u.school_id          = v_school_id
              AND  u.is_active          = TRUE
              AND  u.kaprodi_program_id = v_student_program_id
              AND  v_student_program_id IS NOT NULL

            UNION ALL

            -- 5. Waka Humas (koordinator PKL di level sekolah)
            SELECT u.user_id, u.full_name::TEXT, u.role_type,
                   'Waka Humas'::TEXT, 5
            FROM   users u
            WHERE  u.school_id     = v_school_id
              AND  u.is_active     = TRUE
              AND  u.is_waka_humas = TRUE

            UNION ALL

            -- 6. Kepsek
            SELECT u.user_id, u.full_name::TEXT, u.role_type,
                   'Kepala Sekolah'::TEXT, 6
            FROM   users u
            WHERE  u.school_id = v_school_id
              AND  u.is_active = TRUE
              AND  u.is_kepsek = TRUE

        ),
        deduped AS (
            SELECT DISTINCT ON (c.user_id)
                c.user_id, c.full_name, c.role_type, c.relation_label
            FROM candidates c
            ORDER BY c.user_id, c.priority
        )
        SELECT d.user_id, d.full_name, d.role_type, d.relation_label
        FROM   deduped d
        WHERE  d.user_id != v_current_handler
        ORDER  BY d.relation_label, d.full_name;

    END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION fn_get_escalation_candidates(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION fn_get_escalation_candidates(uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION fn_get_escalation_candidates(uuid) TO authenticated;
GRANT  EXECUTE ON FUNCTION fn_get_escalation_candidates(uuid) TO service_role;
```

---

## 3. RLS Policies (SQL Lengkap)

### 3.1 `coaching_cases`

```sql
ALTER TABLE coaching_cases ENABLE ROW LEVEL SECURITY;

-- ── SELECT: Staf (non-siswa, non-ortu) ──────────────────────────────────────
-- Hanya kasus yang bisa mereka lihat (fn_can_see_coaching_case)
CREATE POLICY rls_cc_read_staff ON coaching_cases
    FOR SELECT TO authenticated
    USING (
        school_id          = fn_current_school_id()
        AND fn_current_user_role() != ALL(ARRAY['SISWA','ORTU','STAKEHOLDER']::role_type[])
        AND fn_can_see_coaching_case(case_id)
    );

-- ── SELECT: DUDI — hanya kasus PKL siswa binaannya ──────────────────────────
CREATE POLICY rls_cc_read_dudi ON coaching_cases
    FOR SELECT TO authenticated
    USING (
        school_id               = fn_current_school_id()
        AND fn_current_user_role() = 'DUDI'::role_type
        AND track               = 'PKL'
        AND fn_can_see_coaching_case(case_id)
    );

-- ── SELECT: Siswa — hanya kasus yang dibagikan ke mereka ─────────────────────
CREATE POLICY rls_cc_read_student ON coaching_cases
    FOR SELECT TO authenticated
    USING (
        school_id                   = fn_current_school_id()
        AND fn_current_user_role()  = 'SISWA'::role_type
        AND is_shared_to_student    = TRUE
        AND student_id              = (
            SELECT s.student_id FROM students s
            WHERE s.user_id = fn_current_user_id()
            LIMIT 1
        )
    );

-- ── SELECT: Ortu — hanya kasus yang dibagikan dan menyangkut anak mereka ──────
CREATE POLICY rls_cc_read_parent ON coaching_cases
    FOR SELECT TO authenticated
    USING (
        school_id                   = fn_current_school_id()
        AND fn_current_user_role()  = 'ORTU'::role_type
        AND is_shared_to_parent     = TRUE
        AND EXISTS (
            SELECT 1 FROM student_parents sp
            WHERE sp.student_id     = coaching_cases.student_id
              AND sp.parent_user_id = fn_current_user_id()
        )
    );

-- ── INSERT: Semua staf (bukan SISWA, ORTU, STAKEHOLDER) ──────────────────────
-- DUDI hanya untuk kasus track = PKL dan siswa binaannya
CREATE POLICY rls_cc_insert ON coaching_cases
    FOR INSERT TO authenticated
    WITH CHECK (
        school_id                   = fn_current_school_id()
        AND created_by_user_id      = fn_current_user_id()
        AND current_handler_user_id = fn_current_user_id()
        AND fn_current_user_role()  != ALL(ARRAY['SISWA','ORTU','STAKEHOLDER']::role_type[])
        AND NOT (
            fn_current_user_role() = 'DUDI'
            AND (track != 'PKL' OR NOT fn_dudi_supervises_student(student_id))
        )
    );

-- ── UPDATE: Hanya via trigger sync (app.coaching_sync_active = 'true') ────────
-- Direct UPDATE dari klien TIDAK diizinkan — semua perubahan state melalui
-- INSERT ke coaching_case_events → trigger fn_coaching_case_sync_handler
CREATE POLICY rls_cc_update ON coaching_cases
    FOR UPDATE TO authenticated
    USING (
        school_id = fn_current_school_id()
        AND current_setting('app.coaching_sync_active', TRUE) = 'true'
    )
    WITH CHECK (
        school_id = fn_current_school_id()
    );

-- ── DELETE: Hanya via fn_admin_delete_coaching_case RPC ──────────────────────
-- RLS ini sebagai defense-in-depth; validasi utama ada di RPC function
CREATE POLICY rls_cc_delete ON coaching_cases
    FOR DELETE TO authenticated
    USING (
        school_id               = fn_current_school_id()
        AND fn_current_user_role() = 'ADMINISTRATIVE'::role_type
    );

GRANT SELECT, INSERT, UPDATE, DELETE ON coaching_cases TO authenticated;
GRANT ALL                             ON coaching_cases TO service_role;
```

---

### 3.2 `coaching_case_handlers`

```sql
ALTER TABLE coaching_case_handlers ENABLE ROW LEVEL SECURITY;

-- ── SELECT: Staf yang bisa melihat kasus bisa melihat riwayat handler ─────────
CREATE POLICY rls_cch_read_staff ON coaching_case_handlers
    FOR SELECT TO authenticated
    USING (
        school_id               = fn_current_school_id()
        AND fn_current_user_role() != ALL(ARRAY['SISWA','ORTU','STAKEHOLDER']::role_type[])
        AND fn_can_see_coaching_case(case_id)
    );

-- ── INSERT: Hanya via trigger sync ───────────────────────────────────────────
CREATE POLICY rls_cch_insert ON coaching_case_handlers
    FOR INSERT TO authenticated
    WITH CHECK (
        school_id = fn_current_school_id()
        AND current_setting('app.coaching_sync_active', TRUE) = 'true'
    );

-- ── UPDATE: Hanya via trigger sync (untuk set handover_at) ───────────────────
CREATE POLICY rls_cch_update ON coaching_case_handlers
    FOR UPDATE TO authenticated
    USING (
        school_id = fn_current_school_id()
        AND current_setting('app.coaching_sync_active', TRUE) = 'true'
    );

GRANT SELECT, INSERT, UPDATE ON coaching_case_handlers TO authenticated;
GRANT ALL                     ON coaching_case_handlers TO service_role;
```

---

### 3.3 `coaching_case_events`

```sql
ALTER TABLE coaching_case_events ENABLE ROW LEVEL SECURITY;

-- ── SELECT: Staf yang bisa lihat kasus bisa lihat semua event-nya ─────────────
CREATE POLICY rls_cce_read_staff ON coaching_case_events
    FOR SELECT TO authenticated
    USING (
        school_id               = fn_current_school_id()
        AND fn_current_user_role() != ALL(ARRAY['SISWA','ORTU','STAKEHOLDER']::role_type[])
        AND fn_can_see_coaching_case(case_id)
    );

-- ── SELECT: Siswa — hanya event yang is_visible_to_student = TRUE ─────────────
-- dan hanya untuk kasus yang memang di-share ke mereka
CREATE POLICY rls_cce_read_student ON coaching_case_events
    FOR SELECT TO authenticated
    USING (
        school_id                   = fn_current_school_id()
        AND fn_current_user_role()  = 'SISWA'::role_type
        AND is_visible_to_student   = TRUE
        AND EXISTS (
            SELECT 1 FROM coaching_cases c
            WHERE c.case_id              = coaching_case_events.case_id
              AND c.is_shared_to_student = TRUE
              AND c.student_id           = (
                  SELECT s.student_id FROM students s
                  WHERE s.user_id = fn_current_user_id() LIMIT 1
              )
        )
    );

-- ── SELECT: Ortu — hanya event is_visible_to_student = TRUE untuk kasus
--   yang di-share ke ortu dan menyangkut anak mereka ─────────────────────────
CREATE POLICY rls_cce_read_parent ON coaching_case_events
    FOR SELECT TO authenticated
    USING (
        school_id                   = fn_current_school_id()
        AND fn_current_user_role()  = 'ORTU'::role_type
        AND is_visible_to_student   = TRUE
        AND EXISTS (
            SELECT 1 FROM coaching_cases c
            JOIN student_parents sp ON sp.student_id = c.student_id
            WHERE c.case_id             = coaching_case_events.case_id
              AND c.is_shared_to_parent = TRUE
              AND sp.parent_user_id     = fn_current_user_id()
        )
    );

-- ── INSERT: Handler aktif bisa insert event ke kasusnya ───────────────────────
-- Atau via sync_active (trigger path untuk ESCALATED, STATUS_CHANGED, dst)
CREATE POLICY rls_cce_insert ON coaching_case_events
    FOR INSERT TO authenticated
    WITH CHECK (
        school_id          = fn_current_school_id()
        AND author_user_id = fn_current_user_id()
        AND (
            current_setting('app.coaching_sync_active', TRUE) = 'true'
            OR EXISTS (
                SELECT 1 FROM coaching_cases c
                WHERE c.case_id                 = coaching_case_events.case_id
                  AND c.current_handler_user_id = fn_current_user_id()
                  AND c.status                 != 'CLOSED'
            )
        )
    );

-- DELETE dan UPDATE diblokir trigger trg_coaching_case_events_immutable

GRANT SELECT, INSERT ON coaching_case_events TO authenticated;
GRANT ALL             ON coaching_case_events TO service_role;
```

---

### 3.4 `coaching_case_templates`

```sql
ALTER TABLE coaching_case_templates ENABLE ROW LEVEL SECURITY;

-- ── SELECT: Semua staf internal (bukan siswa/ortu/stakeholder) ────────────────
CREATE POLICY rls_cct_read ON coaching_case_templates
    FOR SELECT TO authenticated
    USING (
        school_id               = fn_current_school_id()
        AND is_active           = TRUE
        AND fn_current_user_role() != ALL(ARRAY['SISWA','ORTU','STAKEHOLDER']::role_type[])
    );

-- ── INSERT: Hanya ADMINISTRATIVE ─────────────────────────────────────────────
CREATE POLICY rls_cct_insert ON coaching_case_templates
    FOR INSERT TO authenticated
    WITH CHECK (
        school_id               = fn_current_school_id()
        AND fn_current_user_role() = 'ADMINISTRATIVE'::role_type
    );

-- ── UPDATE: Hanya ADMINISTRATIVE ─────────────────────────────────────────────
CREATE POLICY rls_cct_update ON coaching_case_templates
    FOR UPDATE TO authenticated
    USING (
        school_id               = fn_current_school_id()
        AND fn_current_user_role() = 'ADMINISTRATIVE'::role_type
    );

-- ── DELETE (soft): Hanya ADMINISTRATIVE ───────────────────────────────────────
-- Rekomendasinya soft delete: set is_active = FALSE
CREATE POLICY rls_cct_delete ON coaching_case_templates
    FOR DELETE TO authenticated
    USING (
        school_id               = fn_current_school_id()
        AND fn_current_user_role() = 'ADMINISTRATIVE'::role_type
    );

GRANT SELECT, INSERT, UPDATE, DELETE ON coaching_case_templates TO authenticated;
GRANT ALL                              ON coaching_case_templates TO service_role;
```

---

## 4. UI Per Portal

> **Prinsip rendering:** Peran user dalam kasus (pembuat | handler lama | handler aktif)
> ditentukan saat fetch, bukan di server. UI menerima semua kasus yang boleh dilihat
> via RLS, lalu tampilkan aksi yang sesuai berdasarkan perbandingan `current_handler_user_id`
> dengan `currentUserId`.

---

### 4.1 Portal Guru — Tab Guru (`initGuruTab`)

**Bagian di dalam tab Guru:** Section "Pembinaan Siswa" di bawah section jadwal/absensi.

**Daftar kasus (list view):**
```
┌─────────────────────────────────────────────────────┐
│ [+] Laporkan Kasus Siswa     [Filter: Status ▼]     │
├────────────────────────────────────┬────────┬───────┤
│ Siswa · Judul kasus                │ Status │ Peran │
│ Budi Santoso · "Sering absen"      │ OPEN   │ 🟢 Aktif │
│ Ani Rahmawati · "Konflik teman"    │ CLOSED │ Dibuat │
│ Candra P. · "Nilai turun drastis"  │ REVIEW │ Pernah Pegang │
└────────────────────────────────────┴────────┴───────┘
```

**Field yang tampil di daftar:**
- Nama siswa + NIS
- Judul kasus
- Status badge (OPEN / UNDER_REVIEW / INTERVENTION / MONITORING / CLOSED)
- Badge peran: "Handler Aktif" (hijau) / "Dibuat olehku" (abu) / "Pernah Pegang" (biru muda)
- Tanggal dibuat
- Tanggal terakhir ada event

**Detail kasus — sebagai PEMBUAT atau HANDLER LAMA (read-only):**
- Header: judul, status, nama siswa, NIS, track, tanggal dibuat, siapa pembuat
- Info handler aktif sekarang: nama + jabatan
- Timeline events (semua event internal)
- Tidak ada tombol aksi

**Detail kasus — sebagai HANDLER AKTIF (full access):**
- Header sama + tombol "Edit Judul/Deskripsi" (buka inline form)
- Panel aksi vertikal:
  1. **Tambah Catatan** — textarea + toggle "Tampilkan ke siswa/ortu" + Submit
  2. **Eskalasi** — panel dua bagian (dipanggil via RPC `fn_get_escalation_candidates`):
     - **Bagian A — Staf terkait otomatis:** daftar staf yang punya relasi struktural
       dengan siswa ini (wali kelas, kaprodi, BK, guru mapel aktif, Waka Kesiswaan/Humas,
       Kepsek, atau DUDI untuk kasus PKL). Setiap nama ditampilkan beserta label relasi
       ("Wali Kelas", "Guru BK", "Guru Mapel", dst). Handler aktif saat ini tidak muncul.
     - **Bagian B — Cari nama:** input search yang memfilter daftar yang sama dari Bagian A
       secara real-time — bukan mencari semua staf sekolah.
     - Textarea alasan eskalasi (wajib diisi) + tombol Submit.
     - Catatan: daftar terbatas pada staf yang terkait struktural dengan siswa tersebut
       sesuai track kasus (SEKOLAH atau PKL). Tidak bisa eskalasi ke staf lain di luar
       daftar ini tanpa ada relasi struktural yang tercatat di DB.
  3. **Ubah Status** — dropdown (OPEN / UNDER_REVIEW / INTERVENTION / MONITORING) + Submit
  4. **Visibilitas** — dua toggle: "Bagikan ke Siswa" + "Bagikan ke Orang Tua"
     - Jika sudah dibagikan: tampilkan "Tarik dari Siswa" / "Tarik dari Orang Tua"
  5. **Tutup Kasus** — textarea ringkasan + konfirmasi (warn: permanen) + Submit

---

### 4.2 Portal Wali Kelas — Section di Tab Wali Kelas (`initWaliTab`)

**Tambahan di bawah daftar siswa wali kelas:**
Section "Pembinaan Siswa Kelas" — menampilkan semua kasus dari semua siswa di kelas wali.

**Perbedaan vs tab Guru:**
- Default filter: hanya siswa di kelas yang diwali
- Bisa buat kasus baru langsung dari daftar siswa wali
- Aksi sama persis dengan tab Guru (sesuai peran handler aktif/pembuat/lama)

---

### 4.3 Portal BK — Section di Tab BK (`initBkTab`)

Section "Kasus Pembinaan yang Ditangani" — menampilkan semua kasus dimana BK adalah:
- Handler aktif, ATAU
- Pernah menjadi handler, ATAU
- Pembuat kasus

Tidak ada filter otomatis per kelas — BK bisa lihat semua kelas.
Aksi sama dengan tab Guru.

---

### 4.4 Portal Kaprodi — Section di Tab Kaprodi (`initKaprodiTab`)

Section "Pembinaan Siswa Program Studi" — filter default: siswa di program studi yang diampu.

Aksi sama dengan tab Guru.

**Update form penetapan PKL:** Form `kp-placement-form` perlu ditambah field:
- Dropdown **Guru Pembimbing** (daftar guru aktif di sekolah, di-filter per program studi)
- Field ini wajib diisi saat membuat penempatan PKL baru
- `createPlacement()` perlu mengirim tambahan field `supervisorUserId` yang dipetakan ke
  `fn_create_placement(p_student_id, p_dudi_user_id, p_start_date, p_end_date, p_supervisor_user_id)`
  — fungsi ini perlu diupdate bersamaan dengan migration kolom

---

### 4.5 Portal Waka Kesiswaan — Section di Tab Waka Kesiswaan (`initWakaKesiswaanTab`)

Section "Pembinaan Siswa — Kesiswaan" — semua kasus yang Waka pernah/sedang tangani.

Tambahan eksklusif Waka: bisa lihat rekap ringkas (jumlah per status, per bulan) di atas daftar.
Aksi sama dengan tab Guru.

---

### 4.6 Portal Kepsek — Section di Tab Kepsek (`initKepsekTab`)

Section "Monitoring Pembinaan Siswa" — **Kepsek bisa lihat SEMUA kasus aktif di sekolahnya**
(via RLS fn_is_kepsek() = TRUE).

Tampilan di Kepsek:
- Default filter: hanya OPEN + UNDER_REVIEW + INTERVENTION + MONITORING
- Info handler aktif dan track eskalasi terlihat
- **Aksi Kepsek hanya jika ia handler aktif** — jika ia hanya monitoring, semua read-only

---

### 4.7 Portal Siswa — Section Catatan Pembinaan (`student/js/dashboard.js`)

Muncul di tab "Pembinaan" (tab baru) atau di section observasi — hanya jika ada kasus yang dibagikan.

**Field yang tampil per kasus:**
- Judul kasus
- Status (label ramah: "Sedang ditangani" / "Selesai")
- Nama guru/staf yang menangani (nama saja, tanpa jabatan internal)
- Untuk kasus track PKL: nama guru pembimbing PKL (dari `pkl_placements.guru_pembimbing_user_id`)
- Tanggal dibuat

**Timeline yang tampil:** hanya event dengan `is_visible_to_student = TRUE`:
- Catatan handler yang sengaja dibagikan
- Event SHARED_TO_STUDENT (tampilkan sebagai "Kasus ini telah dibagikan kepadamu")
- Event CLOSED (tampilkan sebagai "Kasus ini telah ditutup")

**Tidak ada:** tombol aksi apapun. Tidak ada tombol download.

---

### 4.8 Portal Orang Tua — Section Catatan Pembinaan (`parent/js/portal.js`)

Tab per anak. Section "Catatan Pembinaan" muncul jika ada kasus dengan `is_shared_to_parent = TRUE`.

**Field yang tampil per kasus:**
- Judul kasus
- Status (label ramah)
- Untuk kasus track PKL: nama guru pembimbing PKL (dari `pkl_placements.guru_pembimbing_user_id`)
- Tanggal terbaru ada catatan yang dibagikan

**Timeline yang tampil:** sama seperti siswa — hanya event `is_visible_to_student = TRUE`
(flag yang sama berlaku untuk siswa dan ortu).

**Tidak ada:** tombol aksi, download, atau melihat detail internal.

---

## 5. Migration Plan

### 5.1 Urutan Migration SQL

Migration **pertama** yang harus dijalankan sebelum `coaching-cases-schema`:

```sql
-- Migration: YYYYMMDDHHMMSS_add-pkl-supervisor-column.sql
-- Harus dijalankan SEBELUM coaching-cases-schema karena
-- fn_get_escalation_candidates mereferensikan kolom ini.

ALTER TABLE pkl_placements
    ADD COLUMN IF NOT EXISTS guru_pembimbing_user_id UUID
        REFERENCES users(user_id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_pkl_placements_pembimbing
    ON pkl_placements(guru_pembimbing_user_id)
    WHERE guru_pembimbing_user_id IS NOT NULL;
```

Kemudian urutan coaching cases:

```
YYYYMMDDHHMMSS_coaching-cases-schema.sql
    → CREATE TYPE coaching_case_event_type
    → CREATE TABLE coaching_cases
    → CREATE TABLE coaching_case_handlers
    → CREATE TABLE coaching_case_events
    → CREATE TABLE coaching_case_templates
    → CREATE INDEX (semua)

YYYYMMDDHHMMSS_coaching-cases-functions.sql
    → CREATE OR REPLACE FUNCTION fn_can_see_coaching_case
    → CREATE OR REPLACE FUNCTION fn_coaching_case_events_immutable (trigger fn)
    → CREATE OR REPLACE FUNCTION fn_coaching_case_events_no_closed (trigger fn)
    → CREATE OR REPLACE FUNCTION fn_coaching_case_guard (trigger fn)
    → CREATE OR REPLACE FUNCTION fn_coaching_case_immutable_creator (trigger fn)
    → CREATE OR REPLACE FUNCTION fn_coaching_case_log_create (trigger fn)
    → CREATE OR REPLACE FUNCTION fn_coaching_case_sync_handler (trigger fn)
    → CREATE OR REPLACE FUNCTION fn_coaching_case_audit_delete (trigger fn)
    → CREATE TRIGGER (semua 7 trigger)
    → REVOKE ... FROM PUBLIC; REVOKE ... FROM anon; (untuk semua SECURITY DEFINER)

YYYYMMDDHHMMSS_coaching-cases-rls.sql
    → ALTER TABLE coaching_cases ENABLE ROW LEVEL SECURITY
    → CREATE POLICY ... (semua policy dari §3)
    → GRANT ... TO authenticated; GRANT ... TO service_role;

YYYYMMDDHHMMSS_coaching-cases-rpc.sql
    → CREATE OR REPLACE FUNCTION fn_admin_delete_coaching_case
    → CREATE OR REPLACE FUNCTION fn_get_escalation_candidates
    → REVOKE ... FROM PUBLIC; REVOKE ... FROM anon; (untuk kedua RPC)
    → GRANT ... TO authenticated; GRANT ... TO service_role; (untuk kedua RPC)

YYYYMMDDHHMMSS_drop-old-cases.sql
    → DROP TABLE IF EXISTS case_audience_members CASCADE
    → DROP TABLE IF EXISTS case_events CASCADE
    → DROP TABLE IF EXISTS cases CASCADE
    → DROP FUNCTION IF EXISTS fn_can_see_case(uuid)
    → DROP FUNCTION IF EXISTS fn_is_internal_case_actor()
    → DROP FUNCTION IF EXISTS fn_user_is_internal_case_actor(uuid)
    → DROP FUNCTION IF EXISTS fn_case_sync_handler()
    → DROP FUNCTION IF EXISTS fn_case_guard_denormalized()
    → DROP FUNCTION IF EXISTS fn_case_immutable_fields()
    → DROP FUNCTION IF EXISTS fn_case_validate_escalate()
    → DROP FUNCTION IF EXISTS fn_case_log_create_event()
    → DROP FUNCTION IF EXISTS fn_sync_case(...)  (semua overload)
    → DROP TYPE IF EXISTS case_audience
    → DROP TYPE IF EXISTS case_event_type
    -- case_status dan case_track DIPERTAHANKAN (masih digunakan di coaching_cases)
```

---

### 5.2 Data Existing — Keputusan DROP vs Migrate

**Rekomendasi: DROP, bukan migrate.**

Alasan:
1. Tabel `cases` berisi 3 kasus uji + `case_events` 2 event uji — bukan data nyata.
2. Model handler berubah dari role_type ke user_id — tidak ada pemetaan yang clean.
3. Model audience berubah total — tidak ada konversi yang valid.

Tindakan:
```sql
-- Verifikasi sebelum DROP (jalankan terpisah, bukan bagian migration):
SELECT COUNT(*) FROM cases;
SELECT COUNT(*) FROM case_events;

-- Jika count kecil (≤ beberapa test cases), lanjut DROP.
-- Jika ada data nyata → STOP, konsultasikan ke Romo.
```

---

### 5.3 Risiko Implementasi

| Risiko | Tingkat | Mitigasi |
|--------|---------|----------|
| Referensi lama ke `cases` di UI (guru/api.js, student/dashboard.js, parent/portal.js, notifikasi) | Tinggi | Cari semua `from('cases')` dan `from('case_events')` di seluruh JS, update ke tabel baru sebelum deploy |
| `fn_wizard_reset` merujuk ke `case_events` | Sedang | Update fn_wizard_reset untuk gunakan `coaching_case_events` |
| `fn_delete_school_case_events` jadi tidak relevan | Rendah | Buat `fn_delete_school_coaching_cases` sebagai pengganti |
| Notifikasi yang merujuk `case_id` dari tabel lama | Sedang | Cek tabel `notifications` apakah ada FK ke `cases.case_id` |
| `UNIQUE INDEX idx_cch_active_handler` butuh PostgreSQL PARTIAL INDEX | Rendah | Didukung penuh oleh PostgreSQL 12+ (Supabase aman) |
| Guard `app.coaching_sync_active` perlu test eksplisit | Sedang | Test BEGIN/ROLLBACK: coba UPDATE langsung ke coaching_cases → harus RAISE EXCEPTION |

---

### 5.4 Checklist Sebelum Push

- [ ] Dry-run: `supabase db push --linked --dry-run`
- [ ] Verifikasi count data lama sebelum DROP
- [ ] Test trigger: INSERT ke coaching_cases → cek otomatis ada baris di coaching_case_handlers + coaching_case_events
- [ ] Test escalation: INSERT event ESCALATED → cek current_handler_user_id berubah + baris lama coaching_case_handlers dapat handover_at
- [ ] Test guard: UPDATE langsung ke coaching_cases.status → harus gagal
- [ ] Test RLS siswa: login sebagai siswa → hanya lihat kasus is_shared_to_student = TRUE
- [ ] Test RLS ortu: login sebagai ortu → hanya lihat kasus is_shared_to_parent = TRUE
- [ ] Test delete: fn_admin_delete_coaching_case tanpa reason → harus gagal; dengan reason → berhasil + ada baris di audit_log
- [ ] Test event visibility: event is_visible_to_student = FALSE → tidak tampil ke siswa
- [ ] Cari `from('cases')` di semua file JS → tidak boleh ada yang tersisa
