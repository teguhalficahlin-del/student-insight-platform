# Audit Level B — Aktor & Workflow
Tanggal audit awal: 24 Juni 2025
Pembaruan terakhir: 1 Juli 2026

## PEMBARUAN 1 Juli 2026

- **Audit Aktor — Kepala Sekolah, Kaprodi, dan peran sekolah lain:** Kondisi "tidak bisa login ke mana pun" sudah tidak berlaku. Portal masing-masing sudah dibangun: `guru/` (Guru, Wali Kelas, BK, Kaprodi), `stakeholder/` (Kepsek, Waka), `student/`, `parent/`, `dudi/`. Audit aktor untuk portal-portal ini belum dilakukan secara formal.
- Audit workflow di bawah masih mencerminkan console Admin — relevan dan tidak perlu diubah.

---

## Audit Aktor

### Admin (operator console)
- Input: nama sekolah, tahun ajaran, semester aktif, seluruh data CSV (program keahlian, kelas, guru/staf, siswa, orang tua, mitra DUDI, jadwal mengajar), tanggal buka semester/tahun ajaran baru, pemetaan kenaikan kelas, pilihan siswa yang lulus.
- Output: ringkasan hasil setiap import (jumlah baris berhasil/gagal), daftar isi delapan jenis data lewat panel dashboard, ringkasan akhir setup dan ringkasan akhir tutup tahun ajaran.
- Keputusan: menentukan siswa mana yang lulus, menentukan pemetaan kelas asal ke kelas tujuan saat naik kelas, menentukan kapan semester/tahun ajaran ditutup dan dibuka.
- Nilai langsung: satu-satunya pihak yang bisa menyiapkan dan merapikan seluruh data dasar sekolah tanpa harus menulis apa pun langsung ke sistem inti — pekerjaan yang tadinya butuh keahlian teknis menjadi bisa dikerjakan lewat formulir dan unggah file.
- Risiko: Admin adalah satu-satunya pihak yang bisa membuka console ini — login dicek ketat, hanya akun dengan peran Admin yang bisa masuk (akun lain ditolak dan diarahkan kembali ke halaman login). Ini berarti seluruh beban input data dasar sekolah (ratusan siswa, puluhan guru, jadwal satu semester penuh) bertumpu pada satu peran saja. Jika Admin berhalangan atau akunnya bermasalah, tidak ada peran lain yang bisa membantu menyelesaikan setup atau tutup semester/tahun ajaran, padahal secara konsep sekolah biasanya berbagi tugas ini ke beberapa pihak (misalnya kaprodi mengurus data jurusannya sendiri, kepala sekolah menyetujui tutup semester).

### Kepala Sekolah, Kaprodi, dan peran sekolah lain (Guru, BK, Wali Kelas, Siswa, Orang Tua, DUDI)
> **Pembaruan 1 Juli 2026:** Deskripsi di bawah khusus untuk **console Admin** — memang benar semua peran ini tidak bisa masuk ke `admin/`. Namun sejak 2026 mereka masing-masing sudah punya portal sendiri (`guru/`, `stakeholder/`, `student/`, `parent/`, `dudi/`). Audit aktor untuk portal-portal tersebut belum dilakukan.

