# Audit Level F — Keterbacaan & UX
Tanggal: 24 Juni 2025

## Audit Bahasa

### Istilah Teknis yang Lolos ke UI

| Teks asli | Lokasi | Saran pengganti |
|---|---|---|
| "Mengubah tahun ajaran aktif memengaruhi seluruh jadwal dan absensi baru. Fitur rollover lengkap (kenaikan kelas otomatis) belum diimplementasikan — ubah `school_config.current_academic_year` secara manual untuk saat ini." | Panel "Tahun Ajaran Baru" di dashboard | Hilangkan nama kolom database sama sekali dari tampilan. Ganti jadi: "Fitur ini belum lengkap. Untuk mengubah tahun ajaran secara manual, gunakan Wizard Tutup Tahun Ajaran." |
| "Periode akademik aktif ({tahun} semester {semester}) belum terdaftar di `academic_periods`. Buat periode ini terlebih dahulu sebelum semester dapat ditutup." | Pesan error di panel Tutup Semester | "Periode akademik untuk {tahun} semester {semester} belum dibuat di sistem. Hubungi tim teknis untuk membuat periode ini sebelum semester bisa ditutup." |
| "Identifier (NIP / NIK)" | Halaman login | "Nomor Identitas (NIP atau NIK)" — kata "Identifier" tidak perlu dipertahankan karena sudah ada penjelasan dalam kurung |
| "Tahap 10 dari 11" + hint "DUDI (Dunia Usaha/Industri) login dengan nama usaha, bukan NIK" | Setup wizard tahap 10 | Sudah cukup jelas dengan kepanjangan disebutkan — pertahankan, tidak perlu diubah |
| Label kolom tabel: "Role" (Daftar Pengguna) | Dashboard, panel Guru & Staf | Ganti jadi "Peran" — satu-satunya kolom tabel yang masih memakai istilah Inggris murni, sementara kolom lain di tabel yang sama ("Nama", "Status") sudah dalam Bahasa Indonesia |
| Nilai isi kolom "Role" dan "Status" yang ditampilkan mentah seperti "WALI_KELAS", "ADMINISTRATIVE", "AKTIF" (huruf besar dengan garis bawah) | Tabel Daftar Pengguna, Siswa, dan beberapa tempat lain di dashboard | Tampilkan dalam bentuk yang lebih wajar dibaca, misalnya "Wali Kelas", "Admin", "Aktif" — bukan kode mentah dengan garis bawah dan huruf kapital semua |

### Inkonsistensi Istilah

| Istilah A | Istilah B | Lokasi | Yang Benar |
|---|---|---|---|
| "Impor Data" (label tombol di semua proses unggah CSV) | "Import Orang Tua", "Import DUDI", "Import Jadwal Baru" (label menu di sidebar dashboard, dan judul tahap setup seperti "Import Kepala Sekolah") | Tombol vs menu/judul tahap di seluruh aplikasi | Tidak konsisten — kata kerja yang sama ditulis "Impor" (sudah Indonesia) di satu tempat dan "Import" (masih Inggris) di tempat lain untuk hal yang sama persis. Sebaiknya seragamkan jadi "Impor" di semua tempat |
| "Tahap" (dipakai di Setup Wizard: "Tahap 1 dari 11") | "Langkah" (dipakai di Wizard Tutup Tahun Ajaran: "Langkah 1 dari 5") | Dua wizard berbeda di aplikasi yang sama | Kedua wizard ini punya bentuk dan pola yang sama (rangkaian tahap dengan tombol Lanjut/Kembali), tapi memakai kata berbeda untuk konsep yang identik. Pilih salah satu ("Langkah" lebih umum dipahami) dan pakai konsisten di kedua wizard |
| "Kembali" + "Lanjut" (navigasi antar tahap di kedua wizard) | "Konfirmasi Kelulusan", "Konfirmasi Kenaikan Kelas", "Konfirmasi" (tombol aksi di dalam tahap Wizard Tutup Tahun Ajaran) | Wizard Tutup Tahun Ajaran | Bukan inkonsistensi yang salah — ini memang dua jenis tombol berbeda (navigasi vs aksi penyimpanan data). Tapi tombol "Konfirmasi" saja (Langkah 4) kurang jelas dibandingkan "Konfirmasi Kelulusan" dan "Konfirmasi Kenaikan Kelas" yang sudah jelas — dibahas lebih detail di bagian Tombol & Aksi |

### Instruksi Ambigu

