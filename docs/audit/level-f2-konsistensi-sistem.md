# Audit 32 — Konsistensi Sistem
Tanggal: 24 Juni 2025

Catatan metodologi: audit ini melengkapi Audit Bahasa (Level F) dan Audit Warna (Level G) dengan fokus khusus pada konsistensi LINTAS HALAMAN — apakah konsep, pola, dan perilaku yang sama tetap sama di mana pun muncul. Temuan yang sudah tercatat di Level F (misalnya "Impor" vs "Import", "Tahap" vs "Langkah", tombol "Konfirmasi" yang kurang jelas) dan Level G (pewarnaan status, kontras) tidak diulang di sini — audit ini hanya melaporkan temuan BARU yang belum tercatat di kedua audit tersebut.

## Konsistensi Istilah

| Konsep | Versi A | Lokasi A | Versi B | Lokasi B | Yang Seharusnya Dipakai |
|---|---|---|---|---|---|
| Nama produk/aplikasi ini sendiri | "Admin Console" (judul setiap halaman, nama merek di pojok kiri atas, dan di brand sidebar dashboard) | `admin/index.html`, `admin/dashboard.html`, `admin/setup.html`, `admin/tutup-tahun.html` — semua judul halaman dan elemen brand | "konsol admin" (huruf kecil, terjemahan Indonesia) | Pesan error login di `admin/js/auth.js` ("Akun ini tidak memiliki akses ke konsol admin.") | Pilih satu — sebaiknya "Admin Console" karena itu yang dipakai di seluruh judul halaman dan brand, atau terjemahkan semuanya sekaligus jika ingin konsisten berbahasa Indonesia penuh |
| Pihak yang dihubungi saat ada kesalahan sistem | "Admin" (nama peran yang dipakai konsisten di seluruh aplikasi untuk merujuk pengguna console ini) | Seluruh aplikasi | "administrator" (istilah umum, huruf kecil, beda kata) | Pesan error di `admin/js/dashboard.js` ("Hubungi administrator.") dan `admin/js/semester.js` (pesan serupa) | Ganti "administrator" jadi "tim teknis" atau sebutan lain yang BUKAN "Admin" — karena "Admin" di aplikasi ini sudah dipakai sebagai sebutan untuk peran yang sedang membaca pesan error itu sendiri, sehingga memakai kata yang mirip untuk pihak lain (tim teknis di belakang sistem) membingungkan siapa yang dimaksud |

## Konsistensi Status

| Status | Versi yang ditemukan | Lokasi | Rekomendasi |
|---|---|---|---|
| Status pertemuan/sesi mengajar (normal, kegiatan sekolah, guru tidak hadir) | Ditampilkan sebagai kode mentah berbahasa Inggris dengan garis bawah, contoh "NORMAL", "GURU_TIDAK_HADIR" | Panel Jadwal Aktif di dashboard (`admin/js/dashboard.js`, kolom "Status" pada tabel jadwal) | Tampilkan dalam bentuk kalimat biasa berbahasa Indonesia, misalnya "Normal", "Guru Tidak Hadir" — sejalan dengan rekomendasi serupa yang sudah dicatat di Level F untuk kolom status/peran lain, tapi ini adalah lokasi tambahan yang belum disebutkan di audit sebelumnya |

Catatan: status lain yang sudah dibahas tuntas di Level F (kolom "Role"/"Status" pada Daftar Pengguna dan Siswa) dan Level G (perbedaan warna badge antar panel) tidak diulang di sini.

## Konsistensi Format Tanggal

