-- SIP Sprint 1 — 012: Seed Prioritas 2 — CP Produktif 9 Prodi SMKN 1 Ujungbatu
-- Sumber: guru.kemendikdasmen.go.id (Capaian Pembelajaran resmi per prodi/fase)
--         Referensi regulasi: SK BSKAP No. 032/H/KR/2024 (mapel produktif)
--         Spektrum keahlian: Kepmendikbudristek No. 244/M/2024
--
-- CATATAN ARSITEKTUR:
--   • TKRO dan TBSM berbagi satu KEJURUAN_DASAR (Dasar-dasar Teknik Otomotif)
--     → program_id = NULL (tidak ada FK ke satu program; legal per schema)
--   • PSPT bukan program mandiri — per 244/M/2024, PSPT adalah
--     konsentrasi tunggal dari Program Keahlian BRD (Broadcasting dan Perfilman).
--     vocational_programs: 9 entries (BRD, bukan PSPT terpisah)
--     vocational_concentrations: KK-PSPT di bawah BRD
--   • BROADCASTING-DASAR program_id = BRD (bukan NULL)
--   • cp_umum = '[PENDING ...]' untuk mapel tanpa teks eksplisit di sumber resmi.
--     cp_elements tetap diisi dari konten resmi.
--
-- Idempotent: INSERT ... ON CONFLICT DO UPDATE / DO NOTHING

-- ============================================================
-- UUID TETAP (untuk reprodusibilitas seed)
-- Fields:        00000000-0000-0000-0003-00000000000X
-- Programs:      00000000-0000-0000-0004-00000000000X
-- Concentrations:00000000-0000-0000-0005-00000000000X
-- Subjects DASAR:00000000-0000-0000-0011-00000000000X
-- Subjects KONK: 00000000-0000-0000-0012-00000000000X
-- ============================================================

-- ============================================================
-- STEP 1A: Vocational Fields (Bidang Keahlian)
-- ============================================================
INSERT INTO core.vocational_fields (field_id, code, name, is_active)
VALUES
  ('00000000-0000-0000-0003-000000000001', 'TIK',    'Teknologi Informasi dan Komunikasi',  true),
  ('00000000-0000-0000-0003-000000000002', 'TMR',    'Teknologi Manufaktur dan Rekayasa',    true),
  ('00000000-0000-0000-0003-000000000003', 'BISNIS', 'Bisnis dan Manajemen',                 true),
  ('00000000-0000-0000-0003-000000000004', 'SENI',   'Seni dan Industri Kreatif',            true)
ON CONFLICT (code) DO UPDATE SET
  name      = EXCLUDED.name,
  is_active = EXCLUDED.is_active;

-- ============================================================
-- STEP 1B: Vocational Programs (Program Keahlian) — 9 programs
-- PSPT tidak ada di sini; PSPT = konsentrasi BRD (lihat Step 1C)
-- ============================================================
INSERT INTO core.vocational_programs (program_id, field_id, code, name, name_short, is_active)
VALUES
  -- TIK
  ('00000000-0000-0000-0004-000000000001',
   '00000000-0000-0000-0003-000000000001',
   'TJKT', 'Teknik Jaringan Komputer dan Telekomunikasi', 'TJKT', true),
  -- TMR
  ('00000000-0000-0000-0004-000000000002',
   '00000000-0000-0000-0003-000000000002',
   'TKRO', 'Teknik Kendaraan Ringan Otomotif', 'TKRO', true),
  ('00000000-0000-0000-0004-000000000003',
   '00000000-0000-0000-0003-000000000002',
   'TBSM', 'Teknik Bisnis Sepeda Motor', 'TBSM', true),
  ('00000000-0000-0000-0004-000000000005',
   '00000000-0000-0000-0003-000000000002',
   'TEL', 'Teknik Elektronika', 'TEL', true),
  ('00000000-0000-0000-0004-000000000006',
   '00000000-0000-0000-0003-000000000002',
   'LOG', 'Teknik Logistik', 'LOG', true),
  -- BISNIS
  ('00000000-0000-0000-0004-000000000004',
   '00000000-0000-0000-0003-000000000003',
   'BDP', 'Bisnis Daring dan Pemasaran', 'BDP', true),
  -- SENI
  ('00000000-0000-0000-0004-000000000007',
   '00000000-0000-0000-0003-000000000004',
   'BRD', 'Broadcasting dan Perfilman', 'BRD', true),
  ('00000000-0000-0000-0004-000000000008',
   '00000000-0000-0000-0003-000000000004',
   'DPB', 'Desain dan Produksi Busana', 'DPB', true),
  ('00000000-0000-0000-0004-000000000010',
   '00000000-0000-0000-0003-000000000004',
   'SPER', 'Seni Pertunjukan', 'SPER', true)
ON CONFLICT (code) DO UPDATE SET
  name       = EXCLUDED.name,
  name_short = EXCLUDED.name_short,
  is_active  = EXCLUDED.is_active;

-- ============================================================
-- STEP 1C: Vocational Concentrations (Konsentrasi Keahlian)
-- ============================================================
INSERT INTO core.vocational_concentrations
  (concentration_id, program_id, code, name, is_active)
VALUES
  -- TJKT
  ('00000000-0000-0000-0005-000000000001',
   '00000000-0000-0000-0004-000000000001',
   'TKJ',  'Teknik Komputer dan Jaringan', true),
  ('00000000-0000-0000-0005-000000000002',
   '00000000-0000-0000-0004-000000000001',
   'TJAT', 'Teknik Jaringan Akses Telekomunikasi', true),
  -- TKRO
  ('00000000-0000-0000-0005-000000000003',
   '00000000-0000-0000-0004-000000000002',
   'KK-TKRO', 'Teknik Kendaraan Ringan Otomotif', true),
  -- TBSM
  ('00000000-0000-0000-0005-000000000004',
   '00000000-0000-0000-0004-000000000003',
   'KK-TBSM', 'Teknik Bisnis Sepeda Motor', true),
  -- BDP
  ('00000000-0000-0000-0005-000000000005',
   '00000000-0000-0000-0004-000000000004',
   'BD', 'Bisnis Digital', true),
  ('00000000-0000-0000-0005-000000000006',
   '00000000-0000-0000-0004-000000000004',
   'BR', 'Bisnis Retail', true),
  -- TEL
  ('00000000-0000-0000-0005-000000000007',
   '00000000-0000-0000-0004-000000000005',
   'TEI', 'Teknik Elektronika Industri', true),
  -- LOG
  ('00000000-0000-0000-0005-000000000008',
   '00000000-0000-0000-0004-000000000006',
   'KK-LOG', 'Teknik Logistik', true),
  -- BRD: per 244/M/2024, PSPT adalah satu-satunya konsentrasi BRD
  ('00000000-0000-0000-0005-000000000009',
   '00000000-0000-0000-0004-000000000007',
   'KK-PSPT', 'Produksi dan Siaran Program Televisi', true),
  -- DPB
  ('00000000-0000-0000-0005-000000000010',
   '00000000-0000-0000-0004-000000000008',
   'KK-DPB', 'Desain dan Produksi Busana', true),
  -- SPER
  ('00000000-0000-0000-0005-000000000012',
   '00000000-0000-0000-0004-000000000010',
   'KK-SENI-TARI',   'Seni Tari', true),
  ('00000000-0000-0000-0005-000000000013',
   '00000000-0000-0000-0004-000000000010',
   'KK-SENI-MUSIK',  'Seni Musik', true),
  ('00000000-0000-0000-0005-000000000014',
   '00000000-0000-0000-0004-000000000010',
   'KK-SENI-TEATER', 'Seni Teater', true)
ON CONFLICT (code) DO UPDATE SET
  name      = EXCLUDED.name,
  is_active = EXCLUDED.is_active;

-- ============================================================
-- STEP 2: Subjects — KEJURUAN_DASAR (Fase E)
-- ============================================================
-- OTOMOTIF-DASAR: program_id = NULL karena dipakai bersama TKRO dan TBSM.
-- BROADCASTING-DASAR: program_id = BRD (satu-satunya program pemilik).

INSERT INTO core.subjects
  (subject_id, code, name, subject_type, program_id, is_generatable, is_active)
VALUES
  -- TJKT
  ('00000000-0000-0000-0011-000000000001',
   'TJKT-DASAR',
   'Dasar-Dasar Teknik Jaringan Komputer dan Telekomunikasi',
   'KEJURUAN_DASAR',
   '00000000-0000-0000-0004-000000000001', true, true),
  -- Otomotif: shared TKRO + TBSM, program_id = NULL (legal per schema)
  ('00000000-0000-0000-0011-000000000002',
   'OTOMOTIF-DASAR',
   'Dasar-Dasar Teknik Otomotif',
   'KEJURUAN_DASAR',
   NULL, true, true),
  -- BDP
  ('00000000-0000-0000-0011-000000000003',
   'PEMASARAN-DASAR',
   'Dasar-Dasar Pemasaran',
   'KEJURUAN_DASAR',
   '00000000-0000-0000-0004-000000000004', true, true),
  -- TEL
  ('00000000-0000-0000-0011-000000000004',
   'ELEKTRONIKA-DASAR',
   'Dasar-Dasar Teknik Elektronika',
   'KEJURUAN_DASAR',
   '00000000-0000-0000-0004-000000000005', true, true),
  -- LOG
  ('00000000-0000-0000-0011-000000000005',
   'LOGISTIK-DASAR',
   'Dasar-Dasar Teknik Logistik',
   'KEJURUAN_DASAR',
   '00000000-0000-0000-0004-000000000006', true, true),
  -- BRD (Broadcasting): program_id = BRD
  ('00000000-0000-0000-0011-000000000006',
   'BROADCASTING-DASAR',
   'Dasar-Dasar Broadcasting dan Perfilman',
   'KEJURUAN_DASAR',
   '00000000-0000-0000-0004-000000000007', true, true),
  -- DPB
  ('00000000-0000-0000-0011-000000000007',
   'BUSANA-DASAR',
   'Dasar-Dasar Busana',
   'KEJURUAN_DASAR',
   '00000000-0000-0000-0004-000000000008', true, true),
  -- SPER
  ('00000000-0000-0000-0011-000000000008',
   'SPERTUNJUKAN-DASAR',
   'Dasar-Dasar Seni Pertunjukan',
   'KEJURUAN_DASAR',
   '00000000-0000-0000-0004-000000000010', true, true)
