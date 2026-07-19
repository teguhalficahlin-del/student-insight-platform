-- Migration: 20260718016000_sip_016_seed_cp_seni_budaya.sql
-- Seed cp_elements untuk Seni Budaya Fase E (4 mapel)
-- Source: guru.kemendikdasmen.go.id + SK BSKAP No. 046/H/KR/2025

-- ============================================================
-- SENI MUSIK (SB_MUS) FASE E — 5 elemen
-- ============================================================

INSERT INTO core.cp_elements (element_id, cp_id, element_order, nama_elemen, deskripsi_cp, is_active)
SELECT gen_random_uuid(), cp.cp_id, 1,
  'Mengalami (Experiencing)',
  'Pada akhir fase ini, peserta didik mampu menyimak, melibatkan diri secara aktif dalam pengalaman atas kesan terhadap bunyi-musik, peka dan paham, serta secara sadar melibatkan konteks sajian musik dan berpartisipasi aktif dalam sajian musik yang berguna bagi perbaikan hidup baik untuk diri sendiri, sesama, lingkungan, dan alam semesta.',
  true
FROM core.capaian_pembelajaran cp
JOIN core.subject_phases sp ON cp.subject_phase_id = sp.subject_phase_id
JOIN core.subjects s ON sp.subject_id = s.subject_id
JOIN core.phases p ON sp.phase_id = p.phase_id
WHERE s.code = 'SB_MUS' AND p.code = 'E'
ON CONFLICT (cp_id, element_order) DO UPDATE
SET nama_elemen = EXCLUDED.nama_elemen, deskripsi_cp = EXCLUDED.deskripsi_cp;

INSERT INTO core.cp_elements (element_id, cp_id, element_order, nama_elemen, deskripsi_cp, is_active)
SELECT gen_random_uuid(), cp.cp_id, 2,
  'Merefleksikan (Reflecting)',
  'Memberi dan menerima umpan balik secara kritis mengenai suatu karya dan penciptaan karya musik secara runtut dan terperinci dengan menggunakan kosa kata yang tepat.',
  true
FROM core.capaian_pembelajaran cp
JOIN core.subject_phases sp ON cp.subject_phase_id = sp.subject_phase_id
JOIN core.subjects s ON sp.subject_id = s.subject_id
JOIN core.phases p ON sp.phase_id = p.phase_id
WHERE s.code = 'SB_MUS' AND p.code = 'E'
ON CONFLICT (cp_id, element_order) DO UPDATE
SET nama_elemen = EXCLUDED.nama_elemen, deskripsi_cp = EXCLUDED.deskripsi_cp;

INSERT INTO core.cp_elements (element_id, cp_id, element_order, nama_elemen, deskripsi_cp, is_active)
SELECT gen_random_uuid(), cp.cp_id, 3,
  'Berpikir dan Bekerja Secara Artistik (Thinking and Working Artistically)',
  'Pada akhir fase ini, peserta didik mampu menjalani kebiasaan baik dan rutin dalam berpraktik musik sejak dari persiapan, saat, maupun usai berpraktik musik dengan kesadaran untuk perkembangan dan perbaikan kelancaran serta keluwesan bermusik, serta memilih, memainkan, menghasilkan, menganalisis, dan merefleksi karya-karya musik secara aktif, kreatif, artistik, dan musikal secara bebas dan bertanggung jawab, serta sensitif terhadap fenomena kehidupan manusia.',
  true
FROM core.capaian_pembelajaran cp
JOIN core.subject_phases sp ON cp.subject_phase_id = sp.subject_phase_id
JOIN core.subjects s ON sp.subject_id = s.subject_id
JOIN core.phases p ON sp.phase_id = p.phase_id
WHERE s.code = 'SB_MUS' AND p.code = 'E'
ON CONFLICT (cp_id, element_order) DO UPDATE
SET nama_elemen = EXCLUDED.nama_elemen, deskripsi_cp = EXCLUDED.deskripsi_cp;