| Konteks | Format yang dipakai | Lokasi | Konsisten? |
|---|---|---|---|
| Tanggal pada kotak isian (klik untuk pilih tanggal) | Format bawaan peramban (tampilan visual ikut bahasa/pengaturan perangkat, nilai yang disimpan selalu TAHUN-BULAN-TANGGAL) | Kotak isian tanggal mulai/selesai semester baru, dan tanggal mulai/selesai tahun ajaran baru | Konsisten — semua kotak isian tanggal di aplikasi ini memakai jenis kotak isian tanggal bawaan peramban yang sama, tidak ada yang memakai kotak teks bebas untuk tanggal |
| Tanggal yang ditampilkan sebagai teks dalam kalimat (bukan kotak isian) | Format mentah TAHUN-BULAN-TANGGAL (contoh: "2025-07-01"), tanpa diterjemahkan ke format yang lebih wajar dibaca seperti "1 Juli 2025" | Ringkasan periode semester di panel Tutup Semester (contoh kalimat: "Tahun Ajaran 2025/2026 — Semester 1 (2025-07-01 s/d 2025-12-31)"), jendela konfirmasi saat menutup semester dan membuka semester baru | Konsisten dalam arti SELALU memakai format mentah ini di setiap tempat yang menampilkan tanggal sebagai teks — tapi format ini sendiri tidak ramah dibaca untuk pengguna sehari-hari |
| Tanggal pada tabel jadwal mengajar | Format mentah TAHUN-BULAN-TANGGAL, sama seperti di atas | Panel Jadwal Aktif (kolom "Tanggal") | Konsisten dengan poin sebelumnya (sama-sama format mentah), tapi belum ramah dibaca |
| Waktu pemberian akses dan masa berlaku token guru pengganti | Format mentah lengkap dengan jam, detik, dan zona waktu (contoh: "2025-06-24T10:30:00.000+00:00") | Panel Guru Pengganti (kolom "Diberikan Pada" dan "Token Berlaku Sampai") | **TIDAK konsisten** dengan tampilan tanggal di tempat lain — di sini bukan cuma tanggal mentah, tapi seluruh cap waktu teknis lengkap dengan jam-menit-detik dan kode zona waktu ikut ditampilkan apa adanya, jauh lebih sulit dibaca dibanding tanggal mentah di tabel Jadwal Aktif yang setidaknya hanya tanggal saja |

**Kesimpulan bagian ini:** seluruh aplikasi konsisten dalam arti tidak pernah memakai format tanggal "wajar dibaca" (seperti "1 Juli 2025") di mana pun — selalu format mentah sistem. Tapi ada satu titik yang tampilannya jauh lebih buruk dari yang lain: panel Guru Pengganti menampilkan cap waktu teknis penuh (jam, detik, zona waktu) yang bahkan lebih sulit dibaca dibanding tanggal mentah biasa di tempat lain.

## Konsistensi Pola Tombol

| Tipe tombol | Variasi yang ditemukan | Lokasi | Rekomendasi |
|---|---|---|---|
| Warna tombol untuk aksi besar yang tidak bisa dibatalkan | "Tutup Semester [angka] Sekarang" dan "Konfirmasi Kelulusan" memakai warna merah (tombol berbahaya) — tapi "Konfirmasi" (membuka tahun ajaran baru, yang sama-sama tidak bisa dibatalkan dan bahkan memproses kenaikan kelas seluruh sekolah) memakai warna biru biasa (tombol aksi utama), bukan merah | `admin/tutup-tahun.html` (tombol "Konfirmasi" langkah 4 berwarna biru) dibandingkan `admin/tutup-tahun.html` (tombol "Konfirmasi Kelulusan" langkah 2 berwarna merah) dan `admin/js/semester.js` (tombol "Tutup Semester Sekarang" berwarna merah) | Samakan warna tombol berdasarkan tingkat risiko aksinya, bukan berdasarkan tahap wizard yang kebetulan — jika "Tutup Semester" dan "Konfirmasi Kelulusan" memakai warna merah karena tidak bisa dibatalkan, maka "Konfirmasi" (buka tahun ajaran baru) yang levelnya setara atau lebih besar seharusnya juga merah |
| Posisi tombol aksi penyimpanan (bukan navigasi) relatif terhadap tombol navigasi wizard | Tombol "Konfirmasi Kelulusan", "Konfirmasi Kenaikan Kelas", dan "Konfirmasi" semuanya diletakkan DI DALAM isi tahap (sebelum baris tombol "Kembali"/"Lanjut" di bagian paling bawah wizard) — bukan di baris tombol navigasi yang sama | Konsisten — ketiganya memakai pola peletakan yang sama persis di `admin/tutup-tahun.html` | Tidak ada masalah, sudah konsisten |
| Urutan tombol navigasi wizard | "Kembali" selalu di kiri, "Lanjut"/"Selesaikan Setup"/"Selesai" selalu di kanan, di kedua wizard | `admin/setup.html` dan `admin/tutup-tahun.html`, elemen `.wizard-actions` | Konsisten, tidak ada masalah |
| Tombol konfirmasi destruktif berbasis jendela konfirmasi bawaan peramban | Semua jendela konfirmasi (tutup semester, buka semester baru, kelulusan massal, kenaikan kelas, buka tahun ajaran baru) memakai jendela konfirmasi bawaan peramban yang sama (tombol OK/Batal ditentukan oleh sistem operasi pengguna, bukan dirancang sendiri oleh aplikasi) | Tersebar di `admin/js/semester.js` dan `admin/js/tutup-tahun.js` | Konsisten dalam arti semuanya memakai jenis jendela yang sama, tidak ada yang memakai jendela konfirmasi buatan sendiri yang tata letaknya bisa beda-beda — ini aman dari risiko tombol terbalik |

