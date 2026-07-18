-- SIP Sprint 1 — 011: Isi CP resmi dari sumber Kemendikdasmen
-- Sumber: guru.kemendikdasmen.go.id (halaman resmi per mapel/fase)
--         blog.kejarcita.id (reproduksi teks resmi CP)
--         Referensi: SK BSKAP No. 046/H/KR/2025
--
-- Strategi:
--   • cp_umum diperbarui hanya untuk mapel yang memiliki pernyataan
--     capaian umum eksplisit dari sumber resmi.
--   • cp_elements diisi untuk semua mapel yang data elemennya tersedia.
--   • Mapel tanpa data resmi tetap [PENDING].
--
-- Idempotent: UPDATE + ON CONFLICT DO UPDATE

-- ================================================================
-- HELPER: subquery standar untuk mendapatkan cp_id per mapel + fase
-- Dipakai berulang di INSERT cp_elements
-- ================================================================

-- ================================================================
-- 1. BAHASA INGGRIS (BING)
-- ================================================================

-- 1a. BING Fase E — update cp_umum (ada teks eksplisit dari sumber resmi)
UPDATE core.capaian_pembelajaran
SET
  cp_umum        = 'Di akhir Fase E, peserta didik mampu menggunakan teks lisan, tulisan, dan visual untuk berkomunikasi sesuai dengan situasi, tujuan pembelajaran, dan pembacanya. Peserta didik telah mempelajari narasi, deskripsi, prosedur, eksposisi, recount, report, dan teks otentik. Peserta didik mampu menggunakan Bahasa Inggris menyampaikan pendapat, berdiskusi topik keseharian, membaca teks untuk mendapatkan informasi, dan membuat teks tulisan dan visual yang beragam.',
  bskap_ref      = 'SK BSKAP No. 046/H/KR/2025',
  effective_date = '2025-07-14',
  is_active      = true,
  updated_at     = now()
WHERE subject_phase_id = (
  SELECT sp.subject_phase_id
  FROM core.subject_phases sp
  JOIN core.subjects s ON sp.subject_id = s.subject_id
  JOIN core.phases   p ON sp.phase_id   = p.phase_id
  WHERE s.code = 'BING' AND p.code = 'E'
);

-- 1b. BING Fase F — update cp_umum
UPDATE core.capaian_pembelajaran
SET
  cp_umum        = 'Peserta didik menggunakan bahasa Inggris untuk berkomunikasi dengan guru, teman sebaya dan orang lain dalam berbagai macam situasi dan tujuan. Mereka menguasai pertanyaan terbuka, menginisiasi dan mempertahankan diskusi, memahami ide utama dari presentasi, menyampaikan opini tentang isu sosial, serta menggunakan strategi koreksi diri dan elemen non-verbal untuk komunikasi yang efektif. Peserta didik membaca dan merespon berbagai macam teks seperti narasi, deskripsi, eksposisi, prosedur, argumentasi, dan diskusi secara mandiri, serta menulis berbagai jenis teks fiksi dan faktual dengan kesadaran terhadap tujuan dan target pembaca.',
  bskap_ref      = 'SK BSKAP No. 046/H/KR/2025',
  effective_date = '2025-07-14',
  is_active      = true,
  updated_at     = now()
WHERE subject_phase_id = (
  SELECT sp.subject_phase_id
  FROM core.subject_phases sp
  JOIN core.subjects s ON sp.subject_id = s.subject_id
  JOIN core.phases   p ON sp.phase_id   = p.phase_id
  WHERE s.code = 'BING' AND p.code = 'F'
);

-- 1c. BING Fase E — elemen
INSERT INTO core.cp_elements (element_id, cp_id, element_order, nama_elemen, deskripsi_cp, is_active)
SELECT gen_random_uuid(), cp.cp_id, elemen.element_order, elemen.nama_elemen, elemen.deskripsi_cp, true
FROM core.capaian_pembelajaran cp
JOIN core.subject_phases sp ON cp.subject_phase_id = sp.subject_phase_id
JOIN core.subjects s ON sp.subject_id = s.subject_id
JOIN core.phases   p ON sp.phase_id   = p.phase_id
CROSS JOIN (VALUES
  (1, 'Menyimak - Berbicara',
   'Peserta didik menggunakan bahasa Inggris untuk berkomunikasi dengan guru, teman sebaya dan orang lain dalam berbagai macam situasi. Peserta didik memahami alur informasi secara keseluruhan, gagasan utama dan detail dalam teks lisan fiksi dan non-fiksi mengenai berbagai macam topik yang relevan dengan topik sehari-hari atau isu terkini. Peserta didik menggunakan bahasa Inggris untuk mengungkapkan pendapat dan mempertahankan argumen tentang topik yang dibahas.'),
  (2, 'Membaca - Memirsa',
   'Peserta didik membaca dan merespon berbagai macam teks seperti narasi, deskripsi, prosedur, eksposisi, recount, dan report untuk pembelajaran dan pencarian informasi. Peserta didik menganalisis dan menginterpretasi informasi eksplisit dan implisit dalam teks fiksi dan non-fiksi dari teks tulis dan multimodal tentang topik sehari-hari atau isu terkini.'),
  (3, 'Menulis - Mempresentasikan',
   'Peserta didik menulis berbagai jenis teks fiksi dan non-fiksi, melalui aktivitas yang dipandu, menggunakan beragam media untuk berkomunikasi dan menyajikan gagasan dengan struktur dan unsur kebahasaan yang sesuai dengan tujuan dan konteks komunikatif.')
) AS elemen(element_order, nama_elemen, deskripsi_cp)
WHERE s.code = 'BING' AND p.code = 'E'
ON CONFLICT (cp_id, element_order) DO UPDATE SET
  nama_elemen  = EXCLUDED.nama_elemen,
  deskripsi_cp = EXCLUDED.deskripsi_cp,
  is_active    = true;

