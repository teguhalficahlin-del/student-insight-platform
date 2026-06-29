# Audit Level A — Kebutuhan & Nilai Operasional
Tanggal: 24 Juni 2025

## Inventaris Fitur

| Fitur | Lokasi kode | Aktor utama | Frekuensi pakai |
|---|---|---|---|
| Setup wizard 11 tahap | `admin/setup.html`, `admin/js/setup-wizard.js` | Admin | 1x seumur sistem |
| Import CSV — Program Keahlian | `admin/js/import.js`, `supabase/functions/bulk-import-programs` | Admin | Sekali di setup, jarang setelahnya |
| Import CSV — Kelas & Rombel | `admin/js/import.js`, `supabase/functions/bulk-import-classes` | Admin | 1-2x per tahun ajaran |
| Import CSV — Guru/Staf (Kepsek/Kaprodi/Wali/Guru/BK) | `admin/js/import.js`, `supabase/functions/bulk-import-users` | Admin | Saat setup + saat ada staf baru |
| Import CSV — Siswa | `admin/js/import.js`, `supabase/functions/bulk-import-students` | Admin | Tinggi di awal tahun ajaran |
| Import CSV — Orang Tua | `admin/js/import.js`, `supabase/functions/bulk-import-parents` | Admin | Tinggi di awal tahun ajaran |
| Import CSV — DUDI | `admin/js/import.js`, `supabase/functions/bulk-import-dudi` | Admin | Saat ada mitra PKL baru |
| Import Jadwal (generate teaching_schedules) | `admin/js/import.js`, `supabase/functions/bulk-import-schedules` | Admin | 1-2x per semester |
| Dashboard admin read-only panels (Program, Kelas, Mapel, Guru&Staf, Siswa, Ortu, Jadwal Aktif, Guru Pengganti) | `admin/dashboard.html`, `admin/js/dashboard.js` | Admin | Mingguan / saat verifikasi |
| Tutup Semester | `admin/js/semester.js`, dipasang lewat `admin/js/dashboard.js` | Admin | 2x/tahun |
| Wizard Tutup Tahun Ajaran (review XII, kelulusan massal, kenaikan kelas, buka tahun ajaran, ringkasan) | `admin/tutup-tahun.html`, `admin/js/tutup-tahun.js`, `supabase/functions/open-academic-year` | Admin | 1x/tahun |
| Export Data | `admin/dashboard.html` (placeholder, belum diimplementasi) | — | — |
| Log Aktivitas | `admin/dashboard.html` (placeholder, belum diimplementasi) | — | — |
| Absensi siswa (exception-based, default HADIR) | `requirements-final.md` Bagian 6 | Guru | Harian, per sesi mengajar |
| Observasi 8 Dimensi Profil Lulusan | `requirements-final.md` Bagian 5 | Guru, Wali Kelas, BK, Kaprodi, Kepsek | Tidak rutin, sesuai kejadian |
| Eskalasi Kasus — jalur Sekolah (GURU→BK→WALI→KAPRODI→KEPSEK) | `requirements-final.md` Bagian 8-9 | GURU, BK, WALI_KELAS, KAPRODI, KEPSEK | Sesuai insiden |
| Eskalasi Kasus — jalur PKL (DUDI→KAPRODI→KEPSEK) | `requirements-final.md` Bagian 8-9 | DUDI, KAPRODI, KEPSEK | Sesuai insiden |
| Achievement / Prestasi siswa | `requirements-final.md`, tabel `achievements` | Wali Kelas, Kaprodi, Kepsek | Jarang, event-based |
| Komunikasi Orang Tua (selective addressing) | `requirements-final.md` Bagian 15 | ORTU, staff terkait | Sesuai kebutuhan |
| Jurnal Guru | `requirements-final.md` Bagian 7, tabel `teacher_journals` | Guru (individu) | Bervariasi per guru |
| Guru Pengganti + sync token offline | `requirements-final.md` Bagian 3a & 6, tabel `substitute_schedules` | Kaprodi/Kepsek (assign), Guru pengganti (pakai) | Tidak rutin, tapi pasti terjadi |
| Indikator Kehadiran Guru sesuai jadwal | `requirements-final.md` Bagian 18, tabel `teacher_attendance_log` | Kepsek, Kaprodi (consumer) | Otomatis, harian |
| Sistem Alert (ABSENCE_HIGH, CONCERN_REPEATED, TEACHER_NO_RECORD) | `requirements-final.md` Bagian 20 | BK, Wali Kelas, Kaprodi (consumer) | Otomatis, kontinu |
| Offline Contract (Kategori A/B + sync) | `requirements-final.md` Bagian 19 | Guru (terutama saat input absensi/observasi) | Setiap kali jaringan kelas drop |