INSERT INTO core.cp_elements (element_id, cp_id, element_order, nama_elemen, deskripsi_cp, is_active)
SELECT gen_random_uuid(), cp.cp_id, 4,
  'Menciptakan (Creating)',
  'Pada akhir fase ini, peserta didik mampu menghasilkan gagasan dan karya musik yang otentik dalam sebuah sajian dengan kepekaan akan unsur-unsur bunyi-musik baik intrinsik maupun ekstrinsik, keragaman konteks, melibatkan praktik-praktik selain musik (bentuk seni yang lain) baik secara terencana maupun situasional yang berguna bagi perbaikan hidup diri sendiri, sesama, lingkungan, dan alam semesta.',
  true
FROM core.capaian_pembelajaran cp
JOIN core.subject_phases sp ON cp.subject_phase_id = sp.subject_phase_id
JOIN core.subjects s ON sp.subject_id = s.subject_id
JOIN core.phases p ON sp.phase_id = p.phase_id
WHERE s.code = 'SB_MUS' AND p.code = 'E'
ON CONFLICT (cp_id, element_order) DO UPDATE
SET nama_elemen = EXCLUDED.nama_elemen, deskripsi_cp = EXCLUDED.deskripsi_cp;

INSERT INTO core.cp_elements (element_id, cp_id, element_order, nama_elemen, deskripsi_cp, is_active)
SELECT gen_random_uuid(), cp.cp_id, 5,
  'Berdampak (Impacting)',
  'Pada akhir fase ini, peserta didik mampu menjalani kebiasaan baik dan rutin dalam berpraktik musik dan aktif dalam kegiatan-kegiatan bermusik lewat bernyanyi, memainkan media bunyi-musik dan memperluas wilayah praktik musiknya dengan praktik-praktik lain di luar musik serta terus mengusahakan mendapatkan pengalaman dan kesan baik dan berharga bagi perbaikan dan kemajuan diri sendiri secara utuh dan bersama.',
  true
FROM core.capaian_pembelajaran cp
JOIN core.subject_phases sp ON cp.subject_phase_id = sp.subject_phase_id
JOIN core.subjects s ON sp.subject_id = s.subject_id
JOIN core.phases p ON sp.phase_id = p.phase_id
WHERE s.code = 'SB_MUS' AND p.code = 'E'
ON CONFLICT (cp_id, element_order) DO UPDATE
SET nama_elemen = EXCLUDED.nama_elemen, deskripsi_cp = EXCLUDED.deskripsi_cp;

-- ============================================================
-- SENI RUPA (SB_RUP) FASE E — 5 elemen
-- ============================================================

INSERT INTO core.cp_elements (element_id, cp_id, element_order, nama_elemen, deskripsi_cp, is_active)
SELECT gen_random_uuid(), cp.cp_id, 1,
  'Mengalami (Experiencing)',
  'Pada akhir fase E, peserta didik mampu mengamati, mengenal, merekam dan menuangkan pengalaman dan pengamatannya terhadap lingkungan, perasaan, empati atau penilaiannya secara visual dengan menggunakan proporsi, gestur, ruang yang rinci.',
  true
FROM core.capaian_pembelajaran cp
JOIN core.subject_phases sp ON cp.subject_phase_id = sp.subject_phase_id
JOIN core.subjects s ON sp.subject_id = s.subject_id
JOIN core.phases p ON sp.phase_id = p.phase_id
WHERE s.code = 'SB_RUP' AND p.code = 'E'
ON CONFLICT (cp_id, element_order) DO UPDATE
SET nama_elemen = EXCLUDED.nama_elemen, deskripsi_cp = EXCLUDED.deskripsi_cp;

INSERT INTO core.cp_elements (element_id, cp_id, element_order, nama_elemen, deskripsi_cp, is_active)
SELECT gen_random_uuid(), cp.cp_id, 2,
  'Menciptakan (Creating)',
  'Pada akhir fase E, peserta didik mampu menciptakan karya seni yang menunjukkan pilihan keterampilan, medium dan pengetahuan elemen seni rupa atau prinsip desain tertentu yang sesuai dengan tujuan karyanya.',
  true
