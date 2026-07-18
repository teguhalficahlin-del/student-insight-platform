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

Daftar akun pengguna dengan role DUDI yang terdaftar di program keahlian ini.
Section ini bersifat referensi — data DUDI di sini dipakai sebagai sumber
dropdown di form Penempatan PKL. Kaprodi tidak bisa menambah atau menghapus
DUDI dari section ini — manajemen akun DUDI dilakukan di portal Admin.

| Kolom | Sumber Data |
|---|---|
| Nama Usaha | `dudi_org_name` dari view `v_users_staff_directory` |
| Penanggung Jawab | `full_name` akun DUDI (nama PIC) |

Filter query: `role_type = 'DUDI'` dan `program_id = kaprodi_program_id`.

Fungsi: `fetchDudiPartners(programId)`, `renderKpDudi()`

---

## 4. Penempatan PKL

Form untuk menempatkan siswa aktif ke mitra DUDI.
Tersedia tiga cara input: form manual (satu siswa), impor CSV (bulk), dan selesaikan PKL.

### Form Manual
- Dropdown Siswa — hanya menampilkan siswa `AKTIF` di program ini (belum PKL)
- Dropdown Mitra DUDI — dari daftar DUDI yang sudah dimuat di section Mitra DUDI
- Input Tanggal Mulai dan Tanggal Selesai
- Klik **Simpan Penempatan** → panggil `fn_create_placement` via RPC

### Impor CSV (Bulk)
- Klik **Impor CSV** → pilih file `.csv`
- Format kolom: `nis, login_dudi, tanggal_mulai, tanggal_selesai`
- Diproses via edge function `bulk-import-pkl`
- Return: `{ success, skipped, failed }`

### Unduh Template CSV
- Generate file `template_penempatan_pkl.csv` dengan satu baris contoh
- Dibuat langsung di browser via Blob — tidak ada request ke server

### Setelah Penempatan Berhasil
- Siswa berpindah status `AKTIF → PKL`
- Muncul di Daftar Siswa PKL
- Hilang dari dropdown form
- Stat cards direfresh otomatis

### Selesaikan PKL
Tombol **Selesaikan PKL** ada di Daftar Siswa PKL (bukan di section ini).
Klik → konfirmasi → panggil `fn_finish_placement` via RPC → siswa kembali `PKL → AKTIF`.

### Fungsi
- `fn_create_placement(p_student_id, p_dudi_user_id, p_start_date, p_end_date)` —
  atomic: INSERT pkl_placements + UPDATE student_status = 'PKL' dalam satu transaksi
- `fn_finish_placement(p_student_id, p_placement_id)` —
  atomic: UPDATE is_active = false + UPDATE student_status = 'AKTIF' dalam satu transaksi
- `bulkImportPkl(csvText)` — edge function bulk-import-pkl
- `initKpPlacementForm(programId)` — init form, bind event listeners
- `handleFinishPkl(btn)` — handler tombol Selesaikan PKL

---

## 5. Daftar Siswa PKL

Tabel semua siswa yang berstatus PKL di program keahlian ini.
Data diambil dari `fetchPklStudents(programId)` — filter `student_status = 'PKL'`.

### Stat Cards (ditampilkan di atas tabel)
| Card | Nilai |
|---|---|
| Total Siswa PKL | Jumlah seluruh siswa PKL di program ini |
| Sudah Ditempatkan | Siswa yang punya placement aktif (`is_active = true`) |
| Belum Ditempatkan | Total PKL dikurangi yang sudah ditempatkan |

### Tabel
Layout: `table-layout: fixed`, lebar kolom ditentukan via `<colgroup>`.

| Kolom | Lebar | Isi |
|---|---|---|
| Nama | 22% | `full_name` siswa |
| NIS | 12% | Nomor induk siswa |
| Tempat PKL | 28% | `dudi_org_name` mitra aktif |
| Periode | 24% | `start_date – end_date` penempatan aktif |
| Aksi | 14% | Tombol "Selesaikan PKL" jika sudah ditempatkan, `—` jika belum |