ON CONFLICT (code) DO UPDATE SET
  name           = EXCLUDED.name,
  subject_type   = EXCLUDED.subject_type,
  is_generatable = EXCLUDED.is_generatable,
  is_active      = EXCLUDED.is_active;

-- ============================================================
-- STEP 3: Subjects — KEJURUAN_KONSENTRASI (Fase F)
-- KK-PSPT terhubung ke concentration_id = 00000000-0000-0000-0005-000000000009
-- (konsentrasi KK-PSPT di bawah program BRD)
-- ============================================================
INSERT INTO core.subjects
  (subject_id, code, name, subject_type, concentration_id, is_generatable, is_active)
VALUES
  -- TKJ (Teknik Komputer dan Jaringan) — konsentrasi TJKT
  ('00000000-0000-0000-0012-000000000001',
   'TKJ',
   'Teknik Komputer dan Jaringan',
   'KEJURUAN_KONSENTRASI',
   '00000000-0000-0000-0005-000000000001', true, true),
  -- KK-TKRO
  ('00000000-0000-0000-0012-000000000002',
   'KK-TKRO',
   'Teknik Kendaraan Ringan Otomotif',
   'KEJURUAN_KONSENTRASI',
   '00000000-0000-0000-0005-000000000003', true, true),
  -- KK-TBSM
  ('00000000-0000-0000-0012-000000000003',
   'KK-TBSM',
   'Teknik Sepeda Motor',
   'KEJURUAN_KONSENTRASI',
   '00000000-0000-0000-0005-000000000004', true, true),
  -- BD (Bisnis Digital)
  ('00000000-0000-0000-0012-000000000004',
   'BD',
   'Bisnis Digital',
   'KEJURUAN_KONSENTRASI',
   '00000000-0000-0000-0005-000000000005', true, true),
  -- TEI (Teknik Elektronika Industri)
  ('00000000-0000-0000-0012-000000000005',
   'TEI',
   'Teknik Elektronika Industri',
   'KEJURUAN_KONSENTRASI',
   '00000000-0000-0000-0005-000000000007', true, true),
  -- KK-LOG
  ('00000000-0000-0000-0012-000000000006',
   'KK-LOG',
   'Teknik Logistik',
   'KEJURUAN_KONSENTRASI',
   '00000000-0000-0000-0005-000000000008', true, true),
  -- KK-PSPT: satu-satunya konsentrasi BRD (per 244/M/2024)
  ('00000000-0000-0000-0012-000000000007',
   'KK-PSPT',
   'Produksi dan Siaran Program Televisi',
   'KEJURUAN_KONSENTRASI',
   '00000000-0000-0000-0005-000000000009', true, true),
  -- KK-DPB
  ('00000000-0000-0000-0012-000000000008',
   'KK-DPB',
   'Desain dan Produksi Busana',
   'KEJURUAN_KONSENTRASI',
   '00000000-0000-0000-0005-000000000010', true, true),
  -- Seni Tari (SPER)
  ('00000000-0000-0000-0012-000000000010',
   'KK-SENI-TARI',
   'Seni Tari',
   'KEJURUAN_KONSENTRASI',
   '00000000-0000-0000-0005-000000000012', true, true)
ON CONFLICT (code) DO UPDATE SET
  name           = EXCLUDED.name,
  subject_type   = EXCLUDED.subject_type,
  is_generatable = EXCLUDED.is_generatable,
  is_active      = EXCLUDED.is_active;

-- ============================================================
-- STEP 4: Subject Phases
-- DASAR       → Fase E (00000000-0000-0000-0002-000000000001)
-- KONSENTRASI → Fase F (00000000-0000-0000-0002-000000000002)
-- ============================================================

-- DASAR → Fase E
INSERT INTO core.subject_phases (subject_id, phase_id, version_id)
SELECT s.subject_id,
       '00000000-0000-0000-0002-000000000001',
       '00000000-0000-0000-0000-000000000001'
FROM core.subjects s
WHERE s.code IN (
  'TJKT-DASAR','OTOMOTIF-DASAR','PEMASARAN-DASAR',
  'ELEKTRONIKA-DASAR','LOGISTIK-DASAR','BROADCASTING-DASAR',
  'BUSANA-DASAR','SPERTUNJUKAN-DASAR'
)
ON CONFLICT (subject_id, phase_id, version_id) DO NOTHING;

-- KONSENTRASI → Fase F
INSERT INTO core.subject_phases (subject_id, phase_id, version_id)
SELECT s.subject_id,
       '00000000-0000-0000-0002-000000000002',
       '00000000-0000-0000-0000-000000000001'
FROM core.subjects s
WHERE s.code IN (
  'TKJ','KK-TKRO','KK-TBSM','BD','TEI','KK-LOG',
  'KK-PSPT','KK-DPB','KK-SENI-TARI'
)
ON CONFLICT (subject_id, phase_id, version_id) DO NOTHING;

-- ============================================================
-- STEP 5: Capaian Pembelajaran — placeholder untuk semua subject_phase baru
-- ============================================================
INSERT INTO core.capaian_pembelajaran (subject_phase_id, version_id, cp_umum, is_active)
SELECT
  sp.subject_phase_id,
  sp.version_id,
  '[PENDING — diisi dari dokumen resmi SK BSKAP No. 032/H/KR/2024]',
  true
FROM core.subject_phases sp
JOIN core.subjects s ON sp.subject_id = s.subject_id
WHERE s.code IN (
  'TJKT-DASAR','OTOMOTIF-DASAR','PEMASARAN-DASAR',
  'ELEKTRONIKA-DASAR','LOGISTIK-DASAR','BROADCASTING-DASAR',
  'BUSANA-DASAR','SPERTUNJUKAN-DASAR',
  'TKJ','KK-TKRO','KK-TBSM','BD','TEI','KK-LOG',
  'KK-PSPT','KK-DPB','KK-SENI-TARI'
)
ON CONFLICT (subject_phase_id, version_id) DO NOTHING;

-- ============================================================
-- STEP 6: Isi CP — per prodi dari sumber resmi
-- ============================================================

-- cp_umum KK-TKRO tersedia eksplisit; sisanya PENDING
UPDATE core.capaian_pembelajaran
SET
  cp_umum        = 'Peserta didik mampu memahami dan menerapkan proses konversi energi, prosedur operasional bengkel, penggunaan kendaraan, perawatan berkala, serta melakukan perawatan dan overhaul pada semua sistem kendaraan ringan (engine, pemindah tenaga, sasis, elektrikal, pengaman, dan kontrol elektronik) sesuai dengan standar prosedur dan keselamatan kerja yang berlaku.',
  bskap_ref      = 'SK BSKAP No. 032/H/KR/2024',
  effective_date = '2024-06-11',
  updated_at     = now()
WHERE subject_phase_id = (
  SELECT sp.subject_phase_id
  FROM core.subject_phases sp
  JOIN core.subjects s ON sp.subject_id = s.subject_id
  JOIN core.phases   p ON sp.phase_id   = p.phase_id
  WHERE s.code = 'KK-TKRO' AND p.code = 'F'
);

-- bskap_ref untuk semua mapel produktif
UPDATE core.capaian_pembelajaran
SET
  bskap_ref      = 'SK BSKAP No. 032/H/KR/2024',
  effective_date = '2024-06-11',
  updated_at     = now()
WHERE subject_phase_id IN (
  SELECT sp.subject_phase_id
  FROM core.subject_phases sp
  JOIN core.subjects s ON sp.subject_id = s.subject_id
  WHERE s.code IN (
    'TJKT-DASAR','OTOMOTIF-DASAR','PEMASARAN-DASAR',
    'ELEKTRONIKA-DASAR','LOGISTIK-DASAR','BROADCASTING-DASAR',
    'BUSANA-DASAR','SPERTUNJUKAN-DASAR',
    'TKJ','KK-TKRO','KK-TBSM','BD','TEI','KK-LOG',
    'KK-PSPT','KK-DPB','KK-SENI-TARI'
  )
);

-- ============================================================
-- STEP 7: cp_elements — isi per subject dari sumber resmi
-- ============================================================