| Teks | Lokasi | Masalah | Saran |
|---|---|---|---|
| "Pilih menu di samping untuk mulai." | Tampilan awal dashboard sebelum panel apa pun dipilih | Tidak menjelaskan tujuan keseluruhan dashboard ini untuk apa — admin baru pertama kali masuk tidak tahu dashboard ini untuk mengelola apa secara garis besar | Tambahkan kalimat singkat di awal, misalnya "Dashboard ini untuk mengelola data sekolah, melihat data yang sudah diimpor, dan mengatur semester/tahun ajaran. Pilih menu di samping untuk mulai." |
| "DUDI (Dunia Usaha/Industri) login dengan nama usaha, bukan NIK — supervisi siswa PKL." | Setup wizard tahap 10 | Kalimat ini menggabungkan dua informasi berbeda (cara login DUDI dan fungsi DUDI mengawasi siswa PKL) dalam satu kalimat yang dipisah tanda pisah, terasa seperti catatan teknis ditempel, bukan instruksi yang mengalir | Pisah jadi dua kalimat: "DUDI adalah mitra Dunia Usaha/Industri yang membimbing siswa PKL. Akun DUDI login menggunakan nama usaha, bukan NIK." |
| "Konfirmasi" (tombol di Langkah 4 Wizard Tutup Tahun Ajaran — "Buka Tahun Ajaran Baru") | Wizard Tutup Tahun Ajaran | Tidak jelas apa yang sedang dikonfirmasi hanya dari label tombolnya — berbeda dari tombol-tombol lain di wizard yang sama yang sudah jelas menyebutkan aksinya | Ganti jadi "Buka Tahun Ajaran Baru" — sama dengan judul tahapnya, supaya konsisten dan jelas |

## Audit Beban Kognitif

| Halaman | Jumlah elemen | Jumlah keputusan | Penilaian |
|---|---|---|---|
| Halaman login | 2 isian + 1 tombol = 3 elemen | 1 keputusan (isi identitas dan password, lalu masuk) | **Ringan** — sudah sangat sederhana, sesuai untuk halaman login |
| Dashboard utama (tampilan awal sebelum pilih menu) | 15 tautan menu + 1 tombol keluar = 16 elemen sekaligus terlihat di sisi kiri | 1 keputusan inti ("menu mana yang saya butuhkan sekarang"), tapi dari 15 pilihan tanpa penjelasan singkat di masing-masing menu | **Sedang** — 15 pilihan menu sekaligus tanpa deskripsi cukup banyak untuk admin baru yang belum familiar dengan struktur menu, meskipun dikelompokkan rapi dalam 4 kelompok |
| Setup Wizard tahap 1 (Data Sekolah) | 3 isian + 1 tombol lanjut = 4 elemen | 3 keputusan kecil (nama sekolah, format tahun ajaran, pilih semester) | **Ringan** |
| Setup Wizard tahap 3 (Kelas & Rombel) | hingga 4 isian + 3 tombol + 2 tabel = 9 elemen sekaligus (tabel kelas yang sudah ada + form tambah kelas manual + area unggah CSV) | 2 keputusan jalur berbeda (pakai CSV atau isi manual satu per satu) ditampilkan bersamaan di satu layar | **Sedang** — dua cara mengerjakan tugas yang sama (CSV vs manual) ditampilkan sekaligus di satu layar bisa membingungkan, mana yang sebaiknya dipakai tidak dijelaskan |
| Setup Wizard tahap CSV biasa (4-8, 10) | 1 isian (file) + 2 tombol + 1 tabel pratinjau = 4 elemen | 1 keputusan inti (unggah file yang benar) | **Ringan** |
| Setup Wizard tahap 9 (Siswa + Orang Tua) | 2 isian file + 4 tombol + 2 tabel pratinjau = 8 elemen, dua proses impor berbeda dalam satu tahap | 2 keputusan terpisah (impor siswa wajib, impor orang tua opsional) ditampilkan sekaligus | **Sedang** — menggabungkan dua proses impor independen dalam satu tahap menambah kepadatan visual, walau secara logis keduanya terkait |
| Halaman Import CSV (pola umum di seluruh aplikasi) | 1 isian + 2 tombol + 1 tabel pratinjau + ringkasan hasil setelah impor (hingga 4 angka statistik + tabel error) = 4-9 elemen tergantung hasil | 1 keputusan inti, tapi banyak informasi hasil yang muncul sekaligus setelah impor selesai | **Ringan sampai Sedang** — ringan sebelum impor, bertambah padat setelah impor jika ada banyak baris gagal yang perlu ditinjau satu per satu |
| Halaman Tutup Semester (kondisi semester aktif) | 3 angka ringkasan + 1 peringatan + 1 tombol = 5 elemen | 1 keputusan besar dan tidak bisa dibatalkan (menutup semester) | **Sedang** — jumlah elemen sedikit, tapi bobot keputusannya besar karena tidak bisa dibatalkan, sehingga beban mentalnya lebih tinggi dari jumlah elemen yang terlihat |
| Halaman Tutup Semester (kondisi buka semester baru) | 2 isian tanggal + 1 tombol + (setelah berhasil) daftar checklist 6 item tugas lanjutan = 3-9 elemen | 1 keputusan inti (tanggal sudah benar?), ditambah daftar pekerjaan lanjutan yang harus diingat sendiri oleh admin | **Sedang** — checklist 6 item pekerjaan lanjutan ditampilkan sekali lalu admin harus mengingatnya sendiri, tidak ada cara menandai sudah selesai atau belum |
| Wizard Tutup Tahun Ajaran Langkah 2 (Kelulusan Massal) | 1 tabel dengan kotak centang per siswa (bisa puluhan/ratusan baris) + 3 tombol = berpotensi sangat banyak elemen sekaligus | 1 keputusan per siswa (lulus atau tidak), dikali jumlah siswa kelas XII | **Berat** — untuk sekolah dengan banyak siswa kelas XII, satu layar berisi puluhan kotak centang yang masing-masing adalah keputusan individual, tanpa pengelompokan per kelas untuk memudahkan peninjauan |
| Wizard Tutup Tahun Ajaran Langkah 3 (Kenaikan Kelas) | 1 tabel dengan dropdown per kelas asal (biasanya belasan baris) + 3 tombol = belasan elemen pilihan | 1 keputusan per kelas (kelas tujuan yang benar), dikali jumlah kelas yang naik | **Sedang sampai Berat** — tergantung jumlah kelas, tapi sudah dibantu sistem dengan saran otomatis sehingga sebagian keputusan tinggal dikonfirmasi, bukan dipilih dari awal |
| Wizard Tutup Tahun Ajaran Langkah 4 (Buka Tahun Ajaran Baru) | 4 isian + 1 tombol = 5 elemen | 2 keputusan (tahun ajaran benar, rentang tanggal benar), keduanya sudah terisi otomatis sehingga tinggal dicek | **Ringan** |

