# Audit Handoff — Student Insight Platform
**Dibuat:** 7 Juli 2026  
**Tujuan:** Dokumen orientasi untuk sesi Claude Code baru yang tidak punya riwayat percakapan sebelumnya. Baca dari atas ke bawah sebelum mulai bekerja.

---

## 1. Konteks & Tujuan Audit

### Platform

**Student Insight Platform** adalah SaaS monitoring perkembangan siswa untuk SMK, dibangun di atas Supabase (PostgreSQL + Row-Level Security) dan di-host di GitHub Pages. Arsitekturnya **multi-tenant**: satu database dipakai bersama oleh banyak sekolah, isolasi data antar-sekolah sepenuhnya bergantung pada RLS + fungsi helper `fn_current_school_id()`.

- **Project Supabase:** `xovvuuwexoweoqyltepq` (region: ap-southeast-1)  
- **Repo GitHub:** `teguhalficahlin-del/student-insight-platform` (branch: `main`)  
- **7 portal:** `admin/`, `guru/`, `student/`, `parent/`, `dudi/`, `stakeholder/`, `superadmin/`  
- **3 sekolah uji live:** SMK Harapan Rokan (`smkhr`), SMK Karya Bangsa (`smkkb`), SMK Harapan Bangsa (`smkhb`)  
- **Status go-live:** Belum ada sekolah nyata yang pakai; data uji saja → migrasi skema agresif masih boleh.

### Peran Kerja

| Peran | Tanggung Jawab |
|-------|---------------|
| **Romo** (pemilik) | Keputusan final atas setiap fix/perubahan. Semua fix WAJIB konfirmasi Romo sebelum dijalankan. |
| **Claude/chat** | Arsitek-konsultan. Menyusun konteks audit, prompt tugas, dan rekomendasi. |
| **Claude Code** (sesi ini) | Eksekutor. Menjalankan query read-only, investigasi, dan migration fix. |

### Kerangka 6 Fase Audit

Fase-fase berikut direncanakan di awal sesi audit (6–7 Juli 2026). Fase 1 dan 2 paling terdokumentasi; nama persis Fase 3–6 perlu dikonfirmasi dari histori percakapan di akun pemilik jika ada perubahan:

| Fase | Nama | Status |
|------|------|--------|
| **1** | Temuan Langsung — Branding, Credential & Privilege Exposure | ✅ SELESAI |
| **2** | RLS & Tenant Isolation (semua tabel/policy) | 🔄 SEDANG BERJALAN |
| **3** | Access Control per Aktor (capability audit per portal) | ⏳ Belum dimulai |
| **4** | Frontend Security (input validation, XSS, offline queue) | ⏳ Belum dimulai |
| **5** | Skalabilitas & Performance | ⏸ DITUNDA (lihat §3) |
| **6** | Go-live Readiness Check & Penetration Test | ⏳ Belum dimulai |

---

## 2. Status Fase 1 — SELESAI ✅

Laporan lengkap: `audit-fase1-branding-secret-exposure.md` (di root repo, belum di-commit).

| # | Temuan | Fix | Migration |
|---|--------|-----|-----------|
| F1-A | Nama sekolah pertama (`SMK Harapan Rokan`) hardcode di `offline.html` dan 2 file `manifest.json` — terlihat oleh pengguna sekolah lain | Ganti dengan placeholder; branding dinamis dari `shared/branding.js` | Tidak ada migration — perubahan HTML/JSON. Commit `b1d4cd4`. |
| F1-B | Default password `12345678` hardcode di 4 file JS client | Ganti dengan `generate_random_password()` via RPC; tambah kolom `password_changed_at` | `20260706140000` (tambah kolom `password_changed_at`). Commit `5dfa909`. |
| F1-C | Flag `must_change_password` bisa di-clear langsung dari client (UPDATE kolom bebas) | REVOKE UPDATE kolom sensitif dari `authenticated`; buat RPC SECURITY DEFINER `fn_confirm_password_change` | `20260706150000` (guard_password_flags), `20260706160000` (revoke confirm_password dari PUBLIC), `20260706170000` (revoke dari anon). Commit `8e794a9`. |
| F1-D | Beberapa RPC SECURITY DEFINER (fn_apply_schedule_templates, fn_batalkan_tahun_ajaran, dll.) bisa dieksekusi oleh `anon` — bypass edge function auth | REVOKE EXECUTE FROM PUBLIC + FROM anon, GRANT hanya ke `authenticated`/`service_role` | `20260703190000` (revoke batch RPC privileged), `20260703210000` (revoke branding update anon), `20260703270000` (revoke fn_sync_case anon), `20260704120000` (revoke purge/reapply dari public), `20260706180000` (guard kolom users via BEFORE UPDATE trigger). |

