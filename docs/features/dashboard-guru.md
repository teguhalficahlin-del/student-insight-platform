# Dashboard Guru — Tab Guru

Tab pertama di portal guru. Berisi dua fitur utama:
jadwal mengajar harian/mingguan dan rekap kehadiran siswa kelas yang diajar.

---

## 1. Jadwal Mengajar

### Toggle Tampilan
- **Hari ini** (default): menampilkan jadwal hari ini saja
  - Ada `input[type=date]` tersembunyi — selalu default ke hari ini,
    tidak ada UI untuk mengubah tanggal secara manual
- **Minggu ini**: menampilkan jadwal Senin–Jumat minggu berjalan

### Tabel Jadwal
Kolom yang ditampilkan:

| Kolom | Isi |
|---|---|
| Jam | Waktu mulai – selesai (slot berurutan digabung) |
| Kelas | Nama kelas |
| Kehadiran | Tombol Input Kehadiran atau Sesi Berakhir |

### Penggabungan Slot
Slot jadwal berurutan dengan jeda ≤ 40 menit digabung menjadi satu baris
oleh `mergeConsecutiveSessions()`. Tombol Input Kehadiran membawa
semua `schedule_id` dari slot yang digabung.

### Tombol Kehadiran
- **Input Kehadiran** (aktif, warna primer): sesi hari ini yang belum berakhir
- **Sesi Berakhir** (disabled): tanggal < hari ini, atau jam sudah lewat `merged_end`
- Klik tombol → membuka modal input absensi (lihat `docs/features/absensi.md` §1)

### Cache Offline
View **Hari ini** menggunakan cache lokal (`LC.get/set`):
- Data cache ditampilkan lebih dulu jika tersedia
- Fetch ke server berjalan di belakang; cache diperbarui setelah berhasil
- Jika fetch gagal dan cache ada, data lama tetap tampil (tidak di-overwrite error)

---

## 2. Rekap Kehadiran Siswa

### Filter
- **Kelas**: dropdown berisi kelas yang diajar guru semester ini
- **Dari / Sampai**: rentang tanggal — default awal bulan ini s/d hari ini
- Tombol **Tampilkan** memuat data; berubah jadi **Sembunyikan** setelah data dimuat
- Data tidak di-reload otomatis saat Sembunyikan → Tampilkan — klik Tampilkan
  ulang untuk refresh

### Tampilan Hasil
Header menampilkan: nama kelas · jumlah siswa · rentang tanggal akumulasi

Accordion per siswa:
- Baris ringkasan: nama siswa · jumlah H/I/S/A · % hadir
- Klik accordion → expand detail sesi yang diajar guru ini saja
  (filter by teacher_id — sesi mapel lain tidak tampil).
  Detail sesi hanya dimuat jika filter tanggal (start dan end) sudah diset.
  Jika belum, accordion menampilkan hint untuk memilih tanggal atau menggunakan fitur Unduh Excel.
- Detail sesi: tanggal, jam, mapel, status kehadiran

### Kolom Rekap
Lihat `docs/features/absensi.md` §2 untuk definisi lengkap
HADIR / IZIN / SAKIT / ALPA / TOTAL / % HADIR.

### Unduh CSV
Tombol **Unduh CSV** tersedia setelah data dimuat.

Format file: `kehadiran_{kelas}_{tanggal_mulai}_{tanggal_akhir}.csv`
Encoding: UTF-8 dengan BOM (aman dibuka di Microsoft Excel)
Kolom: Nama, NIS, Hadir, Izin, Sakit, Alpa, Total Sesi, % Hadir

---

## 3. Isolasi Akses

| Aspek | Aturan |
|---|---|
| Jadwal | Hanya jadwal milik guru yang login |
| Rekap kelas | Hanya kelas yang diajar guru semester ini |
| Rekap mapel | Hanya mapel yang diajar guru di kelas tersebut |
| Drill down siswa | Hanya sesi yang diajar guru (filter teacher_id) |
| Antar sekolah | Tidak ada akses silang (RLS school_id) |

---

## 4. Fungsi yang Dipanggil

| Fungsi | Kegunaan |
|---|---|
| `loadWeekSchedule()` | Load jadwal 5 hari (Senin–Jumat) secara paralel |
| `loadSchedule()` | Load jadwal satu hari tertentu |
| `renderScheduleRows()` | Render tabel jadwal + logika tombol disabled |
| `loadGuruRecap()` | Load rekap kehadiran siswa sesuai filter |
| `renderGuruRekapPage()` | Render accordion per siswa |
| `getMyScheduleForDate()` | API: ambil jadwal guru untuk tanggal tertentu |
| `getAttendanceSummaryByStudents()` | API: rekap absensi per siswa dalam kelas |

---

## 5. Catatan Teknis

- Default tampilan saat tab dibuka: **Hari ini**
- Default rentang rekap: **awal bulan ini s/d hari ini** (diset otomatis)
- Data rekap tidak di-reload saat tombol Sembunyikan → Tampilkan — harus
  klik Tampilkan ulang jika ingin refresh data
- Slot jadwal digabung oleh `mergeConsecutiveSessions()` — jeda ≤ 40 menit
  antar slot dianggap satu blok berurutan
- `initObsForm()` dipanggil di akhir init tab guru — ini form observasi
  global, bukan bagian dari fitur jadwal atau rekap

---

*Dokumen ini adalah referensi definitif.
Setiap perubahan perilaku fitur harus diupdate di sini sebelum diimplementasi.*
