# Dashboard Kaprodi — Tab Kaprodi

Tab khusus untuk guru yang menjabat sebagai Kepala Program Keahlian (Kaprodi).
Hanya tampil jika `currentUser.kaprodi_program_id` terisi —
guru yang bukan Kaprodi tidak melihat tab ini.

---

## 1. Section dan Urutan Tampil

Tab Kaprodi menggunakan accordion single-expand — hanya satu section
yang terbuka dalam satu waktu. Default: semua section tertutup.

Urutan section:
1. Rekap Absensi Kelas
2. Mitra DUDI
3. Penempatan PKL
4. Daftar Siswa PKL
5. Rekap Absensi PKL
6. Observasi dari DUDI

---

## 2. Rekap Absensi Kelas

Menampilkan rekap kehadiran siswa aktif (bukan PKL) di semua kelas
yang termasuk dalam program keahlian Kaprodi.

### Filter
- **Dari / s/d**: rentang tanggal — default 30 hari ke belakang s/d hari ini
- Tombol **Filter** memuat ulang data

### Stat Cards
Agregat kehadiran seluruh kelas dalam program (Hadir/Izin/Sakit/Alpa dalam %).
Rata kiri. Dirender oleh `buildAttStatCards()`.

### Accordion Per Kelas
- Diurutkan alfabetis
- Baris ringkasan: nama kelas · %H · %I · %S · %A
- Warna %H: hijau ≥ 80%, kuning ≥ 60%, merah < 60%
- Klik accordion → expand daftar siswa (lazy load)

### Drill Down
Kelas → Siswa → Sesi (3 level):
1. Klik kelas → accordion per siswa dengan % hadir masing-masing
2. Klik siswa → detail per sesi (tanggal, mapel, guru, status)

### Fungsi yang Dipanggil
- `getAttendanceRecapPerClass(dateStart, dateEnd)` — rekap per kelas
- `getWaliAttendanceSummary(classId, year, start, end)` — rekap per siswa
- `getStudentAttendanceSessions(studentId, start, end)` — detail sesi per siswa

---

## 3. Mitra DUDI

Daftar perusahaan/instansi mitra PKL yang terdaftar untuk program keahlian ini.

| Kolom | Isi |
|---|---|
| Nama Usaha | `dudi_org_name` dari tabel users (role DUDI) |
| Penanggung Jawab | `full_name` akun DUDI |

Fungsi: `fetchDudiPartners(programId)`

---

## 4. Penempatan PKL

Form untuk menempatkan siswa aktif ke mitra DUDI.

### Input
- Dropdown siswa (hanya siswa AKTIF di program ini)
- Dropdown mitra DUDI (hanya DUDI di program ini)
- Tanggal Mulai dan Tanggal Selesai

### Aksi
- **Simpan Penempatan** — submit satu siswa ke satu DUDI
- **Impor CSV** — bulk import penempatan via file CSV
- **Unduh Template CSV** — unduh template CSV untuk diisi

Fungsi: `initKpPlacementForm(programId)`, `handleFinishPkl(btn)`

---

## 5. Daftar Siswa PKL

Tabel semua siswa yang berstatus PKL di program keahlian ini.

| Kolom | Isi |
|---|---|
| Nama | full_name siswa |
| NIS | nomor induk siswa |
| Tempat PKL | dudi_org_name mitra aktif |
| Periode | start_date – end_date penempatan aktif |
| Aksi | Tombol "Selesaikan PKL" jika sudah ditempatkan |

### Stat Cards (di dalam section ini)
- Total Siswa PKL
- Sudah Ditempatkan
- Belum Ditempatkan

Fungsi: `fetchPklStudents(programId)`, `renderKpStudents()`

---

## 6. Rekap Absensi PKL

Rekap kehadiran harian siswa PKL di tempat PKL masing-masing.

### Filter
- **Dari / s/d**: rentang tanggal — default 30 hari ke belakang s/d hari ini

### Tabel
Kolom: Nama/NIS · H · I · S · A · %
Satu baris per siswa PKL.

Fungsi: `loadKpRecap()`, `fetchPklAttendance(studentIds, dateStart, dateEnd)`

---

## 7. Observasi dari DUDI

Daftar observasi yang dikirim oleh mitra DUDI terhadap siswa PKL
di program keahlian ini.

Fungsi: `loadKpObs()`

---

## 8. Isolasi Akses

| Aspek | Aturan |
|---|---|
| Program | Hanya program yang dikepalai (`kaprodi_program_id`) |
| Kelas | Semua kelas aktif di program tersebut |
| Siswa | Semua siswa aktif dan PKL di program tersebut |
| Antar sekolah | Tidak ada akses silang (RLS school_id) |

---

## 9. Catatan Teknis

- Default rentang: 30 hari ke belakang s/d hari ini
- Accordion single-expand: buka satu section otomatis menutup yang lain
- Lazy load: detail siswa dan sesi hanya di-fetch saat accordion dibuka,
  tidak fetch ulang jika sudah dibuka sebelumnya
- `kaprodiAllStudents`: gabungan siswa PKL + siswa aktif,
  dipakai sebagai pool pencarian di fitur Observasi dan Buat Kasus

---

*Dokumen ini adalah referensi definitif.
Setiap perubahan perilaku fitur harus diupdate di sini sebelum diimplementasi.*
