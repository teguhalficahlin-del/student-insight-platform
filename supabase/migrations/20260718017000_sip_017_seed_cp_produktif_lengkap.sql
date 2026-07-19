-- SIP Sprint 1 — 017: Seed CP Lengkap 10 Prodi SMKN 1 Ujungbatu dari SK BSKAP 046/H/KR/2025
-- Sumber: SK BSKAP No. 046/H/KR/2025 (PDF resmi, diekstrak via PyMuPDF)
-- Cakupan: TJKT DD+TKJ+TJAT | Otomotif DD+TKRO+TBSM | Pemasaran DD+BD+BR
--          Elektronika DD+TEI | Broadcasting DD+PSPT | Busana DD+DPB
--          Seni Pertunjukan DD+Tari+Teater | Logistik DD+KK-LOG | AKL DD+KK-AKL
--
-- Idempotent: ON CONFLICT ... DO UPDATE / DO NOTHING
-- WAJIB konfirmasi user sebelum apply ke DB live (CLAUDE.md Rule 1)

-- ============================================================
-- STEP 1: Program baru — AKL (Akuntansi dan Keuangan Lembaga)
-- ============================================================
INSERT INTO core.vocational_programs (program_id, field_id, code, name, name_short, is_active)
VALUES (
  '00000000-0000-0000-0004-000000000009',
  '00000000-0000-0000-0003-000000000003',
  'AKL', 'Akuntansi dan Keuangan Lembaga', 'AKL', true
)
ON CONFLICT (code) DO UPDATE SET
  name       = EXCLUDED.name,
  name_short = EXCLUDED.name_short,
  is_active  = EXCLUDED.is_active;

-- ============================================================
-- STEP 2: Konsentrasi baru — KK-AKL
-- ============================================================
INSERT INTO core.vocational_concentrations
  (concentration_id, program_id, code, name, is_active)
VALUES (
  '00000000-0000-0000-0005-000000000015',
  '00000000-0000-0000-0004-000000000009',
  'KK-AKL', 'Akuntansi dan Keuangan Lembaga', true
)
ON CONFLICT (code) DO UPDATE SET
  name      = EXCLUDED.name,
  is_active = EXCLUDED.is_active;

-- ============================================================
-- STEP 3: Subjects baru (KK-TJAT, BR, KK-SENI-TEATER, AKL-DASAR, KK-AKL)
-- ============================================================
INSERT INTO core.subjects
  (subject_id, code, name, subject_type, concentration_id, program_id, is_generatable, is_active)
VALUES
  ('00000000-0000-0000-0012-000000000012', 'KK-TJAT',
   'Teknik Jaringan Akses Telekomunikasi', 'KEJURUAN_KONSENTRASI',
   '00000000-0000-0000-0005-000000000002', NULL, true, true),
  ('00000000-0000-0000-0012-000000000013', 'BR',
   'Bisnis Retail', 'KEJURUAN_KONSENTRASI',
   '00000000-0000-0000-0005-000000000006', NULL, true, true),
  ('00000000-0000-0000-0012-000000000014', 'KK-SENI-TEATER',
   'Tata Artistik Teater', 'KEJURUAN_KONSENTRASI',
   '00000000-0000-0000-0005-000000000014', NULL, true, true),
  ('00000000-0000-0000-0011-000000000009', 'AKL-DASAR',
   'Dasar-Dasar Akuntansi dan Keuangan Lembaga', 'KEJURUAN_DASAR',
   NULL, '00000000-0000-0000-0004-000000000009', true, true),
  ('00000000-0000-0000-0012-000000000011', 'KK-AKL',
   'Akuntansi dan Keuangan Lembaga', 'KEJURUAN_KONSENTRASI',
   '00000000-0000-0000-0005-000000000015', NULL, true, true)
ON CONFLICT (code) DO UPDATE SET
  name           = EXCLUDED.name,
  subject_type   = EXCLUDED.subject_type,
  is_generatable = EXCLUDED.is_generatable,
  is_active      = EXCLUDED.is_active;

-- ============================================================
-- STEP 4: Subject phases untuk subjek baru
-- ============================================================
INSERT INTO core.subject_phases (subject_id, phase_id, version_id)
SELECT s.subject_id,
       '00000000-0000-0000-0002-000000000001',
       '00000000-0000-0000-0000-000000000001'
FROM core.subjects s
WHERE s.code IN ('AKL-DASAR')
ON CONFLICT (subject_id, phase_id, version_id) DO NOTHING;

INSERT INTO core.subject_phases (subject_id, phase_id, version_id)
SELECT s.subject_id,
       '00000000-0000-0000-0002-000000000002',
       '00000000-0000-0000-0000-000000000001'
FROM core.subjects s
WHERE s.code IN ('KK-TJAT', 'BR', 'KK-SENI-TEATER', 'KK-AKL')
ON CONFLICT (subject_id, phase_id, version_id) DO NOTHING;

-- ============================================================
-- STEP 5: CP placeholder untuk subjek baru
-- ============================================================
INSERT INTO core.capaian_pembelajaran
  (subject_phase_id, version_id, cp_umum, bskap_ref, effective_date, is_active)
SELECT
  sp.subject_phase_id,
  sp.version_id,
  '[PENDING]',
  'SK BSKAP No. 046/H/KR/2025',
  '2025-01-01',
  true
FROM core.subject_phases sp
JOIN core.subjects s ON sp.subject_id = s.subject_id
WHERE s.code IN ('KK-TJAT', 'BR', 'KK-SENI-TEATER', 'AKL-DASAR', 'KK-AKL')
ON CONFLICT (subject_phase_id, version_id) DO NOTHING;

-- ============================================================
-- STEP 6: Update rasional, karakteristik, cp_umum dari BSKAP 046
-- ============================================================

-- TJKT-DASAR Fase E
UPDATE core.capaian_pembelajaran
SET
  rasional       = 'Kemajuan pesat dalam teknologi informasi dan komunikasi saat ini menuntut tersedianya sumber daya manusia yang memiliki keahlian di bidang jaringan komputer dan telekomunikasi. Mata pelajaran Dasar-dasar Teknik Jaringan Komputer dan Telekomunikasi berfungsi untuk membekali murid dengan seperangkat pengetahuan, keterampilan, dan sikap agar memiliki dasar yang kuat dalam mempelajari mata pelajaran Fase F. Pembelajaran dapat dilakukan menggunakan berbagai pendekatan, strategi, metode serta model yang sesuai dengan karakteristik kompetensi yang harus dipelajari, sehingga dapat menciptakan pembelajaran yang interaktif, inspiratif, menyenangkan, menantang, dan memotivasi murid untuk berpartisipasi aktif, serta memberikan ruang yang cukup bagi prakarsa, kreativitas, kemandirian sesuai dengan bakat, minat, passion, dan perkembangan fisik serta psikologis murid. Murid diarahkan untuk menemukan sendiri berbagai fakta, membangun konsep dan nilai-nilai baru secara mandiri serta memahami dan menerapkan aspek digital consumer behaviour. Mata Pelajaran ini bersifat holistik dimana pembelajaran tidak semata-mata terkait dengan kompetensi teknis saja. Akan tetapi murid akan mengembangkan dirinya sebagai pelajar yang beriman dan bertakwa kepada Tuhan Yang Maha Esa, bernalar kritis, peduli, kreatif, kolaboratif, komunikatif, mandiri dan sehat. Model-model pembelajaran yang dapat digunakan antara lain project-based learning, teaching factory, discovery-based learning, problem-based learning, inquiry-based learning, atau model lainnya serta metode yang relevan. Materi dan capaian kompetensi pada mata pelajaran ini merujuk pada [1] Kepmenaker RI Nomor 300 Tahun 2020 tentang Penetapan SKKNI Kategori Informasi dan Komunikasi Golongan Pokok Telekomunikasi Bidang Internet of Things; [2] Kepmenaker RI Nomor 55 Tahun 2015 tentang Penetapan SKKNI Kategori Informasi dan Komunikasi Golongan Pokok Aktivitas Pemrograman, Konsultasi Komputer dan Kegiatan Yang Berhubungan Dengan Itu (YBDI) Bidang Keamanan Informasi; [3] Kepmenaker RI Nomor 102 Tahun 2023 tentang Penetapan SKKNI Kategori Informasi dan Komunikasi Golongan Pokok Aktivitas Hosting dan Kegiatan yang berhubungan dengan itu (Ybdi) bidang Cloud Computing; [4] Kepmenaker RI Nomor 637 Tahun 2016 tentang Penetapan SKKNI Kategori Informasi dan Komunikasi Golongan Pokok Telekomunikasi Bidang Optimalisasi Jaringan Seluler; [5] Kepmenaker RI Nomor 101 Tahun 2018 tentang Penetapan SKKNI Kategori Informasi dan Komunikasi Golongan Pokok Telekomunikasi bidang Instalasi Fiber Optik; [6] Kepmenaker RI Nomor 321 Tahun 2016 tentang Penetapan SKKNI Kategori Informasi dan Komunikasi Golongan Pokok Telekomunikasi bidang Jaringan Komputer; [7] Kepmenaker RI Nomor 285 Tahun 2016 tentang Penetapan SKKNI Kategori Informasi dan Komunikasi Golongan Pokok Aktivasi Pemrograman, Konsultasi Komputer dan Kegiatan Yang Berhubungan dengan itu (YBDI) Bidang Computer Technical Support; [8] Kepmenaker RI Nomor 140 Tahun 2019 tentang Penetapan SKKNI Katego',
  karakteristik  = 'Mata pelajaran Dasar-dasar Teknik Jaringan Komputer dan Telekomunikasi berfokus pada kompetensi bersifat dasar yang harus dimiliki oleh Operator IOT, Staf Teknisi Dukungan Jaringan, Staf Operator Komputer Personal, Junior Jointer, Drafter Fiber Optic, Junior Cloud Engineer, Junior Teknisi K3 Ketinggian, Junior Teknisi Pemeliharaan VSAT-IP, Junior Teknisi Instalasi VSAT-IP. Selain itu murid diberikan pemahaman tentang proses bisnis, perkembangan penerapan teknologi dan isu-isu global, entrepreneur profile, job-profile, peluang usaha dan pekerjaan/profesi. Pengembangan soft skills pada mata pelajaran Dasar-dasar Teknik Jaringan Komputer dan Telekomunikasi sangat penting sebagai bekal dasar di dalam membangun etos kerja, meliputi: komunikasi, critical thinking, kolaborasi, dan kreativitas. Pengembangan soft skills ini menjadi fondasi dalam pengembangan hard skills yaitu menginstalasi, memelihara, dan penanganan gangguan (troubleshooting) dalam bidang Teknik Jaringan Komputer dan Telekomunikasi. Elemen dan deskripsi elemen mata pelajaran Dasar-dasar Jaringan Komputer dan Telekomunikasi adalah sebagai berikut. Elemen Deskripsi Wawasan Dunia Kerja Bidang Teknik Jaringan Komputer dan Telekomunikasi Meliputi aktivitas pekerjaan pada bidang teknik jaringan komputer dan telekomunikasi seperti  pengenalan tentang jenis-jenis profesi dan kewirausahaan (job-profile dan technopreneur), peluang usaha,proses Elemen Deskripsi bisnis, pelayanan pelanggan, serta perkembangan teknologi terkait jaringan komputer dan telekomunikasi diantaranya 3G/4G/5G, VSAT, Microwave Link, Fiber Optik, IPV6, Data Center, Layanan IoT, Cloud Computing dan Keamanan Jaringan Komputer maupun Telekomunikasi. Kecakapan Kerja Dasar  (Basic Job Skills), K3LH, dan Budaya Kerja Meliputi penerapan K3LH pada ketinggian dan budaya kerja, antara lain: pencegahan kecelakaan kerja, penerapan praktik kerja yang aman, prosedur kerja dalam keadaan darurat pengenalan bahaya ditempat kerja, dan penerapan 5R. Selain itu dibutuhkan pemahaman dasar tentang penggunaan serta konfigurasi sistem operasi, router, switch, virtualisasi dan server. Media dan Jaringan Telekomunikasi Meliputi pemahaman prinsip dasar sistem IPV4/IPV6, TCP/IP, layanan infrastruktur jaringan, sistem keamanan jaringan komputer dan telekomunikasi, sistem seluler, sistem gelombang mikro, sistem VSAT IP, sistem optik, dan sistem WLAN. Penggunaan Alat Ukur Meliputi pemahaman tentang jenis, fungsi, cara penggunaan dan pemeliharaan alat ukur dalam teknik jaringan komputer dan sistem telekomunikasi.',
  cp_umum        = 'Pada akhir Fase E, murid memiliki kemampuan sebagai berikut.',
  bskap_ref      = 'SK BSKAP No. 046/H/KR/2025',
  effective_date = '2025-01-01',
  updated_at     = now()
WHERE subject_phase_id = (
  SELECT sp.subject_phase_id
  FROM core.subject_phases sp
  JOIN core.subjects s ON sp.subject_id = s.subject_id
  JOIN core.phases   p ON sp.phase_id   = p.phase_id
  WHERE s.code = 'TJKT-DASAR' AND p.code = 'E'
);

-- TKJ Fase F
UPDATE core.capaian_pembelajaran
SET
  rasional       = 'Mata pelajaran Teknik Jaringan Akses Telekomunikasi merupakan kelanjutan dari mata pelajaran Dasar-dasar Teknik Jaringan Komputer dan Telekomunikasi. Materi dan capaian kompetensi tersebut merujuk pada Keputusan Menteri Ketenagakerjaan  Republik Indonesia Nomor 198 Tahun 2017 tentang Penetapan SKKNI Kategori Informasi dan Komunikasi Golongan Pokok Telekomunikasi bidang Penggelaran Jaringan Selular Sub Sistem Radio Akses, Kepmenaker Republik Indonesia Nomor 101 Tahun 2018 tentang Penetapan SKKNI Kategori Informasi dan Komunikasi Golongan Pokok Telekomunikasi Bidang Instalasi Fiber Optik, Kepmenaker RI Nomor 140 Tahun 2019 tentang Penetapan SKKNI Kategori Informasi dan Komunikasi Golongan Pokok Telekomunikasi Bidang Telekomunikasi Satelit dengan mempertimbangkan deskriptor skema sertifikasi okupasi. Mata pelajaran ini diharapkan akan memampukan murid untuk (1) melaksanakan tugas spesifik dengan menggunakan alat, informasi, dan prosedur kerja yang lazim dilakukan, serta menunjukkan kinerja dengan mutu yang terukur di bawah pengawasan; (2) menguasai pengetahuan operasional dasar dan pengetahuan faktual bidang kerja yang spesifik, sehingga mampu memilih penyelesaian yang tersedia terhadap masalah yang lazim timbul; dan (3) bertanggung jawab pada pekerjaan sendiri dan dapat diberi tanggung jawab membimbing orang lain. Pelaksanaan pembelajaran ini dapat menggunakan model berbasis proyek (project-based learning), discovery learning, pembelajaran berbasis masalah (problem-based learning), pembelajaran berbasis inkuiri (inquiry based learning), serta metode pembelajaran, antara lain ceramah, tanya jawab, diskusi, observasi, dan peragaan atau demonstrasi yang dipilih berdasarkan karakteristik materi dan tujuan pembelajaran. Mata pelajaran ini juga berperan untuk membentuk murid agar memiliki keahlian pada bidang Teknik Jaringan Akses Telekomunikasi, meningkatkan kemampuan logika, dan teknologi digital (computational thinking). Penguasaan kemampuan computational thinking ini secara tidak langsung dapat membiasakan murid bernalar kritis dalam menghadapi permasalahan, bekerja mandiri atau tim, serta kreatif dalam menemukan solusi masalah dalam kehidupan sehingga terbentuk karakter yang sesuai 8 dimensi profil lulusan yaitu Keimanan dan Ketakwaan terhadap Tuhan YME, Kewargaan, Penalaran Kritis, Kreativitas, Kolaborasi, Kemandirian, Kesehatan dan Komunikasi dengan berlandaskan tiga prinsip pembelajaran yaitu berkesadaran, bermakna dan menggembirakan.',
  karakteristik  = 'Mata pelajaran Teknik Komputer dan Jaringan berisi kompetensi-kompetensi penguasaan keahlian teknik komputer dan jaringan. Lingkup materi pada mata pelajaran ini meliputi perencanaan dan pengalamatan jaringan, teknologi jaringan kabel dan nirkabel, keamanan jaringan, pemasangan, konfigurasi perangkat jaringan, dan administrasi sistem jaringan. Elemen dan deskripsi elemen mata pelajaran Teknik Komputer dan Jaringan adalah sebagai berikut. Elemen Deskripsi Perencanaan dan Pengalamatan Jaringan Meliputi perencanaan topologi dan arsitektur jaringan, pengumpulan kebutuhan teknis pengguna jaringan, pengumpulan data peralatan jaringan dengan teknologi yang sesuai, pengalamatan jaringan, subnetting, Classless Inter-Domain Routing (CIDR), dan  Variable Length Subnet Mask (VLSM). Teknologi Jaringan Kabel dan Nirkabel Meliputi instalasi, pengujian, perawatan dan perbaikan jaringan kabel dan nirkabel, standar jaringan nirkabel, jaringan fiber optic, jenis-jenis kabel fiber optic, fungsi alat kerja fiber optic, sambungan fiber optic, dan perbaikan jaringan fiber optic. Keamanan Jaringan Meliputi analisis sistem keamanan jaringan yang diperlukan, potensi ancaman dan serangan terhadap keamanan jaringan, langkah-langkah penguatan host (host hardening), server Demilitarized Zone (DMZ), pengujian keamanan jaringan, host dan server, fungsi, cara kerja server autentikasi, sistem pendeteksi dan penahan ancaman atau serangan yang masuk ke jaringan, tata cara pengamanan komunikasi data menggunakan teknik kriptografi. Konfigurasi Perangkat Jaringan Meliputi pemasangan perangkat jaringan ke dalam sistem jaringan, penggantian perangkat jaringan sesuai dengan kebutuhan, konsep Virtual LAN (VLAN), konfigurasi dan pengujian Virtual LAN (VLAN), proses routing, Elemen Deskripsi jenis-jenis routing, konfigurasi, analisis permasalahan, perbaikan konfigurasi routing statis, routing dinamis, konfigurasi Network Address Translation (NAT), analisis permasalahan internet gateway, perbaikan konfigurasi Network Address Translation (NAT), analisis permasalahan, perbaikan konfigurasi proxy server, manajemen bandwidth, dan load balancing. Administrasi Sistem Jaringan Meliputi instalasi sistem operasi jaringan, konsep kerja dan konfigurasi remote server, DHCP (Dynamic Host Configuration Protocol) server, DNS (Domain Name System) server, FTP (File Transfer Protocol) server, file server, web server, mail server, database server, control panel hosting, share hosting server, dedicated hosting server, virtual private server, VPN (Virtual Private Network) server, sistem kontrol, dan monitoring.',
  cp_umum        = 'Pada akhir Fase F, murid memiliki kemampuan sebagai berikut.',
  bskap_ref      = 'SK BSKAP No. 046/H/KR/2025',
  effective_date = '2025-01-01',
  updated_at     = now()
WHERE subject_phase_id = (
  SELECT sp.subject_phase_id
  FROM core.subject_phases sp
  JOIN core.subjects s ON sp.subject_id = s.subject_id
  JOIN core.phases   p ON sp.phase_id   = p.phase_id
  WHERE s.code = 'TKJ' AND p.code = 'F'
);

-- KK-TJAT Fase F
UPDATE core.capaian_pembelajaran
SET
  rasional       = 'Mata pelajaran Teknik Jaringan Akses Telekomunikasi merupakan kelanjutan dari mata pelajaran Dasar-dasar Teknik Jaringan Komputer dan Telekomunikasi. Materi dan capaian kompetensi tersebut merujuk pada Keputusan Menteri Ketenagakerjaan  Republik Indonesia Nomor 198 Tahun 2017 tentang Penetapan SKKNI Kategori Informasi dan Komunikasi Golongan Pokok Telekomunikasi bidang Penggelaran Jaringan Selular Sub Sistem Radio Akses, Kepmenaker Republik Indonesia Nomor 101 Tahun 2018 tentang Penetapan SKKNI Kategori Informasi dan Komunikasi Golongan Pokok Telekomunikasi Bidang Instalasi Fiber Optik, Kepmenaker RI Nomor 140 Tahun 2019 tentang Penetapan SKKNI Kategori Informasi dan Komunikasi Golongan Pokok Telekomunikasi Bidang Telekomunikasi Satelit dengan mempertimbangkan deskriptor skema sertifikasi okupasi. Mata pelajaran ini diharapkan akan memampukan murid untuk (1) melaksanakan tugas spesifik dengan menggunakan alat, informasi, dan prosedur kerja yang lazim dilakukan, serta menunjukkan kinerja dengan mutu yang terukur di bawah pengawasan; (2) menguasai pengetahuan operasional dasar dan pengetahuan faktual bidang kerja yang spesifik, sehingga mampu memilih penyelesaian yang tersedia terhadap masalah yang lazim timbul; dan (3) bertanggung jawab pada pekerjaan sendiri dan dapat diberi tanggung jawab membimbing orang lain. Pelaksanaan pembelajaran ini dapat menggunakan model berbasis proyek (project-based learning), discovery learning, pembelajaran berbasis masalah (problem-based learning), pembelajaran berbasis inkuiri (inquiry based learning), serta metode pembelajaran, antara lain ceramah, tanya jawab, diskusi, observasi, dan peragaan atau demonstrasi yang dipilih berdasarkan karakteristik materi dan tujuan pembelajaran. Mata pelajaran ini juga berperan untuk membentuk murid agar memiliki keahlian pada bidang Teknik Jaringan Akses Telekomunikasi, meningkatkan kemampuan logika, dan teknologi digital (computational thinking). Penguasaan kemampuan computational thinking ini secara tidak langsung dapat membiasakan murid bernalar kritis dalam menghadapi permasalahan, bekerja mandiri atau tim, serta kreatif dalam menemukan solusi masalah dalam kehidupan sehingga terbentuk karakter yang sesuai 8 dimensi profil lulusan yaitu Keimanan dan Ketakwaan terhadap Tuhan YME, Kewargaan, Penalaran Kritis, Kreativitas, Kolaborasi, Kemandirian, Kesehatan dan Komunikasi dengan berlandaskan tiga prinsip pembelajaran yaitu berkesadaran, bermakna dan menggembirakan.',
  karakteristik  = 'Mata pelajaran Teknik Jaringan Akses Telekomunikasi berisi materi pembelajaran tentang kompetensi lanjut dari dasar Teknik Jaringan Komputer dan Telekomunikasi. Mata pelajaran ini membekali murid untuk bekerja, berwirausaha, dan melanjutkan studi yang relevan dengan Teknik Jaringan Akses Telekomunikasi. Elemen dan deskripsi elemen mata pelajaran Teknik Jaringan Akses Telekomunikasi adalah sebagai berikut. Elemen Deskripsi Teknik Kerja Bengkel dan Kelistrikan Meliputi penggunaan perkakas, pemeliharaan grounding, konsep catu daya, dan teknik kelistrikan. Sistem Komputer dan Internet Of Things (IoT) Meliputi konsep sistem komputer, komunikasi data, pemrograman dasar, dan Internet of Things (IoT). FTTx Meliputi prinsip propagasi gelombang cahaya, konsep dan implementasi konfigurasi jaringan FTTx, instalasi, terminasi dan troubleshooting jaringan FTTx, pengukuran jaringan FTTx, perencanaan jaringan FTTx dengan perangkat lunak yang relevan. VSAT Meliputi konsep dan implementasi arsitektur sistem komunikasi satelit, jenis-jenis satelit dan orbit satelit, konsep dan implementasi perencanaan instalasi stasiun bumi, perhitungan dan analisis link budget, pointing antena ground segment, monitoring performansi, penggunaan alat ukur, serta troubleshooting VSAT. Wireless Access Meliputi konsep dan implementasi catu daya grounding perangkat jaringan akses radio dan instalasinya, konsep dan implementasi antena, Elemen Deskripsi sistem komunikasi radio bergerak, sistem kinerja multiple access, trafik telekomunikasi dan perencanaan jaringan akses radio. Customer Premise Equipment Meliputi konsep dan implementasi etika pelayanan terhadap pelanggan atau Code of Conduct (CoC), tata kelola instalasi kabel premises, dan instalasi serta pemeliharaan perangkat pelanggan.',
  cp_umum        = 'Pada akhir Fase F, murid memiliki kemampuan sebagai berikut.',
  bskap_ref      = 'SK BSKAP No. 046/H/KR/2025',
  effective_date = '2025-01-01',
  updated_at     = now()