## Audit Hierarki Informasi

| Halaman | Yang paling menonjol secara visual | Apakah itu yang paling penting? | Mengikuti alur kerja? |
|---|---|---|---|
| Halaman login | Kotak putih berbayang di tengah layar dengan kotak biru kecil berlabel "A" dan judul "Admin Console" | Cukup sesuai — ini memang halaman pertama yang harus segera dikenali sebagai konsol admin, lalu mengisi form di bawahnya | Ya — urutan dari atas (judul) ke bawah (isian, lalu tombol) sudah mengikuti alur logis mengisi form |
| Dashboard utama | Nama sekolah di bagian atas (judul halaman) dan daftar menu di sisi kiri yang selalu terlihat | Sebagian sesuai — nama sekolah penting untuk konfirmasi "saya login ke sekolah yang benar", tapi tidak ada elemen yang menonjolkan tugas yang paling mendesak (misalnya peringatan jika ada data yang belum lengkap) | Tidak relevan — dashboard ini sifatnya navigasi bebas (admin pilih sendiri mau ke menu mana), bukan alur satu arah, sehingga konsep "atas ke bawah = langkah 1 ke N" tidak berlaku di sini |
| Setup Wizard (setiap tahap) | Judul besar "Setup Awal Sekolah" di bagian paling atas, lalu indikator tahap (lingkaran-lingkaran kecil), lalu judul tahap yang sedang aktif | Ya — judul tahap aktif memang yang paling relevan saat itu, dan indikator tahap membantu admin tahu sedang di mana dan masih ada berapa tahap lagi | Ya — atas ke bawah benar-benar mengikuti urutan pengisian: progres dulu, lalu judul tahap, lalu isian, lalu tombol lanjut di paling bawah |
| Wizard Tutup Tahun Ajaran (setiap langkah) | Judul "Tutup Tahun Ajaran" di atas, indikator langkah, lalu judul langkah aktif — sama persis dengan struktur Setup Wizard | Ya, dengan catatan: di Langkah 4, peringatan penting ("tidak dapat dibatalkan") ditulis sebagai paragraf hint biasa berukuran kecil, bukan ditonjolkan sebagai peringatan visual yang lebih kuat (seperti kotak warna mencolok), padahal ini aksi paling berisiko di seluruh wizard | Ya untuk struktur, tapi peringatan risiko tinggi di Langkah 4 seharusnya lebih menonjol dibanding cara penyajiannya saat ini |
| Halaman Tutup Semester | Tiga kotak angka ringkasan (jumlah observasi, siswa aktif, kasus terbuka) ditampilkan cukup besar, dengan tombol aksi berwarna merah (tombol berbahaya) di bawahnya | Sebagian sesuai — angka ringkasan memang berguna untuk konteks, tapi peringatan tertulis tentang konsekuensi penutupan semester ditampilkan dalam ukuran teks yang sama dengan teks biasa, tidak lebih besar dari angka-angka ringkasan di atasnya, padahal peringatan itu lebih penting untuk dibaca sebelum menekan tombol | Ya secara umum (ringkasan dulu, peringatan, baru tombol aksi), tapi bobot visual peringatan kurang sesuai dengan tingkat risikonya |

