# Master Audit Summary
Platform Monitoring Perkembangan Siswa SMK
Tanggal: 24 Juni 2025
Total level diaudit: 7 (A sampai G)
Total sub-audit: 32

## Status Kesiapan Launch

**Belum siap launch ke sekolah dengan data siswa sungguhan.** Yang sudah benar-benar jadi dan layak dipakai hanyalah console Admin untuk setup awal, impor data massal, tutup semester, dan tutup tahun ajaran — bagian ini sudah matang dan teruji lewat audit. Tapi di luar console Admin, hampir seluruh fungsi inti sekolah (guru mencatat absensi dan observasi siswa, BK dan wali kelas menangani kasus, siswa dan orang tua melihat data mereka) **tidak punya aplikasi sama sekali** — baru berupa rancangan tertulis. Lebih parah lagi, satu-satunya jalur yang ada untuk membuat jadwal mengajar (impor CSV) secara struktural memutus kemampuan guru mencatat absensi begitu fitur itu dipakai, karena data "penugasan mengajar" yang disyaratkan sistem tidak pernah dibuat oleh proses apa pun yang ada. Ditambah lagi, Wali Kelas dan Kaprodi saat ini bisa melihat data SEMUA siswa di sekolah, bukan hanya yang menjadi tanggung jawab mereka — begitu data siswa sungguhan dimasukkan, ini langsung jadi pelanggaran privasi yang nyata, bukan risiko teoretis. Syarat minimum sebelum launch: ketiga masalah CRITICAL di bawah ini harus selesai dulu. Console Admin sendiri sudah cukup matang untuk dipakai sekarang oleh Admin sekolah untuk menyiapkan data, tapi sekolah tidak akan bisa menjalankan operasional harian (absensi, BK, kasus siswa) sampai aplikasi-aplikasi yang hilang itu dibangun.

## Temuan CRITICAL (blokir launch)

**1. Guru berisiko tidak bisa mencatat absensi siswa sama sekali**
Sistem mensyaratkan setiap jadwal mengajar terhubung ke data "penugasan mengajar resmi" sebelum guru diizinkan mencatat absensi di kelas itu. Tapi satu-satunya cara membuat jadwal yang ada sekarang (impor CSV jadwal oleh Admin) sengaja tidak pernah membuat data penugasan ini, dan setelah ditelusuri ke seluruh sistem, tidak ditemukan satu pun cara lain untuk membuatnya.
Dampak nyata: begitu sekolah mulai memakai sistem ini untuk mengajar sehari-hari, guru akan mencoba mencatat absensi dan ditolak oleh sistem, karena syarat aksesnya tidak pernah terpenuhi. Fitur paling sering dipakai di seluruh platform berhenti total sejak hari pertama operasional.
Sumber: Level C — Audit 7 (Relasi Rusak)

**2. Wali Kelas dan Kaprodi bisa melihat data semua siswa, bukan hanya tanggung jawabnya**
Wali Kelas seharusnya hanya melihat siswa di kelasnya, dan Kaprodi hanya siswa di program keahliannya — begitu rancangan sekolah. Tapi sistem yang berjalan sekarang mengizinkan keduanya melihat data SEMUA siswa di sekolah, lintas kelas dan lintas jurusan, tanpa batasan apa pun.
Dampak nyata: begitu data siswa sungguhan masuk, setiap Wali Kelas dan Kaprodi bisa membuka data pribadi dan catatan internal siswa dari kelas/jurusan yang sama sekali bukan urusannya. Ini bukan potensi risiko — begitu sistem dipakai dengan akun staf dan data siswa nyata, pelanggaran ini langsung terjadi.
Sumber: Level D — Audit 9 (Gap Hak Akses)

