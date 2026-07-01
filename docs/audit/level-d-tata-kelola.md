# Audit Level D — Tata Kelola
Tanggal audit awal: 24 Juni 2025
Pembaruan terakhir: 1 Juli 2026

## PEMBARUAN 1 Juli 2026

- **Gap Hak Akses #1 (Wali Kelas lihat semua siswa):** SELESAI — migration `20260701220000_rls_isolate_wali_kaprodi_students.sql` membatasi Wali Kelas hanya melihat siswa di kelasnya.
- **Gap Hak Akses #2 (Kaprodi lihat semua siswa + catat prestasi lintas program):** SELESAI — migration yang sama + `20260701230000_rls_isolate_kaprodi_pkl.sql` membatasi Kaprodi ke siswa program keahliannya sendiri.
- **Gap Hak Akses #3 (Guru catat observasi tanpa penugasan aktif):** Ditutup sebagai keputusan desain — observasi adalah hak prerogatif guru, tidak perlu dibatasi oleh penugasan aktif.
- **Matrix hak akses — catatan "tidak ada jalan nyata membuat penugasan":** Sudah tidak berlaku, lihat pembaruan Level C.

---

## Audit Hak Akses

### Matrix Hak Akses Aktual

| Data | Buat (Create) | Lihat (Read) | Ubah (Update) | Hapus (Delete) |
|---|---|---|---|---|
| Program keahlian, Mata pelajaran | Kepala Sekolah, Kaprodi | Semua pengguna yang sudah login | Kepala Sekolah, Kaprodi | Tidak ada satu peran pun yang bisa hapus |
| Kelas & Rombel | Admin | Semua pengguna yang sudah login | Admin | Tidak ada satu peran pun yang bisa hapus |
| Akun pengguna (data dasar) | (lewat proses impor Admin) | Guru, BK, Wali Kelas, Kaprodi, Kepsek, DUDI (lihat semua), masing-masing pemilik akun (lihat dirinya sendiri) | Masing-masing pemilik akun (data dirinya sendiri, tidak bisa ubah perannya sendiri) | Tidak ada satu peran pun yang bisa hapus |
| Data siswa | Kepala Sekolah, Kaprodi | Guru, BK, Wali Kelas, Kaprodi, Kepsek (lihat **semua** siswa), DUDI (hanya siswa PKL bimbingannya), Siswa (dirinya sendiri), Orang Tua (anaknya sendiri) | Kepala Sekolah, Kaprodi | Tidak ada satu peran pun yang bisa hapus |
| Absensi siswa | Guru/Wali Kelas (untuk kelas yang ditugaskan), Guru Pengganti (untuk sesi yang digantikan) | BK, Wali Kelas, Kaprodi, Kepsek (lihat semua), Siswa (dirinya sendiri, kecuali yang dibatalkan) | Sama dengan Buat | Tidak ada satu peran pun yang bisa hapus (dibatalkan, bukan dihapus) |
| Catatan observasi siswa | Guru, Wali Kelas, BK, Kaprodi, Kepsek | Guru, BK, Wali Kelas, Kaprodi, Kepsek (lihat semua termasuk yang bersifat internal), Siswa (hanya catatan yang ditandai boleh dilihat siswa, milik dirinya sendiri) | Tidak ada satu peran pun yang bisa ubah setelah dibuat | Tidak ada satu peran pun yang bisa hapus |
| Prestasi siswa | Wali Kelas (siswa di kelasnya), Kaprodi, Kepsek | Guru, BK, Wali Kelas, Kaprodi, Kepsek (lihat semua), Siswa (miliknya sendiri yang belum dibatalkan) | Kaprodi, Kepsek (hanya untuk membatalkan, bukan mengubah isi) | Tidak ada satu peran pun yang bisa hapus (dibatalkan, bukan dihapus) |
| Kasus siswa | Guru, Kepala Sekolah, DUDI | BK, Wali Kelas, Kaprodi, Kepsek (lihat semua), Guru/Wali Kelas (kasus yang pernah melibatkannya atau siswa di kelas yang diajarnya), DUDI (siswa PKL bimbingannya), Siswa (kasus miliknya sendiri) | Sistem secara otomatis (mengikuti riwayat penanganan, bukan diubah langsung oleh siapa pun) | Tidak ada satu peran pun yang bisa hapus |
| Riwayat penanganan kasus (komentar, eskalasi, keputusan) | Pemegang penanganan kasus saat itu (sesuai level/giliran), Kepala Sekolah (termasuk keputusan akhir) | Guru, BK, Wali Kelas, Kaprodi, Kepsek, DUDI (jika berhak lihat kasusnya), Siswa (hanya bagian yang ditandai boleh dilihat siswa) | Tidak bisa diubah setelah dicatat | Tidak bisa dihapus setelah dicatat |
| Pesan dengan orang tua | Orang Tua (mengirim), Guru/BK/Wali Kelas/Kaprodi/Kepsek (membalas) | Hanya pihak yang dituju secara spesifik pada pesan itu | Tidak ada satu peran pun yang bisa ubah | Tidak ada satu peran pun yang bisa hapus |
| Jurnal guru | Guru (untuk dirinya sendiri) | Hanya pemilik jurnal itu sendiri | Hanya pemilik | Hanya pemilik |
| Penugasan guru tetap & Jadwal mengajar | Kaprodi, Kepsek (lewat aturan akses) — *tapi lihat catatan di Audit Level C, tidak ada jalan nyata membuat data penugasan ini* | Guru, BK, Wali Kelas, Kaprodi, Kepsek | Kaprodi, Kepsek | Tidak ada satu peran pun yang bisa hapus |
| Guru pengganti | Kaprodi, Kepsek | Guru pengganti (hanya catatan dirinya sendiri) | Kaprodi, Kepsek | Tidak ada satu peran pun yang bisa hapus |
| Konfigurasi sekolah & Periode akademik | Admin, Kepsek (untuk konfigurasi sekolah); Admin saja (untuk periode akademik) | Semua pengguna yang sudah login | Sama dengan Buat | Tidak ada satu peran pun yang bisa hapus |