Jika belum ada siswa PKL → tabel kosong, tampil pesan "Belum ada siswa PKL pada program ini."

### Selesaikan PKL
- Klik tombol **Selesaikan PKL** → konfirmasi dialog
- Panggil `fn_finish_placement` via RPC → siswa kembali `PKL → AKTIF`
- Setelah berhasil: refresh tabel, stat cards, dan dropdown siswa di form Penempatan PKL

### Fungsi
- `fetchPklStudents(programId)` — fetch siswa PKL + placement aktif
- `renderKpStudents()` — render tabel
- `renderKpSummary()` — render stat cards
- `handleFinishPkl(btn)` — handler tombol Selesaikan PKL

---

## 6. Rekap Absensi PKL

Rekap kehadiran harian siswa PKL di tempat PKL masing-masing.
Data diambil via RPC `fn_pkl_attendance_recap` — server-side aggregation.

### Filter
- **Dari / s/d**: rentang tanggal — default 30 hari ke belakang s/d hari ini
- Tombol **Filter** memuat ulang data

### Tabel
Layout: `table-layout: fixed` dengan `<colgroup>`.

| Kolom | Lebar | Isi |
|---|---|---|
| Nama / NIS | 40% | `full_name` + `nis` siswa PKL |
| H | 12% | Jumlah hari Hadir |
| I | 12% | Jumlah hari Izin |
| S | 12% | Jumlah hari Sakit |
| A | 12% | Jumlah hari Alpa |
| % | 12% | Persentase kehadiran — warna sesuai threshold platform |

Warna %: hijau ≥ 80%, kuning ≥ 60%, merah < 60%.
Jika belum ada data → tampil pesan "Belum ada data absensi pada rentang ini."

### Catatan
- Hanya siswa yang berstatus PKL (`kpStudents`) yang direkap
- Jika tidak ada siswa PKL → tidak ada RPC call (guard `ids.length === 0`)

### Fungsi
- `loadKpRecap()` — load dan render rekap
- `fetchPklAttendance(studentIds, dateStart, dateEnd)` — RPC `fn_pkl_attendance_recap`

---

## 7. Observasi dari DUDI

Daftar observasi yang dikirim oleh mitra DUDI terhadap siswa PKL
di program keahlian ini. Ditampilkan sebagai card per observasi.

### Sumber Data
- Tabel `observations`, filter `student_id IN (siswa PKL program ini)`
- Filter `role_type = 'DUDI'` diterapkan di server via `.eq('author.role_type', 'DUDI')`
- Client-side filter tetap ada sebagai guard
- Diurutkan terbaru di atas (`created_at DESC`), limit 200

### Card Observasi
Setiap card menampilkan:
- Nama siswa · Nama DUDI (`dudi_org_name`) · Dimensi · Tanggal observasi
- Isi observasi (`content`)
- Warna card mengikuti `sentiment` (positif/negatif/netral)

### Kondisi Kosong
Jika tidak ada siswa PKL atau tidak ada observasi →
tampil pesan "Belum ada observasi dari DUDI."

### Fungsi
- `loadKpObs()` — load dan render observasi
- `fetchDudiObservations(studentIds)` — fetch dari tabel `observations`

### Catatan Teknis
- Tanggal observasi menggunakan `observed_at`, fallback ke `created_at`
- Guard `studentIds.length === 0` → tidak ada query jika tidak ada siswa PKL

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
- `kpTabInitialized`: guard boolean — `initKaprodiTab()` hanya dieksekusi
  sekali per sesi. Klik tab berikutnya langsung return tanpa fetch ulang.
  Untuk melihat data terbaru, guru perlu reload halaman.
- `kaprodiAllStudents`: gabungan siswa PKL + siswa aktif,
  dipakai sebagai pool pencarian di fitur Observasi dan Buat Kasus

---

*Dokumen ini adalah referensi definitif.
Setiap perubahan perilaku fitur harus diupdate di sini sebelum diimplementasi.*