## Konsistensi Permission

CLEAR untuk konsistensi jalur masuk — setiap halaman utama console ini (halaman login, dashboard, setup awal, tutup tahun ajaran) melakukan pengecekan login dan peran dengan cara yang identik di titik masuknya masing-masing, dikonfirmasi langsung dari kode setiap halaman. Tidak ditemukan satu pun fitur yang bisa diakses lewat satu jalur tapi terblokir lewat jalur lain, atau sebaliknya — semua jalur masuk ke fitur yang sama menerapkan aturan yang sama persis.

Catatan: kesenjangan yang lebih mendasar soal SIAPA yang seharusnya boleh mengakses apa (misalnya Wali Kelas dan Kaprodi yang bisa melihat data siswa di luar tanggung jawabnya) sudah dibahas tuntas di audit tata kelola sebelumnya — itu bukan soal konsistensi jalur masuk, tapi soal aturan akses itu sendiri yang terlalu longgar, sehingga tidak diulang di sini.

## Konsistensi Pola Feedback

| Jenis feedback | Variasi yang ditemukan | Lokasi | Rekomendasi |
|---|---|---|---|
| Tempat munculnya pesan kesalahan pada kedua wizard (setup awal dan tutup tahun ajaran) | Kedua wizard memakai SATU kotak pesan kesalahan yang sama untuk SELURUH tahap — bukan kotak terpisah per tahap | `admin/setup.html` dan `admin/tutup-tahun.html`, elemen tunggal `#wizard-error` yang dipakai bersama oleh semua tahap dalam satu wizard | Konsisten antar kedua wizard (sama-sama memakai pola ini), tapi pola ini sendiri punya kelemahan: jika admin pernah melihat pesan kesalahan di suatu tahap lalu pindah tahap, pesan itu hilang sepenuhnya — bukan soal konsistensi lintas halaman, tapi catatan tambahan yang relevan |
| Tempat munculnya pesan kesalahan/sukses pada panel-panel dashboard (impor CSV, tutup semester) | Setiap panel punya kotak pesan hasil sendiri-sendiri yang dibuat ulang setiap kali panel itu ditampilkan, BUKAN satu kotak bersama seperti pada wizard | `admin/js/import.js` (area hasil per widget impor), `admin/js/semester.js` (area hasil per bagian panel) | Pola ini berbeda dari pola wizard (satu kotak bersama vs kotak per-komponen), tapi ini WAJAR karena dashboard memang menampilkan satu panel pada satu waktu, jadi tidak benar-benar inkonsisten — hanya beda pola sesuai struktur masing-masing bagian aplikasi |
| Pesan otomatis hilang sendiri setelah beberapa saat (auto-dismiss) | **Tidak ditemukan satu pun** pesan yang hilang otomatis di seluruh aplikasi — baik pesan sukses maupun pesan kesalahan selalu tetap tampil sampai pengguna pindah tahap/panel atau melakukan aksi baru | Diperiksa di seluruh `admin/js/*.js` | Konsisten — tidak ada variasi sama sekali, semua pesan bersifat tetap tampil. Ini aman dan dapat diprediksi, tidak perlu diubah |
| Status sedang memproses pada tombol aksi | Sebagian besar tombol aksi sudah konsisten menampilkan status "Memproses..." atau sejenisnya saat sedang bekerja, tapi beberapa tombol (sudah dicatat di Level F: "Tambah Kelas", "Lanjut" pada Setup Wizard, "Konfirmasi Kenaikan Kelas") tidak punya penanganan ini | Tersebar di `admin/js/setup-wizard.js` dan `admin/js/tutup-tahun.js` | Sudah tercatat di Level F, tidak diulang sebagai temuan baru di sini — hanya dikonfirmasi ulang bahwa ini memang murni soal kelengkapan penanganan per tombol, bukan soal ada dua pola berbeda yang disengaja |

## Konsistensi Layout

**Ditemukan inkonsistensi ukuran jarak dalam (padding) pada tiga jenis "kotak utama" yang fungsinya serupa di seluruh aplikasi** — kotak putih berbayang yang membungkus isi halaman:
- Kotak login memakai jarak dalam 36px (atas-bawah) dan 32px (kiri-kanan).
- Kotak isi wizard (setup awal dan tutup tahun ajaran) memakai jarak dalam 32px di semua sisi.
- Kotak panel dashboard memakai jarak dalam 24px di semua sisi.

