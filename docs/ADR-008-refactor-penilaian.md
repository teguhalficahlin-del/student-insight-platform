# ADR-008: Refactor Tab Penilaian SIP SMK — Adopsi Arsitektur SIP Mandiri

**Tanggal:** 9 Agustus 2026  
**Status:** ACCEPTED  
**Decider:** Romo (Teguh Riyono)

---

## Konteks

Tab Penilaian di portal guru SIP SMK dibangun Juli 2026 dengan arsitektur
pertama (6 tabel: `learning_objectives`, `learning_objective_classes`,
`assessment_criteria`, `grading_settings`, `tp_assessments`, `grade_summaries`).
Arsitektur ini punya tiga masalah:

1. **Terlalu banyak konsep yang harus diisi guru sebelum bisa input nilai.**
   Guru harus membuat TP, mengatur KKTP, mengisi `grading_settings`
   (bobot formatif/sumatif), baru bisa input nilai. Alur terlalu panjang.

2. **Kalkulasi nilai akhir via RPC `fn_calculate_grade_summary` terlalu kaku.**
   Satu tombol "Hitung Nilai Akhir" memproses semua siswa sekaligus via DB
   function, tanpa visibility intermediate. Guru tidak bisa melihat nilai
   akhir siswa satu per satu sebelum menekan tombol.

3. **Tidak ada konsep tindak lanjut per siswa.**
   Tidak ada mekanisme untuk mencatat apakah siswa perlu PENGAYAAN,
   PENGUATAN, atau PENDAMPINGAN — padahal ini bagian wajib Kurikulum Merdeka.

SIP Mandiri (platform kelas berbasis `classroom_id`) sudah memecahkan ketiga
masalah ini dengan arsitektur yang lebih flat dan granular. Keputusan:
refactor tab Penilaian SIP SMK mengikuti arsitektur SIP Mandiri.

---

## Keputusan

### 1. Tabel baru yang diadopsi dari SIP Mandiri

| Tabel | Peran |
|---|---|
| `assessments` | Entri pelaksanaan penilaian (judul, tipe, tanggal) — terpisah dari nilai siswa |
| `student_grades` | Nilai per siswa per entri penilaian, dengan `tindak_lanjut` + `is_published` |
| `assessment_rubric_criteria` | Kriteria rubrik untuk penilaian Sumatif Rubrik |
| `assessment_rubric_results` | Hasil rubrik per siswa per kriteria |

### 2. Jenis penilaian baru

Tambah tiga jenis ke FORMATIF + SUMATIF yang sudah ada:

| Kode | Keterangan |
|---|---|
| `DIAGNOSTIK_NK` | Diagnostik non-kognitif (awal tahun / awal topik) |
| `DIAGNOSTIK_K` | Diagnostik kognitif (prasyarat materi) |
| `SUMATIF_RUBRIK` | Sumatif berbasis rubrik multi-kriteria |

### 3. Tindak lanjut per siswa

`student_grades.tindak_lanjut` enum: `PENGAYAAN` / `PENGUATAN` / `PENDAMPINGAN`.
Nullable — hanya diisi jika guru mengambil keputusan tindak lanjut.

### 4. Publikasi per entri penilaian

`assessments.is_published` + `student_grades.is_published`.
Menggantikan `grading_settings.is_published` yang berlaku per mapel/kelas/semester
— lebih granular, guru bisa publish satu entri penilaian tanpa harus publish semua.

### 5. Kalkulasi nilai akhir dipindah ke JS

`fn_calculate_grade_summary` dihapus. Kalkulasi nilai akhir dilakukan di JS
(client-side) berdasarkan `student_grades` yang sudah diambil. Guru bisa melihat
preview nilai akhir sebelum memutuskan publikasi.

### 6. Struktur UI baru: dua section

Menggantikan 3 tombol sub-tab lama (Setup TP & KKTP / Input Nilai / Nilai Akhir):

- **Section Perencanaan:** TP + KKTP mengikuti model SIP Mandiri
- **Section Pelaksanaan:** D-NK, D-K, Formatif, Sumatif Skor, Sumatif Rubrik,
  tindak lanjut per siswa, publikasi per entri, nilai akhir

Selector konteks (Kelas / Mapel / Tahun Ajaran / Semester) tidak diubah.

---

## Yang Dihapus

### Tabel (data boleh hilang — belum ada data produksi yang perlu dipertahankan)

| Tabel | Alasan dihapus |
|---|---|
| `tp_assessments` | Digantikan `assessments` + `student_grades` |
| `grade_summaries` | Kalkulasi nilai akhir pindah ke JS, tidak perlu tabel hasil kalkulasi |
| `grading_settings` | Pengaturan bobot/metode kalkulasi tidak relevan di arsitektur baru |
| `learning_objectives` | Digantikan model TP di arsitektur SIP Mandiri |
| `learning_objective_classes` | Ikut dihapus bersama `learning_objectives` |
| `assessment_criteria` (KKTP lama) | Digantikan KKTP di model TP arsitektur baru |

### Fungsi DB

| Fungsi | Alasan dihapus |
|---|---|
| `fn_calculate_grade_summary` | Kalkulasi pindah ke JS |
| `fn_get_grade_summary` | Portal guru akan baca langsung dari tabel baru |
| `fn_grading_is_published` | Tidak ada `grading_settings` lagi |
| `fn_grade_published_for_me` | Tidak ada `grade_summaries` lagi |
| `fn_grade_published_for_student` | Tidak ada `grade_summaries` lagi |

### UI

- 3 tombol sub-tab: Setup TP & KKTP / Input Nilai / Nilai Akhir
- Section Pengaturan Kalkulasi (bobot formatif/sumatif, metode kalkulasi)

