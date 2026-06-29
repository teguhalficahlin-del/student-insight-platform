-- Tambah kolom mapel (teks bebas) ke schedule_templates.
-- Sistem tidak memvalidasi/memproses mapel — hanya untuk tampilan dan cetak.
ALTER TABLE schedule_templates
    ADD COLUMN IF NOT EXISTS subject_label VARCHAR(50);

COMMENT ON COLUMN schedule_templates.subject_label IS
    'Label mata pelajaran (teks bebas). Tidak divalidasi oleh sistem — '
    'hanya untuk keperluan tampilan dan cetak jadwal.';

-- Tabel untuk menyimpan struktur slot waktu per hari.
-- Bisa berupa slot mengajar (is_break = false) atau istirahat/kegiatan (is_break = true).
CREATE TABLE IF NOT EXISTS schedule_time_slots (
    slot_id         UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    academic_year   VARCHAR(9)   NOT NULL,
    semester        semester     NOT NULL,
    day_of_week     day_of_week  NOT NULL,
    slot_number     INTEGER      NOT NULL,
    start_time      TIME         NOT NULL,
    end_time        TIME         NOT NULL,
    is_break        BOOLEAN      NOT NULL DEFAULT FALSE,
    break_label     VARCHAR(50),
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_slot_time CHECK (end_time > start_time),
    CONSTRAINT chk_break_label CHECK (is_break = FALSE OR break_label IS NOT NULL),
    CONSTRAINT uq_slot_per_day UNIQUE (academic_year, semester, day_of_week, slot_number)
);

CREATE INDEX idx_time_slots_day ON schedule_time_slots(academic_year, semester, day_of_week);

ALTER TABLE schedule_time_slots ENABLE ROW LEVEL SECURITY;

CREATE POLICY rls_time_slots_read ON schedule_time_slots
    FOR SELECT USING (TRUE);

CREATE POLICY rls_time_slots_write ON schedule_time_slots
    FOR ALL USING (fn_current_user_role() = 'ADMINISTRATIVE');

COMMENT ON TABLE schedule_time_slots IS
    'Struktur slot waktu per hari. TU menentukan sendiri jam dan jumlah slot. '
    'is_break = true untuk istirahat/kegiatan sekolah.';