FROM core.capaian_pembelajaran cp
JOIN core.subject_phases sp ON cp.subject_phase_id = sp.subject_phase_id
JOIN core.subjects s ON sp.subject_id = s.subject_id
JOIN core.phases p ON sp.phase_id = p.phase_id
WHERE s.code = 'SB_RUP' AND p.code = 'E'
ON CONFLICT (cp_id, element_order) DO UPDATE
SET nama_elemen = EXCLUDED.nama_elemen, deskripsi_cp = EXCLUDED.deskripsi_cp;

INSERT INTO core.cp_elements (element_id, cp_id, element_order, nama_elemen, deskripsi_cp, is_active)
SELECT gen_random_uuid(), cp.cp_id, 3,
  'Merefleksikan (Reflecting)',
  'Pada akhir fase E, peserta didik mampu secara kritis mengevaluasi dan menganalisa efektivitas pesan dan penggunaan medium sebuah karya, pribadi maupun orang lain.',
  true
FROM core.capaian_pembelajaran cp
JOIN core.subject_phases sp ON cp.subject_phase_id = sp.subject_phase_id
JOIN core.subjects s ON sp.subject_id = s.subject_id
JOIN core.phases p ON sp.phase_id = p.phase_id
WHERE s.code = 'SB_RUP' AND p.code = 'E'
ON CONFLICT (cp_id, element_order) DO UPDATE
SET nama_elemen = EXCLUDED.nama_elemen, deskripsi_cp = EXCLUDED.deskripsi_cp;

INSERT INTO core.cp_elements (element_id, cp_id, element_order, nama_elemen, deskripsi_cp, is_active)
SELECT gen_random_uuid(), cp.cp_id, 4,
  'Berpikir dan Bekerja Artistik (Thinking and Working Artistically)',
  'Pada akhir fase E, peserta didik mampu berkarya dan mengapresiasi berdasarkan perasaan, empati dan penilaian pada karya seni secara ekspresif, produktif, inventif dan inovatif. Peserta didik mampu menggunakan kreativitasnya, mengajukan pertanyaan yang bermakna dan mengembangkan gagasan dan menggunakan berbagai sudut pandang untuk mendapatkan gagasan, menciptakan peluang, menjawab tantangan dan menyelesaikan masalah dalam kehidupan sehari-hari. Peserta didik juga mampu bekerja secara mandiri, bergotong royong maupun berkolaborasi dengan bidang keilmuan lain atau masyarakat di lingkungan sekitar.',
  true
FROM core.capaian_pembelajaran cp
JOIN core.subject_phases sp ON cp.subject_phase_id = sp.subject_phase_id
JOIN core.subjects s ON sp.subject_id = s.subject_id
JOIN core.phases p ON sp.phase_id = p.phase_id
WHERE s.code = 'SB_RUP' AND p.code = 'E'
ON CONFLICT (cp_id, element_order) DO UPDATE
SET nama_elemen = EXCLUDED.nama_elemen, deskripsi_cp = EXCLUDED.deskripsi_cp;

INSERT INTO core.cp_elements (element_id, cp_id, element_order, nama_elemen, deskripsi_cp, is_active)
SELECT gen_random_uuid(), cp.cp_id, 5,
  'Berdampak (Impacting)',
  'Pada akhir fase E, peserta didik mampu membuat karya sendiri atas dasar perasaan, minat, nalar dan sesuai akar budaya pada masyarakatnya.',
  true
FROM core.capaian_pembelajaran cp
JOIN core.subject_phases sp ON cp.subject_phase_id = sp.subject_phase_id
JOIN core.subjects s ON sp.subject_id = s.subject_id
JOIN core.phases p ON sp.phase_id = p.phase_id
WHERE s.code = 'SB_RUP' AND p.code = 'E'
ON CONFLICT (cp_id, element_order) DO UPDATE
SET nama_elemen = EXCLUDED.nama_elemen, deskripsi_cp = EXCLUDED.deskripsi_cp;

