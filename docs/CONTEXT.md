> **DEPRECATED** — Isi dokumen ini sudah dikonsolidasi ke `CLAUDE.md` di root repo.
> Untuk Claude Code: baca `CLAUDE.md`. Untuk Claude Chat: baca `CLAUDE.md` + bagian "CARA KERJA SESI" di bawah ini.

---

# SIP SMK — Context Document untuk Claude Chat Baru

> **Cara membaca dokumen ini:**
> Anda adalah senior web engineer dan system architect yang melanjutkan pekerjaan
> Student Insight Platform (SIP SMK). Baca SELURUH dokumen ini sebelum merespons
> apapun. Setelah membaca, periksa memori Claude untuk konteks tambahan dari sesi
> sebelumnya. Jangan asumsikan apapun yang tidak tertulis di sini.

---

## CARA KERJA SESI INI

**Claude Chat = architect-consultant:**
- Analisis kebutuhan dan risiko
- Review rekomendasi dari Claude Code
- Buat prompt lengkap untuk Claude Code
- Ambil keputusan arsitektur bersama user
- **TIDAK langsung coding** — selalu lewat Claude Code

**Claude Code = executor:**
- Investigasi codebase
- Implementasi + self review
- Apply migration + push

**Alur kerja:**
```
User ←→ Claude Chat (analisis, keputusan)
              ↓
         Claude Code (investigasi, implementasi, push)
              ↓
         Laporan kembali ke Claude Chat
```

**Prinsip:** jangan skip langkah `ANALYZE → DESIGN → BUILD → HARDEN → VALIDATE`.
Selalu tanya keputusan arsitektur ke user sebelum commit ke solusi.

---

## ATURAN UNTUK CLAUDE CHAT

- Jika konteks **BELUM final**: minta Claude Code investigasi + beri rekomendasi dulu
  → tunggu hasil → baru putuskan bersama user
- Jika konteks **SUDAH final**: buat prompt lengkap untuk Claude Code selesaikan penuh
  (investigasi + analisis dampak + self review + apply + push)
- Semua prompt Claude Code harus mengikuti template standar (lihat §TEMPLATE di bawah)
- Jangan jawab pertanyaan teknis dari memory saja — minta Claude Code verifikasi live
- Semua keputusan yang menyentuh schema, RLS, atau security → tanya user dulu

---

## 1. IDENTITAS PROYEK

**Nama:** Student Insight Platform — SIP SMK
**Deskripsi:** Multi-tenant SaaS untuk SMK. Satu Supabase project, banyak sekolah,
terisolasi via RLS `school_id`. Setiap sekolah adalah tenant terpisah.

**Stack:**
- Backend: Supabase/PostgreSQL + Row Level Security (RLS)
- Frontend: Vanilla JS + HTML (tidak ada framework)
- Hosting: GitHub Pages (static files)
- Auth: Supabase Auth (JWT)

**Repo GitHub:** https://github.com/teguhalficahlin-del/student-insight-platform
**Repo lokal:** `D:\ribuan_pengguna\CLAUDE\SIP SMK`
**Supabase project ID:** `xovvuuwexoweoqyltepq`
**GitHub Pages:** https://teguhalficahlin-del.github.io/student-insight-platform

---

## 2. DATA KRITIS

| Key | Value |
|-----|-------|
| HEAD (26 Jul 2026) | `1e75cd7` |
| SMKN 1 Ujungbatu `school_id` | `244e389c-de7d-4d70-ac95-346d33a5d02c` |
| SMKN 1 Ujungbatu slug | `smkn1ujungbatu` |
| SMK Uji E7 `school_id` | `4c084682-aca3-45c3-8882-24309e4c33a1` |
| SMK Uji E7 slug | `smk-uji-e7` |

**PENTING:** `school_id` SMKN 1 Ujungbatu adalah `244e389c-...`.
ID lama `cc1e152e-...` adalah SALAH — jangan gunakan ID ini.

---

## 3. STRUKTUR PORTAL (7 portal)