WHERE subject_phase_id = (
  SELECT sp.subject_phase_id
  FROM core.subject_phases sp
  JOIN core.subjects s ON sp.subject_id = s.subject_id
  JOIN core.phases   p ON sp.phase_id   = p.phase_id
  WHERE s.code = 'KK-TJAT' AND p.code = 'F'
);

-- OTOMOTIF-DASAR Fase E
UPDATE core.capaian_pembelajaran
SET
  rasional       = 'Mata pelajaran Dasar-dasar Teknik Otomotif merupakan pelajaran dasar kejuruan yang membekali murid dengan kompetensi inti untuk menguasai keahlian di bidang teknik otomotif. Pelajaran ini mengintegrasikan disiplin Ilmu Pengetahuan dan Teknologi (IPTEK), seperti Matematika, Fisika, dan Kimia, untuk memahami prinsip kerja sistem otomotif secara ilmiah dan sistematis. Matematika digunakan untuk perhitungan teknis, fisika untuk mekanika dan dinamika kendaraan, serta kimia untuk proses pembakaran dan karakteristik material. Dengan dasar ilmu tersebut, murid diharapkan siap mengikuti pembelajaran fase selanjutnya dan mampu mengikuti perkembangan teknologi otomotif secara berkelanjutan. Materi dan capaian kompetensi mata pelajaran Dasar-dasar Otomotif, merujuk pada Kepmenaker RI Nomor 97 Tahun 2018 tentang Penetapan SKKNI Kategori Perdagangan Besar dan Eceran; Reparasi dan Perawatan Mobil dan Sepeda Motor Golongan Pokok Perdagangan, Reparasi dan Perawatan Mobil dan Sepeda Motor Bidang Otomotif Sub Bidang Kendaraan Ringan Roda 4 (Empat), Kepmenaker RI Nomor 105 Tahun 2018 tentang Penetapan SKKNI Kategori Perdagangan Besar dan Eceran; Reparasi dan Perawatan Mobil dan Sepeda Motor Golongan Pokok Perdagangan, Reparasi dan Perawatan Mobil dan Sepeda Motor Bidang industri Body Repair, Kepmenaker RI Nomor 147 Tahun 2019 tentang Penetapan SKKNI Kategori Perdagangan Besar dan Eceran; Reparasi dan Perawatan Mobil dan Sepeda Motor Golongan Pokok Perdagangan, Reparasi dan Perawatan Mobil dan Sepeda Motor Bidang Teknik Sepeda Motor, Kepmenaker RI Nomor 167 Tahun 2019 tentang Penetapan SKKNI Kategori Perdagangan Besar dan Eceran; Reparasi dan Perawatan Mobil dan Sepeda Motor Golongan Pokok Perdagangan, Reparasi dan Perawatan Mobil dan Sepeda Motor Bidang Teknik Otomotif Sub Sektor Bidang Teknik Ototronik, Kepmenaker RI Nomor 052 Tahun 2021 tentang Penetapan SKKNI Kategori Perdagangan Besar dan Eceran Golongan Pokok Perdagangan, Reparasi dan Perawatan Mobil dan Sepeda Motor Bidang Industri Modifikasi Kendaraan Bermotor, Kepmenaker RI Nomor 8 Tahun 2024 tentang Penetapan SKKNI Kategori Industri Pengolahan Golongan Pokok Industri Kendaraan Bermotor, Trailer dan Semi Trailer Bidang Servis Kendaraan Ringan Electrified Vehicles, Kepmenaker RI Nomor 124 Tahun 2024 tentang Penetapan SKKNI Kategori Industri Pengolahan Golongan Pokok Industri Kendaraan Bermotor, Trailer dan Semi Trailer Bidang Industri Manufaktur Otomotif Roda Empat, serta Kepmenaker RI Nomor 127 Tahun 2024 Tentang Penetapan SKKNI Kategori Aktivitas Profesional, Ilmiah dan Teknis Golongan Pokok Aktivitas Profesional, Ilmiah dan Teknis Lainnya Bidang Maintenance Alat Berat. Proses pembelajaran mata pelajaran Dasar-dasar Otomotif ini dilaksanakan secara interaktif, aktif, inspiratif, menyenangkan, menantang, dan memotivasi murid, serta memberikan ruang yang cukup bagi prakarsa, kreativitas, kemandirian sesuai dengan bakat, minat dan perkembangan fisik serta psikologis murid. Model-model pembelajaran yang dapat d',
  karakteristik  = 'Pada hakikatnya mata pelajaran Dasar-dasar Teknik Otomotif berfokus pada kompetensi yang bersifat mendasar yang harus dimiliki oleh seorang tenaga operator, teknisi dan jabatan profesi lainnya disesuaikan dengan kebutuhan kerja bidang otomotif. Mata pelajaran ini tidak hanya membekali murid untuk bekerja tetapi juga dasar untuk berwirausaha, dan melanjutkan proses pembelajaran pada Fase F sesuai minat dan bakat murid. Elemen dan deskripsi elemen mata pelajaran Dasar-dasar Teknik Otomotif adalah sebagai berikut. Elemen Deskripsi Wawasan Dunia Otomotif Meliputi wawasan dunia usaha, dunia industri, dunia kerja bidang otomotif, perkembangan teknologi pada berbagai komponen dan jenis produk otomotif serta isu global seperti perubahan iklim dan penggunaan kecerdasan buatan pada bidang otomotif. Kecakapan Kerja Dasar (Basic Job Skills), K3, dan Budaya Kerja Meliputi prosedur perawatan dan perbaikan otomotif, potensi bahaya di tempat kerja, prosedur keselamatan dan kesehatan lingkungan kerja, alat pelindung diri, dan prosedur dalam keadaan darurat serta budaya kerja pada bidang otomotif. Elemen Deskripsi Gambar Teknik Otomotif Meliputi menggambar teknik dasar, termasuk pengenalan macam-macam peralatan gambar, standarisasi dalam pembuatan gambar, serta praktik menggambar dan membaca gambar teknik, menentukan letak dan posisi komponen otomotif berdasarkan gambar buku manual servis. Peralatan dan Perlengkapan Tempat Kerja Meliputi penggunaan peralatan umum (general tools), alat perlengkapan bengkel (equipment tools), peralatan servis khusus (special service tools), alat ukur (measuring tools), dan alat diagnosis (diagnostic tools). Dasar Kelistrikan dan Elektronika Otomotif Meliputi dasar kelistrikan (prinsip dan konsep dasar seperti hukum ohm daya listrik serta reaksi kemagnetan dan reaksi kimia dari arus listrik) komponen elektronika, pembuatan sambungan pada rangkaian serta perbaikan rangkaian dasar kelistrikan dan elektronika otomotif. Komponen Otomotif Meliputi komponen utama konversi energi pada berbagai enjin otomotif, komponen tambahan mencakup dan tidak terbatas pada berbagai sistem engine, pemindah tenaga, sasis, kelistrikan dan bodi serta komponen perlengkapan pada bidang otomotif. Dasar Sistem Hidrolik dan Pneumatik Meliputi prinsip dasar, fungsi dan cara kerja komponen, perawatan dan pengujian komponen sistem hidrolik dan pneumatik.',
  cp_umum        = 'Pada akhir Fase E, murid memiliki kemampuan sebagai berikut.',
  bskap_ref      = 'SK BSKAP No. 046/H/KR/2025',
  effective_date = '2025-01-01',
  updated_at     = now()
WHERE subject_phase_id = (
  SELECT sp.subject_phase_id
  FROM core.subject_phases sp
  JOIN core.subjects s ON sp.subject_id = s.subject_id
  JOIN core.phases   p ON sp.phase_id   = p.phase_id
  WHERE s.code = 'OTOMOTIF-DASAR' AND p.code = 'E'
);

-- KK-TKRO Fase F
UPDATE core.capaian_pembelajaran
SET
  rasional       = 'Mata pelajaran Teknik Kendaraan Ringan berada pada fase F dan merupakan pelajaran lanjutan dari mata pelajaran dasar sebelumnya. Mata pelajaran Teknik Kendaraan Ringan membekali murid dengan sikap, pengetahuan, dan keterampilan yang diperlukan serta kapasitas untuk berpikir logis, kritis, dan analitis sehingga murid meningkatkan kompetensi secara bertahap untuk memahami konsep, prinsip, dan solusi baik pengetahuan dan praktek pada Mata pelajaran Teknik Kendaraan Ringan. Mata pelajaran ini membekali murid untuk bekerja, berwirausaha, dan melanjutkan studi tentang teknik kendaraan ringan. Mata pelajaran Teknik Kendaraan Ringan diharapkan akan memampukan murid untuk menerapkan dan menggeneralisasi peta konsep: (1) Keselamatan, Kesehatan kerja dan lingkungan Hidup (K3LH), budaya kerja, dan etos kerja yang diwujudkan dalam sikap/karakter yang selaras dengan kebutuhan dunia kerja di bidang otomotif.; (2) wawasan seputar isu-isu terkini, perkembangan teknologi produksi, industri, alur operasional, profesi, peluang kerja dan peluang usaha di bidang teknik kendaraan ringan; (3) Pembacaan gambar, teknik pengukuran, penggunaan peralatan di industri atau bengkel teknik kendaraan ringan, serta teknik dasar pemeliharaan dan perbaikan Teknik Kendaraan Ringan. Sesuai dengan karakteristiknya Pelaksanaan pembelajaran Teknik Kendaraan Ringan tetap relevan dan berkontribusi dalam mewujudkan delapan dimensi profil lulusan (1) keimanan dan ketakwaan kepada Tuhan Yang Maha Esa, (2) kewargaan, (3) penalaran kritis, (4) kreativitas, (5) kolaborasi, (6) kemandirian, (7) kesehatan, dan (8) komunikasi  serta memiliki kompetensi yang sesuai dengan kebutuhan dunia industri.',
  karakteristik  = 'Teknik Kendaraan Ringan mempelajari segala sesuatu yang terkait dengan proses penggunaan, perawatan, dan perbaikan alat transportasi kendaraan roda empat atau lebih sesuai dengan perkembangan teknologi. Elemen dan deskripsi elemen mata pelajaran Teknik Kendaraan Ringan adalah sebagai berikut. Elemen Deskripsi Konversi Energi Kendaraan Ringan Meliputi konversi energi kendaraan ringan, identifikasi sumber energi kendaraan ringan, jenis-jenis sumber energi kendaraan ringan (gasoline, diesel, listrik, dan hybrid), serta menentukan daya motor pada teknik kendaraan ringan. Proses Pelayanan dan Manajemen Bengkel Kendaraan Ringan Meliputi penerimaan service, pelaksanaan service, pengelolaan alat dan bahan (sparepart), proses quality check, tugas kerja pada security, customer relation, officer, sales advisor, mechanic, toolman, dan cleaning service. Elemen Deskripsi Prosedur Penggunaan Kendaraan Ringan Meliputi prosedur pengecekan sebelum dan sesudah berkendara, dan mengoperasikan kendaraan transmisi manual dan automatik. Perawatan Berkala Kendaraan Ringan Meliputi menerapkan perawatan berkala kendaraan 1.000 km, 10.000 km, 20.000 km, dan kelipatannya. Sistem Engine Kendaraan Ringan Meliputi komponen utama engine, sistem pelumasan, sistem pendinginan, sistem bahan bakar gasoline/diesel (konvensional dan elektronik), eEngine Management System (EMS), sistem pemasukan udara, dan sistem pembuangan dan kontrol emisi. Sistem Pemindah Tenaga Kendaraan Ringan Meliputi perawatan sistem clutch, sistem transmisi (manual dan otomatis), poros propeller, differential, dan poros penggerak roda. Sistem Sasis Kendaraan Ringan Meliputi perawatan sistem rem (anti lock brake system dan non anti lock brake system), sistem kemudi (manual steering, hidrolik power steering, dan electronic power steering), sistem suspensi roda dan ban, serta spooring dan balancing roda. Sistem Elektrikal Kendaraan Ringan Meliputi perawatan baterai, jaringan kelistrikan, sistem penerangan dan lampu tanda, sistem wiper dan washer, sistem power window dan central lock, electric mirror, sistem starter, sistem pengisian, sistem pengapian, sistem Air Conditioning (AC), sistem audio video.',
  cp_umum        = 'Pada akhir Fase F, murid memiliki kemampuan sebagai berikut.',
  bskap_ref      = 'SK BSKAP No. 046/H/KR/2025',
  effective_date = '2025-01-01',
  updated_at     = now()
WHERE subject_phase_id = (
  SELECT sp.subject_phase_id
  FROM core.subject_phases sp
  JOIN core.subjects s ON sp.subject_id = s.subject_id
  JOIN core.phases   p ON sp.phase_id   = p.phase_id
  WHERE s.code = 'KK-TKRO' AND p.code = 'F'
);

-- KK-TBSM Fase F
UPDATE core.capaian_pembelajaran
SET
  rasional       = 'Mata pelajaran Teknik Sepeda Motor merupakan ilmu pengetahuan dan keterampilan untuk membekali murid dengan kompetensi-kompetensi dalam penguasaan keahlian teknik sepeda motor. Teknologi otomotif terus berkembang layaknya teknologi lainnya seperti teknologi digital atau teknologi informasi dan komunikasi. Teknik sepeda motor berkembang seiring dengan peningkatan kebutuhan masyarakat terhadap kendaraan bermotor. Pada perkembangannya, teknik sepeda motor menjadi semakin canggih dengan teknologi yang berkaitan dengan otomotif. Mata pelajaran Teknik Sepeda Motor berada pada Fase F untuk SMK. Materi dan capaian kompetensi pada mata pelajaran ini merujuk pada Kepmenaker RI Nomor 147 Tahun 2019 tentang Penetapan SKKNI Kategori Perdagangan Besar dan Eceran; Reparasi dan Perawatan Mobil dan Sepeda Motor Golongan Pokok Perdagangan Reparasi dan Perawatan Mobil dan Sepeda Motor Bidang Teknik Sepeda motor, dengan mempertimbangkan deskriptor jenjang kualifikasi level 2 pada KKNI. Mata pelajaran ini diharapkan akan memampukan murid untuk melaksanakan tugas spesifik dengan menggunakan alat, informasi, dan prosedur kerja yang lazim dilakukan, serta menunjukkan kinerja dengan mutu yang terukur di bawah pengawasan; menguasai pengetahuan operasional dasar dan pengetahuan faktual bidang kerja yang spesifik, sehingga mampu memilih penyelesaian yang tersedia terhadap masalah yang lazim timbul; dan bertanggung jawab pada pekerjaan sendiri dan dapat diberi tanggung jawab membimbing orang lain. Pelaksanaan pembelajaran Teknik Sepeda Motor berpusat pada murid (student-centered learning) dengan dapat menerapkan pembelajaran berbasis inkuiri (inquiry-based learning), pembelajaran berbasis masalah (problem-based learning), pembelajaran berbasis projek (project-based learning), teaching factory, kunjungan serta praktik langsung di dunia atau metode lain yang relevan dalam rangka mewujudkan delapan dimensi profil lulusan  yang terdiri atas keimanan dan ketakwaan terhadap Tuhan YME, kewargaan, penalaran kritis, kreativitas, kolaborasi, kemandirian, kesehatan, serta komunikasi.',
  karakteristik  = 'Pada dasarnya mata pelajaran Teknik Sepeda Motor berfokus pada kompetensi tingkat menengah dan lanjutan yang wajib dimiliki oleh seorang teknisi sepeda motor sesuai dengan perkembangan teknologi dan dunia kerja. Lingkup Teknik Sepeda Motor adalah segala hal yang terkait dengan proses penggunaan, perawatan (termasuk pemeriksaan dan penyetelan), analisis kerusakan, dan perbaikan alat transportasi kendaraan roda dua sesuai dengan teknologi yang berkembang. Mata pelajaran ini membekali murid untuk bekerja, berwirausaha, dan melanjutkan studi tentang teknik sepeda motor. Elemen dan deskripsi elemen mata pelajaran teknik sepeda motor adalah sebagai berikut. Elemen Deskripsi Perawatan dan Perbaikan Engine Sepeda Motor Meliputi perawatan dan perbaikan mekanisme katup dan blok silinder, sistem pelumasan, sistem pendinginan, sistem bahan bakar dan sistem gas buang pada engine sepeda motor. Perawatan dan Perbaikan Sasis Sepeda Motor Meliputi perawatan dan perbaikan sistem rem, sistem suspensi, sistem kemudi dan rangka pada sasis sepeda motor. Perawatan dan Perbaikan Sistem Pemindah Tenaga Sepeda Motor Meliputi perawatan dan perbaikan sistem kopling manual dan otomatis, sistem transmisi manual dan otomatis, roda, ban, dan rantai pada sistem pemindah tenaga sepeda motor. Perawatan dan Perbaikan Sistem Kelistrikan Sepeda Motor Meliputi perawatan dan perbaikan sistem penerangan, sistem instrumen dan sinyal, sistem starter, sistem pengapian, dan sistem pengisian pada sistem kelistrikan sepeda motor. Perawatan dan Perbaikan Sepeda Motor Listrik dan Hybrid Meliputi perawatan dan perbaikan komponen sepeda  motor listrik, sistem controller, Brushless Direct Current (BLDC) dan baterai pada sepeda motor listrik dan hybrid. Perawatan dan Perbaikan Engine Meliputi perawatan dan perbaikan sistem injeksi dan sistem pengamanan Elemen Deskripsi Management System Sepeda Motor pada engine management system (EMS) sepeda motor. Pengelolaan Bengkel Sepeda Motor Meliputi Keselamatan dan Kesehatan Kerja dan Lingkungan Hidup (K3LH) dan manajemen bengkel sepeda motor.',
  cp_umum        = 'Pada akhir Fase F, murid memiliki kemampuan sebagai berikut.',
  bskap_ref      = 'SK BSKAP No. 046/H/KR/2025',
  effective_date = '2025-01-01',
  updated_at     = now()
WHERE subject_phase_id = (
  SELECT sp.subject_phase_id
  FROM core.subject_phases sp
  JOIN core.subjects s ON sp.subject_id = s.subject_id
  JOIN core.phases   p ON sp.phase_id   = p.phase_id
  WHERE s.code = 'KK-TBSM' AND p.code = 'F'
);

-- PEMASARAN-DASAR Fase E
UPDATE core.capaian_pembelajaran
SET
  rasional       = 'Mata Pelajaran Dasar-dasar Pemasaran adalah mata pelajaran Dasar kejuruan yang terdiri atas  berbagai ilmu dasar sebagai penentu dalam mempelajari mata pelajaran  lain pada  Program Keahlian Pemasaran. Program Keahlian Pemasaran terbagi dua konsentrasi keahlian yaitu konsentrasi keahlian Bisnis Digital dan Bisnis Ritel, yang memberikan keterampilan dan kemampuan berbisnis secara online maupun offline Murid dapat bekerja sebagai: kasir, pramuniaga, sales executive, merchandiser, Konten creator ,Copywriter, public relation, wirausaha, serta jabatan lain sesuai dengan perkembangan dan kebutuhan dunia kerja. Pelaksanaan pembelajaran Dasar-dasar Pemasaran dilaksanakan dengan pendekatan yang menekankan pemahaman mendalam, penerapan pengetahuan secara bermakna, dan pembentukan keterampilan berpikir tingkat tinggi, dengan model pembelajaran Project-Based Learning (PjBL), Problem-Based Learning (PBL), Inquiry-Based Learning dan Discovery Learning, serta praktik langsung di dunia kerja dalam rangka mewujudkan profil lulusan Materi dan capaian kompetensi pada mata pelajaran ini mengacu pada Keputusan Menteri Ketenagakerjaan Republik Indonesia Nomor 124 Tahun 2022 tentang Penetapan SKKNI Kategori Aktivitas Profesional, Ilmiah dan Teknis Golongan Pokok Aktivitas Konsultasi Manajemen Bidang Pemasaran dengan mempertimbangkan deskriptor jenjang pada KKNI Level II pada Bidang Pemasaran.',
  karakteristik  = 'Mata pelajaran Dasar-Dasar Pemasaran menuntut murid untuk memahami konsep secara menyeluruh, menerapkannya dalam konteks nyata, dan mengembangkan keterampilan berpikir tingkat tinggi. Berikut ini beberapa karakteristik mata pelajaran tersebut: 1. Kontekstualisasi pembelajaran sesuai dengan situasi yang dihadapi. 2. Berorientasi pada Pemahaman Konsep yang Bermakna yaitu murid tidak sekadar menghafal istilah pemasaran, tetapi memahami makna, fungsi, dan penerapannya dalam dunia nyata. 3. Pembelajaran dikembangkan melalui proyek pemasaran nyata, studi kasus, dan investigasi tren pasar. 4. Mendorong berpikir kritis, kreatif, dan Problem Solving yaitu murid diajak untuk menganalisis kebutuhan pasar, mencari solusi pemasaran, dan merancang strategi yang inovatif. 5. Mengajarkan pentingnya etika dalam pemasaran, perlindungan konsumen, dan tanggung jawab sosial. Elemen dan deskripsi elemen mata pelajaran Dasar Dasar Pemasaran adalah sebagai berikut. Elemen Deskripsi Wawasan Dunia Kerja Bidang Pemasaran Di Berbagai Industri Meliputi permasalahan  aktivitas pekerjaan pada bidang pemasaran secara menyeluruh pada berbagai jenis industri dan usaha, integrasi teknologi digital dalam praktik pemasaran dengan mempertimbangkan nilai etika dan tanggung jawab sosial terkait dengan dunia pemasaran, seperti digital marketing, e-commerce, marketplace, dan media sosial, profil pekerjaan/profesi (job-profile) dalam bidang pemasaran di masa sekarang dan di masa mendatang seperti kasir, pramuniaga, sales executive, merchandiser, digital marketer, dan public relation, serta peluang usaha di bidang pemasaran, seperti Elemen Deskripsi dropshipping, drop servicing, affiliate marketing, marketing agency,  dan content creator murid juga mampu menentukan karir di bidang yang sesuai dengan bakat, minat, dan renjana (passion), prosedur kesehatan, keselamatan dan keamanan di tempat kerja, menangani keadaan darurat dan mengantisipasi, mempertahankan standar penampilan pribadi, serta memberikan umpan balik mengenai kesehatan, keselamatan, dan keamanan. Kecakapan Kerja Dasar (Basic Job Skills), K3, dan Budaya Kerja faktor-faktor yang mempengaruhi perilaku konsumen dalam keputusan pembelian barang dan jasa, mengidentifikasi sinyal-sinyal calon pelanggan, menentukan bahasa pemasaran yang tepat,  serta membuat buyer persona untuk mewujudkan kepuasan pelanggan, pelayanan prima saat melakukan pelayanan penjualan, menerapkan konsep  attention, interest desire, action (AIDA), serta mampu untuk bekerja di dalam tim (teamwork), masalah-masalah ekonomi, memahami model ekonomi, pelaku ekonomi, perilaku konsumen dan produsen dalam kegiatan ekonomi, menerapkan ilmu ekonomi dalam kegiatan usaha, dan administrasi umum, serta fungsi-fungsi manajemen dalam organisasi pemasaran',
  cp_umum        = 'Pada akhir Fase E, murid memiliki kemampuan sebagai berikut.',
  bskap_ref      = 'SK BSKAP No. 046/H/KR/2025',
  effective_date = '2025-01-01',
  updated_at     = now()
WHERE subject_phase_id = (
  SELECT sp.subject_phase_id
  FROM core.subject_phases sp
  JOIN core.subjects s ON sp.subject_id = s.subject_id
  JOIN core.phases   p ON sp.phase_id   = p.phase_id
  WHERE s.code = 'PEMASARAN-DASAR' AND p.code = 'E'
);