-- 1d. BING Fase F — elemen
INSERT INTO core.cp_elements (element_id, cp_id, element_order, nama_elemen, deskripsi_cp, is_active)
SELECT gen_random_uuid(), cp.cp_id, elemen.element_order, elemen.nama_elemen, elemen.deskripsi_cp, true
FROM core.capaian_pembelajaran cp
JOIN core.subject_phases sp ON cp.subject_phase_id = sp.subject_phase_id
JOIN core.subjects s ON sp.subject_id = s.subject_id
JOIN core.phases   p ON sp.phase_id   = p.phase_id
CROSS JOIN (VALUES
  (1, 'Menyimak - Berbicara',
   'Peserta didik menggunakan bahasa Inggris untuk berkomunikasi dengan guru, teman sebaya dan orang lain dalam berbagai macam situasi dan tujuan. Mereka menguasai pertanyaan terbuka, menginisiasi dan mempertahankan diskusi, memahami ide utama dari presentasi, menyampaikan opini tentang isu sosial, serta menggunakan strategi koreksi diri dan elemen non-verbal untuk komunikasi yang efektif.'),
  (2, 'Membaca - Memirsa',
   'Peserta didik membaca dan merespon berbagai macam teks seperti narasi, deskripsi, eksposisi, prosedur, argumentasi, dan diskusi secara mandiri. Peserta didik membaca untuk pembelajaran dan kesenangan, mengevaluasi detail dari teks cetak dan digital, memahami ide pokok, mengidentifikasi tujuan penulis, serta membuat inferensi terhadap informasi tersirat.'),
  (3, 'Menulis - Mempresentasikan',
   'Peserta didik menulis berbagai jenis teks fiksi dan faktual secara mandiri, menunjukkan kesadaran terhadap tujuan dan target pembaca. Mereka merencanakan, menulis, dan merevisi dengan strategi koreksi diri, mengekspresikan ide kompleks menggunakan kosakata beragam, membuat paragraf terstruktur, serta menyajikan informasi dalam bentuk cetak dan digital.')
) AS elemen(element_order, nama_elemen, deskripsi_cp)
WHERE s.code = 'BING' AND p.code = 'F'
ON CONFLICT (cp_id, element_order) DO UPDATE SET
  nama_elemen  = EXCLUDED.nama_elemen,
  deskripsi_cp = EXCLUDED.deskripsi_cp,
  is_active    = true;

-- ================================================================
-- 2. BAHASA INDONESIA (BIN)
-- cp_umum: tetap [PENDING] — elemen diisi dari sumber resmi
-- ================================================================

-- 2a. BIN Fase E — elemen
INSERT INTO core.cp_elements (element_id, cp_id, element_order, nama_elemen, deskripsi_cp, is_active)
SELECT gen_random_uuid(), cp.cp_id, elemen.element_order, elemen.nama_elemen, elemen.deskripsi_cp, true
FROM core.capaian_pembelajaran cp
JOIN core.subject_phases sp ON cp.subject_phase_id = sp.subject_phase_id
JOIN core.subjects s ON sp.subject_id = s.subject_id
JOIN core.phases   p ON sp.phase_id   = p.phase_id
CROSS JOIN (VALUES
  (1, 'Menyimak',
   'Peserta didik mampu mengevaluasi dan mengkreasi informasi berupa gagasan, pikiran, perasaan, pandangan, arahan atau pesan yang akurat dari menyimak berbagai jenis teks (nonfiksi dan fiksi) dalam bentuk monolog, dialog, dan gelar wicara.'),
  (2, 'Membaca dan Memirsa',
   'Peserta didik mampu mengevaluasi informasi berupa gagasan, pikiran, pandangan, arahan atau pesan dari berbagai jenis teks, misalnya deskripsi, laporan, narasi, rekon, eksplanasi, eksposisi dan diskusi, dari teks visual dan audiovisual untuk menemukan makna yang tersurat dan tersirat. Peserta didik mampu menginterpretasi dan mengintegrasikan teks untuk mengungkapkan simpati, empati, peduli, dan pendapat pro/kontra dari teks visual dan audiovisual.'),
  (3, 'Berbicara dan Mempresentasikan',
   'Peserta didik mampu mengolah dan menyajikan gagasan, pikiran, pandangan, arahan atau pesan untuk tujuan pengajuan usul, perumusan masalah, dan solusi dalam bentuk monolog, dialog, dan gelar wicara secara logis, runtut, kritis, dan kreatif. Peserta didik mampu mengkreasi ungkapan sesuai dengan norma kesopanan dalam berkomunikasi dan berkontribusi lebih aktif dalam diskusi.'),
  (4, 'Menulis',
   'Peserta didik mampu menulis gagasan, pikiran, pandangan, arahan atau pesan tertulis untuk berbagai tujuan secara logis, kritis, dan kreatif dalam bentuk teks informasional dan/atau fiksi. Peserta didik mampu menulis teks eksposisi hasil penelitian dan teks fungsional dunia kerja. Peserta didik mampu mengalihwahanakan satu teks ke teks lainnya untuk tujuan ekonomi kreatif.')
) AS elemen(element_order, nama_elemen, deskripsi_cp)
WHERE s.code = 'BIN' AND p.code = 'E'
ON CONFLICT (cp_id, element_order) DO UPDATE SET
  nama_elemen  = EXCLUDED.nama_elemen,
  deskripsi_cp = EXCLUDED.deskripsi_cp,
  is_active    = true;

