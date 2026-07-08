# Student Insight Platform — Konteks untuk Claude Code

## Audit Sedang Berjalan

Ada audit keamanan/arsitektur total yang sedang berjalan (dimulai 6 Juli 2026). SEBELUM mengerjakan apapun terkait keamanan/RLS/migration di repo ini, baca dulu:

→ **`docs/audit-handoff.md`** (status lengkap, standing rules wajib, checklist prioritas)

## Aturan Wajib (ringkasan — baca versi lengkap di audit-handoff.md §3a)

1. **Migration wajib dikonfirmasi dulu.** Setiap migration WAJIB ditunjukkan isinya ke user dan menunggu konfirmasi eksplisit SEBELUM dijalankan ke database live — tanpa kecuali.
2. **SECURITY DEFINER wajib REVOKE dua lapis.** Setiap `CREATE FUNCTION ... SECURITY DEFINER` baru wajib disertai `REVOKE EXECUTE FROM PUBLIC` + `REVOKE EXECUTE FROM anon` di migration yang sama. REVOKE FROM PUBLIC saja tidak cukup (Supabase beri grant eksplisit terpisah ke anon).
3. **Missing RLS policy bukan otomatis celah.** RLS default-deny: tidak ada policy = akses ditolak. Verifikasi live dulu (simulasi cross-tenant nyata) SEBELUM fix, jangan asumsi dari pola kode saja.
4. Lihat `docs/audit-handoff.md §3a` untuk daftar lengkap standing rules.

## Status Singkat (terakhir diperbarui: 8 Juli 2026)

- **Fase 1**: ✅ Selesai
- **Fase 2**: 🔄 Sedang berjalan — Kelompok A-E selesai 100%, coverage
  scan 70 policy sisa selesai, scan sistemik SECURITY DEFINER selesai
  (8 Juli 2026): 59 fungsi discan, 4 temuan ditemukan & di-fix (2 regresi
  dari revoke-excess-grant 20260707150000 + 2 fungsi SECURITY DEFINER tanpa
  guard role). Prioritas berikutnya: migrasi client F2-A (7 portal) —
  lihat docs/audit-handoff.md §6.
- **Fitur audience RESTRICTED diperluas (8 Juli 2026, blok kedua):**
  siswa subjek kasus/observasi dan orang tua mereka kini bisa ditambahkan
  ke audience RESTRICTED secara eksplisit oleh guru (opt-in per-item).
  Migration 20260708060000, commit 333130e. Perubahan perilaku penting:
  akses siswa/ortu ke kasus RESTRICTED sebelumnya OTOMATIS, sekarang
  OPT-IN penuh. Lihat docs/audit-handoff.md §10 untuk detail lengkap.
- **Version control**: 5 migration 8 Juli 2026 applied live
  (20260708010000/030000/040000/050000/060000) + commit a8f7336 (fitur
  RESTRICTED audience inline form) + commit 333130e (audience siswa/ortu
  + fix bug added_by_user_id). Lihat docs/audit-handoff.md §8 dan §10.
- **Test suite**: 42/42 CHECK lulus (terakhir dijalankan 8 Juli 2026,
  pasca migration 20260708060000).

Detail lengkap dan checklist prioritas ada di `docs/audit-handoff.md §6`.