**3. Tidak ada aplikasi operasional untuk Guru, BK, Wali Kelas, Kaprodi, Kepala Sekolah, Siswa, Orang Tua, dan DUDI**
Seluruh fungsi inti sekolah yang dirancang dalam requirements — mencatat absensi, observasi siswa, menangani kasus disiplin, jurnal guru, komunikasi orang tua, melihat data PKL — hanya ada sebagai rancangan tertulis yang sangat rinci. Tidak ditemukan satu baris kode pun yang menjalankan aplikasi nyata untuk peran-peran ini. Satu-satunya yang benar-benar jadi adalah console Admin (setup, impor data, tutup semester/tahun ajaran).
Dampak nyata: begitu setup awal selesai dan sekolah siap "mulai operasional", tidak ada yang bisa dipakai guru, BK, atau siswa untuk pekerjaan sehari-hari mereka. Sistem ini, sebagaimana adanya sekarang, hanya menyiapkan data — belum bisa menjalankan sekolah.
Sumber: Level A — Tindak Lanjut; Level B — Audit Aktor; Level E — Audit 12 (Offline-First)

## Temuan HIGH (sangat disarankan fix sebelum launch)

**Kaprodi bisa mencatat prestasi untuk siswa dari program keahlian mana pun**
Seharusnya hanya untuk siswa di program keahliannya sendiri, sama seperti Wali Kelas yang sudah benar dibatasi untuk kelasnya. Dampak: catatan prestasi siswa bisa dibuat oleh Kaprodi yang tidak punya hubungan tanggung jawab dengan siswa itu.
Sumber: Level D — Audit 9 (Gap Hak Akses)

**Tidak ada catatan permanen siapa yang menutup semester atau membuka tahun ajaran baru**
Kedua aksi ini besar dan tidak bisa dibatalkan, tapi sistem tidak menyimpan jejak siapa pelakunya dan kapan. Dampak: jika di kemudian hari ada pertanyaan atau perselisihan soal kapan dan oleh siapa semester ditutup, tidak ada jawaban yang bisa dicek dari sistem.
Sumber: Level D — Audit 28 (Audit Trail)

**Seluruh keputusan menutup semester dan tahun ajaran sepenuhnya di tangan Admin, tanpa keterlibatan Kepala Sekolah**
Rancangan sekolah menggambarkan Kepala Sekolah ikut menentukan urusan ini, tapi console yang ada sama sekali tidak bisa diakses Kepala Sekolah. Dampak: aksi besar dan tidak bisa dibatalkan ini dijalankan sepihak oleh satu peran tanpa persetujuan dari pihak yang seharusnya terlibat.
Sumber: Level B — Audit Aktor & Workflow

**Peringatan sebelum menutup semester terlalu ringkas, tidak menyebutkan jumlah data yang akan terkunci**
Admin tidak diberi gambaran konkret (jumlah siswa, catatan, kasus terbuka) sebelum menekan tombol yang efeknya permanen. Dampak: Admin bisa menekan tombol tanpa benar-benar memahami skala dampaknya.
Sumber: Level B — Audit Workflow (Tutup Semester)

**Belum ada cara mengetahui siswa mana yang belum punya akun orang tua terhubung**
Informasi ini paling berguna untuk tindak lanjut Admin, tapi tidak ditampilkan di panel mana pun. Dampak: siswa tanpa akun orang tua aktif bisa tidak terdeteksi sampai ada keluhan dari pihak orang tua sendiri.
Sumber: Level C — Audit 8 (Audit Pelaporan)

**Pesan error saat periode akademik belum terdaftar membuat Admin macet total tanpa jalan keluar**
Pesan ini menyuruh Admin "membuat periode ini" tanpa ada cara melakukannya dari tampilan apa pun. Dampak: Admin terhenti total di tengah proses tutup semester tanpa tahu harus berbuat apa.
Sumber: Level F — Audit 21 (Audit Pesan Kesalahan)

**Tombol "Tambah Kelas" tidak punya status proses, berisiko membuat kelas ganda jika diklik dua kali**
Tidak ada penanda "sedang menyimpan" pada tombol ini, berbeda dari tombol-tombol lain di aplikasi yang sama yang sudah benar menanganinya. Dampak: Admin yang mengira klik pertama gagal bisa menambahkan kelas yang sama dua kali tanpa sadar.
Sumber: Level F — Audit 20 (Audit Tombol & Aksi)