## Audit Kebutuhan per Fitur

### Setup wizard 11 tahap
- Masalah yang diselesaikan: admin non-teknis butuh cara terstruktur memasukkan seluruh data dasar sekolah, tahap demi tahap, tanpa harus paham cara kerja sistem di baliknya.
- Aktor: Admin.
- Dampak jika dihapus: data dasar harus dimasukkan langsung oleh staf teknis lewat akses sistem yang tidak ditujukan untuk pengguna sehari-hari — tidak realistis untuk admin non-teknis.
- Alternatif manual: ada, tapi butuh keahlian teknis yang umumnya tidak dimiliki staf admin sekolah.
- Klasifikasi: PENTING

### Import CSV — Program Keahlian
- Masalah yang diselesaikan: menghindari input satu-satu untuk daftar program keahlian yang relatif singkat (biasanya 4-8 program).
- Aktor: Admin.
- Dampak jika dihapus: admin harus input manual lewat form satu-satu — masih layak dilakukan karena jumlahnya kecil.
- Alternatif manual: ada, dan cukup praktis karena jumlah baris kecil.
- Klasifikasi: PENTING

### Import CSV — Kelas & Rombel
- Masalah yang diselesaikan: input puluhan rombel sekaligus per tahun ajaran tanpa entri satu-satu.
- Aktor: Admin.
- Dampak jika dihapus: input manual satu-satu untuk puluhan kelas tiap tahun ajaran — repetitif tapi masih mungkin dilakukan.
- Alternatif manual: ada (form tambah kelas manual sudah tersedia di setup wizard tahap 3).
- Klasifikasi: PENTING

### Import CSV — Guru/Staf (Kepsek/Kaprodi/Wali/Guru/BK)
- Masalah yang diselesaikan: provisioning akun staf massal (puluhan-ratusan guru) tanpa membuat akun satu-satu secara manual.
- Aktor: Admin.
- Dampak jika dihapus: pembuatan akun guru harus manual satu-satu lewat Auth — pada sekolah dengan puluhan guru, ini sangat memberatkan dan rawan salah ketik NIP/NIK.
- Alternatif manual: tidak layak pada skala puluhan-ratusan staf.
- Klasifikasi: WAJIB

### Import CSV — Siswa
- Masalah yang diselesaikan: provisioning ratusan siswa per tahun ajaran sekaligus, termasuk penempatan ke kelas.
- Aktor: Admin.
- Dampak jika dihapus: input manual ratusan siswa per tahun ajaran tidak realistis untuk SMK ukuran normal.
- Alternatif manual: tidak layak pada skala ratusan siswa.
- Klasifikasi: WAJIB

### Import CSV — Orang Tua
- Masalah yang diselesaikan: provisioning akun ortu massal dan menautkannya ke data siswa.
- Aktor: Admin.
- Dampak jika dihapus: tanpa ini, fitur Komunikasi Orang Tua tidak bisa berjalan karena akun ortu tidak pernah dibuat secara massal.
- Alternatif manual: tidak layak pada skala ratusan siswa.
- Klasifikasi: WAJIB

### Import CSV — DUDI
- Masalah yang diselesaikan: provisioning akun mitra industri (DUDI) untuk pembimbingan PKL.
- Aktor: Admin.
- Dampak jika dihapus: pembuatan akun DUDI manual satu-satu — jumlah mitra DUDI biasanya jauh lebih kecil dari siswa/guru, jadi masih layak manual.
- Alternatif manual: ada, dan cukup praktis karena jumlah mitra DUDI relatif kecil.
- Klasifikasi: PENTING