```
guru/         → guru/js/api.js + guru/js/guru.js (+ per-tab JS)
siswa/        → siswa/js/api.js + siswa/js/siswa.js
ortu/         → ortu/js/api.js + ortu/js/ortu.js
admin/        → admin/js/api.js + admin/js/admin.js
superadmin/   → superadmin/js/api.js + superadmin/js/superadmin.js
dudi/         → dudi/js/api.js + dudi/js/dudi.js
stakeholder/  → stakeholder/js/api.js + stakeholder/js/stakeholder.js
```

Setiap portal: `index.html` (login) + `dashboard.html` (main app).

**View aman untuk query staf:** `v_users_staff_directory`
- 8 kolom, `security_invoker=true`
- Gunakan ini — bukan `.from('users')` langsung

---

## 4. ATURAN WORKFLOW (NON-NEGOTIABLE)

### Migration
- Isi migration ditampilkan **verbatim** ke user sebelum apply
- Tunggu konfirmasi eksplisit — tanpa kecuali
- `BEGIN ... ROLLBACK` test dulu, baru `BEGIN ... COMMIT`
- Format nama: `YYYYMMDDHHMMSS_nama-fitur.sql`
- Selalu `IF NOT EXISTS` / `OR REPLACE` (idempotent)
- Setiap `CREATE FUNCTION ... SECURITY DEFINER` baru wajib:
  ```sql
  REVOKE EXECUTE ON FUNCTION nama_fungsi FROM PUBLIC;
  REVOKE EXECUTE ON FUNCTION nama_fungsi FROM anon;
  ```
  `REVOKE FROM PUBLIC` saja **tidak cukup** — Supabase beri grant eksplisit ke `anon`.

### Git
- Tidak ada `git commit` tanpa review diff verbatim dulu
- Tidak ada `git push` tanpa konfirmasi eksplisit user
- Tidak ada combined `git add + commit + push` satu perintah

### RLS
- Missing RLS policy ≠ celah otomatis — RLS adalah default-deny
- Verifikasi live dulu sebelum buat fix

---

## 5. TEMPLATE PROMPT UNTUK CLAUDE CODE

Setiap prompt yang dibuat Claude Chat untuk Claude Code harus mengikuti format ini:

```
VERIFIKASI pwd — pastikan path mengandung "SIP SMK"

BATASAN KERAS:
- HANYA boleh mengubah: [daftar file spesifik]
- DILARANG menyentuh: [file lain]

SCOPE: [deskripsi satu kalimat]

/plan
/effort [low|medium|high]

TUJUAN:
[Apa yang harus dicapai]

KONTEKS:
- HEAD: [commit hash]
- [konteks relevan]

INVESTIGASI:
```bash
# [bash commands untuk gather context]
```

ANALISIS DAMPAK:
[Apa yang berubah, tenant mana yang terpengaruh]

SELF REVIEW — sebelum apply:
1. Side effect ke tenant lain?
2. Migration idempotent?
3. REVOKE dua lapis jika ada SECURITY DEFINER baru?
4. Diff sudah di-review verbatim?
5. Risiko data loss?

JIKA LULUS → [langkah konkret: apply + push]
JIKA RISIKO → jangan apply + laporkan spesifik + STOP
```

---

## 6. CONSTRAINT TEKNIS PENTING

| Constraint | Nilai / Aturan |
|-----------|----------------|
| Attendance enum | `ALPA` (bukan `TIDAK_HADIR`) |
| `day_of_week` enum | `SENIN, SELASA, RABU, KAMIS, JUMAT, SABTU` (tidak ada `MINGGU`) |
| Guard hari Minggu | `getDay() === 0` → `return false` langsung |
| Supabase free tier timeout | `statement_timeout = 2 menit` (tidak bisa `SET LOCAL`) |
| Max rows Supabase | dinaikkan ke 5000 |
| Excel schedule parser | origin B1 (bukan A1); XLSX.js array index 0 = kolom B |
| Cron `evaluate-teacher-indicators` | `0 17 * * *` = 00:00 WIB |
| `v_users_staff_directory` | 8 kolom aman, `security_invoker=true` |
| `subject_code_aliases` | persist `nama` + `jurusan` (HEAD 1e75cd7) |
| Tenant isolation anchor | `school_id` di setiap tabel |

---

## 7. STATUS AUDIT KEAMANAN (selesai semua)

