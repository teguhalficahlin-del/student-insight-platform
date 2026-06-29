-- subject_id di schedule_templates harus nullable karena sistem
-- tidak memproses mata pelajaran — mapel hanya label teks bebas
-- (subject_label). Jadwal visual builder tidak menggunakan subject_id.
ALTER TABLE schedule_templates ALTER COLUMN subject_id DROP NOT NULL;