### Import Jadwal (generate teaching_schedules)
- Masalah yang diselesaikan: membuat jadwal mengajar harian dari template mingguan untuk seluruh semester sekaligus, alih-alih membuat entri jadwal per tanggal satu per satu.
- Aktor: Admin.
- Dampak jika dihapus: jadwal harus dibuat per tanggal secara manual untuk setiap kelas-mapel-guru selama satu semester — jumlah entri yang harus dibuat sangat besar (jumlah hari sekolah dikali jumlah slot mengajar).
- Alternatif manual: tidak layak — volumenya terlalu besar untuk dibuat manual per sesi.
- Klasifikasi: WAJIB

### Dashboard admin read-only panels
- Masalah yang diselesaikan: verifikasi cepat hasil import data tanpa harus membuka data mentah langsung.
- Aktor: Admin.
- Dampak jika dihapus: admin harus mengandalkan staf teknis untuk memeriksa data mentah setiap kali ingin memverifikasi hasil import — menambah friksi dan ketergantungan pada pihak teknis.
- Alternatif manual: ada, tapi harus lewat staf teknis, tidak praktis untuk admin sekolah sehari-hari.
- Klasifikasi: PENTING

### Tutup Semester
- Masalah yang diselesaikan: mengunci data absensi, observasi, dan jurnal guru pada semester yang sudah lewat agar tidak bisa diubah lagi, lalu memajukan semester aktif sekolah.
- Aktor: Admin.
- Dampak jika dihapus: data semester lalu tetap bisa diubah kapan saja — integritas data historis (misal untuk rapor, audit kasus) tidak terjamin.
- Alternatif manual: tidak ada — penguncian periode ini butuh mekanisme otomatis di dalam sistem, tidak bisa ditiru secara manual.
- Klasifikasi: WAJIB

### Wizard Tutup Tahun Ajaran (review XII, kelulusan massal, kenaikan kelas, buka tahun ajaran, ringkasan)
- Masalah yang diselesaikan: memproses kelulusan dan kenaikan kelas ratusan siswa sekaligus dengan pemetaan kelas lama ke kelas baru, dijamin selesai utuh atau tidak sama sekali (tidak ada siswa yang "tertinggal di tengah proses").
- Aktor: Admin.
- Dampak jika dihapus: kelulusan dan kenaikan kelas harus diproses manual satu per satu untuk setiap siswa — pada skala ratusan siswa, risiko salah pemetaan kelas/status sangat tinggi tanpa validasi otomatis yang ada di wizard ini.
- Alternatif manual: tidak layak pada skala ratusan siswa, dan tidak ada jaminan semua siswa terproses konsisten (sebagian bisa naik, sebagian gagal, tanpa disadari).
- Klasifikasi: WAJIB

### Export Data
- Masalah yang diselesaikan: tidak ada — belum diimplementasi, tombol/menu hanya placeholder.
- Aktor: — (belum ada).
- Dampak jika dihapus: tidak ada dampak karena belum ada fungsi yang berjalan.
- Alternatif manual: tidak relevan.
- Klasifikasi: SEMBUNYIKAN

### Log Aktivitas
- Masalah yang diselesaikan: tidak ada — belum diimplementasi, tombol/menu hanya placeholder.
- Aktor: — (belum ada).
- Dampak jika dihapus: tidak ada dampak karena belum ada fungsi yang berjalan.
- Alternatif manual: tidak relevan.
- Klasifikasi: SEMBUNYIKAN

### Absensi siswa (exception-based, default HADIR)
- Masalah yang diselesaikan: mengurangi beban administratif guru — guru hanya mencatat siswa yang tidak hadir, bukan menandai seluruh kelas satu per satu setiap sesi.
- Aktor: Guru (seluruh guru mapel, setiap sesi mengajar).
- Dampak jika dihapus: sekolah kembali ke buku absen kertas — kehilangan agregasi otomatis untuk deteksi pola (misal alert ABSENCE_HIGH) dan akses real-time oleh wali kelas/ortu.
- Alternatif manual: ada (buku absen kertas), sudah jadi kebiasaan lama di SMK.
- Klasifikasi: WAJIB

