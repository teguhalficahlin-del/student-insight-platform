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
| **E1** | `rls_pkl_read_ortu` | `pkl_placements` | Policy ortu tidak punya guard `school_id` eksplisit — hanya join ke `student_parents` | ✅ **VERIFIED 7 Juli 2026 — (b) TIDAK EXPLOITABLE.** Policy live `rls_pkl_read_ortu` MEMILIKI guard `school_id = fn_current_school_id()` sebagai kondisi AND terluar (bukan hanya join ke student_parents seperti deskripsi awal di dokumen ini menyebutkan — deskripsi awal keliru, kemungkinan ditulis dari asumsi pola kode lama, bukan dari `pg_policies` live — pelajaran Rule 4 berlaku juga saat menulis dokumentasi audit). Guard ini menutup akses lintas-sekolah terlepas isi subquery. Tidak ada data pkl_placements di smkkb/smkhb untuk uji empiris langsung; kesimpulan berbasis pembacaan definisi policy (valid secara logis: AND dengan kondisi false selalu gagal). Defense-in-depth opsional (tambah sp.school_id ke subquery) — prioritas rendah, masuk batch nanti bareng C3. |
| **E2** | Policy read `schedule_time_slots` | `schedule_time_slots` | Semua role bisa baca (tidak ada filter role) — apakah disengaja? | ✅ **VERIFIED 7 Juli 2026 — SUDAH TER-FIX, tidak exploitable.** Migration 20260706200000 (6 Juli 2026, bagian Fase 1) sudah membatasi rls_time_slots_read hanya ke role ADMINISTRATIVE. Deskripsi awal di dokumen ini ('semua role bisa baca') sudah usang sejak migration tsb — sama seperti kasus E1, deskripsi ditulis dari kondisi lama bukan pg_policies live saat ini. Simulasi live SISWA & ORTU smkhr: 0 baris (tertolak di kondisi role, bukan sekedar school_id kosong). Tidak ada FK masuk ke tabel ini dari tabel lain — tidak ada jalur bocor tidak langsung. Isi kolom sendiri juga rendah-sensitivitas (jam & label slot, tanpa data personal). |

### 3.3 Temuan Baru — Investigasi Lanjutan (7 Juli 2026)

Investigasi ini memeriksa sisa 70 policy yang belum di-deep-audit dari
total 117 policy (47 sudah ter-cover Kelompok A–E). Hasil triase:
45 pola aman jelas (school_id guard terluar konsisten), 18 perlu
deep-audit fungsi helper, 7 perlu baca kual lengkap — ketujuhnya
sudah diperiksa di sesi ini.

> ⚠️ **CATATAN KEHATI-HATIAN:** 45 policy yang dikategorikan "pola aman
> jelas" ditriase secara VISUAL (pencocokan pola `school_id` guard terluar
> secara konsisten di definisi policy). BELUM DIKONFIRMASI apakah masing-masing
> dari 45 policy ini juga melalui simulasi live cross-tenant sesuai Rule 4,
> atau hanya dicocokkan secara visual saja. Ini BERBEDA dari 18+7 policy
> yang secara eksplisit diverifikasi live dalam investigasi ini. Sesi
> berikutnya **tidak boleh mengasumsikan** 45 policy ini setara dengan yang
> telah diverifikasi live — perlu konfirmasi metodologi sebelum menutup
> coverage scan ini sebagai "selesai".

