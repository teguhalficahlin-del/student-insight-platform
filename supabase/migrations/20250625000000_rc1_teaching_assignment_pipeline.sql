-- ============================================================
-- RC-1: Mengaktifkan pipeline teaching_assignments.
--
-- Sebelum migration ini, bulk-import-schedules membuat
-- teaching_schedules dengan assignment_id = NULL — tabel
-- teaching_assignments tidak pernah terisi lewat jalur manapun
-- (lihat audit CRITICAL #1, docs/audit/00-master-summary.md).
--
-- Migration ini:
--   1. Drop fn_has_assignment_for_class — dead code, tidak ada
--      pemanggil di RLS policy, edge function, atau trigger manapun
--      (diverifikasi via grep -rn di seluruh repo).
--   2. Drop fn_bulk_import_schedules(JSONB) — fungsi SQL legacy,
--      tidak dipanggil oleh edge function aktif (yang menulis
--      langsung via supabase-js .upsert(), bukan RPC ini).
--   3. Tambah schedule_templates.subject_id — diperlukan untuk
--      resolve teaching_assignments saat generate.
--
-- NOTE: constraint UNIQUE untuk upsert teaching_assignments TIDAK
-- ditambahkan di sini — uq_assignment UNIQUE (user_id, class_id,
-- subject_id, academic_year, semester) sudah ada sejak
-- contracts/01_reference_identity_org.sql:306 dengan kolom identik.
-- ============================================================

-- 1. Drop fn_has_assignment_for_class — dead code (tidak pernah dipanggil)
DROP FUNCTION IF EXISTS fn_has_assignment_for_class(UUID);

-- 2. Drop fn_bulk_import_schedules — legacy, signature asli adalah
--    satu parameter JSONB (lihat 20240201000002_bulk_import_schedules.sql:17),
--    bukan (TEXT, TEXT, TEXT, TEXT).
DROP FUNCTION IF EXISTS fn_bulk_import_schedules(JSONB);

-- 3. Tambah kolom subject_id ke schedule_templates
ALTER TABLE schedule_templates
    ADD COLUMN subject_id UUID NOT NULL
    REFERENCES subjects(subject_id) ON DELETE RESTRICT;

COMMENT ON COLUMN schedule_templates.subject_id IS
    'Mata pelajaran yang diajarkan pada slot jadwal ini. Wajib diisi.
     Ditambahkan di RC-1 untuk mengaktifkan pipeline teaching_assignments.';