-- ----------------------------------------------------------------
-- 7.1 TJKT-DASAR Fase E
-- Sumber: guru.kemendikdasmen.go.id/…/dasar-dasar-teknik-jaringan-komputer-dan-telekomunikasi/fase-e/
-- ----------------------------------------------------------------
INSERT INTO core.cp_elements (element_id, cp_id, element_order, nama_elemen, deskripsi_cp, is_active)
SELECT gen_random_uuid(), cp.cp_id, el.element_order, el.nama_elemen, el.deskripsi_cp, true
FROM core.capaian_pembelajaran cp
JOIN core.subject_phases sp ON cp.subject_phase_id = sp.subject_phase_id
JOIN core.subjects s ON sp.subject_id = s.subject_id
JOIN core.phases   p ON sp.phase_id   = p.phase_id
CROSS JOIN (VALUES
  (1, 'Proses Bisnis di Bidang Teknik Jaringan Komputer dan Telekomunikasi',
   'Pada akhir fase E peserta didik mampu memahami proses bisnis pada bidang teknik jaringan komputer dan telekomunikasi, meliputi customer handling, perencanaan, analisis kebutuhan pelanggan, strategi implementasi (instalasi, konfigurasi, monitoring), dan pelayanan pada pelanggan sebagai implementasi penerapan budaya mutu.'),
  (2, 'Perkembangan Teknologi di Bidang Teknik Jaringan Komputer dan Telekomunikasi',
   'Pada akhir fase E peserta didik mampu memahami perkembangan teknologi pada perangkat teknik jaringan komputer dan telekomunikasi termasuk 5G, Microwave Link, IPV6, teknologi serat optik terkini, IoT, Data Centre, Cloud Computing, dan Information Security serta isu-isu implementasi teknologi jaringan dan telekomunikasi terkini antara lain keamanan informasi, penetrasi Internet.'),
  (3, 'Profesi dan Kewirausahaan',
   'Pada akhir fase E peserta didik mampu memahami jenis-jenis profesi kewirausahaan (job-profile dan technopreneurship), personal branding serta peluang usaha di bidang Teknik Jaringan Komputer dan Telekomunikasi, untuk membangun vision dan passion, dengan melaksanakan pembelajaran berbasis proyek nyata sebagai simulasi proyek kewirausahaan.'),
  (4, 'Keselamatan dan Kesehatan Kerja Lingkungan Hidup (K3LH) dan Budaya Kerja Industri',
   'Pada akhir fase E peserta didik mampu menerapkan K3LH dan budaya kerja industri, antara lain: praktik-praktik kerja yang aman, bahaya-bahaya di tempat kerja, prosedur-prosedur dalam keadaan darurat, dan penerapan budaya kerja industri (Ringkas, Rapi, Resik, Rawat, Rajin), termasuk pencegahan kecelakaan kerja di tempat tinggi dan prosedur kerja di tempat tinggi (pemanjatan).'),
  (5, 'Dasar-Dasar Teknik Jaringan Komputer dan Telekomunikasi',
   'Pada akhir fase E peserta didik mampu memahami tentang jenis alat ukur dan penggunaannya dalam pemeliharaan jaringan komputer dan sistem telekomunikasi.'),
  (6, 'Media dan Jaringan Telekomunikasi',
   'Pada akhir fase E peserta didik mampu memahami prinsip dasar sistem IPV4/IPV6, TCP IP, Networking Service, Sistem Keamanan Jaringan Telekomunikasi, Sistem Seluler, Sistem Microwave, Sistem VSAT IP, Sistem Optik, dan Sistem WLAN.'),
  (7, 'Penggunaan Alat Ukur',
   'Pada akhir fase E peserta didik mampu menggunakan alat ukur, termasuk pemeliharaan alat ukur untuk seluruh jaringan komputer dan sistem telekomunikasi.')
) AS el(element_order, nama_elemen, deskripsi_cp)
WHERE s.code = 'TJKT-DASAR' AND p.code = 'E'
ON CONFLICT (cp_id, element_order) DO UPDATE SET
  nama_elemen  = EXCLUDED.nama_elemen,
  deskripsi_cp = EXCLUDED.deskripsi_cp,
  is_active    = true;

-- ----------------------------------------------------------------
-- 7.2 TKJ Fase F (Teknik Komputer dan Jaringan)
-- Sumber: guru.kemendikdasmen.go.id/…/teknik-komputer-dan-jaringan/fase-f/
-- ----------------------------------------------------------------
INSERT INTO core.cp_elements (element_id, cp_id, element_order, nama_elemen, deskripsi_cp, is_active)
SELECT gen_random_uuid(), cp.cp_id, el.element_order, el.nama_elemen, el.deskripsi_cp, true
FROM core.capaian_pembelajaran cp
JOIN core.subject_phases sp ON cp.subject_phase_id = sp.subject_phase_id
JOIN core.subjects s ON sp.subject_id = s.subject_id
JOIN core.phases   p ON sp.phase_id   = p.phase_id
CROSS JOIN (VALUES
  (1, 'Perencanaan dan Pengalamaran Jaringan',
   'Peserta didik mampu merencanakan topologi dan arsitektur jaringan sesuai kebutuhan, mengumpulkan kebutuhan teknis pengguna yang menggunakan jaringan, mengumpulkan data peralatan jaringan dengan teknologi yang sesuai, melakukan pengalamatan jaringan, memahami CIDR dan VLSM, dan menghitung subnetting.'),
  (2, 'Teknologi Jaringan Kabel dan Nirkabel',
   'Peserta didik mampu menginstalasi jaringan kabel dan nirkabel, melakukan perawatan dan perbaikan jaringan kabel dan nirkabel, memahami standar jaringan nirkabel, memilih teknologi jaringan nirkabel indoor dan outdoor sesuai kebutuhan, melakukan instalasi dan konfigurasi VoIP, memasang kabel fiber optik, mengukur redaman kabel fiber optik, serta merawat dan memperbaiki jaringan fiber optik.'),
  (3, 'Keamanan Jaringan',
   'Peserta didik mampu memahami kebijakan penggunaan jaringan, memahami kemungkinan ancaman dan serangan terhadap keamanan jaringan, menentukan sistem keamanan jaringan yang dibutuhkan, memahami firewall pada perangkat jaringan, memahami jenis-jenis autentikasi, mendeteksi dan melindungi perangkat dari ancaman jaringan, serta memahami prinsip dasar kriptografi.'),
  (4, 'Pemasangan dan Konfigurasi Perangkat Jaringan',
   'Peserta didik mampu mengkonfigurasi VLAN, mengkonfigurasi routing statik dan dinamis, mengkonfigurasi NAT, mengkonfigurasi server proxy, mengkonfigurasi manajemen bandwidth, dan mengkonfigurasi load balancing.'),
  (5, 'Administrasi Sistem Jaringan',
   'Peserta didik mampu melakukan instalasi sistem operasi jaringan, mengkonfigurasi layanan server (DHCP, DNS, FTP, web server, mail server, database server), memahami jenis-jenis layanan hosting, mengkonfigurasi VPN, dan melakukan monitoring jaringan.')
) AS el(element_order, nama_elemen, deskripsi_cp)
WHERE s.code = 'TKJ' AND p.code = 'F'
ON CONFLICT (cp_id, element_order) DO UPDATE SET
  nama_elemen  = EXCLUDED.nama_elemen,
  deskripsi_cp = EXCLUDED.deskripsi_cp,
  is_active    = true;

-- ----------------------------------------------------------------
-- 7.3 OTOMOTIF-DASAR Fase E
-- Sumber: guru.kemendikdasmen.go.id/…/dasar-dasar-teknik-otomotif/fase-e/
-- ----------------------------------------------------------------
INSERT INTO core.cp_elements (element_id, cp_id, element_order, nama_elemen, deskripsi_cp, is_active)
SELECT gen_random_uuid(), cp.cp_id, el.element_order, el.nama_elemen, el.deskripsi_cp, true
FROM core.capaian_pembelajaran cp
JOIN core.subject_phases sp ON cp.subject_phase_id = sp.subject_phase_id
JOIN core.subjects s ON sp.subject_id = s.subject_id
JOIN core.phases   p ON sp.phase_id   = p.phase_id
CROSS JOIN (VALUES
  (1, 'Proses Bisnis Bidang Otomotif Secara Menyeluruh',
   'Pada akhir fase E peserta didik mampu memahami proses bisnis bidang otomotif secara menyeluruh pada berbagai jenis dan merk kendaraan, serta pengelolaan sumber daya manusia dengan memperhatikan potensi dan kearifan lokal.'),
  (2, 'Perkembangan Teknologi Otomotif dan Dunia Kerja serta Isu-Isu Global',
   'Pada akhir fase E peserta didik mampu memahami perkembangan teknologi otomotif dan dunia kerja serta menganalisis isu-isu global terkait dunia otomotif, antara lain penerapan elektronik di otomotif, mobil listrik, kendaraan dengan kendali jarak jauh.'),
  (3, 'Profesi dan Kewirausahaan serta Peluang Usaha di Bidang Otomotif',
   'Pada akhir fase E peserta didik mampu memahami profesi dan kewirausahaan di bidang otomotif (job-profile dan technopreneurship), serta peluang usaha, untuk membangun vision dan passion melalui pembelajaran berbasis proyek nyata.'),
  (4, 'Keselamatan dan Kesehatan Kerja serta Lingkungan Hidup (K3LH) dan Budaya Kerja Industri',
   'Pada akhir fase E peserta didik mampu menerapkan K3LH dan budaya kerja industri, antara lain: praktik kerja aman, bahaya di tempat kerja, prosedur darurat, dan budaya kerja industri (5R: Ringkas, Rapi, Resik, Rawat, Rajin) serta etika kerja.'),
  (5, 'Teknik Dasar Pemeliharaan dan Perbaikan',
   'Pada akhir fase E peserta didik mampu memahami teknik dasar melalui pengenalan dan praktik penggunaan alat ukur, pemeliharaan, perbaikan, pembentukan body, perakitan, serta pengenalan alat berat.'),
  (6, 'Gambar Teknik',
   'Pada akhir fase E peserta didik mampu menggambar teknik dasar, termasuk pengenalan peralatan gambar, standarisasi, praktik menggambar dan membaca gambar teknik.'),
  (7, 'Peralatan dan Perlengkapan Tempat Kerja',
   'Pada akhir fase E peserta didik mampu menggunakan peralatan kerja, antara lain persiapan, kalibrasi, dan penggunaan sesuai jenis, fungsi dan manual perbaikan.'),
  (8, 'Pemeliharaan Komponen Otomotif',
   'Pada akhir fase E peserta didik mampu menjelaskan fungsi dan cara kerja komponen engine, pemindah tenaga, sasis, identifikasi struktur dan lokasi komponen, serta penerapan pemeriksaan sesuai manual perbaikan.'),
  (9, 'Dasar Elektronika Otomotif',
   'Pada akhir fase E peserta didik mampu membuat rangkaian elektronika dasar, termasuk pemahaman fungsi komponen elektronika, perakitan, diagnosa gangguan, perawatan, pematrian komponen sesuai prosedur.'),
  (10, 'Dasar Sistem Hidrolik dan Pneumatik',
   'Pada akhir fase E peserta didik mampu memahami prinsip dasar sistem hidrolik dan pneumatik, termasuk fungsi, cara kerja komponen, perawatan dan pengujian komponen sistem tersebut.')
) AS el(element_order, nama_elemen, deskripsi_cp)
WHERE s.code = 'OTOMOTIF-DASAR' AND p.code = 'E'
ON CONFLICT (cp_id, element_order) DO UPDATE SET
  nama_elemen  = EXCLUDED.nama_elemen,
  deskripsi_cp = EXCLUDED.deskripsi_cp,
  is_active    = true;

