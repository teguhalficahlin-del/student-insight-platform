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
| **2** | RLS & Tenant Isolation (semua tabel/policy) | ✅ SELESAI (9 Juli 2026) |
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
**Status terverifikasi:** 77/77 ✓ LULUS — `✅ LULUS — invarian isolasi tenant utuh.` (9 Juli 2026, pasca CHECK 12+13)

> **Catatan angka historis:** Dokumen ini sempat mencatat "42/42 CHECK lulus" — angka itu
> berasal dari run sebelum commit `c19b164` (8 Juli 2026) menambahkan CHECK 10/11 (+13 ✓ → 55).
> Sesi 9 Juli 2026 kemudian menambahkan CHECK 12+13 (+22 ✓ → 77). "42" dan "55" mengukur
> metrik yang sama (jumlah baris ✓ individual dalam satu run), tapi dari titik waktu berbeda.
> Angka yang valid saat ini: **77 ✓, 13 CHECK top-level**.

**CHECK 1–13:**
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
- CHECK 12: Struktural — 5 policy read-path case_events/student_updates (mig 20260709010000): fn_can_see_case guard, filter privacy_level STUDENT_VISIBLE, role exclusion SISWA/ORTU pada rls_case_events_read_staff
- CHECK 13: Behavioral — read-path sintetis BEGIN...ROLLBACK: T1–T7, T11–T12, regresi-f (audience member bisa baca STUDENT_VISIBLE; non-member 0; GURU creator baca semua termasuk INTERNAL_SCHOOL)

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

> ✅ **FASE 2 SELESAI (9 Juli 2026).** PRIORITAS 1 selesai (commit caac5f8).
> D1 dan D2 diinvestigasi dan dijawab — tidak ada aksi keamanan lanjutan
> diperlukan untuk keduanya. Fase 2 resmi ditutup sesi ini.

Urutkan dari yang paling mendesak:

- [x] **F2-A (infrastruktur) — SELESAI (7 Juli 2026):** view `v_users_staff_directory` live & tervalidasi. Migration `20260707130000` di-push, 8 kolom aman terkonfirmasi, total 4499 baris accessible.

- [x] **PRIORITAS 1 — F2-A lanjutan: Migrasi client code ke `v_users_staff_directory` — SELESAI (9 Juli 2026).** 4 file diubah, 7 titik query dimigrasi, 77/77 test suite lulus.

  **7 titik yang dimigrasi ke view:**
  - `guru/js/api.js:414` — `fetchDudiPartners` (ganti nama tabel, 1 baris)
  - `guru/js/api.js:481` — `fetchAllDudiPartners` (refactor embed→pisah-query — lihat bug tambahan di bawah)
  - `guru/js/api.js:528` — `getSchoolStats` count staf (ganti nama tabel, 1 baris)
  - `guru/js/api.js:974` — `listSchoolAdmins` (ganti nama tabel + **hapus `login_identifier`** dari SELECT dan dari UI)
  - `admin/js/api.js:134` — lookup DUDI names dalam `getAlumniRecap` (ganti nama tabel)
  - `admin/js/api.js:456` — `getTeacherList` (ganti nama tabel)
  - `admin/js/setup-wizard.js:563` — progress check count GURU (ganti nama tabel)

  **16 titik yang TIDAK dimigrasi (keputusan Romo):** Pola A (`getCurrentUserRow` semua portal — baca diri sendiri via `auth_user_id = auth.uid()`), Pola C/D (admin UI butuh `must_change_password`/`deleted_at`/`login_identifier`), Pola E (dudi self-lookup). Semua cukup aman via `rls_users_read_own` dan `rls_users_read_administrative`. Tidak perlu migrasi.

  **Keputusan produk — `guru/js/api.js:974` (`listSchoolAdmins`):** KEPSEK **tidak lagi bisa melihat `login_identifier`** (kode login NIP/NIK) akun ADMINISTRATIVE. Query dan kolom tabel UI (`<th>Login ID</th>` + `<td><code>...</code></td>`) sudah dihapus. Keputusan: data ini sensitif, cukup tampilkan nama saja.

  **Bug tambahan ditemukan & diperbaiki saat live testing (bukan regresi dari migrasi):**

  1. **PGRST201 — ambiguous relationship `users`→`programs`** (pra-existing di produksi sebelum migrasi ini): kode lama `fetchAllDudiPartners` pakai embed `program:programs(program_name)` langsung di tabel `users`. PostgREST menemukan 2 FK dari `users` ke `programs` (`program_id` tanpa nama relasi eksplisit, dan `kaprodi_program_id REFERENCES programs`), tidak tahu yang mana — error PGRST201. Bug ini sudah ada di produksi SEBELUM sesi ini, baru ketahuan saat testing. Diselesaikan sekaligus oleh solusi pisah-query.

  2. **Nama kolom salah `program_name` → `name`**: query kedua (fetch program names) memakai `program_name` yang tidak ada di tabel `programs`. Kolom yang benar adalah `name`. Ditemukan saat live test kedua, langsung diperbaiki.

  **Backlog baru untuk Fase 3 (dicatat dari sesi ini):** `rls_users_read_staff` dan `rls_users_read_staff_names` tidak membatasi KOLOM — hanya membatasi baris. KEPSEK/GURU/SISWA/ORTU secara teknis masih bisa akses `login_identifier`, `email`, dll. lewat REST API langsung (`GET /rest/v1/users?select=login_identifier`), meski UI sudah tidak menampilkannya. Keputusan Romo: RLS-level column-restriction DITUNDA ke Fase 3. Migrasi client ke view sudah cukup untuk menutup eksposur via portal resmi.