**Klaim ketahanan data offline belum pernah diuji di kondisi nyata**
Karena aplikasi guru belum dibangun, seluruh rancangan "data tidak hilang saat koneksi putus" baru di atas kertas, belum dibuktikan bekerja di perangkat sungguhan. Dampak: begitu aplikasi guru dibangun, klaim ini wajib diuji ulang sebelum dipercaya, jangan dianggap sudah aman hanya karena rancangannya rapi.
Sumber: Level E — Audit 12 & 13 (Offline-First & Sinkronisasi)

**Warna teks pesan "sukses" dan "peringatan" gagal standar minimum keterbacaan**
Rasio kontrasnya hanya sekitar 3,1:1, jauh di bawah 4,5:1 yang dianggap aman, dan ini muncul berulang di seluruh aplikasi (setiap pesan sukses impor, setiap peringatan semester). Dampak: admin dengan penglihatan kurang tajam atau di ruangan terang akan kesulitan membaca pesan-pesan ini.
Sumber: Level G — Audit 25 (Audit Kontras)

**Peringatan untuk aksi besar dan tidak bisa dibatalkan tidak ditonjolkan secara visual**
Peringatan sebelum menutup semester dan membuka tahun ajaran baru ditulis dengan ukuran dan warna yang sama dengan teks keterangan biasa. Dampak: admin yang terburu-buru berisiko tidak benar-benar membaca peringatan ini sebelum menekan tombol yang efeknya permanen.
Sumber: Level F — Audit 16 & 27 (Hierarki Informasi); Level G — Audit 27 (Prioritas Visual)

**Warna tombol untuk aksi besar yang tidak bisa dibatalkan tidak konsisten berdasarkan tingkat risiko**
Tombol "Tutup Semester Sekarang" dan "Konfirmasi Kelulusan" memakai warna merah (tombol berbahaya), tapi tombol "Konfirmasi" yang membuka tahun ajaran baru — aksi yang levelnya setara atau lebih besar karena memproses kenaikan kelas seluruh sekolah sekaligus — memakai warna biru biasa seperti tombol aksi sehari-hari. Dampak: admin yang sudah belajar "warna merah berarti hati-hati, ini tidak bisa dibatalkan" tidak mendapat sinyal yang sama saat aksi setara muncul dengan warna netral.
Sumber: Audit 32 — Konsistensi Sistem (Konsistensi Pola Tombol)

## Temuan MEDIUM (bisa fix setelah launch)

**Guru bisa mencatat observasi siswa tanpa syarat penugasan mengajar aktif**
Berbeda dengan absensi yang sudah benar mensyaratkan penugasan aktif. Dampak: guru yang sudah tidak mengajar kelas tertentu masih bisa menambahkan catatan tentang siswa di kelas itu.
Sumber: Level D — Audit 9 (Gap Hak Akses)

**Tidak ada catatan permanen untuk setiap proses impor data massal**
Hasil impor hanya tampil sekali di layar, tidak tersimpan untuk ditinjau ulang nanti. Dampak: tidak ada cara mengecek "kapan dan oleh siapa data ini diimpor" di kemudian hari.
Sumber: Level D — Audit 28 (Audit Trail)

**Mekanisme anti-duplikat dan penanganan konflik yang matang baru ada untuk absensi**
Observasi, kasus siswa, dan jurnal guru — yang sama-sama wajib bisa dicatat offline — belum punya proses penerima data yang setara di sisi server. Dampak: begitu aplikasi guru dibangun, ketiga fitur ini berisiko mengalami masalah duplikasi/konflik yang sudah teratasi di absensi.
Sumber: Level E — Audit 13 (Audit Sinkronisasi)

**Data mitra DUDI yang sudah diimpor tidak bisa diverifikasi lewat dashboard sama sekali**
Hanya ada panel untuk mengimpor, tidak ada panel untuk melihat hasilnya. Dampak: Admin harus percaya proses impor berhasil tanpa cara memeriksanya.
Sumber: Level B — Audit Workflow; Level C — Audit 8 (Audit Pelaporan)

