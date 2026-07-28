# Rancangan Fitur Penilaian — SIP SMK
> Dokumen ini adalah rancangan final fitur penilaian formatif dan
> sumatif sesuai struktur Kurikulum Merdeka. Disusun berdasarkan
> Panduan Pembelajaran dan Asesmen Kemdikbud 2024 dan
> Permendikbudristek No. 21 Tahun 2022.
>
> Status: **FINAL — siap implementasi**
> Tanggal: 28 Juli 2026

---

## Prinsip Dasar

- Penilaian mengikuti struktur Kurikulum Merdeka: per Tujuan
  Pembelajaran (TP), dengan KKTP yang ditentukan guru
- Guru memiliki keleluasaan penuh: apakah formatif masuk kalkulasi,
  metode kalkulasi, apakah kalkulasi otomatis, dan apakah nilai
  dipublikasi ke siswa/ortu
- Siswa dan orang tua bisa melihat nilai jika guru mengaktifkan
  publikasi
- Tabel `learning_objectives` adalah tabel BARU untuk penilaian
  per guru — BUKAN menggantikan tabel `tujuan_pembelajaran`
  (20260715100000) yang berorientasi kurikulum nasional

---

## Tabel Baru

### 1. `learning_objectives` — Tujuan Pembelajaran per Guru

```sql
CREATE TABLE learning_objectives (
    learning_objective_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id             UUID NOT NULL REFERENCES schools(school_id),
    teacher_user_id       UUID NOT NULL REFERENCES users(user_id),
    subject_id            UUID NOT NULL REFERENCES public.subjects(subject_id),
    academic_year         VARCHAR(9) NOT NULL,        -- format "2024/2025"
    semester              INTEGER NOT NULL CHECK (semester IN (1,2)),
    kode_tp               VARCHAR(30) NOT NULL,       -- "TP 1.1", "TP 1.2"
    deskripsi_tp          TEXT NOT NULL,
    urutan                INTEGER NOT NULL DEFAULT 1,
    berlaku_untuk         VARCHAR(20) NOT NULL
                          CHECK (berlaku_untuk IN ('SEMUA_KELAS','KELAS_TERTENTU')),
    is_active             BOOLEAN NOT NULL DEFAULT TRUE,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (school_id, teacher_user_id, subject_id,
            academic_year, semester, kode_tp)
);

-- Index utama
CREATE INDEX idx_lo_teacher_year_sem
    ON learning_objectives(school_id, teacher_user_id, academic_year, semester);
```

### 2. `learning_objective_classes` — TP ↔ Kelas

```sql
CREATE TABLE learning_objective_classes (
    learning_objective_id UUID NOT NULL
        REFERENCES learning_objectives(learning_objective_id) ON DELETE CASCADE,
    class_id              UUID NOT NULL REFERENCES classes(class_id),
    school_id             UUID NOT NULL REFERENCES schools(school_id),
    PRIMARY KEY (learning_objective_id, class_id)
);
```

Diisi hanya jika `berlaku_untuk = 'KELAS_TERTENTU'`.

### 3. `assessment_criteria` — KKTP per TP

```sql
CREATE TABLE assessment_criteria (
    criterion_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    learning_objective_id UUID NOT NULL
        REFERENCES learning_objectives(learning_objective_id) ON DELETE CASCADE,
    school_id             UUID NOT NULL REFERENCES schools(school_id),
    batas_bawah           NUMERIC(5,2) NOT NULL,
    batas_atas            NUMERIC(5,2) NOT NULL,
    predikat              TEXT NOT NULL,
    keterangan            TEXT,
    CHECK (batas_bawah >= 0 AND batas_atas <= 100 AND batas_bawah < batas_atas)
);
```

Validasi overlap range dilakukan via **trigger** (bukan exclusion
constraint) — lebih mudah memberikan pesan error yang informatif
ke guru ("Range X-Y sudah dipakai oleh predikat Z").

### 4. `grading_settings` — Keputusan Guru per Mapel per Kelas