---

## 3. Status Fase 2 — SEDANG BERJALAN 🔄

### 3.1 Fase 2.1 — RLS Coverage Scan (SELESAI ✅)

Laporan: `docs/audit/fase2-1-rls-coverage-report.md`

Semua 33 tabel di-scan. Hasil: RLS enabled di semua tabel. Ditemukan 14 tabel 🟠 HIGH (missing write policies) dan 3 tabel 🟡 MEDIUM (policy ada tapi ada celah). Dua celah kritis dari scan ini sudah di-fix:

- `20260706190000` — fix RLS `rls_pkl_ortu` yang tidak punya guard `school_id` (pkl_placements/pkl_attendance via ortu)
- `20260706200000` — restrict `schedule_time_slots` READ hanya ke admin (sebelumnya semua role)

Juga fix SEC-1 (sebelum audit ini dimulai resmi): `20260703230000` — 7 views diberi `SECURITY INVOKER=true` untuk cegah bypass RLS via view publik.

### 3.2 Fase 2.2 — Deep Audit per Kelompok (Kelompok A, B, C SELESAI; D, E SEBAGIAN)

Laporan: `docs/audit/fase2-2-kelompok-a-report.md`, `*-b-report.md`, `*-c-report.md`

#### Kelompok A — Join `student_parents` (7 policy, 100% selesai ✅)

| ID | Policy | Tabel | Status |
|----|--------|-------|--------|
| A1–A6 | rls_attendance/case_events/cases/enrollments/student_updates/students_read_parent | Berbagai | 🟢 AMAN — semua punya guard `school_id` eksplisit terdepan |
| **A7** | `rls_schedules_read_parent` | `teaching_schedules` | 🟡 → ✅ **FIXED** — `ce.school_id = fn_current_school_id()` ditambahkan ke subquery `class_enrollments`. Mig `20260706210000`. |

#### Kelompok B — Join Penugasan Guru/Jadwal (3 policy, 100% selesai ✅)

| ID | Policy | Tabel | Status |
|----|--------|-------|--------|
| B1 | `rls_attendance_rw_guru` | `attendance` | 🟢 AMAN |
| B2 | `rls_attendance_rw_substitute` | `attendance` | 🟢 AMAN |
| **B3** | `rls_schedules_read_student` | `teaching_schedules` | 🟡 → ✅ **FIXED** — simetris dengan A7. Mig `20260707100000`. |

#### Kelompok C — Pola Fungsi/Kondisi Khusus Siswa (3 policy, 100% selesai ✅)

| ID | Policy | Tabel | Status |
|----|--------|-------|--------|
| C1 | `rls_case_events_read_student` | `case_events` | 🟢 AMAN |
| **C2** | `rls_cases_insert` | `cases` | 🔴 → ✅ **FIXED** — staff sekolah A bisa INSERT kasus dengan `student_id` milik sekolah B. Fix: fungsi SECURITY DEFINER `fn_student_in_current_school(uuid)` + tambah ke WITH CHECK. Mig `20260707110000` (attempt 1, gagal karena RLS students), `20260707120000` (fix final via SECURITY DEFINER). |
| **C3** | `rls_pkl_attendance_read_kaprodi` | `pkl_attendance` | 🟡 struktural — subquery `students` tanpa `s.school_id` eksplisit. **Severity: (b) TIDAK EXPLOITABLE** — verified live 7 Juli 2026. Outer guard `pkl_attendance.school_id = fn_current_school_id()` sudah menutup celah. Defense-in-depth fix opsional, prioritas rendah. |

