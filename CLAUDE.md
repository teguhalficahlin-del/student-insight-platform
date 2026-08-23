# Student Insight Platform — SIP SMK
# Konteks untuk Claude Code

> Baca SELURUH dokumen ini sebelum mengerjakan apapun.
> WAJIB baca juga `AGENT_WORKING_RULES.md` di root repo — dokumen itu memuat aturan
> kerja agen yang berlaku penuh, baik diminta eksplisit di prompt maupun tidak.
> Pembagiannya: `AGENT_WORKING_RULES.md` = cara kerja agen; `CLAUDE.md` = konteks
> proyek + aturan teknis. Kalau keduanya berbeda, `AGENT_WORKING_RULES.md` menang.
> CONTEXT.md deprecated.

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

### 5a. Verbatim = teks di badan pesan, BUKAN tool output
Output WAJIB muncul sebagai teks di badan pesan — bukan sebagai tool output
collapsed/dropdown. Jika output muncul sebagai tool result yang bisa di-collapse
di UI Claude Code, itu TIDAK memenuhi syarat verbatim. Cara yang benar: salin
teks terminal ke dalam badan pesan sebagai teks biasa, bukan via tool display.
Ini berlaku untuk semua output: `git show`, `git log`, `git push`, `git diff`,
hasil query SQL, dan output bash apapun yang diminta Claude Chat untuk direview.

---

## 6. ATURAN WORKFLOW

### 6a. Verifikasi pembuka — LANGKAH PERTAMA
1. Jalankan `pwd` dan pastikan output mengandung `"SIP SMK"`.
   Jika tidak → STOP, laporkan ke user.
2. Sebutkan **eksplisit di awal respons** bahwa `AGENT_WORKING_RULES.md` dan
   `CLAUDE.md` sudah dibaca — satu kalimat konfirmasi, bukan asumsi diam-diam.

Kalau salah satu verifikasi ini belum dilakukan, JANGAN lanjut ke pekerjaan
apapun — laporkan dulu bahwa verifikasi belum lengkap.

### 6b. Mode kerja

**Mode A (Investigasi)** — konteks belum final:
Claude Code investigasi → lapor rekomendasi → STOP → tunggu konfirmasi

**Mode B (Implementasi penuh)** — konteks sudah final:
Claude Code investigasi cepat → apply → commit → STOP (tanpa push)

**Mode C (Sprint Fix — Freebuff Audit)** — khusus untuk sprint
perbaikan hasil audit freebuff. Setiap prompt sprint mengikuti
struktur 5 fase berikut tanpa pengecualian:

**KLASIFIKASI SPRINT** — wajib dicantumkan di baris pertama setiap
prompt sprint:
```
KLASIFIKASI SPRINT:
- Tipe: [JS/HTML only | Edge Function | Migration DB | Campuran]
- Auto-execute FASE 4: [YA | TIDAK — tunggu konfirmasi Romo]
```

