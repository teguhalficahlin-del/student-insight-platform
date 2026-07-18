-- SIP Sprint 1 — 013: Isi cp_umum dari sumber resmi SK BSKAP No. 046/H/KR/2025
-- Sumber:
--   • guru.kemendikdasmen.go.id (portal resmi CP per mapel)
--   • pembelajaran mendalam — mengutip Salinan Lampiran II BSKAP 046/H/KR/2025
--   • smkn1labuanbajo.sch.id (teks resmi PKW Fase F)
--   • kepalasekolah.id, blog.kejarcita.id (reproduksi teks resmi)
--
-- Cakupan migration ini:
--   ✅ BIN  Fase E dan F — cp_umum berhasil dikonfirmasi dari BSKAP 046/2025
--   ✅ PKW  Fase F       — cp_umum berhasil dikonfirmasi dari BSKAP 046/2025
--   ⏸ Mapel lain        — lihat komentar per blok
--
-- Idempotent: semua UPDATE aman dijalankan ulang.

-- ================================================================
-- 1. BAHASA INDONESIA (BIN) — Fase E
--    Sumber: pembelajaran mendalam mengutip Lampiran II BSKAP 046/H/KR/2025
--            kepalasekolah.id, blog.kejarcita.id (konsisten dari banyak sumber 2025)
-- ================================================================
UPDATE core.capaian_pembelajaran
SET
  cp_umum    = 'Pada akhir fase E, peserta didik memiliki kemampuan berbahasa untuk berkomunikasi dan bernalar sesuai dengan tujuan, konteks sosial, akademis, dan dunia kerja. Peserta didik mampu memahami, mengolah, menginterpretasi, dan mengevaluasi informasi dari berbagai tipe teks tentang topik yang beragam. Peserta didik mampu menyintesis gagasan dan pendapat dari berbagai sumber, berpartisipasi aktif dalam diskusi dan debat, serta menulis berbagai teks untuk menyampaikan pendapat dan mempresentasikan serta menanggapi informasi nonfiksi dan fiksi secara kritis dan etis.',
  bskap_ref  = 'SK BSKAP No. 046/H/KR/2025',
  updated_at = now()
WHERE subject_phase_id = (
  SELECT sp.subject_phase_id
  FROM core.subject_phases sp
  JOIN core.subjects s ON sp.subject_id = s.subject_id
  JOIN core.phases   p ON sp.phase_id   = p.phase_id
  WHERE s.code = 'BIN' AND p.code = 'E'
);

-- ================================================================
-- 2. BAHASA INDONESIA (BIN) — Fase F
--    Sumber: pembelajaran mendalam — dikutip dari
--            "Salinan Lampiran II Keputusan Kepala BSKAP No. 046/H/KR/2025"
-- ================================================================
UPDATE core.capaian_pembelajaran
SET
  cp_umum    = 'Pada akhir fase F, peserta didik memiliki kemampuan berbahasa untuk berkomunikasi dan bernalar sesuai dengan tujuan, konteks sosial, akademis, dan dunia kerja. Peserta didik mampu memahami, mengolah, menginterpretasi, dan mengevaluasi berbagai tipe teks tentang topik yang beragam. Peserta didik mampu mengkreasi gagasan dan pendapat untuk berbagai tujuan; peserta didik mampu berpartisipasi aktif dalam kegiatan berbahasa yang melibatkan banyak orang; dan peserta didik mampu menulis berbagai teks untuk merefleksi dan mengaktualisasi diri untuk selalu berkarya dengan mengutamakan penggunaan bahasa Indonesia di berbagai media untuk memajukan peradaban bangsa.',
  bskap_ref  = 'SK BSKAP No. 046/H/KR/2025',
  updated_at = now()
WHERE subject_phase_id = (
  SELECT sp.subject_phase_id
  FROM core.subject_phases sp
  JOIN core.subjects s ON sp.subject_id = s.subject_id
  JOIN core.phases   p ON sp.phase_id   = p.phase_id
  WHERE s.code = 'BIN' AND p.code = 'F'
);