## Audit Dashboard

| Panel | Mendorong tindakan konkret? | Tindakan apa? | Informasi yang hilang |
|---|---|---|---|
| Program Keahlian | Tidak | Hanya menampilkan daftar untuk dilihat | Tidak menampilkan apakah program ini sudah dipakai di kelas mana pun |
| Kelas & Rombel | Tidak | Hanya menampilkan daftar untuk dilihat | Tidak menampilkan jumlah siswa per kelas |
| Mata Pelajaran | Tidak | Hanya menampilkan daftar untuk dilihat | Tidak menampilkan apakah mata pelajaran ini sudah dipakai di jadwal mana pun |
| Guru & Staf | Sedikit | Bisa melihat siapa yang tidak aktif (kolom Status), tapi tidak ada tombol untuk mengaktifkan/menonaktifkan dari panel ini | Tidak menampilkan apakah staf ini sudah punya penugasan mengajar |
| Siswa | Sedikit | Bisa melihat status siswa (aktif/lulus/keluar), tapi tidak ada tombol aksi apa pun dari panel ini | Tidak menampilkan kelas masing-masing siswa di tabel yang sama |
| Orang Tua | Tidak | Hanya menampilkan daftar | Tidak menampilkan siswa mana yang BELUM punya orang tua terdaftar — ini justru informasi paling berguna yang hilang (sudah dicatat juga di audit data sebelumnya) |
| Import Orang Tua | Ya | Tombol unduh contoh file dan tombol impor langsung tersedia di panel ini | Tidak ada |
| Import DUDI | Ya | Sama seperti di atas | Tidak ada |
| Jadwal Aktif | Tidak | Hanya menampilkan daftar 50 jadwal terbaru | Tidak ada cara mencari jadwal tertentu, dan tidak ada tautan ke kelas/guru terkait |
| Import Jadwal Baru | Ya | Tombol impor tersedia langsung | Tidak ada |
| Guru Pengganti | Tidak | Hanya menampilkan daftar | Tidak menampilkan untuk jadwal/kelas mana penggantian itu terjadi, hanya tanggal pemberian akses |
| Tutup Semester | Ya | Tombol tutup semester / buka semester baru tersedia langsung, dengan ringkasan yang cukup untuk memutuskan | Tidak ada — panel ini paling lengkap dari sisi mendorong tindakan |
| Tahun Ajaran Baru | Tidak — bahkan membingungkan | Hanya teks penjelasan bahwa fitur belum lengkap, menyebut cara mengubah data secara manual yang sebenarnya tidak praktis untuk admin biasa | Tidak ada tautan ke Wizard Tutup Tahun Ajaran yang sebenarnya menjadi cara yang benar untuk melakukan ini |
| Export Data | Tidak | Belum berfungsi | Seluruhnya |
| Log Aktivitas | Tidak | Belum berfungsi | Seluruhnya |

## Audit Form

| Form | Jumlah field | Field yang bisa dihilangkan/otomatis | Urutan logis? | Label jelas? | Pesan validasi membantu? |
|---|---|---|---|---|---|
| Data Sekolah (Setup tahap 1) | 3 | Tidak ada yang perlu dihilangkan — ketiganya esensial | Ya | Ya | Ya — pesan menyebutkan persis apa yang salah dan format yang benar ("Format tahun ajaran harus YYYY/YYYY") |
| Tambah Kelas manual (Setup tahap 3) | 3 | Tidak ada yang perlu dihilangkan | Ya | Ya | Sebagian — pesan "Nama kelas dan program wajib diisi" sudah jelas, tapi digabung jadi satu pesan untuk dua kemungkinan kesalahan berbeda, sehingga admin tidak langsung tahu field mana yang sebenarnya kosong |
| Buka Semester 2 | 2 (tanggal mulai, tanggal selesai) | Tidak — keduanya sudah otomatis terisi dengan nilai wajar (1 Januari dan 30 Juni tahun berikutnya), admin hanya perlu mengubah jika perlu | Ya | Ya | Ya — pesan "Tanggal mulai harus sebelum tanggal selesai" jelas |
| Kelulusan Massal (kotak centang per siswa) | 1 jenis field diulang per siswa | Tidak ada yang bisa dihilangkan, karena ini memang keputusan per individu | Ya (semua tercentang sebagai default "lulus", admin hanya menghapus centang yang tidak lulus) | Ya | Ya — preview jumlah yang akan diluluskan/tidak ditampilkan sebelum konfirmasi |
| Kenaikan Kelas (dropdown per kelas asal) | 1 jenis field diulang per kelas | Tidak — sistem sudah otomatis menyarankan kelas tujuan, mengurangi beban pengisian manual | Ya | Ya | Ya — pesan menyebutkan persis kelas mana yang belum dipilih kelas tujuannya |
| Buka Tahun Ajaran Baru (Tutup Tahun Langkah 4) | 4 (tahun ajaran, semester, tanggal mulai, tanggal selesai) | Semester bisa dihilangkan sebagai field terpisah karena nilainya selalu tetap "Semester 1" untuk pembukaan tahun ajaran baru (sudah dikunci ke nilai itu di kode, tapi tetap ditampilkan sebagai dropdown pilihan yang sebenarnya tidak punya pilihan lain) | Ya | Ya | Ya — pesan format dan urutan tanggal jelas |
| Form impor CSV (pola yang sama di seluruh aplikasi) | 1 (pilih file) | Tidak — sudah minimal | Ya | Ya, ditambah daftar nama kolom yang diharapkan ditampilkan sebagai panduan | Ya — hasil impor menyebutkan jumlah baris berhasil/gagal dan rincian pesan kesalahan per baris yang gagal |