#### Kelompok D — 14 Tabel 🟠 HIGH: Missing Write Policies (SEBAGIAN DIANALISIS)

Grep kode client menunjukkan hampir semua tabel ini tidak butuh client write (ditulis via trigger/service_role/edge function). Ringkasan:

| Status | Tabel |
|--------|-------|
| **Tidak butuh aksi** — RLS default-deny sudah aman, write via service_role | `audit_log`, `login_devices`, `platform_config`, `schools`, `sync_idempotency`, `teacher_attendance_log` |
| **Tidak butuh aksi** — junction table, UPDATE tidak ada use case | `case_audience_members`, `observation_audience_members` |
| **Tidak butuh aksi** — append-only by design | `case_events`, `student_updates` |
| **Tidak butuh aksi** — INSERT via trigger, client hanya UPDATE `is_read` | `notifications` |
| **Tidak butuh aksi** — client SELECT only, write via edge fn | `parent_messages` |
| **⚠️ PERLU KLARIFIKASI** | `academic_periods` — admin portal melakukan INSERT+UPDATE langsung, tapi tidak ada DELETE policy. Apakah DELETE dibutuhkan, atau via RPC? |
| **⚠️ PERLU KLARIFIKASI** | `achievements` — tidak ada client write ditemukan. Apakah tabel ini aktif dipakai dan diisi via mana? |

#### Kelompok E — 2 Item 🟡 MEDIUM (BELUM DIVERIFIKASI LIVE ⚠️)

> **PRIORITAS BERIKUTNYA untuk sesi lanjutan.**

| ID | Policy | Tabel | Temuan Awal | Status |
|----|--------|-------|-------------|--------|
| **E1** | `rls_pkl_read_ortu` | `pkl_placements` | Policy ortu tidak punya guard `school_id` eksplisit — hanya join ke `student_parents` | **BELUM DIVERIFIKASI LIVE** — jangan asumsi aman atau berbahaya sebelum simulasi cross-tenant seperti yang dilakukan untuk C3 |
| **E2** | Policy read `schedule_time_slots` | `schedule_time_slots` | Semua role bisa baca (tidak ada filter role) — apakah disengaja? | **BELUM DIVERIFIKASI LIVE** |

#### Cakupan Keseluruhan Fase 2

- **Fase 2.1** (RLS coverage scan): 33/33 tabel = 100% ✅  
- **Fase 2.2 Kelompok A–C**: 13/13 policy = 100% ✅  
- **Kelompok D**: Dianalisis via grep kode, 12/14 jelas aman, 2 perlu klarifikasi  
- **Kelompok E**: 0/2 diverifikasi live  
- **Policy di luar Kelompok A–E**: ~47+ policy dari tabel lain (absensi guru, PKL full, users, observations, dll.) belum di-deep-audit secara formal → estimasi **<25% dari total ~60+ policy tujuan Fase 2**.

#### Fase 5 — Skalabilitas: DITUNDA ⏸

7 temuan ditemukan (login serial, thundering herd branding, cache) tapi **ditunda oleh Romo** sampai ada rencana scaling nyata. Laporan ada di `docs/audit/` (belum dibuat formal). Jangan angkat di sesi ini kecuali diminta.

---

## 3a. Standing Rules / Pelajaran Kunci — WAJIB DIIKUTI

Pelajaran ini didapat dari kesalahan/kejutan nyata selama audit. Sesi berikutnya **harus** mengikutinya.

### Rule 1: SECURITY DEFINER = REVOKE dua lapis wajib

Setiap kali membuat `CREATE OR REPLACE FUNCTION ... SECURITY DEFINER`, migration yang **sama** harus mengandung:

```sql
REVOKE EXECUTE ON FUNCTION public.fn_nama_fungsi(...) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_nama_fungsi(...) FROM anon;
GRANT  EXECUTE ON FUNCTION public.fn_nama_fungsi(...) TO authenticated;
GRANT  EXECUTE ON FUNCTION public.fn_nama_fungsi(...) TO service_role;
```

**Mengapa:** Supabase default privileges memberikan GRANT EXECUTE eksplisit terpisah ke `anon` — REVOKE FROM PUBLIC saja tidak mencabut grant eksplisit itu. Dibuktikan: beberapa RPC lama bocor ke anon meski sudah REVOKE PUBLIC.

