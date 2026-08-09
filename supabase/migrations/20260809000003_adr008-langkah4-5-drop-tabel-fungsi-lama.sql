BEGIN;

-- ============================================================
-- Langkah 4+5 ADR-008: DROP tabel lama + fungsi lama
-- Urutan: TABLE CASCADE dulu (sekaligus hapus 11 policy dependen),
-- baru DROP FUNCTION (aman setelah semua policy hilang).
-- learning_objectives di-DROP terakhir karena 3 tabel lain punya FK ke sana.
-- Data loss yang disadari dan diterima per ADR-008 §Konsekuensi.
-- ============================================================

-- 1. Tabel child dulu (punya FK ke learning_objectives)
DROP TABLE IF EXISTS tp_assessments;
DROP TABLE IF EXISTS grade_summaries;
DROP TABLE IF EXISTS grading_settings;
DROP TABLE IF EXISTS learning_objective_classes;
DROP TABLE IF EXISTS assessment_criteria;

-- 2. Tabel parent terakhir
DROP TABLE IF EXISTS learning_objectives;

-- 3. Fungsi (aman sekarang — semua policy dependen sudah hilang bersama tabel)
DROP FUNCTION IF EXISTS fn_grading_is_published(uuid, uuid, uuid, uuid);
DROP FUNCTION IF EXISTS fn_grade_published_for_me(uuid, uuid);
DROP FUNCTION IF EXISTS fn_grade_published_for_student(uuid, uuid, uuid);
DROP FUNCTION IF EXISTS fn_get_grade_summary(uuid, uuid, character varying, integer);
DROP FUNCTION IF EXISTS fn_calculate_grade_summary(uuid, uuid, character varying, integer);

COMMIT;
