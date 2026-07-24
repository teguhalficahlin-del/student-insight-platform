# ADR-004 — Teacher Workspace
# Student Insight Platform (SIP)
# Status: DRAFT v2 — OPEN untuk penyempurnaan
# Tanggal: 18 Juli 2026
# Berlaku untuk: Fitur AI Learning — SMK
# Bergantung pada: ADR-001, ADR-002, ADR-003

---

## 1. Konteks

Teacher Workspace adalah domain ketiga dalam arsitektur SIP.
Berisi seluruh artefak, preferensi, dan aset pribadi guru yang
tidak menjadi bagian dari SIP Core atau School Tenant.

ADR ini mendefinisikan:
- Document Graph (hierarki dan relasi antar dokumen guru)
- Schema tabel untuk setiap jenis dokumen
- Aturan scope (satu PPM untuk banyak kelas vs per kelas)
- Status dokumen (AI Draft → Direview → Disahkan)
- Mekanisme Reuse & Smart Update
- Snapshot konteks saat generate

---

## 2. Document Graph

Relasi antar dokumen berbentuk hierarki — bukan rantai linear.
Guru tidak diblokir paksa mengikuti urutan, tapi UI menampilkan
tanda peringatan jika prasyarat belum ada.

```
CP (dari core — tidak di-generate)
    ↓
[AI] TP + ATP
    ↓
[AI] Program Tahunan
    ↓
[AI] Program Semester
    ↓
[AI] PPM (per node TP)
    ↓           ↓
[AI] LKPD   [AI] Soal
                ↓
            [AI] Rubrik
```

### Aturan prasyarat (peringatan, bukan blokir)

| Dokumen          | Prasyarat ideal    | Jika belum ada     |
|------------------|--------------------|--------------------|
| Program Tahunan  | ATP                | Peringatan kuning  |
| Program Semester | Program Tahunan    | Peringatan kuning  |
| PPM              | ATP (node TP)      | Peringatan kuning  |
| LKPD             | PPM                | Peringatan kuning  |
| Soal             | PPM                | Peringatan kuning  |
| Rubrik           | Soal               | Peringatan kuning  |

Guru tetap bisa Generate tanpa prasyarat — peringatan hanya
sebagai panduan, bukan penghalang.

---

## 3. Scope Dokumen — Satu atau Banyak Kelas

Guru memilih scope saat Generate. Berlaku untuk semua jenis dokumen.

```
SCOPE PILIHAN GURU:

○ Semua kelas yang mengajar mapel ini
  → PPM berlaku untuk XI-TJK-A, XI-TJK-B, XI-RPL-A sekaligus
  → Satu dokumen, assign ke banyak kelas

○ Kelas tertentu saja
  → Pilih kelas mana yang ingin di-generate
  → Dokumen terpisah per kelas yang dipilih
```

Untuk mapel adaptif/normatif (misal Bahasa Inggris lintas prodi),
scope diperluas dengan pilihan program:

```
○ Semua program    → satu dokumen tanpa konteks industri spesifik
○ Per program      → dokumen berbeda per program, batch generate
○ Pilih tertentu   → subset yang dipilih guru
```

---

## 4. Status Dokumen dan Status AI Pipeline

### Status Dokumen (lifecycle bisnis)

Mengikuti alur persetujuan administratif:

```
AI_DRAFT
    ↓ (guru review dan simpan)
DIREVIEW_GURU
    ↓ (guru ajukan ke kepsek)
MENUNGGU_KEPSEK
    ↓ (kepsek konfirmasi di portal kepsek)
DISAHKAN_KEPSEK
```

Kepsek hanya bisa membaca dan menyetujui — tidak bisa mengedit dokumen guru.

### Status AI Pipeline (lifecycle operasional)

Mengikuti proses generate di background:

```
QUEUED        → request masuk antrian async
GENERATING    → AI sedang membuat draft
VALIDATING    → Validator sedang mengecek kelengkapan
RETRYING      → Validator gagal, AI sedang memperbaiki (max 2x)
FAILED        → Generate gagal setelah retry — guru diberi tahu
COMPLETED     → Generate berhasil, dokumen masuk AI_DRAFT
```

Status AI Pipeline disimpan di tabel `generation_jobs` (ADR-005).
Status Dokumen disimpan di `teacher_documents.status`.
Keduanya tidak dicampur.

---

## 5. Schema Database

