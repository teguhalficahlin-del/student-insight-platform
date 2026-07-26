# Student Insight Platform (SIP SMK) — Konteks untuk Claude Code

> Dokumen ini dibaca otomatis setiap sesi Claude Code.
> Baca SELURUH dokumen sebelum mengerjakan apapun.

---

## 1. IDENTITAS PROYEK

**Nama:** Student Insight Platform — SIP SMK
**Deskripsi:** Multi-tenant SaaS untuk SMK. Satu Supabase project, banyak sekolah,
terisolasi via RLS `school_id`. Backend: Supabase/PostgreSQL + RLS.
Frontend: Vanilla JS/HTML. Hosting: GitHub Pages.

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
ID lama `cc1e152e-...` adalah SALAH — jangan gunakan.

---

## 3. STRUKTUR PORTAL

```
guru/         → guru/js/api.js + guru/js/guru.js (+ per-tab JS)
siswa/        → siswa/js/api.js + siswa/js/siswa.js
ortu/         → ortu/js/api.js + ortu/js/ortu.js
admin/        → admin/js/api.js + admin/js/admin.js
superadmin/   → superadmin/js/api.js + superadmin/js/superadmin.js
dudi/         → dudi/js/api.js + dudi/js/dudi.js
stakeholder/  → stakeholder/js/api.js + stakeholder/js/stakeholder.js
```

Setiap portal punya `index.html` (login) + `dashboard.html` (main app).
RLS selalu filter berdasarkan `school_id` tenant.

**View aman:** `v_users_staff_directory` (8 kolom, security_invoker=true) —
gunakan ini untuk semua query daftar staf, bukan `.from('users')` langsung.

---

## 4. ATURAN WORKFLOW (NON-NEGOTIABLE)

### 4a. Verifikasi pwd
**LANGKAH PERTAMA setiap sesi:** jalankan `pwd` dan pastikan output mengandung
`"SIP SMK"`. Jika tidak → STOP, laporkan ke user.

### 4b. Migration
- Tampilkan isi migration **verbatim** ke user sebelum apply apapun
- Tunggu konfirmasi eksplisit — tanpa kecuali
- Selalu jalankan `BEGIN ... ROLLBACK` test dulu sebelum permanent apply
- Format nama: `YYYYMMDDHHMMSS_nama-fitur.sql` (14 digit timestamp)
- Selalu `IF NOT EXISTS` / `OR REPLACE` untuk idempotency
- Setiap `CREATE FUNCTION ... SECURITY DEFINER` baru wajib disertai:
  ```sql
  REVOKE EXECUTE ON FUNCTION nama_fungsi FROM PUBLIC;
  REVOKE EXECUTE ON FUNCTION nama_fungsi FROM anon;
  ```
  `REVOKE FROM PUBLIC` saja **tidak cukup** — Supabase beri grant eksplisit ke `anon`.

### 4c. Git
- Tidak ada `git commit` tanpa review diff verbatim dulu
- Tidak ada `git push` tanpa konfirmasi eksplisit user
- Tidak ada combined `git add + commit + push` dalam satu perintah
- Setiap commit harus atomic (satu concern per commit)

### 4d. Output
- Semua output penting wajib ditulis verbatim ke badan teks sebagai markdown code block
- Jangan hanya bilang "sudah selesai" — tunjukkan hasilnya

### 4e. RLS
- Missing RLS policy **bukan otomatis celah** — RLS default-deny
- Verifikasi live (simulasi cross-tenant) SEBELUM membuat fix
- Lihat `docs/audit-handoff.md §3a` untuk standing rules lengkap audit keamanan

---

## 5. ATURAN PROMPT (WAJIB)

### Dua mode:

**MODE A — Konteks BELUM final:**
Claude Code: investigasi + beri REKOMENDASI FIX saja → STOP → tunggu konfirmasi

**MODE B — Konteks SUDAH final:**
Claude Code: selesaikan PENUH (investigasi + analisis dampak + self review + apply + push)
Claude Chat hanya terima hasil akhir.

### Setiap prompt WAJIB memiliki:
1. `VERIFIKASI pwd` — cek path mengandung "SIP SMK"
2. `BATASAN KERAS` — file apa saja yang boleh disentuh
3. `SCOPE` — deskripsi singkat apa yang dikerjakan
4. `INVESTIGASI` — bash commands untuk gather context
5. `SELF REVIEW 5 POIN` sebelum apply apapun
6. `JIKA LULUS` / `JIKA RISIKO` — dua jalur keputusan

### SELF REVIEW 5 POIN (wajib sebelum apply):
1. Apakah ada side effect ke tenant lain?
2. Apakah migration sudah idempotent?
3. Apakah REVOKE sudah dua lapis jika ada SECURITY DEFINER baru?
4. Apakah diff sudah di-review verbatim?
5. Apakah ada risiko data loss?

---

## 6. TEMPLATE PROMPT STANDAR

```
VERIFIKASI pwd — pastikan path mengandung "SIP SMK"

BATASAN KERAS:
- HANYA boleh mengubah: [daftar file spesifik]
- DILARANG menyentuh: [daftar file yang off-limits]

SCOPE: [deskripsi satu kalimat]

/plan
/effort [low|medium|high]

TUJUAN:
[Apa yang harus dicapai]

KONTEKS:
- HEAD: [commit hash]
- [konteks relevan lainnya]

INVESTIGASI:
```bash
# [perintah bash untuk gather context]
```

ANALISIS DAMPAK:
[Apa yang berubah, tenant mana yang terpengaruh, risiko apa]

SELF REVIEW — sebelum apply:
1. Side effect ke tenant lain?
2. Migration idempotent?
3. REVOKE dua lapis jika ada SECURITY DEFINER baru?
4. Diff sudah di-review verbatim?
5. Risiko data loss?

JIKA LULUS → [langkah apply + push]
JIKA RISIKO → jangan apply + laporkan spesifik + STOP
```

