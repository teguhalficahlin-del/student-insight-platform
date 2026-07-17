# Portal Siswa

Portal untuk siswa memantau kehadiran, jadwal, catatan, dan komunikasi kelas.
Tab yang tersedia berbeda tergantung status siswa.

---

## 1. Struktur Tab

| Status Siswa | Tab yang Tersedia |
|---|---|
| AKTIF | Jadwal → Kehadiran → Catatan → Forum |
| PKL | Kehadiran → Catatan → Forum → PKL |

Tab Jadwal disembunyikan saat siswa berstatus PKL karena tidak ada di sekolah.
Tab PKL hanya muncul saat siswa berstatus PKL.

---

## 2. Tab Jadwal (hanya siswa AKTIF)

### Toggle Tampilan
- **Hari ini** (default): jadwal hari ini dalam accordion
- **Minggu ini**: jadwal Senin–Jumat minggu berjalan

### Tampilan Accordion
- Satu accordion = satu hari
- Kolom: Jam · Mata Pelajaran · Guru
- Accordion hari ini terbuka otomatis
- Jika tidak ada jadwal → tampil "tidak ada jadwal"

### Catatan Teknis
- `initJadwalTab()` dipanggil sekali saat pertama kali tab dibuka
- `loadSchedule()` — fetch jadwal satu hari
- `loadWeekSchedule()` — fetch 5 hari paralel
- `renderScheduleRows()` — render accordion per hari

---

## 3. Tab Kehadiran

Tabel absensi collapsed per blok pertemuan.

### Filter
- **Dari / s/d**: rentang tanggal — default 30 hari ke belakang s/d hari ini
- Tombol **Filter** memuat ulang data

### Tampilan
- Satu baris = satu blok (1–7 slot berurutan dalam satu hari)
- Kolom: Tanggal · Jam · Mata Pelajaran · Guru · Status
- Klik baris multi-slot → expand detail per slot
- Status summary: HADIR/IZIN/SAKIT/ALPA jika semua slot sama, CAMPURAN jika berbeda
- Stat cards: Hadir · Izin · Sakit · Alpa · % (dihitung per slot)
- Warna %: hijau ≥ 80%, kuning ≥ 60%, merah < 60%

### Fungsi
- `loadAttendance()` — load dan render kehadiran
- `getMyAttendance(studentId, dateStart, dateEnd)` — fetch dari DB

---

## 4. Tab Catatan

Tiga section dalam satu tab: Catatan Siswa, Kasus, dan Prestasi.
Semua di-fetch paralel via `Promise.allSettled`.

### Catatan Siswa (Observasi)
- Filter tanggal — default 30 hari ke belakang s/d hari ini
- Cache lokal via `LC` — data tampil instan saat tab dibuka ulang
- Card per catatan: sentimen · dimensi · isi · tanggal

### Kasus
- Daftar kasus yang melibatkan siswa ini
- Hanya kasus yang visible untuk siswa (bukan INTERNAL_SCHOOL)

### Prestasi
- Daftar prestasi yang dicatat oleh staf
- Kolom: judul · kategori · lingkup · tanggal · dicatat oleh

### Fungsi
- `loadObservations()` — load paralel obs + kasus + prestasi
- `getMyObservations(studentId, dateStart, dateEnd)`
- `getMyCases(studentId)`
- `getMyAchievements(studentId)`
- `renderObservations()`, `renderCases()`, `renderAchievements()`

---

## 5. Tab Forum

Forum komunikasi kelas — siswa hanya bisa membaca posting yang ditujukan kepadanya.

### Tampilan
- Posting ditampilkan chronological terbaru di atas
- Pagination: 20 posting per load, tombol "Muat Lebih Banyak"
- Lazy init: fetch hanya dilakukan sekali, tidak diulang saat tab diklik lagi

### Kondisi Kosong
- Belum terdaftar di kelas → "Kamu belum terdaftar di kelas manapun"
- Tidak ada posting → "Belum ada posting forum untuk kelasmu"

### Fungsi
- `initForumTab()` — init sekali, set `forumClassId` dan `forumAcadYear`
- `loadForumPosts(loadMore)` — fetch posting dengan offset pagination
- `getForumPosts(classId, acadYear, userId, schoolId, limit, offset)`

---

## 6. Tab PKL (hanya siswa PKL)

Informasi penempatan PKL dan rekap kehadiran di tempat PKL.

### Info Penempatan
- Tempat PKL (`dudi_org_name`)
- Periode (start_date – end_date)
- Status: Aktif / Selesai

### Stat Cards
Hadir · Izin · Sakit · Alpa · % Hadir

### Rekap Absensi
Tabel per hari: Tanggal · Status · Catatan

### Fungsi
- `loadPkl()` — load penempatan + rekap absensi
- `getMyPklPlacement(studentId)`
- `getMyPklAttendance(studentId)`

---

## 7. Isolasi Akses

| Aspek | Aturan |
|---|---|
| Data | Hanya data milik siswa yang login |
| Antar siswa | Tidak ada akses silang |
| Antar sekolah | Tidak ada akses silang (RLS school_id) |

Siswa alumni (LULUS) atau mutasi (KELUAR) tidak bisa mengakses portal —
otomatis logout dan redirect ke halaman login.

---

## 8. Catatan Teknis

- `obsLoaded` dan `pklLoaded` — flag lazy load, tidak fetch ulang jika sudah dimuat
- Cache lokal `LC` (localStorage) untuk jadwal dan observasi
- Status badge warna: HADIR=hijau, IZIN=kuning, SAKIT=biru, ALPA=merah, CAMPURAN=abu

---

*Dokumen ini adalah referensi definitif.
Setiap perubahan perilaku fitur harus diupdate di sini sebelum diimplementasi.*