-- ----------------------------------------------------------------
-- 7.4 KK-TKRO Fase F (Teknik Kendaraan Ringan Otomotif)
-- Sumber: guru.kemendikdasmen.go.id/…/teknik-kendaraan-ringan/fase-f/
-- ----------------------------------------------------------------
INSERT INTO core.cp_elements (element_id, cp_id, element_order, nama_elemen, deskripsi_cp, is_active)
SELECT gen_random_uuid(), cp.cp_id, el.element_order, el.nama_elemen, el.deskripsi_cp, true
FROM core.capaian_pembelajaran cp
JOIN core.subject_phases sp ON cp.subject_phase_id = sp.subject_phase_id
JOIN core.subjects s ON sp.subject_id = s.subject_id
JOIN core.phases   p ON sp.phase_id   = p.phase_id
CROSS JOIN (VALUES
  (1, 'Konversi Energi Kendaraan Ringan',
   'Pada akhir fase F peserta didik mampu memahami proses konversi energi kendaraan ringan, identifikasi sumber energi kendaraan ringan beserta jenis-jenisnya termasuk gasoline, diesel, listrik, dan hybrid.'),
  (2, 'Proses Pelayanan dan Manajemen Bengkel Kendaraan Ringan',
   'Pada akhir fase F peserta didik mampu memahami alur proses penerimaan service, pelaksanaan service, pengelolaan alat dan bahan serta tugas berbagai posisi pekerjaan mengikuti prosedur standar dan keselamatan kerja.'),
  (3, 'Prosedur Penggunaan Kendaraan Ringan',
   'Pada akhir fase F peserta didik mampu menerapkan pengecekan sebelum dan sesudah berkendara dan mengoperasikan transmisi manual maupun otomatis.'),
  (4, 'Perawatan Berkala Kendaraan Ringan',
   'Pada akhir fase F peserta didik mampu melakukan perawatan berkala kendaraan pada interval 1.000 KM, 10.000 KM, 20.000 KM dan kelipatannya sesuai standar prosedur operasional.'),
  (5, 'Sistem Engine Kendaraan Ringan',
   'Pada akhir fase F peserta didik mampu melakukan perawatan dan overhaul sistem pelumasan, pendinginan, bahan bakar, manajemen engine, pemasukan udara, dan pembuangan sesuai standar prosedur.'),
  (6, 'Sistem Pemindah Tenaga Kendaraan Ringan',
   'Pada akhir fase F peserta didik mampu melakukan perawatan dan overhaul sistem clutch, sistem transmisi (manual dan otomatis), poros propeller, differential, dan poros penggerak roda.'),
  (7, 'Sistem Sasis Kendaraan Ringan',
   'Pada akhir fase F peserta didik mampu melakukan perawatan sistem rem, kemudi, suspensi, roda, ban, serta spooring dan balancing.'),
  (8, 'Elektrikal Kendaraan Ringan',
   'Pada akhir fase F peserta didik mampu melakukan perawatan baterai dan overhaul sistem kelistrikan, penerangan, wiper, power window, starter, pengisian, pengapian, AC, dan audio-video.'),
  (9, 'Sistem Pengaman dan Kontrol Elektronik Kendaraan Ringan',
   'Pada akhir fase F peserta didik mampu memahami dan melakukan perawatan sistem keamanan kendaraan (Alarm, Keyless, Immobilizer) dan berbagai modul kontrol elektronik seperti sensor, radar, dan komponen terkait.')
) AS el(element_order, nama_elemen, deskripsi_cp)
WHERE s.code = 'KK-TKRO' AND p.code = 'F'
ON CONFLICT (cp_id, element_order) DO UPDATE SET
  nama_elemen  = EXCLUDED.nama_elemen,
  deskripsi_cp = EXCLUDED.deskripsi_cp,
  is_active    = true;

-- ----------------------------------------------------------------
-- 7.5 KK-TBSM Fase F (Teknik Sepeda Motor)
-- Sumber: guru.kemendikdasmen.go.id/…/teknik-sepeda-motor/fase-f/
-- ----------------------------------------------------------------
INSERT INTO core.cp_elements (element_id, cp_id, element_order, nama_elemen, deskripsi_cp, is_active)
SELECT gen_random_uuid(), cp.cp_id, el.element_order, el.nama_elemen, el.deskripsi_cp, true
FROM core.capaian_pembelajaran cp
JOIN core.subject_phases sp ON cp.subject_phase_id = sp.subject_phase_id
JOIN core.subjects s ON sp.subject_id = s.subject_id
JOIN core.phases   p ON sp.phase_id   = p.phase_id
CROSS JOIN (VALUES
  (1, 'Perawatan dan Perbaikan Engine Sepeda Motor',
   'Pada akhir fase F peserta didik mampu mendiagnosis gangguan atau kerusakan pada engine sepeda motor dan melakukan perbaikan pada berbagai merek sepeda motor sesuai standar prosedur operasional.'),
  (2, 'Perawatan dan Perbaikan Sasis Sepeda Motor',
   'Pada akhir fase F peserta didik mampu mendiagnosis gangguan atau kerusakan pada sasis sepeda motor beserta komponen-komponennya termasuk sistem rem, kemudi, dan suspensi.'),
  (3, 'Perawatan dan Perbaikan Sistem Pemindah Tenaga Sepeda Motor',
   'Pada akhir fase F peserta didik mampu mendiagnosis gangguan atau kerusakan pada sistem pemindah tenaga sepeda motor mencakup kopling, transmisi, dan sistem penggerak.'),
  (4, 'Perawatan dan Perbaikan Sistem Kelistrikan Sepeda Motor',
   'Pada akhir fase F peserta didik mampu mendiagnosis dan memperbaiki gangguan pada sistem kelistrikan sepeda motor termasuk sistem pengapian, sistem pengisian, motor starter, sistem penerangan dan komponen keamanan.'),
  (5, 'Perawatan dan Perbaikan Sepeda Motor Listrik dan Hybrid',
   'Pada akhir fase F peserta didik mampu memahami gangguan atau kerusakan pada sepeda motor listrik dan hybrid serta melakukan tindakan perbaikan sesuai prosedur.'),
  (6, 'Perawatan dan Perbaikan Engine Management System',
   'Pada akhir fase F peserta didik mampu mendiagnosis permasalahan pada sistem pengaliran bahan bakar dan sistem kontrol elektronik sepeda motor.'),
  (7, 'Pengelolaan Bengkel Sepeda Motor',
   'Pada akhir fase F peserta didik mampu menerapkan pengelolaan, pengembangan teknik dan manajemen perawatan bengkel sepeda motor sesuai perkembangan industri.')
) AS el(element_order, nama_elemen, deskripsi_cp)
WHERE s.code = 'KK-TBSM' AND p.code = 'F'
ON CONFLICT (cp_id, element_order) DO UPDATE SET
  nama_elemen  = EXCLUDED.nama_elemen,
  deskripsi_cp = EXCLUDED.deskripsi_cp,
  is_active    = true;