### 5.1 public.teacher_documents

Tabel induk untuk semua jenis dokumen guru.
Menggunakan pola single-table dengan `document_type` sebagai discriminator.

```sql
CREATE TABLE public.teacher_documents (
  doc_id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id           UUID NOT NULL REFERENCES public.schools(id),
  teacher_user_id     UUID NOT NULL REFERENCES auth.users(id),
  academic_year       VARCHAR(10) NOT NULL,   -- '2026/2027'

  -- Jenis dokumen
  document_type       VARCHAR(30) NOT NULL CHECK (document_type IN (
                        'PROGRAM_TAHUNAN',
                        'PROGRAM_SEMESTER',
                        'ATP',
                        'PPM',
                        'LKPD',
                        'SOAL',
                        'RUBRIK'
                      )),

  -- Referensi kurikulum
  core_subject_id     UUID NOT NULL REFERENCES core.subjects(subject_id),
  phase_id            UUID NOT NULL REFERENCES core.phases(phase_id),
  program_id          UUID REFERENCES core.vocational_programs(program_id),
  -- NULL = berlaku lintas program (mapel umum)

  -- Scope kelas
  scope_type          VARCHAR(20) NOT NULL CHECK (scope_type IN (
                        'SEMUA_KELAS',   -- berlaku untuk semua kelas mapel ini
                        'KELAS_TERTENTU' -- per kelas spesifik
                      )),

  -- Relasi ke dokumen parent (untuk PPM → ATP, LKPD → PPM, dst)
  parent_doc_id       UUID REFERENCES public.teacher_documents(doc_id),

  -- Semester (untuk Program Semester, ATP, PPM)
  semester            SMALLINT CHECK (semester IN (1, 2)),

  -- Referensi TP (untuk PPM, LKPD, Soal, Rubrik)
  tp_urutan           INT,     -- urutan TP di ATP

  -- Status dokumen
  status              VARCHAR(30) NOT NULL DEFAULT 'AI_DRAFT' CHECK (status IN (
                        'AI_DRAFT',
                        'DIREVIEW_GURU',
                        'MENUNGGU_KEPSEK',
                        'DISAHKAN_KEPSEK'
                      )),

  -- Konten dokumen
  content_json        JSONB NOT NULL DEFAULT '{}',
  -- Menyimpan seluruh konten terstruktur (A1–C6 untuk PPM, dst)

  -- File output
  docx_url            TEXT,    -- URL file .docx yang sudah digenerate
  pdf_url             TEXT,    -- URL file .pdf

  -- Metadata generate (auditability — ADR-001 bagian 6)
  curriculum_version          VARCHAR(20),
  knowledge_version           VARCHAR(20),
  generation_policy_version   VARCHAR(20),
  model_version               VARCHAR(50),  -- 'gemini-2.0-flash', 'claude-haiku-4-5'
  generated_at                TIMESTAMPTZ,

  -- Snapshot konteks saat generate (immutable setelah generate)
  context_snapshot    JSONB,
  -- Menyimpan Teacher Profile + Teaching Context yang dipakai saat generate
  -- Tidak berubah meski guru update profil setelahnya

  -- Reuse & Smart Update
  source_doc_id       UUID REFERENCES public.teacher_documents(doc_id),
  -- Jika dokumen ini adalah hasil salin/update dari dokumen sebelumnya

  -- Metadata
  created_at          TIMESTAMPTZ DEFAULT now(),
  updated_at          TIMESTAMPTZ DEFAULT now()
);
```

### 5.2 public.teacher_document_classes

Relasi dokumen ↔ kelas (many-to-many).
Satu dokumen bisa berlaku untuk banyak kelas.

```sql
CREATE TABLE public.teacher_document_classes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_id      UUID NOT NULL REFERENCES public.teacher_documents(doc_id)
              ON DELETE CASCADE,
  class_id    UUID NOT NULL REFERENCES public.classes(id),
  school_id   UUID NOT NULL REFERENCES public.schools(id),
  UNIQUE (doc_id, class_id)
);
```

### 5.3 public.teacher_document_approvals

Riwayat persetujuan kepsek per dokumen.

