-- ============================================================
-- Migration 20260703230000: Tutup SEC-1 — view publik bypass RLS ke anon
--
-- Temuan (3 Juli 2026): semua view di schema public ber-owner postgres
-- TANPA security_invoker → berjalan sebagai owner, MELEWATI RLS tabel di
-- bawahnya. anon & authenticated punya SELECT (default privileges) →
-- anon (tanpa login) bisa membaca data LINTAS-TENANT lewat view.
-- Terbukti live: anon GET /rest/v1/v_attendance_daily_summary → baris nyata.
--
-- Perbaikan: set security_invoker=true pada SEMUA view public → view
-- menegakkan RLS PENANYA. Efek:
--   - anon (tanpa auth.uid) → 0 baris.
--   - authenticated → hanya baris sekolahnya (sesuai RLS tabel dasar).
-- Tak ada code path live yang mengkueri view ini (hanya referensi di
-- contracts/), jadi tak ada konsumen yang rusak; ini murni hardening.
--
-- Catatan: semua tabel dasar SUDAH RLS-enabled (dijaga tenant-isolation
-- CHECK 1), sehingga security_invoker langsung efektif.
--
-- ROLLBACK: ALTER VIEW <nama> SET (security_invoker = false);  (TIDAK
--   disarankan — mengembalikan kebocoran).
-- ============================================================

ALTER VIEW v_attendance_daily_summary        SET (security_invoker = true);
ALTER VIEW v_kepsek_exception_dashboard       SET (security_invoker = true);
ALTER VIEW v_offline_sync_manifest_guru       SET (security_invoker = true);
ALTER VIEW v_offline_sync_manifest_substitute SET (security_invoker = true);
ALTER VIEW v_case_timeline                    SET (security_invoker = true);
ALTER VIEW v_student_portal_positif           SET (security_invoker = true);
ALTER VIEW v_student_portal_achievements      SET (security_invoker = true);