## Audit Tabel

| Tabel | Jumlah kolom | Kolom tidak perlu? | Urutan logis? | Data yang berpotensi terlalu panjang |
|---|---|---|---|---|
| Program Keahlian | 3 | Tidak | Ya (kode, lalu nama, lalu status — wajar) | Nama program bisa panjang (contoh: "Rekayasa Perangkat Lunak"), tapi masih wajar untuk satu baris |
| Kelas & Rombel | 4 | Tidak | Ya | Tidak ada yang berisiko panjang berlebihan |
| Mata Pelajaran | 2 | Tidak | Ya | Nama mata pelajaran bisa cukup panjang (contoh nama mata pelajaran kejuruan resmi sering panjang), berpotensi memenuhi satu baris penuh |
| Guru & Staf (Daftar Pengguna) | 4 | Tidak, tapi nilai kolom "Role" dan "Status" ditampilkan dalam format kode mentah (lihat Audit Bahasa) | Ya (nama dulu, baru identitas dan peran) | Tidak ada yang berisiko panjang berlebihan |
| Siswa | 3 | Tidak | Ya | Tidak ada yang berisiko panjang berlebihan |
| Jadwal Aktif | 3 | Tidak, tapi tidak menyertakan kolom kelas atau guru — sehingga tabel ini secara teknis ringkas tapi kurang informatif untuk benar-benar memverifikasi jadwal siapa untuk kelas apa | Ya | Tidak ada yang berisiko panjang berlebihan |
| Guru Pengganti | 2 | Tidak, tapi sama seperti di atas — tidak menyertakan kolom kelas/jadwal yang terkait, sehingga tabel kurang informatif (sudah dicatat juga di audit-audit sebelumnya) | Ya | Tidak ada yang berisiko panjang berlebihan |
| Review Siswa Kelas XII / Kelulusan Massal | 3-4 | Tidak | Ya | Tidak ada yang berisiko panjang berlebihan |
| Kenaikan Kelas | 3 | Tidak | Ya | Nama kelas asal dengan keterangan tingkat bisa agak panjang, tapi masih wajar |
| Hasil impor (baris error/konflik) | 2 (nomor baris, pesan) | Tidak | Ya | Kolom pesan kesalahan berpotensi sangat panjang (bisa lebih dari 100 karakter) — perlu dipastikan tabel ini bisa menampung teks panjang tanpa memotong informasi penting |

**Catatan umum:** tidak ditemukan tabel dengan jumlah kolom berlebihan (semua di bawah 5 kolom) — masalah utama bukan "terlalu banyak kolom", tapi beberapa tabel justru kekurangan kolom penting untuk verifikasi yang berguna (jadwal tanpa info kelas/guru, guru pengganti tanpa info jadwal terkait), dan tidak ada penanganan untuk teks panjang pada kolom pesan kesalahan impor.

## Audit Tombol & Aksi

### Label Tombol yang Kurang Jelas

| Label asli | Lokasi | Saran |
|---|---|---|
| "Konfirmasi" | Wizard Tutup Tahun Ajaran, Langkah 4 (Buka Tahun Ajaran Baru) | Ganti jadi "Buka Tahun Ajaran Baru" — sudah dibahas di Audit Bahasa, ini satu-satunya tombol di seluruh aplikasi yang labelnya tidak menyebutkan aksinya secara spesifik |
| "Lanjut" (dipakai berulang di kedua wizard untuk berpindah ke tahap berikutnya) | Setup Wizard dan Wizard Tutup Tahun Ajaran | Bukan masalah besar karena fungsinya konsisten (navigasi maju), tapi di Wizard Tutup Tahun Ajaran tombol ini sebenarnya sudah diberi label lebih spesifik per langkah (misalnya "Lanjut ke Kelulusan") — sebaiknya Setup Wizard juga memakai pola serupa, bukan hanya "Lanjut" generik di semua sebelas tahap |