### Observasi 8 Dimensi Profil Lulusan
- Masalah yang diselesaikan: mendokumentasikan kejadian menonjol terkait pembinaan karakter siswa tanpa beban pencatatan rutin per siswa per dimensi.
- Aktor: Guru, Wali Kelas, BK, Kaprodi, Kepsek.
- Dampak jika dihapus: pembinaan karakter tetap bisa dilakukan, tetapi tidak terdokumentasi terstruktur — riwayat insiden/capaian positif individual sulit dilacak lintas guru dan lintas waktu.
- Alternatif manual: ada (catatan BK/wali kelas konvensional).
- Klasifikasi: PENTING

### Eskalasi Kasus — jalur Sekolah (Guru→BK→Wali Kelas→Kaprodi→Kepsek)
- Masalah yang diselesaikan: menstrukturkan penanganan masalah disiplin/perilaku siswa antar level otoritas dengan jejak riwayat yang jelas dan tidak bisa diubah atau dihapus setelah dicatat.
- Aktor: Guru, BK, Wali Kelas, Kaprodi, Kepsek.
- Dampak jika dihapus: penanganan kasus disiplin kembali ke memo/catatan manual antar pihak — riwayat siapa-menangani-apa-kapan mudah hilang, sulit dipertanggungjawabkan saat kasus serius (misal menuju keputusan akhir Kepsek).
- Alternatif manual: ada secara teknis (memo/rapat manual), tapi akuntabilitas dan jejak riwayatnya jauh lebih lemah.
- Klasifikasi: WAJIB

### Eskalasi Kasus — jalur PKL (DUDI→KAPRODI→KEPSEK)
- Masalah yang diselesaikan: menstrukturkan penanganan masalah siswa selama PKL antara mitra industri dan sekolah.
- Aktor: DUDI, KAPRODI, KEPSEK.
- Dampak jika dihapus: koordinasi masalah siswa PKL kembali ke telepon/WA antara DUDI dan kaprodi — tidak ada jejak terstruktur, riwayat mudah hilang terutama karena DUDI adalah pihak eksternal.
- Alternatif manual: ada (komunikasi langsung dengan DUDI), tapi lebih rawan miskomunikasi karena DUDI bukan staf sekolah.
- Klasifikasi: WAJIB

### Achievement / Prestasi siswa
- Masalah yang diselesaikan: dokumentasi prestasi siswa yang bisa diakses siswa dan seluruh staf, dengan kemampuan void (bukan hapus) jika ada kesalahan input.
- Aktor: Wali Kelas, Kaprodi, Kepsek.
- Dampak jika dihapus: prestasi tetap bisa diumumkan lewat papan pengumuman/SK fisik, hanya kehilangan riwayat terpusat yang bisa dilihat siswa kapan saja.
- Alternatif manual: ada (papan pengumuman, SK fisik), dan ini sudah jadi kebiasaan umum di sekolah.
- Klasifikasi: TAMBAHAN

### Komunikasi Orang Tua (selective addressing)
- Masalah yang diselesaikan: kanal komunikasi terstruktur antara ortu dan staf tertentu, dengan kemampuan menautkan pesan ke kasus aktif dan jejak audit balasan.
- Aktor: ORTU, staf terkait (guru mapel/wali/BK/kaprodi/pembimbing PKL).
- Dampak jika dihapus: komunikasi kembali ke WA/telepon pribadi — kehilangan jejak audit dan keterkaitan otomatis dengan kasus aktif, yang penting saat kasus butuh ditinjau ulang.
- Alternatif manual: ada (WA/telepon), sudah jadi kebiasaan dominan di SMK, tapi tanpa audit trail dan tanpa keterkaitan kasus.
- Klasifikasi: PENTING

