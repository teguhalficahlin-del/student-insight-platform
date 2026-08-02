# /sip-migration-check — Validasi Migration Sebelum Apply

Jalankan sebelum setiap `supabase db push --linked`.
Read-only sampai konfirmasi eksplisit dari user.

---

## Langkah 1 — Dry-run
```bash
supabase db push --linked --dry-run
```
Tampilkan output verbatim.

Verifikasi:
- Migration mana yang akan di-push?
- Apakah ada migration yang tidak diharapkan (drift)?
- Apakah urutan migration benar (timestamp ascending)?

**STOP** — laporkan temuan, tunggu konfirmasi sebelum lanjut.

---

## Langkah 2 — Checklist 5 Poin (wajib sebelum real push)

Jawab setiap poin secara eksplisit:

- [ ] **Side effect ke tenant lain?** — apakah migration mengubah data/policy yang memengaruhi sekolah lain?
- [ ] **Idempotent?** — ada `IF NOT EXISTS` / `OR REPLACE` di setiap DDL?
- [ ] **REVOKE dua lapis?** — jika ada `SECURITY DEFINER` baru: ada `REVOKE FROM anon` + `REVOKE FROM PUBLIC`?
- [ ] **Diff verbatim sudah direview?** — isi migration sudah ditampilkan dan dibaca?
- [ ] **Risiko data loss?** — ada `DROP`, `DELETE`, atau `ALTER` yang tidak reversibel?

---

## Langkah 3 — Cek SECURITY DEFINER (jika ada fungsi baru)

Jika migration mengandung `CREATE FUNCTION ... SECURITY DEFINER`:
```bash
supabase db query -f - <<'SQL'
SELECT routine_name, grantee, privilege_type
FROM information_schema.routine_privileges
WHERE routine_schema = 'public'
  AND routine_name IN (/* nama fungsi baru */)
ORDER BY routine_name, grantee;
SQL
```
Tampilkan verbatim. Verifikasi tidak ada `grantee = 'anon'`.

---

## Langkah 4 — Estimasi rows terdampak (jika ada UPDATE/DELETE)

Jika migration mengandung `UPDATE` atau `DELETE` massal:
```bash
supabase db query -f - <<'SQL'
EXPLAIN SELECT count(*) FROM <tabel> WHERE <kondisi migration>;
SQL
```
Tampilkan verbatim. Jika >1000 baris: jalankan `EXPLAIN ANALYZE` dan estimasi waktu vs `statement_timeout = 2 menit`.

---

## Output akhir

Laporkan:
- Daftar migration yang akan di-push
- Hasil checklist 5 poin (lulus/gagal tiap item)
- Estimasi risiko: RENDAH / SEDANG / TINGGI

**STOP** — tunggu konfirmasi eksplisit sebelum real push.
Untuk melanjutkan ke real push: gunakan `/sip-deploy`.