### Tombol dengan Konfirmasi yang Sudah Jelas (sebagai pembanding positif)
Tombol-tombol berbahaya/tidak bisa dibatalkan sudah diberi label yang jelas DAN jendela konfirmasi terpisah dengan rincian dampak sebelum dijalankan — ini praktik yang baik dan konsisten, ditemukan pada: "Tutup Semester [angka] Sekarang", "Konfirmasi Kelulusan", "Konfirmasi Kenaikan Kelas". Tombol "Konfirmasi" di Langkah 4 (dibahas di atas) adalah satu-satunya pengecualian yang labelnya kurang sejelas yang lain, padahal jendela konfirmasinya sendiri sudah cukup rinci.

### Tombol Tanpa Feedback Loading

| Tombol | Lokasi |
|---|---|
| "Kembali" (navigasi mundur di kedua wizard) | Setup Wizard dan Wizard Tutup Tahun Ajaran — wajar, karena aksi ini memang instan (hanya pindah tampilan, tidak menyimpan apa pun ke server) |
| "Lanjut" (Setup Wizard) | Tombol berubah ke status tidak bisa diklik saat proses berjalan, tapi teksnya tidak berubah menjadi "Memproses..." atau sejenisnya seperti tombol-tombol lain di aplikasi yang sama — admin tidak mendapat tanda visual yang jelas bahwa sistem sedang bekerja |
| "Tambah Kelas" (Setup tahap 3, form tambah kelas manual) | Tidak ada penanganan status proses sama sekali — tombol tetap bisa diklik berulang kali sebelum proses sebelumnya selesai, berisiko menambah kelas yang sama dua kali jika admin klik dua kali karena mengira klik pertama tidak berhasil |
| "Konfirmasi Kenaikan Kelas" | Tidak ditemukan perubahan teks/status proses pada tombol ini, berbeda dari tombol "Konfirmasi Kelulusan" dan "Konfirmasi" (Langkah 4) di wizard yang sama yang sudah punya penanganan ini |

## Audit Pesan Kesalahan

### Pesan Error yang Perlu Diperbaiki

| Pesan asli | Lokasi | Masalah | Saran |
|---|---|---|---|
| "Periode akademik aktif ({tahun} semester {semester}) belum terdaftar di `academic_periods`. Buat periode ini terlebih dahulu sebelum semester dapat ditutup." | Panel Tutup Semester | Menyebut nama tabel database mentah (`academic_periods`), dan tidak jelas siapa yang harus "membuat periode ini" — admin sekolah tidak punya cara melakukan ini sendiri dari tampilan manapun | "Periode akademik untuk {tahun} semester {semester} belum tersedia di sistem. Mohon hubungi tim teknis untuk menyiapkannya sebelum semester ini bisa ditutup." |
| "Terjadi kesalahan sistem. Hubungi administrator." | Pesan error umum di dashboard saat data gagal dimuat | Tidak menjelaskan apa yang sebenarnya salah sama sekali, dan istilah "administrator" tumpang tindih dengan peran "Admin" yang sudah dipakai di aplikasi ini — membingungkan apakah admin harus menghubungi dirinya sendiri atau pihak lain | Sebutkan konteks yang gagal dimuat, misalnya "Data {nama panel} gagal dimuat. Coba muat ulang halaman, atau hubungi tim teknis jika masalah berlanjut." |
| "Terjadi kesalahan. Coba lagi." (pesan fallback umum di beberapa tempat) | Setup Wizard dan Wizard Tutup Tahun Ajaran, saat error tak terduga terjadi | Terlalu umum, tidak membantu admin tahu apakah harus mengulang dari awal, mengecek koneksi internet, atau melakukan sesuatu yang lain | Sebutkan kemungkinan penyebab paling umum, misalnya "Terjadi kesalahan saat menyimpan data. Periksa koneksi internet Anda dan coba lagi. Jika masalah berlanjut, hubungi tim teknis." |
| "Identifier atau password salah" | Halaman login | "Identifier" adalah istilah Inggris yang dipertahankan, padahal di label form-nya sendiri sudah dijelaskan sebagai "NIP / NIK" | "NIP/NIK atau password yang Anda masukkan salah. Periksa kembali dan coba lagi." |

### Pesan Sukses yang Kurang Informatif

