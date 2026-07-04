-- Bug multi-tenant: students_nis_key adalah UNIQUE(nis) global.
-- NIS hanya perlu unik per sekolah, bukan di seluruh platform.
-- Fix: ganti dengan UNIQUE(school_id, nis).

ALTER TABLE students DROP CONSTRAINT IF EXISTS students_nis_key;
DROP INDEX IF EXISTS students_nis_key;

CREATE UNIQUE INDEX students_school_nis_key ON students (school_id, nis);
