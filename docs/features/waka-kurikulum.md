# Definisi Fitur: Tab Waka Kurikulum

## 1. Tujuan

Tab Waka Kurikulum adalah dashboard monitoring kehadiran guru mengajar.
Waka Kurikulum dapat memantau sesi mana yang belum diisi absensi siswa
(sebagai bukti guru hadir) dan merekap kehadiran guru dalam rentang waktu tertentu.

Tab ini hanya tampil untuk role WAKA_KURIKULUM.

---

## 2. Sumber Data

Seluruh data di tab ini berasal dari tabel `teaching_schedules`,
bukan dari tabel `attendance`.

| Kolom | Arti |
|---|---|
| `teacher_indicator` | Status kehadiran guru per sesi |
| `meeting_status` | Status sesi (hanya `NORMAL` yang dihitung) |
| `session_date` | Tanggal sesi |

Nilai `teacher_indicator`:

| Nilai | Arti |
|---|---|
| `PENDING_EVALUATION` | Sesi belum diisi absensi siswa — status awal |
| `HADIR` | Guru sudah submit absensi siswa sebelum sesi berakhir |
| `TIDAK_HADIR` | Guru tidak submit sampai sesi berakhir — diset oleh cron harian |

Proses evaluasi `teacher_indicator` dijelaskan di
`docs/features/absensi.md` section 7.

---

## 3. Tiga Card Ringkasan

Tampil di bagian atas tab. Ada dua set card — Panel 1 (hari ini)
dan Panel 2 (rentang waktu kustom).

### Panel 1 — Hari ini

| Card | Label | Nilai | Scope |
|---|---|---|---|
| Card 1 | Sudah isi absensi | Jumlah sesi `HADIR` | Hari ini |
| Card 2 | Belum diisi | Jumlah sesi `PENDING_EVALUATION` | Hari ini |
| Card 3 | Tidak hadir | Jumlah sesi `TIDAK_HADIR` | 7 hari terakhir |

Card 3 sengaja menggunakan 7 hari terakhir (bukan hanya hari ini)
agar Waka Kurikulum bisa melihat tren ketidakhadiran guru dalam seminggu,
bukan hanya hari ini yang mungkin masih PENDING.

### Panel 2 — Rentang Waktu Kustom

| Card | Label | Nilai | Scope |
|---|---|---|---|
| Card 1 | Sudah isi absensi | Jumlah sesi `HADIR` | Rentang yang dipilih |
| Card 2 | Belum diisi | Jumlah sesi `PENDING_EVALUATION` | Rentang yang dipilih |
| Card 3 | Tidak hadir | Jumlah sesi `TIDAK_HADIR` | Rentang yang dipilih |

Semua card Panel 2 mengikuti rentang tanggal yang dipilih user.

Fungsi DB: `fn_attendance_fill_rate(p_date_start, p_date_end)`

---

## 4. Panel 1 — Sesi Belum Diisi Hari Ini

Tabel yang menampilkan daftar sesi hari ini yang belum diisi absensi
(`teacher_indicator = PENDING_EVALUATION`).

Kolom: NO, NAMA GURU, MATA PELAJARAN, KELAS, SESI (jam mulai–selesai)

Fitur:
- Tombol **Muat Ulang** — refresh data tabel dan 3 card sekaligus
- Tombol **Sembunyikan/Tampilkan** — toggle visibilitas tabel
- Jika tidak ada sesi pending → tampil pesan "✓ Tidak ada sesi..."

Fungsi DB: `fn_pending_sessions_detail(p_date)`

---

## 5. Panel 2 — Sesi Belum Diisi Rentang Waktu

Tabel per guru yang menampilkan jumlah sesi belum diisi
dalam rentang tanggal yang dipilih user.

Input: tanggal Dari dan s/d (default: 7 hari terakhir s/d hari ini)

Kolom tabel: NAMA GURU, SESI BELUM DIISI (jumlah)
Klik baris guru → expand detail sesi yang belum diisi

Alert threshold: jika satu guru punya ≥ 10 sesi belum diisi,
baris ditandai dengan visual alert.

Fitur:
- Tombol **Tampilkan** — load data sesuai rentang
- 3 card stats muncul bersamaan dengan tabel
- Jika tidak ada sesi pending → tampil pesan konfirmasi

Fungsi DB: `fn_pending_sessions_by_teacher(p_date_start, p_date_end)`

---

## 6. Isolasi Akses

| Role | Akses |
|---|---|
| WAKA_KURIKULUM | Melihat seluruh data kehadiran guru di sekolahnya |
| Role lain | Tab tidak tampil |
| Sekolah lain | Tidak ada akses silang (RLS school_id) |

---

## 7. Fungsi Database

| Fungsi | Kegunaan |
|---|---|
| `fn_attendance_fill_rate` | Hitung distribusi teacher_indicator dalam rentang tanggal |
| `fn_pending_sessions_detail` | Daftar sesi PENDING hari ini (untuk Panel 1) |
| `fn_pending_sessions_by_teacher` | Rekapitulasi sesi PENDING per guru dalam rentang (untuk Panel 2) |

---

## 8. Catatan Teknis

- Data di tab ini mencerminkan `teacher_indicator` di `teaching_schedules`,
  BUKAN jumlah record di tabel `attendance`
- `teacher_indicator` dievaluasi setiap hari jam 00:00 WIB oleh cron job
  `evaluate-teacher-indicators` — lihat `docs/features/absensi.md` section 7
- Sesi dengan `meeting_status != 'NORMAL'` tidak dihitung
  (contoh: sesi yang dibatalkan atau diganti)
- Alert threshold ≥ 10 sesi per guru di Panel 2

---

*Dokumen ini adalah referensi definitif.
Setiap perubahan perilaku fitur harus diupdate di sini sebelum diimplementasi.*
