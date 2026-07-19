-- Migration: 20260718015000_sip_015_seed_cp_umum_sej_ipas.sql
-- Isi cp_umum SEJ Fase E, SEJ Fase F, dan IPAS Fase E
-- Source: SK BSKAP No. 046/H/KR/2025 (verbatim)

-- SEJ Fase E
UPDATE core.capaian_pembelajaran
SET
  cp_umum    = 'Pada akhir fase E, murid memiliki kemampuan sebagai berikut

1.1. Pemahaman Konsep
Memahami konsep dasar ilmu sejarah serta menginterpretasi berbagai peristiwa sejarah Indonesia yang berkaitan dengan masa Kerajaan Hindu-Buddha, Kerajaan Islam, Penjajahan Bangsa Barat, hingga Perjuangan Pergerakan Kebangsaan Indonesia. Murid mengaplikasikan keterampilan berpikir sejarah dalam mengkritisi peristiwa masa lalu yang relevan dengan bidang kejuruannya.

1.2. Keterampilan Proses
Memahami konsep dasar ilmu sejarah dan mampu berpikir sejarah melalui proses mengamati fenomena sejarah, menanya, mengumpulkan informasi, menganalisis informasi, mengomunikasikan dan mengaitkannya dengan muatan vokasional yang sesuai dengan kompetensi kejuruan yang diampunya. Secara spesifik keterampilan proses belajar sejarah mencakup keterampilan berpikir diakronis (kronologis), berpikir sinkronis, analisis dan interpretasi sejarah, penulisan sejarah secara sederhana, analisis isu kesejarahan serta, menemukan kebermaknaan peristiwa sejarah pada masa kerajaan Hindu-Buddha, kerajaan Islam, penjajahan bangsa Barat, perlawanan rakyat daerah terhadap penjajah, pergerakan kebangsaan Indonesia.',
  bskap_ref  = 'SK BSKAP No. 046/H/KR/2025',
  updated_at = now()
WHERE subject_phase_id = (
  SELECT sp.subject_phase_id
  FROM core.subject_phases sp
  JOIN core.subjects s ON sp.subject_id = s.subject_id
  JOIN core.phases p ON sp.phase_id = p.phase_id
  WHERE s.code = 'SEJ' AND p.code = 'E'
);

-- SEJ Fase F
UPDATE core.capaian_pembelajaran
SET
  cp_umum    = 'Pada akhir fase F, murid memiliki kemampuan sebagai berikut

2.1. Pemahaman Konsep
Memahami kehidupan bangsa Indonesia pada masa pendudukan Jepang, proklamasi kemerdekaan Indonesia, upaya mempertahankan kemerdekaan, masa pemerintahan Sukarno, masa pemerintahan Suharto, dan masa reformasi dengan menggunakan konsep-konsep dasar ilmu sejarah. Murid memiliki kesadaran sejarah sebagai wujud literasi dan empati terhadap perjalanan bangsa. Selain itu, murid juga memiliki kemampuan mengaitkan nilai-nilai sejarah yang relevan dengan kompetensi kejuruan dalam menghadapi tantangan dan peluang di dunia kerja serta dunia industri yang terus berkembang.

2.2. Keterampilan Proses
Mengaplikasikan literasi sejarah, membangun kesadaran sejarah, dan merumuskan penelitian sejarah secara sederhana melalui proses mengamati fenomena sejarah, menanya, mengumpulkan informasi, menganalisis informasi, mengomunikasikan, dan mengaitkannya dengan muatan vokasional sesuai dengan kompetensi kejuruannya. Secara spesifik keterampilan proses belajar sejarah mencakup keterampilan berpikir diakronis (kronologis), berpikir sinkronis, analisis dan interpretasi sejarah, penulisan sejarah secara sederhana, analisis isu kesejarahan serta menemukan kebermaknaan peristiwa sejarah pendudukan Jepang, proklamasi kemerdekaan Indonesia, mempertahankan kemerdekaan Indonesia, orde lama, orde baru, dan reformasi.',
  bskap_ref  = 'SK BSKAP No. 046/H/KR/2025',
  updated_at = now()
WHERE subject_phase_id = (
  SELECT sp.subject_phase_id
  FROM core.subject_phases sp
  JOIN core.subjects s ON sp.subject_id = s.subject_id
  JOIN core.phases p ON sp.phase_id = p.phase_id
  WHERE s.code = 'SEJ' AND p.code = 'F'
);

-- IPAS Fase E
UPDATE core.capaian_pembelajaran
SET
  cp_umum    = 'Pada akhir Fase E, murid memiliki kemampuan sebagai berikut.

1. Menjelaskan Fenomena secara Ilmiah
Menjelaskan pengetahuan ilmiah; membuat prediksi sederhana disertai dengan pembuktian fenomena-fenomena yang terjadi di lingkungan sekitarnya dilihat dari berbagai aspek seperti makhluk hidup dan lingkungannya, zat dan perubahannya, energi dan perubahannya, keruangan dan konektivitas antarruang dan antarwaktu, interaksi, komunikasi, sosialisasi, institusi sosial dan dinamika sosial, serta perilaku ekonomi dan kesejahteraan dan mengaitkan fenomena-fenomena tersebut dengan keterampilan teknis pada bidang keahliannya.

2. Menyusun Penyelidikan Ilmiah
Menyusun percobaan dengan menerapkan prosedur penyelidikan ilmiah dan memeriksa kekurangan atau kesalahan pada rancangan percobaan ilmiah tersebut.

3. Merefleksikan Data dan Bukti-bukti secara Ilmiah
Membuktikan dengan prinsip dasar melalui data dan bukti dari berbagai sumber seperti tabel hasil, grafik, atau sumber data lain untuk membangun sebuah argumen dan dapat mempertahankan argumen tersebut dengan penjelasan ilmiah, mengomunikasikan proses dan hasil, dan melakukan refleksi diri terhadap tahapan kegiatan yang dilakukan.',
  bskap_ref  = 'SK BSKAP No. 046/H/KR/2025',
  updated_at = now()
WHERE subject_phase_id = (
  SELECT sp.subject_phase_id
  FROM core.subject_phases sp
  JOIN core.subjects s ON sp.subject_id = s.subject_id
  JOIN core.phases p ON sp.phase_id = p.phase_id
  WHERE s.code = 'IPAS' AND p.code = 'E'
);