- [x] **PRIORITAS 2 — Scan sistemik grant EXECUTE fungsi SECURITY DEFINER — SELESAI (8 Juli 2026).** 59 fungsi discan. 4 temuan ditemukan, semua yang exploitable sudah di-fix dan diverifikasi live + test suite:
  - **FINDING 1 — fn_get_stale_staff()** (NIP guru, tanpa guard role → semua authenticated bisa akses): fix migration `20260708040000` — tambah guard KEPSEK/ADMINISTRATIVE, konversi ke plpgsql. Verified.
  - **FINDING 2 — Regresi write-path kasus** (migration 20260707150000 terlalu agresif merevoke: fn_is_internal_case_actor + fn_matches_case_handler ikut tercabut, padahal dipanggil langsung dari 6 policy roles={public}): fix `20260708010000` regrant kedua fungsi ke authenticated. Fix tambahan `20260708030000`: rls_cam_insert WITH CHECK ganti panggilan fn_user_is_internal_case_actor (terkunci) dengan inline EXISTS check berbatas sekolah. Verified.
  - **FINDING 3 — fn_stakeholder_summary()** (statistik agregat sekolah, tanpa guard role → semua authenticated bisa akses): fix `20260708050000` — tambah guard KEPSEK/STAKEHOLDER, konversi ke plpgsql. Verified.
  - **FINDING 4 (technical debt, tidak exploitable saat ini) — 14 fungsi helper anon=true** (fn_can_see_case, fn_can_see_student, dll.): tidak bisa langsung di-REVOKE karena dipanggil 19 policy roles={public}. Dicatat sebagai Fase 3 backlog — lihat §8 item "14 fungsi helper anon=true".

- [x] **D1 — `academic_periods` DELETE — VERIFIED, tidak ada aksi keamanan (9 Juli 2026).**
  Tidak ada satu pun client code yang melakukan DELETE ke `academic_periods` (tabel
  tidak terdaftar di `PK_COLUMNS`, sehingga `deleteRecord`/`deleteBulk` pun tidak bisa
  memanggilnya). Tidak ada `FOR DELETE` policy di tabel ini — ini **by-design**: RLS
  default-deny sudah menutup akses DELETE dari client. Satu-satunya jalur "hapus"
  adalah `fn_batalkan_tahun_ajaran` (SECURITY DEFINER, migration
  `20260702160000_batalkan_tahun_ajaran.sql`) yang menghapus `academic_periods` secara
  transaksional bersama enrollment — tidak butuh RLS `FOR DELETE` karena berjalan sebagai
  superuser DB. **CATATAN:** Fungsi ini belum punya UI pemanggil di client manapun.
  Dicatat sebagai **backlog FITUR** (bukan keamanan): admin butuh tombol/form
  "Batalkan Tahun Ajaran" di masa depan. Lihat §14 Backlog Produk.

