# Student Insight Platform — SIP SMK
# Konteks untuk Claude Code

> Baca SELURUH dokumen ini sebelum mengerjakan apapun.
> Dokumen ini adalah satu-satunya sumber kebenaran — CONTEXT.md deprecated.

---

## 1. IDENTITAS & DOMAIN

**Nama:** Student Insight Platform — SIP SMK
**Domain:** Platform manajemen sekolah menengah kejuruan (SMK), Kurikulum Merdeka.
Fitur utama: absensi, BK (kasus siswa), jadwal, forum, perangkat ajar (AI pipeline).

**Stack:**
- Backend: Supabase/PostgreSQL + Row Level Security (RLS)
- Frontend: Vanilla JS + HTML (tanpa framework)
- Hosting: GitHub Pages (static files)
- Auth: Supabase Auth (JWT)

**Supabase project ID:** `xovvuuwexoweoqyltepq`
**Repo GitHub:** https://github.com/teguhalficahlin-del/student-insight-platform
**Repo lokal:** `D:\ribuan_pengguna\CLAUDE\SIP SMK`
**GitHub Pages:** https://teguhalficahlin-del.github.io/student-insight-platform

---

## 2. DATA KRITIS

| Key | Value |
|-----|-------|
| HEAD (31 Jul 2026) | `6e52656` |
| SMKN 1 Ujungbatu `school_id` | `244e389c-de7d-4d70-ac95-346d33a5d02c` |
| SMKN 1 Ujungbatu slug | `smkn1ujungbatu` |
| SMK Uji E7 `school_id` | `4c084682-aca3-45c3-8882-24309e4c33a1` |
| SMK Uji E7 slug | `smk-uji-e7` |

**PENTING:** ID lama SMKN 1 Ujungbatu `cc1e152e-...` adalah SALAH — jangan gunakan.

---

## 3. STRUKTUR PORTAL (9 portal aktual)

```
guru/         → guru/js/api.js + guru/js/guru.js + per-tab JS
student/      → student/js/api.js + student/js/dashboard.js
parent/       → parent/js/api.js + parent/js/portal.js
admin/        → admin/js/api.js + admin/js/admin.js
superadmin/   → superadmin/js/api.js + superadmin/js/superadmin.js
tu/           → tu/js/api.js + tu/js/portal.js
dudi/         → dudi/js/api.js + dudi/js/dudi.js
stakeholder/  → stakeholder/js/api.js + stakeholder/js/stakeholder.js
shared/       → shared/ (komponen lintas portal)
```

Setiap portal: `index.html` (login) + `dashboard.html` (main app).
RLS selalu filter berdasarkan `school_id` tenant.

**View aman untuk query staf:** `v_users_staff_directory` (8 kolom, security_invoker=true).
Gunakan ini — JANGAN `.from('users')` langsung.

**Role types di tabel `users`:**
`GURU`, `WALI_KELAS`, `GURU_BK`, `WAKA_KURIKULUM`, `WAKA_HUMAS`, `KEPSEK`,
`KAPRODI`, `GURU_PIKET`, `SISWA`, `ORTU`, `ADMIN`, `SUPERADMIN`, `TU`, `DUDI`, `STAKEHOLDER`

---

## 4. CARA KERJA TIM

```
Romo (user) ←→ Claude Chat (architect-consultant)
                      ↓ prompt lengkap
               Claude Code (executor — otonomi tinggi)
                      ↓ laporan + diff verbatim
               Romo / Claude Chat (review + keputusan)
```

**Romo = decision authority.** Setiap keputusan arsitektur, schema, atau security
dikonsultasikan ke Romo — bukan dieksekusi tanpa konfirmasi.

**Claude Code — otonomi penuh untuk:**
- Baca, tulis, edit file JS/HTML/SQL/config
- `git add`, `git commit` (setelah diff ditampilkan verbatim)
- `supabase db push --linked --dry-run`
- `BEGIN...ROLLBACK` test migration

**Claude Code — STOP + tunggu konfirmasi eksplisit untuk:**
- `supabase db push --linked` (real, bukan dry-run)
- `supabase functions deploy ...`
- `git push origin main`

---

## 5. ATURAN OUTPUT (NON-NEGOTIABLE)

- Semua output perintah, diff, dan SQL WAJIB ditampilkan **verbatim di badan teks**
  sebagai markdown code block — bukan diringkas, bukan collapsed/dropdown,
  bukan diganti placeholder `[byte-identik]` atau `...`
- Klaim "self-review lulus" atau "commit berhasil" tanpa bukti verbatim = tidak lengkap,
  akan diminta ulang
- Kalau output panjang: **pecah jadi beberapa pesan** — jangan disingkat