**Panel Jadwal Aktif dan Guru Pengganti hanya menampilkan 50 data terbaru tanpa pencarian, dan tidak menyertakan kolom penghubung ke kelas/guru terkait**
Untuk sekolah dengan jadwal satu semester penuh, ini jauh dari cukup untuk verifikasi menyeluruh. Dampak: Admin tidak bisa benar-benar memastikan seluruh data jadwal sudah benar.
Sumber: Level B — Audit Workflow; Level C — Audit 8; Level F — Audit 19 (Audit Tabel)

**Saat memetakan kenaikan kelas, jika kelas tujuan belum ada, Admin harus keluar dari wizard untuk membuatnya lalu kembali**
Memutus alur kerja yang seharusnya selesai dalam satu rangkaian. Dampak: proses tutup tahun ajaran jadi lebih lama dan rawan Admin lupa kembali menyelesaikan wizard.
Sumber: Level B — Audit Workflow

**Mengimpor ulang jadwal dengan koreksi jam mulai berpotensi menghasilkan sesi jadwal ganda**
Sistem mengenali "sesi yang sama" hanya lewat kombinasi jam mulai yang harus persis sama. Dampak: jadwal yang diperbaiki jamnya bisa menggandakan sesi, bukan menggantikannya.
Sumber: Level C — Audit 7 (Potensi Duplikasi)

**Aturan format tahun ajaran (YYYY/YYYY) tidak dipaksakan konsisten oleh sistem inti, hanya oleh sebagian kode aplikasi**
Dampak: celah kecil jika ada jalur input baru ditambahkan di masa depan tanpa menyalin aturan format yang sama.
Sumber: Level C — Audit 7 (Inkonsistensi Format)

**Konsol Admin secara desain hanya nyaman dipakai dari komputer, tidak ramah HP sama sekali**
Lembar gaya tampilannya secara eksplisit menyatakan "khusus desktop". Dampak: jika Admin perlu bertindak mendesak dari HP, hampir seluruh tampilan sulit dipakai.
Sumber: Level F — Audit 22 (Audit Mobile)

**Tombol "Konfirmasi" di langkah pembukaan tahun ajaran baru tidak menyebutkan aksinya secara spesifik**
Berbeda dari tombol-tombol lain di wizard yang sama yang labelnya jelas. Dampak: admin tidak langsung tahu apa yang sedang dikonfirmasi pada aksi yang justru paling berisiko.
Sumber: Level B — Audit Workflow; Level F — Audit 20 (Tombol & Aksi)

**Penggunaan kata "Impor" dan "Import" tercampur untuk konsep yang sama di berbagai tempat**
Dampak: kesan aplikasi kurang rapi, walau tidak membingungkan secara fungsional.
Sumber: Level F — Audit 14 (Audit Bahasa)

**Nilai status dan peran ditampilkan dalam format kode mentah ("WALI_KELAS", "AKTIF" dengan garis bawah dan huruf kapital semua), dan status siswa tidak memakai badge warna seperti status lain**
Dampak: tampilan kurang konsisten dan kurang nyaman dibaca, walau informasinya tetap tersampaikan lewat teks.
Sumber: Level F — Audit 14 & 19; Level G — Audit 24 & 28

**Warna merah dipakai untuk dua tingkat keseriusan yang sangat berbeda (pesan error kecil dan aksi besar tidak bisa dibatalkan) tanpa pembeda lain**
Dampak: admin yang terbiasa melihat banyak pesan error merah kecil berisiko kurang waspada saat warna yang sama dipakai untuk aksi jauh lebih berisiko.
Sumber: Level G — Audit 31 (Emosi Visual)

**Angka ringkasan hasil impor (Berhasil/Gagal/Konflik) ditampilkan tanpa pembeda warna**
Dampak: angka "Gagal" dan "Konflik" yang seharusnya segera ditindaklanjuti tidak lebih menarik perhatian dibanding angka lain.
Sumber: Level G — Audit 28 (Konsistensi Status)

