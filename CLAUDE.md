# Student Insight Platform — Konteks untuk Claude Code

## Audit Sedang Berjalan

Ada audit keamanan/arsitektur total yang sedang berjalan (dimulai 6 Juli 2026). SEBELUM mengerjakan apapun terkait keamanan/RLS/migration di repo ini, baca dulu:

→ **`docs/audit-handoff.md`** (status lengkap, standing rules wajib, checklist prioritas)

## Aturan Wajib (ringkasan — baca versi lengkap di audit-handoff.md §3a)

1. **Migration wajib dikonfirmasi dulu.** Setiap migration WAJIB ditunjukkan isinya ke user dan menunggu konfirmasi eksplisit SEBELUM dijalankan ke database live — tanpa kecuali.
2. **SECURITY DEFINER wajib REVOKE dua lapis.** Setiap `CREATE FUNCTION ... SECURITY DEFINER` baru wajib disertai `REVOKE EXECUTE FROM PUBLIC` + `REVOKE EXECUTE FROM anon` di migration yang sama. REVOKE FROM PUBLIC saja tidak cukup (Supabase beri grant eksplisit terpisah ke anon).
3. **Missing RLS policy bukan otomatis celah.** RLS default-deny: tidak ada policy = akses ditolak. Verifikasi live dulu (simulasi cross-tenant nyata) SEBELUM fix, jangan asumsi dari pola kode saja.
4. Lihat `docs/audit-handoff.md §3a` untuk daftar lengkap standing rules.

## Status Singkat (terakhir diperbarui: 7 Juli 2026)

- **Fase 1** (branding, credential, privilege exposure): ✅ Selesai
- **Fase 2** (RLS & tenant isolation): 🔄 Sedang berjalan — ~<25% coverage
- **Test suite:** `tests/tenant-isolation.mjs` — 42/42 CHECK lulus (7 Juli 2026)

Detail lengkap dan checklist prioritas ada di `docs/audit-handoff.md §6`.
