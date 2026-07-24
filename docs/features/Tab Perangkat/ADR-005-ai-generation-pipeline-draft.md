# ADR-005 — AI Generation Pipeline
# Student Insight Platform (SIP)
# Status: DRAFT v3 — OPEN untuk penyempurnaan
# Tanggal: 18 Juli 2026
# Berlaku untuk: Fitur tab "Perangkat Ajar" — SMK
# Bergantung pada: ADR-001, ADR-002, ADR-003, ADR-004

---

## 1. Konteks

ADR ini mendefinisikan arsitektur lengkap AI Generation Pipeline —
komponen yang mengubah konteks guru menjadi dokumen perangkat ajar
siap cetak.

Pipeline ini adalah implementasi dari Context Builder yang direferensikan
di ADR-001 bagian 7.

---

## 2. Arsitektur Pipeline

```
LAYER 1 (sistem)          LAYER 2+3 (guru)
CP, Teaching Assignment   Teacher Profile + Teaching Context
Fase, Program             Instructional Intent, Media, dll
Minggu efektif, JP
        │                         │
        └──────────┬──────────────┘
                   ▼
          ┌─────────────────┐
          │ Context Builder │
          │                 │
          │ Merakit semua   │
          │ konteks menjadi │
          │ satu objek      │
          └────────┬────────┘
                   ▼
          ┌─────────────────┐
          │  Rule Engine    │
          │                 │
          │ Validasi input  │
          │ Terapkan aturan │
          │ pedagogis       │
          └────────┬────────┘
                   ▼
          ┌─────────────────┐
          │  Prompt Builder │
          │                 │
          │ Core Prompt     │
          │ + Provider      │
          │   Formatter     │
          └────────┬────────┘
                   ▼
          ┌─────────────────┐
          │  Model Adapter  │  ← thin, bodoh, tidak tahu apa itu ATP
          │                 │
          │ Gemini /        │
          │ Claude Haiku /  │
          │ Claude Sonnet / │
          │ BYOK            │
          └────────┬────────┘
                   ▼
          ┌─────────────────┐
          │   Validator     │
          │                 │
          │ Cek kelengkapan │
          │ struktur modul  │
          └────────┬────────┘
                   │ kurang?
                   ├─── ya ──→ AI perbaiki otomatis (max 2x retry)
                   │ lengkap?
                   ▼
          ┌─────────────────┐
          │  Self Review    │
          │                 │
          │ Generate →      │
          │ Critique →      │
          │ Revise          │
          └────────┬────────┘
                   ▼
          ┌─────────────────┐
          │ Response Parser │
          │                 │
          │ Normalisasi     │
          │ output ke       │
          │ format standar  │
          └────────┬────────┘
                   ▼
          ┌─────────────────┐
          │ Word Generator  │
          │                 │
          │ Render .docx    │
          │ dengan template │
          │ header sekolah  │
          └────────┬────────┘
                   ▼
          ┌─────────────────┐
          │ Evaluation Log  │
          │                 │
          │ Simpan metadata │
          │ audit           │
          └─────────────────┘
```

---

## 3. Model Adapter — Thin & Model-Agnostic

Model Adapter tidak mengetahui struktur perangkat ajar.
Tidak tahu apa itu ATP, Perencanaan Pembelajaran Mendalam (PPM), atau Program Semester.
Hanya tahu: terima prompt, kirim ke model, kembalikan output.

### Kontrak Standar

Semua provider wajib mengembalikan format yang sama:

```json
{
  "text": "string — output lengkap dari model",
  "usage": {
    "input_tokens": 0,
    "output_tokens": 0
  },
  "finish_reason": "stop | length | error",
  "latency_ms": 0,
  "provider": "gemini | claude | openai | byok",
  "model": "gemini-2.0-flash | claude-haiku-4-5 | claude-sonnet-4-6"
}
```

### Interface

```
generate(prompt: string, config: ModelConfig) → ModelResponse
```

Prompt Builder tidak peduli model apa yang aktif.
Perubahan model = perubahan config saja, bukan rewrite pipeline.