Ketiganya adalah jenis kotak yang secara visual dan fungsional setara (bingkai utama tempat konten halaman ditampilkan), tapi masing-masing punya jarak dalam yang berbeda — sehingga kerapatan visual antar halaman terasa sedikit berbeda meski pengguna mungkin tidak menyadari sebabnya secara spesifik.

Selain itu, posisi judul halaman dan navigasi sudah konsisten dan sesuai pola masing-masing jenis halaman: kedua wizard selalu menempatkan judul besar di tengah-atas dengan indikator tahap di bawahnya (sudah dibahas di Level F), dan dashboard selalu menempatkan menu navigasi di sisi kiri dengan posisi tetap (tidak berpindah saat panel berganti). Tidak ditemukan halaman yang menyimpang dari pola kelompoknya masing-masing.

## Temuan & Rekomendasi

**HIGH**
- Warna tombol untuk aksi besar dan tidak bisa dibatalkan tidak konsisten berdasarkan tingkat risiko: "Tutup Semester Sekarang" dan "Konfirmasi Kelulusan" memakai warna merah (tombol berbahaya), tapi tombol "Konfirmasi" yang membuka tahun ajaran baru — aksi yang levelnya setara atau bahkan lebih besar karena memproses kenaikan kelas seluruh sekolah sekaligus — memakai warna biru biasa seperti tombol aksi sehari-hari. Dampak: admin yang sudah belajar "warna merah berarti hati-hati, ini tidak bisa dibatalkan" justru tidak mendapat sinyal yang sama saat aksi yang levelnya setara muncul dengan warna netral. Rekomendasi: ubah warna tombol "Konfirmasi" pada langkah pembukaan tahun ajaran baru menjadi warna yang sama dengan tombol-tombol berbahaya lainnya.

**MEDIUM**
- Tanggal dan waktu ditampilkan dalam format teknis mentah di seluruh aplikasi (bukan format yang wajar dibaca seperti "1 Juli 2025"), dan satu lokasi khususnya (panel Guru Pengganti) menampilkan cap waktu lengkap dengan jam-menit-detik dan kode zona waktu yang jauh lebih sulit dibaca dibanding tanggal mentah biasa di tempat lain. Dampak: admin harus menerjemahkan sendiri format ini setiap kali membaca tanggal di aplikasi, dan khususnya di panel Guru Pengganti, informasi yang relevan (kapan akses diberikan) tenggelam di antara detail teknis yang tidak perlu. Rekomendasi: ubah seluruh tampilan tanggal menjadi format yang wajar dibaca, dan untuk panel Guru Pengganti khususnya, tampilkan hanya tanggal dan jam tanpa detik/zona waktu.
- Nama aplikasi ini sendiri disebut dengan tiga cara berbeda: "Admin Console" (konsisten di semua judul halaman), "konsol admin" (satu pesan error), dan kata "administrator" dipakai untuk merujuk pihak lain yang berbeda dari peran "Admin" yang sudah jadi sebutan tetap di aplikasi ini. Dampak: pengguna yang membaca pesan error bisa bingung apakah "administrator" yang dimaksud adalah dirinya sendiri atau pihak lain. Rekomendasi: tetapkan satu sebutan resmi untuk aplikasi ini dan satu sebutan terpisah yang jelas berbeda untuk "tim teknis di balik sistem", supaya tidak tertukar dengan sebutan peran "Admin" yang dipakai pengguna aplikasi ini.
- Status pertemuan/sesi mengajar (normal, kegiatan sekolah, guru tidak hadir) ditampilkan sebagai kode mentah berbahasa Inggris di panel Jadwal Aktif, sejalan dengan pola serupa yang sudah ditemukan di kolom lain pada audit sebelumnya. Dampak: admin harus menerka makna kode ini alih-alih membaca kalimat biasa. Rekomendasi: terapkan perbaikan yang sama seperti yang sudah direkomendasikan untuk kolom status/peran lain di seluruh aplikasi.
- Tiga jenis "kotak utama" pembungkus konten (kotak login, kotak wizard, kotak panel dashboard) memakai tiga ukuran jarak dalam yang berbeda (36px+32px, 32px, dan 24px) untuk fungsi yang setara. Dampak: kerapatan visual terasa sedikit berbeda antar bagian aplikasi tanpa alasan fungsional yang jelas. Rekomendasi: tetapkan satu nilai jarak dalam standar untuk seluruh jenis kotak pembungkus konten utama, kecuali ada alasan desain khusus untuk membedakannya.

**LOW**
- Tidak ditemukan temuan LOW baru yang belum tercakup di kategori HIGH/MEDIUM di atas atau di Level F/G — kedua audit sebelumnya sudah cukup menyeluruh dalam mencakup temuan-temuan kecil terkait konsistensi.