-- 2b. BIN Fase F — elemen
INSERT INTO core.cp_elements (element_id, cp_id, element_order, nama_elemen, deskripsi_cp, is_active)
SELECT gen_random_uuid(), cp.cp_id, elemen.element_order, elemen.nama_elemen, elemen.deskripsi_cp, true
FROM core.capaian_pembelajaran cp
JOIN core.subject_phases sp ON cp.subject_phase_id = sp.subject_phase_id
JOIN core.subjects s ON sp.subject_id = s.subject_id
JOIN core.phases   p ON sp.phase_id   = p.phase_id
CROSS JOIN (VALUES
  (1, 'Menyimak',
   'Peserta didik mampu mengevaluasi berbagai gagasan dan pandangan berdasarkan kaidah logika berpikir dari menyimak berbagai jenis teks (nonfiksi dan fiksi) dalam bentuk monolog, dialog, dan gelar wicara. Peserta didik mampu mengkreasi dan mengapresiasi pesan serta mengontekstualisasikan dengan pengalaman diri sendiri.'),
  (2, 'Membaca dan Memirsa',
   'Peserta didik mampu mengevaluasi gagasan dan pandangan berdasarkan kaidah logika berpikir dari membaca berbagai tipe teks di media cetak dan elektronik. Peserta didik mampu mengapresiasi teks fiksi dan nonfiksi dalam bentuk membaca ekstensif.'),
  (3, 'Berbicara dan Mempresentasikan',
   'Peserta didik mampu menyajikan gagasan, pikiran, dan kreativitas dalam berbahasa dalam bentuk monolog, dialog, dan gelar wicara secara logis, sistematis, kritis, dan kreatif. Peserta didik mampu mempertahankan hasil penelitian, serta menyampaikan dan mendiskusikan rumusan masalah dan solusi-solusi terhadap persoalan umum.'),
  (4, 'Menulis',
   'Peserta didik mampu menulis gagasan, pikiran, pandangan, pengetahuan metakognisi untuk berbagai tujuan secara logis, kritis, dan kreatif. Peserta didik mampu menulis teks sastra dalam bentuk puisi, prosa, dan drama. Peserta didik mampu menulis teks refleksi diri dan teks fungsional dunia kerja.')
) AS elemen(element_order, nama_elemen, deskripsi_cp)
WHERE s.code = 'BIN' AND p.code = 'F'
ON CONFLICT (cp_id, element_order) DO UPDATE SET
  nama_elemen  = EXCLUDED.nama_elemen,
  deskripsi_cp = EXCLUDED.deskripsi_cp,
  is_active    = true;

-- ================================================================
-- 3. MATEMATIKA (MAT)
-- ================================================================

