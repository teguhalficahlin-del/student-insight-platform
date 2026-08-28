-- Seed core.subject_name_mapping dari cp-data.json MiClass
-- Sumber: MIClass/shared/data/cp-data.json
-- Hanya INSERT baris baru — ON CONFLICT DO NOTHING
-- Tidak mengubah data existing

INSERT INTO core.subject_name_mapping
    (kode_pattern, program_hint, grade_level, core_subject_id, confidence, notes)
VALUES

-- ============================================================
-- MAPEL UMUM (kelompok A & B) — berlaku semua program
-- ============================================================

-- Pendidikan Pancasila
('PENDIDIKAN_PANCASILA', NULL, NULL,
 '00000000-0000-0000-0010-000000000007', 'HIGH',
 'Canonical key dari cp-data.json MiClass'),

-- Sejarah
('SEJARAH', NULL, NULL,
 '00000000-0000-0000-0010-000000000010', 'HIGH',
 'Canonical key dari cp-data.json MiClass'),

-- Projek Kreatif & Kewirausahaan
('PROJEK_KREATIF_KEWIRAUSAHAAN', NULL, NULL,
 '00000000-0000-0000-0010-000000000020', 'HIGH',
 'Canonical key dari cp-data.json MiClass'),

-- Seni Budaya — Musik
('SENI_MUSIK', NULL, NULL,
 '00000000-0000-0000-0010-000000000011', 'HIGH',
 'Canonical key dari cp-data.json MiClass'),

-- Seni Budaya — Rupa
('SENI_RUPA', NULL, NULL,
 '00000000-0000-0000-0010-000000000012', 'HIGH',
 'Canonical key dari cp-data.json MiClass'),

-- Seni Budaya — Teater
('SENI_TEATER', NULL, NULL,
 '00000000-0000-0000-0010-000000000013', 'HIGH',
 'Canonical key dari cp-data.json MiClass'),

-- Seni Budaya — Tari (umum, bukan konsentrasi SMK)
('SENI_TARI', NULL, NULL,
 '00000000-0000-0000-0010-000000000014', 'HIGH',
 'Canonical key dari cp-data.json MiClass — seni tari umum, bukan KK SMK'),

-- ============================================================
-- PENDIDIKAN AGAMA (selain PAI & PAK yang sudah ada)
-- ============================================================

-- Pendidikan Agama Katolik
('PENDIDIKAN_AGAMA_KATOLIK', NULL, NULL,
 '00000000-0000-0000-0010-000000000003', 'HIGH',
 'Canonical key dari cp-data.json MiClass'),

-- Pendidikan Agama Buddha
('PENDIDIKAN_AGAMA_BUDDHA', NULL, NULL,
 '00000000-0000-0000-0010-000000000004', 'HIGH',
 'Canonical key dari cp-data.json MiClass'),

-- Pendidikan Agama Hindu
('PENDIDIKAN_AGAMA_HINDU', NULL, NULL,
 '00000000-0000-0000-0010-000000000005', 'HIGH',
 'Canonical key dari cp-data.json MiClass'),

-- Pendidikan Agama Khonghucu
('PENDIDIKAN_AGAMA_KHONGHUCU', NULL, NULL,
 '00000000-0000-0000-0010-000000000006', 'HIGH',
 'Canonical key dari cp-data.json MiClass'),

-- ============================================================
-- DASAR-DASAR KEJURUAN (Fase E, Kelas 10)
-- Canonical key tanpa program_hint — resolusi generik
-- ============================================================

-- Note: key asli cp-data.json 55 karakter, melebihi varchar(50) — disingkat
('DASAR_DASAR_TJKT', NULL, NULL,
 '00000000-0000-0000-0011-000000000001', 'HIGH',
 'Canonical key cp-data.json: dasar_dasar_teknik_jaringan_komputer_dan_telekomunikasi'),

('DASAR_DASAR_TEKNIK_OTOMOTIF', NULL, NULL,
 '00000000-0000-0000-0011-000000000002', 'HIGH',
 'Canonical key dari cp-data.json MiClass'),

('DASAR_DASAR_PEMASARAN', NULL, NULL,
 '00000000-0000-0000-0011-000000000003', 'HIGH',
 'Canonical key dari cp-data.json MiClass'),

('DASAR_DASAR_TEKNIK_ELEKTRONIKA', NULL, NULL,
 '00000000-0000-0000-0011-000000000004', 'HIGH',
 'Canonical key dari cp-data.json MiClass'),

('DASAR_DASAR_TEKNIK_LOGISTIK', NULL, NULL,
 '00000000-0000-0000-0011-000000000005', 'HIGH',
 'Canonical key dari cp-data.json MiClass'),