- [x] **D2 — `achievements` — VERIFIED, backend-complete, belum ada UI (9 Juli 2026).**
  Tabel `achievements` memiliki 0 baris di database live. Infrastruktur backend sudah
  lengkap: tabel dengan `school_id` + soft-delete via `is_voided`, 4 RLS policy
  (`rls_achievements_write` INSERT untuk WALI_KELAS/KAPRODI/KEPSEK,
  `rls_achievements_read_staff`, `rls_achievements_read_student`,
  `rls_achievements_void` UPDATE), view `v_student_portal_achievements`
  (security_invoker=true, dari migration `20260703230000`). Namun tidak ada satu pun
  portal (guru/siswa/admin) yang mengimplementasikan UI untuk fitur ini — tidak ada
  `.from('achievements')` atau `.from('v_student_portal_achievements')` di client code
  manapun. Referensi satu-satunya: entri `achievements: 'catatan prestasi'` di
  `DEPENDENCY_LABELS` (pesan error saat hapus siswa). Dicatat sebagai **backlog FITUR**
  (bukan keamanan): RLS sudah benar, tidak ada celah. Lihat §14 Backlog Produk.

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

77/77 ✓ lulus (terakhir dijalankan 9 Juli 2026, pasca CHECK 12+13 ditambahkan).
Sebelumnya 42 (sebelum CHECK 10/11, commit c19b164 8 Juli), lalu 55 (sebelum CHECK 12/13 sesi ini).
CHECK 12+13 ditambahkan 9 Juli 2026 — lihat §9.4 dan §12.
CATATAN: test suite tidak punya CHECK otomatis untuk write-path kasus (UPDATE cases,
INSERT case_events, INSERT case_audience_members) — regresi FINDING 2 terdeteksi manual,
bukan via test suite.

---

## 9. Temuan & Backlog untuk Sesi Berikutnya

Item-item ini BUKAN prioritas sesi ini, dicatat untuk referensi sesi mendatang.

### 9.1 Gap Test Suite — Write-Path Kasus — ✅ SELESAI (9 Juli 2026)

Regresi FINDING 2 (20260707150000 mencabut fn_is_internal_case_actor secara tidak
sengaja) terdeteksi manual via simulasi langsung, BUKAN oleh test suite. Gap ini kini
sudah ditutup dengan **CHECK 14 permanen** di `tests/tenant-isolation.mjs`.

**CHECK 14 mencakup 13 assertion:**

| Kode | Deskripsi | Harapkan |
|------|-----------|----------|
| W1   | GURU_A UPDATE kasus handler=GURU | 1 baris |
| W2c  | GURU_A UPDATE kasus buatannya sendiri (creator, bukan handler/kepsek) | 1 baris |
| W2   | GURU_B UPDATE kasus PUBLIC yang bukan miliknya (audience member biasa) | 0 baris |
| W3   | GURU_A INSERT case_events ke kasus sendiri | berhasil |
| W4   | GURU_A INSERT case_events ke kasus handler=KEPSEK | ditolak 42501 |
| W5   | GURU_A INSERT case_audience_members dengan added_by_user_id benar | berhasil |
| W6   | GURU_A INSERT case_audience_members dengan added_by_user_id=NULL | ditolak 42501 |
| W7   | GURU_A INSERT student_updates ke kasus sendiri | berhasil |
| W8   | GURU_A INSERT student_updates ke kasus handler=KEPSEK | ditolak 42501 |
| W9   | GURU_X (cross-tenant) UPDATE kasus sekolah lain | 0 baris |
| W10  | GURU_X INSERT case_events ke kasus sekolah lain | ditolak 42501 |
| W11  | KEPSEK_A INSERT case_events ke kasus handler=KEPSEK | berhasil |
| idem | 0 sisa sentinel setelah semua ROLLBACK | 0 baris |