---

## 4. Provider-specific Prompt Layer

Prompt bukan artefak yang sepenuhnya portabel antar model.
Core Prompt dipisah dari Provider Formatter.

```
Core Prompt (konten pedagogis, tidak berubah)
     │
     ├── Gemini Formatter   → format, instruksi, contoh untuk Gemini
     ├── Claude Formatter   → format, instruksi, contoh untuk Claude
     └── Default Formatter  → fallback untuk provider baru
```

Core Prompt berisi:
- Instruksi pedagogis
- Struktur dokumen yang diharapkan (A1–C6)
- Konteks dari Context Builder
- Aturan dari Rule Engine

Provider Formatter berisi:
- System prompt spesifik model
- Format output yang diharapkan (JSON fence, XML, dll)
- Contoh few-shot jika diperlukan
- Parameter temperature, max_token per model

---

## 5. Validator

Sebelum output dikirim ke guru, Validator mengecek kelengkapan struktur.
Jika kurang, AI diminta memperbaiki otomatis (max 2x retry).
Jika setelah 2x retry masih kurang, output tetap dikirim dengan flag
`incomplete: true` — guru diberi tahu bagian mana yang perlu dilengkapi.

### Checklist Validator per Perencanaan Pembelajaran Mendalam (PPM)

```
A. INFORMASI UMUM
   ☐ A1 — Identitas lengkap (mapel, fase, kelas, JP, nama guru)
   ☐ A2 — Kompetensi awal ada
   ☐ A3 — Profil Lulusan 8 Dimensi ada
   ☐ A4 — Sarana & Prasarana sesuai Media & Alat yang dicentang guru
   ☐ A5 — Target peserta didik ada
   ☐ A6 — Model pembelajaran sesuai pilihan guru

B. KOMPONEN INTI
   ☐ B1 — TP + indikator ada
   ☐ B2 — Pemahaman bermakna ada
   ☐ B3 — Pertanyaan pemantik minimal 2
   ☐ B4 — Kegiatan pembelajaran ada (pembuka, inti, penutup)
   ☐ B4 — Tidak ada aktivitas yang butuh alat yang tidak tersedia
   ☐ B4 — Tidak ada aktivitas yang dihindari guru
   ☐ B5 — Asesmen sesuai Assessment Philosophy guru
   ☐ B5 — Rubrik ada
   ☐ B6 — Pengayaan ada
   ☐ B6 — Remedial ada

C. LAMPIRAN
   ☐ C2 — Glosarium ada (jika mapel bahasa/teknis)
   ☐ C3 — Bahan bacaan guru ada
   ☐ C5 — Daftar pustaka ada

DEEP LEARNING (Permendikdasmen No. 13 Tahun 2025)
   ☐ B4 mencerminkan minimal satu pendekatan:
      berkesadaran (mindful) / bermakna (meaningful) / menggembirakan (joyful)
   ☐ 8 Dimensi Profil Lulusan terintegrasi di A3 dan B4
      (bukan projek terpisah)
   ☐ Tidak menggunakan istilah "Profil Pelajar Pancasila" atau "RPP" atau "Modul Ajar"
      → Gunakan "Profil Lulusan", "PPM", "Perencanaan Pembelajaran Mendalam"

KALKULASI
   ☐ Total JP sesuai alokasi
   ☐ Distribusi JP Sem 1 + Sem 2 seimbang
```

---

## 6. Self Review — Generate → Critique → Revise

Setelah Validator lulus, AI melakukan self-review dengan rubrik pedagogis.

```
Langkah 1 — Generate
  AI menghasilkan draft modul lengkap

Langkah 2 — Critique
  AI menilai draft sendiri dengan rubrik:
  - Apakah TP tercapai melalui aktivitas?
  - Apakah asesmen mengukur TP?
  - Apakah konteks lokal guru digunakan?
  - Apakah output nyata yang diharapkan guru terwujud?
  - Apakah Learning Constraints dipatuhi?

Langkah 3 — Revise
  AI memperbaiki bagian yang nilainya rendah
  Output final dikirim ke Response Parser
```