```sql
CREATE TABLE grading_settings (
    grading_setting_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id             UUID NOT NULL REFERENCES schools(school_id),
    teacher_user_id       UUID NOT NULL REFERENCES users(user_id),
    subject_id            UUID NOT NULL REFERENCES public.subjects(subject_id),
    class_id              UUID NOT NULL REFERENCES classes(class_id),
    academic_year         VARCHAR(9) NOT NULL,
    semester              INTEGER NOT NULL CHECK (semester IN (1,2)),
    -- Apakah formatif masuk kalkulasi nilai akhir?
    is_formatif_included  BOOLEAN NOT NULL DEFAULT FALSE,
    -- Metode jika formatif dimasukkan:
    -- BOBOT    = formatif dihitung dengan bobot tertentu
    -- KONTEKS_SAJA = formatif ditampilkan terpisah, tidak mempengaruhi angka
    metode_formatif       VARCHAR(20)
                          CHECK (metode_formatif IN ('BOBOT','KONTEKS_SAJA')),
    bobot_formatif        INTEGER CHECK (bobot_formatif BETWEEN 0 AND 100),
    bobot_sumatif         INTEGER CHECK (bobot_sumatif BETWEEN 0 AND 100),
    -- Kalkulasi dan publikasi
    is_auto_calculate     BOOLEAN NOT NULL DEFAULT TRUE,
    is_published          BOOLEAN NOT NULL DEFAULT FALSE,
    published_at          TIMESTAMPTZ,
    locked_at             TIMESTAMPTZ,
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (school_id, teacher_user_id, subject_id,
            class_id, academic_year, semester),
    -- Bobot harus = 100 jika metode BOBOT
    CHECK (metode_formatif <> 'BOBOT'
           OR (bobot_formatif + bobot_sumatif = 100)),
    -- Bobot hanya relevan jika formatif dimasukkan
    CHECK (is_formatif_included = TRUE
           OR (bobot_formatif IS NULL AND bobot_sumatif IS NULL))
);

CREATE INDEX idx_grading_settings_lookup
    ON grading_settings(school_id, teacher_user_id,
                        class_id, academic_year, semester);
```

### 5. `tp_assessments` — Nilai per Siswa per TP

```sql
CREATE TABLE tp_assessments (
    assessment_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id             UUID NOT NULL REFERENCES schools(school_id),
    learning_objective_id UUID NOT NULL
        REFERENCES learning_objectives(learning_objective_id),
    student_id            UUID NOT NULL REFERENCES students(student_id),
    teacher_user_id       UUID NOT NULL REFERENCES users(user_id),
    class_id              UUID NOT NULL REFERENCES classes(class_id),
    -- FORMATIF: satu siswa bisa punya banyak nilai per TP
    -- SUMATIF:  satu siswa bisa punya banyak nilai per TP (misal remedial)
    tipe                  VARCHAR(20) NOT NULL
                          CHECK (tipe IN ('FORMATIF','SUMATIF')),
    judul                 TEXT,          -- "Ulangan Harian 1", "Observasi", dst
    nilai_angka           NUMERIC(5,2)
                          CHECK (nilai_angka IS NULL
                                 OR (nilai_angka >= 0 AND nilai_angka <= 100)),
    nilai_kualitatif      TEXT,
    is_void               BOOLEAN NOT NULL DEFAULT FALSE,
    void_reason           TEXT,
    tanggal               DATE NOT NULL,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- Minimal salah satu nilai harus diisi
    CHECK (nilai_angka IS NOT NULL OR nilai_kualitatif IS NOT NULL)
);

CREATE INDEX idx_tp_assessments_student_lo
    ON tp_assessments(school_id, student_id, learning_objective_id);

CREATE INDEX idx_tp_assessments_class_lo
    ON tp_assessments(school_id, class_id, learning_objective_id, tipe);
```

### 6. `grade_summaries` — Nilai Akhir per Siswa per Mapel

```sql
CREATE TABLE grade_summaries (
    grade_summary_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id             UUID NOT NULL REFERENCES schools(school_id),
    student_id            UUID NOT NULL REFERENCES students(student_id),
    teacher_user_id       UUID NOT NULL REFERENCES users(user_id),
    subject_id            UUID NOT NULL REFERENCES public.subjects(subject_id),
    class_id              UUID NOT NULL REFERENCES classes(class_id),
    academic_year         VARCHAR(9) NOT NULL,
    semester              INTEGER NOT NULL CHECK (semester IN (1,2)),
    nilai_akhir           NUMERIC(5,2),
    predikat              TEXT,
    deskripsi_naratif     TEXT,          -- untuk rapor
    is_auto_calculate     BOOLEAN NOT NULL DEFAULT TRUE,
    last_calculated_at    TIMESTAMPTZ,   -- kapan terakhir dihitung
    published_at          TIMESTAMPTZ,   -- kapan dipublikasi ke siswa/ortu
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (school_id, student_id, subject_id,
            class_id, academic_year, semester)
);

CREATE INDEX idx_grade_summaries_student
    ON grade_summaries(school_id, student_id, academic_year, semester);

CREATE INDEX idx_grade_summaries_teacher
    ON grade_summaries(school_id, teacher_user_id,
                       class_id, academic_year, semester);
```