```sql
CREATE TABLE public.teacher_document_approvals (
  approval_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_id          UUID NOT NULL REFERENCES public.teacher_documents(doc_id),
  school_id       UUID NOT NULL REFERENCES public.schools(id),
  approved_by     UUID NOT NULL REFERENCES auth.users(id),  -- kepsek
  status          VARCHAR(20) NOT NULL CHECK (status IN ('APPROVED', 'REJECTED')),
  catatan         TEXT,
  approved_at     TIMESTAMPTZ DEFAULT now()
);
```

---

## 6. Content JSON Structure

`content_json` menyimpan seluruh konten terstruktur per jenis dokumen.

### Contoh struktur untuk PPM:

```json
{
  "A1": {
    "nama_mapel": "Teknologi Layanan Jaringan",
    "fase": "E",
    "kelas": "XI-TJK-A",
    "alokasi_waktu": "6 JP",
    "nama_guru": "Andi Saputra, S.Kom",
    "tahun_ajaran": "2026/2027",
    "nomor_tp": "TP-01"
  },
  "A2": {
    "kompetensi_awal": "..."
  },
  "A3": {
    "profil_lulusan": {
      "keimanan_ketakwaan": "...",
      "kewargaan": "...",
      "penalaran_kritis": "...",
      "kreativitas": "...",
      "kolaborasi": "...",
      "kemandirian": "...",
      "kesehatan": "...",
      "komunikasi": "..."
    }
  },
  "A4": { "sarana_prasarana": "..." },
  "A5": { "target_peserta_didik": "..." },
  "A6": { "model_pembelajaran": "Project-Based Learning" },
  "B1": {
    "tujuan_pembelajaran": "...",
    "indikator": ["...", "...", "..."]
  },
  "B2": { "pemahaman_bermakna": "..." },
  "B3": { "pertanyaan_pemantik": ["...", "..."] },
  "B4": {
    "pendahuluan": "...",
    "inti": "...",
    "penutup": "...",
    "alokasi_waktu": {"pendahuluan": 10, "inti": 60, "penutup": 10}
  },
  "B5": {
    "asesmen_formatif": "...",
    "asesmen_sumatif": "...",
    "rubrik": "..."
  },
  "B6": {
    "pengayaan": "...",
    "remedial": "..."
  },
  "C1": null,
  "C2": { "glosarium": [{"istilah": "VLAN", "definisi": "..."}] },
  "C3": { "bahan_bacaan": "..." },
  "C4": null,
  "C5": { "daftar_pustaka": ["...", "..."] },
  "C6": null
}
```

---

## 7. Reuse & Smart Update

Di awal tahun ajaran baru, SIP mendeteksi dokumen dari tahun lalu
dan menawarkan tiga pilihan:

```
Program Tahunan ditemukan dari tahun 2025/2026.

○ Gunakan kembali
  Salin dokumen lama tanpa perubahan ke 2026/2027

○ Perbarui dengan AI
  AI menyesuaikan dengan:
  - Kurikulum terbaru (jika ada perubahan CP)
  - Teacher Profile terkini
  - Teaching Context baru untuk tahun ini

○ Buat dari awal
  AI generate dokumen baru sepenuhnya
```

### Schema untuk Reuse:

```
teacher_documents.source_doc_id → merujuk ke dokumen tahun lalu
```

Saat "Perbarui dengan AI":
- `source_doc_id` diisi dengan doc_id dokumen lama
- `context_snapshot` diisi dengan konteks terkini (bukan snapshot lama)
- `curriculum_version` diisi dengan versi CP terbaru
- Konten lama tersimpan di `source_doc_id` — tidak dihapus

---

## 8. Status "Perlu Ditinjau"

Dokumen yang sudah Disahkan Kepsek ditandai "Perlu Ditinjau" jika:

```
1. CP berubah:
   core.curriculum_versions status berubah ke 'SUPERSEDED'
   → dokumen.curriculum_version != versi ACTIVE

2. Minggu efektif berubah:
   jadwal sekolah diupdate setelah dokumen dibuat

3. Teacher Profile di-refresh:
   teacher_profiles.last_refreshed_at > teacher_documents.generated_at
```

UI menampilkan:
```
ATP — Teknologi Layanan Jaringan
⚠️ Perlu ditinjau: CP versi 2025.2 tersedia
[Tinjau]  [Abaikan]
```

---

## 9. RLS Teacher Workspace