### Rule 2: GRANT ALL default tabel tidak bisa diblokir via REVOKE kolom

Supabase memberikan `GRANT ALL` ke `anon` dan `authenticated` untuk semua tabel baru secara default. Pendekatan REVOKE kolom tertentu dari `authenticated` tidak efektif karena row-level grant-all sudah ada. Untuk proteksi per-kolom (misal: mencegah update `must_change_password` dari client), gunakan **trigger BEFORE UPDATE** yang memvalidasi kolom mana yang boleh diubah.

**Mengapa:** Coba REVOKE kolom saja → client masih bisa bypass via UPDATE row penuh. Fix nyata: `20260706180000` guard_users_protected_columns memakai trigger.

### Rule 3: EXISTS di USING/WITH CHECK tunduk RLS pemanggil

Jika di dalam policy `USING` atau `WITH CHECK` ada subquery ke tabel lain yang ber-RLS, subquery itu berjalan dengan konteks RLS **user yang sedang mengakses**, bukan akses penuh. 

Contoh nyata: mencoba menambahkan `AND EXISTS (SELECT 1 FROM students WHERE ...)` ke `rls_cases_insert` — gagal karena GURU hanya bisa "melihat" siswa yang diajarnya, sehingga siswa yang valid dari sekolah yang sama pun tidak terlihat.

**Solusi:** Buat fungsi helper terpisah dengan `SECURITY DEFINER` (pola `fn_student_in_current_school`, `fn_student_is_on_pkl`) untuk validasi struktural lintas-tabel. Jangan lupa Rule 1.

### Rule 4: Missing policy BUKAN otomatis celah — verifikasi live dulu

RLS PostgreSQL default-deny: jika tidak ada policy untuk suatu command, command itu **ditolak** untuk `authenticated`. "Missing INSERT policy" berarti client tidak bisa INSERT — itu aman, bukan lubang.

**Wajib:** verifikasi live (simulasi cross-tenant nyata dengan user uji di kedua sekolah) SEBELUM memutuskan apakah gap berbahaya. Jangan asumsi dari pola kode saja. Contoh: C3 (`rls_pkl_attendance_read_kaprodi`) tampak bergap secara struktural, tapi tes live membuktikan tidak bisa dieksploitasi karena outer guard sudah menutupnya.

### Rule 5: Setiap migration wajib ditunjukkan untuk konfirmasi sebelum push

Bahkan di sesi yang terasa lancar dan otonom, **jangan push migration tanpa menunjukkan isinya ke Romo untuk konfirmasi terlebih dahulu**. Database live bisa diubah tanpa rollback mudah.

Alur kerja yang benar:
1. Tulis file SQL migration di `supabase/migrations/`
2. Tampilkan isi lengkap ke Romo
3. Tunggu konfirmasi eksplisit
4. Baru jalankan: `supabase db query --linked -f <file.sql>`
5. Verifikasi dengan test suite: `node tests/tenant-isolation.mjs`

---

## 4. Cara Kerja / Metodologi Verifikasi Severity

Alur ini sudah terbukti efektif, dipakai berulang (contoh terbaik: C3 `rls_pkl_attendance_read_kaprodi`):

**Langkah 1 — Baca policy live (bukan dari file migration lama)**
```sql
SELECT policyname, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'nama_tabel'
ORDER BY policyname;
```

**Langkah 2 — Cek SEMUA policy lain di tabel yang sama**  
Jangan evaluasi satu policy isolasi. Cek apakah ada policy lain (misalnya `rls_xxx_read_staff`) yang sudah mencakup aktor yang sama dengan guard yang lebih kuat — ini bisa membuat gap di satu policy tidak exploitable.

**Langkah 3 — Baca definisi fungsi helper via `pg_get_functiondef`**  
Jika policy memakai fungsi helper (`fn_kaprodi_program_id()`, `fn_student_is_on_pkl()`, dll.), baca definisi lengkapnya dari database live:
```sql
SELECT pg_get_functiondef(oid) FROM pg_proc WHERE proname = 'nama_fungsi';
```