---

## Urutan Eksekusi yang Aman

Urutan ini sudah diverifikasi via INVERT check sebelum ADR ini ditulis.

```
Langkah 1  Buat tabel baru
           assessments, student_grades,
           assessment_rubric_criteria, assessment_rubric_results
           ──────────────────────────────────────────────────────
           Additive murni. Tidak menyentuh tabel lama.
           Tidak ada risiko downtime.

Langkah 2  Tulis ulang fn_get_all_grades_summary
           Baca dari student_grades, bukan grade_summaries.
           ──────────────────────────────────────────────────────
           Syarat: Langkah 1 selesai (student_grades harus exist).
           Efek samping: portal siswa/ortu tampil "Belum ada nilai"
           sampai guru input ulang di sistem baru.
           Ini expected — data lama tidak dimigrasi.

Langkah 3  Update semua RLS
           Drop policy tp_assessments yang panggil fn_grading_is_published
           (rls_tp_assessments_select_siswa/ortu/wali/kaprodi/wakasis).
           Drop policy learning_objectives, learning_objective_classes,
           assessment_criteria yang panggil fn_grade_published_for_me /
           fn_grade_published_for_student.
           ──────────────────────────────────────────────────────
           WAJIB selesai sebelum Langkah 4.
           Jika grading_settings di-drop sebelum policy diupdate,
           fn_grading_is_published runtime error → portal siswa/ortu HTTP 500.

Langkah 4+5  SATU TRANSAKSI ATOMIK — fungsi dulu, tabel kemudian
           DROP FUNCTION fn_calculate_grade_summary(UUID,UUID,VARCHAR,INTEGER);
           DROP FUNCTION fn_get_grade_summary(UUID,UUID,VARCHAR,INTEGER);
           DROP FUNCTION fn_grading_is_published(UUID,UUID,UUID,UUID);
           DROP FUNCTION fn_grade_published_for_me(UUID,UUID);
           DROP FUNCTION fn_grade_published_for_student(UUID,UUID,UUID);
           DROP TABLE tp_assessments;
           DROP TABLE grade_summaries;
           DROP TABLE grading_settings;
           DROP TABLE learning_objective_classes;
           DROP TABLE assessment_criteria;
           DROP TABLE learning_objectives;  ← terakhir (FK dari tp_assessments)
           ──────────────────────────────────────────────────────
           Fungsi dulu sebelum tabel: jika tabel di-drop lebih dulu,
           ada window dimana fungsi masih ada tapi tabelnya hilang.
           learning_objectives paling terakhir karena tp_assessments
           punya FK ke learning_objectives (ON DELETE CASCADE) —
           tp_assessments harus di-drop lebih dulu.
           Tidak ada FK dari tabel lain ke ketiga tabel yang di-drop
           (sudah diverifikasi via grep REFERENCES).

Langkah 6  Refactor UI portal guru
           Hapus 3 tombol sub-tab dari HTML + JS.
           Hapus section Pengaturan Kalkulasi.
           Buat section Perencanaan + Pelaksanaan mengikuti SIP Mandiri.
           ──────────────────────────────────────────────────────
           Syarat: semua Langkah DB (1–5) selesai dulu.
           Jika UI di-push sebelum DB selesai, guru dengan halaman lama
           di cache browser akan error saat memanggil fn_get_grade_summary
           yang sudah tidak ada.
```

---

## Konsekuensi

1. **Data loss yang disadari dan diterima.** Semua data di `tp_assessments`,
   `grade_summaries`, `grading_settings`, `learning_objectives`, `assessment_criteria`
   akan dihapus permanen. Data ini belum dipakai produksi — tidak ada guru yang
   sudah input nilai di sistem lama.

2. **Downtime data portal siswa/ortu.** Setelah Langkah 2, portal siswa dan
   orang tua akan tampil "Belum ada nilai yang dipublikasi" sampai guru
   menginput nilai baru di sistem baru. Ini window yang tidak bisa dihindari
   dan harus dikomunikasikan ke pengguna.

3. **fn_get_grade_summary dan fn_calculate_grade_summary hilang.**
   Jika ada caller lain yang belum terdeteksi di audit (portal non-guru),
   mereka akan error setelah Langkah 4. Audit grep sudah dilakukan — tidak
   ditemukan caller di luar `guru/js/dashboard.js`.

4. **Selector konteks tidak berubah.** Kelas/Mapel/Tahun Ajaran/Semester
   tetap sama — guru tidak perlu belajar ulang cara membuka tab.

---

## Yang Belum Diputuskan

- Schema tabel `assessments`, `student_grades`, `assessment_rubric_criteria`,
  `assessment_rubric_results` untuk SIP SMK — akan mengikuti SIP Mandiri
  dengan penyesuaian `school_id` tenant anchor (SIP Mandiri pakai `classroom_id`).
- RLS tabel baru — akan dibuat di migration terpisah setelah schema final.
- Apakah `fn_get_grade_summary` perlu digantikan RPC baru untuk portal
  Waka Kurikulum / Kepsek / Kaprodi yang membaca nilai lintas guru.

---

## ATURAN KERJA CLAUDE CODE

```
BATASAN KERAS migration ini:
- Langkah 3 WAJIB dalam satu migration yang commit sebelum Langkah 4 dimulai
- Langkah 4+5 WAJIB dalam satu BEGIN...COMMIT (atomik)
- learning_objectives di-DROP paling terakhir dalam transaksi Langkah 4+5
- supabase db push --linked --dry-run wajib ditampilkan verbatim sebelum push real
- git push origin main hanya setelah konfirmasi eksplisit Claude Chat + Romo
```