-- ============================================================
-- SENI TEATER (SB_TEA) FASE E — 5 elemen
-- ============================================================

INSERT INTO core.cp_elements (element_id, cp_id, element_order, nama_elemen, deskripsi_cp, is_active)
SELECT gen_random_uuid(), cp.cp_id, 1,
  'Mengalami (Experiencing)',
  'Latihan olah tubuh dan vokal merupakan dasar keaktoran yang dilakukan untuk penguasaan gerak tubuh agar mampu memainkan beragam karakter, kemudian penguasaan membaca dialog atau naskah dengan penekanan kuat pada ekspresi wajah, artikulasi dan intonasi. Eksplorasi bahasa tubuh, wajah, dan suara untuk menunjukkan kepekaan terhadap persoalan sosial, dan eksplorasi komunikasi non-verbal.',
  true
FROM core.capaian_pembelajaran cp
JOIN core.subject_phases sp ON cp.subject_phase_id = sp.subject_phase_id
JOIN core.subjects s ON sp.subject_id = s.subject_id
JOIN core.phases p ON sp.phase_id = p.phase_id
WHERE s.code = 'SB_TEA' AND p.code = 'E'
ON CONFLICT (cp_id, element_order) DO UPDATE
SET nama_elemen = EXCLUDED.nama_elemen, deskripsi_cp = EXCLUDED.deskripsi_cp;

INSERT INTO core.cp_elements (element_id, cp_id, element_order, nama_elemen, deskripsi_cp, is_active)
SELECT gen_random_uuid(), cp.cp_id, 2,
  'Merefleksikan (Reflecting)',
  'Murid mengenali, mengidentifikasi, mengelompokkan, membandingkan, dan mengevaluasi karya teater.',
  true
FROM core.capaian_pembelajaran cp
JOIN core.subject_phases sp ON cp.subject_phase_id = sp.subject_phase_id
JOIN core.subjects s ON sp.subject_id = s.subject_id
JOIN core.phases p ON sp.phase_id = p.phase_id
WHERE s.code = 'SB_TEA' AND p.code = 'E'
ON CONFLICT (cp_id, element_order) DO UPDATE
SET nama_elemen = EXCLUDED.nama_elemen, deskripsi_cp = EXCLUDED.deskripsi_cp;

INSERT INTO core.cp_elements (element_id, cp_id, element_order, nama_elemen, deskripsi_cp, is_active)
SELECT gen_random_uuid(), cp.cp_id, 3,
  'Berpikir dan Bekerja Secara Artistik (Thinking and Working Artistically)',
  'Proses dilakukan oleh peserta didik berpikir dan bermain dengan tata artistik panggung, mulai dari mengeksplorasi, merancang, dan memproduksi, dan memainkan tata artistik panggung.',
  true
FROM core.capaian_pembelajaran cp
JOIN core.subject_phases sp ON cp.subject_phase_id = sp.subject_phase_id
JOIN core.subjects s ON sp.subject_id = s.subject_id
JOIN core.phases p ON sp.phase_id = p.phase_id
WHERE s.code = 'SB_TEA' AND p.code = 'E'
ON CONFLICT (cp_id, element_order) DO UPDATE
SET nama_elemen = EXCLUDED.nama_elemen, deskripsi_cp = EXCLUDED.deskripsi_cp;

INSERT INTO core.cp_elements (element_id, cp_id, element_order, nama_elemen, deskripsi_cp, is_active)
SELECT gen_random_uuid(), cp.cp_id, 4,
  'Mengekspresikan (Expressing)',
  'Murid mengekspresikan diri melalui karya dan pertunjukan teater secara mandiri maupun bersama.',
  true