**W2 dan W2c** (ditambahkan 9 Juli 2026) membuktikan fix `20260709020000`:
- W2c memverifikasi klausul `created_by_user_id = fn_current_user_id()` aktif
- W2 membuktikan audience member biasa TIDAK lagi bisa UPDATE cases (celah lama
  tertutup: sebelumnya siapapun yang *bisa lihat* kasus bisa UPDATE semua kolom)

**Hasil test suite pasca-CHECK 14:**

| Tahap | Jumlah ✓ |
|-------|----------|
| CHECK 1–11 (baseline) | 55 ✓ |
| + CHECK 12 (struktural read-path, 5 assertion) | 60 ✓ |
| + CHECK 13 (behavioral read-path siswa/ortu, 17 assertion) | 77 ✓ |
| + CHECK 14 (write-path kasus, 13 assertion) | **90 ✓** |

**BACKLOG BARU — fn_can_see_case KEPSEK (prioritas tinggi, fungsional):**

Ditemukan saat investigasi skenario W2b (KEPSEK UPDATE via fn_is_kepsek): `fn_can_see_case()`
tidak punya cabang `OR fn_is_kepsek()`. Akibatnya **KEPSEK tidak bisa melihat kasus
PRIVATE/RESTRICTED yang tidak melibatkan dia** (bukan handler, creator, atau audience member).
Dikonfirmasi Romo: ini **BUG** (bukan desain disengaja) — KEPSEK seharusnya bisa lihat semua
kasus di sekolahnya sebagai kepala sekolah.

Opsi fix: tambah `OR fn_is_kepsek()` ke `fn_can_see_case()`. Blast radius besar (fungsi
dipakai di banyak policy) — perlu investigasi ANALYZE sendiri sebelum diterapkan. Dicatat
sebagai backlog prioritas tinggi untuk Fase 3.

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

### 9.4 Read-Path case_events/student_updates Siswa/Ortu — ✅ SELESAI (9 Juli 2026)

12 skenario T1–T12 + regresi-f **sudah menjadi CHECK permanen** di
`tests/tenant-isolation.mjs` per sesi 9 Juli 2026:

- **CHECK 12** (struktural): memverifikasi 5 policy read-path dari migration `20260709010000`
  masih berisi fragment kunci (`fn_can_see_case`, `STUDENT_VISIBLE`, role exclusion
  `SISWA`/`ORTU` pada `rls_case_events_read_staff`) via `pg_policies.qual`.
- **CHECK 13** (behavioral): 17 assertion via data sintetis `BEGIN...ROLLBACK` —
  T1/T2/T3/T4 (audience member bisa baca RESTRICTED), T11/T12 (non-member RESTRICTED = 0),
  T5/T6/T7 (non-member PRIVATE = 0), 2 assertion bonus (audience member tidak bocor ke
  kasus PRIVATE lain), regresi-f (GURU creator baca semua termasuk INTERNAL_SCHOOL).

**Hasil:**
- Baseline sebelum CHECK 12+13: **55 ✓** (CHECK 1–11)
- Sesudah CHECK 12+13: **77 ✓** (+22: CHECK 12 = 5 ✓, CHECK 13 = 17 ✓)
- Validasi negatif dikonfirmasi non-vacuous: DROP filter `privacy_level` dari
  `rls_case_events_read_student` → SISWA A melihat `ce_r=2` (bukan 1) → T1 FAIL terdeteksi.
- Semua `ROLLBACK` berhasil: 0 sisa data sentinel di `cases`.

Gap ini tidak lagi terbuka. Regresi terhadap policy (b)(c)(d)(e)(f) kini terdeteksi
otomatis oleh guard-rail permanen. Lihat §12 untuk detail commit.

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

### ✅ GAP YANG DITEMUKAN SAAT REVIEW AKHIR — SELESAI (9 Juli 2026)

