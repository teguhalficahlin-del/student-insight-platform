# Runbook Rilis Aman — Migrasi & Restore (Skala 10 Sekolah)

**Versi:** v0.1 · **Tanggal:** 3 Juli 2026
**Menutup checklist:** `go-live-10-sekolah-checklist.md` → **C1** (backup sebelum migrasi), **C2** (rencana rollback), **B2** (restore teruji).
**Konteks penting:** 1 DB Postgres dipakai bersama SEMUA sekolah → **satu migrasi salah = 10 sekolah kena sekaligus**. Runbook ini wajib diikuti untuk tiap perubahan skema ke live.

> **Cara apply migrasi di proyek ini** (bukan `supabase db push` — DB password tidak tersimpan). **Dua cara setara (proyek `--linked` ke `xovvuuwexoweoqyltepq`):**
> - ✅ **Cara praktik terkini (dipakai 4 Jul 2026):** `supabase db query --linked --file <file.sql>` — CLI membaca token sendiri dari Credential Manager, tak perlu rakit HTTP manual. **Ini yang direkomendasikan.**
> - Alternatif (Management API): POST ke `https://api.supabase.com/v1/projects/xovvuuwexoweoqyltepq/database/query`, header `Authorization: Bearer <sbp_...>` (token dari Windows Credential Manager `Supabase CLI:supabase`, blob UTF-8), body `{"query":"<SQL>"}`.
> Migrasi kita **idempoten** (`IF NOT EXISTS` / `CREATE OR REPLACE` / `DROP POLICY IF EXISTS`) → aman diulang.

> **🔄 REKONSILIASI KE KODE — 4 Juli 2026.** (a) Metode apply diperbarui: **CLI `supabase db query --linked --file`** adalah cara yang benar-benar dipakai (di atas). (b) **Jujur — disiplin C1/C2 belum jadi kebiasaan:** migrasi `20260704110000` (login perangkat baru) & `20260704120000` (tutup lubang anon) di-apply 4 Jul **tanpa** langkah snapshot-pra-apply (§1b) & tanpa header ROLLBACK di file — dibenarkan hanya karena keduanya **additif & idempoten** pada DB pra-launch. Ini justru menegaskan §DoD: C1/C2 baru "hijau" bila jadi kebiasaan tiap migrasi. (c) **B2 (restore teruji) masih KOSONG** — belum ada latihan restore.

---

## Bagian 1 — C1: Backup SEBELUM tiap migrasi

**Aturan:** dilarang menjalankan DDL ke live tanpa titik pulih yang terverifikasi < 24 jam.

### 1a. Konfirmasi backup otomatis menyala *(sekali, lalu cek berkala)*
1. Dashboard Supabase → **Database → Backups**.
2. Pastikan: **Daily backups** aktif (min. Pro), atau **PITR** bila tier mendukung.
3. Catat **backup terakhir** — harus < 24 jam. Bila tidak, picu/menunggu backup dulu.

> Tanpa Pro/PITR, backup otomatis mungkin **tidak** tersedia → jangan migrasi sampai ada titik pulih (naikkan tier atau ambil dump manual di 1b).

### 1b. Snapshot bertarget objek yang diubah *(WAJIB untuk tiap migrasi)*
Backup harian tidak cukup granular untuk rollback cepat satu objek. Sebelum apply, **rekam definisi "sebelum"** dari objek yang akan diubah, via `database/query`:

- **Fungsi / RPC** (`CREATE OR REPLACE FUNCTION ...`):
  ```sql
  SELECT pg_get_functiondef('public.fn_nama'::regproc);
  ```
- **Policy** (`CREATE POLICY ...`):
  ```sql
  SELECT policyname, cmd, qual, with_check
  FROM pg_policies WHERE tablename = 'nama_tabel';
  ```
- **Kolom / constraint** (`ALTER TABLE ...`):
  ```sql
  SELECT column_name, data_type, is_nullable, column_default
  FROM information_schema.columns WHERE table_name = 'nama_tabel';
  ```
- **Data yang akan di-UPDATE/DELETE massal:** simpan salinan baris terdampak
  ```sql
  SELECT * FROM nama_tabel WHERE <predikat migrasi>;   -- simpan hasilnya
  ```

Simpan output ke `scratchpad/` (mis. `pre-mig-<versi>.json`). Inilah bahan rollback di Bagian 2.

### 1c. Checklist pra-apply (jangan skip)
- [ ] Backup otomatis < 24 jam **atau** snapshot 1b diambil.
- [ ] Migrasi idempoten (aman diulang).
- [ ] Ada rencana rollback tertulis (Bagian 2).
- [ ] `tests/tenant-isolation.mjs` **hijau** sebelum & direncanakan ulang **sesudah**.
- [ ] Payload SQL sudah dibuang baris komentar `^\s*--` (endpoint limit; migrasi kita banyak komentar → risiko 413).

---

## Bagian 2 — C2: Rencana rollback per migrasi

**Aturan:** tiap migrasi menyertakan jalan-balik SEBELUM di-apply. Pilih pola sesuai jenis perubahan.