Pola ini meningkatkan kualitas bahkan pada model kecil seperti Gemini.

---

## 7. Async Queue & Generation Jobs

Generate tidak dilakukan secara synchronous.
Guru tidak menunggu di layar — proses berjalan di background.

### Tabel generation_jobs

```sql
CREATE TABLE public.generation_jobs (
  job_id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id           UUID NOT NULL REFERENCES public.schools(id),
  teacher_user_id     UUID NOT NULL REFERENCES auth.users(id),
  doc_id              UUID REFERENCES public.teacher_documents(doc_id),

  -- Idempotency — mencegah duplikasi request
  idempotency_key     VARCHAR(100) UNIQUE NOT NULL,
  -- Format: {teacher_id}:{subject_id}:{phase}:{doc_type}:{academic_year}:{tp_urutan}

  -- Status AI Pipeline
  status              VARCHAR(20) NOT NULL DEFAULT 'QUEUED' CHECK (status IN (
                        'QUEUED',      -- menunggu diproses
                        'GENERATING',  -- AI sedang generate
                        'VALIDATING',  -- Validator sedang cek
                        'RETRYING',    -- Validator gagal, AI perbaiki
                        'FAILED',      -- gagal setelah max retry
                        'COMPLETED'    -- berhasil
                      )),

  -- Retry
  retry_count         INT DEFAULT 0,
  max_retry           INT DEFAULT 2,
  last_error          TEXT,

  -- Konteks yang dikirim ke AI (snapshot)
  context_snapshot    JSONB,
  prompt_template_id  UUID REFERENCES public.prompt_templates(template_id),

  -- Provider dan model
  provider            VARCHAR(20),   -- 'gemini', 'claude'
  model               VARCHAR(50),   -- 'gemini-2.0-flash', 'claude-haiku-4-5'

  -- Timing
  queued_at           TIMESTAMPTZ DEFAULT now(),
  started_at          TIMESTAMPTZ,
  completed_at        TIMESTAMPTZ,
  failed_at           TIMESTAMPTZ,

  -- Cost
  input_tokens        INT,
  output_tokens       INT,
  cost_idr            NUMERIC(10,2)
);
```

### Flow Async Queue

```
Guru klik Generate
       ↓
Cek idempotency_key — jika sudah ada job QUEUED/GENERATING → skip
       ↓
INSERT generation_jobs (status: QUEUED)
       ↓
Worker memproses (pg_notify / Edge Function)
       ↓
status: GENERATING → VALIDATING → COMPLETED / FAILED
       ↓
Notifikasi ke guru saat COMPLETED atau FAILED
       ↓
Jika COMPLETED → INSERT teacher_documents (status: AI_DRAFT)
```

### Error Recovery

```
FAILED job:
  → Guru melihat notifikasi "Generate gagal"
  → Tombol [Coba Lagi] tersedia
  → Klik [Coba Lagi] → INSERT job baru dengan idempotency_key baru
  → Job lama tidak dihapus — tersimpan untuk audit

STUCK job (GENERATING > 5 menit):
  → Worker otomatis tandai FAILED
  → Alert ke SIP monitoring
```

### Cost Protection

```
Sebelum INSERT job baru:
  1. Cek idempotency_key — jika duplikat, return job yang ada
  2. Cek rate limit harian guru (max 30/hari)
  3. Cek rate limit harian sekolah (max 200/hari)
  4. Cek apakah hasil generate identik sudah ada
     (same subject + phase + tp_urutan + context_hash)
     → Jika ada → tawarkan reuse hasil lama, bukan generate ulang
  5. Cek regenerate_count per (teacher_user_id, document_type, academic_year)
     vs limit ADR-004 section 11.
     Jika limit tercapai → tolak dengan pesan:
     "Batas generate [TIPE DOKUMEN] untuk tahun ajaran ini ([N]x) sudah tercapai."
```