-- ----------------------------------------------------------------
-- 7.6 PEMASARAN-DASAR Fase E (Dasar-dasar Pemasaran)
-- Sumber: guru.kemendikdasmen.go.id/…/dasar-dasar-pemasaran/fase-e/
-- ----------------------------------------------------------------
INSERT INTO core.cp_elements (element_id, cp_id, element_order, nama_elemen, deskripsi_cp, is_active)
SELECT gen_random_uuid(), cp.cp_id, el.element_order, el.nama_elemen, el.deskripsi_cp, true
FROM core.capaian_pembelajaran cp
JOIN core.subject_phases sp ON cp.subject_phase_id = sp.subject_phase_id
JOIN core.subjects s ON sp.subject_id = s.subject_id
JOIN core.phases   p ON sp.phase_id   = p.phase_id
CROSS JOIN (VALUES
  (1, 'Proses Bisnis Pemasaran',
   'Pada akhir fase E peserta didik mampu menjelaskan proses bisnis dalam bidang pemasaran secara menyeluruh pada berbagai jenis industri dan usaha.'),
  (2, 'Perkembangan Teknologi dan Isu Terkini di Bidang Pemasaran',
   'Pada akhir fase E peserta didik mampu menjelaskan perkembangan pemasaran mulai dari konvensional sampai dengan penerapan teknologi modern, industri 4.0, IoT, teknologi digital dalam pemasaran, serta isu-isu perkembangan seperti digital marketing, e-commerce, marketplace, dan media sosial.'),
  (3, 'Profil Pekerjaan dan Peluang Usaha di Bidang Pemasaran',
   'Pada akhir fase E peserta didik mampu menjelaskan profil pekerjaan dalam pemasaran (kasir, sales executive, digital marketer, public relation) dan peluang usaha (dropshipping, affiliate marketing, marketing agency), serta menentukan karir sesuai bakat dan passion.'),
  (4, 'Prosedur Kesehatan, Keselamatan, dan Keamanan (K3) di Tempat Kerja',
   'Pada akhir fase E peserta didik mampu menerapkan prosedur K3 di tempat kerja, menangani keadaan darurat, mempertahankan standar penampilan pribadi, dan memberikan umpan balik tentang K3.'),
  (5, 'Komunikasi dengan Pelanggan',
   'Pada akhir fase E peserta didik mampu berkomunikasi efektif dengan tata bahasa yang baik, menunjukkan penampilan menarik, dan menentukan teknik penjualan yang tepat sesuai konsumen dan jenis barang/jasa.'),
  (6, 'Pemasaran Barang dan Jasa',
   'Pada akhir fase E peserta didik mampu menjelaskan konsep pemasaran, menganalisis pasar, menganalisis STP marketing (Segmenting, Targeting, Positioning), membuat rencana pemasaran, dan memasarkan barang/jasa sesuai target pasar.'),
  (7, 'Perilaku Konsumen',
   'Pada akhir fase E peserta didik mampu menjelaskan faktor-faktor yang mempengaruhi perilaku konsumen, mengidentifikasi sinyal calon pelanggan, dan menentukan bahasa pemasaran yang tepat untuk mencapai kepuasan pelanggan.'),
  (8, 'Pelayanan Penjualan',
   'Pada akhir fase E peserta didik mampu memberikan pelayanan prima saat penjualan dan menggunakan peralatan yang sesuai untuk barang/jasa yang dipromosikan.'),
  (9, 'Kepuasan Pelanggan',
   'Pada akhir fase E peserta didik mampu mengukur tingkat kepuasan pelanggan dan mengatasi komplain dari pelanggan.')
) AS el(element_order, nama_elemen, deskripsi_cp)
WHERE s.code = 'PEMASARAN-DASAR' AND p.code = 'E'
ON CONFLICT (cp_id, element_order) DO UPDATE SET
  nama_elemen  = EXCLUDED.nama_elemen,
  deskripsi_cp = EXCLUDED.deskripsi_cp,
  is_active    = true;

-- ----------------------------------------------------------------
-- 7.7 BD Fase F (Bisnis Digital)
-- Sumber: guru.kemendikdasmen.go.id/…/bisnis-digital/fase-f/
-- ----------------------------------------------------------------
INSERT INTO core.cp_elements (element_id, cp_id, element_order, nama_elemen, deskripsi_cp, is_active)
SELECT gen_random_uuid(), cp.cp_id, el.element_order, el.nama_elemen, el.deskripsi_cp, true
FROM core.capaian_pembelajaran cp
JOIN core.subject_phases sp ON cp.subject_phase_id = sp.subject_phase_id
JOIN core.subjects s ON sp.subject_id = s.subject_id
JOIN core.phases   p ON sp.phase_id   = p.phase_id
CROSS JOIN (VALUES
  (1, 'Ekonomi Bisnis dan Administrasi Umum',
   'Pada akhir fase F peserta didik mampu mengidentifikasi masalah-masalah ekonomi, memahami model dan pelaku ekonomi, fungsi-fungsi manajemen, dan menerapkannya dalam pengelolaan bisnis digital.'),
  (2, 'Marketing',
   'Pada akhir fase F peserta didik mampu memahami konsep pemasaran mulai dari struktur dan bentuk pasar, strategi bauran pemasaran, menganalisis pengembangan produk, menentukan daur hidup produk (product life cycle), memperkuat branding, menetapkan harga jual, dan melakukan promosi produk.'),
  (3, 'Perencanaan Bisnis',
   'Pada akhir fase F peserta didik mampu menganalisis lingkungan bisnis dengan berbagai model analisis, merencanakan strategi bisnis, menganalisis kelayakan usaha, menyusun proposal usaha, dan mengembangkan usaha.'),
  (4, 'Komunikasi Bisnis',
   'Pada akhir fase F peserta didik mampu memahami prinsip komunikasi bisnis seperti etika bisnis, melakukan negosiasi bisnis, dan melakukan presentasi bisnis secara efektif.'),
  (5, 'Digital Branding',
   'Pada akhir fase F peserta didik mampu memahami ruang lingkup digital branding, membuat logo secara online, melakukan produksi konten digital, melakukan foto produk, melakukan video produk, dan mengaplikasikan manajemen publikasi konten.'),
  (6, 'Digital Onboarding',
   'Pada akhir fase F peserta didik mampu mengaktifkan penjualan melalui media sosial, website, marketplace, dan online retail.'),
  (7, 'Digital Marketing',
   'Pada akhir fase F peserta didik mampu melakukan analisis data digital, mengaplikasikan Google Business Profile, menerapkan SEO (Search Engine Optimization), menerapkan SEM (Search Engine Marketing), dan strategi promosi digital lainnya.'),
  (8, 'Digital Operation',
   'Pada akhir fase F peserta didik mampu melakukan inventori, mengaplikasikan customer relationship management, melakukan pengiriman barang, dan mengelola operasional bisnis digital secara menyeluruh.')
) AS el(element_order, nama_elemen, deskripsi_cp)
WHERE s.code = 'BD' AND p.code = 'F'
ON CONFLICT (cp_id, element_order) DO UPDATE SET
  nama_elemen  = EXCLUDED.nama_elemen,
  deskripsi_cp = EXCLUDED.deskripsi_cp,
  is_active    = true;

-- ----------------------------------------------------------------
-- 7.8 ELEKTRONIKA-DASAR Fase E (Dasar-dasar Teknik Elektronika)
-- Sumber: guru.kemendikdasmen.go.id/…/dasar-dasar-teknik-elektronika/fase-e/
-- ----------------------------------------------------------------
INSERT INTO core.cp_elements (element_id, cp_id, element_order, nama_elemen, deskripsi_cp, is_active)
SELECT gen_random_uuid(), cp.cp_id, el.element_order, el.nama_elemen, el.deskripsi_cp, true
FROM core.capaian_pembelajaran cp
JOIN core.subject_phases sp ON cp.subject_phase_id = sp.subject_phase_id
JOIN core.subjects s ON sp.subject_id = s.subject_id
JOIN core.phases   p ON sp.phase_id   = p.phase_id
CROSS JOIN (VALUES
  (1, 'Proses Bisnis Manufaktur dan Rekayasa Elektronika',
   'Pada akhir fase E peserta didik mampu memahami proses bisnis bidang manufaktur dan rekayasa elektronika secara menyeluruh mencakup perancangan produk, rantai pasok, logistik, produksi, perawatan peralatan, dan manajemen SDM dengan mempertimbangkan potensi lokal.'),
  (2, 'Perkembangan Teknologi dan Isu Global Industri Elektronika',
   'Pada akhir fase E peserta didik mampu memahami perkembangan proses produksi bidang elektronika mulai dari teknologi konvensional sampai dengan teknologi modern, Industri 4.0, termasuk digitalisasi, siklus produk, dan isu lingkungan serta ketenagakerjaan.'),
  (3, 'Profesi, Kewirausahaan, dan Peluang Usaha di Bidang Elektronika',
   'Pada akhir fase E peserta didik mampu memahami profesi dan kewirausahaan di bidang elektronika (job-profile dan technopreneurship) melalui pembelajaran berbasis proyek nyata sebagai simulasi kewirausahaan.'),
  (4, 'Teknik Dasar Proses Produksi Elektronika',
   'Pada akhir fase E peserta didik mampu mengenal dan mempraktikkan teknik soldering-desoldering, pengukuran elektronika, karakteristik komponen, dan mesin-mesin listrik.'),
  (5, 'Keselamatan dan Kesehatan Kerja Lingkungan Hidup (K3LH) dan Budaya Kerja Industri',
   'Pada akhir fase E peserta didik mampu menerapkan keselamatan kerja mencakup praktik-praktik kerja yang aman dan budaya 5R (Ringkas, Rapi, Resik, Rawat, Rajin).'),
  (6, 'Penggunaan Perkakas Tangan',
   'Pada akhir fase E peserta didik mampu memahami jenis, penggunaan, dan pemeliharaan perkakas tangan untuk pekerjaan elektronika.'),
  (7, 'Gambar Teknik Elektronika',
   'Pada akhir fase E peserta didik mampu menggambar teknik listrik dan elektronika dengan pengenalan simbol komponen serta peralatan gambar.'),
  (8, 'Alat Ukur Listrik, Elektronika, dan Instrumentasi',
   'Pada akhir fase E peserta didik mampu memahami jenis alat ukur, cara penggunaan, interpretasi hasil, dan perawatan alat ukur listrik, elektronika, dan instrumentasi.'),
  (9, 'Komponen Elektronika Aktif dan Pasif',
   'Pada akhir fase E peserta didik mampu mengenal komponen elektronika, membaca nilai komponen sesuai kodenya, dan memahami hukum dasar elektronika (Ohm, Kirchhoff).'),
  (10, 'Mesin-Mesin Listrik, Elektronika, dan Instrumentasi',
   'Pada akhir fase E peserta didik mampu memahami mesin-mesin listrik, peralatan elektronika, dan instrumentasi beserta komponen-komponennya.'),
  (11, 'Konsep Dasar Kelistrikan dan Elektronika Digital',
   'Pada akhir fase E peserta didik mampu menguasai sistem bilangan, Aljabar Boole, teknik dasar listrik, dan teknik analog-digital dengan rangkaian aplikasi dasar serta elektronika optik.')
) AS el(element_order, nama_elemen, deskripsi_cp)
WHERE s.code = 'ELEKTRONIKA-DASAR' AND p.code = 'E'
ON CONFLICT (cp_id, element_order) DO UPDATE SET
  nama_elemen  = EXCLUDED.nama_elemen,
  deskripsi_cp = EXCLUDED.deskripsi_cp,
  is_active    = true;