-- BD Fase F
UPDATE core.capaian_pembelajaran
SET
  rasional       = 'Bisnis Digital merupakan salah satu mata pelajaran pada program keahlian pemasaran. Mata pelajaran ini memuat kompetensi-kompetensi yang digunakan untuk berkarir di dunia industri saat ini, baik bekerja pada pihak lain, berwirausaha secara mandiri, maupun sebagai bekal untuk melanjutkan pendidikan. Selain itu, mata pelajaran ini berkontribusi untuk menunjang kompetensi dari lulusan yang akan berkarir di bidang junior content marketing e-commerce officer, customer relationship management officer junior copywriter, junior social media specialist, serta bidang-bidang lain yang relevan. Untuk mendukung karir tersebut, murid pada Fase F harus kompeten dalam bidang marketing, perencanaan bisnis, komunikasi bisnis, digital branding, digital onboarding, digital marketing, dan digital operation. Pembelajaran dapat menggunakan berbagai pendekatan, strategi, model, serta metode yang sesuai dengan karakteristik kompetensi yang harus dipelajari sehingga dapat menciptakan pembelajaran yang berkesadaran, bermakna, menyenangkan, interaktif, inspiratif, menantang, memotivasi murid untuk berpartisipasi aktif, dan memberikan ruang yang cukup bagi inisiatif, kreativitas, kemandirian sesuai dengan bakat, minat, passion, serta perkembangan fisik dan psikologis murid. Model-model pembelajaran yang dapat digunakan, antara lain project-based learning, problem-based learning, discovery learning, inquiry learning, teaching factory, serta model-model lainnya yang relevan. Materi dan capaian kompetensi pada mata pelajaran ini merujuk pada SKKNI Kategori Aktivitas Profesional, Ilmiah dan Teknis Golongan Pokok Aktivitas Konsultasi Manajemen Bidang Pemasaran (Kepmenaker RI Nomor 124 Tahun 2022) dengan mempertimbangkan deskriptor jenjang kualifikasi 2 pada KKNI. Mata pelajaran ini diharapkan akan memampukan murid untuk (1) melaksanakan tugas spesifik dengan menggunakan alat, informasi, dan prosedur kerja yang lazim dilakukan, serta menunjukkan kinerja dengan mutu yang terukur di bawah pengawasan; (2) menguasai pengetahuan operasional dasar dan pengetahuan faktual bidang kerja yang spesifik sehingga mampu memilih penyelesaian yang tersedia terhadap masalah yang lazim timbul; dan (3) bertanggung jawab pada pekerjaan sendiri dan dapat diberi tanggung jawab membimbing orang lain. Mata pelajaran ini tidak semata-mata dimaksudkan untuk memenuhi kompetensi hard skills saja, akan tetapi juga menghasilkan insan Indonesia yang memiliki kemandirian, cerdas spiritual, cerdas emosional, cerdas sosial, cerdas intelektual, cerdas kinestetik meliputi keimanan dan ketakwaan, kewargaan, penalaran kritis, kreativitas, kolaborasi, kemandirian, kesehatan, dan komunikasi.',
  karakteristik  = 'Mata pelajaran ini berfokus pada penguasaan kompetensi yang harus dimiliki oleh tenaga bisnis digital atau jabatan lain sesuai dengan perkembangan dan kebutuhan dunia kerja. Oleh karena itu, dalam proses pembelajaran memerlukan kemampuan murid untuk berpikir kritis dan kreatif hingga pemahaman mendalam Elemen dan deskripsi elemen mata pelajaran Bisnis Digital adalah sebagai berikut. Elemen Deskripsi Marketing Meliputi pengenalan struktur pasar dan bentuk pasar, strategi bauran pemasaran, pengembangan produk, daur hidup produk (product life cycle/PLC), merek (branding), penetapan harga jual, dan promosi produk. Perencanaan Bisnis Meliputi analisis lingkungan bisnis dengan berbagai model analisis, merencanakan strategi bisnis, analisis usaha, penyusunan proposal usaha, dan pengembangan usaha. Elemen Deskripsi Komunikasi Bisnis Meliputi prinsip komunikasi bisnis, etika komunikasi bisnis, negosiasi bisnis, dan presentasi bisnis. Digital Branding Meliputi pengantar digital branding, pembuatan logo secara online, produksi konten digital dan manajemen publikasi konten. Digital Onboarding Meliputi aktivasi penjualan melalui media sosial, website, marketplace, dan online retail. Digital Marketing Meliputi pengantar digital marketing, etika warga internet (internet citizen), analisis data digital, pengelolaan usaha berbasis web, Search Engine Optimization (SEO), Search Engine Marketing (SEM), sosial media marketing, dan promosi di marketplace Digital Operation Meliputi pengantar operasional bisnis online, inventori, customer relationship, pengiriman barang, dan laporan pembelian dan penjualan online.',
  cp_umum        = 'Pada akhir Fase F, murid memiliki kemampuan sebagai berikut.',
  bskap_ref      = 'SK BSKAP No. 046/H/KR/2025',
  effective_date = '2025-01-01',
  updated_at     = now()
WHERE subject_phase_id = (
  SELECT sp.subject_phase_id
  FROM core.subject_phases sp
  JOIN core.subjects s ON sp.subject_id = s.subject_id
  JOIN core.phases   p ON sp.phase_id   = p.phase_id
  WHERE s.code = 'BD' AND p.code = 'F'
);

-- BR Fase F
UPDATE core.capaian_pembelajaran
SET
  rasional       = 'Mata pelajaran Manajemen Perkantoran adalah mata pelajaran kejuruan yang berisi sekumpulan kompetensi guna mencapai penguasaan keahlian kerja di bidang manajemen perkantoran. Mata pelajaran ini merupakan kelanjutan dari mata pelajaran Dasar-Dasar Manajemen Perkantoran dan Layanan Bisnis pada fase E sehingga dalam proses pelaksanaan pembelajarannya akan lebih meningkatkan kompetensi yang telah dicapai sesuai dengan tuntutan, tantangan, dan kebutuhan dunia kerja. Mata pelajaran Manajemen Perkantoran diberikan kepada murid pada fase F yang berfungsi untuk lebih memperkuat dan menumbuhkembangkan profesionalisme dan kebanggaan murid terhadap keahlian (keprofesian) manajemen perkantoran melalui pemahaman dan penerapan pengelolaan administrasi umum, komunikasi di tempat kerja, pengelolaan kearsipan, teknologi perkantoran, pengelolaan rapat/pertemuan, serta pelayanan kepada kolega dan pelanggan sesuai tuntutan dan kebutuhan bidang manajemen perkantoran di dunia kerja. Berbekal pengetahuan, keterampilan, dan sikap di bidang manajemen perkantoran, murid akan mampu berwirausaha secara mandiri dan/atau melanjutkan pendidikan sesuai dengan jurusannya. Mata pelajaran ini juga diharapkan dapat membekali murid untuk: (1) melaksanakan satu tugas spesifik pada bidang administratif profesional mencakup fungsi administrasi sehari-hari dengan menggunakan alat, informasi, dan prosedur kerja yang lazim dilakukan, serta menunjukkan kinerja dengan mutu yang terukur di bawah pengawasan langsung atasannya. (2) Memiliki pengetahuan operasional dasar dan pengetahuan faktual bidang administratif profesional sehingga mampu memilih penyelesaian yang tersedia terhadap masalah yang lazim timbul. (3) Memiliki sikap ketelitian, kecepatan, dan kesopanan dalam melakukan tugas sesuai dengan aturan, etika, budaya setempat, dan proses kerja yang telah ditentukan. Rujukan penyusunan capaian pembelajaran pada mata pelajaran ini, antara lain berdasarkan Keputusan Menteri Ketenagakerjaan Republik Indonesia Nomor 109 Tahun 2024 tentang Penetapan Standar Kompetensi Kerja Nasional Indonesia Kategori Aktivitas Penyewaan dan Sewa Guna Usaha Tanpa Hak Opsi, Ketenagakerjaan, Agen Perjalanan dan Penunjang Usaha Lainnya Golongan Pokok Aktivitas Administrasi Kantor, Aktivitas Penunjang Kantor, dan Aktivitas Penunjang Usaha Lainnya Bidang Administratif Profesional serta Keputusan Menteri Ketenagakerjaan Republik Indonesia Nomor 162 Tahun 2024 Tentang Penetapan Jenjang Kualifikasi Nasional Indonesia Bidang Administratif Profesional. Pembelajaran mata pelajaran Manajemen Perkantoran dapat menggunakan berbagai pendekatan, strategi, model, serta metode yang sesuai dengan karakteristik kompetensi yang dipelajari untuk dapat menciptakan pembelajaran yang berkesadaran, bermakna, dan menggembirakan bagi murid agar dapat berpartisipasi aktif, serta memberikan ruang yang cukup bagi prakarsa, kreativitas, kemandirian sesuai dengan bakat, minat, renjana, dan perkembangan fisik serta psikologis murid. Model-model ',
  karakteristik  = 'Mata pelajaran Bisnis Ritel berkontribusi dalam membentuk murid agar memiliki keahlian pada bidang ritel, kasir, pramuniaga, tenaga pemasaran, pengelola toko/supermarket, manajer pembelian, reseller, merchandiser, agen, dan distributor. Berbekal keahlian tersebut, murid dapat bekerja pada pihak lain, berwirausaha secara mandiri, maupun melanjutkan pendidikan dengan kejuruannya. Mata pelajaran Bisnis Ritel bersifat hierarkis, yaitu antara materi dari awal sampai akhir saling berhubungan dan saling berkaitan, membutuhkan ketelitian, ketekunan, dan kesabaran dalam menyelesaikan materi pembelajaran. Mata pelajaran Bisnis Ritel berisi penguasaan kemampuan merencanakan dan melaksanakan kegiatan, memecahkan masalah, keterampilan manajerial, serta kemampuan mengikuti perkembangan pengetahuan dan teknologi di bidang ritel. Elemen dan deskripsi elemen mata pelajaran Bisnis Ritel adalah sebagai berikut. Elemen Deskripsi Marketing Meliputi konsep pasar dalam pemasaran (struktur dan bentuk pasar), studi kelayakan usaha (analisis SWOT), rencana usaha (proposal usaha atau Business Model Canvas), strategi pemasaran (Segmenting, Targeting, Positioning), dan strategi bauran pemasaran (4P: Product, Price, Place, Promotion atau 7P: Product, Price, Place, Promotion, Process, People). Customer Service Meliputi ruang lingkup customer service dan POS (Prosedur Operasional Standar)  customer service dalam handling customer dan handling Elemen Deskripsi complain baik secara offline maupun online. Komunikasi Bisnis Meliputi komunikasi bisnis baik secara lisan maupun tertulis dalam bahasa Indonesia dan atau bahasa asing (pembuatan surat bisnis, negosiasi bisnis, presentasi bisnis) Pengelolaan Bisnis Ritel Meliputi ruang lingkup bisnis ritel, proses bisnis ritel (ordering, receiving, warehousing, displaying, selling), daily activity retail, strategi bauran ritel (Produk, Harga, Promosi, Pelayanan, Fasilitas Fisik), manajemen persediaan barang dagang (pencatatan, perhitungan, dan stock opname),  waralaba, serta teknik memperoleh modal usaha. Visual Merchandising Meliputi rencana visual merchandising, implementasi visual merchandising, dan evaluasi visual merchandising Pengemasan dan Pengiriman Produk Meliputi pengemasan produk, saluran distribusi, dokumen pengiriman produk (purchase order, faktur, delivery order, delivery notes, receiving notes), dan pengiriman produk) Administrasi Transaksi Meliputi transaksi, pengoperasian alat transaksi (mesin kasir, printer struk, EDC, barcode scanner, money detector, timbangan), layanan pembayaran tunai dan non tunai (QRIS, dompet digital, uang elektronik, kartu debet, kartu kredit) dan laporan penjualan',
  cp_umum        = 'Pada akhir Fase F, murid memiliki kemampuan sebagai berikut.',
  bskap_ref      = 'SK BSKAP No. 046/H/KR/2025',
  effective_date = '2025-01-01',
  updated_at     = now()
WHERE subject_phase_id = (
  SELECT sp.subject_phase_id
  FROM core.subject_phases sp
  JOIN core.subjects s ON sp.subject_id = s.subject_id
  JOIN core.phases   p ON sp.phase_id   = p.phase_id
  WHERE s.code = 'BR' AND p.code = 'F'
);

-- ELEKTRONIKA-DASAR Fase E
UPDATE core.capaian_pembelajaran
SET
  rasional       = 'Mata pelajaran Dasar-dasar Teknik Elektronika adalah salah satu mata pelajaran yang membekali murid dengan kompetensi-kompetensi yang mendasari penguasaan keahlian teknik elektronika, yaitu melaksanakan tugas spesifik dengan menggunakan alat, informasi, dan prosedur kerja yang lazim dilakukan serta memecahkan masalah sesuai dengan bidang pekerjaan. Mata pelajaran ini merupakan fondasi bagi murid dalam memahami isu-isu penting terkait dengan teknologi manufaktur dan rekayasa pada fase berikutnya, dan merupakan dasar yang harus dimiliki sebagai landasan pengetahuan dan keterampilan dalam mempelajari materi pelajaran pada Fase F. Mata pelajaran ini bertujuan agar murid mengenal industri dan dunia kerja yang berkaitan dengan dasar-dasar teknik elektronika dan isu-isu penting dalam bidang manufaktur dan rekayasa, seperti optimasi otomasi dan pengendalian limbah. murid diperkenalkan dengan jenis-jenis industri dan dunia kerja untuk menumbuhkan passion (renjana), visi, imajinasi, dan kreativitas melalui pembelajaran berbasis proyek, belajar bersama guru tamu dari industri/praktisi bidang elektronika, dan/atau berkunjung pada industri yang relevan. Mata pelajaran ini berkontribusi dalam membentuk murid memiliki keahlian pada bidang teknik elektronika, meningkatkan lebih lanjut kemampuan logika dan teknologi digital (computational thinking), yaitu suatu cara berpikir yang memungkinkan untuk menguraikan suatu masalah menjadi beberapa bagian yang lebih kecil dan sederhana, menemukan pola masalah, serta menyusun langkah-langkah solusi mengatasi masalah melalui pembelajaran yang menekankan pada unsur terapan yang bermakna sebagai implementasi Ilmu Pengetahuan Teknologi dan Seni (IPTEKS). Mata pelajaran dasar-dasar teknik elektronika  juga penting diberikan sentuhan unsur seni utamanya terkait dengan aspek kerapian dan estetika tanpa mengesampingkan nilai fungsi untuk meningkatkan nilai keahlian pada bidang teknik elektronika. Capaian kompetensi pada mata pelajaran ini mengacu pada Keputusan Menaker dan Transmigrasi Republik Indonesia (Kepmenakertrans RI) Nomor KEP. 44/MEN/III/2011 tentang Penetapan SKKNI Sektor Jasa Elektronika Bidang Industri Elektronika Sub Bidang Pemeliharaan dan Perbaikan Produk Alat-Alat Listrik Rumah Tangga; Kepmenakertrans RI Nomor KEP. 249/MEN/IX/2009 tentang Penetapan SKKNI Sektor Industri Pengolahan Sub Sektor Industri Radio, Televisi, dan Peralatan Komunikasi serta Perlengkapannya Bidang Audio Video; Kepmenaker RI Nomor 195 tahun 2017 tentang Penetapan SKKNI Kategori Aktivitas Profesional, Ilmiah dan Teknis Golongan Pokok Aktivitas Arsitektur dan Keinsinyuran; Analisis dan Uji Teknis Bidang Instrumentasi dengan mempertimbangkan deskriptor jenjang kualifikasi 2 pada KKNI. Dasar-dasar Teknik Elektronika berkontribusi dalam membentuk kompetensi (hard skills) bersifat mendasar, soft skills dan karakter murid sehingga menjadi warga yang memiliki keimanan dan ketakwaan kepada Tuhan Yang Maha Esa, kemampuan kewargaan, penalaran kritis, kr',
  karakteristik  = 'Pada hakikatnya mata pelajaran ini fokus pada kompetensi bersifat dasar yang harus dimiliki oleh tenaga teknisi dan jabatan lain sesuai dengan perkembangan dunia kerja. Selain itu murid diberikan pemahaman tentang proses bisnis, perkembangan penerapan teknologi dan isu-isu global, entrepreneur profile, job-profile, peluang usaha dan pekerjaan/profesi. Elemen dan deskripsi elemen mata pelajaran Dasar-dasar Teknik Elektronika adalah sebagai berikut. Elemen Deskripsi Wawasan Dunia Kerja Bidang Elektronika Meliputi wawasan dunia kerja bidang elektronika, antara lain proses produksi meliputi perancangan produk, supply chain, proses produksi, quality control, dan pengemasan pada industri manufaktur dan rekayasa elektronik, perawatan peralatan produksi, pengelolaan sumber daya manusia dengan memperhatikan potensi dan kearifan lokal, revolusi industri 4.0 dalam bidang elektronika, teknologi digital dalam dunia industri memahami product life cycle, isu pemanasan global, waste control, perubahan iklim, profesi dan kewirausahaan (job profile dan technopreneurship) dalam bidang manufaktur, dan rekayasa elektronika. Kecakapan Kerja Dasar (Basic Job Skills), K3LH, dan Budaya Kerja Meliputi kecakapan kerja dasar (basic job skills), K3, dan budaya kerja, antara lain prinsip dasar, peraturan dan prosedur keselamatan dan kesehatan kerja serta lingkungan hidup (K3LH), makna rambu-rambu keselamatan dan kesehatan kerja serta lingkungan hidup (K3LH), tindakan pencegahan jenis-jenis bahaya kerja, prosedur penanganan limbah B3, prosedur dan tindakan keselamatan dan kesehatan kerja dalam kondisi berbahaya/darurat, budaya kerja 5R (ringkas, rapi, resik, rawat, rajin). Elemen Deskripsi Penggunaan Perkakas Tangan Meliputi penggunaan perkakas tangan, antara lain jenis dan fungsi perkakas tangan untuk pekerjaan mekanik elektronika, teknik penggunaan perkakas tangan untuk membuat produk elektronika sederhana mencakup pembuatan PCB, soldering, pembuatan kemasan sederhana, instalasi, pengemasan dan pengujian, serta prosedur pemeliharaan perkakas tangan sesuai standar kerja industri. Gambar Teknik Meliputi menggambar teknik listrik, elektronika, dan instrumentasi termasuk standar gambar teknik, berbagai jenis peralatan gambar teknik, simbol komponen dan rangkaian listrik, prosedur pembuatan gambar skema rangkaian dan layout PCB secara manual dan bantuan software, prosedur pembuatan gambar desain kemasan/casing produk dengan software CAD. Konsep Dasar Kelistrikan dan Elektronika Meliputi konsep dasar kelistrikan dan elektronika, antara lain konsep dasar materi dan atom, jenis-jenis bahan listrik, besaran dan karakteristik listrik dasar (tegangan, arus, resistansi dan daya), hukum dasar kelistrikan (hukum ohm, daya dan lain-lain), rangkaian seri, paralel dan campuran (dasar teknik listrik), instalasi listrik dasar, serta rangkaian aplikasi elektronika dasar dan elektronika optik. Elemen Deskripsi Alat Ukur Listrik, Elektronika, dan Instrumentasi Meliputi alat ukur listrik, elektron',
  cp_umum        = 'Pada akhir Fase E, murid memiliki kemampuan sebagai berikut.',
  bskap_ref      = 'SK BSKAP No. 046/H/KR/2025',
  effective_date = '2025-01-01',
  updated_at     = now()
WHERE subject_phase_id = (
  SELECT sp.subject_phase_id
  FROM core.subject_phases sp
  JOIN core.subjects s ON sp.subject_id = s.subject_id
  JOIN core.phases   p ON sp.phase_id   = p.phase_id
  WHERE s.code = 'ELEKTRONIKA-DASAR' AND p.code = 'E'
);

-- TEI Fase F
UPDATE core.capaian_pembelajaran
SET
  rasional       = 'Teknik Elektronika Industri adalah mata pelajaran yang berisi kompetensi yang harus dimiliki murid sebagai tenaga operator, teknisi, dan jabatan lain pada bidang teknik elektronika industri. Mata pelajaran ini diharapkan akan memampukan murid untuk: (1) melaksanakan tugas secara spesifik dengan menggunakan alat, informasi, dan prosedur kerja sesuai dengan SOP yang berlaku, serta menunjukkan kinerja dengan mutu yang terukur di bawah pengawasan; (2) menguasai pengetahuan operasional dasar elektronika dan pengetahuan faktual bidang kerja yang spesifik, sehingga mampu memilih penyelesaian yang tersedia terhadap masalah yang lazim timbul; dan (3) bertanggung jawab pada pekerjaan sendiri dan dapat diberi tanggung jawab membimbing orang lain. Mata pelajaran ini juga dapat menjadi bekal bagi murid untuk bekerja, melanjutkan ke jenjang yang lebih tinggi, ataupun berwirausaha sesuai kompetensinya. Materi dan capaian kompetensi pada mata pelajaran ini merujuk pada Kepmenaker RI Nomor 44 Tahun 2011 tentang Penetapan Rancangan SKKNI Bidang Jasa Elektronika Sub Bidang Pemeliharaan dan Perbaikan Produk Alat-Alat Listrik Rumah Tangga menjadi SKKNI, Kepmenaker RI Nomor 211 Tahun 2019 tentang SKKNI Kategori Industri Pengolahan Golongan Pokok Industri Komputer, Barang Elektronik dan Optik Bidang Elektronika Prototipe dan Pemrograman, dan Kepmenaker RI Nomor 631 Tahun 2016 tentang Penetapan SKKNI Kategori Industri Pengolahan Golongan Pokok Industri Mesin dan Perlengkapan YTDL Bidang Otomasi Industri dengan mempertimbangkan deskriptor jenjang kualifikasi 2 pada KKNI. Pelaksanaan pembelajaran Teknik Elektronika Industri berpusat pada murid (student-centered learning) dengan dapat menerapkan pembelajaran berbasis inkuiri (inquiry-based learning), pembelajaran berbasis masalah (problem-based learning), pembelajaran berbasis projek (project-based learning), teaching factory, pembelajaran mendalam (deep learning), belajar bersama guru tamu dari industri/praktisi bidang elektronika, berkunjung pada industri yang relevan, serta praktik langsung di dunia kerja, atau model pembelajaran lain yang relevan dalam rangka mewujudkan dimensi profil lulusan, yaitu keimanan dan ketakwaan terhadap Tuhan Yang Maha Esa, kewargaan, kreativitas, penalaran kritis, kolaborasi, kemandirian, kesehatan, dan komunikasi.',
  karakteristik  = 'Mata pelajaran ini berbasis pada capaian kompetensi kerja yang harus dimiliki murid sebagai tenaga operator, teknisi elektronika, dan jabatan teknis lain sesuai dengan standar kualifikasi industri pada bidang teknik elektronika industri. Mata pelajaran ini membekali murid untuk bekerja, berwirausaha, dan melanjutkan studi tentang teknik elektronika industri. Elemen dan deskripsi elemen mata pelajaran Teknik Elektronika Industri adalah sebagai berikut. Elemen Deskripsi Penerapan Rangkaian Elektronika Meliputi penerapan penguat Op-Amp yang diaplikasikan sebagai rangkaian elektronika analog dan rangkaian elektronika digital. Sistem Kendali Elektronik Meliputi sistem pengendali analog, sistem pengendali digital, dan rangkaian isolasi elektronik. Pemrograman Sistem Embedded Meliputi sistem embedded dan menerapkan bahasa pemrograman pada sistem embedded. Antarmuka dan Komunikasi Data Meliputi antarmuka dan komunikasi data dengan memanfaatkan software Object Oriented Programming (OOP). Sistem Kendali Industri Meliputi sistem kendali industri dengan menggunakan relay logic, PLC, dan HMI. Pemeliharaan dan Perbaikan Peralatan Elektronika Industri Meliputi POS pemeliharaan dan perbaikan peralatan elektronika industri.',
  cp_umum        = 'Pada akhir Fase F, murid memiliki kemampuan sebagai berikut.',
  bskap_ref      = 'SK BSKAP No. 046/H/KR/2025',
  effective_date = '2025-01-01',
  updated_at     = now()
WHERE subject_phase_id = (
  SELECT sp.subject_phase_id
  FROM core.subject_phases sp
  JOIN core.subjects s ON sp.subject_id = s.subject_id
  JOIN core.phases   p ON sp.phase_id   = p.phase_id
  WHERE s.code = 'TEI' AND p.code = 'F'
);