**EXPORT** — tidak ditemukan satu pun aturan akses khusus untuk "mengekspor data" sebagai aksi tersendiri. Fitur Export Data di dashboard memang belum dibangun (sudah dicatat di audit sebelumnya), sehingga pertanyaan "siapa boleh ekspor" belum relevan untuk sistem saat ini — yang ada hanyalah hak untuk membaca (read) data lewat tampilan biasa.

### Gap (ada di requirements, tidak di implementasi)

**Ditemukan 3 kesenjangan nyata antara rancangan awal dan kenyataan sistem:**

1. ~~**Wali Kelas seharusnya hanya melihat siswa di kelasnya sendiri, tapi sistem mengizinkan Wali Kelas melihat SEMUA siswa di sekolah**~~ → **✅ SELESAI** (1 Juli 2026): migration `20260701220000_rls_isolate_wali_kaprodi_students.sql` membatasi Wali Kelas hanya melihat siswa di kelasnya.
2. ~~**Kaprodi seharusnya hanya melihat siswa di program keahliannya sendiri, tapi sistem mengizinkan Kaprodi melihat SEMUA siswa di sekolah**~~ → **✅ SELESAI** (1 Juli 2026): migration yang sama + `20260701230000_rls_isolate_kaprodi_pkl.sql` membatasi Kaprodi ke program keahliannya, termasuk pencatatan prestasi.
3. ~~**Guru seharusnya hanya bisa mencatat observasi siswa saat penugasan mengajarnya masih aktif**~~ → **Ditutup sebagai keputusan desain** (1 Juli 2026): Observasi adalah hak prerogatif guru — berbeda dari absensi yang terikat sesi jadwal, observasi adalah penilaian profesional yang bisa muncul dari interaksi kapan saja, termasuk di luar kelas. Tidak membatasi observasi berdasarkan penugasan aktif adalah keputusan yang disengaja, bukan celah.

### Excess (ada di implementasi, tidak di requirements)
CLEAR — tidak ditemukan hak akses dalam sistem yang melebihi apa yang dimaksudkan dalam rancangan awal selain tiga kesenjangan di atas (yang sifatnya "kurang ketat", bukan "kelebihan akses yang baru/aneh"). Tidak ditemukan peran yang diberi akses ke data yang sama sekali tidak disebutkan kaitannya di rancangan awal.