| ID | Temuan | Status |
|----|--------|--------|
| — | **fn_can_see_case + seluruh sub-fungsinya** | 🟢 **VERIFIED AMAN** — school_id guard ada di level terluar EXISTS; semua cabang case-related aman. |
| — | **fn_can_see_student + 3 policy pemanggil** (rls_students_read_staff, rls_enrollments_read_staff, rls_attendance_read_staff) | 🟢 **VERIFIED AMAN** — pola school_id AND terluar identik dengan A7/B3; tidak ada jalur bypass. |
| — | **rls_users_read_own, rls_users_update_own** | 🟢 **VERIFIED AMAN** — filter auth_user_id UNIQUE global; satu user = satu baris; tidak butuh guard school_id tambahan. |
| **F2-A** | **rls_users_read_staff_names + rls_users_read_staff: over-exposure kolom** | ✅ **Migration 20260707130000 SUDAH DI-PUSH ke live (7 Juli 2026).** View `v_users_staff_directory` aktif, tervalidasi identik (baris) dengan tabel dasar untuk role SISWA dan GURU, hanya 8 kolom aman yang terekspos. Test suite tenant-isolation.mjs dijalankan ulang pasca-push (7 Juli 2026): 42/42 CHECK lulus, termasuk CHECK 6 baru yang memverifikasi v_users_staff_directory (security_invoker=true, anon tidak bisa baca). CATATAN: ini baru infrastruktur — client code di 7 portal BELUM dipindah ke view ini, akses langsung ke tabel `users` masih terbuka. Migrasi client adalah pekerjaan terpisah (belum dimulai). |
| — | **Integritas cross-school class_enrollments + teaching_assignments** | 🟢 **0 baris inkonsisten di data live** — tidak ada CHECK/FK composite di skema, tapi tertutup oleh trigger `trg_auto_school_id` via `fn_auto_set_school_id()` yang menutup 18 tabel (students, class_enrollments, teaching_assignments, student_parents, dll). Trigger fallback: derive school_id dari parent entity (program→students, class→enrollments, dll). |
| — | **fn_bulk_import_students: tidak ada validasi school_id internal** | 🟢 **VERIFIED AMAN (eksposur rendah)** — EXECUTE hanya `service_role` (anon: false, authenticated: false); hanya dipanggil dari edge function `bulk-import-students` via admin client; tidak pernah exposed ke portal client manapun. Tidak ada jalur exploit dari luar. |
| — | **Defense-in-depth opsional (prioritas rendah)** | Tambah `p_school_id` eksplisit + validasi ke `fn_bulk_import_students`; tambah trigger validasi CHECK cross-entity di `class_enrollments`/`teaching_assignments` sebagai lapis kedua di luar `trg_auto_school_id`. Batch nanti bareng C3/E1. |

#### Cakupan Keseluruhan Fase 2

- **Fase 2.1** (RLS coverage scan): 33/33 tabel = 100% ✅  
- **Fase 2.2 Kelompok A–C**: 13/13 policy = 100% ✅  
- **Kelompok D**: Dianalisis via grep kode, 12/14 jelas aman, 2 perlu klarifikasi  
- **Kelompok E**: 2/2 diverifikasi live — SELESAI. Keduanya (b) tidak exploitable / sudah ter-fix.  
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

> ⚠️ **STATUS FASE 2 SECARA KESELURUHAN: BELUM SELESAI.** Jangan
> menyimpulkan Fase 2 selesai hanya karena PRIORITAS 2 (scan SECURITY
> DEFINER) sudah ✅. Item berikut MASIH TERBUKA dan wajib diselesaikan
> sebelum Fase 2 bisa ditutup: **PRIORITAS 1** (migrasi client 7 portal
> ke `v_users_staff_directory`) belum dimulai sama sekali; **D1**
> (klarifikasi DELETE `academic_periods`) belum dijawab; **D2** (status
> tabel `achievements`) belum dikonfirmasi.

Urutkan dari yang paling mendesak:

- [x] **F2-A (infrastruktur) — SELESAI (7 Juli 2026):** view `v_users_staff_directory` live & tervalidasi. Migration `20260707130000` di-push, 8 kolom aman terkonfirmasi, total 4499 baris accessible.