---

## 6. ATURAN WORKFLOW

### 6a. Verifikasi pwd — LANGKAH PERTAMA
Jalankan `pwd` dan pastikan output mengandung `"SIP SMK"`.
Jika tidak → STOP, laporkan ke user.

### 6b. Mode kerja

**Mode A (Investigasi)** — konteks belum final:
Claude Code investigasi → lapor rekomendasi → STOP → tunggu konfirmasi

**Mode B (Implementasi penuh)** — konteks sudah final:
Claude Code investigasi cepat → apply → commit → STOP (tanpa push)

### 6c. Migration
- Format nama: `YYYYMMDDHHMMSS_nama-fitur.sql` (14 digit)
- Selalu `IF NOT EXISTS` / `OR REPLACE` (idempotent)
- Urutan wajib:
  ```sql
  BEGIN; /* isi migration */ ROLLBACK;  -- test dulu, tampilkan verbatim
  BEGIN; /* isi migration */ COMMIT;    -- baru permanent
  ```
- Setiap `CREATE FUNCTION ... SECURITY DEFINER` wajib disertai **dua** REVOKE:
  ```sql
  REVOKE EXECUTE ON FUNCTION nama_fungsi FROM PUBLIC;
  REVOKE EXECUTE ON FUNCTION nama_fungsi FROM anon;
  ```
  `REVOKE FROM PUBLIC` saja **tidak cukup** — Supabase beri grant eksplisit ke `anon`.

### 6d. Deploy — urutan wajib
```
supabase db push --linked --dry-run   → tampilkan verbatim → STOP → tunggu konfirmasi
supabase db push --linked             → tampilkan verbatim
supabase functions deploy <nama> --project-ref xovvuuwexoweoqyltepq   (jika ada)
git push origin main                  → urutan TERAKHIR
```
Alasan urutan: mencegah jendela waktu kode production memanggil RPC yang belum ada di DB.

`supabase functions deploy` dan `supabase functions list` **tidak menerima** `--linked` —
pakai `--project-ref xovvuuwexoweoqyltepq`.

### 6e. Git
- Tidak ada `git commit` tanpa diff verbatim direview
- Tidak ada `git push` tanpa konfirmasi eksplisit
- Tidak ada combined `git add + commit + push` satu langkah
- Setiap commit atomic (satu concern)

### 6f. Self Review 5 Poin — wajib sebelum apply apapun
1. Side effect ke tenant lain?
2. Migration idempotent (`IF NOT EXISTS` / `OR REPLACE`)?
3. REVOKE dua lapis jika ada SECURITY DEFINER baru?
4. Diff sudah ditampilkan verbatim?
5. Risiko data loss?

---

## 7. KONVENSI TEKNIS KRITIS

| Item | Aturan |
|------|--------|
| Inspeksi fungsi PostgreSQL | `pg_get_functiondef(oid)` — BUKAN `\df+` (hanya signature) |
| Query ke database | `supabase db query -f file.sql` — BUKAN `--sql` (flag tidak dikenal) |
| Attendance enum | `ALPA` — BUKAN `TIDAK_HADIR` |
| `day_of_week` enum | `SENIN, SELASA, RABU, KAMIS, JUMAT, SABTU` (tidak ada `MINGGU`) |
| Guard hari Minggu | `getDay() === 0 → return false` langsung |
| Supabase timeout | `statement_timeout = 2 menit` (tidak bisa `SET LOCAL`) |
| Max rows Supabase | dinaikkan ke 5000 |
| Excel schedule parser | origin B1 (bukan A1); XLSX.js index 0 = kolom B |
| Cron evaluate-teacher | `0 17 * * *` = jam 00:00 WIB |
| `subject_code_aliases` | persist `nama` + `jurusan` |
| Tenant isolation anchor | `school_id` di setiap tabel |

### Aturan RLS & Security (kritis)
- **Missing policy ≠ celah** — RLS default-deny. Baru masalah jika klien butuh akses itu.
- **`EXISTS` mentah** ke tabel RLS-protected lain di dalam `USING`/`WITH CHECK` dilarang —
  selalu lewat fungsi `SECURITY DEFINER` terpisah.
- **`service_role` bukan superuser** — fungsi yang dipanggil edge function via `service_role`
  tetap butuh `GRANT EXECUTE ... TO service_role` eksplisit.
- **Privilege kolom**: `REVOKE UPDATE (kolom)` tidak efektif jika masih ada grant UPDATE
  penuh di level tabel — lindungi dengan trigger `BEFORE UPDATE` allowlist default-deny.

---

## 8. SCHEMA DATABASE