---

## 7. ATURAN MIGRATION (DETAIL)

```sql
-- Format nama file: YYYYMMDDHHMMSS_nama-fitur.sql
-- Selalu test dulu:
BEGIN;
  -- isi migration
ROLLBACK; -- test, pastikan tidak ada error

-- Baru apply permanent:
BEGIN;
  -- isi migration
COMMIT;
```

**Setelah apply:**
```bash
supabase db push   # sync ke remote
git add supabase/migrations/YYYYMMDDHHMMSS_nama-fitur.sql
git commit -m "feat(db): deskripsi singkat"
git push
```

---

## 8. SLASH COMMANDS RELEVAN

| Command | Kapan dipakai |
|---------|---------------|
| `/plan` | Sebelum task kompleks — buat rencana dulu |
| `/effort high` | Task yang menyentuh migration, RLS, atau multi-file |
| `/effort medium` | Bug fix single file, UI tweak |
| `/effort low` | Pertanyaan investigasi, doc update kecil |
| `/code-review` | Sebelum push fitur baru atau migration |
| `/simplify` | Setelah implementasi — cek ada yang bisa disederhanakan |

---

## 9. BACKLOG PRIORITAS (per HEAD 1e75cd7, 26 Jul 2026)

### PRIORITAS TINGGI (blocker atau security)
1. **Jadwal import SMK Uji E7** — blocker Go-Live tenant E1/E2/E4/E7;
   Excel parser (origin B1, index 0 = kolom B) sudah diimplementasi tapi
   data E7 belum di-import
2. **Security: client migration 7 portal** ke `v_users_staff_directory`
   (PRIORITAS 1 audit — sebagian sudah di-fix di commit caac5f8,
   sisanya belum dicek semua portal)
3. **Security: Fase 3 FINDING 4** — 14 anon=true helper functions
   (query live ke pg_proc sudah konfirmasi 0 rows, tapi perlu verifikasi
   ulang setelah migration terbaru)
4. **Recovery UI: timeout 57014** — `fn_apply_schedule_templates` timeout
   di statement besar; solusi: batch DELETE + path recovery di UI admin

### PRIORITAS SEDANG (fitur)
5. **Tab Perangkat Ajar** — Generate Promes, PPM, LKPD, Soal, Rubrik
   (AI pipeline via `generation_jobs` sudah schema-ready, UI belum)
6. **Download .docx** dari `content_json` hasil generate
7. **Kolom Mapel di grid jadwal** (admin dashboard + wizard) masih kosong
8. **Jadwal portal siswa dan ortu** — belum diimplementasi sama sekali
9. **Filter mapel picker Generate ATP** guru Waka Kurikulum (Ipelda)

### BELUM DISENTUH (backlog jauh)
- Approval workflow kepsek/waka di UI guru
- Regenerate limits (counter per tahun ajaran)
- Notifikasi push (FCM)
- WAKA_HUMAS PKL scope
- KEPSEK lihat kasus PRIVATE/RESTRICTED di luar keterlibatan
  (`fn_can_see_case()` tidak punya cabang `OR fn_is_kepsek()` —
  bug fungsional, bukan security leak)

---

## 10. CONSTRAINT TEKNIS PENTING

| Constraint | Nilai / Aturan |
|-----------|----------------|
| Attendance enum | `ALPA` (bukan `TIDAK_HADIR`) |
| `day_of_week` enum | `SENIN, SELASA, RABU, KAMIS, JUMAT, SABTU` (tidak ada `MINGGU`) |
| `isOnDutyToday` guard | `getDay() === 0` → `return false` langsung |
| Supabase free tier timeout | `statement_timeout = 2 menit` (tidak bisa di-override `SET LOCAL`) |
| Max rows Supabase | sudah dinaikkan ke 5000 |
| Excel schedule parser | origin B1 (bukan A1); XLSX.js array index 0 = kolom B |
| Cron `evaluate-teacher-indicators` | `0 17 * * *` = jam 00:00 WIB |
| `v_users_staff_directory` | 8 kolom aman, `security_invoker=true` |
| `subject_code_aliases` | persist `nama` dan `jurusan` (HEAD 1e75cd7) |
| Tenant isolation anchor | `school_id` di setiap tabel |

---

## 11. STATUS AUDIT KEAMANAN (selesai)

- **Fase 1** ✅ — Schema baseline, RLS foundation
- **Fase 2** ✅ (9 Jul 2026) — Kelompok A–E, 70 policy scan, 4 SECURITY DEFINER fix,
  PRIORITAS 1 client migration `v_users_staff_directory`, D1/D2 dikonfirmasi aman
- **Fase 3** ✅ (12 Jul 2026) — 14 anon=true functions verified clean,
  WAKA_HUMAS/PKL scope confirmed by design, column-restriction risk accepted
- **Test suite:** 93/93 ✓ (terakhir dijalankan 12 Jul 2026, 15 CHECK top-level)
- **Sprint 1 Foundation Schema** ✅ (18 Jul 2026) — schema `core` (11 tabel append-only)
  + schema `public` baru (8 tabel Teacher Workspace + AI Pipeline)

Detail lengkap: `docs/audit-handoff.md`

---

## 12. REFERENSI CEPAT

```bash
# Lihat migration terbaru
ls supabase/migrations/ | tail -5

# Status git
git status && git log --oneline -5

# Push ke Supabase
supabase db push

# Test suite
node tests/tenant-isolation.mjs
```