-- BROADCASTING-DASAR Fase E
UPDATE core.capaian_pembelajaran
SET
  rasional       = 'Mata pelajaran Dasar-dasar Animasi merupakan fondasi keahlian dalam program keahlian animasi yang dirancang untuk membekali murid dengan kompetensi teknis, kreativitas, dan kemampuan analitis dalam bidang seni dan ekonomi kreatif. Ruang lingkup pembelajaran mencakup lima aspek utama: (1) Seni Teknologi Animasi (penguasaan perangkat analog/digital 2D/3D), (2) Seni Produksi Animasi (pemahaman alur kerja pra-produksi hingga pasca produksi), (3) Seni Visual dan Komposisi (pengelolaan bidang, bentuk, warna, dan tata letak), (4) Seni Gerak (prinsip gerak dalam produksi animasi), dan (5) Seni Penceritaan (teknik komunikasi ide melalui visual). Materi ini disusun berdasarkan Kepmenaker RI Nomor 173 Tahun 2020 tentang SKKNI Bidang Animasi, dengan capaian kompetensi operasional seperti pelaksanaan tugas spesifik, pemecahan masalah umum, serta tanggung jawab dalam pekerjaan mandiri dan kolaboratif. Pembelajaran mengadopsi pendekatan deep learning berbasis proyek kontekstual (project-based learning, problem-based learning) untuk mengintegrasikan observasi kritis terhadap fenomena alam, sosial, dan budaya dengan eksplorasi kreatif. Murid terlibat dalam simulasi produksi nyata, seperti merancang animasi pendek bertema lingkungan atau mendesain karakter yang merefleksikan kearifan lokal. Melalui proyek ini, mereka menguasai prinsip animasi dasar (misalnya: squash & stretch, timing), teknik digital (rigging, motion design), serta keterampilan berpikir tingkat tinggi (critical thinking, creative problem-solving). Pendidik berperan sebagai fasilitator yang mendorong eksperimen teknis, refleksi kritis, dan adaptasi terhadap umpan balik konstruktif, sementara metode simulasi studio animasi menghadirkan tantangan industri seperti manajemen waktu dan standar kualitas profesional. Proses pembelajaran dirancang untuk menumbuhkan kemandirian, komunikasi efektif, dan kemampuan menghubungkan konsep abstrak dengan aplikasi praktis. Penilaian holistik berbasis portofolio dan observasi proses memastikan perkembangan multidimensi, mencakup aspek teknis, kreativitas, serta keterampilan metakognitif. Dengan demikian, lulusan tidak hanya menguasai alat dan prosedur kerja animasi, tetapi juga siap beradaptasi dengan dinamika industri kreatif yang dinamis, menjawab tantangan produksi profesional melalui karya inovatif dan bernilai aplikatif.',
  karakteristik  = 'Pada hakikatnya mata pelajaran Dasar-dasar Broadcasting dan Perfilman merupakan mata pelajaran yang menjadi pondasi program keahlian Broadcasting dan Perfilman sesuai dengan perkembangan dunia kerja. Mata pelajaran ini mempunyai beberapa materi ajar yang beragam yang dipelajari melalui pengetahuan dan praktik dengan porsi dominan pada pemahaman, serta memiliki dinamika yang tinggi karena selalu terkait dengan perkembangan teknologi. Elemen dan deskripsi elemen mata pelajaran Dasar-dasar Broadcasting dan Perfilman adalah sebagai berikut. Elemen Deskripsi Dunia Kerja, Profesi, dan Bisnis di Bidang Broadcasting dan Perfilman Meliputi pemahaman dunia kerja, profesi, technopreneur, bidang kerja serta level pekerjaan, dan prosedur operasional standar (POS) divisi kerja di bidang Broadcasting dan Perfilman Elemen Deskripsi untuk membentuk  kecakapan kerja dasar (basic job skills), K3, dan budaya kerja.  Serta pemahaman potensi budaya serta kearifan lokal sebagai ide produksi industri radio, pertelevisian, dan perfilman yang dapat dijadikan peluang usaha dan dunia kerja/profesi dalam industri broadcasting dan perfilman. Perkembangan Media, Teknologi, dan Industri Serta Regulasi di Bidang Broadcasting dan Perfilman Meliputi pengenalan media (dari media analog hingga new media), perkembangan media digital (perkembangan proses produksi industri broadcasting dari media analog sampai dengan media digital, FTA dan OTT, podcast, live streaming, live casting, streaming tv, web series dan video on demand, jenis media digital, Undang-undang Informasi dan Transaksi Elektronik dan Kecerdasan Buatan (Artificial Intelligence), isu pemanasan global, perubahan iklim, aspek-aspek ketenagakerjaan, dan life cycle produk industri sampai dengan reuse dan recycling. Teknik Dasar Pengoperasian Peralatan Audio Visual Pada Industri Broadcasting dan Perfilman Meliputi pemahaman dan penerapan fotografi dasar, tata kamera dasar, tata artistik dasar, tata suara dasar serta dasar editing audio dan video, dan praktik singkat pengoperasian peralatan audio dan video. Teknik Dasar Proses Produksi Pada Industri Broadcasting dan Perfilman Serta Meliputi penerapan simulasi tahapan produksi sesuai Prosedur Operasional Standar (POS) yang diaplikasikan melalui proyek atau produksi audio visual sederhana. Elemen Deskripsi Media Baru (New Media) Secara Kreatif dan Inovatif',
  cp_umum        = 'Pada akhir Fase E, murid memiliki kemampuan sebagai berikut.',
  bskap_ref      = 'SK BSKAP No. 046/H/KR/2025',
  effective_date = '2025-01-01',
  updated_at     = now()
WHERE subject_phase_id = (
  SELECT sp.subject_phase_id
  FROM core.subject_phases sp
  JOIN core.subjects s ON sp.subject_id = s.subject_id
  JOIN core.phases   p ON sp.phase_id   = p.phase_id
  WHERE s.code = 'BROADCASTING-DASAR' AND p.code = 'E'
);

-- KK-PSPT Fase F
UPDATE core.capaian_pembelajaran
SET
  rasional       = 'Produksi dan Siaran Program Televisi adalah mata pelajaran pada Fase F yang merupakan bagian pada Bidang Keahlian Seni dan Ekonomi Kreatif, Program Keahlian Broadcasting dan Perfilman.  Mata pelajaran ini bertujuan membekali murid dari sisi softskills untuk mengembangkan kreativitas, kepekaan estetis, melatih sensitivitas terhadap lingkungan sosial, fenomena alam serta kehidupan dilingkungan sekitarnya dan hardskills agar mampu melaksanakan tugas spesifik dalam mencari informasi, menjalankan prosedur kerja, dan mengoperasikan peralatan sesuai dengan Prosedur Operasional Standar (POS) dengan standar mutu di bawah pengawasan pembimbing; Menguasai pengetahuan dasar operasional dan faktual di bidang kerja yang relevan untuk menyelesaikan masalah yang umum terjadi; dan bertanggung jawab atas pekerjaan sendiri serta mampu bekerja dalam tim (teamwork) dalam produksi dan siaran program televisi maupun media baru (new media) secara kreatif dan inovatif. Mata pelajaran ini merupakan mata pelajaran kejuruan yang terdiri dari materi dasar pada masing-masing divisi kerja utama dalam Produksi dan Siaran Program Televisi didasarkan pada skema sertifikasi okupasi Content Creator Junior, skema sertifikasi okupasi Operator Audio Visual, SKKNI area kerja Video Editing, dan Peta Okupasi Nasional dalam Kerangka Kualifikasi Bidang Komunikasi Tahun 2018 area fungsi Penyiaran TV Nomor 70/KOMINFO/BLSDM/KS. 01. 07/4/2018 disahkan tanggal 25 April 2018 dengan mempertimbangkan deskripsi jenjang kualifikasi 2 pada KKNI. Sebagai landasan konsentrasi keahlian pada Fase F, pembelajaran ini dirancang selaras dengan kebutuhan dan perkembangan dunia kerja. Oleh karena itu, kerja sama dengan mitra industri menjadi kunci dalam pengembangan kurikulum operasional di satuan pendidikan. Beragam pendekatan dan model pembelajaran diterapkan untuk menciptakan suasana belajar yang interaktif, menyenangkan, dan menantang, seperti project-based learning, teaching factory, discovery-based learning, problem-based learning, inquiry-based learning, atau model relevan lainnya. Mata pelajaran ini berkontribusi membentuk murid yang beriman dan bertakwa kepada Tuhan Yang Maha Esa, berakhlak mulia, bernalar kritis, mandiri, kreatif, komunikatif, serta adaptif dalam menghadapi dinamika di lingkungan sekitarnya.',
  karakteristik  = 'Mata pelajaran Produksi dan Siaran Program Televisi mempunyai beberapa materi ajar yang beragam, yang dipelajari melalui pengetahuan dan praktik dengan porsi dominan pada pemahaman, penguasaan teknis yang disesuaikan untuk murid di Fase F atau sesuai output yang diajukan oleh mitra dunia kerja, serta memiliki dinamika yang tinggi karena selalu terkait dengan perkembangan teknologi dan tren di masyarakat. Elemen dan deskripsi elemen mata pelajaran Produksi dan Siaran Program Televisi adalah sebagai berikut. Elemen Deskripsi Manajemen Produksi dan Siaran Program Televisi Meliputi prosedur operasional standar dalam tahapan produksi, organisasi penyiaran televisi, pengelolaan sumber daya produksi, perencanaan program siaran yang kreatif dan menarik.  Pada elemen ini murid  membuat rencana produksi program televisi dengan mempertimbangkan tren yang berkembang, menentukan jenis format dan pola acara siaran, menentukan target penonton, dan melakukan pengelolaan siaran. Penulisan Naskah Televisi Meliputi  prosedur operasional standar penyusunan naskah produksi untuk siaran artistik, dan jurnalistik.  Murid menyusun naskah program televisi sesuai dengan format naskah, jenis naskah, dan struktur penulisan. Penyutradaraan Televisi Meliputi prosedur operasional standar penyutradaraan untuk produksi single camera system dan multicamera system, menganalisis naskah, menerapkan mise en scene, Elemen Deskripsi sinematografi, dan aba-aba sutradara untuk produksi dan siaran program televisi. Tata Kamera dan Tata Cahaya Televisi Meliputi K3LH dan prosedur operasional standar pengambilan gambar pada produksi single camera system dan multicamera system. Murid menerapkan pembingkaian gambar (framing), mengidentifikasi kamera dan peralatan pencahayaan, dan aksesori atau peralatan pendukungnya. Tata Suara Televisi Meliputi K3LH dan prosedur operasional standar penggunaan peralatan tata suara televisi pada produksi single camera system dan multicamera system. Murid mengidentifikasi anatomi peralatan, jenis-jenis peralatan tata suara dan aksesori atau peralatan pendukungnya. Murid menganalisis naskah, mengidentifikasi kebutuhan peralatan,  mengatur sound recorder, menerapkan blocking mikrofon, dan pengambilan gambar sesuai naskah. Tata Artistik Televisi Meliputi standar operasional prosedur kerja departemen tata artistik pada produksi dan siaran program televisi. Murid menganalisis naskah, membuat rencana set berupa  denah lokasi atau floorplan, dan sketsa desain set. Murid mengidentifikasi kebutuhan  properti, hand property, kostum atau wardrobe, make up, dan hair style. Elemen Deskripsi Editing Audio dan Video Meliputi prosedur operasional standar pada penggunaan peralatan editing audio video. Murid menganalisis naskah, menerapkan manajemen file hasil syuting, memilih software editing audio dan video, dan memadukan audio dan video sesuai naskah, dan membuat dokumen syuting dan dokumen kerja editing. Penyiaran Online Meliputi prosedur dalam  menyusun konsep, membuat renca',
  cp_umum        = 'Pada akhir Fase F, murid memiliki kemampuan sebagai berikut.',
  bskap_ref      = 'SK BSKAP No. 046/H/KR/2025',
  effective_date = '2025-01-01',
  updated_at     = now()
WHERE subject_phase_id = (
  SELECT sp.subject_phase_id
  FROM core.subject_phases sp
  JOIN core.subjects s ON sp.subject_id = s.subject_id
  JOIN core.phases   p ON sp.phase_id   = p.phase_id
  WHERE s.code = 'KK-PSPT' AND p.code = 'F'
);

-- BUSANA-DASAR Fase E
UPDATE core.capaian_pembelajaran
SET
  rasional       = 'Mata pelajaran Dasar-dasar Busana merupakan mata pelajaran kejuruan yang terdiri dari berbagai ilmu dasar sebagai penentu dalam mempelajari mata pelajaran yang lain dalam program keahlian Busana mencakup pemahaman akan gaya hidup, perubahan selera (tren) hingga proses desain, produksi, dan marketing. Selain itu, sebagai landasan pengetahuan dan keterampilan untuk pembelajaran pada Fase F. Pelaksanaan pembelajaran Dasar-dasar Busana berpusat pada murid (student-centered learning) dengan dapat menerapkan berbagai pendekatan, strategi, metode, serta model yang sesuai dengan karakteristik kompetensi yang harus dipelajari sehingga dapat menciptakan pembelajaran yang interaktif, inspiratif, menyenangkan, menantang, memotivasi murid untuk berpartisipasi aktif, serta memberikan ruang yang cukup bagi prakarsa, kreativitas, kemandirian sesuai dengan bakat, minat, renjana, dan perkembangan fisik serta psikologis murid. Model-model pembelajaran yang dapat digunakan antara lain project-based learning, teaching factory, discovery-based learning, problem-based learning, inquiry-based learning, atau model lainnya serta metode yang relevan. Mata pelajaran Dasar-dasar Busana tidak hanya meliputi proses pembuatan busana mulai dari gambar, membuat pola, dan menjahit, namun murid diajak untuk memahami secara menyeluruh ekosistem industri fashion yaitu kreasi, produksi dan marketing. Materi dan capaian kompetensi pada mata pelajaran ini merujuk pada  Kepmenakertrans RI Nomor 78 Tahun 2014 tentang Penetapan SKKNI Kategori Industri Pengolahan, Golongan Pokok Produksi Industri Pakaian Jadi, Area Kerja Desain Busana; Kepmenaker RI Nomor 209 Tahun 2019 tentang Penetapan SKKNI Kategori Industri Pengolahan Golongan Pokok Industri Pakaian Jadi Bidang Teknologi Fesyen dan Desain Fesyen dengan mempertimbangkan deskriptor jenjang kualifikasi 2 pada KKNI; dan  Kepmenaker RI Nomor 240 Tahun 2022 tentang Penetapan SKKNI Kategori Aktivitas Profesional, Ilmiah dan Teknis Golongan Pokok Aktivitas Profesional, Ilmiah dan Teknis Lainnya Bidang Aktivitas Desain Tekstil, Fashion dan Apparel Sub Bidang Kreasi Fashion Ready to Wear dengan mempertimbangkan deskriptor jenjang kualifikasi 2 pada KKNI. Mata pelajaran Dasar-dasar Busana diharapkan akan memampukan murid untuk (1) melaksanakan tugas spesifik dengan menggunakan alat, informasi, dan prosedur, kerja yang lazim dilakukan, serta menunjukkan kinerja dengan mutu yang terukur di bawah pengawasan; (2) menguasai pengetahuan operasional dasar dan pengetahuan faktual bidang kerja yang spesifik, sehingga mampu memilih penyelesaian yang tersedia terhadap masalah yang lazim timbul; dan (3) bertanggung jawab pada pekerjaan sendiri dan dapat dapat diberi tanggung jawab membimbing orang lain. Mata pelajaran Dasar-dasar Busana juga meliputi proses pengamatan, eksplorasi serta eksperimen untuk menumbuhkan kreativitas dalam rangka mewujudkan kelulusan, mengasah kepekaan estetis, menemukan bentuk visual yang inovatif dan imajinatif disesuaikan dengan p',
  karakteristik  = 'Pada hakikatnya mata pelajaran Dasar-dasar Busana fokus pada kompetensi bersifat dasar yang harus dimiliki oleh tenaga keahlian busana yang bukan hanya mencakup keterampilan teknis pembuatan busana namun meliputi sisi kreasi, produksi, dan marketing. Selain itu murid diberikan pemahaman tentang dasar-dasar busana, perkembangan penerapan teknologi dan isu-isu global, profil entrepreneur, job-profile, peluang usaha, dan pekerjaan/profesi. Elemen dan deskripsi elemen mata pelajaran Dasar-dasar Busana adalah sebagai berikut. Elemen Deskripsi Wawasan Dunia Kerja Bidang Industri Busana (Fesyen) Meliputi gambaran menyeluruh tentang ekosistem industri mode dan perkembangan terkini dalam dunia fashion, peluang pasar serta profesi kewirausahaan di bidang busana. Murid didorong untuk membangun visi dan passion sebagai calon entrepreneur maupun technopreneur. Pemahaman tentang aspek ketenagakerjaan, serta perkembangan proses produksi pada industri busana (fesyen) mulai dari konvensional hingga penggunaan alat/mesin dengan teknologi modern, baik untuk produksi busana secara massal maupun custom made disertai dengan pengetahuan perawatan peralatan, menjadi bekal keterampilan teknis yang penting. Materi yang mencakup Product Life Cycle dan berbagai model bisnis di industri fashion, berpadu dengan pemanfaatan teknologi digital untuk mendukung inovasi. Isu keberlanjutan sustainable fashion meliputi 3 aspek, yaitu aspek lingkungan, aspek sosial, dan aspek ekonomi. Dampak pemanasan global di sektor fesyen perlu dibahas, guna Elemen Deskripsi menumbuhkan kesadaran akan pentingnya praktek industri yang bertanggung jawab secara sosial dan lingkungan. Kecakapan Kerja Dasar (Basic Job Skills), K3 dan Budaya Kerja) Meliputi pengetahuan dan keterampilan dasar dan komprehensif dalam bidang busana, dimulai dari etika kerja dan keselamatan kerja (K3) serta budaya kerja 5R yang membentuk sikap profesional di lingkungan industri terutama pada kepribadian dan sikap dalam bekerja dibidang busana. Pada aspek desain, murid akan mempelajari dasar-dasar ilustrasi anatomi tubuh, pengetahuan warna, unsur dan prinsip desain, style dan look (six basic style), eksplorasi gaya dan selera sesuai dengan perkembangan mode dan tren, sumber ide, kolase dan desain busana sesuai tema, aplikasi gambar penunjang desain busana serta penggambaran digital untuk menciptakan desain yang selaras dengan tren dan selera pasar. Untuk aspek pola dan menjahit, murid harus menguasai proses konstruksi busana secara menyeluruh, mulai dari pengukuran tubuh, pembuatan pola dasar dan pengembangannya, prosedur pemotongan bahan, dasar menjahit, pengoperasian dan perbaikan mesin jahit dan mesin penyelesaian hingga teknik menjahit sesuai dengan jenis-jenis bahan, penekanan pada standar kualitas dan hasil akhir finishing produk. Murid Elemen Deskripsi juga harus memahami aspek pengembangan produk berbasis potensi dan kearifan lokal, serta membangun identitas merek (DNA brand), memahami segmentasi pasar, dan menerapkan ',
  cp_umum        = 'Pada akhir Fase E, murid memiliki kemampuan sebagai berikut.',
  bskap_ref      = 'SK BSKAP No. 046/H/KR/2025',
  effective_date = '2025-01-01',
  updated_at     = now()
WHERE subject_phase_id = (
  SELECT sp.subject_phase_id
  FROM core.subject_phases sp
  JOIN core.subjects s ON sp.subject_id = s.subject_id
  JOIN core.phases   p ON sp.phase_id   = p.phase_id
  WHERE s.code = 'BUSANA-DASAR' AND p.code = 'E'
);

-- KK-DPB Fase F
UPDATE core.capaian_pembelajaran
SET
  rasional       = 'Ekonomi kreatif mengandalkan sumber daya insani sebagai modal utama, terutama proses penciptaan, kreativitas, keahlian dan talenta individual. Salah satu subsektor dari industri kreatif adalah bidang fesyen, yaitu usaha kreatif yang berhubungan dengan desain dan produksi busana. Bidang keahlian busana sangat dibutuhkan saat ini karena menjadi salah satu elemen penting dari gaya hidup yang diperlukan manusia modern di era global ini. Desain dan Produksi Busana merupakan mata pelajaran yang berisi kompetensi-kompetensi yang harus dimiliki dalam penguasaan keahlian busana yang mencakup pemahaman selera dan gaya hidup yang kemudian diterjemahkan dalam desain dan produksi busana. Mata pelajaran ini diharapkan akan memampukan murid untuk: (1) melaksanakan tugas spesifik dengan menggunakan alat, informasi, dan prosedur kerja yang lazim dilakukan, serta menunjukkan kinerja dengan mutu yang terukur di bawah pengawasan; (2) menguasai pengetahuan operasional dasar dan pengetahuan faktual bidang kerja yang spesifik sehingga mampu memilih penyelesaian yang tersedia terhadap masalah yang lazim timbul; dan (3) bertanggung jawab pada pekerjaan sendiri dan dapat diberi tanggung jawab membimbing orang lain. Mata pelajaran Desain dan Produksi Busana berisi pilihan elemen-elemen yang terkait dalam penguasaan keahlian pengembangan desain dan produksi busana. Desain dan Produksi Busana ini lebih menitikberatkan pada pembentukan karakter kerja. Materi dan capaian kompetensi pada mata pelajaran ini merujuk pada Kepmenakertrans RI Nomor 90/MEN/V/2010 tentang Penetapan Rancangan SKKNI Sektor Industri Tekstil dan Barang Tekstil Bidang Garmen Bidang Custom Made Sub Bidang Custom Made Wanita menjadi SKKNI; Keputusan Menteri Ketenagakerjaan Republik Indonesia Nomor 209 Tahun 2019 tentang Penetapan Standar Kompetensi Kerja Nasional Indonesia Kategori Industri Pengolahan Golongan Pokok Industri Pakaian Jadi Bidang Teknologi Fesyen dan Desain Fesyen; dan Kepmenaker RI Nomor 240 Tahun 2022 tentang Penetapan SKKNI Kategori Aktivitas Profesional, Ilmiah dan Teknis Golongan Pokok Aktivitas Profesional, Ilmiah dan Teknis Lainnya Bidang Aktivitas Desain Tekstil, Fashion dan Apparel Sub Bidang Kreasi Fashion Ready to Wear dengan mempertimbangkan deskriptor jenjang kualifikasi 2 pada KKNI. Pelaksanaan pembelajaran mata pelajaran ini berpusat pada murid (student-centered learning) dengan menerapkan model-model pembelajaran yang dapat digunakan, antara lain project-based learning, teaching factory, discovery-based learning, problem-based learning, inquiry-based learning, atau model lainnya dan metode lain yang relevan. Murid juga diajak untuk mengamati fenomena alam dan kehidupan melalui pendekatan sustainable fashion yang menjadi dasar industri fashion global. Proses pembelajaran pada mata pelajaran ini akan membentuk soft skills dan hard skills. Dengan model belajar project based learning, murid didorong untuk menemukan fakta-fakta, membangun konsep, melakukan eksplorasi secara prosedur',
  karakteristik  = 'Mata pelajaran Desain dan Produksi Busana berfokus pada penguatan soft skills, hard skills, dan karakter kerja profesional dalam bidang pekerjaan desain dan produksi busana yang relevan dengan perkembangan dunia kerja dan industri kreatif. Pembelajaran Desain dan Produksi Busana mendorong murid untuk menerapkan kompetensi lanjutan dari capaian pembelajaran dasar-dasar keahlian busana Selain itu, murid diharapkan mampu berwirausaha secara mandiri dalam bidang Desain dan Produksi Busana termasuk melanjutkan pendidikan ke jenjang lebih tinggi sesuai dengan bidang keahliannya. Karakteristik Desain dan Produksi Busana pada Fase F terletak pada pengembangan ide desain yang lebih kompleks dengan mempertimbangkan trend, fungsi, kesempatan dan estetika dalam sebuah desain busana dengan menggunakan teknik manual atau dengan perangkat digital (Ibis Paint X, CLO, AI dan sebagainya). Di samping itu, dalam produksi busana lebih menekankan pada penguasaan teknik menjahit lanjutan dengan penguasaan pembuatan busana secara kompleks sesuai desain dan dapat menggunakan berbagai peralatan menjahit secara up to date hingga dapat menguasai perhitungan penjualan busana dengan tepat. Pada Fase F, murid diarahkan untuk mengintegrasikan keterampilan desain dan produksi busana secara utuh dengan pendekatan berbasis projek, mendekati standar industri, dan menumbuhkan sikap profesional serta kreatif sebagai calon tenaga kerja atau wirausaha di bidang fashion. Mata pelajaran Desain dan Produksi Busana merupakan pondasi untuk dapat mewujudkan produk dari desain yang dirancang sesuai output yang diinginkan oleh konsumen dan/atau mitra dunia kerja. Elemen dan deskripsi elemen mata pelajaran Desain dan Produksi Busana adalah sebagai berikut. Elemen Deskripsi Gaya dan Pengembangan Desain Meliputi penyajian karya dan pengembangan desain pada satu konsep gaya (style); menerapkan trend; menerapkan sustainable fashion; dan penerapan tema desain busana sesuai dengan figure dan gesture disertai detail rancangan tampak depan dan belakang untuk kebutuhan produksi (technical drawing) secara manual maupun digital. Eksperimen Tekstil dan Desain Hiasan Meliputi penerapan desain dan olah tekstil yang disesuaikan dengan kebutuhan industri dan kebudayaan daerah (batik/tenun/motif printing/mengolah bahan); menerapkan desain hiasan (renda/sulaman/kancing hias/bordir). Persiapan Pembuatan Busana Meliputi penerapan lembar kerja sesuai dengan spesifikasi desain, menerapkan langkah kerja produksi, mengambil ukuran, membuat pola, memotong bahan, menghitung biaya, dan menentukan harga produk. Menjahit Produk Busana Meliputi menjahit sesuai dengan prosedur, menerapkan trimming dan pressing, mengawasi mutu produk busana, menerapkan packaging busana, serta menerapkan penyelesaian akhir busana. Elemen Deskripsi Penyusunan Koleksi Busana Meliputi perencanaan proyek pembuatan koleksi busana, dan presentasi koleksi secara kelompok.',
  cp_umum        = 'Pada akhir Fase F, murid memiliki kemampuan sebagai berikut.',
  bskap_ref      = 'SK BSKAP No. 046/H/KR/2025',
  effective_date = '2025-01-01',
  updated_at     = now()