### Konflik antar Policy
CLEAR — tidak ditemukan dua aturan akses yang saling bertentangan satu sama lain pada data yang sama. Semua data yang punya lebih dari satu aturan akses dirancang untuk saling melengkapi (misalnya: staf sekolah lihat semua siswa lewat satu aturan, sementara siswa lihat dirinya sendiri lewat aturan lain) — bukan dua aturan yang saling menyangkal.

## Audit Privasi

### Data Sensitif yang Ditemukan

| Data | Lokasi | Siapa yang bisa akses | Risiko privasi |
|---|---|---|---|
| Catatan observasi yang sifatnya internal sekolah (concern/catatan negatif tentang siswa) | Catatan observasi guru/BK | Guru, BK, Wali Kelas, Kaprodi, Kepsek (semua staf bisa lihat, termasuk yang bukan internal urusannya) — Siswa dan Orang Tua **tidak bisa** melihat ini sama sekali | Rendah untuk siswa/ortu (terlindungi dengan baik), tapi **semua staf bisa lihat semua catatan internal siswa mana pun**, tidak dibatasi berdasarkan apakah siswa itu memang di bawah tanggung jawabnya — konsisten dengan temuan kesenjangan Wali Kelas/Kaprodi di atas |
| Riwayat penanganan kasus disiplin/masalah siswa, termasuk bagian yang ditandai rahasia internal | Riwayat kasus dan catatan penanganannya | Staf sekolah yang berkepentingan (lihat semua bagian, termasuk bagian rahasia internal), Siswa (hanya bagian yang ditandai boleh dilihat siswa) | Terlindungi dengan baik untuk siswa — sistem secara ketat memblokir siswa dari bagian rahasia internal/diskusi antar staf/identitas pelapor, sesuai rancangan awal |
| Pesan dengan orang tua terkait kasus siswa | Pesan komunikasi orang tua | Hanya pihak yang secara spesifik dituju pada pesan itu | Terlindungi dengan baik — setiap pesan punya daftar penerima sendiri, bukan dibagi berdasarkan peran secara umum |
| Jurnal pribadi guru | Catatan jurnal guru | Hanya guru pemiliknya sendiri | Terlindungi penuh — tidak ada satu pun pihak lain (termasuk Kepala Sekolah) yang bisa membacanya |
| Status kelulusan dan riwayat akademik siswa | Data siswa | Staf sekolah (semua bisa lihat semua siswa — termasuk kesenjangan di atas), Orang Tua (anaknya sendiri), Siswa (dirinya sendiri) | Sedang — sama dengan temuan kesenjangan di atas, staf bisa lihat siswa di luar tanggung jawabnya |

**Catatan tentang siswa melihat catatan tentang dirinya:** sistem sudah dirancang dan diimplementasikan dengan baik untuk mencegah siswa melihat catatan yang seharusnya rahasia (internal sekolah atau rahasia penuh) — setiap catatan observasi dan setiap bagian riwayat kasus punya penanda "boleh dilihat siswa atau tidak", dan penanda ini **tidak bisa diubah setelah catatan dibuat**, sehingga tidak ada risiko catatan rahasia "bocor" ke tampilan siswa di kemudian hari.

**Catatan tentang orang tua:** orang tua hanya bisa melihat data anaknya sendiri dan pesan yang memang ditujukan kepadanya secara spesifik — tidak bisa melihat catatan observasi, kasus, atau detail akademik lain di luar itu. Ini sesuai dengan rancangan awal.

### Potensi Kebocoran Data
CLEAR untuk hal-hal teknis seperti kode yang menampilkan terlalu banyak kolom data — diperiksa setiap proses pengambilan data di console admin maupun di seluruh proses otomatis (impor data, sinkronisasi absensi), tidak ditemukan satu pun yang mengembalikan data sensitif yang tidak perlu (misalnya kontak pribadi guru/siswa, kode rahasia, atau detail penugasan guru pengganti) ke tampilan yang seharusnya tidak menampilkannya.

Risiko privasi yang ditemukan justru bukan soal "data apa yang ditampilkan", tapi soal "siapa yang bisa melihat data siapa" — yaitu kesenjangan Wali Kelas/Kaprodi yang sudah dibahas di atas. Itu sebabnya temuan itu dicatat di bagian Hak Akses dan diulang di sini sebagai isu privasi, karena dampaknya memang dua sisi: pelanggaran aturan akses sekaligus pelanggaran privasi siswa lintas kelas/jurusan.