**Langkah 4 — Simulasi cross-tenant nyata**  
Gunakan Management API Supabase dengan JWT yang disimulasikan:
```javascript
// Pola yang sudah terbukti (lihat tests/tenant-isolation.mjs untuk contoh lengkap)
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"AUTH_USER_ID","role":"authenticated"}', true);
SELECT set_config('request.jwt.claim.sub', 'AUTH_USER_ID', true);
-- <query yang diuji>
COMMIT;
```

Sekolah uji yang tersedia:
- `smkhr` (SMK Harapan Rokan) — `school_id = 00000000-0000-0000-0000-000000000001` — paling banyak data (1296 siswa)
- `smkkb` (SMK Karya Bangsa) — `school_id = 50602e33-95e9-4006-81bd-1a6008b676c4` — 447 siswa
- `smkhb` (SMK Harapan Bangsa) — `school_id = 3c4b5ebd-c1c3-4f27-b7f1-ab697cc634e1` — 45 siswa demo

Ada akun GURU/KAPRODI nyata di masing-masing sekolah. Query untuk menemukan:
```sql
SELECT u.auth_user_id, u.email, u.role_type, u.kaprodi_program_id, sc.slug
FROM users u JOIN schools sc ON sc.school_id = u.school_id
WHERE u.kaprodi_program_id IS NOT NULL ORDER BY sc.slug LIMIT 6;
```

**Langkah 5 — Simpulkan dengan bukti**  
- **(a) Exploitable** → buat migration fix, ikuti Rules 1–5, jalankan test suite  
- **(b) Tidak exploitable, gap struktural saja** → catat sebagai defense-in-depth opsional, prioritas rendah

---

## 5. File & Referensi Penting

### Test Suite

**File:** `tests/tenant-isolation.mjs`  
**Cara jalankan:**
```bash
SUPABASE_ACCESS_TOKEN="sbp_..." node tests/tenant-isolation.mjs
```
**Status terverifikasi:** 42/42 CHECK LULUS — `✅ LULUS — invarian isolasi tenant utuh.` (7 Juli 2026, dijalankan ulang saat pembuatan dokumen ini)  
**CHECK 1–11:**
- CHECK 1: RLS enabled semua tabel
- CHECK 2: fn_* SECURITY DEFINER tidak bocor ke anon
- CHECK 3: anon tidak bisa baca tabel inti
- CHECK 4: RPC privileged tanpa EXECUTE untuk anon
- CHECK 5: admin sekolah A tidak bisa baca data sekolah B
- CHECK 6: semua view security_invoker=true & tidak terbaca anon
- CHECK 7: kunci eskalasi kasus (target valid + DUDI→Kaprodi only)
- CHECK 8: ortu sekolah A tidak bisa baca PKL sekolah B
- CHECK 9: rls_schedules_read_parent — ce.school_id eksplisit + regression ortu
- CHECK 10: rls_schedules_read_student — ce.school_id eksplisit + regression siswa
- CHECK 11: rls_cases_insert — fn_student_in_current_school + cross-tenant INSERT ditolak

### Dokumen Audit

| File | Isi |
|------|-----|
| `docs/audit/fase2-1-rls-coverage-report.md` | Coverage scan 33 tabel |
| `docs/audit/fase2-2-kelompok-a-report.md` | Deep audit join student_parents |
| `docs/audit/fase2-2-kelompok-b-report.md` | Deep audit join guru/jadwal |
| `docs/audit/fase2-2-kelompok-c-report.md` | Deep audit pola fungsi siswa |
| `audit-fase1-branding-secret-exposure.md` | Laporan Fase 1 (di root, belum di-commit) |
| `investigasi-password-default.md` | Detail temuan password (di root, belum di-commit) |

### Migration History (Terpilih — Fase 1 & Fase 2 Saja)

Migration sebelum 2026-07-03 adalah fondasi multi-tenant platform (RLS isolasi, schema, bulk import) — bukan bagian dari audit keamanan ini. Daftar lengkap: `supabase migration list --linked`.