-- 3a. MAT Fase E — elemen
INSERT INTO core.cp_elements (element_id, cp_id, element_order, nama_elemen, deskripsi_cp, is_active)
SELECT gen_random_uuid(), cp.cp_id, elemen.element_order, elemen.nama_elemen, elemen.deskripsi_cp, true
FROM core.capaian_pembelajaran cp
JOIN core.subject_phases sp ON cp.subject_phase_id = sp.subject_phase_id
JOIN core.subjects s ON sp.subject_id = s.subject_id
JOIN core.phases   p ON sp.phase_id   = p.phase_id
CROSS JOIN (VALUES
  (1, 'Bilangan',
   'Di akhir fase E, peserta didik dapat menggeneralisasi sifat-sifat bilangan berpangkat (termasuk bilangan pangkat pecahan). Peserta didik mengaplikasikan barisan dan deret aritmetika dan geometri, termasuk masalah yang terkait bunga tunggal dan bunga majemuk.'),
  (2, 'Aljabar dan Fungsi',
   'Di akhir fase E, peserta didik dapat menyelesaikan masalah yang berkaitan dengan sistem persamaan linear tiga variabel dan sistem pertidaksamaan linear dua variabel. Peserta didik dapat menyelesaikan masalah yang berkaitan dengan persamaan dan fungsi kuadrat (termasuk akar imajiner), dan persamaan dan fungsi eksponensial (berbasis sama) dengan menggunakan sifat-sifat yang bersesuaian.'),
  (3, 'Geometri',
   'Di akhir fase E, peserta didik dapat menyelesaikan permasalahan segitiga siku-siku yang melibatkan perbandingan trigonometri dan aplikasinya.'),
  (4, 'Analisis Data dan Peluang',
   'Di akhir fase E, peserta didik dapat merepresentasikan data menggunakan jangkauan kuartil dan interkuartil. Peserta didik dapat membuat dan menginterpretasi box plot (box-and-whisker plot) dan menggunakannya untuk membandingkan himpunan data. Peserta didik dapat menggunakan histogram dan dot plot sesuai kebutuhan. Peserta didik dapat menggunakan diagram pencar untuk menganalisis hubungan dua variabel numerik dan mengevaluasi laporan statistika di media. Peserta didik memahami konsep peluang bersyarat dan kejadian yang saling bebas serta menentukan peluangnya.')
) AS elemen(element_order, nama_elemen, deskripsi_cp)
WHERE s.code = 'MAT' AND p.code = 'E'
ON CONFLICT (cp_id, element_order) DO UPDATE SET
  nama_elemen  = EXCLUDED.nama_elemen,
  deskripsi_cp = EXCLUDED.deskripsi_cp,
  is_active    = true;

-- 3b. MAT Fase F — elemen
INSERT INTO core.cp_elements (element_id, cp_id, element_order, nama_elemen, deskripsi_cp, is_active)
SELECT gen_random_uuid(), cp.cp_id, elemen.element_order, elemen.nama_elemen, elemen.deskripsi_cp, true
FROM core.capaian_pembelajaran cp
JOIN core.subject_phases sp ON cp.subject_phase_id = sp.subject_phase_id
JOIN core.subjects s ON sp.subject_id = s.subject_id
JOIN core.phases   p ON sp.phase_id   = p.phase_id
CROSS JOIN (VALUES
  (1, 'Bilangan',
   'Di akhir fase F, peserta didik dapat memodelkan pinjaman dan investasi dengan bunga majemuk dan anuitas, serta menyelidiki pengaruh masing-masing parameter dalam model tersebut.'),
  (2, 'Aljabar dan Fungsi',
   'Di akhir fase F, peserta didik dapat menyatakan data dalam bentuk matriks. Peserta didik dapat menentukan fungsi invers, komposisi fungsi, dan transformasi fungsi untuk memodelkan situasi dunia nyata menggunakan fungsi yang sesuai (linear, kuadrat, eksponensial).'),
  (3, 'Geometri',
   'Di akhir fase F, peserta didik dapat menerapkan teorema tentang lingkaran, dan menentukan panjang busur dan luas juring lingkaran. Peserta didik juga dapat menerapkan konsep geometri dalam konteks menentukan lokasi dan jarak di permukaan Bumi.'),
  (4, 'Analisis Data dan Peluang',
   'Di akhir fase F, peserta didik dapat melakukan penyelidikan statistika data bivariat. Peserta didik dapat mengidentifikasi dan menganalisis asosiasi antara dua variabel kategorikal dan antara dua variabel numerikal. Peserta didik mampu membedakan asosiasi dan kausalitas. Peserta didik dapat memahami konsep peluang bersyarat, permutasi, dan kombinasi untuk menghitung peluang.')
) AS elemen(element_order, nama_elemen, deskripsi_cp)
WHERE s.code = 'MAT' AND p.code = 'F'
ON CONFLICT (cp_id, element_order) DO UPDATE SET
  nama_elemen  = EXCLUDED.nama_elemen,
  deskripsi_cp = EXCLUDED.deskripsi_cp,
  is_active    = true;

-- ================================================================
-- 4. PENDIDIKAN PANCASILA (PPKn)
-- ================================================================