### Jurnal Guru
- Masalah yang diselesaikan: catatan progres mengajar pribadi guru, eksplisit tidak ikut eskalasi/ekspor/dashboard mana pun.
- Aktor: Guru (individu, hanya pemilik yang bisa lihat).
- Dampak jika dihapus: guru kembali mencatat progres mengajar di buku/dokumen pribadi — tidak ada pihak lain yang terdampak karena fitur ini memang tidak punya consumer lain di sistem.
- Alternatif manual: ada, dan setara nilainya dengan versi sistem karena sifatnya privat murni.
- Klasifikasi: TAMBAHAN

### Guru Pengganti + sync token offline
- Masalah yang diselesaikan: memastikan kelas tetap ada yang mencatat absensi saat guru pengampu tidak hadir, tanpa memberi pengganti akses ke data siswa/kasus/observasi yang bukan haknya.
- Aktor: Kaprodi/Kepsek (menugaskan pengganti), Guru pengganti (mengisi absensi).
- Dampak jika dihapus: saat guru sakit/tidak hadir, kelas tidak tercatat sama sekali atau dicatat manual lewat staf TU — menimbulkan lubang data absensi yang berdampak ke akurasi alert ABSENCE_HIGH.
- Alternatif manual: ada (kelas kosong dicatat manual oleh staf TU), tapi rawan terlewat dan menimbulkan inkonsistensi data.
- Klasifikasi: PENTING

### Indikator Kehadiran Guru sesuai jadwal
- Masalah yang diselesaikan: mendeteksi otomatis apakah guru benar-benar masuk kelas sesuai jadwal mengajarnya (berdasarkan ada/tidaknya input absensi siswa), bukan sekadar kehadiran fisik di sekolah.
- Aktor: Kepsek, Kaprodi (consumer laporan).
- Dampak jika dihapus: tidak ada cara otomatis mengetahui guru yang terjadwal mengajar tapi tidak benar-benar masuk kelas — supervisi kelas hanya mengandalkan laporan manual atau sidak langsung.
- Alternatif manual: ada (sidak kelas manual oleh kaprodi/kepsek), tapi tidak bisa dilakukan untuk semua kelas setiap saat — cakupan jauh lebih kecil dari deteksi otomatis sistem.
- Klasifikasi: WAJIB
  [catatan: ini berbeda dari sistem presensi fingerprint kehadiran fisik di sekolah — fingerprint menjawab "apakah guru datang ke sekolah", indikator ini menjawab "apakah guru benar-benar masuk kelas sesuai jadwal mengajarnya". Dua fungsi berbeda, bukan duplikasi.]

### Sistem Alert (ABSENCE_HIGH, CONCERN_REPEATED, TEACHER_NO_RECORD)
- Masalah yang diselesaikan: deteksi dini pola bermasalah (siswa sering absen, concern berulang di dimensi yang sama, guru tidak pernah mencatat observasi) tanpa staf harus menyisir seluruh data secara manual.
- Aktor: BK, Wali Kelas, Kaprodi (consumer).
- Dampak jika dihapus: pola-pola ini hanya akan terdeteksi jika ada staf yang secara manual dan rutin menyisir seluruh data siswa/guru — pada skala sekolah dengan ratusan siswa, deteksi dini praktis tidak terjadi tanpa sistem.
- Alternatif manual: ada secara teori (review manual berkala), tapi tidak realistis dilakukan konsisten pada skala ratusan siswa dan puluhan guru.
- Klasifikasi: PENTING

### Offline Contract (Kategori A/B + sync)
- Masalah yang diselesaikan: memastikan guru tetap bisa input absensi/observasi/kasus/jurnal saat koneksi internet di kelas tidak stabil, dengan sinkronisasi otomatis saat online kembali.
- Aktor: Guru (terutama saat input absensi/observasi di kelas).
- Dampak jika dihapus: di sekolah dengan koneksi internet tidak stabil, guru tidak bisa input data sama sekali saat jaringan turun — data hari itu hilang atau harus dicatat manual lalu diinput ulang setelah online, menambah pekerjaan ganda.
- Alternatif manual: ada (catat manual di kertas, input ulang setelah online), tapi menambah pekerjaan ganda dan rawan data tidak terinput.
- Klasifikasi: PENTING