-- ================================================================
-- 3. PROJEK KREATIF & KEWIRAUSAHAAN (PKW) — Fase F
--    Sumber: smkn1labuanbajo.sch.id/posts/detail/cp-mata-pelajaran-pkk-kumer
--            (reproduksi teks resmi CP PKW/PKK BSKAP 046/H/KR/2025)
-- ================================================================
UPDATE core.capaian_pembelajaran
SET
  cp_umum    = 'Pada akhir fase F, peserta didik mampu mengaktualisasikan kompetensi yang dipelajarinya untuk memperkuat kompetensinya dengan menghasilkan produk (barang dan/atau layanan jasa) yang sesuai, inovatif, memiliki nilai ekonomis dan sesuai dengan kebutuhan pelanggan serta membangun usaha (berwirausaha) yang berkelanjutan dengan memanfaatkan peluang yang tersedia, baik usaha yang terkait dengan keahliannya maupun usaha-usaha lainnya yang lebih sesuai dengan perkembangan pasar dengan dilandasi pemahaman tentang penyelesaian perselisihan hubungan industrial.',
  bskap_ref  = 'SK BSKAP No. 046/H/KR/2025',
  updated_at = now()
WHERE subject_phase_id = (
  SELECT sp.subject_phase_id
  FROM core.subject_phases sp
  JOIN core.subjects s ON sp.subject_id = s.subject_id
  JOIN core.phases   p ON sp.phase_id   = p.phase_id
  WHERE s.code = 'PKW' AND p.code = 'F'
);

-- ================================================================
-- CATATAN MAPEL YANG MASIH [PENDING]
-- ================================================================
--
-- Mapel berikut TIDAK mendapat UPDATE dalam migration ini.
-- Alasan dicantumkan agar dapat ditindaklanjuti di sesi berikutnya.
--
-- A. FORMAT CP PER ELEMEN (tidak ada paragraf cp_umum tersendiri di SK BSKAP 046)
--    Setiap elemen sudah mempunyai kalimat "Pada akhir Fase E/F, peserta didik..."
--    sendiri — tidak ada paragraf pengantar umum terpisah di dokumen resmi.
--
--    • MAT  Fase E dan F  — 4–5 elemen (Bilangan, Aljabar, Geometri, Analisis Data)
--    • PPKn Fase E dan F  — 4 elemen (Pancasila, UUD, Bhinneka, NKRI)
--    • PJOK Fase E dan F  — 4 elemen (Keterampilan Gerak, Pengetahuan Gerak, dll.)
--    • INF  Fase E        — 8 elemen (BK, TIK, SK, JKI, AD, AP, DSI, PLB)
--    • PAI  Fase E dan F  — 5 elemen (Al-Qur'an Hadis, Akidah, Akhlak, Fikih, SPI)
--    • PAK, PAKat, PABud, PAHin, PAKon Fase E dan F — idem per mapel agama
--    • SB_MUS, SB_RUP, SB_TEA, SB_TAR Fase E dan F — 5 elemen Seni
--
-- B. ADA PARAGRAF UMUM TAPI TEKS VERBATIM DARI BSKAP 046 TIDAK TERSEDIA ONLINE
--    (sumber yang ditemukan tidak secara eksplisit mengutip BSKAP 046/2025)
--
--    • SEJ  Fase E dan F  — Pemahaman Konsep + Keterampilan Proses ada, tapi
--                           teks cp_umum verbatim dari 046 belum dikonfirmasi
--    • IPAS Fase E        — Tiga elemen ada (migration 011), cp_umum belum dikonfirmasi
--
-- C. MUATAN LOKAL — ditetapkan satuan pendidikan, tidak ada CP nasional
--
--    • MULOK Fase E dan F
--
-- Rekomendasi tindak lanjut:
--   1. Akses langsung PDF BSKAP 046/H/KR/2025 dari link Google Drive di
--      guru.kemendikdasmen.go.id/dokumen/74r6Yln0zK untuk ekstrak teks verbatim
--   2. Untuk SEJ dan IPAS — bisa diisi dari PDF yang tersedia di
--      repositori.kemendikdasmen.go.id setelah login
--   3. Untuk mapel agama non-Islam — perlu akses dokumen CP per agama
-- ================================================================