Aturan klasifikasi:
| Tipe | Contoh | Auto-execute FASE 4? |
|------|--------|----------------------|
| JS/HTML only | *.js, *.html di folder portal | YA — jika semua gate lulus. §4 dilonggarkan khusus tipe ini: git push boleh otomatis tanpa konfirmasi terpisah |
| Edge Function | supabase/functions/** | TIDAK — STOP setelah FASE 3, tampilkan hasil, tunggu konfirmasi Romo |
| Migration DB | supabase/migrations/** | TIDAK — STOP setelah FASE 3, tampilkan hasil, tunggu konfirmasi Romo |
| Campuran | Kombinasi tipe di atas | Ikuti aturan tipe paling ketat |

**FASE 0 — BASELINE SNAPSHOT**
- Jalankan `pwd`, baca `AGENT_WORKING_RULES.md` + `CLAUDE.md`
- Jalankan test suite baseline:
```
  node tests/tenant-isolation.mjs 2>&1
  npx playwright test --reporter=list 2>&1 (jika tersedia)
```
- Catat jumlah pass/fail sebagai baseline — tampilkan verbatim
- GATE 0: Jika baseline sudah ada test yang fail sebelum perubahan
  apapun → STOP, laporkan, jangan lanjut. Bukan tanggung jawab sprint ini.

**FASE 1 — MAPPING AKTUAL**
- Untuk setiap finding dalam prompt: jalankan grep/cat aktual ke file,
  tampilkan baris yang ditemukan verbatim di badan teks
- Identifikasi semua file yang akan disentuh
- Grep semua dynamic caller dari fungsi yang akan diubah:
  event listeners, callback, object dispatch (contoh: PANEL_RENDERERS),
  import/export chain
- GATE 1: Jika finding tidak ditemukan di lokasi yang diharapkan,
  atau lokasi berbeda dari deskripsi audit → STOP, laporkan detail
  perbedaan, jangan lanjut ke FASE 2

**FASE 2 — DIFF + TARGETED TEST PLAN**
- Tulis diff lengkap untuk setiap file yang akan diubah,
  verbatim di badan teks dalam format:
```diff
  --- a/path/file
  +++ b/path/file
  @@ ... @@
  - baris lama
  + baris baru
```
- Untuk setiap finding yang di-fix, tulis test case minimal yang
  membuktikan bug tidak ada lagi setelah fix (bukan hanya pernyataan)
- Analisis dampak per file: fungsi yang terpengaruh, fungsi yang TIDAK
  terpengaruh, potensi regresi
- GATE 2: Jika tidak bisa menulis test case konkret yang membuktikan
  fix, atau jika analisis dampak menemukan risiko tinggi → STOP,
  laporkan, jangan lanjut ke FASE 3

**FASE 3 — APPLY + TEST**
- Simpan backup: `git stash push -m "backup-sebelum-[nama-sprint]"`
- Apply perubahan ke working tree
- Jalankan targeted test dari FASE 2 — tampilkan output verbatim
- Jalankan full test suite:
```
  node tests/tenant-isolation.mjs 2>&1
  npx playwright test --reporter=list 2>&1 (jika tersedia)
```
- Bandingkan jumlah pass/fail dengan baseline FASE 0
- Tampilkan seluruh output test verbatim di badan teks
- GATE 3: Jika targeted test fail, ATAU jumlah pass Playwright/
  tenant-isolation berkurang dari baseline →
```
  git checkout -- .
  git stash drop
```
  STOP, laporkan output lengkap, jangan lanjut ke FASE 4

**FASE 4 — COMMIT + PUSH**
- Hanya dieksekusi jika GATE 0 + 1 + 2 + 3 semua lulus
- Jika Auto-execute FASE 4: TIDAK → STOP setelah FASE 3,
  tampilkan semua hasil, tunggu konfirmasi eksplisit Romo
- Jika Auto-execute FASE 4: YA (JS/HTML only):
```
  git add [file spesifik — BUKAN git add .]
  git commit -m "fix([scope]): [deskripsi ringkas findings]"
  git push origin main
```
  Laporkan verbatim: commit hash, file yang berubah,
  test count before vs after
  STOP

### 6c. Migration
- Format nama: `YYYYMMDDHHMMSS_nama-fitur.sql` (14 digit)
- Selalu `IF NOT EXISTS` / `OR REPLACE` (idempotent)
- Urutan wajib:
  ```sql
  BEGIN; /* isi migration */ ROLLBACK;  -- test dulu, tampilkan verbatim
  BEGIN; /* isi migration */ COMMIT;    -- baru permanent
  ```
- Setiap `CREATE FUNCTION ... SECURITY DEFINER` wajib disertai, **di migration yang
  sama**, satu GRANT + dua REVOKE dengan urutan:
  ```sql
  GRANT   EXECUTE ON FUNCTION nama_fungsi TO authenticated;  -- role yang dituju
  REVOKE  EXECUTE ON FUNCTION nama_fungsi FROM anon;         -- wajib
  REVOKE  EXECUTE ON FUNCTION nama_fungsi FROM PUBLIC;       -- defense-in-depth
  ```
  `REVOKE FROM PUBLIC` saja **tidak cukup** — Supabase beri grant eksplisit ke `anon`
  yang tidak ikut tercabut oleh revoke dari `PUBLIC`.

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

**PERINGATAN — `supabase db query` BUKAN dry-run:**
JANGAN gunakan `supabase db query --linked -f file.sql` untuk test migration —
perintah ini langsung eksekusi ke remote DB, bukan dry-run. Untuk test SQL yang
aman gunakan `BEGIN; ... ROLLBACK;` di local DB saja, atau
`supabase db push --linked --dry-run` untuk preview migration.

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

Untuk sprint Mode C, self-review di atas tetap berlaku DAN dilengkapi
dengan gate aktif di setiap fase (GATE 0–3). Gate bukan pengganti
self-review — keduanya wajib dijalankan. Jika self-review 5 poin
menemukan masalah di tengah FASE manapun, perlakukan sebagai gate
gagal: STOP dan laporkan.

### 6g. Presisi kerja
- **Jangan menulis ulang kode dari ingatan.** Definisi fungsi/kode existing yang akan
  diedit atau dijadikan rujukan wajib dibaca langsung dari sumbernya — bukan
  direkonstruksi dari deskripsi di prompt atau ingatan sesi sebelumnya.
- **Verifikasi tipe data dan operator** sebelum menulis SQL yang memakai agregat atau
  operator non-trivial. Contoh nyata: `MIN()`/`MAX()` **tidak berlaku** untuk tipe
  `uuid` di PostgreSQL — pernah lolos ke migration dan baru ketahuan saat deploy gagal.
- **Migration yang mengubah DATA EXISTING** (bukan sekadar perilaku untuk data baru):
  investigasi SEMUA edge case dalam SATU putaran sebelum menulis migration final.
  Checklist minimal:
  - Ada baris "campuran" kondisi lama dan baru yang perlu ditangani beda?
  - Ada risiko konflik nilai (beberapa baris seharusnya satu grup tapi datanya beda)?
  - `EXPLAIN ANALYZE` — **wajib** untuk UPDATE/DELETE >1000 baris, mengingat
    `statement_timeout` 2 menit di Supabase.
  - Operator/fungsi yang dipakai valid untuk tipe kolom sebenarnya?

  Jangan temukan edge case satu-satu secara reaktif setelah commit pertama.

### 6h. Batasan perubahan
- HANYA ubah file yang eksplisit disebut di `BATASAN KERAS` pada prompt yang diterima.
- Perlakukan `BATASAN KERAS` sebagai pagar keras, bukan saran yang bisa dilonggarkan.
- Kalau di tengah pekerjaan ternyata perlu menyentuh file di luar daftar → STOP,
  laporkan kebutuhan itu, jangan langsung dikerjakan.

### 6i. Efisiensi usage
- Jangan investigasi ulang hal yang sudah dikonfirmasi di sesi yang sama — cek histori
  commit/percakapan dulu sebelum menjalankan query yang sama lagi.
- Jangan buka file yang tidak relevan dengan scope prompt.
- Task kecil berisiko rendah: jangan over-investigate.
- **Tapi** untuk migration yang menyentuh data produksi, kelengkapan verifikasi lebih
  penting daripada kecepatan — jangan potong `EXPLAIN ANALYZE`, cek edge case, atau
  verifikasi pasca-deploy demi hemat waktu/token.

### 6j. Checklist akhir sebelum STOP — cantumkan di akhir setiap laporan
- [ ] pwd terverifikasi mengandung "SIP SMK"
- [ ] `AGENT_WORKING_RULES.md` + `CLAUDE.md` sudah dibaca — disebutkan eksplisit di awal
- [ ] Semua perubahan sesuai `BATASAN KERAS` — tidak ada file di luar daftar tersentuh
- [ ] Diff/output ditampilkan verbatim di badan teks — bukan ringkasan atau placeholder
- [ ] Tidak ada push/deploy tanpa instruksi eksplisit terpisah
- [ ] Setiap output yang diminta muncul sebagai teks biasa di badan pesan — bukan tool
      output collapsed. Kalau ragu, paste ulang sebagai teks.

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