**Beberapa kombinasi warna teks (error di atas latar merah muda, label keterangan di atas latar halaman) lolos standar kontras minimum dengan selisih sangat tipis**
Dampak: tidak ada ruang aman; perubahan kecil pencahayaan atau kualitas mata pengguna bisa membuatnya kurang nyaman dibaca.
Sumber: Level G — Audit 25 (Audit Kontras)

**Tanggal dan waktu ditampilkan dalam format teknis mentah di seluruh aplikasi, dan panel Guru Pengganti khususnya menampilkan cap waktu lengkap dengan jam-menit-detik dan kode zona waktu**
Dampak: admin harus menerjemahkan sendiri format ini setiap kali membaca tanggal, dan di panel Guru Pengganti informasi yang relevan (kapan akses diberikan) tenggelam di antara detail teknis yang tidak perlu.
Sumber: Audit 32 — Konsistensi Sistem (Konsistensi Format Tanggal)

**Nama aplikasi ini sendiri disebut dengan tiga cara berbeda ("Admin Console", "konsol admin", dan kata "administrator" yang tertukar dengan sebutan peran "Admin")**
Dampak: pengguna yang membaca pesan error bisa bingung apakah "administrator" yang dimaksud adalah dirinya sendiri atau pihak lain.
Sumber: Audit 32 — Konsistensi Sistem (Konsistensi Istilah)

**Tiga jenis kotak pembungkus konten utama (login, wizard, panel dashboard) memakai tiga ukuran jarak dalam yang berbeda untuk fungsi yang setara**
Dampak: kerapatan visual terasa sedikit berbeda antar bagian aplikasi tanpa alasan fungsional yang jelas.
Sumber: Audit 32 — Konsistensi Sistem (Konsistensi Layout)

## Temuan LOW (nice to have)

- Jika Admin mengganti file CSV sebelum menekan tombol impor, file sebelumnya hilang tanpa peringatan. Sumber: Level B — Audit Workflow.
- Lima dari sebelas tahap setup awal bersifat opsional tapi tetap harus dilewati satu per satu, tidak bisa dilompati sekaligus. Sumber: Level B — Audit Workflow.
- Tujuh tampilan data ringkas yang dirancang untuk dashboard Kepala Sekolah, portal siswa, dan riwayat kasus sudah disiapkan di tingkat sistem inti tapi belum dipakai oleh apa pun. Sumber: Level C — Audit 6 (Entitas Tidak Terpakai).
- Sesi jadwal yang dibatalkan karena guru tidak hadir tidak mewajibkan pengisian alasan pembatalan. Sumber: Level C — Audit 7 (Data Kosong yang Bermasalah).
- Panel Mata Pelajaran dan beberapa panel lain hanya menampilkan daftar tanpa informasi yang mengarahkan ke tindakan tertentu. Sumber: Level C — Audit 8 (Audit Pelaporan).
- Tidak ada peringatan dini saat sesi Admin akan habis di tengah pengisian formulir panjang. Sumber: Level D — Audit 11 (Session Management).
- Tidak ada catatan permanen untuk aktivitas login/logout ke console admin. Sumber: Level D — Audit 28 (Audit Trail).
- Data yang gagal terkirim berulang kali (saat aplikasi guru offline nanti dibangun) butuh pembersihan manual, dan Admin belum punya cara melihat statusnya. Sumber: Level E — Audit 12 (Penyimpanan Lokal).
- Tampilan awal dashboard tidak memberi gambaran fungsi dashboard secara keseluruhan untuk Admin baru. Sumber: Level F — Audit 23 (Audit 5-Detik).
- Dua wizard yang strukturnya identik memakai kata berbeda untuk konsep yang sama ("Tahap" vs "Langkah"). Sumber: Level F — Audit 14 (Audit Bahasa).
- Indikator tahap pada kedua wizard membedakan tahap "selesai" dan "sedang berjalan" hanya lewat warna, tanpa simbol tambahan seperti tanda centang. Sumber: Level G — Audit 26 (Aksesibilitas Warna).
- Tidak ada pengaturan khusus untuk hasil cetak — menu sidebar akan ikut tercetak dan tabel panjang tidak mengulang judul kolom di halaman berikutnya. Sumber: Level G — Audit 30 (Audit Cetak).