-- ----------------------------------------------------------------
-- 7.9 TEI Fase F (Teknik Elektronika Industri)
-- Sumber: guru.kemendikdasmen.go.id/…/teknik-elektronika-industri/fase-f/
-- ----------------------------------------------------------------
INSERT INTO core.cp_elements (element_id, cp_id, element_order, nama_elemen, deskripsi_cp, is_active)
SELECT gen_random_uuid(), cp.cp_id, el.element_order, el.nama_elemen, el.deskripsi_cp, true
FROM core.capaian_pembelajaran cp
JOIN core.subject_phases sp ON cp.subject_phase_id = sp.subject_phase_id
JOIN core.subjects s ON sp.subject_id = s.subject_id
JOIN core.phases   p ON sp.phase_id   = p.phase_id
CROSS JOIN (VALUES
  (1, 'Penerapan Rangkaian Elektronika',
   'Pada akhir fase F peserta didik mampu menganalisis penguat diferensial, mengevaluasi penguat operasional, membandingkan rangkaian ADC dan DAC, menerapkan filter aktif, generator gelombang, rangkaian digital, elektronika daya, catu daya, dan sumber energi terbarukan.'),
  (2, 'Sistem Kendali Elektronik',
   'Pada akhir fase F peserta didik mampu menjabarkan konsep sistem pengendali, mengevaluasi rangkaian kendali analog, menerapkan rangkaian isolasi, menerapkan solid state relay, dan mengevaluasi rangkaian kendali digital.'),
  (3, 'Pemrograman Sistem Embedded',
   'Pada akhir fase F peserta didik mampu mengevaluasi arsitektur sistem embedded, merancang sistem minimum, menerapkan bahasa pemrograman, mengoperasikan compiler dan simulator, serta memprogram digital/analog I/O dan komunikasi serial.'),
  (4, 'Antarmuka dan Komunikasi Data',
   'Pada akhir fase F peserta didik mampu menerapkan software Object Oriented Programming (OOP), menerapkan antarmuka, menerapkan komunikasi data, menerapkan data logging, dan memanfaatkan Internet of Things (IoT).'),
  (5, 'Sistem Kendali Industri',
   'Pada akhir fase F peserta didik mampu menerapkan logika relay, menjabarkan Programmable Logic Controller (PLC), menerapkan wiring dan commissioning, mengoperasikan HMI, komponen elektro-pneumatik/hidrolik, proses produksi, dan sistem jaringan PLC.'),
  (6, 'Pemeliharaan dan Perbaikan Peralatan Elektronika Industri',
   'Pada akhir fase F peserta didik mampu melaksanakan prosedur pemeliharaan, dokumentasi, protokol pengujian, dan melakukan soldering/desoldering komponen Surface Mounted Devices (SMD).')
) AS el(element_order, nama_elemen, deskripsi_cp)
WHERE s.code = 'TEI' AND p.code = 'F'
ON CONFLICT (cp_id, element_order) DO UPDATE SET
  nama_elemen  = EXCLUDED.nama_elemen,
  deskripsi_cp = EXCLUDED.deskripsi_cp,
  is_active    = true;

-- ----------------------------------------------------------------
-- 7.10 LOGISTIK-DASAR Fase E (Dasar-dasar Teknik Logistik)
-- Sumber: guru.kemendikdasmen.go.id/…/dasar-dasar-teknik-logistik/fase-e/
-- ----------------------------------------------------------------
INSERT INTO core.cp_elements (element_id, cp_id, element_order, nama_elemen, deskripsi_cp, is_active)
SELECT gen_random_uuid(), cp.cp_id, el.element_order, el.nama_elemen, el.deskripsi_cp, true
FROM core.capaian_pembelajaran cp
JOIN core.subject_phases sp ON cp.subject_phase_id = sp.subject_phase_id
JOIN core.subjects s ON sp.subject_id = s.subject_id
JOIN core.phases   p ON sp.phase_id   = p.phase_id
CROSS JOIN (VALUES
  (1, 'Proses Bisnis Bidang Teknik Logistik',
   'Pada akhir fase E peserta didik mampu memahami proses bisnis bidang teknik logistik secara menyeluruh mencakup perbaikan lingkungan kerja, kegiatan administratif, pelayanan pelanggan, pengelolaan pergudangan, dan teknik distribusi.'),
  (2, 'Perkembangan Industri dan Isu Global di Bidang Logistik',
   'Pada akhir fase E peserta didik mampu menganalisis isu-isu global terkait sistem logistik dan teknik industri, antara lain komputerisasi, komunikasi dan pengendalian jarak jauh, dan robotisasi pergudangan.'),
  (3, 'Profesi dan Kewirausahaan di Bidang Logistik',
   'Pada akhir fase E peserta didik mampu menjelaskan dan mengeksplorasi profesi di bidang logistik seperti scheduler, petugas PPIC, jasa pengiriman paket, forwarder melalui pembelajaran berbasis proyek.'),
  (4, 'Keselamatan dan Kesehatan Kerja (K3LH) dan Budaya Kerja Industri',
   'Pada akhir fase E peserta didik mampu menerapkan K3LH dan budaya kerja industri serta praktik 5R (Ringkas, Rapi, Resik, Rawat, Rajin).'),
  (5, 'Operasional Logistik',
   'Pada akhir fase E peserta didik mampu menerapkan proses operasional logistik pada berbagai sektor manufaktur dan jasa.'),
  (6, 'Administrasi Dokumen Logistik',
   'Pada akhir fase E peserta didik mampu mengelola administrasi dokumen dan administrasi operasional pengadaan barang/jasa.'),
  (7, 'Pelayanan Pelanggan',
   'Pada akhir fase E peserta didik mampu memberikan pelayanan pelanggan secara prima sesuai standar industri logistik.'),
  (8, 'Pergudangan dan Manajemen Fasilitas',
   'Pada akhir fase E peserta didik mampu mengelola penerimaan barang, penyimpanan, dan proses pengeluaran barang beserta peralatan dan fasilitas gudang.'),
  (9, 'Teknik Distribusi',
   'Pada akhir fase E peserta didik mampu menerapkan teknik distribusi meliputi pengumpulan, pemrosesan, pengepakan, transportasi, dan pengantaran barang.')
) AS el(element_order, nama_elemen, deskripsi_cp)
WHERE s.code = 'LOGISTIK-DASAR' AND p.code = 'E'
ON CONFLICT (cp_id, element_order) DO UPDATE SET
  nama_elemen  = EXCLUDED.nama_elemen,
  deskripsi_cp = EXCLUDED.deskripsi_cp,
  is_active    = true;

-- ----------------------------------------------------------------
-- 7.11 KK-LOG Fase F (Teknik Logistik)
-- Sumber: guru.kemendikdasmen.go.id/…/teknik-logistik/fase-f/
-- ----------------------------------------------------------------
INSERT INTO core.cp_elements (element_id, cp_id, element_order, nama_elemen, deskripsi_cp, is_active)
SELECT gen_random_uuid(), cp.cp_id, el.element_order, el.nama_elemen, el.deskripsi_cp, true
FROM core.capaian_pembelajaran cp
JOIN core.subject_phases sp ON cp.subject_phase_id = sp.subject_phase_id
JOIN core.subjects s ON sp.subject_id = s.subject_id
JOIN core.phases   p ON sp.phase_id   = p.phase_id
CROSS JOIN (VALUES
  (1, 'Pengadaan (Procurement)',
   'Pada akhir fase F peserta didik mampu memahami perencanaan pengadaan barang/jasa, melakukan negosiasi, membuat dan menyusun dokumen kontrak, melakukan pemilihan penyedia barang/jasa, dan melaksanakan pengadaan barang/jasa.'),
  (2, 'Aktivitas Pergudangan',
   'Pada akhir fase F peserta didik mampu memahami prosedur penanganan barang masuk, melakukan penyimpanan barang, memproses pengeluaran barang, mengelola peralatan dan fasilitas gudang, persediaan barang, dan sistem informasi gudang.'),
  (3, 'Pengemasan Barang (Packing)',
   'Pada akhir fase F peserta didik mampu memahami jenis-jenis dan teknik pengemasan barang sesuai standar industri logistik.'),
  (4, 'Teknik Pengiriman Barang',
   'Pada akhir fase F peserta didik mampu memahami dan mempraktikkan teknik pengiriman barang (collecting, processing, transporting, delivery), penentuan rute, pemilihan moda transportasi, dan pengurusan dokumen pengiriman barang.'),
  (5, 'Sistem Informasi Logistik',
   'Pada akhir fase F peserta didik mampu memahami pengetahuan, keterampilan, dan sikap kerja yang diperlukan dalam pengoperasian sistem informasi logistik dan aplikasi yang relevan.'),
  (6, 'Perdagangan Internasional',
   'Pada akhir fase F peserta didik mampu memahami dasar-dasar perdagangan internasional termasuk regulasi, dokumen, dan prosedur ekspor-impor.')
) AS el(element_order, nama_elemen, deskripsi_cp)
WHERE s.code = 'KK-LOG' AND p.code = 'F'
ON CONFLICT (cp_id, element_order) DO UPDATE SET
  nama_elemen  = EXCLUDED.nama_elemen,
  deskripsi_cp = EXCLUDED.deskripsi_cp,
  is_active    = true;

