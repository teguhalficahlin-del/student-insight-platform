# Student Insight Platform — Konteks untuk Claude Code

## Audit Sedang Berjalan

Ada audit keamanan/arsitektur total yang sedang berjalan (dimulai 6 Juli 2026). SEBELUM mengerjakan apapun terkait keamanan/RLS/migration di repo ini, baca dulu:

→ **`docs/audit-handoff.md`** (status lengkap, standing rules wajib, checklist prioritas)

## Aturan Wajib (ringkasan — baca versi lengkap di audit-handoff.md §3a)

1. **Migration wajib dikonfirmasi dulu.** Setiap migration WAJIB ditunjukkan isinya ke user dan menunggu konfirmasi eksplisit SEBELUM dijalankan ke database live — tanpa kecuali.
2. **SECURITY DEFINER wajib REVOKE dua lapis.** Setiap `CREATE FUNCTION ... SECURITY DEFINER` baru wajib disertai `REVOKE EXECUTE FROM PUBLIC` + `REVOKE EXECUTE FROM anon` di migration yang sama. REVOKE FROM PUBLIC saja tidak cukup (Supabase beri grant eksplisit terpisah ke anon).
3. **Missing RLS policy bukan otomatis celah.** RLS default-deny: tidak ada policy = akses ditolak. Verifikasi live dulu (simulasi cross-tenant nyata) SEBELUM fix, jangan asumsi dari pola kode saja.
4. Lihat `docs/audit-handoff.md §3a` untuk daftar lengkap standing rules.

## Sprint 1 — Foundation Schema (18 Juli 2026) — SELESAI

10 migration files: `20260718001000` s/d `20260718010000`

**Schema `core` (11 tabel, append-only):**
`curriculum_versions`, `education_levels`, `phases`,
`vocational_fields`, `vocational_programs`, `vocational_concentrations`,
`subjects`, `subject_phases`, `capaian_pembelajaran`,
`cp_elements`, `knowledge_national`

**Schema `public` baru (8 tabel, Teacher Workspace + AI Pipeline):**
`teacher_profiles`, `teaching_contexts`, `teacher_documents`,
`teacher_document_classes`, `teacher_document_approvals`,
`prompt_templates`, `generation_jobs`, `evaluation_logs`

**Seed live:**
1 curriculum version (Kurikulum Nasional 2025) · 1 education level (SMK) ·
2 phases (Fase E, Fase F) · 20 subjects (15 UMUM + 5 Kejuruan Lintas Prodi) ·
37 subject_phases · 37 capaian_pembelajaran placeholder `[PENDING]`

**Catatan penting:**
- `core.*` bersifat **append-only** — tidak pernah DELETE
- Semua migration idempotent; semua seed menggunakan UPSERT
- CP placeholder `[PENDING]` diisi SIP Team dari SK BSKAP No. 046/H/KR/2025
- Migration `20260718100214` ada di remote (dibuat via dashboard),
  sudah di-repair di migration history (`--status reverted`)

---

## Status Singkat (terakhir diperbarui: 18 Juli 2026)

- **Fase 1**: ✅ Selesai
- **Fase 2**: ✅ **SELESAI (9 Juli 2026).** Kelompok A-E selesai 100%,
  coverage scan 70 policy sisa selesai, scan sistemik SECURITY DEFINER selesai
  (8 Juli 2026): 59 fungsi discan, 4 temuan ditemukan & di-fix. PRIORITAS 1
  selesai (commit caac5f8): 7 titik query di 4 file portal dimigrasi ke
  `v_users_staff_directory`. D1 (DELETE `academic_periods`) dan D2 (tabel
  `achievements`) diinvestigasi dan dikonfirmasi Romo: keduanya **tidak ada
  isu keamanan**, dicatat sebagai backlog fitur produk. Lihat
  docs/audit-handoff.md §6 dan §13.
- **Fase 3**: ✅ **SELESAI (12 Juli 2026).** Tiga item diinvestigasi dan
  ditutup: (1) 14 fungsi anon=true — query live ke `pg_proc` mengembalikan
  0 rows, semua REVOKE sudah bersih; (2) WAKA_HUMAS/PKL scope — 6 policy
  dikonfirmasi konsisten dengan desain; (3) column-restriction
  `rls_users_read_staff` — investigasi 19 titik `.from('users')` di seluruh
  portal menunjukkan tidak ada cross-user read kolom sensitif, semua
  pembacaan sensitif adalah self-read via `auth_user_id = auth.uid()`.
  Documented risk acceptance. Lihat docs/audit-handoff.md Fase 3.

**Fitur selesai sesi 12 Juli 2026:**
- Refactor Portal Ortu → tab layout (lazy load per tab, reset per anak).
  Commit `0dee5f5`.