- [ ] **PRIORITAS 1 — F2-A lanjutan: Migrasi client code 7 portal ke `v_users_staff_directory`.** Infrastruktur (VIEW) sudah live sejak migration 20260707130000. Belum ada satu portal pun yang dipindah. Urutan rencana: pilot `guru/js/api.js` (5 lokasi query users teridentifikasi) → 6 portal lain satu-satu, verifikasi fungsional tiap lokasi sebelum lanjut. Kasus khusus: `guru/js/api.js:974` butuh kolom `login_identifier` yang SENGAJA dikecualikan dari view (data sensitif) — perlu keputusan produk terpisah sebelum lokasi ini bisa dipindah (apakah fitur diubah scope-nya, atau tetap akses tabel dasar untuk kasus ini saja). Setelah 7 portal selesai: evaluasi apakah grant SELECT langsung ke `users` perlu dibatasi.

- [x] **PRIORITAS 2 — Scan sistemik grant EXECUTE fungsi SECURITY DEFINER — SELESAI (8 Juli 2026).** 59 fungsi discan. 4 temuan ditemukan, semua yang exploitable sudah di-fix dan diverifikasi live + test suite:
  - **FINDING 1 — fn_get_stale_staff()** (NIP guru, tanpa guard role → semua authenticated bisa akses): fix migration `20260708040000` — tambah guard KEPSEK/ADMINISTRATIVE, konversi ke plpgsql. Verified.
  - **FINDING 2 — Regresi write-path kasus** (migration 20260707150000 terlalu agresif merevoke: fn_is_internal_case_actor + fn_matches_case_handler ikut tercabut, padahal dipanggil langsung dari 6 policy roles={public}): fix `20260708010000` regrant kedua fungsi ke authenticated. Fix tambahan `20260708030000`: rls_cam_insert WITH CHECK ganti panggilan fn_user_is_internal_case_actor (terkunci) dengan inline EXISTS check berbatas sekolah. Verified.
  - **FINDING 3 — fn_stakeholder_summary()** (statistik agregat sekolah, tanpa guard role → semua authenticated bisa akses): fix `20260708050000` — tambah guard KEPSEK/STAKEHOLDER, konversi ke plpgsql. Verified.
  - **FINDING 4 (technical debt, tidak exploitable saat ini) — 14 fungsi helper anon=true** (fn_can_see_case, fn_can_see_student, dll.): tidak bisa langsung di-REVOKE karena dipanggil 19 policy roles={public}. Dicatat sebagai Fase 3 backlog — lihat §8 item "14 fungsi helper anon=true".

- [ ] **D1 — Klarifikasi `academic_periods` DELETE:** Admin portal melakukan INSERT+UPDATE langsung ke tabel ini (lihat `admin/js/semester.js:354,416`). Apakah ada use case DELETE (misal: hapus periode yang salah dibuat), atau selalu via RPC/admin DB? Jika butuh client DELETE, tambahkan policy DELETE hanya untuk role ADMINISTRATIVE.

- [ ] **D2 — Klarifikasi `achievements`:** Tidak ditemukan client write ke tabel ini. Tabel ini aktif dipakai? Diisi via mana (edge function, admin import, atau belum dipakai sama sekali)?

- [x] **E1 — SELESAI (7 Juli 2026):** Verified TIDAK EXPLOITABLE — guard school_id di level policy terluar, independen dari subquery student_parents. Detail lengkap di §3.2 Kelompok E.

- [x] **E2 — SELESAI (7 Juli 2026):** Sudah ter-fix via migration 20260706200000 (restrict ke ADMINISTRATIVE). Verified live, 0 baris untuk non-admin. Detail di §3.2 Kelompok E.

- [ ] **Lanjut scan tabel/policy di luar Kelompok A–E** — Perkiraan tersisa: ~47+ policy belum di-deep-audit formal. Prioritas natural berikutnya: tabel `observations` (INSERT policies per-role), tabel `users` (UPDATE policy), dan `pkl_placements` (WRITE policies).

- [ ] **Setelah Fase 2 selesai: mulai Fase 3** — Access control per-portal (capability audit: apakah setiap tab/fitur di setiap portal hanya bisa diakses role yang semestinya, bukan hanya di-hide di frontend tapi tidak di-block backend).

- [ ] **P1-A backup restore (dari Fase prioritas 2026-07-04) — DITUNDA oleh user:** Uji restore backup ke project Supabase terpisah, isi tabel hasil di `docs/konsep/runbook-rilis-aman.md`. Wajib sebelum go-live nyata.