| Jenis perubahan | Rollback |
|---|---|
| `CREATE OR REPLACE FUNCTION` | Re-apply definisi lama hasil `pg_get_functiondef` (snapshot 1b). |
| `CREATE POLICY` baru | `DROP POLICY IF EXISTS <nama> ON <tabel>;` |
| `DROP POLICY` / ubah policy | Re-`CREATE POLICY` dari snapshot `qual`/`with_check` lama. |
| `ADD COLUMN` | `ALTER TABLE <t> DROP COLUMN IF EXISTS <kol>;` *(hati-hati bila sudah terisi data)* |
| `ALTER COLUMN` (tipe/nullable/default) | `ALTER TABLE` balik ke nilai snapshot 1b. |
| `REVOKE`/`GRANT` | `GRANT`/`REVOKE` kebalikannya. |
| `UPDATE`/`DELETE` data massal | Pulihkan dari salinan baris 1b (`INSERT ... ON CONFLICT DO UPDATE`). |
| Perubahan destruktif/kompleks | **Restore backup** (Bagian 3) — jalur terakhir. |

**Template bagian rollback — salin dari [`docs/konsep/migration-template.sql`](migration-template.sql) untuk tiap file migrasi baru (P4-A):**
```sql
-- ============================================================
-- Migration <versi>: <ringkas>
-- ROLLBACK:
--   <perintah SQL persis untuk membalik, atau>
--   "Restore backup <tanggal/PITR> — perubahan tak reversibel via SQL."
-- SNAPSHOT PRA-APPLY: scratchpad/pre-mig-<versi>.json
-- ============================================================
```

> **C2 hijau** = template ini dipakai di SETIAP file migrasi baru tanpa kecuali. Satu migrasi tanpa ROLLBACK = C2 kembali merah.

**Urutan apply aman:**
1. Ambil snapshot (1b) → 2. Apply DDL via `database/query` → 3. Verifikasi objek ada (`pg_policies`/`regproc`/`information_schema`) → 4. Catat ke `supabase_migrations.schema_migrations` → 5. **Jalankan ulang `tenant-isolation.mjs`** → 6. Smoke test login 1 sekolah. Bila (5)/(6) gagal → eksekusi rollback.

---

## Bagian 3 — B2: Prosedur uji RESTORE (latihan wajib pra go-live)

**Tujuan:** membuktikan backup benar-benar bisa dipulihkan & datanya utuh — bukan sekadar "backup ada". Lakukan **1×** sebelum go-live, lalu ulang tiap kali arsitektur backup berubah.

### Langkah
1. **Pilih target uji** — **jangan restore ke DB produksi.** Gunakan:
   - Supabase: **Restore to a new project** (bila tersedia), atau
   - Postgres lokal/staging: `pg_restore` dari file backup yang diunduh.
2. **Jalankan restore** dari backup terbaru.
3. **Verifikasi integritas** (bandingkan dengan produksi saat itu):
   ```sql
   SELECT (SELECT count(*) FROM schools)      AS schools,
          (SELECT count(*) FROM users)        AS users,
          (SELECT count(*) FROM students)     AS students,
          (SELECT count(*) FROM attendance)   AS attendance;
   ```
   - Jumlah per tabel wajar (mis. students ≈ 1296 + 447 = ~1743 saat ini).
   - Spot-check 1 sekolah: `SELECT count(*) FROM students WHERE school_id = '<smkhr>';`
   - **Uji isolasi tetap utuh pasca-restore:** arahkan `tenant-isolation.mjs` ke DB hasil restore → harus tetap hijau.
4. **Catat hasil** (di bawah) — tanggal, sumber backup, RPO teramati (selisih waktu backup vs sekarang), durasi restore, verdikt.
5. **Bersihkan** — hapus project/DB uji.

### Catatan hasil latihan restore

> ⛔ **BLOCKER GO-LIVE (P1-A)** — Tabel ini masih kosong. Platform **tidak boleh go-live** sampai ada satu baris dengan verdikt **BERHASIL**. Ikuti langkah 1–5 di atas, lalu isi baris berikut.

| Tanggal | Sumber backup | RPO teramati | Durabilitas data | Isolasi pasca-restore | Verdikt |
|---|---|---|---|---|---|
| _(belum)_ | | | | | |

> **B2 dinyatakan SELESAI** hanya setelah minimal satu baris di atas terisi dengan verdikt **BERHASIL**.

---

## Definition of Done (blok B/C checklist)
- **C1 hijau:** backup otomatis terkonfirmasi + snapshot 1b jadi kebiasaan tiap migrasi.
- **C2 hijau:** template rollback dipakai di tiap file migrasi baru; contoh minimal 1 migrasi berikutnya menyertakannya.
- **B2 hijau:** tabel "Catatan hasil latihan restore" terisi verdikt BERHASIL.

*Dokumen konsep/operasional. Sumber kebenaran = kode + test; runbook ini prosedur, kepatuhannya dibuktikan lewat jejak (snapshot, entri rollback, catatan restore).*