-- ----------------------------------------------------------------
-- 7.12 BROADCASTING-DASAR Fase E (Dasar-dasar Broadcasting dan Perfilman)
-- Sumber: guru.kemendikdasmen.go.id/…/dasar-dasar-broadcasting-dan-perfilman/fase-e/
-- ----------------------------------------------------------------
INSERT INTO core.cp_elements (element_id, cp_id, element_order, nama_elemen, deskripsi_cp, is_active)
SELECT gen_random_uuid(), cp.cp_id, el.element_order, el.nama_elemen, el.deskripsi_cp, true
FROM core.capaian_pembelajaran cp
JOIN core.subject_phases sp ON cp.subject_phase_id = sp.subject_phase_id
JOIN core.subjects s ON sp.subject_id = s.subject_id
JOIN core.phases   p ON sp.phase_id   = p.phase_id
CROSS JOIN (VALUES
  (1, 'Profesi dan Proses Bisnis Industri Broadcasting dan Perfilman',
   'Pada akhir fase E peserta didik mampu memahami jalur karir, level jabatan, SOP, dan pemeliharaan peralatan di sektor broadcasting dan perfilman.'),
  (2, 'Perkembangan Teknologi dan Isu Global Broadcasting dan Perfilman',
   'Pada akhir fase E peserta didik mampu memahami perkembangan proses produksi industri broadcasting dan perfilman dari media analog sampai dengan media digital, termasuk platform baru seperti podcast dan layanan streaming.'),
  (3, 'K3LH dalam Produksi Broadcasting dan Perfilman',
   'Pada akhir fase E peserta didik mampu memahami pengenalan standar K3LH dalam proses produksi Program Radio, Televisi, dan Film.'),
  (4, 'Profil Technopreneur di Bidang Broadcasting dan Perfilman',
   'Pada akhir fase E peserta didik mampu mengidentifikasi peluang pasar dan jalur kewirausahaan di industri produksi media.'),
  (5, 'Prototipe Produksi Radio, Televisi, dan Film',
   'Pada akhir fase E peserta didik mampu memahami proses produksi radio, televisi, dan film secara kreatif dan inovatif.'),
  (6, 'Teknik Dasar Produksi Broadcasting dan Perfilman',
   'Pada akhir fase E peserta didik mampu memahami alur kerja industri melalui simulasi produksi dasar.'),
  (7, 'Peralatan Audio-Visual',
   'Pada akhir fase E peserta didik mampu memahami dan mengoperasikan mikrofon, kamera, serta mengidentifikasi dan menggunakan peralatan produksi audio-visual.'),
  (8, 'Media Digital',
   'Pada akhir fase E peserta didik mampu memahami format digital, jenis file, kompresi, dan regulasi penyiaran digital.'),
  (9, 'Sinematografi dan Desain',
   'Pada akhir fase E peserta didik mampu memahami dasar fotografi, pengambilan gambar, desain artistik, dan tata suara dalam produksi media.'),
  (10, 'Dasar Penyuntingan (Editing)',
   'Pada akhir fase E peserta didik mampu memahami sifat dan karakteristik audio dan video sebagai bahan digital untuk pengolahan dengan perangkat lunak editing.'),
  (11, 'Estetika Audio-Visual',
   'Pada akhir fase E peserta didik mampu mengapresiasi seni auditif dan visual sebagai landasan estetika dalam produksi broadcasting dan perfilman.')
) AS el(element_order, nama_elemen, deskripsi_cp)
WHERE s.code = 'BROADCASTING-DASAR' AND p.code = 'E'
ON CONFLICT (cp_id, element_order) DO UPDATE SET
  nama_elemen  = EXCLUDED.nama_elemen,
  deskripsi_cp = EXCLUDED.deskripsi_cp,
  is_active    = true;

-- ----------------------------------------------------------------
-- 7.13 KK-PSPT Fase F (Produksi dan Siaran Program Televisi)
-- Sumber: guru.kemendikdasmen.go.id/…/produksi-dan-siaran-program-televisi/fase-f/
-- Satu salinan — terhubung ke konsentrasi KK-PSPT di bawah program BRD.
-- ----------------------------------------------------------------
INSERT INTO core.cp_elements (element_id, cp_id, element_order, nama_elemen, deskripsi_cp, is_active)
SELECT gen_random_uuid(), cp.cp_id, el.element_order, el.nama_elemen, el.deskripsi_cp, true
FROM core.capaian_pembelajaran cp
JOIN core.subject_phases sp ON cp.subject_phase_id = sp.subject_phase_id
JOIN core.subjects s ON sp.subject_id = s.subject_id
JOIN core.phases   p ON sp.phase_id   = p.phase_id
CROSS JOIN (VALUES
  (1, 'Manajemen Produksi dan Siaran Program Televisi',
   'Pada akhir fase F peserta didik mampu memahami prosedur kerja dalam tahapan produksi, organisasi penyiaran televisi, dan sumber daya produksi, merancang siaran kreatif, mengidentifikasi target audiens, menerapkan desain produksi, dan mengelola siaran menggunakan Standar Operasional Prosedur (SOP).'),
  (2, 'Penulisan Naskah Televisi',
   'Pada akhir fase F peserta didik mampu memahami prosedur penulisan naskah untuk siaran jurnalistik (berita, live casting, podcast, vlog) dan format artistik (program drama dan non-drama, VOD) sesuai standar industri dan budaya kerja profesional.'),
  (3, 'Penyutradaraan Televisi',
   'Pada akhir fase F peserta didik mampu memahami peran dan tanggung jawab sutradara, aspek teknis, komunikasi verbal/non-verbal, analisis naskah, serta prosedur produksi kamera tunggal dan multi-kamera dengan standar profesional.'),
  (4, 'Tata Kamera dan Tata Cahaya Televisi',
   'Pada akhir fase F peserta didik mampu menganalisis fungsi departemen kamera, prosedur pra/produksi/pasca-produksi, pengoperasian kamera, perencanaan lensa, framing, komposisi, pergerakan, serta pengoperasian dan teknik peralatan pencahayaan.'),
  (5, 'Tata Suara Televisi',
   'Pada akhir fase F peserta didik mampu memahami peran departemen suara, prosedur pra/produksi/pasca-produksi, analisis naskah untuk suara, pengoperasian recorder, penempatan mikrofon, prosedur perekaman suara, dan pengorganisasian data audio.'),
  (6, 'Tata Artistik Televisi',
   'Pada akhir fase F peserta didik mampu menguasai fungsi departemen artistik dan proses breakdown naskah, membuat desain set, floor plan, sketsa, gambar perspektif, serta mengkoordinasikan dekor, properti, kostum, dan riasan.'),
  (7, 'Editing Audio dan Video',
   'Pada akhir fase F peserta didik mampu menganalisis peran editor dan prosedur editing, mengidentifikasi dokumen syuting, manajemen file, dan teknologi editing audio-visual dengan standar profesional.'),
  (8, 'Penyiaran Online',
   'Pada akhir fase F peserta didik mampu melaksanakan siaran online secara mandiri maupun kolaboratif, memahami konsep konten digital untuk televisi FTA/OTT, memanfaatkan fitur aplikasi streaming, mengunggah konten, membuat materi promosi, dan menganalisis keterlibatan audiens.')
) AS el(element_order, nama_elemen, deskripsi_cp)
WHERE s.code = 'KK-PSPT' AND p.code = 'F'
ON CONFLICT (cp_id, element_order) DO UPDATE SET
  nama_elemen  = EXCLUDED.nama_elemen,
  deskripsi_cp = EXCLUDED.deskripsi_cp,
  is_active    = true;

-- ----------------------------------------------------------------
-- 7.14 BUSANA-DASAR Fase E (Dasar-dasar Busana)
-- Sumber: guru.kemendikdasmen.go.id/…/dasar-dasar-busana/fase-e/
-- ----------------------------------------------------------------
INSERT INTO core.cp_elements (element_id, cp_id, element_order, nama_elemen, deskripsi_cp, is_active)
SELECT gen_random_uuid(), cp.cp_id, el.element_order, el.nama_elemen, el.deskripsi_cp, true
FROM core.capaian_pembelajaran cp
JOIN core.subject_phases sp ON cp.subject_phase_id = sp.subject_phase_id
JOIN core.subjects s ON sp.subject_id = s.subject_id
JOIN core.phases   p ON sp.phase_id   = p.phase_id
CROSS JOIN (VALUES
  (1, 'Profil Technopreneur, Peluang Usaha, dan Pekerjaan/Profesi di Bidang Busana',
   'Pada akhir fase E peserta didik mampu memahami profil Technopreneur, mendeskripsikan pekerjaan atau profesi bidang busana (fesyen), menjelaskan kepribadian dan sikap dalam bekerja, serta membaca peluang pasar melalui pembelajaran berbasis proyek kewirausahaan.'),
  (2, 'Dunia Industri dan Perkembangan Mode (DIPM)',
   'Pada akhir fase E peserta didik mampu mendeskripsikan ekosistem industri mode, memahami model bisnis fashion, perubahan gaya tren, karya desainer, serta memahami konsep sustainable fashion dan potensi lokal.'),
  (3, 'Dasar Branding dan Marketing (DBM)',
   'Pada akhir fase E peserta didik mampu memahami branding dan marketing, menjelaskan segmentasi pasar, DNA brand, analisis pesaing, serta konsep marketing dan digital marketing.'),
  (4, 'Menggambar Mode (MM)',
   'Pada akhir fase E peserta didik mampu menerapkan dan membuat gambar anatomi tubuh, mencampur warna, implementasi desain ke anatomi tubuh, dan membuat desain teknis secara digital.'),
  (5, 'Dasar Fashion Design (DFD)',
   'Pada akhir fase E peserta didik mampu memahami proses penciptaan desain dengan menerapkan dasar-dasar desain, membedakan style dan look, mencari inspirasi, membuat kolase, dan mengembangkan desain.'),
  (6, 'Proses Produksi Busana',
   'Pada akhir fase E peserta didik mampu memahami K3 di bidang busana (fesyen), proses produksi busana di industri, pengetahuan tentang aspek perawatan peralatan, dan pengelolaan SDM di industri.'),
  (7, 'Perkembangan Teknologi di Industri Busana',
   'Pada akhir fase E peserta didik mampu memahami perkembangan proses produksi pada industri busana (fesyen) mulai dari konvensional hingga penggunaan alat/mesin dengan teknologi modern, teknologi digital, isu global, dan Product Life Cycle.'),
  (8, 'Dasar Pola (DP)',
   'Pada akhir fase E peserta didik mampu memahami dan melakukan pengukuran tubuh, serta menerapkan pembuatan pola dasar teknik konstruksi.'),
  (9, 'Teknik Dasar Menjahit (TDM)',
   'Pada akhir fase E peserta didik mampu menjelaskan sikap kerja, mengoperasikan dan memperbaiki mesin jahit, memahami teknik menjahit sesuai bahan, standar kualitas finishing, dan menjahit busana sederhana.')
) AS el(element_order, nama_elemen, deskripsi_cp)
WHERE s.code = 'BUSANA-DASAR' AND p.code = 'E'
ON CONFLICT (cp_id, element_order) DO UPDATE SET
  nama_elemen  = EXCLUDED.nama_elemen,
  deskripsi_cp = EXCLUDED.deskripsi_cp,
  is_active    = true;

