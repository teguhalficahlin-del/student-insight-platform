-- Migration: 20260728080000_sip_seed_subject_name_mapping.sql
-- Tujuan: Seed core.subject_name_mapping dengan pola mapping mapel lokal SMKN 1 Ujungbatu
--         ke core.subjects berdasarkan SK BSKAP 046/H/KR/2025
-- Idempotent: ON CONFLICT DO NOTHING

INSERT INTO core.subject_name_mapping
  (kode_pattern, program_hint, grade_level, core_subject_id, confidence, notes)
VALUES

  -- ============================================================
  -- FASE E — DDPK per program (grade_level = 10)
  -- ============================================================
  (
    'DDPK X TJKT', 'TJKT', 10,
    (SELECT subject_id FROM core.subjects WHERE code = 'TJKT-DASAR'),
    'HIGH', 'Dasar-Dasar TJKT Fase E — SK BSKAP 046/H/KR/2025'
  ),
  (
    'DDPK X AKL', 'AKL', 10,
    (SELECT subject_id FROM core.subjects WHERE code = 'AKL-DASAR'),
    'HIGH', 'Dasar-Dasar AKL Fase E — SK BSKAP 046/H/KR/2025'
  ),
  (
    'DDPK X BDP', 'BDP', 10,
    (SELECT subject_id FROM core.subjects WHERE code = 'PEMASARAN-DASAR'),
    'HIGH', 'Dasar-Dasar Pemasaran Fase E — SK BSKAP 046/H/KR/2025'
  ),
  (
    'DDPK X BP', 'PSPT', 10,
    (SELECT subject_id FROM core.subjects WHERE code = 'BROADCASTING-DASAR'),
    'HIGH', 'Dasar-Dasar Broadcasting Fase E — SK BSKAP 046/H/KR/2025'
  ),
  (
    'DDPK X DPB', 'DPB', 10,
    (SELECT subject_id FROM core.subjects WHERE code = 'BUSANA-DASAR'),
    'HIGH', 'Dasar-Dasar Busana Fase E — SK BSKAP 046/H/KR/2025'
  ),
  (
    'DDPK X SP', 'SP', 10,
    (SELECT subject_id FROM core.subjects WHERE code = 'SPERTUNJUKAN-DASAR'),
    'HIGH', 'Dasar-Dasar Seni Pertunjukan Fase E — SK BSKAP 046/H/KR/2025'
  ),
  (
    'DDPK X TE', 'TE', 10,
    (SELECT subject_id FROM core.subjects WHERE code = 'ELEKTRONIKA-DASAR'),
    'HIGH', 'Dasar-Dasar Teknik Elektronika Fase E — SK BSKAP 046/H/KR/2025'
  ),
  (
    'DDPK X TL', 'TL', 10,
    (SELECT subject_id FROM core.subjects WHERE code = 'LOGISTIK-DASAR'),
    'HIGH', 'Dasar-Dasar Teknik Logistik Fase E — SK BSKAP 046/H/KR/2025'
  ),
  (
    'DDPK X TO', 'TKRO', 10,
    (SELECT subject_id FROM core.subjects WHERE code = 'OTOMOTIF-DASAR'),
    'HIGH', 'Dasar-Dasar Otomotif Fase E — konsentrasi TKRO'
  ),
  (
    'DDPK X TO', 'TBSM', 10,
    (SELECT subject_id FROM core.subjects WHERE code = 'OTOMOTIF-DASAR'),
    'HIGH', 'Dasar-Dasar Otomotif Fase E — konsentrasi TBSM'
  ),

  -- ============================================================
  -- FASE F — Konsentrasi TJKT (grade_level = 11)
  -- ============================================================
  (
    'IJN', 'TJKT', 11,
    (SELECT subject_id FROM core.subjects WHERE code = 'TKJ'),
    'HIGH', 'Instalasi Jaringan — TKJ Fase F'
  ),
  (
    'IKFO', 'TJKT', 11,
    (SELECT subject_id FROM core.subjects WHERE code = 'TKJ'),
    'HIGH', 'Instalasi dan Konfigurasi Fiber Optik — TKJ Fase F'
  ),
  (
    'IKSH', 'TJKT', 11,
    (SELECT subject_id FROM core.subjects WHERE code = 'TKJ'),
    'HIGH', 'Instalasi dan Konfigurasi Server dan Hotspot — TKJ Fase F'
  ),
  (
    'IV', 'TJKT', 11,
    (SELECT subject_id FROM core.subjects WHERE code = 'TKJ'),
    'HIGH', 'Instalasi VLAN — TKJ Fase F'
  ),
  (
    'PPJ', 'TJKT', 11,
    (SELECT subject_id FROM core.subjects WHERE code = 'TKJ'),
    'HIGH', 'Perawatan Perangkat Jaringan — TKJ Fase F'
  ),
  (
    'PJ', 'TJKT', 11,
    (SELECT subject_id FROM core.subjects WHERE code = 'TKJ'),
    'HIGH', 'Pemrograman Jaringan — TKJ Fase F'
  ),
  (
    'KIK', 'TJKT', 11,
    (SELECT subject_id FROM core.subjects WHERE code = 'PKW'),
    'HIGH', 'Projek Kreatif dan Kewirausahaan — wajib Fase F'
  ),

  -- ============================================================
  -- FASE F — Konsentrasi TKRO (grade_level = 11)
  -- ============================================================
  (
    'PPKR', 'TKRO', 11,
    (SELECT subject_id FROM core.subjects WHERE code = 'KK-TKRO'),
    'HIGH', 'Pemeliharaan dan Perawatan Kendaraan Ringan — TKRO Fase F'
  ),
  (
    'KEKR', 'TKRO', 11,
    (SELECT subject_id FROM core.subjects WHERE code = 'KK-TKRO'),
    'HIGH', 'Kelistrikan Kendaraan Ringan — TKRO Fase F'
  ),
  (
    'PBKR', 'TKRO', 11,
    (SELECT subject_id FROM core.subjects WHERE code = 'KK-TKRO'),
    'HIGH', 'Perbaikan Bodi Kendaraan Ringan — TKRO Fase F'
  ),
  (
    'SEKR', 'TKRO', 11,
    (SELECT subject_id FROM core.subjects WHERE code = 'KK-TKRO'),
    'HIGH', 'Servis Engine Kendaraan Ringan — TKRO Fase F'
  ),
  (
    'KIK', 'TKRO', 11,
    (SELECT subject_id FROM core.subjects WHERE code = 'PKW'),
    'HIGH', 'Projek Kreatif dan Kewirausahaan — wajib Fase F'
  ),

  -- ============================================================
  -- FASE F — Konsentrasi TBSM (grade_level = 11)
  -- ============================================================
  (
    'PCSM', 'TBSM', 11,
    (SELECT subject_id FROM core.subjects WHERE code = 'KK-TBSM'),
    'HIGH', 'Pemeliharaan Chasis Sepeda Motor — TBSM Fase F'
  ),
  (
    'PKSM', 'TBSM', 11,
    (SELECT subject_id FROM core.subjects WHERE code = 'KK-TBSM'),
    'HIGH', 'Pemeliharaan Kelistrikan Sepeda Motor — TBSM Fase F'
  ),
  (
    'PMSM', 'TBSM', 11,
    (SELECT subject_id FROM core.subjects WHERE code = 'KK-TBSM'),
    'HIGH', 'Pemeliharaan Mesin Sepeda Motor — TBSM Fase F'
  ),
  (
    'KIK', 'TBSM', 11,
    (SELECT subject_id FROM core.subjects WHERE code = 'PKW'),
    'HIGH', 'Projek Kreatif dan Kewirausahaan — wajib Fase F'
  ),

  -- ============================================================
  -- FASE F — Konsentrasi AKL (grade_level = 11)
  -- ============================================================
  (
    'KK', 'AKL', 11,
    (SELECT subject_id FROM core.subjects WHERE code = 'KK-AKL'),
    'HIGH', 'Konsentrasi Keahlian AKL Fase F'
  ),
  (
    'KIK', 'AKL', 11,
    (SELECT subject_id FROM core.subjects WHERE code = 'PKW'),
    'HIGH', 'Projek Kreatif dan Kewirausahaan — wajib Fase F'
  ),

  -- ============================================================
  -- FASE F — Konsentrasi BDP (grade_level = 11)
  -- ============================================================
  (
    'DB', 'BDP', 11,
    (SELECT subject_id FROM core.subjects WHERE code = 'BD'),
    'HIGH', 'Digital Bisnis — BDP Fase F'
  ),
  (
    'DM', 'BDP', 11,
    (SELECT subject_id FROM core.subjects WHERE code = 'BD'),
    'HIGH', 'Digital Marketing — BDP Fase F'
  ),
  (
    'DO', 'BDP', 11,
    (SELECT subject_id FROM core.subjects WHERE code = 'BD'),
    'HIGH', 'Digital Office — BDP Fase F'
  ),
  (
    'EBAU', 'BDP', 11,
    (SELECT subject_id FROM core.subjects WHERE code = 'BD'),
    'HIGH', 'E-Business dan Agen Usaha — BDP Fase F'
  ),
  (
    'KB', 'BDP', 11,
    (SELECT subject_id FROM core.subjects WHERE code = 'BD'),
    'HIGH', 'Komunikasi Bisnis — BDP Fase F'
  ),
  (
    'MARK', 'BDP', 11,
    (SELECT subject_id FROM core.subjects WHERE code = 'BD'),
    'HIGH', 'Marketing — BDP Fase F'
  ),
  (
    'KIK', 'BDP', 11,
    (SELECT subject_id FROM core.subjects WHERE code = 'PKW'),
    'HIGH', 'Projek Kreatif dan Kewirausahaan — wajib Fase F'
  ),

  -- ============================================================
  -- FASE F — Konsentrasi DPB (grade_level = 11)
  -- ============================================================
  (
    'ETDH', 'DPB', 11,
    (SELECT subject_id FROM core.subjects WHERE code = 'KK-DPB'),
    'HIGH', 'Eksplorasi dan Teknik Desain Hiasan — DPB Fase F'
  ),
  (
    'GM', 'DPB', 11,
    (SELECT subject_id FROM core.subjects WHERE code = 'KK-DPB'),
    'HIGH', 'Gambar Mode — DPB Fase F'
  ),
  (
    'GPD', 'DPB', 11,
    (SELECT subject_id FROM core.subjects WHERE code = 'KK-DPB'),
    'HIGH', 'Grading Pola Dasar — DPB Fase F'
  ),
  (
    'GT', 'DPB', 11,
    (SELECT subject_id FROM core.subjects WHERE code = 'KK-DPB'),
    'HIGH', 'Garmen Teknik — DPB Fase F'
  ),
  (
    'MPB', 'DPB', 11,
    (SELECT subject_id FROM core.subjects WHERE code = 'KK-DPB'),
    'HIGH', 'Manajemen Produksi Busana — DPB Fase F'
  ),
  (
    'PPB', 'DPB', 11,
    (SELECT subject_id FROM core.subjects WHERE code = 'KK-DPB'),
    'HIGH', 'Pembuatan Pola Busana — DPB Fase F'
  ),
  (
    'KIK', 'DPB', 11,
    (SELECT subject_id FROM core.subjects WHERE code = 'PKW'),
    'HIGH', 'Projek Kreatif dan Kewirausahaan — wajib Fase F'
  ),

  -- ============================================================
  -- FASE F — Konsentrasi PSPT (grade_level = 11)
  -- ============================================================
  (
    'MPSPT', 'PSPT', 11,
    (SELECT subject_id FROM core.subjects WHERE code = 'KK-PSPT'),
    'HIGH', 'Manajemen Produksi Siaran Program Televisi — PSPT Fase F'
  ),
  (
    'PNT', 'PSPT', 11,
    (SELECT subject_id FROM core.subjects WHERE code = 'KK-PSPT'),
    'HIGH', 'Produksi News dan Talk Show — PSPT Fase F'
  ),
  (
    'PT', 'PSPT', 11,
    (SELECT subject_id FROM core.subjects WHERE code = 'KK-PSPT'),
    'HIGH', 'Produksi Televisi — PSPT Fase F'
  ),
  (
    'KIK', 'PSPT', 11,
    (SELECT subject_id FROM core.subjects WHERE code = 'PKW'),
    'HIGH', 'Projek Kreatif dan Kewirausahaan — wajib Fase F'
  ),

  -- ============================================================
  -- FASE F — Konsentrasi TE/TAV (grade_level = 11)
  -- ============================================================
  (
    'MPMK', 'TE', 11,
    (SELECT subject_id FROM core.subjects WHERE code = 'TEI'),
    'HIGH', 'Merakit dan Pemrograman Mikrokontroler — TE Fase F'
  ),
  (
    'PRE', 'TE', 11,
    (SELECT subject_id FROM core.subjects WHERE code = 'TEI'),
    'HIGH', 'Perawatan dan Reparasi Elektronika — TE Fase F'
  ),
  (
    'PISAV', 'TE', 11,
    (SELECT subject_id FROM core.subjects WHERE code = 'TEI'),
    'HIGH', 'Pemasangan Instalasi Sound Audio Video — TE Fase F'
  ),
  (
    'PSRTV', 'TE', 11,
    (SELECT subject_id FROM core.subjects WHERE code = 'TEI'),
    'HIGH', 'Pemeliharaan dan Servis Radio Televisi — TE Fase F'
  ),
  (
    'KIK', 'TE', 11,
    (SELECT subject_id FROM core.subjects WHERE code = 'PKW'),
    'HIGH', 'Projek Kreatif dan Kewirausahaan — wajib Fase F'
  ),

  -- ============================================================
  -- FASE F — Konsentrasi TL (grade_level = 11)
  -- ============================================================
  (
    'AP', 'TL', 11,
    (SELECT subject_id FROM core.subjects WHERE code = 'KK-LOG'),
    'HIGH', 'Administrasi Pergudangan — TL Fase F'
  ),
  (
    'PENG', 'TL', 11,
    (SELECT subject_id FROM core.subjects WHERE code = 'KK-LOG'),
    'HIGH', 'Pengangkutan — TL Fase F'
  ),
  (
    'KIK', 'TL', 11,
    (SELECT subject_id FROM core.subjects WHERE code = 'PKW'),
    'HIGH', 'Projek Kreatif dan Kewirausahaan — wajib Fase F'
  ),

  -- ============================================================
  -- FASE F — Konsentrasi SP (grade_level = 11)
  -- ============================================================
  (
    'MAPIL', 'SP', 11,
    (SELECT subject_id FROM core.subjects WHERE code = 'KK-SENI-TARI'),
    'LOW', 'Mata Pelajaran Pilihan SP — diasumsikan Seni Tari, perlu konfirmasi admin'
  ),
  (
    'KIK', 'SP', 11,
    (SELECT subject_id FROM core.subjects WHERE code = 'PKW'),
    'HIGH', 'Projek Kreatif dan Kewirausahaan — wajib Fase F'
  ),

  -- ============================================================
  -- KIK lintas jurusan — fallback (program_hint NULL, grade_level NULL)
  -- ============================================================
  (
    'KIK', NULL, NULL,
    (SELECT subject_id FROM core.subjects WHERE code = 'PKW'),
    'HIGH', 'Projek Kreatif dan Kewirausahaan — fallback lintas program jika program_hint tidak diketahui'
  ),
  (
    'PKK', NULL, NULL,
    (SELECT subject_id FROM core.subjects WHERE code = 'PKW'),
    'HIGH', 'Varian kode KIK — Projek Kreatif dan Kewirausahaan'
  ),

  -- ============================================================
  -- MAPEL UMUM (program_hint NULL, grade_level NULL)
  -- ============================================================
  (
    'BING', NULL, NULL,
    (SELECT subject_id FROM core.subjects WHERE code = 'BING'),
    'HIGH', 'Bahasa Inggris'
  ),
  (
    'B.ING', NULL, NULL,
    (SELECT subject_id FROM core.subjects WHERE code = 'BING'),
    'HIGH', 'Bahasa Inggris — varian kode dengan titik'
  ),
  (
    'B.INGG', NULL, NULL,
    (SELECT subject_id FROM core.subjects WHERE code = 'BING'),
    'HIGH', 'Bahasa Inggris — varian kode dengan titik ganda'
  ),
  (
    'BAHASA_INGGRIS', NULL, NULL,
    (SELECT subject_id FROM core.subjects WHERE code = 'BING'),
    'HIGH', 'Bahasa Inggris — varian kode nama lengkap'
  ),
  (
    'MTK', NULL, NULL,
    (SELECT subject_id FROM core.subjects WHERE code = 'MAT'),
    'HIGH', 'Matematika'
  ),
  (
    'MATEMATIKA', NULL, NULL,
    (SELECT subject_id FROM core.subjects WHERE code = 'MAT'),
    'HIGH', 'Matematika — varian kode nama lengkap'
  ),
  (
    'BINDO', NULL, NULL,
    (SELECT subject_id FROM core.subjects WHERE code = 'BIN'),
    'HIGH', 'Bahasa Indonesia'
  ),
  (
    'B.IND', NULL, NULL,
    (SELECT subject_id FROM core.subjects WHERE code = 'BIN'),
    'HIGH', 'Bahasa Indonesia — varian kode dengan titik'
  ),
  (
    'B.INDO', NULL, NULL,
    (SELECT subject_id FROM core.subjects WHERE code = 'BIN'),
    'HIGH', 'Bahasa Indonesia — varian kode dengan titik ganda'
  ),
  (
    'BAHASA_INDONESIA', NULL, NULL,
    (SELECT subject_id FROM core.subjects WHERE code = 'BIN'),
    'HIGH', 'Bahasa Indonesia — varian kode nama lengkap'
  ),
  (
    'INF', NULL, NULL,
    (SELECT subject_id FROM core.subjects WHERE code = 'INF'),
    'HIGH', 'Informatika'
  ),
  (
    'IPAS', NULL, NULL,
    (SELECT subject_id FROM core.subjects WHERE code = 'IPAS'),
    'HIGH', 'Projek IPAS'
  ),
  (
    'PJOK', NULL, NULL,
    (SELECT subject_id FROM core.subjects WHERE code = 'PJOK'),
    'HIGH', 'Pendidikan Jasmani Olahraga dan Kesehatan'
  ),
  (
    'PPKN', NULL, NULL,
    (SELECT subject_id FROM core.subjects WHERE code = 'PPKn'),
    'HIGH', 'Pendidikan Pancasila'
  ),
  (
    'PKN', NULL, NULL,
    (SELECT subject_id FROM core.subjects WHERE code = 'PPKn'),
    'HIGH', 'Pendidikan Pancasila — varian kode lama'
  ),
  (
    'SJR', NULL, NULL,
    (SELECT subject_id FROM core.subjects WHERE code = 'SEJ'),
    'HIGH', 'Sejarah'
  ),
  (
    'SB', NULL, NULL,
    (SELECT subject_id FROM core.subjects WHERE code = 'SB_MUS'),
    'HIGH', 'Seni Budaya (Musik)'
  ),
  (
    'PAI', NULL, NULL,
    (SELECT subject_id FROM core.subjects WHERE code = 'PAI'),
    'HIGH', 'Pendidikan Agama Islam dan Budi Pekerti'
  ),
  (
    'PAK', NULL, NULL,
    (SELECT subject_id FROM core.subjects WHERE code = 'PAK'),
    'HIGH', 'Pendidikan Agama Kristen dan Budi Pekerti'
  ),
  (
    'AGAMA', NULL, NULL,
    (SELECT subject_id FROM core.subjects WHERE code = 'PAI'),
    'MEDIUM', 'Mata pelajaran agama generik — diasumsikan PAI, perlu konfirmasi jika sekolah multikeyakinan'
  )

ON CONFLICT (kode_pattern, program_hint, grade_level) DO NOTHING;
