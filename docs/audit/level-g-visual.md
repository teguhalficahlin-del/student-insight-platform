# Audit Level G — Warna & Visual
Tanggal: 24 Juni 2025

Catatan metodologi: seluruh nilai warna diambil langsung dari berkas tampilan utama aplikasi (satu-satunya berkas pengatur warna yang dipakai di seluruh console admin). Seluruh rasio kontras dihitung manual menggunakan rumus baku WCAG 2.1 (luminansi relatif dan rasio kontras), bukan perkiraan visual.

## Audit Makna Warna

### Inventaris Warna

| Warna (kode) | Dipakai untuk | Konsisten? |
|---|---|---|
| Biru tua (#1d4ed8) | Warna utama aplikasi — tombol aksi utama, tautan, tahap aktif di wizard, menu yang sedang dipilih | Ya — selalu berarti "ini elemen utama/aktif/bisa diklik", tidak pernah dipakai untuk makna lain |
| Biru sangat muda (#eff4ff) | Latar belakang untuk elemen yang sedang aktif/dipilih (menu sidebar yang aktif, kotak fokus saat mengisi form) | Ya |
| Hijau (#16a34a) | Selalu berarti "berhasil/aktif/selesai" — tombol centang hijau di wizard, badge "Aktif", pesan sukses | Ya — tidak ditemukan satu pun pemakaian hijau untuk makna lain |
| Hijau sangat muda (#ecfdf3) | Latar belakang untuk pesan dan badge bermakna sukses/aktif | Ya |
| Merah (#dc2626) | Selalu berarti "bahaya/gagal/nonaktif secara peringatan" — pesan error, tombol aksi berbahaya (tutup semester), badge nonaktif | Ya, dengan catatan: merah dipakai untuk DUA tingkat keseriusan berbeda — pesan kesalahan biasa (misalnya salah isi tanggal) dan tombol aksi besar yang tidak bisa dibatalkan (tutup semester) — keduanya sama-sama merah, walau tingkat dampaknya sangat berbeda |
| Merah sangat muda (#fef2f2) | Latar belakang untuk pesan dan badge bermakna error/nonaktif | Ya |
| Oranye (#d97706) | Peringatan tingkat sedang (bukan error, bukan sukses) — dipakai untuk pemberitahuan penting tapi tidak berbahaya | Ya, tapi jarang dipakai — hanya muncul di satu situasi (peringatan saat semester akan ditutup dan saat semester sudah ditutup menunggu langkah lanjutan) |
| Oranye sangat muda (#fffbeb) | Latar belakang untuk pesan bermakna peringatan | Ya |
| Abu-abu gelap (#1f2937) | Warna teks utama untuk semua isi halaman | Ya |
| Abu-abu sedang (#6b7280) | Warna teks untuk keterangan/petunjuk yang sifatnya kurang penting (hint, label kolom tabel, status "Nonaktif") | Ya — selalu berarti "informasi sekunder, bukan fokus utama" |
| Putih (#ffffff) | Latar belakang kartu/panel utama, teks di atas tombol berwarna | Ya |
| Abu-abu sangat muda (#f4f6f8) | Latar belakang halaman secara umum | Ya |

### Inkonsistensi Warna
CLEAR untuk makna inti warna — tidak ditemukan warna yang dipakai untuk dua makna yang bertentangan (misalnya merah dipakai untuk sesuatu yang sebenarnya positif). Setiap warna konsisten maknanya di seluruh aplikasi: hijau selalu baik, merah selalu peringatan/bahaya, biru selalu netral-aktif.

Satu catatan yang bukan inkonsistensi warna itu sendiri, tapi inkonsistensi **penerapan** warna pada status yang sejenis: status "Aktif/Nonaktif" pada data Program Keahlian dan data Guru/Staf ditampilkan dengan badge berwarna (hijau untuk aktif, abu-abu untuk nonaktif), tetapi status siswa (Aktif/Lulus/Keluar/PKL) pada panel Siswa ditampilkan sebagai teks polos tanpa warna sama sekali — padahal secara konsep keduanya sama-sama "status". Detail lebih lanjut ada di bagian Audit Konsistensi Status.

## Audit Kontras

| Elemen | Warna teks | Warna latar | Rasio kontras | Standar WCAG AA | Status |
|---|---|---|---|---|---|
| Teks isi halaman pada umumnya | Abu-abu gelap #1f2937 | Abu-abu sangat muda #f4f6f8 | 13,6 : 1 | 4,5 : 1 (teks normal) | **Lolos jauh di atas standar** |
| Teks isi halaman di atas kartu putih | Abu-abu gelap #1f2937 | Putih #ffffff | 14,8 : 1 | 4,5 : 1 | **Lolos jauh di atas standar** |
| Teks tombol aksi utama | Putih | Biru #1d4ed8 | 6,7 : 1 | 4,5 : 1 | **Lolos dengan baik** |
| Teks tombol aksi berbahaya (contoh: "Tutup Semester Sekarang") | Putih | Merah #dc2626 | 4,8 : 1 | 4,5 : 1 | **Lolos, tapi tipis** — hanya 0,3 di atas batas minimum |
| Teks petunjuk/hint dan keterangan kolom tabel (di atas kartu putih) | Abu-abu sedang #6b7280 | Putih #ffffff | 4,84 : 1 | 4,5 : 1 | **Lolos, tapi sangat tipis** — hanya 0,34 di atas batas minimum |
| Label tahap pada indikator wizard (di atas latar halaman, bukan kartu) | Abu-abu sedang #6b7280 | Abu-abu sangat muda #f4f6f8 | 4,47 : 1 | 4,5 : 1 | **TIDAK LOLOS** — sedikit di bawah batas minimum |
| Teks pesan/badge bermakna sukses | Hijau #16a34a | Hijau muda #ecfdf3 | 3,12 : 1 | 4,5 : 1 | **TIDAK LOLOS** — jauh di bawah batas minimum |
| Teks pesan/badge bermakna peringatan | Oranye #d97706 | Oranye muda #fffbeb | 3,07 : 1 | 4,5 : 1 | **TIDAK LOLOS** — jauh di bawah batas minimum |
| Teks pesan/badge bermakna error | Merah #dc2626 | Merah muda #fef2f2 | 4,41 : 1 | 4,5 : 1 | **TIDAK LOLOS** — sedikit di bawah batas minimum |
| Status "Nonaktif" (badge abu-abu) | Abu-abu sedang #6b7280 | Abu-abu sangat muda #f4f6f8 | 4,47 : 1 | 4,5 : 1 | **TIDAK LOLOS** — sedikit di bawah batas minimum (warna sama dengan baris di atas) |
| Tautan/menu yang sedang aktif | Biru #1d4ed8 | Biru muda #eff4ff | 6,08 : 1 | 4,5 : 1 | **Lolos dengan baik** |

**Catatan dampak nyata:** kombinasi yang gagal di atas — terutama pesan sukses (hijau) dan peringatan (oranye) — adalah elemen yang dipakai berulang kali di seluruh aplikasi (setiap kali impor data berhasil, setiap kali ada peringatan semester). Untuk admin sekolah yang membaca dari layar laptop di ruangan dengan cahaya terang, atau yang sudah berusia lebih tua dengan penglihatan kurang tajam, teks-teks ini berisiko sulit dibaca dengan nyaman — bukan tidak terbaca sama sekali, tapi butuh usaha lebih untuk membaca dibanding teks lain di aplikasi yang sama yang justru kontrasnya jauh lebih baik.

## Audit Aksesibilitas Warna

- **Status aktif/nonaktif dan hasil impor (berhasil/gagal):** CLEAR — setiap kali warna dipakai untuk menyampaikan status, selalu disertai teks yang menyebutkan status itu secara eksplisit ("Aktif", "Nonaktif", "Sudah diimpor", "Belum/dilewati", jumlah baris "Berhasil"/"Gagal"). Pengguna dengan gangguan penglihatan warna (buta warna) tetap akan bisa memahami informasi ini lewat tulisannya, tidak hanya mengandalkan warna.
- **Pengecualian yang ditemukan:** status siswa (Aktif/Lulus/Keluar/PKL) di panel Siswa ditampilkan sebagai teks polos tanpa warna apa pun — ini sebenarnya aman dari sisi aksesibilitas warna (karena memang tidak memakai warna sama sekali), tapi tidak konsisten dengan status lain yang memakai warna+teks.
- **Indikator tahap pada wizard** (lingkaran kecil yang menandai tahap aktif/selesai) membedakan tahap "aktif" dan "selesai" terutama lewat warna (biru vs hijau) dan posisi, tanpa simbol pembeda seperti tanda centang untuk tahap yang sudah selesai. Pengguna dengan gangguan penglihatan warna jenis tertentu (terutama yang sulit membedakan merah-hijau atau biru-hijau) mungkin kesulitan membedakan sekilas apakah suatu tahap sudah selesai atau sedang berjalan, hanya dari bentuk lingkaran kecil tanpa simbol pembeda tambahan.
- Tidak ditemukan tabel data yang membedakan baris hanya dengan warna tanpa label teks — semua tabel di aplikasi ini berupa daftar polos tanpa pewarnaan baris bergantian atau highlight warna apa pun yang membawa makna.

## Audit Prioritas Visual

| Halaman | Elemen paling menonjol | Apakah itu yang paling penting? | Gap |
|---|---|---|---|
| Halaman login | Kotak putih berbayang di tengah dengan kotak biru "logo" dan judul | Ya — sesuai untuk halaman yang memang harus segera dikenali sebagai pintu masuk admin | Tidak ada |
| Dashboard utama | Daftar menu di sisi kiri (selalu terlihat, posisi tetap) | Sebagian — menu memang penting karena jadi navigasi utama, tapi tidak ada elemen visual yang menonjolkan "apa yang perlu diperhatikan sekarang" (misalnya peringatan jika ada tugas tertunda) | Tugas yang mendesak (jika ada) tenggelam karena tidak ada elemen visual untuk itu sama sekali |
| Setup Wizard | Indikator tahap (lingkaran-lingkaran kecil berwarna biru/hijau) dan judul besar tahap aktif | Ya | Tidak ada |
| Halaman Tutup Semester | Tiga kotak angka ringkasan berukuran cukup besar (22px, tebal), diikuti tombol merah | Sebagian — kalimat peringatan konsekuensi (data akan terkunci permanen) ditulis dengan ukuran teks alert biasa (13px), **lebih kecil** dari angka-angka ringkasan di atasnya, padahal peringatan itu jauh lebih penting untuk dibaca sebelum menekan tombol berbahaya | **Peringatan paling penting di halaman ini justru kalah menonjol dibanding angka statistik yang sebenarnya hanya informasi pendukung** |
| Wizard Tutup Tahun Ajaran | Sama seperti Setup Wizard — indikator langkah dan judul langkah aktif | Ya untuk struktur umum, tapi peringatan "tidak dapat dibatalkan" di Langkah 4 (paling berisiko di seluruh wizard) ditulis dalam ukuran teks hint biasa (12px, abu-abu), bukan ukuran atau warna yang menonjolkan tingkat risikonya | **Peringatan paling kritis di seluruh aplikasi (membuka tahun ajaran baru, tidak bisa dibatalkan) divisualkan dengan bobot yang sama dengan keterangan biasa** |

## Audit Konsistensi Status

| Status | Warna | Ikon/Simbol | Konsisten di seluruh aplikasi? |
|---|---|---|---|
| Aktif (Program Keahlian, Guru & Staf) | Hijau (badge) | Tidak ada ikon, hanya teks "Aktif" dalam badge berwarna | Konsisten antar kedua tempat ini |
| Nonaktif (Program Keahlian, Guru & Staf) | Abu-abu (badge) | Tidak ada ikon, teks "Nonaktif" | Konsisten antar kedua tempat ini |
| Status siswa: Aktif/Lulus/Keluar/PKL | **Tidak ada warna sama sekali** | Tidak ada — ditampilkan sebagai teks mentah tanpa badge | **TIDAK konsisten** dengan status Aktif/Nonaktif di dua tempat lain — status yang secara konsep sama (menandai keadaan suatu data) diperlakukan berbeda di panel Siswa |
| Hasil impor: Berhasil | Hitam/teks biasa (angka statistik), bukan hijau | Tidak ada warna pembeda khusus untuk angka "Berhasil" dibanding angka "Total Baris" | Angka ringkasan hasil impor (Total Baris, Berhasil, Gagal, Konflik) ditampilkan dengan ukuran dan gaya yang sama tanpa pembeda warna — padahal idealnya angka "Gagal" bisa ditonjolkan dengan warna peringatan agar segera terlihat |
| Hasil impor: pesan sukses keseluruhan | Hijau (alert) | Tidak ada ikon, hanya teks | Konsisten dengan makna hijau=sukses di tempat lain |
| Setup wizard: "Sudah diimpor" / "Belum/dilewati" | Hijau / abu-abu (badge) | Tidak ada ikon | Konsisten dengan pola Aktif/Nonaktif |
| Tahap wizard: aktif / selesai | Biru / Hijau (lingkaran kecil) | Tidak ada simbol tambahan (lihat catatan di Audit Aksesibilitas Warna) | Konsisten secara warna dengan makna di tempat lain (biru=aktif/sedang berjalan, hijau=selesai/baik), tapi kurang dari sisi penanda non-warna |
| Pesan error (validasi, gagal memuat data, dll) | Merah (alert) | Tidak ada ikon | Konsisten di seluruh aplikasi |
| Pesan peringatan (semester akan/sudah ditutup) | Oranye (alert) | Tidak ada ikon | Konsisten, walau jarang dipakai |

## Audit Dark Mode
CLEAR dalam arti tidak ada implementasi sama sekali — tidak ditemukan satu pun pengaturan untuk menyesuaikan tampilan gelap otomatis. Seluruh warna ditulis tetap (tidak menyesuaikan pengaturan sistem). **Dampaknya tidak berbahaya** untuk aplikasi ini: karena seluruh warna latar dan teks ditulis tetap dan berpasangan secara konsisten (latar selalu terang, teks selalu gelap, sesuai pasangannya), tampilan akan selalu konsisten terang berapa pun pengaturan sistem operasi perangkat admin — tidak akan ada teks gelap di atas latar gelap yang membuatnya tidak terbaca. Ini adalah konsol kerja kantor yang wajar selalu tampil terang, bukan kekurangan yang mendesak untuk diperbaiki.

## Audit Cetak
CLEAR dalam arti tidak ada pengaturan khusus cetak sama sekali — tidak ditemukan satu pun pengaturan untuk menyesuaikan tampilan saat dicetak ke kertas/PDF. Konsekuensinya jika ada admin yang mencoba mencetak halaman ini langsung dari browser:
- Latar belakang biru tua, hijau, merah, dan abu-abu pada tombol dan badge kemungkinan akan ikut tercetak penuh warna (memakai banyak tinta) atau hilang sama sekali tergantung pengaturan printer/browser masing-masing — hasilnya tidak bisa dipastikan konsisten.
- Menu sidebar di sisi kiri (yang memakan ruang horizontal cukup besar) akan ikut tercetak, padahal tidak relevan untuk dokumen cetak — berpotensi membuat tabel data di sebelahnya terpotong karena ruang halaman cetak berkurang.
- Tabel data yang panjang (misalnya daftar siswa kelas XII saat tutup tahun ajaran) tidak punya pengaturan apa pun untuk mengatur judul kolom tetap muncul di setiap halaman cetak — jika daftar siswa lebih dari satu halaman kertas, halaman kedua dan seterusnya tidak akan punya judul kolom sama sekali.

## Audit Emosi Visual
Secara keseluruhan, kesan visual aplikasi ini **tenang dan profesional**, sesuai untuk konteks pekerjaan administrasi sekolah — bukan platform yang terasa "menakutkan" atau penuh peringatan. Warna merah tidak dipakai berlebihan; ia hanya muncul pada situasi yang memang membutuhkan perhatian (pesan kesalahan dan tombol aksi yang tidak bisa dibatalkan), dan jumlah kemunculannya wajar dibanding warna biru (warna utama) dan warna netral (abu-abu, putih) yang mendominasi tampilan secara umum.

Satu catatan kecil: karena warna merah dipakai untuk DUA hal yang levelnya berbeda jauh (pesan error kecil seperti "tanggal salah format" DAN tombol aksi besar seperti "Tutup Semester Sekarang" yang dampaknya permanen), seorang admin yang sudah terbiasa melihat banyak pesan error merah kecil sehari-hari berisiko menjadi kurang waspada saat melihat warna merah yang sama dipakai untuk tombol yang jauh lebih berisiko. Ini bukan soal warna merah itu sendiri terlalu banyak, tapi soal warna merah dipakai untuk dua tingkat keseriusan yang seharusnya dibedakan.

## Temuan & Rekomendasi

**HIGH**
- Teks pesan dan badge bermakna "sukses" (hijau di atas hijau muda) dan "peringatan" (oranye di atas oranye muda) terbukti gagal memenuhi standar minimum keterbacaan — rasio kontrasnya masing-masing hanya sekitar 3,1:1 dan 3,1:1, jauh di bawah angka 4,5:1 yang dianggap aman untuk teks berukuran normal. Ini muncul berulang kali di seluruh aplikasi (setiap pesan sukses impor, setiap peringatan semester). Rekomendasi: pertajam warna hijau dan oranye untuk teks (gunakan warna yang lebih gelap/pekat), atau pertahankan warna latar tapi gelapkan warna tulisannya, supaya tetap nyaman dibaca terutama oleh admin dengan penglihatan kurang tajam atau saat layar terkena cahaya terang.
- Peringatan paling kritis di seluruh aplikasi — konsekuensi menutup semester (data terkunci permanen) dan membuka tahun ajaran baru (tidak bisa dibatalkan) — divisualkan dengan ukuran teks dan warna yang sama dengan keterangan biasa, bukan ditonjolkan sesuai tingkat risikonya. Admin yang terburu-buru berisiko tidak benar-benar membaca peringatan ini sebelum menekan tombol. Rekomendasi: buat peringatan untuk aksi yang tidak bisa dibatalkan ini secara visual jauh lebih menonjol (ukuran teks lebih besar, kotak peringatan dengan warna lebih kuat) dibanding informasi pendukung di sekitarnya.

**MEDIUM**
- Teks pesan error (merah di atas merah muda) dan label keterangan kecil (abu-abu di atas latar halaman) sama-sama hanya lolos standar minimum dengan selisih sangat tipis (4,41 dan 4,47, dari batas minimum 4,5) — beberapa malah sedikit di bawah batas. Ini bukan kegagalan parah, tapi tidak ada ruang aman sama sekali; perubahan kecil pada pencahayaan layar atau kualitas mata pengguna bisa membuat teks ini terasa kurang nyaman dibaca. Rekomendasi: pertajam sedikit warna-warna ini agar punya jarak aman dari batas minimum, bukan pas-pasan di pinggir batas.
- Status siswa (Aktif/Lulus/Keluar/PKL) ditampilkan sebagai teks polos tanpa warna, sementara status serupa di dua tempat lain (Program Keahlian, Guru & Staf) memakai badge berwarna. Admin yang sudah terbiasa mengandalkan warna untuk cepat mengenali status berisiko melewatkan informasi status siswa karena tidak ada penanda visual yang sama. Rekomendasi: terapkan badge berwarna yang konsisten untuk status siswa juga.
- Warna merah dipakai untuk dua tingkat keseriusan yang sangat berbeda (pesan error kecil dan aksi besar tidak bisa dibatalkan) tanpa pembeda visual lain. Rekomendasi: pertimbangkan menambahkan elemen visual tambahan (misalnya ikon peringatan, bukan hanya warna) khusus untuk tombol aksi yang tidak bisa dibatalkan, agar terasa berbeda levelnya dari pesan error biasa.
- Angka ringkasan hasil impor (Total Baris, Berhasil, Gagal, Konflik) semuanya ditampilkan dengan gaya visual yang identik tanpa pembeda warna, padahal angka "Gagal" dan "Konflik" semestinya lebih menarik perhatian admin untuk segera ditindaklanjuti. Rekomendasi: beri warna penekanan (misalnya merah/oranye) khusus pada angka Gagal/Konflik jika nilainya lebih dari nol.

**LOW**
- Indikator tahap pada kedua wizard membedakan tahap "selesai" dan "sedang berjalan" hanya lewat warna (hijau vs biru) tanpa simbol tambahan seperti tanda centang. Rekomendasi: tambahkan simbol centang sederhana pada tahap yang sudah selesai, supaya tidak hanya mengandalkan kemampuan membedakan warna.
- Halaman ini tidak punya pengaturan khusus untuk hasil cetak — jika admin mencoba mencetak data (misalnya daftar siswa), menu sidebar ikut tercetak dan tabel panjang tidak akan menampilkan ulang judul kolom di halaman berikutnya. Rekomendasi: jika ada kebutuhan mencetak laporan dari sistem ini di kemudian hari, siapkan pengaturan tampilan khusus cetak yang menyembunyikan menu dan mengulang judul kolom tabel di setiap halaman.
- Tidak ada elemen visual di tampilan awal dashboard yang menonjolkan tugas mendesak (jika ada) — selaras dengan temuan serupa di audit keterbacaan sebelumnya. Rekomendasi: lihat rekomendasi terkait di audit UX sebelumnya.