## Temuan yang Dikuatkan Lintas Level

| Temuan | Muncul di Level | Kesimpulan |
|---|---|---|
| Peringatan sebelum aksi besar dan tidak bisa dibatalkan (tutup semester, buka tahun ajaran) tidak cukup ditonjolkan — baik dari sisi isi peringatan, posisi/urutan informasi, maupun bobot visualnya | Level B (Audit Workflow), Level F (Hierarki Informasi), Level G (Prioritas Visual & Kontras) | Tiga audit dengan sudut pandang berbeda (alur kerja, struktur informasi, warna/visual) sampai pada kesimpulan yang sama secara independen — ini bukan kesan subjektif satu auditor, tapi masalah nyata yang konsisten dari berbagai sisi. Layak jadi prioritas perbaikan utama di luar tiga temuan CRITICAL. |
| Data mitra DUDI yang sudah diimpor tidak bisa dilihat/diverifikasi lewat dashboard sama sekali | Level B (Audit Workflow), Level C (Audit Pelaporan) | Dua audit berbeda (alur kerja dan kualitas data/pelaporan) menemukan kesenjangan yang sama. Memperkuat bahwa ini bukan kelalaian kecil, tapi kekosongan fitur yang nyata. |
| Panel Jadwal Aktif dan Guru Pengganti terlalu terbatas (50 data tanpa pencarian, tanpa kolom penghubung ke data terkait) untuk benar-benar memverifikasi data | Level B (Audit Workflow), Level C (Audit Pelaporan), Level F (Audit Tabel) | Ditemukan independen oleh tiga audit berbeda. Tingkat penguatan tertinggi di antara semua temuan lintas level — sangat layak diperbaiki meski levelnya MEDIUM, karena dampaknya berulang setiap kali Admin perlu memverifikasi data. |
| Tombol "Konfirmasi" di langkah pembukaan tahun ajaran baru labelnya kurang jelas dibanding tombol lain di wizard yang sama | Level B (Audit Workflow), Level F (Audit Bahasa & Tombol) | Ditemukan independen lewat dua sudut pandang berbeda (alur kerja dan keterbacaan UI). Perbaikannya sangat sederhana (ganti label) relatif terhadap tingkat penguatannya. |
| Status dan peran pengguna ditampilkan secara tidak konsisten — sebagian memakai badge berwarna, sebagian kode mentah tanpa warna sama sekali | Level F (Audit Bahasa & Tabel), Level G (Makna Warna & Konsistensi Status) | Ditemukan independen lewat audit bahasa/keterbacaan dan audit warna/visual. Memperkuat bahwa ini pola nyata, bukan satu kasus terisolasi. |

## Keputusan Domain yang Sudah Dikunci

| Keputusan | Alasan | Level sumber |
|---|---|---|
| Export Data dan Log Aktivitas disembunyikan dari UI sampai benar-benar diimplementasikan | Placeholder kosong tanpa fungsi nyata berisiko membingungkan pengguna — tampak ada fitur yang sebenarnya tidak bekerja | Level A |
| Indikator Kehadiran Guru diklasifikasikan WAJIB, bukan duplikat sistem presensi fingerprint | Fingerprint mendeteksi kehadiran fisik di sekolah; indikator ini mendeteksi apakah guru benar-benar masuk kelas sesuai jadwal mengajar — dua fungsi berbeda | Level A |
| UI operasional inti (absensi, observasi, kasus, jurnal, komunikasi orang tua) ditempatkan di dashboard aktor masing-masing, bukan di panel Admin | Di luar lingkup audit panel Admin ini — panel Admin hanya mengelola data master dan provisioning, bukan operasional harian | Level A |

## Urutan Fix yang Direkomendasikan