-- 4a. PPKn Fase E — elemen
INSERT INTO core.cp_elements (element_id, cp_id, element_order, nama_elemen, deskripsi_cp, is_active)
SELECT gen_random_uuid(), cp.cp_id, elemen.element_order, elemen.nama_elemen, elemen.deskripsi_cp, true
FROM core.capaian_pembelajaran cp
JOIN core.subject_phases sp ON cp.subject_phase_id = sp.subject_phase_id
JOIN core.subjects s ON sp.subject_id = s.subject_id
JOIN core.phases   p ON sp.phase_id   = p.phase_id
CROSS JOIN (VALUES
  (1, 'Pancasila',
   'Peserta didik dapat menganalisis cara pandang para pendiri negara tentang dasar negara; menganalisis kedudukan Pancasila sebagai dasar negara, pandangan hidup, dan ideologi negara; merumuskan gagasan solutif untuk mengatasi perilaku yang bertentangan dengan nilai Pancasila dalam kehidupan sehari-hari.'),
  (2, 'Undang-Undang Dasar Negara RI Tahun 1945',
   'Peserta didik mampu menerapkan perilaku taat hukum berdasarkan peraturan yang berlaku di masyarakat; menganalisis tata urutan peraturan perundang-undangan di Indonesia.'),
  (3, 'Bhinneka Tunggal Ika',
   'Peserta didik dapat menyajikan asal usul dan makna semboyan Bhinneka Tunggal Ika sebagai modal sosial; membangun harmoni dalam keberagaman; dan mengenal gotong royong sebagai perwujudan sistem ekonomi Pancasila yang inklusif dan berkeadilan.'),
  (4, 'Negara Kesatuan Republik Indonesia',
   'Peserta didik mampu menerapkan perilaku sesuai dengan hak dan kewajiban sebagai warga sekolah, warga masyarakat dan warga negara; memahami peran dan kedudukannya sebagai WNI; memahami sistem pertahanan dan keamanan negara; menganalisis peran Indonesia dalam hubungan antarbangsa dan negara; serta menguraikan nilai-nilai Pancasila dalam pembangunan nasional.')
) AS elemen(element_order, nama_elemen, deskripsi_cp)
WHERE s.code = 'PPKn' AND p.code = 'E'
ON CONFLICT (cp_id, element_order) DO UPDATE SET
  nama_elemen  = EXCLUDED.nama_elemen,
  deskripsi_cp = EXCLUDED.deskripsi_cp,
  is_active    = true;

-- 4b. PPKn Fase F — elemen
INSERT INTO core.cp_elements (element_id, cp_id, element_order, nama_elemen, deskripsi_cp, is_active)
SELECT gen_random_uuid(), cp.cp_id, elemen.element_order, elemen.nama_elemen, elemen.deskripsi_cp, true
FROM core.capaian_pembelajaran cp
JOIN core.subject_phases sp ON cp.subject_phase_id = sp.subject_phase_id
JOIN core.subjects s ON sp.subject_id = s.subject_id
JOIN core.phases   p ON sp.phase_id   = p.phase_id
CROSS JOIN (VALUES
  (1, 'Pancasila',
   'Peserta didik mampu mendeskripsikan rumusan dan keterkaitan sila-sila dalam Pancasila; menganalisis perilaku yang sesuai dengan nilai Pancasila dan membiasakan perilaku tersebut dalam kehidupan sehari-hari.'),
  (2, 'Undang-Undang Dasar Negara RI Tahun 1945',
   'Peserta didik mampu menganalisis periodisasi pemberlakuan undang-undang dasar di Indonesia; mengidentifikasi jenis hak dan kewajiban asasi manusia dan menganalisis kasus pelanggaran hak serta merumuskan solusinya; memahami sistem pemerintahan di Indonesia.'),
  (3, 'Bhinneka Tunggal Ika',
   'Peserta didik mampu menganalisis potensi konflik dan bersama-sama memberi solusi yang bermartabat berdasarkan nilai-nilai Pancasila; menginisiasi suatu kegiatan bersama dan menetapkan tujuan bersama dengan prinsip gotong royong.'),
  (4, 'Negara Kesatuan Republik Indonesia',
   'Peserta didik mampu mendemonstrasikan praktik demokrasi dalam kehidupan berbangsa dan bernegara; menganalisis ancaman disintegrasi bangsa; memahami peran lembaga negara dalam penegakan hak asasi manusia di Indonesia.')
) AS elemen(element_order, nama_elemen, deskripsi_cp)
WHERE s.code = 'PPKn' AND p.code = 'F'
ON CONFLICT (cp_id, element_order) DO UPDATE SET
  nama_elemen  = EXCLUDED.nama_elemen,
  deskripsi_cp = EXCLUDED.deskripsi_cp,
  is_active    = true;

-- ================================================================
-- 5. PJOK
-- ================================================================

