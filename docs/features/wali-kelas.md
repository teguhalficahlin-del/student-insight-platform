# Dashboard Wali Kelas — Tab Wali Kelas

Tab khusus untuk guru yang menjabat sebagai wali kelas.
Hanya tampil jika `currentUser.wali_kelas_class_id` terisi —
guru yang bukan wali kelas tidak melihat tab ini.

---

## 1. Rekap Kehadiran Kelas Walian

### Filter
- **Dari / s/d**: rentang tanggal — default 30 hari ke belakang s/d hari ini
- Tombol **Filter** memuat ulang data sesuai rentang yang dipilih

### Stat Cards
Ringkasan agregat seluruh kelas ditampilkan di atas accordion,
dirender oleh `buildAttStatCards()`.

### Accordion Per Siswa
- Diurutkan alfabetis (`localeCompare 'id'`)
- Baris ringkasan: nama siswa · % hadir
  - Hijau ≥ 80%, kuning ≥ 60%, merah < 60%
- Klik accordion → expand detail sesi (lazy load — fetch hanya saat
  accordion dibuka pertama kali, tidak fetch ulang jika sudah dibuka)

### Detail Sesi (per siswa)
Kolom yang ditampilkan:

| Kolom | Isi |
|---|---|
| Tanggal + Jam | session_date + session_start |
| Mata Pelajaran | subject.name |
| Guru | teacher.full_name |
| Status | HADIR / IZIN / SAKIT / ALPA (berwarna) |

Warna status: HADIR = hijau, IZIN = kuning, SAKIT = biru primer, ALPA = merah.

**Perbedaan penting vs tab Guru:** wali kelas melihat **semua sesi semua
mapel** siswa. Tab Guru hanya menampilkan sesi mapel yang diajar guru itu
sendiri (filter teacher_id).

### Unduh Excel
Tombol **Unduh Excel** muncul setelah data berhasil dimuat via Filter.

Format file: `rekap_wali_{kelas}_{tanggal_mulai}_{tanggal_akhir}.xlsx`

Struktur workbook:
- Sheet pertama "Ringkasan": semua siswa dengan kolom
  Nama, Hadir, Izin, Sakit, Alpa, Total Sesi, % Hadir
- Sheet per siswa: detail seluruh sesi dalam rentang yang dipilih
  dengan kolom Tanggal, Jam, Mata Pelajaran, Guru, Status

Catatan: saat tombol Unduh diklik, sistem fetch detail sesi
semua siswa secara paralel — bukan hanya siswa yang accordionnya
sudah dibuka. Ini memastikan Excel selalu lengkap.

Nama sheet per siswa dibatasi 31 karakter (batasan Excel).

---

## 2. Isolasi Akses

| Aspek | Aturan |
|---|---|
| Kelas | Hanya kelas yang diwalikan (`wali_kelas_class_id`) |
| Siswa | Semua siswa aktif di kelas tersebut |
| Sesi | Semua mapel semua guru (tidak ada filter teacher_id) |
| Antar sekolah | Tidak ada akses silang (RLS school_id) |

---

## 3. Fungsi yang Dipanggil

| Fungsi | Kegunaan |
|---|---|
| `initWaliTab()` | Init tab: set default tanggal, bind tombol, load data awal |
| `loadWaliSummary()` | Load rekap ringkasan + render accordion |
| `getWaliKelasInfo(classId)` | Ambil nama kelas untuk judul |
| `getWaliAttendanceSummary(classId, year, start, end)` | Rekap H/I/S/A per siswa |
| `getStudentAttendanceSessions(studentId, start, end)` | Detail sesi per siswa (lazy). **`start` dan `end` wajib diisi** — jika kosong, return `[]` tanpa query DB dan UI menampilkan hint untuk memilih tanggal atau menggunakan fitur Unduh Excel |
| `buildAttStatCards(students)` | Render stat cards agregat di atas accordion |

---

## 4. Catatan Teknis

- Default rentang: 30 hari ke belakang s/d hari ini (berbeda dari tab Guru: awal bulan ini)
- Tombol Unduh Excel melakukan fetch ulang ke server — bukan dari cache accordion
- Sheet name per siswa dibatasi 31 karakter (batasan format Excel)
- Tidak ada cache lokal di tab ini (berbeda dari loadSchedule di tab Guru)

---

*Dokumen ini adalah referensi definitif.
Setiap perubahan perilaku fitur harus diupdate di sini sebelum diimplementasi.*