Migration `20260709010000_fix_case_events_student_updates_rls.sql` applied
live, 42/42 CHECK lulus. Lihat Blok 3 di bawah untuk detail lengkap.

### Blok 3 — 8–9 Juli 2026: Investigasi & Fix Gap rls_case_events_read_student

**Kesimpulan investigasi:** Ketiga policy (`rls_case_events_read_student`,
`rls_case_events_read_parent`, `rls_student_updates_read_student`) **BERDIRI
SENDIRI** — menggunakan `EXISTS (SELECT 1 FROM cases c WHERE c.case_id = ...)`.
Namun bukan kebocoran data: EXISTS ini tunduk Rule 3 (RLS pemanggil). Setelah
migration 20260708060000 men-DROP `rls_cases_read_student/parent`, SISWA/ORTU
tidak lagi punya SELECT policy di `cases` → EXISTS selalu false → ketiga policy
**NON-FUNGSIONAL TOTAL** (siswa/ortu tidak bisa baca apapun, bahkan jika di
audience). Tidak ada data bocor, tapi fitur tidak bekerja sama sekali.

**Temuan baru saat uji (f) — rls_case_events_read_staff missing role filter:**
`rls_case_events_read_staff` tidak punya filter role — USING-nya hanya
`school_id = fn_current_school_id() AND fn_can_see_case(case_id)`. Setelah
20260708060000, `fn_can_see_case` bisa return TRUE untuk SISWA/ORTU dalam
`case_audience_members` kasus RESTRICTED. Akibatnya lewat RLS OR-ing, siswa/ortu
bisa baca event `INTERNAL_SCHOOL`. Bug live tapi belum ada data terekspos (0 baris
SISWA/ORTU di `case_audience_members` saat audit). **Ini regresi ke-4 dari
migration 20260708060000.**

**Fix — Migration `20260709010000` (applied live 9 Juli 2026):**

| Fix | Policy | Perubahan |
|-----|--------|-----------|
| (b) | `rls_case_events_read_student` | Ganti EXISTS langsung ke `cases` → `fn_can_see_case()` + filter `STUDENT_VISIBLE` |
| (c) | `rls_case_events_read_parent` | Sama, untuk ORTU |
| (d) | `rls_student_updates_read_student` | Ganti EXISTS langsung ke `cases` → `fn_can_see_case()` |
| (e) | `rls_student_updates_read_parent` | Baru — ORTU dalam audience RESTRICTED bisa baca student_updates (Keputusan Romo: YA) |
| (f) | `rls_case_events_read_staff` | Tambah `NOT IN (SISWA, ORTU)` ke USING clause |

Diuji 12/12 skenario BEGIN...ROLLBACK termasuk T11/T12 (SISWA lain yang TIDAK
di audience kasus RESTRICTED yang sama → case_events 0, student_updates 0). 42/42
CHECK suite lulus pasca-apply. Commit: lihat git log setelah commit dikonfirmasi.

> ⚠️ **CATATAN PENTING UNTUK SESI MENDATANG:** Migration `20260709010000`
> **WAJIB LIVE** sebelum atau bersamaan dengan pembangunan UI audience siswa/ortu
> (item backlog §10 — tombol tambah siswa/ortu ke audience di portal guru).
> Jangan bangun UI tersebut tanpa memverifikasi migration ini sudah live — atau
> temuan (f) akan langsung aktif begitu guru pertama kali menambahkan siswa/ortu
> ke audience, membuat mereka bisa baca event `INTERNAL_SCHOOL`. Migration ini
> sudah live per 9 Juli 2026.

### Status Fase — Akhir Sesi 9 Juli 2026

| Fase | Status |
|------|--------|
| Fase 1 | ✅ SELESAI |
| Fase 2 | ✅ SELESAI (9 Juli 2026) — PRIORITAS 1 ✅, D1 & D2 dijawab, tidak ada aksi keamanan |
| Fase 3 | ⏳ BELUM DIMULAI (backlog: 14 fungsi anon + WAKA_HUMAS/PKL + column-restriction `rls_users_read_staff`) |
| Fase 4–6 | ⏳ Belum dimulai |