WHERE subject_phase_id = (
  SELECT sp.subject_phase_id
  FROM core.subject_phases sp
  JOIN core.subjects s ON sp.subject_id = s.subject_id
  JOIN core.phases   p ON sp.phase_id   = p.phase_id
  WHERE s.code = 'KK-DPB' AND p.code = 'F'
);

-- SPERTUNJUKAN-DASAR Fase E
UPDATE core.capaian_pembelajaran
SET
  rasional       = 'Mata pelajaran Dasar-dasar Seni Pertunjukan merupakan mata pelajaran kejuruan yang memuat kompetensi-kompetensi fundamental sebagai dasar untuk menguasai keahlian di bidang seni pertunjukan. Mata pelajaran ini penting karena tidak hanya membekali murid dengan pengetahuan dan keterampilan teknis, tetapi juga menanamkan sikap profesional serta membangun rencana (passion) terhadap dunia seni pertunjukan. Secara filosofis, mata pelajaran ini berangkat dari keyakinan bahwa seni pertunjukan bukan hanya sebagai ekspresi estetis, melainkan juga sebagai wahana untuk menumbuhkan kepekaan, imajinasi, serta daya cipta murid yang esensial bagi pertumbuhan pribadi maupun sosial. Dalam konteks perkembangan IPTEKS, mata pelajaran ini mendorong pemanfaatan teknologi dalam produksi seni pertunjukan, memahami proses bisnis kreatif, serta mengaitkan perkembangan seni dengan isu global dan lokal, seperti ekologi budaya, transformasi digital, serta industri kreatif. Mata pelajaran Dasar-dasar Seni Pertunjukan dalam pembelajarannya murid diarahkan untuk menguasai sejumlah elemen penting. Pertama, pada elemen Wawasan Budaya Kerja Bidang Seni Pertunjukan, murid mampu memahami lingkup pekerjaan atau profesi, peluang usaha, ekonomi kreatif, serta proses bisnis dalam industri seni pertunjukan, juga perkembangan teknologi dan isu global yang relevan. Kedua, dalam elemen Konsep Seni Pertunjukan, murid mampu memahami konsep-konsep mendasar yang membentuk struktur dan makna pertunjukan. Ketiga, melalui elemen Dasar-dasar Produksi Seni Pertunjukan, murid mampu menerapkan dasar-dasar keproduksian dalam praktik seni pertunjukan. Terakhir, dalam elemen Kecakapan Kerja Dasar (Basic Job Skills), K3, dan Budaya Kerja, murid mampu menerapkan prinsip K3 (Keselamatan dan Kesehatan Kerja) dan budaya kerja dalam merawat peralatan sesuai kebutuhan pementasan serta menguasai teknik dasar seni pertunjukan secara komprehensif sesuai bidang keahlian yang dipilih. Hubungan antar mata pelajaran juga erat, seperti dengan Bahasa Indonesia (ekspresi verbal dan komunikasi), Ilmu Sosial (konteks budaya dan sosial), dan Informatika (multimedia dan teknologi pertunjukan). Berdasarkan Kepmenaker RI Nomor 132 Tahun 2019 dan jenjang kualifikasi KKNI level 2, pembelajaran ini bertujuan membentuk murid yang mampu menjalankan tugas spesifik secara profesional, bertanggung jawab, dan mampu membimbing orang lain. Proses pembelajaran bersifat student-centered, interaktif, dan kontekstual melalui model seperti project-based learning, problem-based learning, discovery learning, hingga teaching factory. Dengan pendekatan ini, Dasar-dasar Seni Pertunjukan berkontribusi dalam membentuk murid yang berkarakter, kreatif, mampu bekerja dalam tim, berakhlak mulia, serta mewujudkan delapan dimensi profil lulusan yang Keimanan dan Ketakwaan terhadap Tuhan Yang Maha Esa, kewargaan, penalaran kritis, kreativitas, kolaborasi, kemandirian, kesehatan, dan komunikasi.',
  karakteristik  = 'Pada hakikatnya mata pelajaran Dasar-dasar Seni Pertunjukan berfokus pada kompetensi bersifat dasar yang harus dimiliki oleh seniman dalam bidang seni pertunjukan sesuai dengan situasi, kondisi, dan perkembangan dunia kerja. Selain itu, murid diberikan pemahaman tentang proses bisnis, perkembangan penerapan teknologi dan isu-isu global, profil entrepreneur, job profile, peluang usaha, dan pekerjaan/profesi. Elemen dan deskripsi elemen mata pelajaran Dasar-dasar Seni Pertunjukan adalah sebagai berikut. Elemen Deskripsi Wawasan Budaya Kerja Bidang Seni Pertunjukan Meliputi pekerjaan atau profesi dalam bidang seni pertunjukan, peluang usaha di bidang seni dan ekonomi kreatif untuk membangun visi dan Elemen Deskripsi passion, yang diimplementasikan dalam pembelajaran berbasis projek nyata. Konsep Seni Pertunjukan Meliputi pemberian pengetahuan, wawasan, dan pemahaman tentang unsur-unsur dalam seni pertunjukan terdiri dari sejarah, fungsi, jenis, cabang, ciri, estetika, dan apresiasi yang dilakukan dengan kajian interdisiplin. Dasar-dasar Produksi Seni Pertunjukan Meliputi kegiatan kreatif pengembangan konten, produksi pertunjukan, dan penyajian seni pertunjukan. Kecakapan Kerja Dasar (Basic Job Skills), K3 dan Budaya Kerja Meliputi sikap, pengetahuan, dan keterampilan dasar sesuai dengan kompetensi yang dipilih terdiri teknik, etude, dan repertoar.',
  cp_umum        = 'Pada akhir Fase E, murid memiliki kemampuan sebagai berikut.',
  bskap_ref      = 'SK BSKAP No. 046/H/KR/2025',
  effective_date = '2025-01-01',
  updated_at     = now()
WHERE subject_phase_id = (
  SELECT sp.subject_phase_id
  FROM core.subject_phases sp
  JOIN core.subjects s ON sp.subject_id = s.subject_id
  JOIN core.phases   p ON sp.phase_id   = p.phase_id
  WHERE s.code = 'SPERTUNJUKAN-DASAR' AND p.code = 'E'
);

-- KK-SENI-TARI Fase F
UPDATE core.capaian_pembelajaran
SET
  rasional       = 'Seni Tari merupakan mata pelajaran yang berisi kompetensi mendasar dari penguasaan keahlian pekerjaan di bidang seni pertunjukan, yang menghantarkan murid untuk dapat memiliki keahlian sebagai penari dan penataan tari. Dengan penguasaan elemen tari tradisi dan elemen tari kreasi maka diperlukan adanya pemahaman tentang teknik gerak, keragaman gerak, karakteristik tarian, fungsi tari, serta kreativitas tari yang sesuai dengan tema. Tertera dalam Kepmenaker RI Nomor 86 Tahun 2019 tentang SKKNI Kategori Kesenian, Hiburan dan Rekreasi Golongan Pokok Aktivitas Hiburan, Kesenian dan Kreativitas Bidang Seni Tari dengan mempertimbangkan deskripsi jenjang kualifikasi 2 pada Kerangka Kualifikasi Nasional Indonesia (KKNI). Mata pelajaran Seni Tari berfungsi untuk menumbuhkembangkan profesionalisme dan kebanggaan murid terhadap keanekaragaman budaya bangsa sebagai pijakan proses bisnis entertainment untuk memasuki dunia kerja. Selain penguasaan pada profesional seni tari, murid juga memahami isu-isu global dunia industri, mengenali berbagai macam profesi, okupasi kerja dan peluang usaha, serta menganalisis konsep entrepreneur berbasis budaya tradisi. Mata pelajaran ini juga diharapkan akan memampukan murid untuk (1) melaksanakan tugas spesifik dengan menggunakan alat, informasi, prosedur kerja yang lazim dilakukan, dan menunjukkan kinerja dengan mutu yang terukur di bawah pengawasan; (2) menguasai pengetahuan operasional dasar dan pengetahuan faktual bidang kerja yang spesifik sehingga mampu memilih penyelesaian yang tersedia terhadap masalah yang lazim timbul; serta (3) bertanggung jawab pada pekerjaan sendiri dan dapat diberi tanggung jawab membimbing orang lain. Mata pelajaran Seni Tari di dalamnya memuat beberapa elemen yang terkait untuk mendukung ketercapaian pembelajaran. Elemen yang dimaksud meliputi gerak dasar tari, tari tradisi, tari kreasi, tata rias dan busana, tata teknik pentas, serta manajemen pertunjukan. Untuk mendapatkan penguatan konten pembelajaran, murid bisa belajar di mana saja sesuai dengan pilihan potensi dirinya, dengan memanfaatkan sumber-sumber belajar di sekitarnya dan media lain. Perencanaan, pelaksanaan, dan penilaian pembelajaran dilakukan sesuai dengan karakteristik mata pelajaran dan tujuan yang ingin dicapai. Pendekatan pembelajaran menggunakan berbagai model yang interaktif, inspiratif, menyenangkan, menantang, dan memotivasi murid. Murid diharapkan dapat terlibat aktif serta dengan memberikan ruang yang cukup bagi prakarsa, kreativitas, kemandirian sesuai bakat, minat, renjana, serta perkembangan fisik dan psikologis murid. Model pembelajaran menggunakan model pembelajaran berbasis project-based learning, problem based learning, teaching factory, dan inquiry-based learning. Penilaian meliputi aspek pengetahuan dapat dilakukan melalui tes maupun nontes. Penilaian pada aspek keterampilan melalui penilaian proses, produk tari, dan portofolio, sedangkan penilaian aspek sikap melalui observasi, antarteman, maupun catatan keja',
  karakteristik  = 'Pada hakikatnya, pembelajaran pada mata pelajaran Seni Tari terfokus pada kompetensi-kompetensi yang harus dimiliki oleh murid dalam menyajikan tari sesuai dengan situasi, kondisi, dan tuntutan kebutuhan pasar.  Mata pelajaran tersebut di atas sebagai lanjutan dari dasar program pada Fase E yang telah mendapatkan pemahaman tentang proses bisnis di dunia kerja serta perkembangan teknologi dan isu-isu global di masyarakat atau dunia industri. Selain itu, mendapatkan pemahaman berbagai macam profesi, okupasi kerja, peluang usaha, pemahaman tentang entrepreneur, pemahaman konsep seni, pemahaman dasar-dasar produksi, pemahaman sarana dan peralatan pementasan, serta pemahaman teknik dasar. Adapun beban pembelajaran disesuaikan dengan output keahlian yang diharapkan oleh mitra dunia kerja di setiap masing-masing satuan pendidikan. Elemen dan deskripsi elemen mata pelajaran Seni Tari adalah sebagai berikut. Elemen Deskripsi Gerak Dasar Tari Meliputi mengidentifikasi anatomi tubuh yang melibatkan gerak di semua bagian dari anggota tubuh manusia, melatih teknik-teknik gerak tari, melatih kepekaan irama. Elemen gerak dasar tari ini merupakan elemen untuk menguasai teknik-teknik gerak tari secara mendasar. Elemen Deskripsi Tari Tradisi Meliputi mengidentifikasi gerak tari, fungsi tari, teknik gerak, dan karakteristik tari. Dalam menampilkan repertoar tari tradisi didukung unsur-unsur tata rias busana, properti, iringan dan tata teknik pentas, serta memiliki kepekaan menggunakan materi tari tradisi untuk menata tari garapan baru. Tari Kreasi Meliputi keterampilan dalam menyajikan ragam tari, dan kreativitas tari. Dengan menguasai beberapa ragam tari kreasi dapat dijadikan sebagai bahan untuk mengembangkan kreativitasnya dalam menata dan menyajikan tari garapan baru.',
  cp_umum        = 'Pada akhir Fase F, murid memiliki kemampuan sebagai berikut.',
  bskap_ref      = 'SK BSKAP No. 046/H/KR/2025',
  effective_date = '2025-01-01',
  updated_at     = now()
WHERE subject_phase_id = (
  SELECT sp.subject_phase_id
  FROM core.subject_phases sp
  JOIN core.subjects s ON sp.subject_id = s.subject_id
  JOIN core.phases   p ON sp.phase_id   = p.phase_id
  WHERE s.code = 'KK-SENI-TARI' AND p.code = 'F'
);

-- KK-SENI-TEATER Fase F
UPDATE core.capaian_pembelajaran
SET
  rasional       = 'Mata pelajaran Tata Artistik Teater merupakan mata pelajaran kejuruan berisi kompetensi-kompetensi utama pada penguasaan keahlian pekerjaan tata artistik seni pertunjukan. Mata pelajaran Tata Artistik Teater diharapkan akan memampukan murid untuk (1) melaksanakan tugas spesifik dengan menggunakan alat, informasi, prosedur kerja yang lazim dilakukan, dan menunjukkan kinerja dengan mutu yang terukur di bawah pengawasan; (2) menguasai pengetahuan operasional dasar dan pengetahuan faktual bidang kerja yang spesifik sehingga mampu memilih penyelesaian yang tersedia terhadap masalah yang lazim timbul; serta (3) bertanggung jawab pada pekerjaan sendiri dan dapat diberi tanggung jawab membimbing orang lain. Untuk membekali pemahaman keprofesionalan dan kebanggaan murid terhadap unsur-unsur pendukung seni pertunjukan. Murid dibekali pemahaman tentang desain tata artistik seni pertunjukan dan prosedur penataan artistik seni pertunjukan. Desain dan prosedur penataan artistik berdasarkan pada perkembangan teknologi dan isu-isu global di masyarakat atau dunia industri. Murid mendapatkan pemahaman berbagai macam okupasi kerja dan peluang usaha, prosedur dan budaya kerja, entrepreneur, konsep seni pertunjukan, manajemen produksi seni pertunjukan, sarana dan peralatan pementasan, serta teknik penataan artistik seni pertunjukan. Perencanaan, pelaksanaan, dan penilaian pembelajaran dilakukan sesuai dengan karakteristik mata pelajaran dan tujuan yang ingin dicapai. Proses pembelajaran menggunakan berbagai variasi model pembelajaran yang bersifat interaktif, inspiratif, menyenangkan, menantang dan memotivasi murid untuk terlibat aktif. Pembelajaran diharapkan pula dapat memberikan ruang yang cukup bagi prakarsa, kreativitas, dan kemandirian sesuai minat, bakat serta renjana (passion) berdasarkan dimensi profil pelajar Pancasila. Model pembelajaran yang dapat digunakan, antara lain project-based learning, problem based learning, teaching factory, discovery-based learning, inquiry based learning, atau metode dan model lain yang relevan. Mata pelajaran Tata Artistik Teater berkontribusi menjadikan murid memiliki kompetensi sebagai penata ataupun asisten penata dalam bidang tata artistik seni pertunjukan. Murid mampu menjadi penata ataupun asisten penata yang berakhlak mulia, komunikatif, bekerja dalam tim, bertanggung jawab, memiliki kepekaan dan kepedulian terhadap situasi dan lingkungan kerja, serta kritis dan kreatif. Materi dan capaian kompetensi pada mata pelajaran ini merujuk pada Kepmenaker RI Nomor 132 Tahun 2019 tentang Penetapan SKKNI Kategori Kesenian, Hiburan dan Rekreasi Golongan Pokok Aktivitas Hiburan, Kesenian dan Kreativitas Bidang Seni Pertunjukan dengan mempertimbangkan deskriptor jenjang kualifikasi 2 pada Kerangka Kualifikasi Nasional Indonesia (KKNI).',
  karakteristik  = 'Pada hakikatnya, mata pelajaran Tata Artistik Teater berfokus pada kompetensi utama yang harus dimiliki oleh calon penata ataupun calon asisten penata artistik dalam bidang seni pertunjukan sesuai dengan situasi, kondisi, dan perkembangan dunia kerja. Selain itu, murid diberikan pemahaman tentang proses bisnis, perkembangan penerapan teknologi dan isu-isu global, profil entrepreneur, job-profile, serta peluang usaha dan pekerjaan atau profesi, sehingga murid mampu bekerja di industri, berwirausaha mandiri, dan melanjutkan pendidikan di tingkat lanjut yang sesuai dengan bidang keahlian yang dimiliki. Elemen dan deskripsi elemen mata pelajaran Tata Artistik Teater sebagai berikut. Elemen Deskripsi Proses Bisnis di Dunia Kerja Bidang Penataan Artistik Pertunjukan Meliputi pemahaman murid tentang aktivitas pekerjaan pada bidang penataan artistik pertunjukan, pengetahuan tentang kepribadian yang dibutuhkan sebagai bagian dari kemampuan berwirausaha dengan berorientasi pada efektivitas, potensi lokal dan kearifan lokal, serta pengelolaan SDM di industri atau dunia kerja. Konsep Penataan Artistik Meliputi pengetahuan, wawasan, tentang penataan artistik pertunjukan meliputi diantaranya: latar pemeristiwaan tempat, waktu dan suasana, serta Dimensi penokohan dan/atau kajian keilmuan lain yang dibutuhkan untuk konsep penataan artistik. Alat dan Bahan Penataan Artistik Meliputi pemahaman murid mengenai alat dan bahan penataan artistik secara individu atau kelompok. Desain Penataan Artistik Meliputi pemahaman murid mengenai desain penataan artistik secara individu atau kelompok. Teknik Penataan Artistik Meliputi pemahaman murid mengenai teknik penataan artistik secara individu atau kelompok. Elemen Deskripsi Presentasi Penataan Artistik Pertunjukan Meliputi pemahaman murid mengenai penyajian penataan artistik dalam pertunjukan secara individu atau kelompok.',
  cp_umum        = 'Pada akhir Fase F, murid memiliki kemampuan sebagai berikut.',
  bskap_ref      = 'SK BSKAP No. 046/H/KR/2025',
  effective_date = '2025-01-01',
  updated_at     = now()
WHERE subject_phase_id = (
  SELECT sp.subject_phase_id
  FROM core.subject_phases sp
  JOIN core.subjects s ON sp.subject_id = s.subject_id
  JOIN core.phases   p ON sp.phase_id   = p.phase_id
  WHERE s.code = 'KK-SENI-TEATER' AND p.code = 'F'
);

-- LOGISTIK-DASAR Fase E
UPDATE core.capaian_pembelajaran
SET
  rasional       = 'Dasar-dasar Teknik Logistik adalah mata pelajaran yang mendasari penguasaan keahlian teknik logistik, yang meliputi pengadaan, penyimpanan dan pengiriman barang. Mata pelajaran ini merupakan mata pelajaran dasar kejuruan yang terdiri dari berbagai ilmu dasar sebagai penentu dalam mempelajari mata pelajaran yang lain dalam Program Keahlian Teknik Logistik, agar murid memiliki dasar kompetensi yang kuat dalam mempelajari mata pelajaran-mata pelajaran pada Fase E. Teknik logistik telah berkembang pesat, baik dalam sistem pengadaan dan pengelolaan barang di dalam pabrik/kantor, sistem penyimpanan manual dan otomatis, serta metode pengiriman dengan berbagai sarana, yang didukung oleh teknologi informasi dan komunikasi yang canggih. Di masa sekarang dan masa yang akan datang, teknik logistik telah dan akan menjadi roda penggerak perekonomian, serta berkembang menjadi lahan bisnis yang menjanjikan. Mata pelajaran Dasar-dasar Teknik Logistik berfungsi untuk menumbuhkembangkan profesionalisme dalam bidang teknik logistik dan pembelajarannya dapat dilakukan dengan menggunakan berbagai pendekatan, model, strategi, serta metode pembelajaran yang sesuai dengan karakteristik kompetensi yang merujuk pada Kepmenaker RI Nomor 170 Tahun 2020 tentang Penetapan SKKNI Kategori Pengangkutan dan Pergudangan Golongan Pokok Pergudangan dan Aktivitas Penunjang Angkutan Bidang Logistik dengan mempertimbangkan deskriptor jenjang kualifikasi 2 pada KKNI. Proses pembelajaran diharapkan dapat dilaksanakan secara interaktif, aktif, inspiratif, menyenangkan, menantang, dan memotivasi murid, serta memberikan ruang yang cukup bagi prakarsa, kreativitas, kemandirian sesuai dengan bakat, minat, renjana, dan perkembangan fisik serta psikologis murid. Pembelajaran dapat dilakukan dengan pendekatan contextual teaching learning, cooperative learning, maupun individual learning. Model pembelajaran yang dapat digunakan antara lain project-based learning, problem-based learning, inquiry-based learning, discovery-based learning, teaching factory, atau model pembelajaran lainnya yang relevan. Mata pelajaran Dasar-dasar Teknik Logistik juga berkontribusi dalam membentuk kompetensi (hard skills), soft skills, dan karakter murid pada bidang teknik logistik sehingga menjadi warga yang memiliki keimanan dan ketakwaan kepada Tuhan Yang Maha Esa, kemampuan kewargaan, penalaran kritis, kreativitas, kolaborasi, kemandirian, kesehatan, dan komunikasi.',
  karakteristik  = 'Pada hakikatnya, mata pelajaran Dasar-Dasar Teknik Logistik berfokus pada kompetensi yang bersifat mendasar dan harus dimiliki oleh seorang petugas/operator logistik sesuai dengan perkembangan dunia kerja. Elemen dan deskripsi elemen mata pelajaran Dasar-dasar Teknik Logistik adalah sebagai berikut: Elemen Deskripsi Wawasan Dunia Kerja Bidang Teknik Logistik Meliputi aktivitas pekerjaan pada bidang logistik atau teknik industri secara menyeluruh pada berbagai industri, mulai dari Perbaikan lingkungan kerja, Kegiatan administratif, Pelayanan pelanggan, Pengelolaan pergudangan, Teknik distribusi, serta Perkembangan sistem logistik, seperti; komputerisasi komunikasi dan pengendalian jarak jauh, robotisasi pergudangan dan sejenisnya Mengevaluasi profesi bidang teknik logistik serta kewirausahaan (job profile dan technopreneurship), Peluang usaha bidang teknik industri, seperti ; scheduler, petugas production planning inventory control, jasa pengiriman paket, forwarder, dan sejenisnya. Kecakapan Kerja Dasar (Basic Job Skills), K3, dan Budaya Kerja Meliputi penerapan K3LH dan budaya kerja industri, antara lain: praktik-praktik kerja yang aman, bahaya-bahaya di tempat kerja, prosedur-prosedur dalam keadaan Elemen Deskripsi darurat, dan penerapan budaya kerja industri seperti 5R,  etika kerja dan praktik singkat yang terkait dengan seluruh proses pengelolaan logistik dan teknik industri pada berbagai industri, antara lain industri logam, industri makanan dan minuman, industri tekstil, dan sebagainya. Kegiatan Administratif Dokumen dan Operasional Pengadaan Meliputi kegiatan administrasi dokumen dan administrasi operasional pengadaan barang untuk keperluan produksi, termasuk lain kode etik yang berlaku di tempat kerja, peraturan penamaan file kerja, peraturan format file kerja, peraturan penyimpanan file kerja, peraturan pengamanan file kerja. Pelayanan Pelanggan Meliputi penerapan pelayanan pelanggan secara prima, baik pelanggan internal maupun eksternal. Pengelolaan Gudang dan Perbaikan Lingkungan Kerja Meliputi proses penerimaan barang, penyimpanan, proses pengeluaran barang dari gudang, perbaikan lingkungan kerja di industri (Kaizen). Teknik yang benar dalam pengelolaan gudang, dikaitkan dengan pencapaian nilai estetika. Teknik Distribusi Meliputi teknik pengumpulan, pemrosesan, pengepakan, transportasi, dan pengantaran.',
  cp_umum        = 'Pada akhir Fase E, murid memiliki kemampuan sebagai berikut.',
  bskap_ref      = 'SK BSKAP No. 046/H/KR/2025',
  effective_date = '2025-01-01',
  updated_at     = now()