## Audit Nilai Operasional

### Proses yang tergantung sistem
- Riwayat penanganan kasus siswa (siapa menangani, kapan, keputusan apa) — riwayat ini tercatat rapi dan tidak bisa diubah/dihapus setelah dicatat; tanpa sistem, sekolah kembali ke catatan manual yang mudah hilang/tidak konsisten.
- Rekonsiliasi kenaikan kelas/kelulusan massal yang sudah dipetakan di wizard tutup tahun ajaran (kalau di tengah proses tahun ajaran).
- Indikator kehadiran guru otomatis dan sistem alert — keduanya dihitung otomatis oleh sistem, tidak ada bentuk manualnya.
- Penguncian periode akademik (Tutup Semester) — integritas data historis bergantung pada mekanisme penguncian otomatis di sistem, tidak ada cara manual yang setara.

### Proses yang masih bisa manual
- Absensi siswa — bisa kembali ke buku absen kertas (cara lama SMK pada umumnya).
- Observasi 8 dimensi — bisa kembali ke catatan BK/wali kelas manual.
- Komunikasi orang tua — bisa kembali ke WA/telepon (memang sudah jadi kebiasaan).
- Achievement siswa — papan pengumuman/SK manual.
- Jurnal guru — buku catatan pribadi guru.
- Guru pengganti — kelas kosong dicatat manual oleh staf TU.

### Data yang tidak bisa direkonstruksi
- Seluruh riwayat kejadian dalam penanganan kasus siswa (eskalasi, komentar, keputusan) — tidak ada salinan di tempat lain.
- Catatan observasi guru/BK yang sifatnya internal (tidak ditujukan untuk dilihat siswa atau orang tua) — kejadian yang dicatat hanya di sistem, tidak ada catatan fisik paralel.
- Riwayat indikator kehadiran guru di kelas — dihitung otomatis, tidak dicatat manual di tempat lain.
- Riwayat pesan dengan orang tua yang terhubung ke kasus tertentu.

Catatan: data tidak hilang jika aplikasi/tampilannya dimatikan — selama sistem inti yang menyimpan data tetap aktif, data tetap ada. Yang hilang adalah kemampuan staf mengakses dan menginput data baru.

## Keputusan Domain yang Dikunci

| Keputusan | Alasan | Status |
|---|---|---|
| Export Data & Log Aktivitas disembunyikan dari UI | Placeholder kosong tanpa fungsi nyata berisiko membingungkan user — tampak ada fitur yang sebenarnya tidak bekerja | Dikunci |
| Indikator Kehadiran Guru diklasifikasi WAJIB, bukan duplikat fingerprint | Fingerprint mendeteksi kehadiran fisik di sekolah; indikator ini mendeteksi apakah guru benar-benar masuk kelas sesuai jadwal mengajar — dua fungsi berbeda | Dikunci |
| UI operasional inti (absensi, observasi, kasus, jurnal, komunikasi ortu) berada di dashboard aktor masing-masing, bukan di admin panel | Di luar scope audit admin panel ini — admin panel hanya mengelola data master dan provisioning, bukan operasional harian | Dikunci |

## Tindak Lanjut

- Sembunyikan menu Export Data dan Log Aktivitas dari `admin/dashboard.html` sampai keduanya benar-benar diimplementasi.
- Verifikasi keberadaan dan lokasi dashboard aktor (Guru, BK, Wali Kelas, Kaprodi, Kepsek, Siswa, Ortu, DUDI) yang menjadi rumah bagi UI operasional inti (absensi, observasi, kasus, jurnal, komunikasi ortu) — audit UI tersebut belum dilakukan karena belum ditemukan dalam kode `admin/`.
- Audit Level A untuk dashboard aktor di atas perlu dijadwalkan setelah dashboard tersebut dibangun atau lokasinya dikonfirmasi.
- Pastikan mekanisme Sistem Alert (ABSENCE_HIGH, CONCERN_REPEATED, TEACHER_NO_RECORD) benar-benar dibangun — belum ditemukan implementasi otomatisnya selama audit ini, fitur tersebut baru tersebut di requirements.