## Audit Keamanan

### Autentikasi
- Seluruh halaman console admin (halaman utama, halaman setup awal, halaman tutup tahun ajaran) memang melakukan pengecekan login dan pengecekan peran (harus berperan Admin) sebelum menampilkan apa pun — dikonfirmasi langsung dari kode ketiga halaman tersebut. Jika dibuka tanpa login atau dengan akun bukan Admin, halaman langsung mengarahkan kembali ke halaman login.
- Tidak ditemukan halaman admin yang bisa diakses tanpa login sama sekali.
- Tidak ditemukan penanganan eksplisit untuk "sesi otomatis habis setelah waktu tertentu" di kode console admin — sistem mengandalkan mekanisme bawaan dari layanan otentikasi yang dipakai (yang memang punya batas waktu sesi default dan mekanisme perpanjangan otomatis), tapi tidak ada logika tambahan di kode admin yang secara eksplisit menangani kasus sesi habis dengan pesan yang jelas untuk Admin.

### Otorisasi
- Setiap proses otomatis di balik layar (impor data massal, sinkronisasi absensi, buka tahun ajaran baru) melakukan pengecekan identitas dan peran pengguna **di sisi server**, bukan hanya di tampilan — dikonfirmasi langsung dari kode setiap proses tersebut. Ini penting karena artinya seseorang tidak bisa memanggil proses ini secara langsung dari luar tampilan admin untuk melewati pengecekan peran.
- Tidak ditemukan satu pun operasi sensitif yang HANYA dicek di tampilan tanpa pengecekan ulang di sisi server — setiap operasi tulis data juga dijaga oleh aturan akses di tingkat sistem inti sebagai lapis pengaman kedua.
- Catatan terkait temuan di Audit Hak Akses: pengecekan peran di sisi server memang berjalan dengan benar, tapi pengecekan itu **tidak cukup detail** untuk tiga kesenjangan yang sudah disebutkan (Wali Kelas, Kaprodi, dan syarat penugasan aktif untuk Guru) — bukan soal "tidak dicek", tapi "dicek tapi terlalu longgar".

### Audit Trail

| Operasi | Ada jejak permanen? | Catatan |
|---|---|---|
| Komentar, eskalasi, penutupan, dan keputusan akhir pada kasus siswa | Ya | Tercatat permanen dan tidak bisa diubah/dihapus setelah dicatat, lengkap dengan siapa pelakunya dan kapan |
| Pencatatan absensi siswa | Ya | Tidak pernah dihapus, hanya bisa dibatalkan dengan alasan yang wajib diisi |
| Pencatatan observasi siswa | Ya | Tidak bisa diubah setelah dibuat, termasuk penanda visibilitasnya |
| Pencatatan dan pembatalan prestasi siswa | Ya | Tidak pernah dihapus, hanya dibatalkan dengan alasan yang wajib diisi |
| Pesan dengan orang tua | Ya | Tidak bisa diubah atau dihapus setelah dikirim |
| Aktivitas guru yang menjadi dasar indikator kehadiran guru | Ya | Tercatat otomatis oleh sistem, tidak bisa dibuat manual oleh siapa pun |
| Jurnal pribadi guru | Tidak — tapi memang sengaja privat | Tidak masuk riwayat resmi apa pun, sesuai rancangan (jurnal ini memang murni catatan pribadi) |
| **Login dan logout ke console admin** | **Tidak ditemukan jejak permanen** | Logout hanya menghapus sesi di sisi pengguna, tidak ditemukan pencatatan "siapa login/logout, kapan" yang bisa ditinjau kembali oleh siapa pun di dalam sistem ini |
| **Setiap proses impor data massal (siswa, guru, jadwal, dll)** | **Tidak ditemukan jejak permanen** | Hasil impor (berhasil/gagal) hanya ditampilkan sekali di layar saat itu juga — tidak disimpan untuk ditinjau ulang nanti (ini sejalan dengan menu "Log Aktivitas" yang memang belum diimplementasikan) |
| **Setiap penutupan semester dan pembukaan tahun ajaran baru** | **Tidak ditemukan jejak permanen yang menyebutkan siapa pelakunya** | Aksi ini hanya mengubah status data, tidak ada catatan "Admin X menutup semester pada tanggal Y" yang tersimpan untuk ditinjau kembali |