-- 5a. PJOK Fase E — elemen
INSERT INTO core.cp_elements (element_id, cp_id, element_order, nama_elemen, deskripsi_cp, is_active)
SELECT gen_random_uuid(), cp.cp_id, elemen.element_order, elemen.nama_elemen, elemen.deskripsi_cp, true
FROM core.capaian_pembelajaran cp
JOIN core.subject_phases sp ON cp.subject_phase_id = sp.subject_phase_id
JOIN core.subjects s ON sp.subject_id = s.subject_id
JOIN core.phases   p ON sp.phase_id   = p.phase_id
CROSS JOIN (VALUES
  (1, 'Keterampilan Gerak',
   'Pada akhir fase E peserta didik dapat menunjukkan kemampuan dalam mempraktikkan hasil evaluasi penerapan keterampilan gerak berupa permainan dan olahraga, aktivitas senam, aktivitas gerak berirama, dan aktivitas permainan dan olahraga air (kondisional) secara matang pada permainan, aktivitas jasmani lainnya, dan kehidupan nyata sehari-hari.'),
  (2, 'Pengetahuan Gerak',
   'Pada akhir fase E peserta didik dapat mengevaluasi fakta, konsep, prinsip, dan prosedur dalam melakukan evaluasi penerapan keterampilan gerak berupa permainan dan olahraga, aktivitas senam, aktivitas gerak berirama, dan aktivitas permainan dan olahraga air (kondisional) pada permainan, aktivitas jasmani lainnya, dan kehidupan nyata sehari-hari.'),
  (3, 'Pemanfaatan Gerak',
   'Pada akhir fase E peserta didik dapat mengevaluasi fakta, konsep, prinsip, dan prosedur dan mempraktikkan latihan pengembangan kebugaran jasmani terkait kesehatan (physical fitness related health) dan kebugaran jasmani terkait keterampilan (physical fitness related skills), berdasarkan prinsip latihan (Frequency, Intensity, Time, Type/FITT) untuk mendapatkan kebugaran dengan status baik. Peserta didik juga dapat menunjukkan kemampuan dalam mengembangkan pola perilaku hidup sehat berupa penerapan konsep dan prinsip pergaulan sehat antar remaja dan orang lain di sekitarnya.'),
  (4, 'Pengembangan Karakter dan Internalisasi Nilai-nilai Gerak',
   'Pada akhir fase E peserta didik mengembangkan tanggung jawab sosialnya dalam kelompok kecil untuk melakukan perubahan positif, menunjukkan etika yang baik, saling menghormati, dan mengambil bagian dalam kerja kelompok pada aktivitas jasmani atau kegiatan sosial lainnya. Peserta didik juga dapat menumbuhkembangkan cara menghadapi tantangan dalam aktivitas jasmani.')
) AS elemen(element_order, nama_elemen, deskripsi_cp)
WHERE s.code = 'PJOK' AND p.code = 'E'
ON CONFLICT (cp_id, element_order) DO UPDATE SET
  nama_elemen  = EXCLUDED.nama_elemen,
  deskripsi_cp = EXCLUDED.deskripsi_cp,
  is_active    = true;

-- 5b. PJOK Fase F — elemen
INSERT INTO core.cp_elements (element_id, cp_id, element_order, nama_elemen, deskripsi_cp, is_active)
SELECT gen_random_uuid(), cp.cp_id, elemen.element_order, elemen.nama_elemen, elemen.deskripsi_cp, true
FROM core.capaian_pembelajaran cp
JOIN core.subject_phases sp ON cp.subject_phase_id = sp.subject_phase_id
JOIN core.subjects s ON sp.subject_id = s.subject_id
JOIN core.phases   p ON sp.phase_id   = p.phase_id
CROSS JOIN (VALUES
  (1, 'Keterampilan Gerak',
   'Peserta didik dapat menunjukkan kemampuan dalam mempraktikkan hasil rancangan sesuai ragam pola yang ada berupa penerapan keterampilan gerak (motor skills) permainan dan olahraga, aktivitas senam, aktivitas gerak berirama, dan aktivitas permainan dan olahraga air (kondisional) dengan berbagai bentuk taktik dan strategi.'),
  (2, 'Pengetahuan Gerak',
   'Peserta didik dapat merancang prosedur, strategi, dan taktik dengan mengikuti beragam pola yang ada terkait dengan aktivitas penerapan keterampilan gerak (motor skills) berupa permainan dan olahraga, aktivitas senam, aktivitas gerak berirama, dan aktivitas permainan dan olahraga air (kondisional).'),
  (3, 'Pemanfaatan Gerak',
   'Peserta didik dapat merancang dan mempraktikkan program latihan pengembangan kebugaran jasmani terkait kesehatan dan kebugaran jasmani terkait keterampilan sesuai ragam pola yang ada. Peserta didik dapat menganalisis bahaya, cara penularan, dan cara pencegahan HIV/AIDS dan penyakit menular seksual (PMS) lainnya.'),
  (4, 'Pengembangan Karakter dan Internalisasi Nilai-nilai Gerak',
   'Peserta didik dapat mengambil peran sebagai pemimpin kelompok yang lebih besar dalam aktivitas jasmani dan olahraga dengan tetap menjunjung tinggi moral dan etika, serta dapat menginisiasi pembentukan komunitas peminatan agar orang lain menjalankan etika yang baik, saling menghormati, dan mengambil bagian dalam kerja kelompok sosial lainnya.')
) AS elemen(element_order, nama_elemen, deskripsi_cp)
WHERE s.code = 'PJOK' AND p.code = 'F'
ON CONFLICT (cp_id, element_order) DO UPDATE SET
  nama_elemen  = EXCLUDED.nama_elemen,
  deskripsi_cp = EXCLUDED.deskripsi_cp,
  is_active    = true;

-- ================================================================
-- 6. SEJARAH (SEJ) — Fase E only (Fase F: sumber tidak tersedia)
-- ================================================================