| Fase | Status | Selesai |
|------|--------|---------|
| Fase 1 | ✅ | baseline schema + RLS foundation |
| Fase 2 | ✅ | 9 Jul 2026 — Kelompok A–E, 70 policy scan, 4 SECURITY DEFINER fix |
| Fase 3 | ✅ | 12 Jul 2026 — 14 anon=true clean, WAKA_HUMAS/PKL confirmed by design |
| Sprint 1 Foundation | ✅ | 18 Jul 2026 — schema `core` (11 tabel) + `public` (8 tabel AI pipeline) |

**Test suite:** 93/93 ✓ (12 Jul 2026, 15 CHECK top-level)

Audit selesai. Tidak ada fase audit aktif saat ini.
Detail: `docs/audit-handoff.md`

---

## 8. SCHEMA PENTING

### Schema `core` (append-only, tidak pernah DELETE)
`curriculum_versions`, `education_levels`, `phases`,
`vocational_fields`, `vocational_programs`, `vocational_concentrations`,
`subjects`, `subject_phases`, `capaian_pembelajaran`,
`cp_elements`, `knowledge_national`

### Schema `public` — Teacher Workspace + AI Pipeline
`teacher_profiles`, `teaching_contexts`, `teacher_documents`,
`teacher_document_classes`, `teacher_document_approvals`,
`prompt_templates`, `generation_jobs`, `evaluation_logs`

---

## 9. BACKLOG PRIORITAS (per HEAD 1e75cd7, 26 Jul 2026)

### PRIORITAS TINGGI (blocker / security)
1. **Jadwal import SMK Uji E7** — blocker Go-Live tenant E1/E2/E4/E7
2. **Security: client migration 7 portal** ke `v_users_staff_directory`
   (sebagian sudah — commit caac5f8 — sisanya perlu verifikasi)
3. **Security: Fase 3 FINDING 4** — 14 anon=true helper functions (perlu verifikasi ulang)
4. **Recovery UI timeout 57014** — `fn_apply_schedule_templates` perlu solusi
   batch DELETE + recovery path di UI admin

### PRIORITAS SEDANG (fitur)
5. **Tab Perangkat Ajar** — Generate Promes, PPM, LKPD, Soal, Rubrik (UI belum ada)
6. **Download .docx** dari `content_json` hasil generate
7. **Kolom Mapel di grid jadwal** admin — masih kosong
8. **Jadwal portal siswa dan ortu** — belum diimplementasi
9. **Filter mapel picker Generate ATP** guru Waka Kurikulum (Ipelda)

### BELUM DISENTUH (backlog jauh)
- Approval workflow kepsek/waka di UI guru
- Regenerate limits (counter per tahun ajaran)
- Notifikasi push (FCM)
- WAKA_HUMAS PKL scope
- `fn_can_see_case()` — KEPSEK tidak bisa lihat kasus PRIVATE/RESTRICTED
  di luar keterlibatan (bug fungsional, bukan security leak)

---

## 10. COMMIT HISTORY PENTING (referensi cepat)

| Commit | Deskripsi |
|--------|-----------|
| `1e75cd7` | HEAD — persist nama+jurusan di subject_code_aliases |
| `6a61848` | guard schoolId sebelum upsert Tab Kode Mapel |
| `f942004` | PWA manifest absolute path (6 portal) |
| `d6bec39` | aksesibilitas: 7 label tanpa for diperbaiki |
| `9174d0d` | isTeacher: cek teacher_code ATAU teaching_assignments |
| `caac5f8` | PRIORITAS 1: 4 file client → v_users_staff_directory |
| `28fc884` | fix regresi Rule 3 + role filter case_events/student_updates |
| `333130e` | audience siswa/ortu RESTRICTED + fix bug added_by_user_id |
| `0dee5f5` | Portal Ortu → tab layout (lazy load, reset per anak) |

---

## 11. PERTANYAAN UNTUK MEMULAI SESI

Sebelum memulai task, tanyakan ke user:
1. Apakah ada update dari sesi Claude Code terakhir yang perlu diketahui?
2. Task apa yang ingin dikerjakan hari ini?
3. Apakah ada constraint waktu atau prioritas khusus?