---

---

## 7. Status Version Control (7 Juli 2026)

7 commit sesi audit Fase 2 lanjutan sudah ter-push ke origin/main:
d69a5de → b865f0f → 200aaa6 → c19b164 → 076d096 → 609ce4e → 3a34755.
Mencakup: fix Kelompok E, 2 fix privilege escalation aktif, laporan
naratif lengkap (docs/audit/fase2-investigasi-lanjutan-f2a-report.md),
sinkronisasi 9 migration historis Fase 1/2.1 yang sebelumnya untracked,
arsip laporan Fase 1, dan cleanup cache CLI.

Commit a8f7336 (fitur pemilihan audiens RESTRICTED inline di form observasi
guru — guru/dashboard.html, guru/js/api.js, guru/js/dashboard.js) sudah
ter-push ke origin/main. Ini commit fitur di luar audit keamanan.

---

## 8. Status Version Control (8 Juli 2026)

### Migration Applied Live

| Migration | Ringkasan |
|-----------|-----------|
| `20260708010000` | regrant_case_write_functions — kembalikan EXECUTE fn_is_internal_case_actor + fn_matches_case_handler ke authenticated (tercabut tidak sengaja oleh 20260707150000, regresi 6 policy write-path kasus) |
| `20260708030000` | fix_cam_insert_inline_check — ganti panggilan fn_user_is_internal_case_actor (terkunci, exploitable) di rls_cam_insert WITH CHECK dengan inline EXISTS check yang otomatis dibatasi sekolah sendiri |
| `20260708040000` | guard_fn_get_stale_staff — tambah guard KEPSEK/ADMINISTRATIVE ke fn_get_stale_staff(), konversi LANGUAGE sql→plpgsql |
| `20260708050000` | guard_fn_stakeholder_summary — tambah guard KEPSEK/STAKEHOLDER ke fn_stakeholder_summary(), konversi LANGUAGE sql→plpgsql |

Keempat migration di-apply langsung ke DB live via `supabase db query --linked`.
Semua diverifikasi dengan uji rollback + uji pasca-push (positif & negatif per role).

### Migration Files Untracked

File-file migration di atas ada di `supabase/migrations/` tapi belum di-commit ke git
(status: `??`). Demikian juga `20260708010000`. Perlu `git add` manual + commit
terpisah jika akan di-track. CATATAN: docs/ di .gitignore — dokumen audit-handoff.md
ini hanya update lokal kecuali di-force-add.

### Test Suite

42/42 CHECK lulus (terakhir dijalankan 8 Juli 2026, pasca 4 migration hari ini).
CATATAN: test suite tidak punya CHECK otomatis untuk write-path kasus (UPDATE cases,
INSERT case_events, INSERT case_audience_members) — regresi FINDING 2 terdeteksi manual,
bukan via test suite. Rekomendasi: tambah CHECK 12+ di sesi mendatang.

---

## 9. Temuan & Backlog untuk Sesi Berikutnya

Item-item ini BUKAN prioritas sesi ini, dicatat untuk referensi sesi mendatang.

### 9.1 Gap Test Suite — Write-Path Kasus (Prioritas Tinggi)

Regresi FINDING 2 (20260707150000 mencabut fn_is_internal_case_actor secara tidak
sengaja) terdeteksi manual via simulasi langsung, BUKAN oleh test suite. Ini berarti
regresi serupa di masa depan bisa lolos undetected.

**Rekomendasi:** Tambah CHECK 12+ di `tests/tenant-isolation.mjs` yang memverifikasi:
- GURU bisa UPDATE cases (status, current_handler_role)
- GURU bisa INSERT case_events (catatan kasus)
- GURU bisa INSERT case_audience_members (untuk case RESTRICTED)
- SISWA/ORTU tidak bisa melakukan ketiga operasi di atas

### 9.2 fn_deactivate_stale_staff — Kemungkinan Gagal Fungsional (Perlu Investigasi)