- Input: tidak ada — peran-peran ini tidak bisa login ke console admin ini sama sekali. Saat mencoba masuk, sistem langsung menolak dan mengarahkan kembali ke halaman login dengan pesan "akun ini tidak memiliki akses ke konsol admin".
- Output: tidak ada — mereka tidak melihat apa pun dari console ini secara langsung. Mereka hanya merasakan hasilnya secara tidak langsung (misalnya guru baru bisa login ke sistem lain setelah Admin mengimpor datanya, siswa baru muncul di kelas setelah Admin selesai memetakan kenaikan kelas).
- Keputusan: tidak ada keputusan yang bisa diambil lewat console ini, walaupun beberapa dari peran ini (Kepala Sekolah, Kaprodi) seharusnya ikut menentukan urusan seperti penutupan semester atau pembukaan tahun ajaran baru menurut gambaran tugas mereka di rancangan awal sistem.
- Nilai langsung: tidak langsung — nilai yang mereka terima adalah hasil kerja Admin (akun mereka aktif, data kelas/siswa rapi, jadwal tersedia), bukan dari interaksi mereka sendiri dengan console ini.
- Risiko: ditemukan kesenjangan antara rancangan peran dan kenyataan akses. Kepala Sekolah dan Kaprodi digambarkan punya tanggung jawab atas penutupan semester, tahun ajaran, dan beberapa data jurusan, tetapi pada kenyataannya console ini sama sekali tidak bisa diakses oleh mereka — semua tindakan itu jatuh ke Admin. Ini berarti keputusan yang seharusnya melibatkan Kepala Sekolah (misalnya menutup semester, yang berdampak besar dan tidak bisa dibatalkan) malah dijalankan sepenuhnya oleh Admin tanpa keterlibatan langsung Kepala Sekolah di sistem ini.

## Audit Workflow

### 1. Setup awal sekolah (wizard 11 tahap)
- Jumlah langkah: 11 tahap, dengan total sekitar 25–35 aksi klik/isi (asumsi tahap yang sifatnya opsional dilewati, dan file CSV sudah disiapkan sebelumnya).
- Alur: Data Sekolah → Program Keahlian → Kelas & Rombel → Import Kepala Sekolah (opsional) → Import Kaprodi (opsional) → Import Wali Kelas (opsional) → Import Guru (wajib) → Import BK (opsional) → Import Siswa & Orang Tua (siswa wajib, orang tua opsional) → Import DUDI (opsional) → Verifikasi Final.
- Bottleneck: lima dari sebelas tahap bersifat opsional (Kepala Sekolah, Kaprodi, Wali Kelas, BK, DUDI) dan diberi label "dapat dilewati", tapi alurnya tetap mengharuskan Admin melewati tahap-tahap itu satu per satu sebelum mencapai tahap berikutnya — tidak ada cara melompati beberapa tahap opsional sekaligus. Selain itu, jika Admin keluar dari halaman saat sedang melihat pratinjau file CSV (sebelum menekan tombol impor), file yang sudah dipilih akan hilang dan harus diunggah ulang dari awal.
- Rekomendasi: gabungkan tahap-tahap opsional (Kepala Sekolah, Kaprodi, Wali Kelas, BK) menjadi satu tahap "Import Staf Sekolah" dengan beberapa kotak unggah file sekaligus, supaya Admin tidak perlu klik "Lanjut" lima kali hanya untuk tahap-tahap yang sering dilewati. Tambahkan juga peringatan kecil saat Admin berpindah tahap padahal ada file yang sudah dipilih tapi belum diimpor, supaya tidak ada pekerjaan yang hilang tanpa disadari.

### 2. Import data CSV per entitas (programs, classes, users, students, parents, dudi, schedules)
- Jumlah langkah: 3–4 aksi per jenis data — pilih file, lihat pratinjau (otomatis muncul, tidak perlu diklik), tekan tombol "Impor Data", lalu lihat hasil (berhasil/gagal per baris).
- Alur: Pilih file CSV → pratinjau muncul otomatis → tekan "Impor Data" → sistem memproses dan menampilkan ringkasan (jumlah baris berhasil, gagal, dan rincian baris yang gagal jika ada).
- Bottleneck: jika Admin mengunggah ulang file baru sebelum menekan "Impor Data" pada file sebelumnya, file lama langsung diganti tanpa peringatan apa pun — berisiko Admin tidak sadar data yang seharusnya diimpor batal diunggah. Untuk file dengan banyak baris (misalnya ratusan siswa), tidak ada indikator proses (hanya teks tombol berubah jadi "Mengimpor...") sehingga pada koneksi internet sekolah yang lambat, Admin bisa mengira sistem macet dan mencoba menekan tombol berulang kali.
- Rekomendasi: tambahkan peringatan singkat saat file baru dipilih menggantikan file yang belum diimpor. Tambahkan juga indikator progres yang lebih jelas (misalnya jumlah baris yang sudah diproses) untuk impor dengan banyak baris, supaya Admin tidak salah kira sistem berhenti merespons.