Sebagian besar pesan sukses di aplikasi ini sudah cukup baik dan informatif (bukan sekadar "Berhasil") — misalnya "Semua baris berhasil diimpor", "{jumlah} siswa berhasil diluluskan", "Tahun ajaran {tahun} semester {semester} aktif. {jumlah} siswa naik kelas." Ini adalah praktik yang baik dan konsisten. Tidak ditemukan pesan sukses yang hanya berisi kata "Berhasil" tanpa rincian di seluruh aplikasi yang diperiksa — bagian ini secara umum sudah baik, tidak perlu perbaikan besar.

## Audit Mobile

| Kriteria | Status | Temuan | Risiko |
|---|---|---|---|
| Viewport meta tag | **Tidak ada** | Tidak ditemukan tag pengatur tampilan layar kecil di satu pun dari empat halaman admin | Di perangkat HP, halaman akan ditampilkan dalam ukuran penuh seperti di komputer lalu di-zoom otomatis oleh browser, membuat teks sangat kecil dan sulit dibaca |
| Ukuran huruf input | **14px** | Lebih kecil dari ukuran yang disarankan untuk mencegah HP secara otomatis melakukan zoom saat field diklik | Pengalaman tidak nyaman di HP — setiap kali admin mengetuk kotak isian, layar akan otomatis membesar (zoom) secara tiba-tiba |
| Ukuran tombol (area sentuh) | Sekitar 34-40px tinggi | Sedikit lebih kecil dari ukuran yang disarankan untuk area yang nyaman disentuh jari | Risiko salah sentuh tombol yang berdekatan, terutama pada tombol kecil seperti navigasi tahap wizard |
| Tabel bisa di-geser ke samping di layar kecil | **Tidak ada penanganan** | Tabel-tabel data tidak punya pengaturan untuk bisa digeser secara horizontal jika lebar layar tidak cukup | Di layar HP, tabel dengan banyak kolom (misalnya Daftar Pengguna dengan 4 kolom) akan rusak tampilannya atau terpotong |
| Elemen terpotong di layar sempit | **Sangat mungkin terjadi** | Lembar gaya halaman ini secara eksplisit dirancang dan ditulis sebagai "khusus desktop, lebar minimal 1024 piksel" — jauh lebih lebar dari layar HP pada umumnya (sekitar 375-414 piksel) | Hampir seluruh tampilan (sidebar, form, tabel) akan tidak pas dan harus di-scroll ke berbagai arah di HP |

**Catatan penting:** console admin ini secara sengaja dirancang **khusus untuk komputer/laptop di kantor sekolah**, bukan untuk dipakai di HP — ini tertulis jelas sebagai catatan dalam berkas pengaturan tampilannya. Ini bukan kesalahan teknis yang tidak disengaja, tapi pilihan desain. Temuan-temuan di atas tetap dicatat karena audit ini diminta secara eksplisit, tapi tidak otomatis berarti perlu diperbaiki — perlu dipastikan dulu apakah admin sekolah memang selalu mengerjakan tugas ini dari komputer, atau ada kemungkinan suatu saat perlu diakses dari HP (misalnya admin yang sedang di luar kantor saat ada masalah mendesak).

## Audit 5-Detik

| Halaman | Yang terlihat pertama | Cukup jelas? | Rekomendasi |
|---|---|---|---|
| Halaman login | Kotak putih di tengah dengan tulisan "Admin Console" dan dua kotak isian (Identifier, Password) | Cukup — langsung jelas ini halaman login untuk admin, dan langsung jelas harus mengisi dua kotak lalu menekan tombol "Masuk" | Tidak perlu perubahan |
| Dashboard utama | Daftar menu di sisi kiri (15 pilihan dalam 4 kelompok) dan nama sekolah di atas, dengan area kosong di tengah bertuliskan "Pilih menu di samping untuk mulai." | Cukup untuk pertanyaan "halaman apa ini" (jelas ini dashboard sekolah), tapi tidak cukup untuk pertanyaan "apa yang harus saya lakukan sekarang" bagi admin yang baru pertama kali masuk — tidak ada arahan tentang menu mana yang sebaiknya dicek dulu | Tambahkan ringkasan singkat di area tengah sebelum menu dipilih, misalnya status setup yang masih perlu diselesaikan, atau pengingat tugas rutin yang belum dikerjakan |
| Setup Wizard tahap 1 | Judul besar "Setup Awal Sekolah", indikator 11 tahap, dan judul tahap "Data Sekolah" dengan tiga kotak isian | Cukup — langsung jelas ini proses setup awal yang berurutan, sedang di tahap mana, dan harus mengisi data sekolah dulu | Tidak perlu perubahan besar |
| Halaman Tutup Semester | Tiga kotak angka ringkasan, lalu kalimat peringatan, lalu tombol merah "Tutup Semester Sekarang" | Cukup untuk "apa yang harus saya lakukan" (tombolnya jelas dan menonjol), tapi peringatan konsekuensi (data akan terkunci permanen) mungkin tidak langsung dibaca dalam 5 detik karena ukuran tulisannya tidak lebih besar dari teks biasa, padahal posisinya tepat sebelum tombol berbahaya | Buat kalimat peringatan ini lebih menonjol secara visual (misalnya kotak peringatan berwarna lebih kuat) supaya pasti terbaca sebelum admin menekan tombol |
| Wizard Tutup Tahun Ajaran Langkah 1 | Judul "Tutup Tahun Ajaran", indikator 5 langkah, judul "Review Siswa Kelas XII", dan tabel daftar siswa | Cukup — jelas ini bagian dari proses tutup tahun ajaran dan langkah pertama adalah meninjau siswa kelas XII | Tidak perlu perubahan |