Ditemukan tidak sengaja saat verifikasi TARGET 5c migration 20260708040000:
`fn_deactivate_stale_staff()` dipanggil sebagai KEPSEK → fn_get_stale_staff() berhasil
(guard pass), tapi UPDATE berikutnya gagal dengan:

```
ERROR: 42501: Perubahan kolom ini tidak diizinkan lewat update langsung.
CONTEXT: PL/pgSQL function fn_guard_users_protected_columns() line 37 at RAISE
```

Artinya trigger `fn_guard_users_protected_columns` memblokir UPDATE `users.is_active`
dari role `authenticated` — bahkan untuk KEPSEK. Fungsi ini hanya bisa berjalan dari
service_role/edge function. **Belum diinvestigasi lebih lanjut** — di luar scope audit
keamanan hari ini. Perlu dicek: apakah portal admin memanggil ini via edge function
(service_role) ataukah via supabase.rpc() langsung (authenticated)?

### 9.3 14 Fungsi Helper anon=true — Technical Debt (Fase 3 Scope)

Scan sistemik menemukan 14 fungsi helper dengan `anon_can_execute = true`:
`fn_can_see_case`, `fn_can_see_student`, dan 12 lainnya. Kesemuanya dipanggil
langsung dari 19 policy RLS dengan `roles = {public}` (bukan `TO authenticated`
eksplisit). Tidak exploitable saat ini karena semua policy yang memanggilnya
punya guard `school_id = fn_current_school_id()` yang sudah terluar.

**Mengapa tidak bisa langsung di-REVOKE:** REVOKE anon dari helper-helper ini akan
mematikan semua 19 policy yang memanggil mereka (ERROR: permission denied for function)
karena policy `roles={public}` mencakup anon. Perbaikan yang benar membutuhkan refactor
policy dari `TO public` → `TO authenticated` eksplisit di semua 19 policy tersebut,
baru REVOKE bisa dilakukan.

**Rekomendasi:** Masuk ke scope Fase 3 (Access Control per Aktor). Lakukan sebagai
satu batch — bukan piecemeal — karena scope-nya lebar (19 policy di banyak tabel).

---

---

## 10. Fitur Audience RESTRICTED — Siswa/Ortu (8 Juli 2026, blok kedua)

### Perubahan Perilaku (PENTING — baca sebelum kerja di area ini)

**SEBELUM:** Siswa/ortu OTOMATIS bisa lihat kasus RESTRICTED tentang
diri/anaknya (via rls_cases_read_student/rls_cases_read_parent), tanpa
guru perlu melakukan apapun.

**SESUDAH:** Akses siswa/ortu ke kasus DAN observasi RESTRICTED bersifat
OPT-IN PENUH — guru harus secara eksplisit menambahkan mereka ke
case_audience_members / observation_audience_members. Ini keputusan
produk sadar dari Romo (guru bebas menentukan siapa saja per-item, bisa
staf saja, staf+siswa, atau staf+siswa+ortu).

### Migration 20260708060000 — Ringkasan Isi

- `fn_is_case_subject_or_parent(case_id, user_id)` — SECURITY DEFINER baru
- `fn_is_observation_subject_or_parent(observation_id, user_id)` — SECURITY DEFINER baru
- `rls_cam_insert` diperluas: izinkan siswa subjek kasus / ortu siswa itu
- `rls_obs_audience_insert` diperketat + diperluas: tambah `added_by_user_id`
  guard + filter role/subjek (sebelumnya TANPA FILTER SAMA SEKALI — celah lama)
- DROP `rls_cases_read_student`, DROP `rls_cases_read_parent` (akses otomatis lama)
- Policy baru: `rls_observations_read_student`, `rls_observations_read_parent`
  (opt-in via observation_audience_members — fitur BARU, sebelumnya siswa/ortu
  0% akses observasi apapun)
- Policy baru: `rls_obs_audience_read_own` (siswa/ortu baca baris OAM sendiri —
  diperlukan agar EXISTS subquery di policy read_student/read_parent bisa jalan)