### Session Management
- Logout berfungsi dengan benar — menghapus sesi login dan mengarahkan kembali ke halaman login.
- Setiap proses otomatis di balik layar memang memeriksa keabsahan sesi pengguna sebelum mengerjakan apa pun, dan akan menolak permintaan jika sesi tidak valid.
- Tidak ditemukan penanganan eksplisit di kode untuk skenario "sesi habis di tengah pengisian formulir panjang" (misalnya di tengah wizard setup 11 tahap atau wizard tutup tahun ajaran) — Admin baru akan tahu sesinya habis saat mencoba menyimpan dan mendapat pesan gagal, bukan diperingatkan lebih awal.

## Temuan & Rekomendasi

**HIGH**
- Wali Kelas dan Kaprodi bisa melihat data SEMUA siswa di sekolah, bukan hanya siswa yang menjadi tanggung jawab mereka (kelasnya sendiri untuk Wali Kelas, program keahliannya sendiri untuk Kaprodi). Ini bertentangan dengan rancangan awal sekolah dan berdampak langsung pada privasi siswa — termasuk siswa bisa terekspos ke staf yang sebenarnya bukan urusannya. Rekomendasi: perbaiki aturan akses agar Wali Kelas hanya melihat siswa kelasnya, dan Kaprodi hanya melihat siswa program keahliannya, sebelum sistem dipakai dengan data siswa sungguhan.
- Kaprodi bisa mencatat prestasi untuk siswa dari program keahlian mana pun, bukan hanya program keahliannya sendiri — berbeda dengan Wali Kelas yang sudah benar dibatasi hanya untuk siswa kelasnya. Rekomendasi: terapkan pembatasan yang sama (sesuai program keahlian) untuk Kaprodi.
- Tidak ada catatan permanen tentang siapa yang menutup semester atau membuka tahun ajaran baru, padahal ini adalah aksi besar dan tidak bisa dibatalkan yang berdampak ke seluruh data sekolah. Jika di kemudian hari ada pertanyaan "siapa yang menutup semester ini dan kapan", tidak ada jawaban yang bisa dicek dari sistem. Rekomendasi: simpan catatan permanen siapa pelaku dan kapan setiap kali semester ditutup atau tahun ajaran baru dibuka.

**MEDIUM**
- Guru bisa mencatat observasi siswa tanpa syarat penugasan mengajar yang masih aktif, berbeda dengan absensi yang sudah benar mensyaratkan ini. Artinya seorang guru yang sudah tidak lagi mengajar kelas tertentu masih bisa menambahkan catatan tentang siswa di kelas itu. Rekomendasi: terapkan syarat penugasan aktif yang sama untuk observasi seperti yang sudah ada untuk absensi.
- Tidak ada catatan permanen untuk hasil setiap proses impor data massal (siswa, guru, jadwal). Jika ada pertanyaan di kemudian hari "kapan data ini diimpor dan siapa yang melakukannya", tidak ada jawaban yang bisa ditinjau ulang lewat sistem. Rekomendasi: simpan catatan ringkas (waktu, pelaku, jumlah berhasil/gagal) setiap kali proses impor selesai, terpisah dari menu Log Aktivitas yang lebih luas yang belum dikerjakan.

**LOW**
- Tidak ada peringatan dini saat sesi Admin akan habis di tengah pengisian formulir panjang (wizard setup, wizard tutup tahun ajaran) — Admin hanya akan tahu lewat pesan gagal saat mencoba menyimpan. Rekomendasi: tambahkan peringatan dini atau perpanjangan sesi otomatis khusus untuk proses-proses panjang ini, supaya Admin tidak kehilangan pekerjaan yang sedang dikerjakan.
- Tidak ditemukan catatan permanen untuk aktivitas login/logout ke console admin. Untuk sistem yang menyimpan data sensitif siswa, ini sebaiknya dicatat agar bisa ditinjau jika suatu saat ada kecurigaan akses yang tidak semestinya. Rekomendasi: pertimbangkan menyimpan catatan login (waktu dan akun) sebagai bagian dari rencana Log Aktivitas yang akan dikerjakan.
