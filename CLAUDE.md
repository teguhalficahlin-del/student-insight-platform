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
- **Fase 2**: 🔄 Sedang berjalan — **BELUM SELESAI.** Kelompok A-E selesai
  100%, coverage scan 70 policy sisa selesai, scan sistemik SECURITY DEFINER
  selesai (8 Juli 2026): 59 fungsi discan, 4 temuan ditemukan & di-fix.
  **Yang MASIH TERBUKA dan wajib diselesaikan sebelum Fase 2 bisa dinyatakan
  selesai:** (a) PRIORITAS 1 — migrasi client code 7 portal ke
  `v_users_staff_directory` BELUM DIMULAI SAMA SEKALI; (b) D1 — klarifikasi
  DELETE `academic_periods` belum dijawab; (c) D2 — status tabel `achievements`
  belum dikonfirmasi. Lihat docs/audit-handoff.md §6.
- **Fase 3**: ⏳ BELUM DIMULAI. Item yang sudah menumpuk menunggu Fase 3:
  FINDING 4 (14 fungsi helper anon=true, perlu refactor 19 policy dari
  `roles={public}` ke `TO authenticated`), kemungkinan analisis akses
  WAKA_HUMAS/PKL (lihat §10 backlog). Jangan mulai Fase 3 sebelum PRIORITAS 1
  Fase 2 selesai.
- **PRIORITAS TERTINGGI sesi berikutnya — GAP yang ditemukan saat review
  akhir, belum ditindaklanjuti:** Verifikasi apakah `rls_case_events_read_student`
  dan policy serupa di `student_updates` BERGANTUNG pada `case_audience_members`
  (aman: otomatis ikut ketat setelah migration 20260708060000) atau BERDIRI
  SENDIRI dengan akses "ini kasus saya" tanpa cek audience membership (berarti
  ada kebocoran: siswa tidak terlihat di audience, tidak bisa lihat kasus,
  tapi masih bisa baca event/update detailnya). Migration 20260708060000 sudah
  live TANPA pengecekan ini — harus diverifikasi di sesi berikutnya.
- **Fitur audience RESTRICTED diperluas (8 Juli 2026, blok kedua):**
  siswa subjek kasus/observasi dan orang tua mereka kini bisa ditambahkan
  ke audience RESTRICTED secara eksplisit oleh guru (opt-in per-item).
  Migration 20260708060000, commit 333130e. Perubahan perilaku penting:
  akses siswa/ortu ke kasus RESTRICTED sebelumnya OTOMATIS, sekarang
  OPT-IN penuh. Lihat docs/audit-handoff.md §10 untuk detail lengkap.
- **Version control**: 5 migration 8 Juli 2026 applied live
  (20260708010000/030000/040000/050000/060000) + commit a8f7336 (fitur
  RESTRICTED audience inline form) + commit 333130e (audience siswa/ortu
  + fix bug added_by_user_id) + commit a6f8eac (update dokumentasi).
  Lihat docs/audit-handoff.md §8, §10, §11.
- **Test suite**: 42/42 CHECK lulus (terakhir dijalankan 8 Juli 2026,
  pasca migration 20260708060000).

Detail lengkap dan checklist prioritas ada di `docs/audit-handoff.md §6`.