- `ALTER TABLE observation_audience_members ADD COLUMN added_by_user_id`

Commit: `333130e`. Applied live 8 Juli 2026. Test suite 42/42 lulus pasca-migration.

### Bug Regresi Ditemukan & Diperbaiki dalam Blok Ini

1. **Bug aktif sejak migration 20260708030000 (pagi ini):** `rls_cam_insert`
   mensyaratkan `added_by_user_id = fn_current_user_id()`, tapi
   `addCaseAudienceMember` di client TIDAK PERNAH mengirim field itu → semua
   INSERT dari client ditolak diam-diam (NULL = apapun selalu UNKNOWN).
   Tidak terdeteksi saat verifikasi pagi karena uji ROLLBACK memakai SQL
   yang menyertakan field itu eksplisit, bukan menguji jalur client
   sungguhan. Fix: client sekarang mengirim `added_by_user_id` (3 call site
   di `guru/js/dashboard.js` untuk observasi, 1 untuk kasus).

2. **Bug lama (pra-existing, ditemukan saat investigasi):**
   `getMyObservations` (`student/js/api.js`) dan `fetchObservations`
   (`parent/js/api.js`) memfilter `visibility = 'STUDENT_VISIBLE'` — nilai
   enum yang TIDAK PERNAH ADA (enum hanya PRIVATE/RESTRICTED/PUBLIC).
   Fitur observasi untuk siswa/ortu sebelumnya tidak pernah bisa berfungsi
   sama sekali. Diganti ke `'RESTRICTED'`, sekarang didukung oleh policy
   baru migration ini.

### Yang BELUM Selesai — UI Guru Belum Mendukung Pilih Siswa/Ortu

Migration ini membuka kemampuan BACKEND, tapi `guru/dashboard.html` BELUM
punya elemen UI untuk memilih siswa/ortu sebagai anggota audience — kotak
pencarian saat ini (`#obs-form-member-search`, `#kasus-aud-member-search`)
HANYA mencari staf internal (`searchInternalUsers`, filter role staf).
Guru belum bisa benar-benar memanfaatkan fitur ini dari UI sampai
elemen pemilihan siswa/ortu dibangun terpisah. PRIORITAS untuk sesi
berikutnya jika fitur ini ingin benar-benar dipakai.

### Backlog Terpisah — WAKA_HUMAS untuk Wilayah PKL

Romo mengonfirmasi: WAKA_HUMAS punya wewenang atas SELURUH wilayah PKL
(kasus/observasi yang dibuat DUDI) — pola pengawasan mirip
`fn_dudi_supervises_student` tapi arah sebaliknya (WAKA_HUMAS mengawasi
DUDI, bukan DUDI mengawasi siswa). INI BUKAN bagian dari migration hari
ini — sengaja dipisah karena butuh ANALYZE tersendiri: apakah "terkait
PKL" = `fn_student_is_on_pkl`, scope baca-saja atau juga tulis/kelola,
berlaku untuk kasus PRIVATE juga atau hanya RESTRICTED/PUBLIC.
**CATATAN:** `searchInternalUsers` sempat ditambahi `WAKA_HUMAS` untuk
pencarian umum lalu DIKEMBALIKAN (Romo tolak) karena scope-nya harusnya
PKL-only, bukan general — jangan tambahkan `WAKA_HUMAS` ke pencarian
umum lagi tanpa membangun scoping PKL-nya dulu.

### Pelajaran Proses — Penyimpangan Rule 5 (dicatat, tidak diulang)