#1. Perbaiki relasi penugasan mengajar agar absensi siswa bisa dicatat guru
    Prioritas: CRITICAL
    Effort: Sedang
    Dependency: TIDAK ADA
    Keterangan: Ini akar masalah struktural yang memblokir fitur paling sering dipakai di seluruh sistem — harus selesai sebelum aplikasi guru dibangun di atasnya, agar tidak membangun di atas fondasi yang masih rusak.

#2. Perbaiki batasan akses Wali Kelas dan Kaprodi agar hanya melihat siswa di tanggung jawabnya
    Prioritas: CRITICAL
    Effort: Sedang
    Dependency: TIDAK ADA
    Keterangan: Pelanggaran privasi yang langsung terjadi begitu data siswa sungguhan dan akun staf nyata dipakai — tidak bergantung pada fitur lain, bisa dikerjakan paralel dengan #1.

#3. Perbaiki batasan akses Kaprodi untuk pencatatan prestasi sesuai program keahliannya
    Prioritas: HIGH
    Effort: Rendah
    Dependency: #2
    Keterangan: Memakai pola perbaikan yang sama dengan #2 (membatasi akses berdasarkan program keahlian) — lebih efisien dikerjakan sekaligus setelah pola perbaikannya sudah ditetapkan di #2.

#4. Tambahkan syarat penugasan mengajar aktif untuk pencatatan observasi siswa
    Prioritas: MEDIUM
    Effort: Rendah
    Dependency: #1
    Keterangan: Memakai data penugasan mengajar yang baru benar-benar berfungsi setelah #1 selesai diperbaiki.

#5. Bangun aplikasi operasional untuk Guru, BK, Wali Kelas, Kaprodi, Kepala Sekolah, Siswa, Orang Tua, dan DUDI
    Prioritas: CRITICAL
    Effort: Tinggi
    Dependency: #1, #2
    Keterangan: Pekerjaan terbesar di seluruh daftar ini. Harus menunggu #1 dan #2 selesai supaya aplikasi baru ini dibangun di atas fondasi data dan aturan akses yang sudah benar, bukan mewarisi dua masalah struktural yang sama.

#6. Tambahkan persetujuan atau keterlibatan Kepala Sekolah sebelum tutup semester/tahun ajaran dijalankan
    Prioritas: HIGH
    Effort: Sedang
    Dependency: TIDAK ADA
    Keterangan: Perbaikan pada console Admin yang sudah ada, tidak bergantung pada pembangunan aplikasi baru — bisa dikerjakan kapan saja.

#7. Catat permanen siapa dan kapan menutup semester/membuka tahun ajaran baru
    Prioritas: HIGH
    Effort: Rendah
    Dependency: TIDAK ADA
    Keterangan: Perbaikan kecil dan independen, sebaiknya digabung pengerjaannya dengan #6 karena menyentuh alur kerja yang sama.

#8. Perbaiki pesan error periode akademik yang belum terdaftar agar Admin tidak macet total
    Prioritas: HIGH
    Effort: Rendah
    Dependency: TIDAK ADA
    Keterangan: Perbaikan teks pesan saja, bisa dikerjakan kapan saja tanpa menunggu apa pun.

#9. Tambahkan status proses pada tombol "Tambah Kelas" dan tombol lain yang belum punya penanganan ini
    Prioritas: HIGH
    Effort: Rendah
    Dependency: TIDAK ADA
    Keterangan: Perbaikan kecil dan independen, cepat dikerjakan.

#10. Tonjolkan peringatan sebelum aksi besar dan tidak bisa dibatalkan secara visual, dan perbaiki kontras warna pesan sukses/peringatan
    Prioritas: HIGH
    Effort: Rendah
    Dependency: TIDAK ADA
    Keterangan: Ini temuan yang dikuatkan tiga audit berbeda (lihat bagian Temuan Lintas Level) — meski levelnya HIGH bukan CRITICAL, layak dikerjakan lebih dulu dari item MEDIUM lain karena tingkat penguatannya tinggi.