## Temuan & Rekomendasi

**HIGH**
- Pesan error di panel Tutup Semester menyebut nama tabel data mentah (`academic_periods`) dan menyuruh admin "membuat periode ini" tanpa ada cara melakukannya dari tampilan apa pun — admin akan macet total tanpa tahu harus berbuat apa selain menghubungi tim teknis yang juga tidak disebutkan caranya. Rekomendasi: ganti pesan ini dengan bahasa biasa dan instruksi yang benar-benar bisa dijalankan admin (lihat detail di Audit Pesan Kesalahan).
- Tombol "Tambah Kelas" di Setup Wizard tahap 3 tidak punya penanganan apa pun saat sedang diproses — admin yang klik dua kali karena mengira klik pertama gagal berisiko menambahkan kelas yang sama dua kali. Rekomendasi: tambahkan status "Menambahkan..." dan nonaktifkan tombol sementara, sama seperti tombol-tombol lain di aplikasi ini yang sudah benar menanganinya.

**MEDIUM**
- Konsol admin ini secara desain hanya bisa dipakai dengan nyaman dari komputer (lembar gaya tampilannya secara eksplisit menyebut "khusus desktop, lebar minimal 1024 piksel"), tanpa pengaturan khusus untuk layar HP sama sekali. Jika admin sekolah suatu saat perlu mengerjakan tugas mendesak dari HP, hampir seluruh tampilan akan sulit dipakai. Rekomendasi: pastikan dengan sekolah apakah ini batasan yang bisa diterima, atau perlu disiapkan versi yang ramah HP untuk situasi darurat.
- Tombol "Konfirmasi" di Langkah 4 Wizard Tutup Tahun Ajaran adalah satu-satunya tombol di seluruh aplikasi yang tidak menyebutkan aksinya secara spesifik, padahal aksi ini termasuk yang paling berisiko (membuka tahun ajaran baru, tidak bisa dibatalkan). Rekomendasi: ganti jadi "Buka Tahun Ajaran Baru".
- Penggunaan kata "Impor" (Indonesia) dan "Import" (Inggris) tercampur untuk konsep yang sama di berbagai tempat berbeda dalam aplikasi yang sama (label tombol vs nama menu/tahap). Rekomendasi: seragamkan jadi "Impor" di semua tempat.
- Peringatan konsekuensi sebelum aksi besar dan tidak bisa dibatalkan (menutup semester, membuka tahun ajaran baru) ditulis dengan ukuran teks yang sama dengan teks biasa, tidak ditonjolkan secara visual sesuai bobot risikonya. Rekomendasi: gunakan kotak peringatan dengan warna lebih kuat dan ukuran teks yang lebih besar untuk peringatan-peringatan ini.
- Nilai kolom seperti peran pengguna dan status yang ditampilkan dalam format kode mentah ("WALI_KELAS", "ADMINISTRATIVE", "AKTIF" dengan huruf kapital dan garis bawah) di beberapa tabel dashboard. Rekomendasi: ubah ke bentuk yang lebih wajar dibaca ("Wali Kelas", "Admin", "Aktif").

**LOW**
- Tampilan awal dashboard ("Pilih menu di samping untuk mulai.") tidak memberi gambaran fungsi dashboard secara keseluruhan untuk admin yang baru pertama kali memakainya. Rekomendasi: tambahkan kalimat pembuka singkat yang menjelaskan dashboard ini untuk apa.
- Dua wizard yang strukturnya identik (Setup Wizard dan Wizard Tutup Tahun Ajaran) memakai kata berbeda untuk konsep yang sama ("Tahap" vs "Langkah"). Rekomendasi: seragamkan salah satu istilah di kedua wizard.
- Beberapa tabel di dashboard (Jadwal Aktif, Guru Pengganti) tidak menyertakan kolom yang menghubungkannya ke data terkait (kelas, guru), membuat tabel kurang berguna untuk verifikasi menyeluruh — konsisten dengan temuan serupa di audit data sebelumnya. Rekomendasi: tambahkan kolom penghubung yang relevan.
