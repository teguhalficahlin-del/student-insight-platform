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

Nilai enum DB: HADIR, IZIN, SAKIT, ALPA
(ALPA sebelumnya bernama TIDAK_HADIR di DB — diganti via migration 20260716164801)

### Input Absensi
- Dilakukan per blok (bukan per slot)
- Modal input absensi menampilkan daftar siswa yang terdaftar
  di kelas tempat guru mengajar pada sesi tersebut
- Tidak ada siswa dari kelas lain yang tampil — isolasi per kelas
  ditegakkan di level query
- Guru dapat memilih status per siswa: Hadir, Izin, Sakit, atau Alpa
- Daftar siswa ditampilkan dengan paginasi (5 siswa per halaman)
- Tombol "Simpan Kehadiran (N siswa)" menyimpan semua status sekaligus
- Hanya guru yang mengajar blok tersebut yang bisa input
- Default status semua siswa adalah HADIR saat modal dibuka —
  guru hanya perlu mengubah siswa yang tidak hadir
- Tidak ada tombol hapus di UI - pembatalan via is_void = true

### Keterbatasan
- Tidak ada team teaching — satu blok hanya diajar satu guru
- Tidak ada mekanisme guru pengganti di portal ini
- Fitur guru pengganti (substitute_schedules) sudah ada di DB dan backend
  tapi DEPRECATED — tidak ada UI di portal guru dan tidak akan dipakai.
  Akan dihapus dalam sprint tersendiri setelah go-live.

## 2. Kolom Rekap Kehadiran

| Kolom | Definisi |
|---|---|
| HADIR | Jumlah blok yang statusnya HADIR |
| IZIN | Jumlah blok yang statusnya IZIN |
| SAKIT | Jumlah blok yang statusnya SAKIT |
| ALPA | Jumlah blok yang statusnya ALPA |
| TOTAL | Jumlah blok yang sudah diinput absensinya (bukan jumlah blok terjadwal) |
| % HADIR | HADIR dibagi TOTAL dikali 100 |

Catatan: jika belum ada absensi yang diinput untuk suatu blok,
blok tersebut tidak dihitung di TOTAL — nilainya 0 bukan terjadwal.

### Kode Warna % Hadir

Berlaku di semua portal dan semua role yang menampilkan % hadir:

| Rentang | Warna | Arti |
|---|---|---|
| ≥ 80% | Hijau | Kehadiran baik |
| ≥ 60% dan < 80% | Kuning | Kehadiran perlu perhatian |
| < 60% | Merah | Kehadiran bermasalah |

Threshold ini diterapkan secara konsisten di:
- Tab Guru — rekap kehadiran kelas yang diajar
- Tab Wali Kelas — rekap kehadiran kelas walian
- Tab Kaprodi — rekap kehadiran kelas di program keahlian
- Tab Waka Kesiswaan — rekap kehadiran semua kelas
- Portal Siswa — % hadir milik sendiri
- Portal Orang Tua — % hadir anak

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
Tabel absensi ditampilkan collapsed per blok pertemuan.
Satu baris = satu blok (1–7 slot berurutan dalam satu hari).
Kolom: Tanggal, Jam (range first–last slot), Mata Pelajaran, Guru, Status.
Jika blok punya lebih dari 1 slot: baris bisa diklik untuk expand detail per slot.
Status summary per blok: HADIR/IZIN/SAKIT/ALPA jika semua slot sama,
CAMPURAN jika ada slot dengan status berbeda.
Stat cards (Hadir/Izin/Sakit/Alpa/%) dihitung per slot, bukan per blok.

### Orang Tua
Sama dengan portal Siswa — tabel collapsed per blok pertemuan.
Kolom: Tanggal, Jam, Mata Pelajaran, Guru, Status, Catatan.
Klik baris multi-slot → expand detail per slot.
Stat cards dihitung per slot.

### Guru Mapel
Rekap kelas yang diajar (per mapel)
  → klik satu kelas → accordion per siswa
    → klik accordion siswa → detail sesi mapel yang diajar guru itu saja
    (filter by teacher_id — sesi mapel lain tidak tampil).
    Detail sesi hanya dimuat jika filter tanggal (start dan end) sudah diset.
    Jika belum, accordion menampilkan hint untuk memilih tanggal atau menggunakan fitur Unduh Excel.
- Tersedia tombol **Unduh CSV** untuk export rekap kehadiran
  semua siswa kelas yang dipilih dalam rentang tanggal yang ditentukan