- Test suite: 93/93 ✓. HEAD: `d314175`.
- **✅ GAP rls_case_events_read_student — SELESAI (9 Juli 2026):**
  Investigasi selesai: ketiga policy (`rls_case_events_read_student`,
  `rls_case_events_read_parent`, `rls_student_updates_read_student`) BERDIRI
  SENDIRI (Rule 3 violation) — non-fungsional total, bukan kebocoran.
  Ditemukan juga regresi ke-4: `rls_case_events_read_staff` tanpa filter role
  → SISWA/ORTU dalam audience bisa baca event INTERNAL_SCHOOL (0 baris
  terekspos saat ditemukan). Keduanya di-fix via migration `20260709010000`
  (fix b/c/d/e/f), 12/12 skenario BEGIN...ROLLBACK lulus, 42/42 CHECK suite
  lulus pasca-apply. Commit 28fc884. Lihat docs/audit-handoff.md §11 Blok 3.
- **✅ Gap test suite §9.4 — SELESAI (9 Juli 2026):** 12 skenario T1–T12 +
  regresi-f sudah menjadi CHECK 12 (struktural) dan CHECK 13 (behavioral)
  permanen di `tests/tenant-isolation.mjs`. Baseline 55 ✓ → 77 ✓ (+22).
  Validasi negatif terbukti non-vacuous. Lihat docs/audit-handoff.md §9.4 dan §12.
- **✅ Gap test suite §9.1 + rls_cases_update_audience — SELESAI (9 Juli 2026):**
  Celah keamanan: `rls_cases_update_audience` lama membolehkan SIAPAPUN staf
  internal yang bisa *lihat* kasus untuk UPDATE semua kolom (termasuk handler/status).
  Diperbaiki via migration `20260709020000` — policy diperketat ke handler/kepsek/creator.
  CHECK 14 (13 assertion, write-path kasus) ditambahkan ke test suite: 77 ✓ → 90 ✓.
  BACKLOG BARU: `fn_can_see_case()` tidak punya cabang `OR fn_is_kepsek()` — KEPSEK
  tidak bisa lihat kasus PRIVATE/RESTRICTED di luar keterlibatannya (bug fungsional,
  bukan security leak; ditunda ke Fase 3). Lihat docs/audit-handoff.md §9.1.
- **Fitur audience RESTRICTED diperluas (8 Juli 2026, blok kedua):**
  siswa subjek kasus/observasi dan orang tua mereka kini bisa ditambahkan
  ke audience RESTRICTED secara eksplisit oleh guru (opt-in per-item).
  Migration 20260708060000, commit 333130e. Perubahan perilaku penting:
  akses siswa/ortu ke kasus RESTRICTED sebelumnya OTOMATIS, sekarang
  OPT-IN penuh. Lihat docs/audit-handoff.md §10 untuk detail lengkap.
- **Version control**: 5 migration 8 Juli 2026 applied live
  (20260708010000/030000/040000/050000/060000) + 1 migration 9 Juli 2026
  (20260709010000) + commit a8f7336 (fitur RESTRICTED audience inline form)
  + commit 333130e (audience siswa/ortu + fix bug added_by_user_id)
  + commit a6f8eac (update dokumentasi) + commit 28fc884 (fix regresi Rule 3
  + role filter case_events/student_updates) + commit 411df2e (docs §9.4)
  + commit 5e7ead5 (CHECK 12+13 permanen + sinkronisasi docs §9.4/§12)
  + commit caac5f8 (PRIORITAS 1 selesai: 4 file client + docs §6/§13 update)
  + **commit TBD (Fase 2 SELESAI): docs §6 D1/D2 + §11 status + §14 baru.**
  + **commit TBD (§9.1 + CHECK 14): mig 20260709020000 live, CHECK 14 (13
    assertion write-path), docs §9.1 SELESAI, CLAUDE.md update.**
  Lihat docs/audit-handoff.md §8, §10, §11, §12, §13, §14.
- **Test suite**: 93/93 ✓ (terakhir dijalankan 12 Juli 2026, pasca Forum Kelas CHECK 15).
  15 CHECK top-level.

**Sesi 15 Juli 2026 — Fix non-keamanan:**
- PWA manifest: `start_url`/`scope`/`id` di 6 portal diubah ke absolute path
  (commit `f942004`). Warning Chrome console hilang.
- Aksesibilitas: 7 `<label>` tanpa `for` di `guru/dashboard.html` diperbaiki
  (commit `d6bec39`). DevTools Issues = 0.
- Tab Dashboard Guru: `isTeacher` kini cek `teacher_code` ATAU `teaching_assignments.count > 0`
  — menangkap guru dengan jabatan (WAKA_KESISWAAN dll) yang mengajar tapi tidak punya
  `teacher_code` (commit `9174d0d`). Lihat docs/audit-handoff.md §17.
- Investigasi tenant isolation tab WAKA_KESISWAAN: AMAN — RLS sudah filter `school_id`
  via migration `20260701130000`. Lihat docs/audit-handoff.md §17.4.

Detail lengkap dan checklist prioritas ada di `docs/audit-handoff.md §6`.