-- ----------------------------------------------------------------
-- 7.15 KK-DPB Fase F (Desain dan Produksi Busana)
-- Sumber: guru.kemendikdasmen.go.id/…/desain-dan-produksi-busana/fase-f/
-- ----------------------------------------------------------------
INSERT INTO core.cp_elements (element_id, cp_id, element_order, nama_elemen, deskripsi_cp, is_active)
SELECT gen_random_uuid(), cp.cp_id, el.element_order, el.nama_elemen, el.deskripsi_cp, true
FROM core.capaian_pembelajaran cp
JOIN core.subject_phases sp ON cp.subject_phase_id = sp.subject_phase_id
JOIN core.subjects s ON sp.subject_id = s.subject_id
JOIN core.phases   p ON sp.phase_id   = p.phase_id
CROSS JOIN (VALUES
  (1, 'Gambar Mode',
   'Pada akhir fase F peserta didik mampu membuat figure sesuai jenis kelamin dan umur, mengembangkan figure dengan gaya dan gerakan tubuh (gesture), serta menerapkan figure berpakaian.'),
  (2, 'Gambar Teknis (Technical Drawing)',
   'Pada akhir fase F peserta didik mampu menggambar datar (flat drawing) secara digital dan manual sesuai dengan proporsi dan detail rancangan tampak depan dan belakang untuk kebutuhan produksi.'),
  (3, 'Gaya dan Pengembangan Desain',
   'Pada akhir fase F peserta didik mampu mengungkapkan karya dan mengembangkan desain dalam satu konsep gaya, menerapkan trend, menerapkan sustainable fashion, membuat tema desain busana sesuai yang disepakati, baik berupa desain busana berbasis kreasi, industri, maupun custom made.'),
  (4, 'Eksperimen Tekstil dan Desain Hiasan',
   'Pada akhir fase F peserta didik mampu mengembangkan desain dan olah tekstil yang disesuaikan dengan kebutuhan industri dan kebudayaan daerah, membuat desain hiasan (renda, sulaman, kancing hias, bordir).'),
  (5, 'Persiapan Pembuatan Busana',
   'Pada akhir fase F peserta didik mampu menyiapkan pembuatan busana yang meliputi pembuatan lembar kerja sesuai spesifikasi desain, membuat langkah kerja produksi, mengambil ukuran, membuat pola, memotong bahan, menghitung biaya, dan menentukan harga produk.'),
  (6, 'Menjahit Produk Busana',
   'Pada akhir fase F peserta didik mampu menjahit sesuai dengan prosedur, trimming, pressing, dan mengawasi mutu produk busana, serta melaksanakan penyelesaian akhir busana.'),
  (7, 'Penyusunan Koleksi Busana',
   'Pada akhir fase F peserta didik mampu merencanakan projek pembuatan koleksi busana secara kelompok dan melakukan presentasi koleksi secara kelompok.')
) AS el(element_order, nama_elemen, deskripsi_cp)
WHERE s.code = 'KK-DPB' AND p.code = 'F'
ON CONFLICT (cp_id, element_order) DO UPDATE SET
  nama_elemen  = EXCLUDED.nama_elemen,
  deskripsi_cp = EXCLUDED.deskripsi_cp,
  is_active    = true;

-- ----------------------------------------------------------------
-- 7.16 SPERTUNJUKAN-DASAR Fase E (Dasar-dasar Seni Pertunjukan)
-- Sumber: guru.kemendikdasmen.go.id/…/dasar-dasar-seni-pertunjukan/fase-e/
-- ----------------------------------------------------------------
INSERT INTO core.cp_elements (element_id, cp_id, element_order, nama_elemen, deskripsi_cp, is_active)
SELECT gen_random_uuid(), cp.cp_id, el.element_order, el.nama_elemen, el.deskripsi_cp, true
FROM core.capaian_pembelajaran cp
JOIN core.subject_phases sp ON cp.subject_phase_id = sp.subject_phase_id
JOIN core.subjects s ON sp.subject_id = s.subject_id
JOIN core.phases   p ON sp.phase_id   = p.phase_id
CROSS JOIN (VALUES
  (1, 'Profil Entrepreneur dan Peluang Usaha di Bidang Seni Pertunjukan',
   'Pada akhir fase E peserta didik mampu memahami lingkup pekerjaan atau profesi dalam bidang seni pertunjukan, peluang usaha di bidang seni dan ekonomi kreatif untuk membangun visi dan passion melalui pembelajaran berbasis proyek nyata.'),
  (2, 'Proses Bisnis di Industri Seni Pertunjukan',
   'Pada akhir fase E peserta didik mampu memahami K3 dan 5R dalam aspek perawatan peralatan, alur kerja industri seni pertunjukan, kepribadian yang diperlukan, dan pengelolaan SDM sesuai potensi lokal.'),
  (3, 'Perkembangan Teknologi dan Isu Global di Bidang Seni Pertunjukan',
   'Pada akhir fase E peserta didik mampu memahami perkembangan teknologi dan isu global dalam seni pertunjukan termasuk aplikasi kreasi digital, platform marketplace online, penerapan Industri 4.0, dan IoT.'),
  (4, 'Konsep dan Wawasan Seni Pertunjukan',
   'Pada akhir fase E peserta didik mampu memahami pengetahuan dan wawasan tentang unsur-unsur dalam seni pertunjukan termasuk sejarah, fungsi, jenis, cabang, ciri, estetika, dan apresiasi melalui kajian interdisipliner.'),
  (5, 'Dasar-Dasar Produksi Seni Pertunjukan',
   'Pada akhir fase E peserta didik mampu memahami dasar-dasar produksi bidang seni pertunjukan mencakup pengembangan konten, produksi pertunjukan, dan penyajian seni pertunjukan.'),
  (6, 'Sarana dan Perlengkapan Pementasan',
   'Pada akhir fase E peserta didik mampu memahami kebutuhan sarana dan perlengkapan pementasan seni pertunjukan meliputi tata panggung, tata rias, tata busana, tata cahaya, dan tata suara.'),
  (7, 'Teknik Dasar Seni Pertunjukan',
   'Pada akhir fase E peserta didik mampu memahami teknik dasar seni pertunjukan secara komprehensif meliputi sikap, pengetahuan, dan keterampilan dasar yang terdiri dari teknik, etude, repertoar sesuai dengan keahlian yang dipilih.')
) AS el(element_order, nama_elemen, deskripsi_cp)
WHERE s.code = 'SPERTUNJUKAN-DASAR' AND p.code = 'E'
ON CONFLICT (cp_id, element_order) DO UPDATE SET
  nama_elemen  = EXCLUDED.nama_elemen,
  deskripsi_cp = EXCLUDED.deskripsi_cp,
  is_active    = true;

-- ----------------------------------------------------------------
-- 7.17 KK-SENI-TARI Fase F (Seni Tari)
-- Sumber: guru.kemendikdasmen.go.id/…/seni-tari/fase-f/
-- ----------------------------------------------------------------
INSERT INTO core.cp_elements (element_id, cp_id, element_order, nama_elemen, deskripsi_cp, is_active)
SELECT gen_random_uuid(), cp.cp_id, el.element_order, el.nama_elemen, el.deskripsi_cp, true
FROM core.capaian_pembelajaran cp
JOIN core.subject_phases sp ON cp.subject_phase_id = sp.subject_phase_id
JOIN core.subjects s ON sp.subject_id = s.subject_id
JOIN core.phases   p ON sp.phase_id   = p.phase_id
CROSS JOIN (VALUES
  (1, 'Gerak Dasar Tari',
   'Pada akhir fase F peserta didik mampu menguasai teknik ketubuhan, menguasai irama, serta mampu menampilkan karakter tari dengan benar dan jelas secara estetika seni tari.'),
  (2, 'Tari Tradisi',
   'Pada akhir fase F peserta didik mampu menguasai teknik tari tradisi, menyajikan tari secara profesional, dan mengimplementasikan gerak dasar tari ke dalam susunan tari yang mengikini sesuai kebutuhan pasar.'),
  (3, 'Tari Kreasi',
   'Pada akhir fase F peserta didik mampu menguasai teknik ragam Tari Kreasi, menyajikan ragam Tari Kreasi, serta mempunyai kemampuan dan wawasan kepenarian yang luas tentang keragaman tari tradisi dan Tari Kreasi.')
) AS el(element_order, nama_elemen, deskripsi_cp)
WHERE s.code = 'KK-SENI-TARI' AND p.code = 'F'
ON CONFLICT (cp_id, element_order) DO UPDATE SET
  nama_elemen  = EXCLUDED.nama_elemen,
  deskripsi_cp = EXCLUDED.deskripsi_cp,
  is_active    = true;