Migration 20260708060000 SEMPAT diterapkan ke DB live SEBELUM 10 skenario
ROLLBACK diuji (seharusnya sebaliknya). Tidak ada dampak nyata (semua
skenario akhirnya lulus, 42/42 test suite, 0 sekolah live saat ini),
tapi ini penyimpangan dari Rule 5 §3a. T10 sempat menunjukkan
"false failure" (cross-tenant INSERT tampak berhasil) yang ternyata
soal metodologi uji (JWT spoofing tidak relevan karena
`fn_current_school_id()` baca dari tabel `users` via `auth.uid()`, bukan
dari JWT claim `school_id`) — bukan bug policy sungguhan.
**REKOMENDASI SESI BERIKUTNYA:** untuk migration yang mengubah skema/policy
(DDL), bungkus CREATE/DROP POLICY + skenario uji dalam SATU transaksi
`BEGIN...ROLLBACK` sebelum diterapkan permanen — jangan apply dulu baru
uji terpisah.

---

---

## 11. Ringkasan Sesi 8 Juli 2026 (Kedua Blok)

### Blok 1 — Pagi: Scan Sistemik SECURITY DEFINER

59 fungsi SECURITY DEFINER di-scan. 4 temuan ditemukan, semua yang
exploitable sudah di-fix dan diverifikasi live + test suite:

- **FINDING 1** — `fn_get_stale_staff()` tanpa guard role → fix `20260708040000`
- **FINDING 2** — Regresi write-path kasus (20260707150000 terlalu agresif) → fix `20260708010000` + `20260708030000`
- **FINDING 3** — `fn_stakeholder_summary()` tanpa guard role → fix `20260708050000`
- **FINDING 4** — 14 fungsi helper `anon=true` (technical debt, tidak exploitable saat ini) → dicatat sebagai Fase 3 backlog

Commit: `b0d545d`. 42/42 CHECK lulus pasca keempat migration.

### Blok 2 — Siang–Sore: Audience RESTRICTED Diperluas ke Siswa/Ortu

Migration `20260708060000` diterapkan live. Dua bug regresi ditemukan dan
diperbaiki dalam blok yang sama:

1. `rls_cam_insert` dengan `added_by_user_id` guard tetapi client tidak pernah
   mengirim field itu → INSERT diam-diam ditolak. Fix: tambah field ke 4
   call site di client.
2. `getMyObservations`/`fetchObservations` filter `visibility = 'STUDENT_VISIBLE'`
   (enum tidak ada) → fitur observasi siswa/ortu tidak pernah bisa berjalan.
   Fix: ganti ke `'RESTRICTED'`.

Commit: `333130e` (migration + bug fixes), `a6f8eac` (update dokumentasi).
Test suite: 42/42 lulus.

### ⛔ GAP YANG DITEMUKAN SAAT REVIEW AKHIR — BELUM DITINDAKLANJUTI

**PRIORITAS TERTINGGI sesi berikutnya.** Migration 20260708060000 sudah
live TANPA pengecekan ini dilakukan:

Verifikasi apakah **`rls_case_events_read_student`** dan policy serupa di
**`student_updates`** BERGANTUNG pada `case_audience_members` (aman:
siswa yang tidak ada di audience tabel otomatis tidak bisa baca event/update)
ataukah BERDIRI SENDIRI dengan akses "ini kasus tentang saya" tanpa cek
membership audience (berarti kebocoran: siswa bisa baca detail event/update
kasus yang dia sendiri tidak bisa lihat kasusnya karena tidak di audience).

Langkah verifikasi yang perlu dilakukan:
1. Baca definisi live kedua policy via `pg_policies`
2. Jika bergantung `case_audience_members` → aman, catat konfirmasi
3. Jika berdiri sendiri → buat migration fix, konfirmasi Romo sebelum apply

### Status Fase — Akhir Sesi 8 Juli 2026

| Fase | Status |
|------|--------|
| Fase 1 | ✅ SELESAI |
| Fase 2 | 🔄 BELUM SELESAI — PRIORITAS 1, D1, D2 masih terbuka |
| Fase 3 | ⏳ BELUM DIMULAI (backlog: 14 fungsi anon + WAKA_HUMAS/PKL) |
| Fase 4–6 | ⏳ Belum dimulai |

---

*Dokumen ini bersifat ringkasan orientasi. Untuk detail teknis lengkap (isi migration, kode fungsi, skenario exploit), baca file laporan di `docs/audit/` dan file migration di `supabase/migrations/`.*