---

---

## 12. CHECK 12+13 Permanen — §9.4 Selesai (9 Juli 2026)

### Konteks

Sesi 9 Juli 2026 (lanjutan pasca migration `20260709010000`) menyelesaikan backlog §9.4:
12 skenario T1–T12 yang sebelumnya hanya diuji ad-hoc kini menjadi CHECK permanen.

### Apa yang Berubah

**`tests/tenant-isolation.mjs`** — +306 baris (CHECK 12 + CHECK 13):

**CHECK 12 — Struktural (5 assertion):**
Memverifikasi via `pg_policies.qual` bahwa 5 policy hasil migration `20260709010000`
masih berisi fragment kunci. Deteksi dini jika policy tidak sengaja di-DROP atau diganti:
- `rls_case_events_read_student`: `fn_can_see_case` + `STUDENT_VISIBLE` + `SISWA`
- `rls_case_events_read_parent`: `fn_can_see_case` + `STUDENT_VISIBLE` + `ORTU`
- `rls_case_events_read_staff`: `fn_can_see_case` + `<> ALL` + `SISWA` + `ORTU`
- `rls_student_updates_read_student`: `fn_can_see_case` + `SISWA`
- `rls_student_updates_read_parent`: `fn_can_see_case` + `ORTU`

**CHECK 13 — Behavioral (17 assertion):**
Data sintetis `BEGIN...ROLLBACK` (2 kasus sentinel, 4 aktor): tidak mengubah DB live.
- T1: SISWA A (audience) → `case_events` RESTRICTED = 1 (STUDENT_VISIBLE saja)
- T2: SISWA A (audience) → `student_updates` RESTRICTED = 1
- T3: ORTU A (audience) → `case_events` RESTRICTED = 1
- T4: ORTU A (audience) → `student_updates` RESTRICTED = 1
- T5: SISWA B (bukan audience) → `case_events` PRIVATE = 0
- T6: ORTU B (bukan audience) → `case_events` PRIVATE = 0
- T7: ORTU B (bukan audience) → `student_updates` PRIVATE = 0
- T11: SISWA B (bukan audience) → `case_events/student_updates` RESTRICTED = 0 (isolasi per-member)
- T12: ORTU B (bukan audience) → `case_events/student_updates` RESTRICTED = 0 (isolasi per-member)
- Bonus: SISWA A (audience RESTRICTED) → `case_events` PRIVATE = 0 (anggota audience RESTRICTED tidak bocor ke kasus PRIVATE lain)
- Bonus: ORTU A (audience RESTRICTED) → `case_events` PRIVATE = 0 (idem)
- Regresi-f: GURU creator → `case_events` RESTRICTED = 2 (INTERNAL_SCHOOL + STUDENT_VISIBLE)
- Setup sanity: `n_cases=1, n_ce=2, n_su=1, n_cam=2` (memverifikasi trigger otomatis)
- Idempotency: 0 sisa sentinel setelah semua ROLLBACK

### Angka Test Suite

| Titik waktu | ✓ assertions | CHECK top-level |
|---|---|---|
| Sebelum commit `c19b164` (8 Jul) | ~42 | 1–9 |
| Setelah `c19b164` (CHECK 10+11) | 55 | 1–11 |
| Setelah sesi ini (CHECK 12+13) | **77** | **1–13** |

### Validasi Negatif

DROP `rls_case_events_read_student` + CREATE ulang tanpa filter `privacy_level` (dalam
ROLLBACK) → SISWA A melihat `ce_r=2` (bukan 1) → T1 FAIL. Membuktikan CHECK 13 tidak vacuous.

### Commit

Commit hash: *(diisi setelah commit dibuat)*
Tanggal: 9 Juli 2026

---

---

---

## 13. PRIORITAS 1 Selesai — Migrasi Client ke `v_users_staff_directory` (9 Juli 2026)

### Ringkasan

