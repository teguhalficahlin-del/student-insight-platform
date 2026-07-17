# Portal Orang Tua

Portal untuk orang tua memantau perkembangan anak di sekolah.
Multi-anak: jika orang tua punya lebih dari satu anak terdaftar,
bisa switch antar anak via selector di bagian atas.

---

## 1. Struktur Tab

| Tab | Kondisi Tampil |
|---|---|
| PKL | Selalu ada, konten muncul jika anak berstatus PKL |
| Jadwal | Selalu ada |
| Kehadiran | Selalu ada |
| Catatan Guru | Selalu ada |
| Kasus | Selalu ada |
| Forum | Selalu ada |

Default tab tergantung status anak:
- PKL → tab PKL
- Tidak aktif (LULUS/KELUAR) → tab Catatan Guru
- Aktif → tab Jadwal

---

## 2. Tab Jadwal

### Toggle Tampilan
- **Hari ini** (default): jadwal anak hari ini
- **Minggu ini**: jadwal Senin–Jumat minggu berjalan

### Tampilan Accordion
- Satu accordion = satu hari
- Kolom: Jam · Mata Pelajaran · Guru
- Accordion hari ini terbuka otomatis
- Jika tidak ada jadwal → tampil "tidak ada jadwal"

### Sumber Data
Data jadwal diambil dari `class_id` anak yang sedang aktif dipilih.
Orang tua melihat jadwal yang sama dengan yang dilihat anak di portal Siswa.

### Fungsi
- `loadSchedule(classId)` — fetch dan render jadwal hari ini
- `loadWeekSchedule(classId)` — fetch 5 hari paralel
- `fetchSchedule(classId, date)` — fetch jadwal satu hari
- `fetchWeekSchedule(classId)` — fetch Senin–Jumat via fetchSchedule

---

## 3. Tab Kehadiran

Tabel absensi collapsed per blok pertemuan — konsisten dengan portal Siswa.

### Filter
- **Dari / s/d**: rentang tanggal
- Tombol **Filter** memuat ulang data

### Tampilan
- Satu baris = satu blok (1–7 slot berurutan)
- Kolom: Tanggal · Jam · Mata Pelajaran · Guru · Status · Catatan
- Klik baris multi-slot → expand detail per slot
- Summary cards: Hadir · Sakit · Izin · Alpa (dihitung per slot)

### Fungsi
- `loadAttendance(studentId)` — fetch dan render kehadiran
- `fetchAttendance(studentId, dateStart, dateEnd)`

---

## 4. Tab Catatan Guru

Observasi yang ditulis guru tentang anak.

### Filter
- **Dari / s/d**: rentang tanggal
- Cache lokal via `LC` — data tampil instan saat tab dibuka ulang

### Tampilan
Card per catatan: penulis · dimensi · tanggal · isi · warna sentimen

### Fungsi
- `loadObservations(studentId)` — fetch dan render
- `fetchObservations(studentId, dateStart, dateEnd)`

---

## 5. Tab Kasus

Daftar kasus yang melibatkan anak — hanya kasus yang visible untuk orang tua.

### Tampilan
Card per kasus:
- Judul · status (Terbuka/Selesai)
- Ditindaklanjuti oleh: role handler · tanggal dibuat
- Deskripsi kasus
- Timeline events (komentar/tindakan)
- Border kuning = terbuka, abu = selesai

### Fungsi
- `loadCases(studentId)` — fetch dan render
- `fetchCases(studentId)`

---

## 6. Tab Forum

Forum komunikasi kelas — orang tua melihat posting yang ditujukan ke anak atau orang tuanya.

### Multi-anak
Jika orang tua punya lebih dari satu anak, ada dropdown selector untuk memilih
anak mana yang forumnya ditampilkan.

### Tampilan
- Posting chronological terbaru di atas
- Pagination: 20 posting per load, tombol "Muat Lebih Banyak"
- Lazy init: fetch hanya dilakukan sekali per anak

### Fungsi
- `initForumSection()` — init sekali, setup selector multi-anak
- `loadForumPosts(loadMore)` — fetch posting dengan offset
- `getForumPosts(classId, acadYear, userId, schoolId, limit, offset)`

---

## 7. Tab PKL

Info penempatan PKL anak dan rekap kehadiran di tempat PKL.

### Info Penempatan
- Tempat PKL (`dudi_org_name`)
- Periode (start_date – end_date)

### Summary Cards
Hadir · Sakit · Izin · Alpa

### Rekap Absensi
Tabel per hari: Tanggal · Status · Catatan

### Kondisi Kosong
Jika anak tidak berstatus PKL atau belum ada penempatan →
tampil "Tidak ada data penempatan PKL aktif."

### Fungsi
- `loadPkl(studentId)` — fetch penempatan + rekap
- `fetchPklPlacement(studentId)`
- `fetchPklAttendanceSummary(studentId)`

---

## 8. Isolasi Akses

| Aspek | Aturan |
|---|---|
| Anak | Hanya anak yang terhubung ke akun orang tua ini |
| Data | Semua data terikat student_id anak yang dipilih |
| Antar sekolah | Tidak ada akses silang (RLS school_id) |

---

## 9. Catatan Teknis

- `tabLoaded` — flag lazy load per tab, direset saat switch anak
- `currentClassId` — disimpan di module scope untuk toggle jadwal Hari/Minggu
- Cache lokal `LC` (localStorage) untuk observasi dan jadwal
- Tab Prestasi tidak ada di portal Ortu — fitur ini hanya tersedia di portal Siswa

---

*Dokumen ini adalah referensi definitif.
Setiap perubahan perilaku fitur harus diupdate di sini sebelum diimplementasi.*