- CSV berisi: Nama, NIS, Hadir, Izin, Sakit, Alpa, Total Sesi, % Hadir

### Wali Kelas
Rekap semua siswa di kelas yang diwalikan
  → klik satu siswa → detail per pertemuan (tanggal, mapel, status)

### Kaprodi
Rekap semua kelas di program keahlian (agregat per kelas)
  → klik satu kelas → rekap per siswa
    → klik satu siswa → detail per pertemuan (tanggal, mapel, status)

### Waka / BK
Rekap semua kelas di sekolah (agregat per program keahlian)
  → klik satu program → rekap per kelas (agregat)
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
| fn_sync_attendance_batch | RPC yang dipanggil saat guru submit — UPSERT absensi siswa + flip teacher_indicator PENDING→HADIR real-time (session_date = hari ini) |

## 6. Catatan Teknis

- block_group_id: penghubung slot-slot dalam satu blok di teaching_schedules
- is_void = true: mekanisme pembatalan absensi (soft delete), record tetap ada
- Hard DELETE diizinkan di level DB untuk guru mapel,
  tapi tidak ada tombol hapus di UI portal guru
- RLS policy aktif di semua tabel terkait:
  - attendance: 4 policy aktif (rw_guru, read_parent, read_staff, read_student)
     + 1 deprecated (rw_substitute — akan dihapus setelah go-live)
     read_staff berlaku untuk role: WALI_KELAS, KAPRODI, WAKA_KESISWAAN,
     WAKA_KURIKULUM, BK, KEPSEK
  - teaching_schedules: dipakai sebagai join untuk verifikasi hak akses guru

## 7. Hubungan Absensi Siswa dengan Kehadiran Guru

### Prinsip Dasar
Guru submit absensi siswa = bukti guru hadir mengajar pada sesi tersebut.
Tidak ada mekanisme terpisah untuk guru menandai diri sendiri hadir.

### Alur Teknis
1. Guru submit absensi siswa pada sesi terjadwal
2. `fn_sync_attendance_batch` (RPC) dijalankan — dalam satu transaksi:
   - UPSERT record absensi siswa ke tabel `attendance`
   - Flip `teacher_indicator`: PENDING_EVALUATION → HADIR (real-time)
   - Hanya berlaku jika session_date = hari ini
3. Trigger `fn_teacher_attendance_signal` aktif setelah INSERT ke `attendance`:
   - Insert sinyal ke `teacher_attendance_log` sebagai audit trail
   - Hanya aktif jika session_date = hari ini dan teacher_indicator masih PENDING_EVALUATION
4. Rekap kehadiran guru di tab Waka Kurikulum membaca `teacher_indicator`
   via `fn_attendance_fill_rate` — nilai sudah HADIR secara real-time

### Jika Guru Tidak Submit
1. Guru tidak submit absensi sebelum sesi berakhir
2. `fn_evaluate_teacher_indicators` dipanggil oleh edge function
   `evaluate-teacher-indicators` via cron job harian (00:00 WIB, pg_cron + pg_net)
   membalik `PENDING_EVALUATION → TIDAK_HADIR`
3. Tercatat sebagai tidak hadir di rekap Waka Kurikulum

### Batas Waktu Submit
- Guru hanya bisa submit absensi pada hari dan jam sesi yang terjadwal
- Tidak bisa submit mundur (backdated)
- Tombol input/koreksi absensi disabled jika merged_end sesi sudah
  terlewat pada hari tersebut. Sesi yang belum terjadi (hari yang
  sama tapi jam belum lewat) tetap aktif dan bisa diinput.
- Guard backdated ada di `fn_teacher_attendance_signal`:
  hanya aktif jika `session_date` = hari ini

### Nilai teacher_indicator
| Nilai | Arti |
|---|---|
| `PENDING_EVALUATION` | Sesi belum diisi absensi siswa — status awal saat jadwal dibuat |
| `HADIR` | Guru sudah submit absensi siswa sebelum sesi berakhir |
| `TIDAK_HADIR` | Guru tidak submit sampai sesi berakhir — diset oleh scheduled job |

Catatan: `teacher_indicator` menggunakan enum `teacher_attendance_indicator`
(berbeda dengan `attendance_status` siswa yang memakai HADIR/IZIN/SAKIT/ALPA).
Nilai `TIDAK_HADIR` di sini merujuk ketidakhadiran GURU, bukan siswa.

---

Dokumen ini adalah referensi definitif.
Setiap perubahan perilaku fitur harus diupdate di sini sebelum diimplementasi.