FROM core.capaian_pembelajaran cp
JOIN core.subject_phases sp ON cp.subject_phase_id = sp.subject_phase_id
JOIN core.subjects s ON sp.subject_id = s.subject_id
JOIN core.phases p ON sp.phase_id = p.phase_id
WHERE s.code = 'SB_TEA' AND p.code = 'E'
ON CONFLICT (cp_id, element_order) DO UPDATE
SET nama_elemen = EXCLUDED.nama_elemen, deskripsi_cp = EXCLUDED.deskripsi_cp;

INSERT INTO core.cp_elements (element_id, cp_id, element_order, nama_elemen, deskripsi_cp, is_active)
SELECT gen_random_uuid(), cp.cp_id, 5,
  'Berdampak (Impacting)',
  'Proses belajar dan produk akhir mencerminkan Profil Lulusan melalui observasi dan pengumpulan data.',
  true
FROM core.capaian_pembelajaran cp
JOIN core.subject_phases sp ON cp.subject_phase_id = sp.subject_phase_id
JOIN core.subjects s ON sp.subject_id = s.subject_id
JOIN core.phases p ON sp.phase_id = p.phase_id
WHERE s.code = 'SB_TEA' AND p.code = 'E'
ON CONFLICT (cp_id, element_order) DO UPDATE
SET nama_elemen = EXCLUDED.nama_elemen, deskripsi_cp = EXCLUDED.deskripsi_cp;

-- ============================================================
-- SENI TARI (SB_TAR) FASE E — 3 elemen
-- ============================================================

INSERT INTO core.cp_elements (element_id, cp_id, element_order, nama_elemen, deskripsi_cp, is_active)
SELECT gen_random_uuid(), cp.cp_id, 1,
  'Gerak Dasar Tari',
  'Meliputi mengidentifikasi anatomi tubuh yang melibatkan gerak di semua bagian dari anggota tubuh manusia, melatih teknik-teknik gerak tari, melatih kepekaan irama.',
  true
FROM core.capaian_pembelajaran cp
JOIN core.subject_phases sp ON cp.subject_phase_id = sp.subject_phase_id
JOIN core.subjects s ON sp.subject_id = s.subject_id
JOIN core.phases p ON sp.phase_id = p.phase_id
WHERE s.code = 'SB_TAR' AND p.code = 'E'
ON CONFLICT (cp_id, element_order) DO UPDATE
SET nama_elemen = EXCLUDED.nama_elemen, deskripsi_cp = EXCLUDED.deskripsi_cp;

INSERT INTO core.cp_elements (element_id, cp_id, element_order, nama_elemen, deskripsi_cp, is_active)
SELECT gen_random_uuid(), cp.cp_id, 2,
  'Tari Tradisi',
  'Meliputi mengidentifikasi gerak tari, fungsi tari, teknik gerak, dan karakteristik tari.',
  true
FROM core.capaian_pembelajaran cp
JOIN core.subject_phases sp ON cp.subject_phase_id = sp.subject_phase_id
JOIN core.subjects s ON sp.subject_id = s.subject_id
JOIN core.phases p ON sp.phase_id = p.phase_id
WHERE s.code = 'SB_TAR' AND p.code = 'E'
ON CONFLICT (cp_id, element_order) DO UPDATE
SET nama_elemen = EXCLUDED.nama_elemen, deskripsi_cp = EXCLUDED.deskripsi_cp;

INSERT INTO core.cp_elements (element_id, cp_id, element_order, nama_elemen, deskripsi_cp, is_active)
SELECT gen_random_uuid(), cp.cp_id, 3,
  'Tari Kreasi',
  'Meliputi keterampilan dalam menyajikan ragam tari, dan kreativitas tari.',
  true
FROM core.capaian_pembelajaran cp
JOIN core.subject_phases sp ON cp.subject_phase_id = sp.subject_phase_id
JOIN core.subjects s ON sp.subject_id = s.subject_id
JOIN core.phases p ON sp.phase_id = p.phase_id
WHERE s.code = 'SB_TAR' AND p.code = 'E'
ON CONFLICT (cp_id, element_order) DO UPDATE
SET nama_elemen = EXCLUDED.nama_elemen, deskripsi_cp = EXCLUDED.deskripsi_cp;