WHERE subject_phase_id = (
  SELECT sp.subject_phase_id
  FROM core.subject_phases sp
  JOIN core.subjects s ON sp.subject_id = s.subject_id
  JOIN core.phases   p ON sp.phase_id   = p.phase_id
  WHERE s.code = 'LOGISTIK-DASAR' AND p.code = 'E'
);

-- KK-LOG Fase F
UPDATE core.capaian_pembelajaran
SET
  rasional       = 'Teknik Logistik adalah mata pelajaran yang mempelajari penanganan barang, sistem informasi dan transaksi dalam proses pengadaan, penyimpanan, dan pengiriman yang relevan, fleksibel, efisien, dan efektif sesuai dengan perkembangan kebutuhan masyarakat. Mata pelajaran ini merupakan penerapan dan pendalaman tingkat lanjut materi dari Fase E dasar-dasar teknik logistik. Mata pelajaran ini diharapkan murid mampu menggunakan alat kerja dan melaksanakan  Standar Operasional Prosedur (SOP) yang berlaku serta menunjukkan kinerja yang baik dan bertanggung jawab.  Mata pelajaran ini membekali murid untuk memiliki kompetensi sesuai Peta Okupasi Bidang Logistik dan Supply Chain, Kepmenaker RI Nomor 170 Tahun 2020 tentang Penetapan SKKNI Kategori Pengangkutan dan Pergudangan Golongan Pokok Pergudangan dan Aktivitas Penunjang Angkutan Bidang Logistik serta Kepmenaker RI Nomor 94 Tahun 2019 tentang penetapan SKKNI Kategori Pengangkutan dan Pergudangan Golongan Pokok Pergudangan dan Aktivitas Penunjang Angkutan Bidang Logistik atau jabatan pekerjaan lain yang akan muncul sejalan dengan perkembangan di bidang logistik dengan mempertimbangkan deskriptor jenjang kualifikasi 2 pada KKNI. Pelaksanaan pembelajaran pada konsentrasi keahlian Teknik Logistik berpusat pada murid (student-centered learning) dengan pendekatan pembelajaran mendalam yang berbasis pada lingkungan belajar. Metode yang digunakan pembelajaran berbasis inkuiri (inquiry-based learning), pembelajaran berbasis masalah (problem-based learning), pembelajaran berbasis projek (project- based learning), teaching factory, kunjungan, serta praktik langsung di dunia kerja atau model lainnya serta metode yang relevan dalam rangka mewujudkan profil lulusan yang sehat, beriman dan takwa kepada Tuhan Yang Maha Esa, bernalar kritis, kreatif, komunikatif, mampu berkolaborasi, dan memiliki kemandirian sebagai warga negara.',
  karakteristik  = 'Mata pelajaran ini berfokus pada kompetensi tingkat menengah dan lanjut yang tersedia dalam tiga kegiatan utama dalam sistem logistik yaitu pengadaan, penyimpanan dan pengiriman dengan mengutamakan prinsip-prinsip Keselamatan dan Kesehatan Kerja (K3). Mata pelajaran ini membekali murid untuk bekerja,  melanjutkan studi  dan berwirausaha di bidang teknik logistik. Elemen dan deskripsi elemen mata pelajaran Teknik Logistik adalah sebagai berikut. Elemen Deskripsi Procurement/ Pengadaan Meliputi perencanaan pengadaan barang/jasa, melakukan negosiasi, penyusunan dokumen kontrak, pemilihan penyedia barang/jasa, dan pelaksanaan pengadaan barang/jasa. Aktivitas Pergudangan Meliputi penanganan barang masuk, penyimpanan barang, pengeluaran barang, peralatan dan fasilitas gudang, dan  persediaan barang. Pengemasan Barang (Packing) Meliputi analisis jenis barang yang akan dikemas  dan teknik penanganan pengemasan barang (packing). Teknik Pengiriman Barang Meliputi teknik pengiriman barang (collecting, processing, transporting, dan delivery), penentuan rute serta pemilihan moda transportasi, dan pengurusan dokumen pengiriman barang. Sistem Informasi Logistik Meliputi penerapan pengetahuan, keterampilan, sikap kerja yang diperlukan dalam mengoperasikan sistem informasi logistik, dan aplikasi yang relevan. Perdagangan Internasional Meliputi dasar-dasar perdagangan internasional.',
  cp_umum        = 'Pada akhir Fase F, murid memiliki kemampuan sebagai berikut.',
  bskap_ref      = 'SK BSKAP No. 046/H/KR/2025',
  effective_date = '2025-01-01',
  updated_at     = now()
WHERE subject_phase_id = (
  SELECT sp.subject_phase_id
  FROM core.subject_phases sp
  JOIN core.subjects s ON sp.subject_id = s.subject_id
  JOIN core.phases   p ON sp.phase_id   = p.phase_id
  WHERE s.code = 'KK-LOG' AND p.code = 'F'
);

-- AKL-DASAR Fase E
UPDATE core.capaian_pembelajaran
SET
  rasional       = 'Dasar-dasar Akuntansi dan Keuangan Lembaga adalah mata pelajaran berisi kompetensi yang mendasari penguasaan akuntansi dan keuangan lembaga untuk profesi staf akuntansi junior, yaitu suatu proses yang diawali dengan membuat dokumen keuangan, mencatat, mengelompokkan, mengolah, menyajikan data, serta mencatat transaksi yang berhubungan dengan keuangan. Mata pelajaran Dasar-dasar Akuntansi dan Keuangan Lembaga berfungsi untuk menumbuhkembangkan minat dan renjana (passion) murid dalam memahami wawasan dunia kerja bidang akuntansi dan keuangan lembaga, serta memahami kecakapan kerja dasar (basic job skills), K3, dan budaya kerja. Selain itu, mata pelajaran ini juga berfungsi sebagai landasan pengetahuan, sikap, dan keterampilan untuk pembelajaran pada Fase F. Mata pelajaran Dasar-dasar Akuntansi dan Keuangan Lembaga berkontribusi dalam menjadikan murid agar memiliki kompetensi sebagai staf administrasi keuangan, staf perpajakan, staf perbankan, atau pekerjaan lainnya yang berintegritas tinggi, mampu berkomunikasi, bernegosiasi, dan berinteraksi antar budaya, bekerja sama dalam tim, serta peka dan peduli terhadap situasi dan lingkungan kerja. Materi dan capaian kompetensi pada mata pelajaran Dasar-Dasar Akuntansi dan Keuangan Lembaga merujuk pada kemasan Skema Okupasi untuk program keahlian akuntansi dan keuangan lembaga sesuai Keputusan Menteri Ketenagakerjaan Nomor 264 Tahun 2023 Tentang Penetapan Standar Kompetensi Kerja Nasional Indonesia Kategori Aktivitas Profesional, Ilmiah, dan Teknis Golongan Pokok Aktivitas Hukum dan Akuntansi Bidang Teknisi Akuntansi. Pelaksanaan pembelajaran Dasar-dasar Akuntansi dan Keuangan Lembaga berpusat pada murid (student-centered learning) dengan dapat menerapkan pembelajaran berbasis inkuiri (inquiry- based learning), pembelajaran berbasis masalah (problem-based learning), pembelajaran berbasis proyek (project-based learning), teaching factory, dan kunjungan serta praktik langsung di dunia kerja untuk mencapai dimensi profil lulusan yang memiliki Keimanan dan Ketakwaan terhadap Tuhan Yang Maha Esa (YME) dan Berakhlak Mulia, Kewargaan, Kreativitas, Kemandirian, Komunikasi, Kesehatan, Kolaborasi, dan Penalaran Kritis.',
  karakteristik  = 'Mata pelajaran Dasar-dasar Akuntansi dan Keuangan Lembaga membutuhkan penalaran dan pemikiran yang mendalam, serta merupakan mata pelajaran yang hierarkis, yaitu materi awal sampai dengan akhir saling berkaitan, membutuhkan ketelitian, ketekunan, dan kesabaran dalam menyelesaikan materi pembelajaran. Mata pelajaran ini juga memberikan pemahaman kepada murid tentang wawasan dunia kerja bidang akuntansi dan keuangan lembaga dan kecakapan kerja dasar (job basic), K3, dan budaya kerja. Elemen dan deskripsi elemen mata pelajaran Dasar-dasar Akuntansi dan Keuangan Lembaga adalah sebagai berikut. Elemen dan deskripsi elemen mata pelajaran Dasar-dasar Akuntansi dan Keuangan Lembaga adalah sebagai berikut. Elemen Deskripsi Wawasan Dunia Kerja Bidang Akuntansi dan Keuangan Lembaga Meliputi jenis-jenis perusahaan berdasarkan kegiatannya, jenis-jenis perusahaan berdasarkan bentuk badan usaha, pengertian siklus akuntansi dan contoh alurnya, pengertian jurnal, jenis-jenis jurnal, fungsi jurnal, contoh form jurnal, pengertian buku besar, fungsi buku besar, bentuk buku besar, pengertian laporan keuangan, jenis-jenis laporan keuangan, manfaat laporan keuangan. Selain itu, meliputi sejarah akuntansi, sejarah akuntansi di Indonesia, tantangan akuntansi di masa kini, aplikasi pencatatan akuntansi, manfaat keamanan data bisnis, prosedur keamanan data, penyimpanan data. Serta materi terkait profesi akuntansi, jenis-jenis profesi akuntansi, peluang pasar/usaha di bidang akuntansi dan keuangan lembaga, permasalahan ekonomi,  ilmu ekonomi dalam kegiatan usaha, administrasi, dan fungsi manajemen. Kecakapan Kerja Dasar (Basic Job Skills), K3, dan Budaya Kerja Meliputi kesehatan diri (kebersihan pribadi, penggunaan alat pelindung diri (APD), pola makan sehat, istirahat dan tidur yang cukup, serta manajemen stress), keselamatan kerja (identifikasi potensi bahaya di tempat Elemen Deskripsi kerja, penerapan prosedur kerja yang aman, penggunaan APD sesuai risiko kerja, penggunaan limbah dan bahan berbahaya, tanggap darurat dan prosedur evakuasi serta pelaporan kecelakaan kerja), dan pencegahan penyakit akibat kerja, serta penerapan K3 dan budaya kerja 5R di bidang akuntansi dan keuangan lembaga, prinsip-prinsip akuntansi dasar, konsep akuntansi dasar, mekanisme debit kredit, persamaan dasar akuntansi, siklus akuntansi, sejarah perbankan, fungsi bank, bentuk badan hukum perbankan, bank dan lembaga keuangan non bank, jenis-jenis uang, kegiatan perbankan, transaksi tabungan, transaksi giro, transaksi pinjaman, produk usaha perbankan lainnya, definisi aplikasi pengolah angka, manfaat aplikasi pengolah angka, jenis-jenis aplikasi pengolah angka, rumus dan fungsi dalam aplikasi pengolah angka, laporan keuangan menggunakan aplikasi pengolah angka',
  cp_umum        = 'Pada akhir Fase E, murid memiliki kemampuan sebagai berikut.',
  bskap_ref      = 'SK BSKAP No. 046/H/KR/2025',
  effective_date = '2025-01-01',
  updated_at     = now()
WHERE subject_phase_id = (
  SELECT sp.subject_phase_id
  FROM core.subject_phases sp
  JOIN core.subjects s ON sp.subject_id = s.subject_id
  JOIN core.phases   p ON sp.phase_id   = p.phase_id
  WHERE s.code = 'AKL-DASAR' AND p.code = 'E'
);

-- KK-AKL Fase F
UPDATE core.capaian_pembelajaran
SET
  rasional       = 'Mata pelajaran Akuntansi adalah mata pelajaran yang berisi kompetensi akuntansi untuk profesi Teknisi Akuntansi berupa pengolahan, pencatatan, pengelompokan, dan penyajian data transaksi yang berhubungan dengan keuangan. Mata pelajaran ini berfungsi untuk menumbuhkembangkan kompetensi pada murid dalam menerapkan akuntansi perusahaan jasa, dagang dan manufaktur, menerapkan akuntansi Entitas Tunggal  untuk Skala Usaha Mikro, Kecil, dan Menengah, akuntansi lembaga/instansi pemerintah, menerapkan akuntansi keuangan, mengoperasikan aplikasi komputer akuntansi dengan, serta menerapkan perpajakan untuk  Entitas Tunggal untuk Skala Usaha Mikro, Kecil, dan Menengah. Berbekal sikap, pengetahuan, dan keterampilan yang dipelajari pada mata pelajaran Akuntansi, murid dapat bekerja di dunia kerja yang sesuai, melanjutkan pendidikan sesuai dengan kejuruannya dan/atau berwirausaha. Mata pelajaran ini juga diharapkan dapat membekali murid untuk: (1) melaksanakan tugas spesifik dengan menggunakan alat, informasi, dan prosedur kerja yang lazim dilakukan, serta menunjukkan kinerja dengan mutu yang terukur di bawah pengawasan, (2) menguasai pengetahuan operasional dasar dan pengetahuan faktual bidang kerja yang spesifik, sehingga mampu memilih penyelesaian yang tersedia terhadap masalah yang lazim timbul, dan (3) bertanggung jawab pada pekerjaan sendiri dan dapat diberi tanggung jawab membimbing orang lain. Materi dan capaian kompetensi pada mata pelajaran ini merujuk pada Kepmenakertrans RI Nomor 264 Tahun 2023 tentang Penetapan SKKNI Kategori Jasa Profesional, Ilmiah dan Teknis.  Golongan Pokok Jasa Hukum dan Akuntansi Golongan Jasa Akuntansi, Pembukuan dan Pemeriksa; Konsultasi Pajak Subgolongan Jasa Akuntansi, Pembukuan dan Pemeriksa, Konsultasi Pajak Kelompok Usaha Teknisi Akuntansi. Pembelajaran mata pelajaran ini dapat menggunakan berbagai pendekatan, strategi, metoda, dan model yang sesuai dengan karakteristik kompetensi yang harus dipelajari sehingga dapat menciptakan pembelajaran yang interaktif, inspiratif, menyenangkan, menantang, memotivasi murid untuk berpartisipasi aktif, dan memberikan ruang yang cukup bagi prakarsa, kreativitas, kemandirian sesuai dengan bakat, minat, renjana, serta perkembangan fisik dan psikologis murid. Model-model pembelajaran yang dapat digunakan, antara lain project-based learning, problem-based learning, discovery learning, teaching factory, atau model lainnya, serta metode yang relevan. Mata pelajaran ini berkontribusi menjadikan murid memiliki kompetensi sebagai Asisten Audit Internal, Asisten Konsultan Pajak, Kasir, Clerk, Teknisi Akuntansi atau Pekerjaan lainnya yang memiliki akhlak mulia, berintegritas tinggi, mampu berkomunikasi, bernegosiasi dan berinteraksi antar budaya, mampu bekerja sama dalam tim, menumbuhkan kemampuan berpikir kritis, gotong royong, kreatif, mandiri, serta menumbuhkan kepekaan dan kepedulian terhadap situasi dan lingkungan kerja.',
  karakteristik  = 'Mata pelajaran ini memiliki karakteristik, antara lain membutuhkan nalar dan pemikiran yang mendalam, bersifat hierarkis dimana materi dari awal sampai akhir saling berkaitan, dan membutuhkan ketelitian, ketekunan dan kesabaran dalam menyelesaikan materi pembelajaran. Elemen dan deskripsi elemen mata pelajaran Akuntansi sebagai berikut. Elemen Deskripsi Akuntansi Perusahaan Jasa, Dagang dan Manufaktur Meliputi analisis dokumen sumber dan dokumen pendukung pada perusahaan (entitas) untuk Wajib Pajak Orang Pribadi dan Badan, baik yang telah menjadi Pengusaha Kena Pajak (PKP) maupun non-PKP, proses pencatatan transaksi ke dalam jurnal umum atau khusus, pencatatan transaksi ke dalam buku pembantu kartu piutang, kartu liabilitas, dan kartu persediaan barang dagang, posting jurnal umum atau khusus ke dalam buku besar, penyusunan neraca saldo, analisis transaksi penyesuaian, posting jurnal Elemen Deskripsi penyesuaian ke dalam buku besar, neraca lajur (worksheet), laporan laba/rugi, laporan perubahan modal (perubahan ekuitas), neraca (laporan posisi keuangan), laporan arus kas, dan catatan atas laporan keuangan, jurnal penutup, posting jurnal penutup ke dalam buku besar, serta neraca saldo setelah penutupan. Dalam hal ini perusahaan manufaktur ditambah materi tentang harga pokok pesanan dan harga pokok proses dilakukan sesuai dengan perkembangan teknologi dan pemanfaatannya di bidang akuntansi. Akuntansi Lembaga/instansi Pemerintah Meliputi standar akuntansi yang digunakan lembaga atau instansi pemerintah sesuai dengan perkembangan teknologi dan pemanfaatannya di bidang akuntansi Akuntansi Keuangan Meliputi kartu piutang, kartu liabilitas, dan kartu persediaan, dokumen kas dan setara kas, kartu aset non lancar, penyajian laporan harga pokok produk, serta analisis berbagai jenis ekuitas entitas (perbedaan ekuitas perorangan, firma, PT, CV, dan koperasi). Komputer Akuntansi Meliputi pengoperasian program komputer akuntansi. Perpajakan Meliputi Undang-Undang Harmonisasi Peraturan Perpajakan (UU HPP), jenis-jenis pajak, penghitungan pajak terutang, penyetoran pajak kurang/lebih  bayar, serta Elemen Deskripsi penyusunan laporan pajak sesuai dengan perkembangan teknologi dan pemanfaatannya di bidang akuntansi',
  cp_umum        = 'Pada akhir Fase F, murid memiliki kemampuan sebagai berikut.',
  bskap_ref      = 'SK BSKAP No. 046/H/KR/2025',
  effective_date = '2025-01-01',
  updated_at     = now()
WHERE subject_phase_id = (
  SELECT sp.subject_phase_id
  FROM core.subject_phases sp
  JOIN core.subjects s ON sp.subject_id = s.subject_id
  JOIN core.phases   p ON sp.phase_id   = p.phase_id
  WHERE s.code = 'KK-AKL' AND p.code = 'F'
);

-- ============================================================
-- STEP 7: cp_elements dari BSKAP 046 (120 elemen, 22 subjek)
-- ============================================================

-- TJKT-DASAR Fase E — 4 elemen
INSERT INTO core.cp_elements (element_id, cp_id, element_order, nama_elemen, deskripsi_cp, is_active)
SELECT gen_random_uuid(), cp.cp_id, el.element_order, el.nama_elemen, el.deskripsi_cp, true
FROM core.capaian_pembelajaran cp
JOIN core.subject_phases sp ON cp.subject_phase_id = sp.subject_phase_id
JOIN core.subjects s ON sp.subject_id = s.subject_id
JOIN core.phases   p ON sp.phase_id   = p.phase_id
CROSS JOIN (VALUES
  (1, 'Wawasan dunia kerja bidang Teknik Jaringan Komputer dan Telekomunikasi', 'Menganalisis jenis-jenis profesi, proses bisnis, budaya mutu, pelayanan pelanggan serta peluang usaha untuk membangun personal branding, vision dan passion dengan didukung pemahaman perkembangan teknologi pada perangkat teknik jaringan komputer dan telekomunikasi.'),
  (2, 'Kecakapan Kerja Dasar (Basic Job Skills), K3LH, dan Budaya Kerja', 'Menerapkan dasar penggunaan dan konfigurasi peralatan/teknologi dengan berlandaskan budaya kerja dan K3LH pada bidang teknik jaringan komputer dan telekomunikasi.'),
  (3, 'Media dan jaringan telekomunikasi', 'Menerapkan berbagai media dalam membangun jaringan pada teknik jaringan komputer dan telekomunikasi.'),
  (4, 'Penggunaan alat ukur', 'Menerapkan penggunaan dan pemeliharaan alat ukur untuk seluruh jaringan komputer dan sistem telekomunikasi.')
) AS el(element_order, nama_elemen, deskripsi_cp)
WHERE s.code = 'TJKT-DASAR' AND p.code = 'E'
ON CONFLICT (cp_id, element_order) DO UPDATE SET
  nama_elemen  = EXCLUDED.nama_elemen,
  deskripsi_cp = EXCLUDED.deskripsi_cp,
  is_active    = true;

-- TKJ Fase F — 5 elemen
INSERT INTO core.cp_elements (element_id, cp_id, element_order, nama_elemen, deskripsi_cp, is_active)
SELECT gen_random_uuid(), cp.cp_id, el.element_order, el.nama_elemen, el.deskripsi_cp, true
FROM core.capaian_pembelajaran cp
JOIN core.subject_phases sp ON cp.subject_phase_id = sp.subject_phase_id
JOIN core.subjects s ON sp.subject_id = s.subject_id
JOIN core.phases   p ON sp.phase_id   = p.phase_id
CROSS JOIN (VALUES
  (1, 'Perencanaan dan pengalamatan jaringan', 'Menerapkan perencanaan topologi, arsitektur jaringan sesuai kebutuhan serta pengalamatan jaringan (subnetting, CIDR, dan VLSM).'),
  (2, 'Teknologi jaringan kabel dan nirkabel', 'Menerapkan instalasi jaringan kabel (twisted pair cable dan fiber optic) dan jaringan nirkabel.'),
  (3, 'Keamanan jaringan', 'Menerapkan sistem keamanan jaringan.'),
  (4, 'Konfigurasi perangkat jaringan', 'Menerapkan konfigurasi perangkat jaringan.'),
  (5, 'Administrasi sistem jaringan', 'Menerapkan konfigurasi layanan server.')
) AS el(element_order, nama_elemen, deskripsi_cp)
WHERE s.code = 'TKJ' AND p.code = 'F'
ON CONFLICT (cp_id, element_order) DO UPDATE SET
  nama_elemen  = EXCLUDED.nama_elemen,
  deskripsi_cp = EXCLUDED.deskripsi_cp,
  is_active    = true;

-- KK-TJAT Fase F — 6 elemen
INSERT INTO core.cp_elements (element_id, cp_id, element_order, nama_elemen, deskripsi_cp, is_active)
SELECT gen_random_uuid(), cp.cp_id, el.element_order, el.nama_elemen, el.deskripsi_cp, true
FROM core.capaian_pembelajaran cp
JOIN core.subject_phases sp ON cp.subject_phase_id = sp.subject_phase_id
JOIN core.subjects s ON sp.subject_id = s.subject_id
JOIN core.phases   p ON sp.phase_id   = p.phase_id
CROSS JOIN (VALUES
  (1, 'Teknik kerja bengkel dan kelistrikan', 'Menerapkan penggunaan perkakas bidang telekomunikasi, pendokumentasian pemeliharaan grounding dan catu daya, serta instalasi listrik sederhana.'),
  (2, 'Sistem komputer, dan Internet of Things (IoT)', 'Menerapkan konsep sistem komputer, komunikasi data, serta pendokumentasian pemrograman dasar pada Internet of Things (IoT).'),
  (3, 'FTTx', 'Menerapkan prinsip propagasi gelombang cahaya, konsep implementasi konfigurasi jaringan FTTx, instalasi, terminasi, pengukuran, troubleshooting, serta pendokumentasian perencanaan jaringan FTTx menggunakan perangkat lunak yang relevan.'),
  (4, 'VSAT', 'Menerapkan arsitektur sistem komunikasi satelit, instalasi, troubleshooting, dan pemeliharaan perangkat VSAT serta pendokumentasian perencanaan jaringan satelit.'),
  (5, 'Wireless Access', 'Menerapkan pengetahuan dasar kelistrikan, grounding, instalasi, troubleshooting, pendokumentasian perencanaan, dan optimasi jaringan akses radio.'),
  (6, 'Customer Premise Equipment', 'Menerapkan konsep, implementasi etika pelayanan pelanggan, tata kelola kabel premises, instalasi perangkat pelanggan, pendokumentasian pengukuran, dan pemeliharaan perangkat pelanggan.')
) AS el(element_order, nama_elemen, deskripsi_cp)
WHERE s.code = 'KK-TJAT' AND p.code = 'F'
ON CONFLICT (cp_id, element_order) DO UPDATE SET
  nama_elemen  = EXCLUDED.nama_elemen,
  deskripsi_cp = EXCLUDED.deskripsi_cp,
  is_active    = true;