### 3. Tutup Semester
- Jumlah langkah: bervariasi sesuai kondisi semester saat ini — 3–5 aksi untuk menutup semester yang sedang aktif, 3–5 aksi untuk membuka semester berikutnya setelah semester pertama ditutup, dan 1 aksi (klik tautan) untuk lanjut ke Wizard Tutup Tahun Ajaran setelah semester kedua ditutup.
- Alur: Lihat ringkasan semester aktif → tekan "Tutup Semester Sekarang" → muncul jendela konfirmasi → semester ditutup dan terkunci → (jika semester pertama) isi tanggal mulai-selesai semester kedua → tekan "Buka Semester 2 Sekarang" → muncul jendela konfirmasi → semester kedua aktif. Setelah semester kedua juga ditutup, satu-satunya langkah berikutnya adalah membuka Wizard Tutup Tahun Ajaran.
- Bottleneck: tombol untuk menutup semester berlabel "Tutup Semester [angka] Sekarang" — kata "Sekarang" bisa terasa seolah aksi langsung terjadi begitu ditekan, padahal sebenarnya masih ada satu jendela konfirmasi sebelum aksi benar-benar dijalankan. Penutupan semester ini sifatnya mengunci data absensi, catatan observasi, dan jurnal guru pada periode tersebut secara permanen — sekali ditutup, semua data periode itu tidak bisa diubah lagi siapa pun, tapi tidak ada penjelasan rinci soal ini ditampilkan kepada Admin sebelum dia menekan tombol, hanya ringkasan singkat.
- Rekomendasi: perjelas kalimat peringatan sebelum penutupan semester, sebutkan secara eksplisit bahwa data absensi/observasi/jurnal periode itu akan terkunci permanen dan tidak ada cara membatalkannya. Pertimbangkan menambah satu langkah ringkasan terakhir ("Anda akan menutup Semester 1 Tahun Ajaran 2025/2026 — X siswa, Y catatan absensi, Z kasus terbuka akan terkunci. Lanjutkan?") sebagai jendela konfirmasi pengganti window konfirmasi standar browser yang polos.

### 4. Tutup Tahun Ajaran (wizard 5 tahap)
- Jumlah langkah: 5 tahap, total sekitar 16–25 aksi. Tahap 1 (review siswa kelas XII) hanya 1 aksi (lihat lalu lanjut), Tahap 2 (kelulusan massal) 3–5 aksi, Tahap 3 (kenaikan kelas) 5–7 aksi, Tahap 4 (buka tahun ajaran baru) 4–6 aksi, Tahap 5 (ringkasan) 1 aksi.
- Alur: Review siswa kelas XII → tandai siswa yang lulus (semua tertandai lulus secara default, Admin hanya menghapus tanda untuk yang tidak lulus) → konfirmasi kelulusan → petakan setiap kelas lama ke kelas baru untuk siswa yang naik kelas → konfirmasi kenaikan kelas → isi tanggal mulai-selesai tahun ajaran baru → konfirmasi buka tahun ajaran baru → lihat ringkasan akhir.
- Bottleneck: Tahap 3 (kenaikan kelas) mengharuskan kelas tujuan untuk tahun ajaran baru sudah ada lebih dulu — jika belum ada, kelas itu ditandai merah dan Admin harus keluar dari wizard ini, pergi ke panel lain untuk membuat kelas baru, baru kembali melanjutkan wizard. Ini memotong alur kerja yang seharusnya berurutan jadi harus bolak-balik antar halaman. Selain itu, tombol konfirmasi di Tahap 4 hanya berlabel "Konfirmasi" tanpa menyebutkan apa yang dikonfirmasi — berbeda dengan Tahap 2 dan 3 yang labelnya jelas ("Konfirmasi Kelulusan", "Konfirmasi Kenaikan Kelas").
- Rekomendasi: saat Tahap 3 mendeteksi kelas tujuan belum ada, tawarkan opsi membuat kelas baru langsung dari dalam wizard (form singkat di tempat) tanpa harus keluar dan kembali. Ganti label tombol Tahap 4 menjadi "Buka Tahun Ajaran Baru" agar konsisten dan jelas, mengingat tahap ini adalah aksi yang besar dan tidak bisa dibatalkan.

