# Student Insight Platform — Konteks untuk Claude Code

## Audit Sedang Berjalan

Ada audit keamanan/arsitektur total yang sedang berjalan (dimulai 6 Juli 2026). SEBELUM mengerjakan apapun terkait keamanan/RLS/migration di repo ini, baca dulu:

→ **`docs/audit-handoff.md`** (status lengkap, standing rules wajib, checklist prioritas)

## Aturan Wajib (ringkasan — baca versi lengkap di audit-handoff.md §3a)

1. **Migration wajib dikonfirmasi dulu.** Setiap migration WAJIB ditunjukkan isinya ke user dan menunggu konfirmasi eksplisit SEBELUM dijalankan ke database live — tanpa kecuali.
2. **SECURITY DEFINER wajib REVOKE dua lapis.** Setiap `CREATE FUNCTION ... SECURITY DEFINER` baru wajib disertai `REVOKE EXECUTE FROM PUBLIC` + `REVOKE EXECUTE FROM anon` di migration yang sama. REVOKE FROM PUBLIC saja tidak cukup (Supabase beri grant eksplisit terpisah ke anon).
3. **Missing RLS policy bukan otomatis celah.** RLS default-deny: tidak ada policy = akses ditolak. Verifikasi live dulu (simulasi cross-tenant nyata) SEBELUM fix, jangan asumsi dari pola kode saja.
4. Lihat `docs/audit-handoff.md §3a` untuk daftar lengkap standing rules.

## Status Singkat (terakhir diperbarui: 9 Juli 2026)

- **Fase 1**: ✅ Selesai
- **Fase 2**: ✅ **SELESAI (9 Juli 2026).** Kelompok A-E selesai 100%,
  coverage scan 70 policy sisa selesai, scan sistemik SECURITY DEFINER selesai
  (8 Juli 2026): 59 fungsi discan, 4 temuan ditemukan & di-fix. PRIORITAS 1
  selesai (commit caac5f8): 7 titik query di 4 file portal dimigrasi ke
  `v_users_staff_directory`. D1 (DELETE `academic_periods`) dan D2 (tabel
  `achievements`) diinvestigasi dan dikonfirmasi Romo: keduanya **tidak ada
  isu keamanan**, dicatat sebagai backlog fitur produk. Lihat
  docs/audit-handoff.md §6 dan §13.
- **Fase 3**: ⏳ BELUM DIMULAI. Item yang sudah menumpuk menunggu Fase 3:
  FINDING 4 (14 fungsi helper anon=true, perlu refactor 19 policy dari
  `roles={public}` ke `TO authenticated`), kemungkinan analisis akses
  WAKA_HUMAS/PKL (lihat §10 backlog), **BARU: column-restriction
  `rls_users_read_staff`** — GURU/SISWA/ORTU masih bisa pilih kolom sensitif
  via REST API langsung (keputusan Romo: ditunda ke Fase 3, lihat §13).
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
  Lihat docs/audit-handoff.md §8, §10, §11, §12, §13, §14.
- **Test suite**: 77/77 ✓ lulus (terakhir dijalankan 9 Juli 2026, pasca
  CHECK 12+13 ditambahkan). 13 CHECK top-level. Catatan historis: "42/42"
  yang sempat tercatat adalah angka pre-CHECK-10/11 (sebelum commit c19b164
  8 Juli 2026) — sudah stale, 77 adalah angka valid saat ini.

Detail lengkap dan checklist prioritas ada di `docs/audit-handoff.md §6`.