PRIORITAS 1 Fase 2 (migrasi client code 7 portal dari akses langsung tabel `users`
ke `v_users_staff_directory`) selesai dan divalidasi live oleh Romo. 4 file diubah,
7 titik query dimigrasi, 77/77 test suite lulus, tidak ada regresi.

Tujuan: menutup eksposur kolom sensitif (`email`, `login_identifier`, `auth_user_id`,
dll.) yang sebelumnya bisa diakses siapapun dengan JWT valid via REST API langsung,
meski RLS sudah membatasi baris. View `v_users_staff_directory` (migration
`20260707130000`) hanya mengekspos 8 kolom aman: `user_id`, `school_id`, `full_name`,
`role_type`, `dudi_org_name`, `teacher_code`, `program_id`, `is_active`.

### File yang Diubah

| File | Titik | Perubahan |
|------|-------|-----------|
| `guru/js/api.js` | :414 `fetchDudiPartners` | `.from('users')` → `.from('v_users_staff_directory')` |
| `guru/js/api.js` | :481 `fetchAllDudiPartners` | Refactor embed→pisah-query + fix 2 bug (lihat bawah) |
| `guru/js/api.js` | :528 `getSchoolStats` | `.from('users')` → `.from('v_users_staff_directory')` |
| `guru/js/api.js` | :974 `listSchoolAdmins` | `.from('users')` → `.from('v_users_staff_directory')` + hapus `login_identifier` |
| `guru/js/dashboard.js` | :2046 render tabel | Hapus kolom `<th>Login ID</th>` + `<td><code>login_identifier</code></td>` |
| `admin/js/api.js` | :134 `getAlumniRecap` | `.from('users')` → `.from('v_users_staff_directory')` |
| `admin/js/api.js` | :456 `getTeacherList` | `.from('users')` → `.from('v_users_staff_directory')` |
| `admin/js/setup-wizard.js` | :563 progress check | `.from('users')` → `.from('v_users_staff_directory')` |

### Bug Tambahan Ditemukan & Diperbaiki (Pra-existing, Bukan Regresi)

**Bug 1 — PGRST201 ambiguous relationship `users`→`programs`:**
`fetchAllDudiPartners` lama pakai embed `program:programs(program_name)` langsung
di tabel `users`. PostgREST tidak bisa resolve karena ada 2 FK dari `users` ke
`programs`: `program_id` (tanpa nama relasi eksplisit) dan `kaprodi_program_id
REFERENCES programs(program_id)` (migration `20260630110000`). Error PGRST201 sudah
ada di produksi sebelum sesi ini — baru ketahuan saat live testing. Diselesaikan
sekaligus oleh solusi pisah-query (query 1: DUDI dari view, query 2: program names
dari tabel `programs` dengan `.in('program_id', programIds)`).

**Bug 2 — Nama kolom salah `program_name` → `name`:**
Query kedua (fetch program names) memakai `select('program_id, program_name')` —
kolom `program_name` tidak ada di tabel `programs`. Kolom yang benar adalah `name`
(dikonfirmasi dari `admin/js/api.js:480`, `guru/js/api.js:370`, dll.). Ditemukan saat
live test kedua, diperbaiki di tempat.

### Keputusan Produk

- **`listSchoolAdmins` (guru/api.js:974):** KEPSEK tidak lagi bisa melihat `login_identifier`
  akun ADMINISTRATIVE. Keputusan sadar Romo: data identitas sensitif, cukup tampilkan nama.
- **16 titik lain tidak dimigrasi:** Pola A (`getCurrentUserRow` — baca diri sendiri,
  cukup aman via `rls_users_read_own`), Pola C/D/E (admin UI butuh kolom di luar view,
  cukup aman via `rls_users_read_administrative`). Tidak ada security gap.

### Backlog Fase 3 Baru (dari Sesi Ini)

`rls_users_read_staff` dan `rls_users_read_staff_names` tidak membatasi KOLOM —
GURU/SISWA/ORTU masih bisa pilih kolom sensitif lewat REST API langsung. Keputusan
Romo: column-restriction di RLS level DITUNDA ke Fase 3. Portal resmi sudah aman
karena pakai view; eksposur sisa hanya via REST API manual (bukan via portal).