| Migration | Ringkasan |
|-----------|-----------|
| `20260703190000` | Revoke batch RPC privileged dari PUBLIC/anon (fn_apply_schedule_templates, dll.) |
| `20260703210000` | Revoke fn_update_school_branding dari anon |
| `20260703230000` | 7 views diberi security_invoker=true (SEC-1 fix) |
| `20260703270000` | Revoke fn_sync_case dari PUBLIC/anon |
| `20260704120000` | Revoke fn_purge_expired_student + fn_reapply_schedule_templates dari public |
| `20260706140000` | Tambah kolom password_changed_at ke users (Fase 1-B) |
| `20260706150000` | guard_password_flags — BEFORE UPDATE prevent clear must_change_password (Fase 1-C) |
| `20260706160000` | revoke fn_confirm_password_change dari PUBLIC (Fase 1-C) |
| `20260706170000` | revoke fn_confirm_password_change dari anon (Fase 1-C) |
| `20260706180000` | guard_users_protected_columns — BEFORE UPDATE trigger level kolom (Fase 1-D) |
| `20260706190000` | fix_pkl_ortu_rls_school_filter — tambah school_id guard ke pkl RLS ortu |
| `20260706200000` | restrict_time_slots_read_to_admin — bukan semua role boleh baca |
| `20260706210000` | schedules_read_parent defense-in-depth — ce.school_id eksplisit (A7) |
| `20260707100000` | schedules_read_student defense-in-depth — ce.school_id eksplisit (B3) |
| `20260707110000` | cases_insert guard student↔school — attempt 1, gagal (EXISTS tunduk RLS) |
| `20260707120000` | cases_insert fix v2 — fn_student_in_current_school SECURITY DEFINER (C2 final) |

---

## 6. Langkah Selanjutnya — Checklist untuk Sesi Berikutnya

Urutkan dari yang paling mendesak:

- [ ] **D1 — Klarifikasi `academic_periods` DELETE:** Admin portal melakukan INSERT+UPDATE langsung ke tabel ini (lihat `admin/js/semester.js:354,416`). Apakah ada use case DELETE (misal: hapus periode yang salah dibuat), atau selalu via RPC/admin DB? Jika butuh client DELETE, tambahkan policy DELETE hanya untuk role ADMINISTRATIVE.

- [ ] **D2 — Klarifikasi `achievements`:** Tidak ditemukan client write ke tabel ini. Tabel ini aktif dipakai? Diisi via mana (edge function, admin import, atau belum dipakai sama sekali)?

- [ ] **E1 — Verifikasi severity live: `pkl_placements` + `rls_pkl_read_ortu`** — Policy ini tidak punya guard `school_id` eksplisit, hanya join ke `student_parents`. Ikuti metodologi Langkah 1–5 di §4 untuk membuktikan apakah ini (a) exploitable atau (b) sudah tertutup lapisan lain. JANGAN fix sebelum verifikasi.

- [ ] **E2 — Verifikasi severity live: `schedule_time_slots`** — Semua role termasuk SISWA/ORTU bisa baca. Apakah ini disengaja (data referensi publik) atau kebocoran? Cek apakah ada data sensitif di tabel ini, lalu verifikasi live.

- [ ] **Lanjut scan tabel/policy di luar Kelompok A–E** — Perkiraan tersisa: ~47+ policy belum di-deep-audit formal. Prioritas natural berikutnya: tabel `observations` (INSERT policies per-role), tabel `users` (UPDATE policy), dan `pkl_placements` (WRITE policies).

- [ ] **Setelah Fase 2 selesai: mulai Fase 3** — Access control per-portal (capability audit: apakah setiap tab/fitur di setiap portal hanya bisa diakses role yang semestinya, bukan hanya di-hide di frontend tapi tidak di-block backend).

- [ ] **P1-A backup restore (dari Fase prioritas 2026-07-04) — DITUNDA oleh user:** Uji restore backup ke project Supabase terpisah, isi tabel hasil di `docs/konsep/runbook-rilis-aman.md`. Wajib sebelum go-live nyata.

---

*Dokumen ini bersifat ringkasan orientasi. Untuk detail teknis lengkap (isi migration, kode fungsi, skenario exploit), baca file laporan di `docs/audit/` dan file migration di `supabase/migrations/`.*
