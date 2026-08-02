# /sip-invert — INVERT Check (Skenario Gagal)

Jawab semua pertanyaan di bawah secara eksplisit dengan mekanisme konkret
(kutip logika SQL/kode yang relevan). Jawaban "aman karena sudah dicek"
tanpa bukti tidak diterima.

Read-only: jangan apply perubahan apapun di langkah ini.

---

## 1. Kebenaran perubahan

- Fungsi/tabel/policy mana yang terdampak langsung?
- Apakah ada caller lain (portal/fungsi/trigger lain) yang memanggil
  kode yang diubah? Grep semua portal JS + semua fungsi DB yang relevan.
- Apakah perubahan ini kompatibel dengan semua caller yang ada?

---

## 2. Silent failure

- Skenario di mana perubahan kelihatan sukses padahal sebagian gagal?
  Contoh: INSERT berhasil tapi trigger gagal diam-diam, RPC return 200 tapi
  data tidak berubah karena RLS menolak.
- Apakah ada `ON CONFLICT DO NOTHING` atau `.maybeSingle()` yang menyembunyikan error?

---

## 3. Data dan state

- Baris mana yang terdampak? Berapa estimasi jumlahnya?
- Edge case: ada baris dengan nilai NULL, kosong, atau duplikat yang
  berperilaku berbeda dari kasus normal?
- Untuk migration: apakah ada data "campuran" (sebagian baris kondisi lama,
  sebagian baru) yang perlu ditangani berbeda?

---

## 4. Concurrency

- Race condition apa yang mungkin terjadi jika dua user melakukan aksi ini
  bersamaan (dua tab, dua guru di kelas yang sama, klik ganda)?
- Apakah ada window waktu di mana state tidak konsisten
  (antara `db push` dan `git push`, atau antara dua langkah migration)?

---

## 5. Khusus migration DB

Jawab hanya jika ada migration:

- Apakah operator dan fungsi SQL yang dipakai valid untuk tipe kolom sebenarnya?
  (Contoh: `MIN()`/`MAX()` tidak berlaku untuk `uuid`)
- Apakah ada FK dependency yang perlu di-drop dulu sebelum ALTER?
- Jika UPDATE/DELETE >1000 baris: jalankan `EXPLAIN ANALYZE` dan bandingkan
  estimasi waktu dengan `statement_timeout = 2 menit`.

```bash
supabase db query -f - <<'SQL'
EXPLAIN ANALYZE <query dari migration>;
SQL
```

---

## 6. Khusus SECURITY DEFINER

Jawab hanya jika ada fungsi SECURITY DEFINER baru:

- Apakah ada `REVOKE EXECUTE FROM anon` + `REVOKE EXECUTE FROM PUBLIC`
  di migration yang sama?
- Apakah ada `SET search_path = public` di definisi fungsi?
  (Tanpa ini, fungsi rentan search_path injection)
- Apakah `GRANT EXECUTE TO authenticated` sudah ada?

---

## Format jawaban

Untuk setiap poin: **YA / TIDAK / TIDAK RELEVAN** + mekanisme konkret.

Contoh format yang benar:
```
2. Silent failure: TIDAK — fungsi memakai RAISE EXCEPTION jika kondisi gagal
   (baris 14: IF NOT FOUND THEN RAISE EXCEPTION 'not found'), tidak diam-diam.
```

**STOP** — jangan apply perubahan apapun setelah menjawab.
Laporan ini adalah input untuk keputusan Claude Chat + user.