---

## 8. Prompt Templates

```sql
CREATE TABLE public.prompt_templates (
  template_id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_type         VARCHAR(30) NOT NULL,  -- 'PPM', 'ATP', 'PROGRAM_TAHUNAN', dst
  provider              VARCHAR(20) NOT NULL,  -- 'gemini', 'claude', 'default'

  -- Versioning granular
  template_version      VARCHAR(20) NOT NULL,   -- '1.0', '1.1', dst
  formatter_version     VARCHAR(20) NOT NULL,   -- versi provider formatter
  system_instruction_v  VARCHAR(20) NOT NULL,   -- versi system instruction

  -- Konten
  system_instruction    TEXT NOT NULL,
  core_prompt           TEXT NOT NULL,
  formatter_config      JSONB NOT NULL DEFAULT '{}',

  -- Status
  is_active             BOOLEAN DEFAULT true,
  deprecated_at         TIMESTAMPTZ,
  notes                 TEXT,

  created_at            TIMESTAMPTZ DEFAULT now(),
  UNIQUE (document_type, provider, template_version)
);
```

---

## 9. Knowledge Retrieval — Tag-Based Filter

Knowledge Nasional tidak di-dump seluruhnya ke prompt.
Context Builder mengambil Knowledge yang relevan menggunakan tag-based filter.

```
Guru pilih: Instructional Intent = "Persiapan Sertifikasi Mikrotik MTCNA"
                    ↓
Context Builder query:
  SELECT * FROM core.knowledge_national
  WHERE program_id = {tjkt_program_id}
  AND tags && ARRAY['mikrotik', 'sertifikasi', 'mtcna']
  AND is_active = true
  LIMIT 20
                    ↓
Ambil top 20 item paling relevan berdasarkan tag match
                    ↓
Masukkan ke prompt sebagai konteks industri
```

Strategi ini cukup untuk pilot. Saat Knowledge membesar (>1.000 item),
upgrade ke hybrid search (keyword + semantic/vector) didefinisikan
di ADR terpisah — tidak memblokir implementasi awal.

---

## 10. Evaluation Logs

Dipisah dari teacher_documents untuk kemudahan analitik dan query.

```sql
CREATE TABLE public.evaluation_logs (
  log_id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id                    UUID NOT NULL REFERENCES public.generation_jobs(job_id),
  school_id                 UUID NOT NULL REFERENCES public.schools(id),
  teacher_user_id           UUID NOT NULL REFERENCES auth.users(id),
  doc_id                    UUID REFERENCES public.teacher_documents(doc_id),

  -- Referensi kurikulum
  document_type             VARCHAR(30),
  core_subject_id           UUID,
  phase_id                  UUID,
  program_id                UUID,

  -- Versi yang digunakan
  curriculum_version        VARCHAR(20),
  knowledge_version         VARCHAR(20),
  template_version          VARCHAR(20),
  formatter_version         VARCHAR(20),
  system_instruction_v      VARCHAR(20),
  model_version             VARCHAR(50),
  provider                  VARCHAR(20),

  -- Performa
  input_tokens              INT,
  output_tokens             INT,
  latency_ms                INT,
  cost_idr                  NUMERIC(10,2),

  -- Kualitas
  validator_passed          BOOLEAN,
  validator_flags           TEXT[],
  self_review_score         NUMERIC(4,2),
  retry_count               INT,
  finish_reason             VARCHAR(20),

  -- Feedback guru (diisi setelah guru review)
  teacher_satisfaction      SMALLINT CHECK (teacher_satisfaction BETWEEN 1 AND 5),
  teacher_feedback          TEXT,

  generated_at              TIMESTAMPTZ DEFAULT now()
);
```

### Alert Otomatis

```
Monitor setiap 24 jam:
  validator_passed rate < 90%  → ALERT
  self_review_score avg < 3.5  → ALERT
  latency_ms median > 30.000   → ALERT
  cost_idr total > threshold   → ALERT
```

---

## 11. Dependency Tree Generate

