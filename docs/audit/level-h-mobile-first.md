# Mobile Portal Design Principles

**Version:** 1.0
**Status:** Draft

---

# Tujuan

Portal harus membantu pengguna menyelesaikan pekerjaannya dengan cepat, jelas, dan tanpa kebingungan.

Setiap keputusan desain harus mendukung efisiensi operasional, bukan sekadar estetika.

---

# 1. One Screen, One Purpose

Satu layar hanya memiliki satu tujuan utama.

Contoh:

* Halaman Absensi → mengisi absensi.
* Halaman Observasi → menulis observasi.
* Halaman Profil → melihat profil.

Jangan mencampurkan banyak tugas dalam satu layar.

---

# 2. Primary Action First

Tombol yang paling sering digunakan harus langsung terlihat tanpa perlu scroll.

Contoh:

* Simpan
* Absen
* Kirim
* Tambah

---

# 3. Content Before Decoration

Data lebih penting daripada dekorasi.

Prioritas:

1. Informasi utama
2. Tombol aksi
3. Statistik
4. Grafik
5. Ilustrasi

---

# 4. Progressive Disclosure

Tampilkan informasi seperlunya.

Informasi tambahan hanya muncul ketika diperlukan.

Jangan memenuhi layar dengan semua informasi sekaligus.

---

# 5. Fast Recognition

Pengguna harus mengenali fungsi tanpa harus membaca panjang.

Gunakan:

* ikon yang konsisten
* label singkat
* posisi tombol yang tetap

---

# 6. Thumb Friendly

Semua aksi utama mudah dijangkau dengan ibu jari.

Hindari tombol penting yang terlalu kecil atau sulit dijangkau.

---

# 7. Minimize Typing

Kurangi kebutuhan mengetik.

Utamakan:

* pilihan
* dropdown
* autocomplete
* checkbox
* tombol aksi

---

# 8. Minimize Navigation

Semakin sedikit perpindahan halaman, semakin baik.

Target:

Satu pekerjaan selesai dalam sesedikit mungkin langkah.

---

# 9. Immediate Feedback

Setiap aksi harus memberikan respons.

Contoh:

* tersimpan
* gagal
* sedang sinkronisasi
* berhasil dikirim

Pengguna tidak boleh menebak apakah sistem sedang bekerja.

---

# 10. Consistency

Posisi komponen harus konsisten di seluruh portal.

Contoh:

* tombol simpan selalu di lokasi yang sama
* tombol kembali selalu sama
* menu selalu sama

---

# 11. Performance First

Portal harus terasa cepat.

Utamakan:

* data utama tampil lebih dahulu
* statistik menyusul
* grafik paling akhir

Pengguna harus bisa mulai bekerja sebelum seluruh halaman selesai dimuat.

---

# 12. Error Prevention

Cegah kesalahan sebelum terjadi.

Lebih baik mencegah daripada meminta pengguna memperbaiki.

---

# 13. Mobile First

Seluruh keputusan desain dibuat dengan asumsi perangkat utama adalah smartphone.

Desktop adalah adaptasi, bukan sebaliknya.

---

# 14. Operational First

Portal dibuat untuk menyelesaikan pekerjaan.

Bukan untuk memamerkan fitur.

Jika sebuah elemen tidak membantu pengguna menyelesaikan pekerjaannya, pertimbangkan untuk menghapusnya.

---

# Prinsip Akhir

Portal yang baik membuat pengguna:

* cepat memahami
* cepat menemukan
* cepat memutuskan
* cepat menyelesaikan pekerjaan

Bukan membuat pengguna kagum dengan tampilannya.

## 15. Navigation First

Navigasi harus mempercepat pekerjaan, bukan menyembunyikan fungsi.

### Prioritaskan navigasi yang selalu terlihat

Gunakan:

* Bottom Navigation
* Tab
* Action Button
* Shortcut

untuk fitur yang paling sering digunakan.

### Gunakan Hamburger Menu hanya untuk

* Pengaturan
* Profil
* Bantuan
* Tentang aplikasi
* Fitur yang jarang digunakan
* Halaman administrasi sekunder

### Jangan sembunyikan fitur utama

Pengguna tidak boleh membuka hamburger hanya untuk melakukan pekerjaan yang dilakukan setiap hari.

Contoh yang tidak disarankan:

☰

* Absensi
* Observasi
* Jadwal

Karena ketiga fitur tersebut merupakan fungsi utama.

### Contoh yang disarankan

**Bottom Navigation**

* 🏠 Beranda
* 📅 Jadwal
* ✅ Absensi
* 👤 Profil

**Hamburger Menu**

☰

* Pengaturan
* Bantuan
* Kebijakan Privasi
* Tentang Aplikasi
* Keluar

### Prinsip

Semakin sering sebuah fitur digunakan, semakin mudah fitur tersebut dijangkau.

---

## 16. Exception First

Portal harus menampilkan apa yang membutuhkan perhatian pengguna terlebih dahulu, bukan seluruh informasi yang tersedia.

Prioritaskan informasi yang memerlukan tindakan segera dibandingkan data yang hanya bersifat informatif.

### Contoh

**Guru**

* Kelas yang akan diajar berikutnya
* Siswa yang belum diabsen
* Observasi yang perlu ditindaklanjuti

**Wali Kelas**

* Siswa dengan kehadiran bermasalah
* Intervensi yang belum selesai
* Pesan baru dari orang tua

**BK**

* Kasus yang membutuhkan tindak lanjut
* Jadwal konseling hari ini

**Orang Tua**

* Ketidakhadiran anak
* Observasi baru
* Pesan dari sekolah

**Kepala Sekolah**

* Indikator yang memerlukan keputusan
* Masalah operasional yang belum terselesaikan

### Hindari

* Menampilkan seluruh statistik sebagai informasi awal.
* Memaksa pengguna mencari sendiri informasi yang penting.
* Dashboard yang penuh angka tetapi tidak menunjukkan apa yang harus dilakukan.

### Prinsip

Portal operasional tidak hanya menyajikan informasi, tetapi membantu pengguna mengetahui tindakan yang perlu dilakukan berikutnya.