### 5. Verifikasi data via dashboard
- Jumlah langkah: 8 klik panel terpisah untuk melihat 8 dari 9 jenis data yang dikelola (program, kelas, mata pelajaran, guru/staf, siswa, orang tua, jadwal mengajar, guru pengganti) — satu klik per jenis data, tidak bisa dilihat sekaligus dalam satu tampilan.
- Alur: klik nama panel di menu samping → tabel data jenis itu muncul → klik panel lain untuk jenis data berikutnya, dan seterusnya.
- Bottleneck: data mitra DUDI yang sudah diimpor tidak punya tampilan daftar sama sekali — panelnya hanya berisi formulir untuk mengimpor, tidak ada cara melihat daftar DUDI yang sudah masuk lewat dashboard ini. Selain itu, tampilan jadwal mengajar dan daftar guru pengganti dibatasi hanya menampilkan 50 data terbaru, tanpa cara melihat data yang lebih lama atau mencari data tertentu — untuk sekolah dengan jadwal satu semester penuh, ini jauh dari cukup untuk benar-benar memverifikasi semua data sudah masuk dengan benar.
- Rekomendasi: tambahkan panel daftar baca untuk data DUDI, setara dengan panel data lain. Tambahkan juga kemampuan mencari/menyaring dan melihat halaman berikutnya pada panel jadwal mengajar dan guru pengganti, supaya Admin benar-benar bisa memverifikasi seluruh data satu semester, bukan hanya 50 entri terakhir.

## Audit Beban Operasional

| Workflow | Estimasi Waktu | Frekuensi/Semester | Total Beban/Semester | Catatan |
|---|---|---|---|---|
| Setup awal sekolah (11 tahap) | 1–2 jam (sekali jalan, termasuk waktu menyiapkan file CSV di luar sistem dan mengulang jika ada baris gagal karena koneksi tidak stabil) | 1x (hanya sekali seumur sistem) | 1–2 jam | Beban besar tapi satu kali saja — bukan beban berulang |
| Import data CSV per entitas | 10–20 menit per jenis data (termasuk menyiapkan file dan memperbaiki baris yang gagal) | 1–3x per semester (siswa baru, guru baru, jadwal baru) | 1–2 jam | Beban berulang ringan, kecuali saat awal tahun ajaran (siswa + jadwal bersamaan bisa naik jadi setengah hari) |
| Tutup Semester | 15–30 menit (termasuk membaca ringkasan, menutup, lalu mengisi tanggal semester berikutnya) | 2x | 30–60 menit | Singkat tapi berisiko tinggi karena tidak bisa dibatalkan setelah dijalankan |
| Tutup Tahun Ajaran (5 tahap) | 1–3 jam (tergantung jumlah siswa kelas XII dan jumlah kelas yang perlu dipetakan; bertambah jika ada kelas tujuan yang belum dibuat dan Admin harus bolak-balik membuatnya) | 1x | 1–3 jam | Beban tahunan terbesar — jika kelas tujuan belum disiapkan lebih dulu, waktunya bisa membengkak signifikan |
| Verifikasi data via dashboard | 20–40 menit (8 panel, masing-masing perlu diperiksa manual karena tidak ada pencarian/penyaringan untuk sebagian besar data) | Sesering dibutuhkan, realistis 4–8x per semester (setiap kali ada import baru) | 2–5 jam | Beban kumulatif terbesar dalam satu semester karena dilakukan berulang setiap kali ada perubahan data |