---

## Logika Kalkulasi

Kalkulasi dilakukan via **RPC eksplisit** `fn_calculate_grade_summary`
— dipanggil oleh client saat guru minta "Hitung Nilai Akhir".
Tidak menggunakan trigger otomatis (terlalu berat untuk agregasi
multi-baris).

```
JIKA is_formatif_included = FALSE:
  nilai_akhir = AVG(nilai_angka)
                WHERE tipe = 'SUMATIF' AND is_void = FALSE

JIKA is_formatif_included = TRUE AND metode_formatif = 'BOBOT':
  nilai_akhir = (AVG(formatif) × bobot_formatif / 100)
              + (AVG(sumatif)  × bobot_sumatif  / 100)

JIKA is_formatif_included = TRUE AND metode_formatif = 'KONTEKS_SAJA':
  nilai_akhir = AVG(nilai_angka)
                WHERE tipe = 'SUMATIF' AND is_void = FALSE
  -- formatif ditampilkan terpisah sebagai informasi konteks
```

Setelah kalkulasi → update `last_calculated_at`.

### Staleness Warning

Jika ada `tp_assessments.created_at > grade_summaries.last_calculated_at`
→ UI tampilkan peringatan:
"Ada perubahan nilai sejak terakhir dihitung — klik Hitung Ulang
untuk memperbarui nilai akhir"

---

## Alur Kerja Guru

```
1. SETUP (sekali per semester per mapel per kelas):
   a. Buat Tujuan Pembelajaran (TP) → learning_objectives
   b. Tentukan berlaku untuk semua kelas atau kelas tertentu
      → learning_objective_classes (jika KELAS_TERTENTU)
   c. Buat KKTP per TP → assessment_criteria
   d. Atur pengaturan kalkulasi → grading_settings

2. INPUT NILAI (rutin):
   a. Pilih TP
   b. Pilih siswa atau kelas
   c. Input nilai formatif atau sumatif → tp_assessments
   d. Bisa input lebih dari satu nilai formatif per siswa per TP
      (sistem akan ambil rata-rata)

3. HITUNG NILAI AKHIR:
   a. Klik "Hitung Nilai Akhir" → panggil fn_calculate_grade_summary
   b. Review hasil kalkulasi
   c. Tambah atau edit deskripsi naratif (untuk rapor)
   d. Override nilai akhir jika perlu (is_auto_calculate = FALSE)

4. PUBLIKASI:
   a. Klik "Publikasi" → published_at diisi, locked_at diisi
   b. Siswa dan orang tua bisa melihat nilai di portal masing-masing
   c. grading_settings terkunci — tidak bisa ubah bobot/metode
```

---

## Keputusan Teknis

| Topik | Keputusan | Alasan |
|-------|-----------|--------|
| Tipe semester | `INTEGER CHECK (IN (1,2))` | Konsisten dengan tabel Juli 2026 |
| Tipe domain baru | `VARCHAR CHECK` bukan enum | Ikuti pola Sprint 1, lebih fleksibel |
| Validasi overlap KKTP | Trigger | Lebih ramah pengguna, pesan error bisa informatif |
| Kalkulasi grade_summary | RPC eksplisit | Konsisten dengan pola rekap di proyek |
| FK teacher | `REFERENCES users(user_id)` | Konsisten dengan tabel domain lama |
| FK subjects | `REFERENCES public.subjects(subject_id)` | Eksplisit untuk hindari ambiguitas core.subjects |
| btree_gist | `CREATE EXTENSION IF NOT EXISTS` sebagai guard | Tidak dipakai untuk exclusion (diganti trigger) |

---

## Hubungan dengan Tabel yang Sudah Ada

- `tujuan_pembelajaran` (20260715100000) — tabel BERBEDA, berorientasi
  kurikulum nasional (punya cp_id, fase). `learning_objectives` adalah
  tabel penilaian per guru, tidak menggantikan tabel ini.
- `subjects` (public schema) — dipakai via FK `subject_id`
- `teaching_schedules` — tidak ada FK langsung, tapi guru yang sama
  mengajar mapel yang sama di kelas yang sama adalah konteks yang sama
- `attendance` — tidak ada FK langsung, tapi penilaian dan absensi
  adalah dua modul terpisah yang bisa direkap bersama di portal
  wali kelas / kaprodi