INSERT INTO core.cp_elements (element_id, cp_id, element_order, nama_elemen, deskripsi_cp, is_active)
SELECT gen_random_uuid(), cp.cp_id, elemen.element_order, elemen.nama_elemen, elemen.deskripsi_cp, true
FROM core.capaian_pembelajaran cp
JOIN core.subject_phases sp ON cp.subject_phase_id = sp.subject_phase_id
JOIN core.subjects s ON sp.subject_id = s.subject_id
JOIN core.phases   p ON sp.phase_id   = p.phase_id
CROSS JOIN (VALUES
  (1, 'Pemahaman Konsep Sejarah',
   'Peserta didik mampu memahami konsep dasar ilmu sejarah yang dapat digunakan untuk menjelaskan peristiwa sejarah. Peserta didik mampu menganalisis manusia sebagai subjek dan objek sejarah, menganalisis peristiwa sejarah dalam skala lokal, nasional, dan global dalam perspektif kronologis dan diakronis. Peserta didik menguasai konsep asal usul nenek moyang, jalur rempah, kerajaan Hindu-Buddha, dan kerajaan Islam dalam perspektif temporal dan spasial yang beragam.'),
  (2, 'Keterampilan Proses Sejarah',
   'Peserta didik mampu mengamati, menanya, mengumpulkan informasi, mengorganisasikan informasi, dan menarik kesimpulan menggunakan prosedur sejarah. Peserta didik mampu melakukan penelitian sejarah lokal, menjelaskan hubungan sebab-akibat, melakukan analisis multiperspektif, membandingkan dalam skala geografis yang berbeda, mengontekstualisasikan dengan isu kontemporer, dan mengolah informasi sejarah dalam format digital dan non-digital.')
) AS elemen(element_order, nama_elemen, deskripsi_cp)
WHERE s.code = 'SEJ' AND p.code = 'E'
ON CONFLICT (cp_id, element_order) DO UPDATE SET
  nama_elemen  = EXCLUDED.nama_elemen,
  deskripsi_cp = EXCLUDED.deskripsi_cp,
  is_active    = true;

-- ================================================================
-- 7. INFORMATIKA (INF) — Fase E only (sesuai desain seed)
-- ================================================================

INSERT INTO core.cp_elements (element_id, cp_id, element_order, nama_elemen, deskripsi_cp, is_active)
SELECT gen_random_uuid(), cp.cp_id, elemen.element_order, elemen.nama_elemen, elemen.deskripsi_cp, true
FROM core.capaian_pembelajaran cp
JOIN core.subject_phases sp ON cp.subject_phase_id = sp.subject_phase_id
JOIN core.subjects s ON sp.subject_id = s.subject_id
JOIN core.phases   p ON sp.phase_id   = p.phase_id
CROSS JOIN (VALUES
  (1, 'Berpikir Komputasional (BK)',
   'Menerapkan strategi algoritmik standar untuk menghasilkan beberapa solusi persoalan dengan data diskrit bervolume tidak kecil pada kehidupan sehari-hari maupun implementasinya dalam program komputer.'),
  (2, 'Teknologi Informasi dan Komunikasi (TIK)',
   'Memanfaatkan berbagai aplikasi secara bersamaan dan optimal untuk berkomunikasi, mencari sumber data yang akan diolah menjadi informasi, baik di dunia nyata maupun di internet, serta mahir menggunakan fitur lanjut aplikasi perkantoran (pengolah kata, angka, dan presentasi) beserta otomasinya.'),
  (3, 'Sistem Komputer (SK)',
   'Memahami peran sistem operasi dan mekanisme internal yang terjadi pada interaksi antara perangkat keras, perangkat lunak, dan pengguna.'),
  (4, 'Jaringan dan Komunikasi Internet (JKI)',
   'Menerapkan konektivitas jaringan lokal, komunikasi data via ponsel, konektivitas internet melalui jaringan kabel dan nirkabel (bluetooth, wifi, internet), enkripsi untuk memproteksi data.'),
  (5, 'Analisis Data (AD)',
   'Memahami aspek privasi dan keamanan data, mengumpulkan dan mengintegrasikan data dari berbagai sumber untuk menghasilkan visualisasi, memodelkan data, serta menerapkan siklus pengolahan data dengan perkakas yang sesuai.'),
  (6, 'Algoritma dan Pemrograman (AP)',
   'Menerapkan praktik baik konsep pemrograman prosedural dalam salah satu bahasa pemrograman prosedural dan mengembangkan program terstruktur dalam bentuk beberapa fungsi yang saling memanggil.'),
  (7, 'Dampak Sosial Informatika (DSI)',
   'Memahami sejarah perkembangan komputer, sejarah internet, hak kekayaan intelektual, privasi, lisensi, dan aspek teknis, hukum, ekonomi, lingkungan, dan sosial dari produk TIK.'),
  (8, 'Proyek Lintas Bidang (PLB)',
   'Bergotong royong dalam tim inklusif untuk mengerjakan proyek bertema Informatika yang membutuhkan penyelesaian masalah komputasional secara kreatif, dengan mengidentifikasi persoalan, merancang, mengimplementasi, menguji, dan menyempurnakan program komputer berbasis algoritma.')
) AS elemen(element_order, nama_elemen, deskripsi_cp)
WHERE s.code = 'INF' AND p.code = 'E'
ON CONFLICT (cp_id, element_order) DO UPDATE SET
  nama_elemen  = EXCLUDED.nama_elemen,
  deskripsi_cp = EXCLUDED.deskripsi_cp,
  is_active    = true;

