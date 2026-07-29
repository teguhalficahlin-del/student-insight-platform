# /sip-deploy — Urutan Deploy Aman SIP SMK

Urutan ini WAJIB diikuti. Tidak ada langkah yang boleh di-skip.
Tidak ada langkah yang digabung tanpa checkpoint.

---

## Langkah 1 — Dry-run (jalankan sekarang)
```bash
supabase db push --linked --dry-run
```
Tampilkan output verbatim.

Verifikasi:
- Hanya migration yang dimaksud yang muncul
- Tidak ada migration tak terduga / drift schema

**STOP** — tunggu konfirmasi eksplisit dari user sebelum lanjut ke Langkah 2.

---

## Langkah 2 — Real push (setelah konfirmasi)
```bash
supabase db push --linked
```
Tampilkan output verbatim.

---

## Langkah 3 — Edge function (hanya jika ada perubahan)
Jika prompt menyebut ada edge function yang berubah:
```bash
supabase functions deploy <nama_fungsi> --project-ref xovvuuwexoweoqyltepq
```
Catatan: `--linked` tidak diterima untuk perintah `functions` di CLI versi proyek ini.
Tampilkan output verbatim.

---

## Langkah 4 — Verifikasi pasca-deploy
Jalankan query balik untuk konfirmasi perubahan sudah aktif:
```bash
supabase db query -f - <<'SQL'
-- query sesuai konteks: cek fungsi terbaru, policy terbaru, atau data yang diubah
SELECT now(), 'deploy verified';
SQL
```
Tampilkan output verbatim.

---

## Langkah 5 — Laporan ke user
Laporkan:
- Migration yang di-push (nama file)
- Hasil verifikasi pasca-deploy
- Apakah ada edge function yang di-deploy

**STOP** — tunggu konfirmasi eksplisit sebelum `git push`.

---

## Langkah 6 — Git push (setelah konfirmasi terpisah)
```bash
git push origin main
```
Tampilkan output verbatim.

**STOP** — laporan selesai.

---

## Catatan penting
- `git push` selalu TERAKHIR — setelah database dan edge function terbukti sinkron
- Ini mencegah jendela waktu di mana kode production memanggil RPC yang belum ada di DB remote
- Setiap STOP adalah checkpoint — jangan lanjut tanpa konfirmasi user
