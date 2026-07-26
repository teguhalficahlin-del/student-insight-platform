-- =============================================================================
-- Migration: 20260726160000_create_schedule_reapply_jobs.sql
-- Tujuan   : Fondasi skema untuk fitur "Terapkan Ulang" berbasis batch,
--            menggantikan satu transaksi monolitik fn_reapply_schedule_templates
--            yang timeout (57014) untuk sekolah dengan >10k sesi masa depan.
--
-- Dua tabel baru:
--   schedule_reapply_jobs    — satu baris per eksekusi "Terapkan Ulang"
--   schedule_reapply_targets — daftar schedule_id yang akan dihapus per job
--
-- Temuan investigasi yang mempengaruhi desain:
--   • semester enum: nilai '1' dan '2' (dikonfirmasi dari pg_enum)
--   • RLS pattern: school_id = fn_current_school_id() AND
--     fn_current_user_role() = 'ADMINISTRATIVE'::role_type
--   • schedule_reapply_targets.school_id: denormalized (tanpa FK ke schools)
--     untuk RLS efisien tanpa subquery ke tabel RLS-protected lain —
--     konsisten dengan aturan "tenant isolation anchor = school_id di setiap tabel"
--
-- INVERT (dijawab sebelum apply):
--   • CASCADE: targets bersifat transient (state operasional, bukan audit data
--     permanen) — CASCADE DELETE acceptable. Lihat komentar di bawah untuk
--     catatan upgrade jika audit histori diperlukan kelak.
--   • Race condition partial index: atomic di level constraint PostgreSQL
--     (MVCC + row lock) — request kedua mendapat 23505 sebelum commit.
--
-- ROLLBACK: DROP TABLE schedule_reapply_targets; DROP TABLE schedule_reapply_jobs;
-- =============================================================================

-- ── Tabel 1: job tracking ────────────────────────────────────────────────────
CREATE TABLE public.schedule_reapply_jobs (
    job_id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id       uuid        NOT NULL REFERENCES schools(school_id),
    academic_year   text        NOT NULL,
    semester        semester    NOT NULL,
    status          text        NOT NULL DEFAULT 'PENDING'
                                CONSTRAINT chk_reapply_job_status
                                CHECK (status IN (
                                    'PENDING',    -- job dibuat, belum mulai
                                    'DELETING',   -- batch DELETE sedang berjalan
                                    'DELETED',    -- semua sesi lama terhapus
                                    'GENERATING', -- fn_apply_schedule_templates sedang jalan
                                    'DONE',       -- selesai penuh
                                    'FAILED'      -- gagal, error_message terisi
                                )),
    total_to_delete integer     NOT NULL DEFAULT 0,
    deleted_count   integer     NOT NULL DEFAULT 0,
    started_at      timestamptz NOT NULL DEFAULT NOW(),
    updated_at      timestamptz NOT NULL DEFAULT NOW(),
    completed_at    timestamptz,
    error_message   text,
    created_by      uuid        NOT NULL REFERENCES users(user_id)
);

COMMENT ON TABLE public.schedule_reapply_jobs IS
    'Satu baris per eksekusi "Terapkan Ulang" jadwal. Status DONE/FAILED berarti '
    'job selesai. Job aktif (PENDING/DELETING/DELETED/GENERATING) diproteksi '
    'oleh unique partial index ux_reapply_one_active_job — hanya satu per '
    '(school_id, academic_year, semester) yang boleh aktif bersamaan.';

COMMENT ON COLUMN public.schedule_reapply_jobs.status IS
    'PENDING→DELETING→DELETED→GENERATING→DONE (happy path). '
    'Transisi ke FAILED bisa dari state manapun.';

-- ── Tabel 2: daftar schedule_id target per job ───────────────────────────────
CREATE TABLE public.schedule_reapply_targets (
    target_id   bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    job_id      uuid        NOT NULL
                            REFERENCES schedule_reapply_jobs(job_id)
                            ON DELETE CASCADE,
    -- school_id denormalized: tidak ada FK ke schools karena ini data transient.
    -- Tujuan: RLS dapat filter school_id = fn_current_school_id() langsung
    -- tanpa subquery ke tabel RLS-protected lain (schedule_reapply_jobs).
    school_id   uuid        NOT NULL,
    schedule_id uuid        NOT NULL,
    deleted_at  timestamptz
);

COMMENT ON TABLE public.schedule_reapply_targets IS
    'Snapshot daftar schedule_id yang akan dihapus untuk satu job reapply. '
    'Dibuat saat FASE 1 (prepare). deleted_at di-set saat batch DELETE berhasil. '
    'Di-cascade hapus bersama jobnya — data ini transient, bukan audit trail permanen. '
    'Catatan upgrade: jika audit histori job selesai diperlukan kelak, '
    'ubah ON DELETE CASCADE → ON DELETE SET NULL dan tambahkan completed_job_id.';

-- ── Index ─────────────────────────────────────────────────────────────────────

-- Cegah double-submit: hanya satu job aktif per (school, tahun, semester).
-- Partial index — hanya baris dengan status aktif yang masuk constraint.
-- Race condition: atomic via PostgreSQL constraint lock — request kedua
-- mendapat error 23505 sebelum commit.
CREATE UNIQUE INDEX ux_reapply_one_active_job
    ON public.schedule_reapply_jobs (school_id, academic_year, semester)
    WHERE status IN ('PENDING', 'DELETING', 'DELETED', 'GENERATING');

-- Batch delete loop: ambil N target yang belum dihapus efisien.
CREATE INDEX ix_reapply_targets_pending
    ON public.schedule_reapply_targets (job_id)
    WHERE deleted_at IS NULL;

-- Lookup job → targets by school (support RLS + cleanup queries).
CREATE INDEX ix_reapply_targets_school
    ON public.schedule_reapply_targets (school_id, job_id);

-- ── RLS: schedule_reapply_jobs ────────────────────────────────────────────────
ALTER TABLE public.schedule_reapply_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY rls_reapply_jobs_administrative ON public.schedule_reapply_jobs
    FOR ALL
    USING (
        school_id = fn_current_school_id()
        AND fn_current_user_role() = 'ADMINISTRATIVE'::role_type
    )
    WITH CHECK (
        school_id = fn_current_school_id()
        AND fn_current_user_role() = 'ADMINISTRATIVE'::role_type
    );

-- ── RLS: schedule_reapply_targets ─────────────────────────────────────────────
ALTER TABLE public.schedule_reapply_targets ENABLE ROW LEVEL SECURITY;

-- school_id denormalized → RLS identik pola ADMINISTRATIVE, tanpa subquery
-- ke tabel lain. Edge function pakai admin client (service_role) yang bypass RLS.
CREATE POLICY rls_reapply_targets_administrative ON public.schedule_reapply_targets
    FOR ALL
    USING (
        school_id = fn_current_school_id()
        AND fn_current_user_role() = 'ADMINISTRATIVE'::role_type
    )
    WITH CHECK (
        school_id = fn_current_school_id()
        AND fn_current_user_role() = 'ADMINISTRATIVE'::role_type
    );