-- ================================================================
-- 8. PROJEK IPAS (IPAS) — Fase E only
-- ================================================================

INSERT INTO core.cp_elements (element_id, cp_id, element_order, nama_elemen, deskripsi_cp, is_active)
SELECT gen_random_uuid(), cp.cp_id, elemen.element_order, elemen.nama_elemen, elemen.deskripsi_cp, true
FROM core.capaian_pembelajaran cp
JOIN core.subject_phases sp ON cp.subject_phase_id = sp.subject_phase_id
JOIN core.subjects s ON sp.subject_id = s.subject_id
JOIN core.phases   p ON sp.phase_id   = p.phase_id
CROSS JOIN (VALUES
  (1, 'Menjelaskan Fenomena Secara Ilmiah',
   'Peserta didik memahami pengetahuan ilmiah dan menerapkannya; atau membuat prediksi sederhana disertai dengan pembuktiannya. Peserta didik menjelaskan fenomena-fenomena yang terjadi di lingkungan sekitarnya dilihat dari berbagai aspek seperti makhluk hidup dan lingkungannya; zat dan perubahannya; energi dan perubahannya; bumi dan antariksa; keruangan dan konektivitas antar ruang dan waktu; interaksi, komunikasi, sosialisasi, institusi sosial dan dinamika sosial; serta perilaku ekonomi dan kesejahteraan. Peserta didik juga mengaitkan fenomena-fenomena tersebut dengan keterampilan teknis pada bidang keahliannya.'),
  (2, 'Mendesain dan Mengevaluasi Penyelidikan Ilmiah',
   'Peserta didik dapat menentukan dan mengikuti prosedur yang tepat untuk melakukan penyelidikan ilmiah, menjelaskan cara penyelidikan yang tepat untuk suatu pertanyaan ilmiah, serta dapat mengidentifikasi kekurangan atau kesalahan pada desain percobaan ilmiah.'),
  (3, 'Menerjemahkan Data dan Bukti Secara Ilmiah',
   'Peserta didik dapat menerjemahkan data dan bukti dari berbagai sumber untuk membangun sebuah argumen. Peserta didik dapat mengidentifikasi kesimpulan yang benar diambil dari tabel hasil percobaan, melakukan refleksi terhadap proses sains yang telah dilakukan, dan mengkomunikasikan hasil penyelidikan secara tertulis maupun lisan.')
) AS elemen(element_order, nama_elemen, deskripsi_cp)
WHERE s.code = 'IPAS' AND p.code = 'E'
ON CONFLICT (cp_id, element_order) DO UPDATE SET
  nama_elemen  = EXCLUDED.nama_elemen,
  deskripsi_cp = EXCLUDED.deskripsi_cp,
  is_active    = true;

-- ================================================================
-- 9. PROJEK KREATIF & KEWIRAUSAHAAN (PKW) — Fase F only
-- ================================================================

INSERT INTO core.cp_elements (element_id, cp_id, element_order, nama_elemen, deskripsi_cp, is_active)
SELECT gen_random_uuid(), cp.cp_id, elemen.element_order, elemen.nama_elemen, elemen.deskripsi_cp, true
FROM core.capaian_pembelajaran cp
JOIN core.subject_phases sp ON cp.subject_phase_id = sp.subject_phase_id
JOIN core.subjects s ON sp.subject_id = s.subject_id
JOIN core.phases   p ON sp.phase_id   = p.phase_id
CROSS JOIN (VALUES
  (1, 'Kegiatan Produksi',
   'Peserta didik mampu menyusun rencana produksi meliputi menetapkan jenis dan jumlah produk, menetapkan desain/rancangan produk, menyiapkan alat dan bahan, serta menghitung biaya produksi. Peserta didik mampu membuat/memproduksi produk berdasarkan kriteria standar/spesifikasi produk, melakukan pengendalian kualitas/mutu produk (quality assurance), menyusun kemasan produk, menerapkan strategi distribusi, dan menangani keluhan pelanggan.'),
  (2, 'Kewirausahaan',
   'Peserta didik mampu membaca peluang usaha dengan mengidentifikasi potensi yang ada di lingkungan internal dan eksternal SMK, dan menentukan jenis usaha. Peserta didik mampu menyusun proposal usaha (business plan) yang meliputi perencanaan usaha, biaya produksi, break even point (BEP), dan return of investment (ROI). Peserta didik mampu memasarkan produk dengan menentukan segmen pasar, menetapkan harga jual produk, dan menentukan media promosi yang digunakan untuk memasarkan produk. Peserta didik mampu menerapkan prinsip-prinsip Hak atas Kekayaan Intelektual (HAKI). Peserta didik mampu menyusun laporan keuangan berupa laporan neraca, laba rugi, perubahan modal, dan arus kas.')
) AS elemen(element_order, nama_elemen, deskripsi_cp)
WHERE s.code = 'PKW' AND p.code = 'F'
ON CONFLICT (cp_id, element_order) DO UPDATE SET
  nama_elemen  = EXCLUDED.nama_elemen,
  deskripsi_cp = EXCLUDED.deskripsi_cp,
  is_active    = true;