-- OTOMOTIF-DASAR Fase E — 7 elemen
INSERT INTO core.cp_elements (element_id, cp_id, element_order, nama_elemen, deskripsi_cp, is_active)
SELECT gen_random_uuid(), cp.cp_id, el.element_order, el.nama_elemen, el.deskripsi_cp, true
FROM core.capaian_pembelajaran cp
JOIN core.subject_phases sp ON cp.subject_phase_id = sp.subject_phase_id
JOIN core.subjects s ON sp.subject_id = s.subject_id
JOIN core.phases   p ON sp.phase_id   = p.phase_id
CROSS JOIN (VALUES
  (1, 'Wawasan Dunia Otomotif', 'Menganalisis proses bisnis, perkembangan teknologi, profesi dan peluang usaha di bidang otomotif dalam konteks global dan lokal.'),
  (2, 'Kecakapan Kerja Dasar (Basic Job Skills), K3, dan Budaya Kerja', 'Menerapkan K3LH dan budaya kerja industri, serta menerapkan teknik penggunaan alat ukur, alat tangan, dan alat mesin perkakas.'),
  (3, 'Gambar Teknik Otomotif', 'Menggambar teknik dasar menggunakan standarisasi gambar teknik otomotif.'),
  (4, 'Peralatan dan Perlengkapan Tempat Kerja', 'Menggunakan peralatan dan perlengkapan tempat kerja sesuai prosedur operasional standar dan manual perbaikan.'),
  (5, 'Dasar Kelistrikan dan Elektronika Otomotif', 'Membuat rangkaian elektronika dasar, memahami hukum dasar kelistrikan, dan menerapkan pemeriksaan komponen kelistrikan otomotif.'),
  (6, 'Komponen Otomotif', 'Menjelaskan fungsi dan cara kerja komponen engine, pemindah tenaga, dan sasis, serta mengidentifikasi struktur dan lokasi komponen sesuai manual perbaikan.'),
  (7, 'Dasar Sistem Hidrolik dan Pneumatik', 'Memahami prinsip dasar sistem hidrolik dan pneumatik serta fungsi komponen-komponennya.')
) AS el(element_order, nama_elemen, deskripsi_cp)
WHERE s.code = 'OTOMOTIF-DASAR' AND p.code = 'E'
ON CONFLICT (cp_id, element_order) DO UPDATE SET
  nama_elemen  = EXCLUDED.nama_elemen,
  deskripsi_cp = EXCLUDED.deskripsi_cp,
  is_active    = true;

-- KK-TKRO Fase F — 8 elemen
INSERT INTO core.cp_elements (element_id, cp_id, element_order, nama_elemen, deskripsi_cp, is_active)
SELECT gen_random_uuid(), cp.cp_id, el.element_order, el.nama_elemen, el.deskripsi_cp, true
FROM core.capaian_pembelajaran cp
JOIN core.subject_phases sp ON cp.subject_phase_id = sp.subject_phase_id
JOIN core.subjects s ON sp.subject_id = s.subject_id
JOIN core.phases   p ON sp.phase_id   = p.phase_id
CROSS JOIN (VALUES
  (1, 'Konversi energi kendaraan ringan', 'Mengidentifikasi sumber energi kendaraan ringan beserta jenis-jenisnya termasuk gasoline, diesel, listrik, dan hybrid.'),
  (2, 'Proses pelayanan dan manajemen bengkel kendaraan ringan', 'Menganalisis kerja dan tugas kerja pada bengkel kendaraan ringan.'),
  (3, 'Prosedur penggunaan kendaraan ringan', 'Menerapkan prosedur pengecekan sebelum dan sesudah berkendara dan pengoperasian kendaraan transmisi manual dan automatic.'),
  (4, 'Perawatan berkala kendaraan ringan', 'Melakukan perawatan berkala kendaraan ringan sesuai standar prosedur operasional.'),
  (5, 'Sistem engine kendaraan ringan', 'Melakukan perawatan dan overhaul sistem pelumasan, pendinginan, bahan bakar, manajemen engine, pemasukan udara, dan pembuangan.'),
  (6, 'Sistem pemindah tenaga kendaraan ringan', 'Melakukan perawatan dan overhaul sistem clutch, transmisi manual dan otomatis, poros propeller, differential, dan poros penggerak.'),
  (7, 'Sistem sasis kendaraan ringan', 'Melakukan perawatan sistem rem, kemudi, suspensi, roda, ban, serta spooring dan balancing.'),
  (8, 'Sistem elektrikal kendaraan ringan', 'Melakukan perawatan dan overhaul sistem kelistrikan, penerangan, starter, pengisian, pengapian, AC, dan audio-video.')
) AS el(element_order, nama_elemen, deskripsi_cp)
WHERE s.code = 'KK-TKRO' AND p.code = 'F'
ON CONFLICT (cp_id, element_order) DO UPDATE SET
  nama_elemen  = EXCLUDED.nama_elemen,
  deskripsi_cp = EXCLUDED.deskripsi_cp,
  is_active    = true;

-- KK-TBSM Fase F — 7 elemen
INSERT INTO core.cp_elements (element_id, cp_id, element_order, nama_elemen, deskripsi_cp, is_active)
SELECT gen_random_uuid(), cp.cp_id, el.element_order, el.nama_elemen, el.deskripsi_cp, true
FROM core.capaian_pembelajaran cp
JOIN core.subject_phases sp ON cp.subject_phase_id = sp.subject_phase_id
JOIN core.subjects s ON sp.subject_id = s.subject_id
JOIN core.phases   p ON sp.phase_id   = p.phase_id
CROSS JOIN (VALUES
  (1, 'Perawatan dan perbaikan engine sepeda motor', 'Mendiagnosis gangguan atau kerusakan pada engine sepeda motor dan melakukan perbaikan pada berbagai merek sepeda motor sesuai standar prosedur operasional.'),
  (2, 'Perawatan dan perbaikan sasis sepeda motor', 'Mendiagnosis gangguan atau kerusakan pada sasis sepeda motor beserta komponen-komponennya termasuk sistem rem, kemudi, dan suspensi.'),
  (3, 'Perawatan dan perbaikan sistem pemindah tenaga sepeda motor', 'Mendiagnosis gangguan atau kerusakan pada sistem pemindah tenaga sepeda motor mencakup kopling, transmisi, dan sistem penggerak.'),
  (4, 'Perawatan dan perbaikan sistem kelistrikan sepeda motor', 'Mendiagnosis dan memperbaiki gangguan pada sistem kelistrikan sepeda motor termasuk sistem pengapian, pengisian, starter, penerangan, dan komponen keamanan.'),
  (5, 'Perawatan dan perbaikan sepeda motor listrik dan hybrid', 'Memahami gangguan atau kerusakan pada sepeda motor listrik dan hybrid serta melakukan tindakan perbaikan sesuai prosedur.'),
  (6, 'Perawatan dan perbaikan engine management system', 'Mendiagnosis permasalahan pada sistem pengaliran bahan bakar dan sistem kontrol elektronik sepeda motor.'),
  (7, 'Pengelolaan bengkel sepeda motor', 'Menerapkan pengelolaan, pengembangan teknik dan manajemen perawatan bengkel sepeda motor sesuai perkembangan industri.')
) AS el(element_order, nama_elemen, deskripsi_cp)
WHERE s.code = 'KK-TBSM' AND p.code = 'F'
ON CONFLICT (cp_id, element_order) DO UPDATE SET
  nama_elemen  = EXCLUDED.nama_elemen,
  deskripsi_cp = EXCLUDED.deskripsi_cp,
  is_active    = true;

-- PEMASARAN-DASAR Fase E — 2 elemen
INSERT INTO core.cp_elements (element_id, cp_id, element_order, nama_elemen, deskripsi_cp, is_active)
SELECT gen_random_uuid(), cp.cp_id, el.element_order, el.nama_elemen, el.deskripsi_cp, true
FROM core.capaian_pembelajaran cp
JOIN core.subject_phases sp ON cp.subject_phase_id = sp.subject_phase_id
JOIN core.subjects s ON sp.subject_id = s.subject_id
JOIN core.phases   p ON sp.phase_id   = p.phase_id
CROSS JOIN (VALUES
  (1, 'Wawasan dunia kerja bidang pemasaran di berbagai industri', 'Menganalisis proses bisnis dalam bidang pemasaran secara menyeluruh pada berbagai jenis industri dan usaha, perkembangan pemasaran mulai dari konvensional sampai dengan penerapan teknologi modern, industri 4.0, Internet of Things (IoT), teknologi digital dalam pemasaran, isu-isu perkembangan terkait dengan dunia kerja di bidang pemasaran, profil kewirausahaan serta peluang usaha di bidang pemasaran.'),
  (2, 'Kecakapan kerja dasar (basic job skills), K3, dan budaya kerja', 'Menerapkan prosedur K3 di tempat kerja; berkomunikasi efektif dengan tata bahasa yang baik dan menunjukkan penampilan menarik; memberikan pelayanan prima; serta memahami dan menerapkan kegiatan pemasaran, perilaku konsumen, strategi pemasaran, dan segmentasi pasar.')
) AS el(element_order, nama_elemen, deskripsi_cp)
WHERE s.code = 'PEMASARAN-DASAR' AND p.code = 'E'
ON CONFLICT (cp_id, element_order) DO UPDATE SET
  nama_elemen  = EXCLUDED.nama_elemen,
  deskripsi_cp = EXCLUDED.deskripsi_cp,
  is_active    = true;

-- BD Fase F — 7 elemen
INSERT INTO core.cp_elements (element_id, cp_id, element_order, nama_elemen, deskripsi_cp, is_active)
SELECT gen_random_uuid(), cp.cp_id, el.element_order, el.nama_elemen, el.deskripsi_cp, true
FROM core.capaian_pembelajaran cp
JOIN core.subject_phases sp ON cp.subject_phase_id = sp.subject_phase_id
JOIN core.subjects s ON sp.subject_id = s.subject_id
JOIN core.phases   p ON sp.phase_id   = p.phase_id
CROSS JOIN (VALUES
  (1, 'Marketing', 'Menganalisis struktur dan bentuk pasar, strategi bauran pemasaran, pengembangan produk, daur hidup produk (product life cycle/PLC), dan strategi merek (branding), serta menerapkan penetapan harga jual dan melakukan promosi produk.'),
  (2, 'Perencanaan bisnis', 'Menerapkan analisis lingkungan bisnis, perencanaan strategi bisnis, analisis usaha, menyusun proposal usaha, dan menerapkan strategi pengembangan usaha.'),
  (3, 'Komunikasi bisnis', 'Menerapkan etika bisnis, melakukan negosiasi bisnis, dan melakukan presentasi bisnis secara efektif.'),
  (4, 'Digital branding', 'Memahami ruang lingkup digital branding, membuat logo secara online, melakukan produksi konten digital, foto produk, video produk, dan mengaplikasikan manajemen publikasi konten.'),
  (5, 'Digital onboarding', 'Mengaktifkan penjualan melalui media sosial, website, marketplace, dan online retail.'),
  (6, 'Digital marketing', 'Melakukan analisis data digital, mengaplikasikan Google Business Profile, menerapkan SEO (Search Engine Optimization), menerapkan SEM (Search Engine Marketing), dan strategi promosi digital lainnya.'),
  (7, 'Digital operation', 'Melakukan inventori, mengaplikasikan customer relationship management, melakukan pengiriman barang, dan mengelola operasional bisnis digital.')
) AS el(element_order, nama_elemen, deskripsi_cp)
WHERE s.code = 'BD' AND p.code = 'F'
ON CONFLICT (cp_id, element_order) DO UPDATE SET
  nama_elemen  = EXCLUDED.nama_elemen,
  deskripsi_cp = EXCLUDED.deskripsi_cp,
  is_active    = true;

-- BR Fase F — 7 elemen
INSERT INTO core.cp_elements (element_id, cp_id, element_order, nama_elemen, deskripsi_cp, is_active)
SELECT gen_random_uuid(), cp.cp_id, el.element_order, el.nama_elemen, el.deskripsi_cp, true
FROM core.capaian_pembelajaran cp
JOIN core.subject_phases sp ON cp.subject_phase_id = sp.subject_phase_id
JOIN core.subjects s ON sp.subject_id = s.subject_id
JOIN core.phases   p ON sp.phase_id   = p.phase_id
CROSS JOIN (VALUES
  (1, 'Marketing', 'Menganalisis konsep pasar dalam pemasaran (struktur dan bentuk pasar), serta menerapkan strategi bauran pemasaran dan membuat rencana pemasaran bisnis ritel.'),
  (2, 'Customer Service', 'Menganalisis ruang lingkup customer service dan menerapkan POS (Prosedur Operasional Standar) pelayanan pelanggan.'),
  (3, 'Komunikasi Bisnis', 'Menerapkan konsep komunikasi bisnis baik secara lisan maupun tertulis dalam bahasa Indonesia maupun bahasa Inggris.'),
  (4, 'Pengelolaan Bisnis Ritel', 'Menganalisis ruang lingkup bisnis ritel; menerapkan proses bisnis ritel (ordering, receiving, displaying, selling, dan reporting).'),
  (5, 'Visual Merchandising', 'Mengembangkan rencana visual merchandising (planogram), serta menerapkan visual merchandising pada display produk.'),
  (6, 'Pengemasan dan Pengiriman Produk', 'Menerapkan pengemasan produk, saluran distribusi, penyusunan dokumen pengiriman barang, dan proses pengiriman barang.'),
  (7, 'Administrasi Transaksi', 'Menganalisis transaksi serta menerapkan pengoperasian alat transaksi (mesin kasir, mesin EDC) dan pelaporan transaksi.')
) AS el(element_order, nama_elemen, deskripsi_cp)
WHERE s.code = 'BR' AND p.code = 'F'
ON CONFLICT (cp_id, element_order) DO UPDATE SET
  nama_elemen  = EXCLUDED.nama_elemen,
  deskripsi_cp = EXCLUDED.deskripsi_cp,
  is_active    = true;

-- ELEKTRONIKA-DASAR Fase E — 9 elemen
INSERT INTO core.cp_elements (element_id, cp_id, element_order, nama_elemen, deskripsi_cp, is_active)
SELECT gen_random_uuid(), cp.cp_id, el.element_order, el.nama_elemen, el.deskripsi_cp, true
FROM core.capaian_pembelajaran cp
JOIN core.subject_phases sp ON cp.subject_phase_id = sp.subject_phase_id
JOIN core.subjects s ON sp.subject_id = s.subject_id
JOIN core.phases   p ON sp.phase_id   = p.phase_id
CROSS JOIN (VALUES
  (1, 'Wawasan Dunia Kerja Bidang Elektronika', 'Menganalisis proses bisnis, perkembangan teknologi, profesi dan peluang usaha di bidang elektronika dalam konteks global dan lokal.'),
  (2, 'Kecakapan Kerja Dasar (Basic Job Skills), K3LH, dan Budaya Kerja', 'Menerapkan K3LH dan budaya kerja industri (5R), teknik soldering-desoldering, dan penggunaan perkakas tangan untuk pekerjaan elektronika.'),
  (3, 'Penggunaan Perkakas Tangan', 'Memahami jenis, penggunaan, dan pemeliharaan perkakas tangan untuk pekerjaan elektronika.'),
  (4, 'Gambar Teknik Elektronika', 'Menggambar teknik listrik dan elektronika dengan pengenalan simbol komponen serta peralatan gambar.'),
  (5, 'Konsep Dasar Kelistrikan dan Elektronika', 'Menguasai sistem bilangan, Aljabar Boole, teknik dasar listrik, dan teknik analog-digital dengan rangkaian aplikasi dasar serta elektronika optik.'),
  (6, 'Alat Ukur Listrik, Elektronika, dan Instrumentasi', 'Memahami jenis alat ukur, cara penggunaan, interpretasi hasil, dan perawatan alat ukur listrik, elektronika, dan instrumentasi.'),
  (7, 'Komponen Elektronika Aktif dan Pasif', 'Mengenal komponen elektronika, membaca nilai komponen sesuai kodenya, dan memahami hukum dasar elektronika.'),
  (8, 'Mesin-mesin Listrik, Elektronika, dan Instrumentasi', 'Memahami mesin-mesin listrik, peralatan elektronika, dan instrumentasi beserta komponen-komponennya.'),
  (9, 'Dasar Teknik Digital', 'Memahami teknik rangkaian digital, sistem bilangan, logika kombinasional dan sekuensial.')
) AS el(element_order, nama_elemen, deskripsi_cp)
WHERE s.code = 'ELEKTRONIKA-DASAR' AND p.code = 'E'
ON CONFLICT (cp_id, element_order) DO UPDATE SET
  nama_elemen  = EXCLUDED.nama_elemen,
  deskripsi_cp = EXCLUDED.deskripsi_cp,
  is_active    = true;

-- TEI Fase F — 6 elemen
INSERT INTO core.cp_elements (element_id, cp_id, element_order, nama_elemen, deskripsi_cp, is_active)
SELECT gen_random_uuid(), cp.cp_id, el.element_order, el.nama_elemen, el.deskripsi_cp, true
FROM core.capaian_pembelajaran cp
JOIN core.subject_phases sp ON cp.subject_phase_id = sp.subject_phase_id
JOIN core.subjects s ON sp.subject_id = s.subject_id
JOIN core.phases   p ON sp.phase_id   = p.phase_id
CROSS JOIN (VALUES
  (1, 'Penerapan rangkaian elektronika', 'Menganalisis dan menerapkan penguat diferensial, penguat operasional, rangkaian ADC dan DAC, filter aktif, generator gelombang, rangkaian digital, elektronika daya, catu daya, dan sumber energi terbarukan.'),
  (2, 'Sistem kendali elektronik', 'Mengevaluasi rangkaian kendali analog dan digital, menerapkan rangkaian isolasi, dan menerapkan solid state relay.'),
  (3, 'Pemrograman sistem embedded', 'Merancang sistem minimum, menerapkan bahasa pemrograman, mengoperasikan compiler dan simulator, serta memprogram digital/analog I/O dan komunikasi serial.'),
  (4, 'Antarmuka dan komunikasi data', 'Menerapkan software Object Oriented Programming (OOP), antarmuka, komunikasi data, data logging, dan memanfaatkan Internet of Things (IoT).'),
  (5, 'Sistem kendali industri', 'Menerapkan logika relay, Programmable Logic Controller (PLC), wiring dan commissioning, mengoperasikan HMI, dan sistem jaringan PLC.'),
  (6, 'Pemeliharaan dan perbaikan peralatan elektronika industri', 'Melaksanakan prosedur pemeliharaan, dokumentasi, protokol pengujian, dan melakukan soldering/desoldering komponen Surface Mounted Devices (SMD).')
) AS el(element_order, nama_elemen, deskripsi_cp)
WHERE s.code = 'TEI' AND p.code = 'F'
ON CONFLICT (cp_id, element_order) DO UPDATE SET
  nama_elemen  = EXCLUDED.nama_elemen,
  deskripsi_cp = EXCLUDED.deskripsi_cp,
  is_active    = true;

-- BROADCASTING-DASAR Fase E — 4 elemen
INSERT INTO core.cp_elements (element_id, cp_id, element_order, nama_elemen, deskripsi_cp, is_active)
SELECT gen_random_uuid(), cp.cp_id, el.element_order, el.nama_elemen, el.deskripsi_cp, true
FROM core.capaian_pembelajaran cp
JOIN core.subject_phases sp ON cp.subject_phase_id = sp.subject_phase_id
JOIN core.subjects s ON sp.subject_id = s.subject_id
JOIN core.phases   p ON sp.phase_id   = p.phase_id
CROSS JOIN (VALUES
  (1, 'Dunia kerja, profesi, dan bisnis di bidang Broadcasting dan Perfilman', 'Menganalisis jalur karir, level jabatan, SOP, pemeliharaan peralatan, peluang usaha, dan isu-isu global di sektor broadcasting dan perfilman.'),
  (2, 'Perkembangan media, teknologi, dan industri serta regulasi penyiaran', 'Menganalisis perkembangan proses produksi industri broadcasting dan perfilman dari media analog sampai digital, termasuk format digital, jenis file, kompresi, dan regulasi penyiaran.'),
  (3, 'Teknik dasar pengoperasian peralatan audio visual pada produksi broadcasting dan perfilman', 'Memahami dan mengoperasikan mikrofon, kamera, serta mengidentifikasi dan menggunakan peralatan produksi audio-visual dalam proses produksi.'),
  (4, 'Teknik dasar proses produksi pada industri Broadcasting dan Perfilman', 'Memahami proses produksi radio, televisi, dan film, termasuk sinematografi, desain artistik, tata suara, dan dasar penyuntingan (editing) secara kreatif dan inovatif.')
) AS el(element_order, nama_elemen, deskripsi_cp)
WHERE s.code = 'BROADCASTING-DASAR' AND p.code = 'E'
ON CONFLICT (cp_id, element_order) DO UPDATE SET
  nama_elemen  = EXCLUDED.nama_elemen,
  deskripsi_cp = EXCLUDED.deskripsi_cp,
  is_active    = true;

-- KK-PSPT Fase F — 8 elemen
INSERT INTO core.cp_elements (element_id, cp_id, element_order, nama_elemen, deskripsi_cp, is_active)
SELECT gen_random_uuid(), cp.cp_id, el.element_order, el.nama_elemen, el.deskripsi_cp, true
FROM core.capaian_pembelajaran cp
JOIN core.subject_phases sp ON cp.subject_phase_id = sp.subject_phase_id
JOIN core.subjects s ON sp.subject_id = s.subject_id
JOIN core.phases   p ON sp.phase_id   = p.phase_id
CROSS JOIN (VALUES
  (1, 'Manajemen produksi dan siaran program televisi', 'Memahami prosedur kerja dalam tahapan produksi, organisasi penyiaran televisi, dan sumber daya produksi; merancang siaran kreatif, mengidentifikasi target audiens, menerapkan desain produksi, dan mengelola siaran menggunakan Standar Operasional Prosedur (SOP).'),
  (2, 'Penulisan naskah televisi', 'Memahami prosedur penulisan naskah untuk siaran jurnalistik (berita, live casting, podcast, vlog) dan format artistik (program drama dan non-drama, VOD) sesuai standar industri dan budaya kerja profesional.'),
  (3, 'Penyutradaraan televisi', 'Memahami peran dan tanggung jawab sutradara, aspek teknis, komunikasi verbal/non-verbal, analisis naskah, serta prosedur produksi kamera tunggal dan multi-kamera dengan standar profesional.'),
  (4, 'Tata kamera dan tata cahaya televisi', 'Menerapkan prosedur pra/produksi/pasca-produksi tata kamera, pengoperasian kamera, perencanaan lensa, framing, komposisi, pergerakan, serta pengoperasian dan teknik peralatan pencahayaan.'),
  (5, 'Tata suara televisi', 'Memahami peran departemen suara, prosedur pra/produksi/pasca-produksi, analisis naskah untuk suara, pengoperasian recorder, penempatan mikrofon, prosedur perekaman suara, dan pengorganisasian data audio.'),
  (6, 'Tata artistik televisi', 'Menguasai fungsi departemen artistik dan proses breakdown naskah, membuat desain set, floor plan, sketsa, gambar perspektif, serta mengkoordinasikan dekor, properti, kostum, dan riasan.'),
  (7, 'Editing audio dan video', 'Menganalisis peran editor dan prosedur editing, mengidentifikasi dokumen syuting, manajemen file, dan teknologi editing audio-visual dengan standar profesional.'),
  (8, 'Penyiaran online', 'Melaksanakan siaran online, memahami konsep konten digital untuk televisi FTA/OTT, memanfaatkan fitur aplikasi streaming, mengunggah konten, membuat materi promosi, dan menganalisis keterlibatan audiens.')
) AS el(element_order, nama_elemen, deskripsi_cp)
WHERE s.code = 'KK-PSPT' AND p.code = 'F'
ON CONFLICT (cp_id, element_order) DO UPDATE SET
  nama_elemen  = EXCLUDED.nama_elemen,
  deskripsi_cp = EXCLUDED.deskripsi_cp,
  is_active    = true;

-- BUSANA-DASAR Fase E — 2 elemen
INSERT INTO core.cp_elements (element_id, cp_id, element_order, nama_elemen, deskripsi_cp, is_active)
SELECT gen_random_uuid(), cp.cp_id, el.element_order, el.nama_elemen, el.deskripsi_cp, true
FROM core.capaian_pembelajaran cp
JOIN core.subject_phases sp ON cp.subject_phase_id = sp.subject_phase_id
JOIN core.subjects s ON sp.subject_id = s.subject_id
JOIN core.phases   p ON sp.phase_id   = p.phase_id
CROSS JOIN (VALUES
  (1, 'Wawasan dunia kerja bidang industri busana (fesyen)', 'Menganalisis ekosistem industri mode, proses bisnis bidang busana, perkembangan teknologi di industri busana dari konvensional hingga digital, profil kewirausahaan, peluang usaha, serta isu-isu global dan Product Life Cycle di bidang fesyen.'),
  (2, 'Kecakapan kerja dasar (basic job skills), K3 dan budaya kerja', 'Menerapkan K3 di bidang busana, prosedur kerja, pengoperasian dan pemeliharaan mesin jahit, teknik menjahit sesuai bahan, standar kualitas finishing; serta menerapkan branding, marketing, segmentasi pasar, dan menggambar desain busana dasar.')
) AS el(element_order, nama_elemen, deskripsi_cp)
WHERE s.code = 'BUSANA-DASAR' AND p.code = 'E'
ON CONFLICT (cp_id, element_order) DO UPDATE SET
  nama_elemen  = EXCLUDED.nama_elemen,
  deskripsi_cp = EXCLUDED.deskripsi_cp,
  is_active    = true;