#11. Tambahkan penanda "belum punya akun orang tua" di panel Siswa/Orang Tua
    Prioritas: HIGH
    Effort: Rendah
    Dependency: TIDAK ADA
    Keterangan: Perbaikan tampilan data yang sudah ada, tidak butuh fitur baru.

#12. Bangun proses penerima data sinkronisasi untuk observasi dan kasus siswa, setara yang sudah ada untuk absensi
    Prioritas: MEDIUM
    Effort: Sedang
    Dependency: #5
    Keterangan: Hanya relevan dikerjakan bersamaan dengan atau tepat sebelum aplikasi guru offline (#5) mulai dipakai, supaya kedua sisi (aplikasi dan penerima data) selesai bersamaan.

#13. Tambahkan panel verifikasi data DUDI, dan perbaiki panel Jadwal Aktif/Guru Pengganti (pencarian + kolom penghubung)
    Prioritas: MEDIUM
    Effort: Sedang
    Dependency: TIDAK ADA
    Keterangan: Temuan yang dikuatkan paling banyak level (tiga audit independen) — layak diprioritaskan di antara item MEDIUM lain meski tidak mendesak seperti HIGH.

#14. Seragamkan istilah ("Impor"/"Import", "Tahap"/"Langkah"), perjelas label tombol "Konfirmasi", dan rapikan tampilan status/peran yang masih berupa kode mentah
    Prioritas: MEDIUM
    Effort: Rendah
    Dependency: TIDAK ADA
    Keterangan: Kumpulan perbaikan teks dan tampilan kecil yang bisa dikerjakan sekaligus dalam satu putaran pekerjaan karena sifatnya serupa.

#15. Tambahkan catatan permanen untuk hasil impor data dan aktivitas login/logout Admin
    Prioritas: MEDIUM/LOW
    Effort: Sedang
    Dependency: TIDAK ADA
    Keterangan: Sebaiknya dikerjakan bersamaan saat menu Log Aktivitas akhirnya benar-benar dibangun, karena keduanya akan jadi bagian dari fitur yang sama.

## Area yang Belum Diaudit

- **Seluruh dashboard aktor (Guru, BK, Wali Kelas, Kaprodi, Kepala Sekolah, Siswa, Orang Tua, DUDI)** belum diaudit pada ketujuh level di atas karena belum dibangun. Audit Level A sampai G perlu diulang khusus untuk aplikasi-aplikasi ini setelah dibangun — termasuk audit hak akses, privasi, UX, dan visual yang sama sekali belum bisa dilakukan tanpa kode nyata untuk diperiksa.
- **Mekanisme Sistem Alert (ABSENCE_HIGH, CONCERN_REPEATED, TEACHER_NO_RECORD)** — ditemukan satu tampilan data ringkas di tingkat sistem inti yang sepertinya ditujukan untuk ini (disebut di Level C sebagai salah satu dari tujuh tampilan data yang belum terpakai), tapi belum dikonfirmasi apakah logikanya benar-benar lengkap dan akan berfungsi sesuai rancangan begitu dashboard Kepala Sekolah/Kaprodi/BK dibangun. Perlu audit khusus saat itu terjadi.
- **Hak akses untuk peran Dinas Pendidikan** disebutkan di requirements (akses data agregat tanpa identitas individu) tapi tidak tercakup dalam matrix hak akses di Level D — peran ini sepertinya belum punya implementasi apa pun di sistem dan perlu audit akses tersendiri jika/saat dibangun.
- **Kemampuan ekspor data dan log aktivitas** — keduanya sudah diputuskan untuk disembunyikan sampai diimplementasikan (lihat Keputusan Domain), sehingga belum ada yang bisa diaudit dari sisi keamanan, privasi, atau UX untuk fitur ini. Perlu audit penuh begitu pembangunannya dimulai.
- **Pengujian langsung di perangkat nyata** untuk seluruh klaim kemampuan offline (Level E) — audit ini hanya bisa memeriksa rancangan dan kode yang ada, bukan menguji perilaku sungguhan di perangkat guru saat internet benar-benar mati, karena aplikasinya belum ada untuk diuji.