```sql
ALTER TABLE public.teacher_documents ENABLE ROW LEVEL SECURITY;

-- Guru hanya bisa baca/tulis dokumen milik sendiri
CREATE POLICY td_select ON public.teacher_documents
  FOR SELECT TO authenticated
  USING (
    school_id = get_school_id()
    AND (
      teacher_user_id = auth.uid()           -- guru pemilik
      OR is_kepsek()                          -- kepsek bisa baca semua
    )
  );

CREATE POLICY td_insert ON public.teacher_documents
  FOR INSERT TO authenticated
  WITH CHECK (
    school_id = get_school_id()
    AND teacher_user_id = auth.uid()
  );

CREATE POLICY td_update ON public.teacher_documents
  FOR UPDATE TO authenticated
  USING (
    school_id = get_school_id()
    AND teacher_user_id = auth.uid()  -- hanya guru pemilik yang bisa edit
  );

-- Kepsek tidak bisa mengedit dokumen guru
-- Kepsek hanya bisa INSERT ke teacher_document_approvals
```

---

## 10. Progress Bar Kalkulasi

Progress bar di dashboard dihitung dari:

```
ATP selesai              → +20%
Program Tahunan selesai  → +10%
Program Semester selesai → +10% (per semester, 2 semester = +20%)
PPM per TP               → sisa 50% dibagi jumlah TP

Contoh: 18 TP, 4 PPM selesai:
  20 + 10 + 20 + (4/18 × 50) = 61%  ≈ 61%
```

Status "selesai" = `status IN ('DIREVIEW_GURU', 'DISAHKAN_KEPSEK')`
Status "AI Draft" tidak dihitung sebagai selesai.

---

## 11. Regenerate Limits per Tahun Ajaran

| Dokumen          | Batas/tahun ajaran | Alasan                          |
|------------------|--------------------|---------------------------------|
| ATP              | 3x                 | Awal + 2 revisi wajar           |
| Program Tahunan  | 2x                 | Awal tahun + 1 revisi           |
| Program Semester | 4x                 | 2 semester × 2 kesempatan       |
| PPM              | 6x                 | Per TP bisa revisi lebih sering |
| LKPD             | 6x                 | Idem PPM                        |
| Soal             | 8x                 | UH, UTS, UAS, remedial          |
| Rubrik           | 6x                 | Ikut Soal                       |

Catatan: "Tahun" = tahun ajaran aktif (academic_year), bukan tahun kalender.
Counter reset otomatis saat academic_year berubah.
Limit diimplementasi di generation_jobs Cost Protection (ADR-005).

---

## 12. Yang Tidak Diputuskan di ADR Ini

| Topik | Catatan |
|-------|---------|
| Implementasi Word Generator (.docx) | Sprint implementasi — per template dokumen |
| Implementasi PDF Generator | Sprint implementasi |
| Notifikasi ke kepsek saat dokumen diajukan | Bergantung arsitektur notifikasi |
| Batch generate PPM untuk semua TP sekaligus | Dikerjakan di sprint fitur |
| Format content_json untuk LKPD, Soal, Rubrik | Didefinisikan saat sprint |

---

## 13. Checklist Persetujuan

- [ ] Document Graph: Program Tahunan → Program Semester → ATP → PPM → LKPD/Soal/Rubrik
- [ ] Urutan tidak diblokir paksa — peringatan kuning jika prasyarat belum ada
- [ ] Scope dokumen: guru memilih semua kelas atau kelas tertentu
- [ ] Mapel adaptif/normatif: tambahan scope per program atau semua program
- [ ] Status dokumen: AI Draft → Direview Guru → Menunggu Kepsek → Disahkan Kepsek
- [ ] Kepsek hanya bisa baca dan approve — tidak bisa edit dokumen guru
- [ ] Single table teacher_documents dengan content_json — satu tabel untuk semua jenis dokumen
- [ ] teacher_document_classes: relasi many-to-many dokumen ↔ kelas
- [ ] teacher_document_approvals: riwayat persetujuan kepsek
- [ ] context_snapshot: immutable setelah generate — tidak berubah meski profil guru diupdate
- [ ] 5 metadata auditability per dokumen (curriculum_version, knowledge_version, generation_policy_version, model_version, generated_at)
- [ ] Reuse & Smart Update: tiga pilihan di awal tahun ajaran baru
- [ ] source_doc_id: melacak asal dokumen hasil reuse/update
- [ ] Status "Perlu Ditinjau": trigger dari perubahan CP, jadwal, atau refresh Teacher Profile
- [ ] Progress bar: kalkulasi berdasarkan status dokumen per mapel
