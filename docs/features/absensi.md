# Definisi Fitur: Absensi

## 1. Konsep Dasar

### Pertemuan (Blok)
- Satu pertemuan = satu blok mengajar dalam satu hari
- Satu blok bisa terdiri dari 2-4 slot waktu berurutan
- Contoh: 07:55-08:35 + 08:35-09:15 = 1 pertemuan (1 blok)
- Identifikasi blok menggunakan block_group_id di tabel teaching_schedules

### Status Kehadiran
- HADIR: siswa hadir seluruh blok
- IZIN: siswa tidak hadir dengan izin
- SAKIT: siswa tidak hadir karena sakit
- ALPA: siswa tidak hadir tanpa keterangan
- Tidak ada mekanisme hadir sebagian (terlambat/keluar awal)
- Jika hadir di satu slot blok, statusnya HADIR penuh

### Input Absensi
- Dilakukan per blok (bukan per slot)
- Hanya guru yang mengajar blok tersebut yang bisa input
- Guru pengganti bisa input selama token pengganti belum expired
- Tidak ada tombol hapus di UI - pembatalan via is_void = true

## 2. Kolom Rekap Kehadiran

| Kolom | Definisi |
|---|---|
| HADIR | Jumlah blok yang statusnya HADIR |
| IZIN | Jumlah blok yang statusnya IZIN |
| SAKIT | Jumlah blok yang statusnya SAKIT |
| ALPA | Jumlah blok yang statusnya ALPA |
| TOTAL | Jumlah blok yang sudah diinput absensinya (bukan jumlah blok terjadwal) |
| % HADIR | HADIR dibagi TOTAL dikali 100 |

## 3. Isolasi Akses

Setiap level akses dibatasi secara ketat.
Tidak ada akses silang antar sekolah, antar program keahlian,
antar kelas, maupun antar siswa.

| Role | Batas Akses | Tidak Bisa Akses |
|---|---|---|
| Guru Mapel | Absensi kelas + mapel yang diajarnya saja | Mapel lain di kelas yang sama; kelas lain |
| Wali Kelas | Semua absensi di kelas yang diwalikan | Kelas lain |
| Kaprodi | Semua absensi kelas di program keahliannya | Kelas di program lain |
| Waka / BK | Semua absensi semua kelas di sekolahnya | Sekolah lain |
| Kepsek | Data agregat di sekolahnya saja | Detail per siswa; sekolah lain |
| Siswa | Absensi milik diri sendiri saja | Absensi siswa lain |
| Orang Tua | Absensi anak sendiri saja | Absensi siswa lain |
| Antar Sekolah | Tidak ada akses silang sama sekali | - |

Isolasi ditegakkan di level database via RLS policy (school_id selalu difilter)
dan fungsi helper (fn_can_see_student, fn_teaches_student, dst).

## 4. Drill Down Rekap Absensi

### Siswa
Langsung melihat detail absensi milik diri sendiri per pertemuan.
Tidak ada drill down - langsung ke level paling detail.

### Orang Tua
Langsung melihat detail absensi anak per pertemuan.
Tidak ada drill down - langsung ke level paling detail.

### Guru Mapel
Rekap kelas yang diajar (per mapel)
  → klik satu kelas → rekap per siswa
    → klik satu siswa → detail per pertemuan (tanggal, mapel, status)

### Wali Kelas
Rekap semua siswa di kelas yang diwalikan
  → klik satu siswa → detail per pertemuan (tanggal, mapel, status)

### Kaprodi
Rekap semua kelas di program keahlian (agregat per kelas)
  → klik satu kelas → rekap per siswa
    → klik satu siswa → detail per pertemuan (tanggal, mapel, status)

### Waka / BK
Rekap semua kelas di sekolah (agregat per kelas)
  → klik satu kelas → rekap per siswa
    → klik satu siswa → detail per pertemuan (tanggal, mapel, status)

### Kepsek
Rekap agregat per kelas atau per program keahlian.
Tidak bisa drill down ke level siswa individual.

## 5. Fungsi Database

| Fungsi | Kegunaan |
|---|---|
| fn_class_attendance_summary | Rekap per siswa dalam satu kelas |
| fn_attendance_recap_per_class | Rekap per kelas (agregat) |
| fn_attendance_fill_rate | Fill rate absensi guru (berapa sesi sudah diisi) |

## 6. Catatan Teknis

- block_group_id: penghubung slot-slot dalam satu blok di teaching_schedules
- is_void = true: mekanisme pembatalan absensi (soft delete), record tetap ada
- Hard DELETE diizinkan di level DB untuk guru mapel,
  tapi tidak ada tombol hapus di UI portal guru
- RLS policy aktif di semua tabel terkait:
  - attendance: 5 policy (rw_guru, rw_substitute, read_parent, read_staff, read_student)
  - teaching_schedules: dipakai sebagai join untuk verifikasi hak akses guru

---

Dokumen ini adalah referensi definitif.
Setiap perubahan perilaku fitur harus diupdate di sini sebelum diimplementasi.