### Schema `core` (append-only — tidak pernah DELETE)
`curriculum_versions`, `education_levels`, `phases`,
`vocational_fields`, `vocational_programs`, `vocational_concentrations`,
`subjects`, `subject_phases`, `capaian_pembelajaran`, `cp_elements`, `knowledge_national`

### Schema `public` — Teacher Workspace + AI Pipeline
`teacher_profiles`, `teaching_contexts`, `teacher_documents`,
`teacher_document_classes`, `teacher_document_approvals`,
`prompt_templates`, `generation_jobs`, `evaluation_logs`

### Fungsi helper penting
| Fungsi | Keterangan |
|--------|-----------|
| `fn_get_forum_recipient_candidates()` | kandidat penerima forum, per role group |
| `fn_apply_schedule_templates()` | TIMEOUT RISK — batch besar, ada issue 57014 |
| `fn_can_see_case()` | akses kasus BK — KEPSEK belum punya cabang (bug fungsional) |
| `evaluate_teacher_indicators()` | dijalankan cron 00:00 WIB |

---

## 9. STATUS PROYEK (per HEAD 6e52656, 31 Jul 2026)

### Selesai
- Audit keamanan Fase 1–3 ✅ (test suite 93/93)
- Sprint 1 Foundation Schema ✅ (18 Jul 2026)
- Forum Sekolah ✅ — semua portal (guru, student, parent, tu, admin)
  fitur: inbox + buat posting + komentar + attachment + panel penerima dua-level
- Forum Sekolah bug fixes ✅ (29 Jul 2026) — 11 bug diperbaiki dari audit:
  DB: SEMUA_GURU scope fix + tambah branch SEMUA_GURU_WALI di fn_get_forum_recipient_candidates
  UI: Guru Wali di semua panel, Kaprodi panel lengkap, Semua Siswa di branch else,
      TU tidak bisa broadcast ke sesama TU, school_id eksplisit di getParentForumRecipients,
      tab Terkirim ortu via helper API (bukan inline query)

### Blocker Go-Live (PRIORITAS TINGGI)
1. **Jadwal import SMK Uji E7** — blocker Go-Live tenant E1/E2/E4/E7
   Excel parser origin B1 sudah siap, tapi data E7 belum di-import
2. **Recovery UI timeout 57014** — `fn_apply_schedule_templates` timeout;
   solusi: batch DELETE + path recovery di UI admin

### Backlog Fitur (PRIORITAS SEDANG)
3. **Tab Perangkat Ajar** — Generate Promes, PPM, LKPD, Soal, Rubrik (UI belum ada;
   `generation_jobs` sudah schema-ready)
4. **Download .docx** dari `content_json` hasil generate
5. **Kolom Mapel di grid jadwal** admin — masih kosong
6. **Jadwal portal siswa dan ortu** — belum diimplementasi
7. **Filter mapel picker Generate ATP** guru Waka Kurikulum

### Backlog Jauh (belum disentuh)
- Approval workflow kepsek/waka di UI guru
- Regenerate limits (counter per tahun ajaran)
- Notifikasi push (FCM)
- `fn_can_see_case()` — KEPSEK lihat kasus PRIVATE/RESTRICTED (bug fungsional, bukan leak)

---

## 10. REFERENSI CEPAT

```bash
# Status sesi
pwd && git log --oneline -5 && git status --short
ls supabase/migrations/ | tail -5

# Inspeksi fungsi (gunakan ini, bukan \df+)
supabase db query -f - <<'SQL'
SELECT pg_get_functiondef(oid) FROM pg_proc WHERE proname = 'nama_fungsi';
SQL

# Test migration
supabase db query -f supabase/migrations/YYYYMMDDHHMMSS_nama.sql

# Deploy (urutan wajib — lihat §6d)
supabase db push --linked --dry-run
# ... review, konfirmasi, lalu:
supabase db push --linked

# Test suite
node tests/tenant-isolation.mjs
```

---

## 11. SLASH COMMANDS TERSEDIA

| Command | Kapan dipakai |
|---------|---------------|
| `/sip-start` | Pembuka setiap sesi — verifikasi pwd + status repo |
| `/sip-deploy` | Urutan deploy aman dengan checkpoint |
| `/sip-fn-inspect` | Inspeksi body fungsi PostgreSQL lengkap |
| `/sip-audit-tenant-full` | Audit tenant isolation semua 9 portal |
| `/audit-tenant` | Audit cepat (subset portal lama) |
| `/plan` | Sebelum task kompleks |
| `/effort high` | Migration, RLS, multi-file |
| `/effort medium` | Bug fix single file, UI tweak |
| `/code-review` | Sebelum push fitur baru |
| `/simplify` | Setelah implementasi |

Detail tiap command: `.claude/commands/`
