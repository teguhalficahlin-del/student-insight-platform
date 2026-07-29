# /sip-fn-inspect — Inspeksi Fungsi PostgreSQL

Gunakan command ini untuk inspeksi lengkap sebuah fungsi database.
JANGAN pakai `\df+` — itu hanya tampilkan signature, bukan body.

**Cara pakai:** `/sip-fn-inspect nama_fungsi`

---

## Langkah 1 — Ambil oid dan body fungsi
```bash
supabase db query -f - <<'SQL'
SELECT
  p.oid,
  p.proname,
  p.prosecdef AS is_security_definer,
  pg_get_functiondef(p.oid) AS definition
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE p.proname = 'NAMA_FUNGSI'
  AND n.nspname = 'public';
SQL
```
Ganti `NAMA_FUNGSI` dengan argumen yang diberikan.
Tampilkan output verbatim.

---

## Langkah 2 — Cek GRANT dan REVOKE
```bash
supabase db query -f - <<'SQL'
SELECT grantee, privilege_type, is_grantable
FROM information_schema.routine_privileges
WHERE routine_name = 'NAMA_FUNGSI'
  AND routine_schema = 'public';
SQL
```
Tampilkan verbatim.

Evaluasi:
- Apakah `is_security_definer = true`?
- Jika ya: apakah ada baris `grantee = 'anon'`? Seharusnya TIDAK ada.
- Apakah `authenticated` punya EXECUTE? Apakah `service_role` butuh grant?

---

## Langkah 3 — Cek pemanggil di sisi klien (JS)
```bash
grep -rn "NAMA_FUNGSI" guru/js/ student/js/ parent/js/ admin/js/ \
  superadmin/js/ tu/js/ dudi/js/ stakeholder/js/ shared/ \
  --include="*.js"
```
Tampilkan verbatim. Ini menunjukkan portal mana yang memanggil fungsi ini.

---

## Output akhir
Rangkum:
- Body fungsi: tampilkan LENGKAP (sudah di Langkah 1)
- Security: SECURITY DEFINER atau SECURITY INVOKER?
- REVOKE status: anon tercabut? PUBLIC tercabut?
- Portal pemanggil: daftar file + baris

**STOP** — jangan apply perubahan apapun, hanya laporan.