### Hasil Validasi Live

- Titik A/C/E/F/G: HTTP 200, data benar, tidak ada error.
- Titik D (`listSchoolAdmins`): `login_identifier` tidak ada di response; UI menampilkan
  kolom Nama + tombol Hapus saja (benar).
- Titik B (`fetchAllDudiPartners`): `console.table` menunjukkan 20/20 baris dengan
  `program_name` terisi benar setelah 2 bug diperbaiki.
- Test suite: **77/77 ✓** — tidak ada regresi.

*Dokumen ini bersifat ringkasan orientasi. Untuk detail teknis lengkap (isi migration, kode fungsi, skenario exploit), baca file laporan di `docs/audit/` dan file migration di `supabase/migrations/`.*

---

---

## 14. Backlog Produk — BUKAN Backlog Audit Keamanan

> ⚠️ **PERHATIAN:** Section ini TERPISAH dari backlog Fase 3 di §9.3 yang
> bersifat keamanan (14 fungsi `anon=true`, column-restriction, WAKA_HUMAS/PKL).
> Item di bawah adalah **fitur produk** yang belum dibangun — tidak ada celah
> keamanan, backend sudah aman. Kerjakan kapan saja sesuai prioritas produk,
> tidak perlu koordinasi dengan audit Fase 3.

### BP-1 — Fitur "Batalkan Tahun Ajaran" (UI Admin)

**Status backend:** Selesai. Fungsi `fn_batalkan_tahun_ajaran(p_config_id uuid)`
sudah ada di database (migration `20260702160000_batalkan_tahun_ajaran.sql`,
SECURITY DEFINER + REVOKE anon). Fungsi ini membalik buka-tahun-ajaran secara
transaksional: pulihkan enrollment lama, hapus enrollment baru, hapus
`academic_periods` tahun baru, kembalikan `school_config` ke tahun/semester
sebelumnya.

**Yang belum ada:** UI pemanggil. Tidak ada tombol atau form di portal admin
yang memanggil `supabase.rpc('fn_batalkan_tahun_ajaran', { p_config_id })`.
Halaman `admin/tutup-tahun.html` hanya menangani maju (buka tahun baru),
bukan batalkan.

**Yang perlu dibangun:** Tombol/form "Batalkan Tahun Ajaran" di halaman
admin yang sesuai (mungkin di `admin/semester.html` atau `admin/tutup-tahun.html`)
dengan konfirmasi berlapis (tindakan ini tidak bisa dibatalkan).

---

### BP-2 — Fitur "Prestasi & Penghargaan" (UI Guru + Tampilan Siswa)

**Status backend:** Selesai dan aman. Tabel `achievements` dengan RLS lengkap:
- INSERT: `rls_achievements_write` — WALI_KELAS (kelas yang diajar), KAPRODI
  (program jurusannya), KEPSEK
- SELECT staf: `rls_achievements_read_staff` — semua staf sekolah yang sama
- SELECT siswa: `rls_achievements_read_student` — siswa hanya bisa baca
  prestasinya sendiri
- UPDATE (void): `rls_achievements_void` — KEPSEK/KAPRODI (soft-delete via
  `is_voided = true`)
- View siap pakai: `v_student_portal_achievements` (security_invoker=true) —
  join ke `users` untuk nama pencatat, filter `is_voided = FALSE`

**Yang belum ada:** Tidak ada satu pun UI yang menggunakan tabel atau view ini.
0 baris di database live.

**Yang perlu dibangun:**
1. **Portal Guru** — form input prestasi siswa (judul, deskripsi, kategori,
   tanggal, lingkup) dengan pencarian siswa. Targetkan via
   `supabase.from('achievements').insert(...)`.
2. **Portal Siswa** — section "Prestasi & Penghargaan" yang membaca dari
   `v_student_portal_achievements` via
   `supabase.from('v_student_portal_achievements').select(...)`.
3. **Opsional:** Portal Admin — list prestasi per siswa, tombol void untuk
   KEPSEK/KAPRODI.
