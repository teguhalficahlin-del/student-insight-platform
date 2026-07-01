# Audit Level C — Data
Tanggal audit awal: 24 Juni 2025
Pembaruan terakhir: 1 Juli 2026

## PEMBARUAN 1 Juli 2026

- **Relasi Rusak (CRITICAL #1):** SELESAI. Migration `20260630230000_fix_apply_schedule.sql` memperkenalkan RPC `fn_apply_schedule_templates()` yang secara otomatis mengisi `teaching_assignments` saat admin menerapkan jadwal dari template. Kolom `assignment_id` di `teaching_schedules` kini selalu terisi valid. Lihat catatan inline di bagian Relasi Rusak di bawah.
- **Kepemilikan Data — "Penugasan guru tetap" (tidak jelas pemiliknya):** Kini dikelola oleh proses `fn_apply_schedule_templates()` — dibuat otomatis oleh sistem saat Admin menerapkan jadwal, bukan manual oleh aktor tertentu.
- **Kepemilikan Data — "Penempatan PKL" (belum ada antarmuka):** Kini sudah ada antarmuka di portal Kaprodi dalam `guru/dashboard.html`.

---

## Audit Model Data

### Duplikasi Entitas
CLEAR — tidak ditemukan dua tempat penyimpanan data yang menyimpan informasi yang sama untuk hal yang sama. Beberapa data terlihat mirip sekilas tapi sebenarnya mewakili konsep yang berbeda dan memang sengaja dipisah:
- Data "siapa mengajar apa secara tetap" (penugasan guru ke kelas dan mata pelajaran) disimpan terpisah dari data "sesi mengajar pada tanggal tertentu" (jadwal harian) — ini wajar karena satu penugasan tetap bisa menghasilkan puluhan sesi jadwal sepanjang semester.
- Data "pola jadwal mingguan" (template jadwal berulang) disimpan terpisah dari "jadwal pada tanggal nyata" — wajar karena satu pola mingguan menghasilkan banyak tanggal konkret.

Catatan: informasi tahun ajaran (format "2025/2026") disimpan berulang di delapan tempat berbeda (data kelas, data pendaftaran siswa ke kelas, data penugasan guru, data periode akademik, data jadwal harian, data pola jadwal mingguan, data kelulusan siswa, dan data konfigurasi sekolah). Ini bukan duplikasi yang salah — ini wajar karena tahun ajaran dipakai sebagai penanda waktu di banyak data berbeda. Yang perlu diperhatikan adalah konsistensi formatnya, dibahas di bagian Inkonsistensi Format di bawah.

### Relasi Data
**Ditemukan satu relasi yang berpotensi rusak — lihat detail di bagian "Relasi Rusak" pada Audit Kualitas Data.** Secara umum, hampir semua hubungan antar data sudah didefinisikan secara tegas (bukan hanya dijaga oleh aplikasi) — misalnya data siswa yang terhubung ke program keahlian, data kelas yang terhubung ke siswa, dan seterusnya, semuanya dijaga langsung oleh sistem inti, bukan cuma oleh kode aplikasi.

Satu pengecualian penting: data jadwal mengajar punya dua cara berbeda untuk mencatat "siapa mengajar kelas apa" — satu lewat penugasan guru yang formal (jika ada), satu lewat catatan langsung pada jadwal itu sendiri (kelas, guru, mata pelajaran dicatat langsung, tanpa lewat penugasan formal). Jadwal yang dibuat lewat fitur impor CSV jadwal **selalu** memakai cara kedua — penugasan formalnya kosong. Ini dilakukan secara sengaja sesuai catatan di kode, tapi punya konsekuensi serius yang dijelaskan di bagian Relasi Rusak.

### Kepemilikan Data

| Data | Pemilik Operasional | Catatan |
|---|---|---|
| Program keahlian, Mata pelajaran | Admin | Data master, jarang berubah |
| Kelas & Rombel | Admin | Data master per tahun ajaran |
| Akun pengguna (Guru, BK, Wali Kelas, Kaprodi, Kepsek, Admin) | Admin (provisioning), masing-masing pemilik akun (data dirinya sendiri) | Admin membuat akun, pemilik akun yang memperbarui datanya sendiri |
| Data siswa & status kelulusan | Admin | Termasuk proses kelulusan dan kenaikan kelas |
| Hubungan siswa—orang tua | Admin (provisioning) | Dibuat saat impor data orang tua |
| Data mitra DUDI | Admin (provisioning) | Tidak ada pemilik operasional lanjutan yang jelas — tidak ada panel pengelolaan DUDI setelah impor awal |
| Penempatan PKL | Kaprodi, Kepsek | Sesuai aturan akses, tapi belum ada antarmuka pengelolaannya di mana pun dalam kode yang ada |
| Periode akademik (semester aktif) | Admin | Dikunci begitu semester ditutup |
| Penugasan guru tetap (siapa mengajar apa) | **Tidak jelas pemiliknya** | Lihat temuan kritis di bagian Relasi Rusak — tidak ada satu pun bagian sistem yang membuat data ini |
| Pola jadwal mingguan & jadwal harian | Admin (lewat impor CSV) | — |
| Guru pengganti | Kaprodi, Kepsek (sesuai aturan akses) | Tidak ada antarmuka untuk menugaskan pengganti — hanya bisa dilihat lewat dashboard, tidak bisa dibuat dari mana pun dalam kode yang ada |
| Absensi siswa | Guru, Wali Kelas, guru pengganti | — |
| Catatan observasi siswa | Guru, Wali Kelas, BK, Kaprodi, Kepsek | — |
| Prestasi siswa | Wali Kelas, Kaprodi, Kepsek | — |
| Kasus siswa & riwayat penanganannya | Guru, BK, Wali Kelas, Kaprodi, Kepsek, DUDI (sesuai level penanganan) | — |
| Pesan dengan orang tua | Orang tua, staf terkait | — |
| Jurnal guru | Guru (masing-masing, privat) | — |
| Catatan aktivitas guru (dasar indikator kehadiran guru) | Sistem (otomatis) | Tidak pernah ditulis manusia |

### Entitas Tidak Terpakai
Bukan "tidak terpakai" dalam arti mati/sia-sia, tapi ditemukan dua kategori kesenjangan:

1. **Tujuh tampilan data ringkas (untuk mendukung laporan/dashboard tingkat lanjut) sudah disiapkan di tingkat sistem inti, tapi tidak ada satupun yang dipakai oleh console admin yang ada sekarang.** Beberapa di antaranya tampak ditujukan untuk dashboard Kepala Sekolah (ringkasan pengecualian/peringatan), portal siswa (capaian positif, prestasi), riwayat kasus, dan sinkronisasi luring guru. Tidak ditemukan kode mana pun (baik di console admin maupun fungsi backend yang ada) yang benar-benar memanggil tampilan-tampilan ini. Ini konsisten dengan temuan audit sebelumnya bahwa dashboard untuk peran selain Admin belum dibangun — bukan berarti rancangannya sia-sia, tapi nilainya baru terealisasi setelah dashboard tersebut dibangun.
2. **Sepuluh dari dua puluh data inti** (penempatan PKL, penugasan guru tetap, catatan observasi, prestasi siswa, kasus siswa dan riwayatnya, pesan orang tua, jurnal guru, catatan aktivitas guru, catatan update siswa pada kasus) **tidak pernah disentuh oleh console admin maupun proses impor yang ada.** Ini wajar untuk data yang memang menjadi tanggung jawab peran lain (Guru, BK, dst.) yang dashboardnya belum dibangun — kecuali data penugasan guru tetap, yang justru dibutuhkan oleh fitur yang SUDAH berjalan (lihat Relasi Rusak).

## Audit Kualitas Data

### Data Kosong yang Bermasalah

| Data | Kolom | Masalah | Risiko |
|---|---|---|---|
| Jadwal mengajar harian | Penugasan guru tetap & mata pelajaran terkait | Boleh kosong (NULL) — dan KARENA satu-satunya cara membuat jadwal (impor CSV) selalu meninggalkannya kosong, semua jadwal yang ada di sistem hari ini pasti punya kolom ini kosong | **Tinggi** — lihat detail penuh di Relasi Rusak |
| Sesi jadwal yang batal karena guru tidak hadir | Catatan alasan pembatalan | Tidak ada kewajiban mengisi alasan saat status sesi diubah jadi "guru tidak hadir" | Rendah-Menengah — riwayat kenapa sesi batal jadi tidak lengkap untuk ditelusuri di kemudian hari |
| Konfigurasi sekolah | Tahun ajaran aktif, semester aktif | Boleh kosong sebelum proses setup selesai — wajar untuk sekolah yang belum selesai setup, tapi tidak ada pengaman di tingkat sistem inti yang mencegah data operasional (jadwal, kelas) dibuat sebelum konfigurasi ini terisi | Rendah — dalam praktiknya wizard setup mengisi ini di tahap pertama, jadi risiko kecil kecuali ada jalan pintas di luar wizard |

### Potensi Duplikasi
CLEAR untuk sebagian besar data — kombinasi yang seharusnya unik (NIS siswa, kode program, kode mata pelajaran, nama kelas dalam satu tahun ajaran yang sama, kombinasi siswa-tahun ajaran-semester untuk pendaftaran kelas, dan lain-lain) sudah dijaga ketat oleh sistem agar tidak ada data ganda.

Satu titik perlu diperhatikan: **proses impor ulang jadwal mengajar bisa menghasilkan sesi jadwal ganda dalam kasus tertentu.** Penjagaan anti-duplikat untuk jadwal harian didasarkan pada kombinasi kelas + guru + tanggal + jam mulai. Jika dua pola jadwal mingguan berbeda (misalnya diimpor dari dua file CSV terpisah, atau direvisi di waktu berbeda) menghasilkan jam mulai yang sedikit berbeda untuk kelas dan guru yang sama di tanggal yang sama, sistem akan menganggapnya sebagai dua sesi berbeda yang sah — padahal secara nyata itu mungkin jadwal yang sama yang diperbaiki jamnya. Ini bukan duplikasi otomatis yang pasti terjadi, tapi celah yang bisa muncul kalau Admin mengimpor ulang jadwal dengan koreksi jam tanpa membersihkan jadwal lama terlebih dulu.

### Inkonsistensi Format
CLEAR untuk hampir semua data berstatus/berkategori — seluruh nilai seperti peran pengguna, status siswa, status kehadiran, kategori prestasi, status kasus, dan sejenisnya dibatasi ketat oleh sistem ke daftar nilai yang sudah ditentukan (tidak bisa diisi teks bebas yang berbeda-beda). Ini termasuk praktik yang baik dan konsisten di seluruh data.

Satu pengecualian kecil: nilai tahun ajaran (format "2025/2026") disimpan sebagai teks bebas di kedelapan tempat yang menyimpannya, **tanpa ada aturan format yang dipaksakan oleh sistem inti** — aturan format ini hanya dicek di kode aplikasi pada beberapa tempat (misalnya saat pengisian formulir setup awal dan formulir buka tahun ajaran baru), tapi tidak di semua tempat data ini bisa masuk. Risikonya kecil karena jalur masuk data ke kedelapan tempat ini hampir semua melalui proses yang sudah dikontrol (wizard, impor CSV, fungsi backend), tapi tetap merupakan celah jika ada jalur baru ditambahkan di masa depan tanpa menyalin aturan format yang sama.

### Relasi Rusak
> **Pembaruan 1 Juli 2026: Temuan ini telah DISELESAIKAN.** Lihat migration `20260630230000_fix_apply_schedule.sql`. RPC `fn_apply_schedule_templates()` kini secara otomatis upsert `teaching_assignments` per pasangan (guru, kelas) sebelum membuat `teaching_schedules`, sehingga `assignment_id` selalu terisi. Constraint `uq_schedule_per_assignment_date` yang over-restriktif juga sudah di-drop.

*(Teks asli Juni 2025, disimpan sebagai rekaman historis:)*

**TEMUAN KRITIS:** ditemukan relasi yang secara struktural tidak terhubung dengan benar, dan ini berdampak langsung pada fitur Absensi Siswa — fitur yang sebelumnya diklasifikasikan WAJIB di audit kebutuhan.

Penjelasannya begini: aturan akses yang mengatur siapa boleh mencatat absensi siswa mensyaratkan jadwal mengajar itu terhubung ke sebuah data "penugasan guru tetap" yang mencatat bahwa guru tersebut memang ditugaskan mengajar kelas dan mata pelajaran itu. Tapi:
1. Satu-satunya cara membuat jadwal mengajar yang ada sekarang (lewat impor CSV jadwal) **secara sengaja tidak pernah membuat data penugasan guru tetap ini** — kolom penghubungnya selalu dibiarkan kosong.
2. Setelah ditelusuri ke seluruh bagian sistem (console admin dan seluruh proses otomatis yang ada), **tidak ditemukan satu pun cara untuk membuat data penugasan guru tetap ini.** Data ini hanya disebutkan di aturan akses dan rancangan sistem, tapi tidak ada jalan untuk benar-benar mengisinya.

Akibatnya: untuk setiap jadwal mengajar yang dihasilkan dari impor CSV (yang berarti SEMUA jadwal yang ada di sistem ini sampai temuan ini ditulis), guru yang bersangkutan **tidak akan punya akses untuk mencatat absensi siswa di kelas itu**, karena aturan akses mensyaratkan keterhubungan dengan data penugasan yang tidak pernah ada. Risiko: fitur inti yang paling sering dipakai di seluruh sistem (absensi harian) berpotensi tidak bisa dijalankan sama sekali oleh guru biasa begitu sistem dipakai operasional, kecuali ada jalur lain di luar apa yang ditemukan dalam audit ini untuk mengisi data penugasan tersebut.

### Validasi yang Hilang
- Aturan format tahun ajaran (harus "YYYY/YYYY") tidak dipaksakan oleh sistem inti, hanya oleh sebagian kode aplikasi — sudah dibahas di atas.
- Aturan urutan tanggal (tanggal selesai harus setelah tanggal mulai) sudah dipaksakan dengan baik oleh sistem inti untuk periode akademik, jadwal, dan penempatan PKL — ini bagus dan konsisten.
- Aturan tingkat kelas (harus 10, 11, atau 12) sudah dipaksakan baik oleh sistem inti maupun dicek ulang di kode impor kelas — bagus, ada dua lapis pengaman.
- Tidak ditemukan aturan bisnis penting lain yang seharusnya ada tapi hilang — secara umum sistem ini cukup ketat dalam memvalidasi data lewat aturan-aturan di tingkat inti, dengan satu pengecualian besar (format tahun ajaran) dan satu temuan kritis (relasi penugasan guru) yang sudah dibahas di atas.

## Audit Pelaporan

### Panel Dashboard

| Panel | Keputusan yang bisa dibuat | Informasi yang hilang | Nilai |
|---|---|---|---|
| Program Keahlian | Konfirmasi semua program sudah benar terimpor | Tidak menampilkan apakah ada kelas yang memakai program ini — Admin tidak tahu program mana yang "aman" dihapus tanpa dicoba dulu | Sedang |
| Kelas & Rombel | Konfirmasi semua kelas sudah benar terimpor, periksa jumlah kelas per tingkat | Tidak menampilkan jumlah siswa per kelas — Admin tidak bisa melihat kelas mana yang terlalu penuh/kosong dari panel ini saja | Sedang |
| Mata Pelajaran | Konfirmasi daftar mata pelajaran sudah lengkap | Tidak menampilkan mata pelajaran mana yang sudah/belum punya jadwal — minim nilai tindak lanjut | Rendah |
| Guru & Staf | Konfirmasi akun staf sudah aktif, identifikasi staf yang belum aktif | Tidak menampilkan staf yang belum punya jadwal mengajar sama sekali, atau staf yang terdaftar tapi tidak pernah memakai akunnya | Sedang |
| Siswa | Konfirmasi jumlah siswa dan status mereka (aktif/PKL/lulus) | Tidak menampilkan kelas masing-masing siswa di tabel ini — Admin harus pindah ke panel lain untuk menghubungkan siswa ke kelasnya | Sedang |
| Orang Tua | Konfirmasi akun orang tua sudah aktif | Tidak menampilkan siswa yang BELUM punya akun orang tua terhubung — ini justru informasi paling penting untuk tindak lanjut, tapi tidak ditampilkan | Rendah — kehilangan nilai paling besar dari panel ini |
| Jadwal Aktif | Memastikan jadwal sudah masuk dengan benar | Hanya menampilkan 50 jadwal paling baru, tidak ada cara mencari jadwal tertentu (misalnya jadwal kelas atau guru tertentu) — untuk satu semester penuh, panel ini jauh dari cukup untuk verifikasi menyeluruh | Rendah untuk sekolah dengan jadwal padat |
| Guru Pengganti | Memantau siapa saja yang pernah jadi guru pengganti | Hanya menampilkan 50 data terbaru, tanpa pencarian; tidak menampilkan untuk jadwal/kelas mana penggantian itu terjadi (hanya tanggal pemberian akses) — sulit dipakai untuk benar-benar menelusuri riwayat penggantian guru tertentu | Rendah |
| Tutup Semester | Memutuskan kapan menutup semester dan membuka semester berikutnya | (Dibahas detail di Audit Level B) | Tinggi — satu-satunya panel yang benar-benar mendorong keputusan besar |
| Tahun Ajaran Baru | Tidak ada — panel ini hanya catatan bahwa fitur ini belum dikerjakan penuh dan harus diubah manual | Seluruh informasi (panel kosong, hanya teks penjelasan) | Tidak ada nilai tindakan |
| Export Data | Tidak ada — belum berfungsi | Seluruh informasi (belum diimplementasikan) | Tidak ada nilai tindakan |
| Log Aktivitas | Tidak ada — belum berfungsi | Seluruh informasi (belum diimplementasikan) | Tidak ada nilai tindakan |
| (Tidak ada panel) Mitra DUDI | — | Tidak ada panel untuk melihat daftar DUDI yang sudah diimpor sama sekali — sudah ditemukan di audit sebelumnya, dikonfirmasi ulang di sini dari sisi pelaporan: data DUDI benar-benar tidak punya jalan untuk diverifikasi lewat dashboard | Tidak ada — panel ini tidak ada |

### Panel tanpa nilai tindakan
- **Tahun Ajaran Baru** — hanya menampilkan teks penjelasan bahwa fitur belum lengkap, tidak mendorong tindakan apa pun.
- **Export Data** — belum berfungsi sama sekali.
- **Log Aktivitas** — belum berfungsi sama sekali.
- **Mata Pelajaran** — secara teknis berfungsi dan menampilkan data, tapi tidak memberi informasi yang mengarahkan Admin untuk melakukan sesuatu (sekadar daftar nama, tidak ada indikasi mana yang sudah/belum dipakai di jadwal).

## Temuan & Rekomendasi

**HIGH**
- Fitur absensi siswa — fitur yang paling sering dipakai dan dianggap wajib bagi sekolah — berisiko tidak bisa dijalankan oleh guru biasa, karena syarat akses untuk mencatat absensi membutuhkan data "penugasan mengajar" yang sampai saat ini tidak ada satu pun cara untuk membuatnya di seluruh sistem, sementara satu-satunya cara membuat jadwal (impor CSV) sengaja tidak mengisi data itu. Rekomendasi: sebelum sistem dipakai operasional, pastikan ada cara untuk membuat data penugasan mengajar ini — baik dengan menambahkan langkah baru di proses impor jadwal yang otomatis membuatnya, atau dengan menyediakan formulir khusus untuk Admin/Kaprodi menugaskan guru ke kelas dan mata pelajaran sebelum jadwal dibuat. Ini perlu diuji langsung dengan mencoba mencatat absensi sungguhan sebagai akun Guru sebelum diluncurkan ke sekolah.
- Data orang tua siswa belum punya cara mudah untuk mengetahui siswa mana yang BELUM punya akun orang tua terhubung — padahal ini justru informasi paling berguna dari sisi pelaporan (untuk tahu siapa yang masih perlu didaftarkan). Rekomendasi: tambahkan informasi ini ke panel Orang Tua atau panel Siswa, misalnya penanda "belum ada orang tua terdaftar" di samping nama siswa.

**MEDIUM**
- Mengimpor ulang jadwal dengan koreksi jam mulai yang sedikit berbeda bisa menghasilkan sesi jadwal ganda untuk kelas, guru, dan tanggal yang sama, karena sistem mengenali "sesi yang sama" hanya lewat kombinasi jam mulai yang harus persis sama. Rekomendasi: sebelum mengimpor ulang jadwal dengan perubahan jam, bersihkan dulu jadwal lama untuk periode yang terdampak, dan beri panduan tertulis untuk Admin soal ini.
- Tidak ada cara melihat daftar mitra DUDI yang sudah diimpor dari dashboard sama sekali — Admin harus percaya proses impor berhasil tanpa bisa memverifikasinya. Rekomendasi: tambahkan panel daftar DUDI setara dengan jenis data lain.
- Panel jadwal mengajar dan guru pengganti hanya menampilkan 50 data terbaru tanpa kemampuan mencari data lain — tidak cukup untuk benar-benar memverifikasi satu semester penuh data. Rekomendasi: tambahkan kemampuan mencari dan melihat halaman selanjutnya.
- Aturan format tahun ajaran ("YYYY/YYYY") hanya dicek di sebagian tempat lewat kode aplikasi, tidak dipaksakan secara konsisten oleh sistem inti di semua tempat data ini disimpan. Rekomendasi: pastikan setiap formulir dan proses impor baru yang menyentuh tahun ajaran tetap memakai aturan format yang sama, dan pertimbangkan menambahkan pengaman format di tingkat sistem inti agar tidak bergantung pada disiplin setiap pengembang di masa depan.

**LOW**
- Tujuh tampilan data ringkas yang dirancang untuk mendukung dashboard Kepala Sekolah, portal siswa, dan riwayat kasus sudah disiapkan di tingkat sistem inti tapi belum dipakai oleh apa pun karena dashboard untuk peran-peran tersebut belum dibangun. Ini bukan masalah mendesak, tapi sebaiknya dicatat sebagai pekerjaan yang sudah setengah jalan supaya tidak terlupakan saat dashboard peran lain mulai dibangun.
- Panel Mata Pelajaran dan beberapa panel lain hanya menampilkan daftar tanpa informasi yang mengarahkan ke tindakan tertentu. Rekomendasi: tidak mendesak, tapi bisa dipertimbangkan menambahkan indikator sederhana (misalnya "dipakai di N jadwal") untuk menambah nilai panel ini saat ada waktu pengembangan lebih lanjut.
- Sesi jadwal yang dibatalkan karena guru tidak hadir tidak mewajibkan pengisian alasan pembatalan, sehingga riwayatnya kurang lengkap untuk ditelusuri kemudian. Rekomendasi: pertimbangkan menjadikan kolom alasan ini wajib diisi saat status itu dipilih.