-- KK-DPB Fase F — 5 elemen
INSERT INTO core.cp_elements (element_id, cp_id, element_order, nama_elemen, deskripsi_cp, is_active)
SELECT gen_random_uuid(), cp.cp_id, el.element_order, el.nama_elemen, el.deskripsi_cp, true
FROM core.capaian_pembelajaran cp
JOIN core.subject_phases sp ON cp.subject_phase_id = sp.subject_phase_id
JOIN core.subjects s ON sp.subject_id = s.subject_id
JOIN core.phases   p ON sp.phase_id   = p.phase_id
CROSS JOIN (VALUES
  (1, 'Gaya dan Pengembangan Desain', 'Mengungkapkan karya dan mengembangkan desain dalam satu konsep gaya, menerapkan trend, menerapkan sustainable fashion, dan membuat tema desain busana sesuai yang disepakati.'),
  (2, 'Eksperimen Tekstil dan Desain Hiasan', 'Mengembangkan desain dan olah tekstil yang disesuaikan dengan kebutuhan industri dan kebudayaan daerah, membuat desain hiasan (renda, sulaman, kancing hias, bordir).'),
  (3, 'Persiapan Pembuatan Busana', 'Menyiapkan pembuatan busana yang meliputi pembuatan lembar kerja sesuai spesifikasi desain, membuat langkah kerja produksi, mengambil ukuran, membuat pola, memotong bahan, menghitung biaya, dan menentukan harga produk.'),
  (4, 'Menjahit Produk Busana', 'Menjahit sesuai dengan prosedur, trimming, pressing, dan mengawasi mutu produk busana, serta melaksanakan penyelesaian akhir busana.'),
  (5, 'Penyusunan Koleksi Busana', 'Merencanakan proyek pembuatan koleksi busana secara kelompok dan melakukan presentasi koleksi secara kelompok.')
) AS el(element_order, nama_elemen, deskripsi_cp)
WHERE s.code = 'KK-DPB' AND p.code = 'F'
ON CONFLICT (cp_id, element_order) DO UPDATE SET
  nama_elemen  = EXCLUDED.nama_elemen,
  deskripsi_cp = EXCLUDED.deskripsi_cp,
  is_active    = true;

-- SPERTUNJUKAN-DASAR Fase E — 5 elemen
INSERT INTO core.cp_elements (element_id, cp_id, element_order, nama_elemen, deskripsi_cp, is_active)
SELECT gen_random_uuid(), cp.cp_id, el.element_order, el.nama_elemen, el.deskripsi_cp, true
FROM core.capaian_pembelajaran cp
JOIN core.subject_phases sp ON cp.subject_phase_id = sp.subject_phase_id
JOIN core.subjects s ON sp.subject_id = s.subject_id
JOIN core.phases   p ON sp.phase_id   = p.phase_id
CROSS JOIN (VALUES
  (1, 'Wawasan Budaya Kerja Bidang Seni Pertunjukan', 'Menganalisis lingkup pekerjaan, profesi, peluang usaha, ekonomi kreatif, proses bisnis di industri atau bidang kerja seni pertunjukan, dan perkembangan teknologi maupun isu global yang berpengaruh terhadap bidang seni pertunjukan.'),
  (2, 'Perkembangan Teknologi di Industri dan Dunia Kerja serta Isu-isu Global dalam Seni Pertunjukan', 'Menganalisis perkembangan teknologi dan isu-isu global dalam seni pertunjukan yang terdapat di lingkungan masyarakat sekitar; dan menerapkan teknologi digital dan aplikasi pendukung dalam proses berkarya seni.'),
  (3, 'Konsep Seni Pertunjukan', 'Menerapkan konsep dasar seni pertunjukan sebagai landasan dalam mengembangkan kreativitas dan inovasi seni.'),
  (4, 'Dasar-dasar Produksi Seni Pertunjukan', 'Memahami sarana dan perlengkapan pementasan seni pertunjukan meliputi tata panggung, tata rias, tata busana, tata cahaya, dan tata suara; serta memahami teknik dasar seni pertunjukan secara komprehensif.'),
  (5, 'Kecakapan Kerja Dasar (Basic Job Skills), K3, dan Budaya Kerja', 'Menerapkan K3LH dan budaya kerja (5R) dalam aspek perawatan peralatan dan alur kerja industri seni pertunjukan.')
) AS el(element_order, nama_elemen, deskripsi_cp)
WHERE s.code = 'SPERTUNJUKAN-DASAR' AND p.code = 'E'
ON CONFLICT (cp_id, element_order) DO UPDATE SET
  nama_elemen  = EXCLUDED.nama_elemen,
  deskripsi_cp = EXCLUDED.deskripsi_cp,
  is_active    = true;

-- KK-SENI-TARI Fase F — 3 elemen
INSERT INTO core.cp_elements (element_id, cp_id, element_order, nama_elemen, deskripsi_cp, is_active)
SELECT gen_random_uuid(), cp.cp_id, el.element_order, el.nama_elemen, el.deskripsi_cp, true
FROM core.capaian_pembelajaran cp
JOIN core.subject_phases sp ON cp.subject_phase_id = sp.subject_phase_id
JOIN core.subjects s ON sp.subject_id = s.subject_id
JOIN core.phases   p ON sp.phase_id   = p.phase_id
CROSS JOIN (VALUES
  (1, 'Gerak Dasar Tari', 'Menganalisis anatomi tubuh yang melibatkan gerak di semua bagian dari anggota tubuh manusia serta menerapkan teknik-teknik gerak tari dan kepekaan irama.'),
  (2, 'Tari Tradisi', 'Menganalisis gerak tari, fungsi tari, teknik gerak, dan karakteristik tari serta menampilkan repertoar tari tradisi didukung unsur-unsur tata rias busana, properti, iringan dan tata teknik pentas, serta memiliki kepekaan dalam menggunakan materi tari tradisi untuk menata tari garapan baru.'),
  (3, 'Tari Kreasi', 'Menyajikan ragam tari, dan kreativitas tari dengan menguasai beberapa ragam tari kreasi sebagai bahan untuk mengembangkan kreativitasnya dalam menata dan menyajikan tari garapan baru.')
) AS el(element_order, nama_elemen, deskripsi_cp)
WHERE s.code = 'KK-SENI-TARI' AND p.code = 'F'
ON CONFLICT (cp_id, element_order) DO UPDATE SET
  nama_elemen  = EXCLUDED.nama_elemen,
  deskripsi_cp = EXCLUDED.deskripsi_cp,
  is_active    = true;

-- KK-SENI-TEATER Fase F — 6 elemen
INSERT INTO core.cp_elements (element_id, cp_id, element_order, nama_elemen, deskripsi_cp, is_active)
SELECT gen_random_uuid(), cp.cp_id, el.element_order, el.nama_elemen, el.deskripsi_cp, true
FROM core.capaian_pembelajaran cp
JOIN core.subject_phases sp ON cp.subject_phase_id = sp.subject_phase_id
JOIN core.subjects s ON sp.subject_id = s.subject_id
JOIN core.phases   p ON sp.phase_id   = p.phase_id
CROSS JOIN (VALUES
  (1, 'Proses Bisnis di Dunia Kerja Bidang Penataan Artistik Pertunjukan', 'Menganalisis pekerjaan atau profesi dalam bidang penataan artistik serta peluang usaha di bidang pertunjukan dan ekonomi kreatif.'),
  (2, 'Konsep Penataan Artistik', 'Menganalisis konsep tata artistik berdasarkan hasil pengamatan terhadap seni pertunjukan.'),
  (3, 'Alat dan Bahan Penataan Artistik', 'Menganalisis alat dan bahan penataan artistik secara individu atau kelompok.'),
  (4, 'Desain Penataan Artistik', 'Mengembangkan perencanaan artistik pertunjukan melalui desain penataan artistik secara individu atau kelompok.'),
  (5, 'Teknik Penataan Artistik', 'Menerapkan teknik penataan artistik secara individu atau kelompok.'),
  (6, 'Presentasi Penataan Artistik Pertunjukan', 'Menerapkan penataan artistik pertunjukan pada pementasan secara individu atau kelompok.')
) AS el(element_order, nama_elemen, deskripsi_cp)
WHERE s.code = 'KK-SENI-TEATER' AND p.code = 'F'
ON CONFLICT (cp_id, element_order) DO UPDATE SET
  nama_elemen  = EXCLUDED.nama_elemen,
  deskripsi_cp = EXCLUDED.deskripsi_cp,
  is_active    = true;

-- LOGISTIK-DASAR Fase E — 6 elemen
INSERT INTO core.cp_elements (element_id, cp_id, element_order, nama_elemen, deskripsi_cp, is_active)
SELECT gen_random_uuid(), cp.cp_id, el.element_order, el.nama_elemen, el.deskripsi_cp, true
FROM core.capaian_pembelajaran cp
JOIN core.subject_phases sp ON cp.subject_phase_id = sp.subject_phase_id
JOIN core.subjects s ON sp.subject_id = s.subject_id
JOIN core.phases   p ON sp.phase_id   = p.phase_id
CROSS JOIN (VALUES
  (1, 'Wawasan Dunia Kerja Bidang Teknik Logistik', 'Menganalisis perkembangan industri logistik dan dunia kerja, serta profesi dan kewirausahaan (job-profile dan technopreneurship) di bidang teknik logistik.'),
  (2, 'Kecakapan Kerja Dasar (basic job skills), K3 dan Budaya Kerja', 'Menerapkan K3LH dan budaya kerja; menerapkan proses pengelolaan logistik sesuai prosedur operasional standar.'),
  (3, 'Kegiatan administratif dokumen dan operasional pengadaan barang/jasa', 'Menerapkan kegiatan administrasi dokumen dan administrasi operasional pengadaan barang/jasa.'),
  (4, 'Pelayanan pelanggan', 'Menganalisis pelayanan pelanggan secara prima.'),
  (5, 'Pengelolaan gudang dan perbaikan lingkungan kerja', 'Menerapkan proses penerimaan barang, penyimpanan, proses pengeluaran barang dari gudang, serta perbaikan lingkungan kerja.'),
  (6, 'Teknik distribusi', 'Menerapkan dasar-dasar teknik distribusi pengumpulan, pemrosesan, pengepakan, transportasi, dan pengantaran barang.')
) AS el(element_order, nama_elemen, deskripsi_cp)
WHERE s.code = 'LOGISTIK-DASAR' AND p.code = 'E'
ON CONFLICT (cp_id, element_order) DO UPDATE SET
  nama_elemen  = EXCLUDED.nama_elemen,
  deskripsi_cp = EXCLUDED.deskripsi_cp,
  is_active    = true;

-- KK-LOG Fase F — 6 elemen
INSERT INTO core.cp_elements (element_id, cp_id, element_order, nama_elemen, deskripsi_cp, is_active)
SELECT gen_random_uuid(), cp.cp_id, el.element_order, el.nama_elemen, el.deskripsi_cp, true
FROM core.capaian_pembelajaran cp
JOIN core.subject_phases sp ON cp.subject_phase_id = sp.subject_phase_id
JOIN core.subjects s ON sp.subject_id = s.subject_id
JOIN core.phases   p ON sp.phase_id   = p.phase_id
CROSS JOIN (VALUES
  (1, 'Procurement/pengadaan', 'Menerapkan perencanaan; melakukan negosiasi; menyusun dokumen kontrak; melakukan pemilihan penyedia barang/jasa; dan melaksanakan pengadaan barang/jasa.'),
  (2, 'Aktivitas pergudangan', 'Menerapkan prosedur dalam penanganan barang masuk, penyimpanan barang, pengelolaan peralatan dan fasilitas gudang, pengeluaran barang, dan sistem informasi gudang.'),
  (3, 'Pengemasan barang (packing)', 'Menganalisis jenis barang dan menerapkan teknik pengemasan barang sesuai jenis barang, standar, dan tujuan pengiriman.'),
  (4, 'Teknik pengiriman barang', 'Menerapkan teknik pengiriman barang (collecting, processing, transporting dan delivery); menentukan rute, pemilihan moda transportasi, dan pengurusan dokumen pengiriman barang.'),
  (5, 'Sistem informasi logistik', 'Menerapkan pengoperasian sistem informasi logistik dan menerapkan aplikasi yang relevan untuk mendukung operasional logistik.'),
  (6, 'Perdagangan internasional', 'Menganalisis dasar-dasar perdagangan internasional termasuk regulasi, dokumen, dan prosedur ekspor-impor.')
) AS el(element_order, nama_elemen, deskripsi_cp)
WHERE s.code = 'KK-LOG' AND p.code = 'F'
ON CONFLICT (cp_id, element_order) DO UPDATE SET
  nama_elemen  = EXCLUDED.nama_elemen,
  deskripsi_cp = EXCLUDED.deskripsi_cp,
  is_active    = true;

-- AKL-DASAR Fase E — 2 elemen
INSERT INTO core.cp_elements (element_id, cp_id, element_order, nama_elemen, deskripsi_cp, is_active)
SELECT gen_random_uuid(), cp.cp_id, el.element_order, el.nama_elemen, el.deskripsi_cp, true
FROM core.capaian_pembelajaran cp
JOIN core.subject_phases sp ON cp.subject_phase_id = sp.subject_phase_id
JOIN core.subjects s ON sp.subject_id = s.subject_id
JOIN core.phases   p ON sp.phase_id   = p.phase_id
CROSS JOIN (VALUES
  (1, 'Wawasan dunia kerja bidang akuntansi dan keuangan lembaga', 'Menganalisis profesi, proses bisnis, perkembangan teknologi, dan peluang usaha di bidang akuntansi dan keuangan lembaga; serta mendeskripsikan fungsi manajemen dalam akuntansi dan keuangan lembaga.'),
  (2, 'Kecakapan kerja dasar (basic job skills), K3, dan budaya kerja', 'Menerapkan K3 dan budaya kerja di tempat kerja; mengidentifikasi dokumen keuangan dasar; menerapkan penggunaan teknologi informasi dalam akuntansi; dan memahami etika profesi akuntansi.')
) AS el(element_order, nama_elemen, deskripsi_cp)
WHERE s.code = 'AKL-DASAR' AND p.code = 'E'
ON CONFLICT (cp_id, element_order) DO UPDATE SET
  nama_elemen  = EXCLUDED.nama_elemen,
  deskripsi_cp = EXCLUDED.deskripsi_cp,
  is_active    = true;

-- KK-AKL Fase F — 5 elemen
INSERT INTO core.cp_elements (element_id, cp_id, element_order, nama_elemen, deskripsi_cp, is_active)
SELECT gen_random_uuid(), cp.cp_id, el.element_order, el.nama_elemen, el.deskripsi_cp, true
FROM core.capaian_pembelajaran cp
JOIN core.subject_phases sp ON cp.subject_phase_id = sp.subject_phase_id
JOIN core.subjects s ON sp.subject_id = s.subject_id
JOIN core.phases   p ON sp.phase_id   = p.phase_id
CROSS JOIN (VALUES
  (1, 'Akuntansi perusahaan jasa, dagang dan manufaktur', 'Menganalisis dokumen sumber dan dokumen pendukung pada perusahaan (entitas) untuk keperluan pencatatan akuntansi; menerapkan siklus akuntansi perusahaan jasa, dagang, dan manufaktur.'),
  (2, 'Akuntansi lembaga/instansi pemerintah', 'Menerapkan standar akuntansi yang digunakan lembaga atau instansi pemerintah.'),
  (3, 'Akuntansi keuangan', 'Menerapkan kartu piutang, kartu liabilitas, dan kartu persediaan; menerapkan pengelolaan dokumen kas dan setara kas; dan menyusun laporan keuangan.'),
  (4, 'Komputer akuntansi', 'Menerapkan aplikasi akuntansi modern yang terintegrasi dengan sistem informasi digital.'),
  (5, 'Perpajakan', 'Menerapkan penghitungan pajak terutang, penyusunan laporan, dan penyetoran pajak sesuai ketentuan perpajakan yang berlaku.')
) AS el(element_order, nama_elemen, deskripsi_cp)
WHERE s.code = 'KK-AKL' AND p.code = 'F'
ON CONFLICT (cp_id, element_order) DO UPDATE SET
  nama_elemen  = EXCLUDED.nama_elemen,
  deskripsi_cp = EXCLUDED.deskripsi_cp,
  is_active    = true;

-- ============================================================
-- STEP 8: Soft-deactivate orphan elements
-- Elemen dengan element_order > jumlah elemen BSKAP 046 per subjek.
-- Bukan DELETE (append-only) — hanya is_active = false.
-- 11 subjek terdampak, 38 elemen total.
-- ============================================================

-- Helper macro: deactivate orphans untuk satu subjek/fase
-- TJKT-DASAR Fase E: mig012=7, BSKAP046=4 → orphan order 5,6,7
UPDATE core.cp_elements e
SET is_active = false
WHERE e.element_order > 4
  AND e.cp_id = (
    SELECT cp.cp_id FROM core.capaian_pembelajaran cp
    JOIN core.subject_phases sp ON cp.subject_phase_id = sp.subject_phase_id
    JOIN core.subjects s ON sp.subject_id = s.subject_id
    JOIN core.phases   p ON sp.phase_id   = p.phase_id
    WHERE s.code = 'TJKT-DASAR' AND p.code = 'E'
  );

-- OTOMOTIF-DASAR Fase E: mig012=10, BSKAP046=7 → orphan order 8,9,10
UPDATE core.cp_elements e
SET is_active = false
WHERE e.element_order > 7
  AND e.cp_id = (
    SELECT cp.cp_id FROM core.capaian_pembelajaran cp
    JOIN core.subject_phases sp ON cp.subject_phase_id = sp.subject_phase_id
    JOIN core.subjects s ON sp.subject_id = s.subject_id
    JOIN core.phases   p ON sp.phase_id   = p.phase_id
    WHERE s.code = 'OTOMOTIF-DASAR' AND p.code = 'E'
  );

-- KK-TKRO Fase F: mig012=9, BSKAP046=8 → orphan order 9
UPDATE core.cp_elements e
SET is_active = false
WHERE e.element_order > 8
  AND e.cp_id = (
    SELECT cp.cp_id FROM core.capaian_pembelajaran cp
    JOIN core.subject_phases sp ON cp.subject_phase_id = sp.subject_phase_id
    JOIN core.subjects s ON sp.subject_id = s.subject_id
    JOIN core.phases   p ON sp.phase_id   = p.phase_id
    WHERE s.code = 'KK-TKRO' AND p.code = 'F'
  );

-- PEMASARAN-DASAR Fase E: mig012=9, BSKAP046=2 → orphan order 3–9
UPDATE core.cp_elements e
SET is_active = false
WHERE e.element_order > 2
  AND e.cp_id = (
    SELECT cp.cp_id FROM core.capaian_pembelajaran cp
    JOIN core.subject_phases sp ON cp.subject_phase_id = sp.subject_phase_id
    JOIN core.subjects s ON sp.subject_id = s.subject_id
    JOIN core.phases   p ON sp.phase_id   = p.phase_id
    WHERE s.code = 'PEMASARAN-DASAR' AND p.code = 'E'
  );

-- BD Fase F: mig012=8, BSKAP046=7 → orphan order 8
UPDATE core.cp_elements e
SET is_active = false
WHERE e.element_order > 7
  AND e.cp_id = (
    SELECT cp.cp_id FROM core.capaian_pembelajaran cp
    JOIN core.subject_phases sp ON cp.subject_phase_id = sp.subject_phase_id
    JOIN core.subjects s ON sp.subject_id = s.subject_id
    JOIN core.phases   p ON sp.phase_id   = p.phase_id
    WHERE s.code = 'BD' AND p.code = 'F'
  );

-- ELEKTRONIKA-DASAR Fase E: mig012=11, BSKAP046=9 → orphan order 10,11
UPDATE core.cp_elements e
SET is_active = false
WHERE e.element_order > 9
  AND e.cp_id = (
    SELECT cp.cp_id FROM core.capaian_pembelajaran cp
    JOIN core.subject_phases sp ON cp.subject_phase_id = sp.subject_phase_id
    JOIN core.subjects s ON sp.subject_id = s.subject_id
    JOIN core.phases   p ON sp.phase_id   = p.phase_id
    WHERE s.code = 'ELEKTRONIKA-DASAR' AND p.code = 'E'
  );

-- LOGISTIK-DASAR Fase E: mig012=9, BSKAP046=6 → orphan order 7,8,9
UPDATE core.cp_elements e
SET is_active = false
WHERE e.element_order > 6
  AND e.cp_id = (
    SELECT cp.cp_id FROM core.capaian_pembelajaran cp
    JOIN core.subject_phases sp ON cp.subject_phase_id = sp.subject_phase_id
    JOIN core.subjects s ON sp.subject_id = s.subject_id
    JOIN core.phases   p ON sp.phase_id   = p.phase_id
    WHERE s.code = 'LOGISTIK-DASAR' AND p.code = 'E'
  );

-- BROADCASTING-DASAR Fase E: mig012=11, BSKAP046=4 → orphan order 5–11
UPDATE core.cp_elements e
SET is_active = false
WHERE e.element_order > 4
  AND e.cp_id = (
    SELECT cp.cp_id FROM core.capaian_pembelajaran cp
    JOIN core.subject_phases sp ON cp.subject_phase_id = sp.subject_phase_id
    JOIN core.subjects s ON sp.subject_id = s.subject_id
    JOIN core.phases   p ON sp.phase_id   = p.phase_id
    WHERE s.code = 'BROADCASTING-DASAR' AND p.code = 'E'
  );

-- BUSANA-DASAR Fase E: mig012=9, BSKAP046=2 → orphan order 3–9
UPDATE core.cp_elements e
SET is_active = false
WHERE e.element_order > 2
  AND e.cp_id = (
    SELECT cp.cp_id FROM core.capaian_pembelajaran cp
    JOIN core.subject_phases sp ON cp.subject_phase_id = sp.subject_phase_id
    JOIN core.subjects s ON sp.subject_id = s.subject_id
    JOIN core.phases   p ON sp.phase_id   = p.phase_id
    WHERE s.code = 'BUSANA-DASAR' AND p.code = 'E'
  );

-- KK-DPB Fase F: mig012=7, BSKAP046=5 → orphan order 6,7
UPDATE core.cp_elements e
SET is_active = false
WHERE e.element_order > 5
  AND e.cp_id = (
    SELECT cp.cp_id FROM core.capaian_pembelajaran cp
    JOIN core.subject_phases sp ON cp.subject_phase_id = sp.subject_phase_id
    JOIN core.subjects s ON sp.subject_id = s.subject_id
    JOIN core.phases   p ON sp.phase_id   = p.phase_id
    WHERE s.code = 'KK-DPB' AND p.code = 'F'
  );

-- SPERTUNJUKAN-DASAR Fase E: mig012=7, BSKAP046=5 → orphan order 6,7
UPDATE core.cp_elements e
SET is_active = false
WHERE e.element_order > 5
  AND e.cp_id = (
    SELECT cp.cp_id FROM core.capaian_pembelajaran cp
    JOIN core.subject_phases sp ON cp.subject_phase_id = sp.subject_phase_id
    JOIN core.subjects s ON sp.subject_id = s.subject_id
    JOIN core.phases   p ON sp.phase_id   = p.phase_id
    WHERE s.code = 'SPERTUNJUKAN-DASAR' AND p.code = 'E'
  );

-- ============================================================
-- STEP 9: Verifikasi (jalankan manual setelah apply)
-- ============================================================
/*
SELECT
  s.code,
  p.code AS fase,
  COUNT(CASE WHEN e.is_active = true THEN 1 END)  AS aktif,
  COUNT(CASE WHEN e.is_active = false THEN 1 END) AS nonaktif
FROM core.subjects s
JOIN core.subject_phases sp ON sp.subject_id = s.subject_id
JOIN core.phases p ON sp.phase_id = p.phase_id
LEFT JOIN core.capaian_pembelajaran cp ON cp.subject_phase_id = sp.subject_phase_id
LEFT JOIN core.cp_elements e ON e.cp_id = cp.cp_id
WHERE s.subject_type IN ('KEJURUAN_DASAR','KEJURUAN_KONSENTRASI')
GROUP BY s.code, p.code
ORDER BY s.code, p.code;
*/