Setiap dokumen hanya bisa di-generate jika dependency terpenuhi.
Context Builder memeriksa ketersediaan dependency sebelum merakit prompt.

```
CP (core.capaian_pembelajaran — wajib ada, tidak di-generate)
    ↓ membutuhkan: CP + Teacher Profile
[AI] TP + ATP
    ↓ membutuhkan: ATP + jadwal sekolah (minggu efektif)
[AI] Program Tahunan
    ↓ membutuhkan: Program Tahunan + jadwal per semester
[AI] Program Semester
    ↓ membutuhkan: ATP (node TP spesifik) + Teaching Context
[AI] PPM
    ↓                    ↓
[AI] LKPD (butuh PPM)  [AI] Soal (butuh PPM)
                            ↓
                        [AI] Rubrik (butuh Soal)
```

Jika dependency belum ada: UI menampilkan peringatan kuning, Generate tetap bisa ditekan.
Jika CP tidak ada di core: Generate diblokir penuh (error merah).

---

## 12. Sprint Order (Rekomendasi Implementasi)

Berdasarkan dependency antar ADR:

```
Sprint 1 — Foundation Schema
  ADR-001 + ADR-002: schema core.* + public.* dasar
  Seed CP normatif/adaptif

Sprint 2 — Teacher Workspace CRUD (tanpa AI)
  ADR-004: teacher_documents, teacher_document_classes,
           teacher_document_approvals
  UI: dashboard pekerjaan, status dokumen, approval kepsek

Sprint 3 — Knowledge Repository + Teacher Profile UI
  ADR-003: core.knowledge_national, teacher_profiles, teaching_contexts
  UI: Setup Profil Mengajar, tap pilihan + input spesifik

Sprint 4 — Context Builder + Prompt Builder
  ADR-005 bagian 3-6: Context Builder, Rule Engine, Prompt Builder
  Tabel: prompt_templates
  Belum ada AI — output prompt saja untuk validasi

Sprint 5 — AI Integration (Claude)
  ADR-005 bagian 7-10: Model Adapter Claude, generation_jobs,
                        Validator, Self Review, evaluation_logs
  UI: Generate button aktif, async queue, notifikasi

Sprint 6 — Document Output
  Word Generator (.docx) + PDF Generator
  Template per jenis dokumen (PPM, ATP, Program Tahunan, Program Semester)
  Reuse & Smart Update

Sprint 7 — Monitoring + Evaluation + Billing
  Dashboard evaluation_logs
  Alert otomatis
  Rate limiting + cost protection
  Tier management (Freemium, Subscription, BYOK)
```

---

## 13. Yang Tidak Diputuskan di ADR Ini

| Topik | Catatan |
|-------|---------|
| Implementasi Word Generator (.docx) | Template per jenis dokumen — detail di sprint |
| Push notification selesai generate | Bergantung arsitektur FCM (ADR terpisah) |
| Prompt spesifik per jenis dokumen | Didefinisikan di Generation Repository (ADR-002) |

---

## 14. Checklist Persetujuan

- [ ] Arsitektur pipeline 9 komponen (Context Builder → Evaluation Log)
- [ ] Thin Model Adapter dengan kontrak standar JSON
- [ ] Provider-specific Prompt Layer (Core Prompt + Formatter per model)
- [ ] Validator dengan checklist A1–C6 + kalkulasi JP
- [ ] Self Review Generate → Critique → Revise
- [ ] Async Queue — tidak synchronous, notifikasi saat selesai
- [ ] Evaluation Pipeline dengan 20 field metadata
- [ ] Alert otomatis jika kualitas turun
- [ ] Tahap awal: Claude Haiku 4.5 untuk 2–3 sekolah pilot
- [ ] Go nasional: Claude Haiku/Sonnet masuk subscription sekolah
- [ ] Rate limit: 30 generate/guru/hari, 200/sekolah/hari
- [ ] Migrasi path: Fase 1 Haiku (pilot) → Fase 2 Haiku/Sonnet per tier (nasional)