('DASAR_DASAR_BROADCASTING_DAN_PERFILMAN', NULL, NULL,
 '00000000-0000-0000-0011-000000000006', 'HIGH',
 'Canonical key dari cp-data.json MiClass'),

('DASAR_DASAR_BUSANA', NULL, NULL,
 '00000000-0000-0000-0011-000000000007', 'HIGH',
 'Canonical key dari cp-data.json MiClass'),

('DASAR_DASAR_SENI_PERTUNJUKAN', NULL, NULL,
 '00000000-0000-0000-0011-000000000008', 'HIGH',
 'Canonical key dari cp-data.json MiClass'),

('DASAR_DASAR_AKUNTANSI_DAN_KEUANGAN_LEMBAGA', NULL, NULL,
 '00000000-0000-0000-0011-000000000009', 'HIGH',
 'Canonical key dari cp-data.json MiClass'),

-- ============================================================
-- KONSENTRASI KEAHLIAN (Fase F, Kelas 11-12)
-- ============================================================

-- TJKT → Teknik Komputer dan Jaringan
('TEKNIK_KOMPUTER_DAN_JARINGAN', NULL, NULL,
 '00000000-0000-0000-0012-000000000001', 'HIGH',
 'Canonical key dari cp-data.json MiClass'),

-- Otomotif → Teknik Kendaraan Ringan Otomotif
('TEKNIK_KENDARAAN_RINGAN', NULL, NULL,
 '00000000-0000-0000-0012-000000000002', 'HIGH',
 'Canonical key dari cp-data.json MiClass — maps ke TKRO'),

-- Otomotif → Teknik Sepeda Motor
('TEKNIK_SEPEDA_MOTOR', NULL, NULL,
 '00000000-0000-0000-0012-000000000003', 'HIGH',
 'Canonical key dari cp-data.json MiClass'),

-- BDP → Bisnis Digital
('BISNIS_DIGITAL', NULL, NULL,
 '00000000-0000-0000-0012-000000000004', 'HIGH',
 'Canonical key dari cp-data.json MiClass'),

-- Teknik Elektronika → TEI
('TEKNIK_ELEKTRONIKA_INDUSTRI', NULL, NULL,
 '00000000-0000-0000-0012-000000000005', 'HIGH',
 'Canonical key dari cp-data.json MiClass'),

-- Logistik → Teknik Logistik
('TEKNIK_LOGISTIK', NULL, NULL,
 '00000000-0000-0000-0012-000000000006', 'HIGH',
 'Canonical key dari cp-data.json MiClass'),

-- Broadcasting → Produksi dan Siaran Program Televisi
('PRODUKSI_DAN_SIARAN_PROGRAM_TELEVISI', NULL, NULL,
 '00000000-0000-0000-0012-000000000007', 'HIGH',
 'Canonical key dari cp-data.json MiClass'),

-- Busana → Desain dan Produksi Busana
('DESAIN_DAN_PRODUKSI_BUSANA', NULL, NULL,
 '00000000-0000-0000-0012-000000000008', 'HIGH',
 'Canonical key dari cp-data.json MiClass'),

-- Seni Pertunjukan → Seni Tari SMK
('SENI_TARI_SMK', NULL, NULL,
 '00000000-0000-0000-0012-000000000010', 'HIGH',
 'Canonical key dari cp-data.json MiClass — KK Seni Tari SMK'),

-- AKL → Akuntansi dan Keuangan Lembaga
('AKUNTANSI', NULL, NULL,
 '00000000-0000-0000-0012-000000000011', 'HIGH',
 'Canonical key dari cp-data.json MiClass — maps ke KK-AKL'),

-- TJKT → Teknik Jaringan Akses Telekomunikasi
('TEKNIK_JARINGAN_AKSES_TELEKOMUNIKASI', NULL, NULL,
 '00000000-0000-0000-0012-000000000012', 'HIGH',
 'Canonical key dari cp-data.json MiClass'),

-- BDP → Bisnis Ritel
('BISNIS_RITEL', NULL, NULL,
 '00000000-0000-0000-0012-000000000013', 'HIGH',
 'Canonical key dari cp-data.json MiClass'),

-- Seni Pertunjukan → Tata Artistik Teater
('TATA_ARTISTIK_TEATER', NULL, NULL,
 '00000000-0000-0000-0012-000000000014', 'HIGH',
 'Canonical key dari cp-data.json MiClass')

ON CONFLICT (kode_pattern, program_hint, grade_level) DO NOTHING;