**Workflow yang terlalu panjang relatif terhadap frekuensinya:** Setup awal sekolah (11 tahap, ~25-35 aksi) hanya dijalankan satu kali, sehingga investasi waktu di awal itu wajar dan tidak perlu dipersingkat lebih jauh. Yang lebih perlu diperhatikan adalah Verifikasi data via dashboard — meski tiap kunjungan singkat, totalnya menjadi beban terbesar dalam satu semester karena dilakukan berulang kali dan tidak ada cara mencari/menyaring data pada sebagian panel.

**Langkah manual yang bisa diotomasi:**
- Pemberitahuan otomatis ke Admin saat ada baris CSV yang gagal diimpor, alih-alih Admin harus membuka tabel hasil dan membaca satu per satu.
- Pembuatan kelas tujuan otomatis saat Tahap 3 Tutup Tahun Ajaran mendeteksi kelas itu belum ada, daripada Admin harus keluar wizard untuk membuatnya secara manual.
- Pencarian dan penyaringan otomatis pada panel jadwal mengajar dan guru pengganti, alih-alih Admin menelusuri manual di antara 50 baris terbatas.

## Temuan & Rekomendasi

**HIGH**
- Seluruh proses penutupan semester dan tahun ajaran — yang dampaknya besar dan tidak bisa dibatalkan — sepenuhnya berada di tangan satu peran (Admin), padahal secara tugas sekolah biasanya keputusan ini melibatkan Kepala Sekolah. Tidak ada cara bagi peran lain untuk ikut menyetujui atau sekadar melihat sebelum aksi ini dijalankan. Rekomendasi: pertimbangkan menambahkan langkah persetujuan dari Kepala Sekolah sebelum penutupan semester/tahun ajaran benar-benar dijalankan, atau setidaknya beri Kepala Sekolah akses lihat-saja untuk meninjau sebelum Admin menekan tombol final.
- Penutupan semester mengunci data secara permanen, tapi peringatan yang ditampilkan kepada Admin sebelum aksi ini terlalu ringkas dan tidak menyebutkan secara spesifik berapa banyak data yang akan terkunci. Rekomendasi: tambahkan ringkasan rinci (jumlah siswa, jumlah catatan, jumlah kasus terbuka) tepat sebelum tombol penutupan ditekan.

**MEDIUM**
- Saat memetakan kenaikan kelas di Tutup Tahun Ajaran, jika kelas tujuan belum dibuat, Admin harus keluar dari proses, membuat kelas di tempat lain, lalu kembali — memutus alur kerja yang seharusnya selesai dalam satu rangkaian. Rekomendasi: izinkan pembuatan kelas baru langsung dari dalam wizard ini.
- Data mitra DUDI yang sudah diimpor tidak bisa dilihat lagi lewat dashboard — hanya bisa diimpor, tidak bisa diverifikasi. Rekomendasi: tambahkan tampilan daftar DUDI yang setara dengan jenis data lain.
- Panel jadwal mengajar dan guru pengganti hanya menampilkan 50 data terbaru tanpa kemampuan mencari data lain, sehingga Admin tidak bisa benar-benar memastikan seluruh jadwal satu semester sudah benar. Rekomendasi: tambahkan kemampuan mencari dan melihat data selanjutnya.

**LOW**
- Jika Admin mengganti file CSV yang sudah dipilih sebelum menekan tombol impor, file sebelumnya hilang tanpa peringatan. Rekomendasi: tambahkan peringatan singkat saat ini terjadi.
- Tombol konfirmasi di tahap "buka tahun ajaran baru" hanya berlabel "Konfirmasi" tanpa menyebut apa yang dikonfirmasi, berbeda dari tahap-tahap lain yang labelnya jelas. Rekomendasi: ganti jadi label yang menyebutkan aksinya secara spesifik, misalnya "Buka Tahun Ajaran Baru".
- Lima dari sebelas tahap setup awal bersifat opsional tapi tetap harus dilewati satu per satu. Rekomendasi: gabungkan tahap-tahap opsional yang sejenis (import staf) menjadi satu tahap dengan beberapa kotak unggah file sekaligus.
