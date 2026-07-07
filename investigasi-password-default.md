# Investigasi: Alur Password Default & Onboarding Akun

**Tanggal investigasi:** 6 Juli 2026  
**Investigator:** Claude (static code analysis — tidak ada perubahan kode)  
**Scope:** edge functions provisioning, migrasi skema, shared auth module, semua portal aktor

---

## Poin 1 — Password saat akun baru dibuat

### Ringkasan

| Edge Function | Password yang di-set | Sumber |
|---|---|---|
| `provision-student-accounts` | **`'12345678'`** hardcoded | baris 143 |
| `bulk-import-users` (guru/staf/dudi/stakeholder) | **`'12345678'`** via `generateTempPassword()` | baris 117–121, 598 |
| `bulk-import-dudi` | **`'12345678'`** via `generateTempPassword()` | (pola sama) |
| `bulk-import-parents` | **`'12345678'`** via `generateTempPassword()` | (pola sama) |
| `manage-admin-account` | **RANDOM 12 karakter** via `generatePassword()` | baris 22–27 |
| `reset-admin-password` (superadmin) | **RANDOM 12 karakter** via `randomPassword()` | baris 26–29 |

### Bukti kode

**`provision-student-accounts/index.ts:141-144`** — siswa:
```ts
const { data: authUser, error: authErr } = await admin.auth.admin.createUser({
    email:         internalEmail,
    password:      '12345678',       // ← hardcoded
    email_confirm: true,
});
```

**`bulk-import-users/index.ts:117-121`** — guru/staf semua role:
```ts
function generateTempPassword(): string {
    // Password sementara seragam — pengguna WAJIB ganti saat login pertama
    // (must_change_password=true). Admin cukup bagikan NIP/NIS/NIK saja.
    return '12345678';
}
```

**`manage-admin-account/index.ts:22-27`** — admin sekolah (satu-satunya yang RANDOM):
```ts
function generatePassword(len = 12): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
    const arr = new Uint8Array(len);
    crypto.getRandomValues(arr);
    return Array.from(arr, b => chars[b % chars.length]).join('');
}
```

**Kesimpulan Poin 1:** Semua akun user (siswa, guru, ortu, DUDI, stakeholder) dibuat dengan password `12345678`. Hanya akun ADMINISTRATIVE yang mendapat password random.

---

## Poin 2 — Mekanisme paksa ganti password: ada, tapi CLIENT-SIDE only

### Mekanismenya

Kolom `users.must_change_password BOOLEAN` (migrasi `20260702190000`) di-set `true` di semua edge function provisioning:

| Lokasi | Baris |
|---|---|
| `provision-student-accounts/index.ts` | 161 |
| `bulk-import-users/index.ts` | 630 |
| `bulk-import-dudi/index.ts` | 259 |
| `bulk-import-parents/index.ts` | 241 |
| `set-user-password/index.ts` (reset oleh admin) | 86 |
| `reset-admin-password/index.ts` (reset oleh superadmin) | 70 |

Fungsi `checkMustChangePassword()` di `shared/change-password.js:60` dipanggil di setiap portal:

| File | Baris | Keterangan |
|---|---|---|
| `guru/js/auth.js` | 52 | saat login |
| `guru/js/dashboard.js` | 202 | saat dashboard dimuat |
| `parent/js/auth.js` | 58 | saat login |
| `parent/js/portal.js` | 124 | saat portal dimuat |
| `dudi/js/auth.js` | 57 | saat login |
| `dudi/js/dashboard.js` | 219 | saat dashboard dimuat |
| `student/js/auth.js` | 61 | saat login |
| `student/js/dashboard.js` | 77 | saat dashboard dimuat |
| `stakeholder/js/auth.js` | 52 | saat login |
| `stakeholder/js/dashboard.js` | 33 | saat dashboard dimuat |
| `admin/js/auth.js` | 69 | saat login |
| `admin/js/wizard.js` | 2111 | saat wizard dibuka |

Modal yang ditampilkan **tidak bisa ditutup** (`forceMode=true`, tidak ada tombol Batal) — secara UX memaksa user ganti password sebelum lanjut.

### Gap kritis: tidak ada server-side guard

Seluruh enforcement di atas berjalan di **JavaScript browser**. Tidak ditemukan:

- RLS policy yang menolak SELECT/INSERT/UPDATE bila `must_change_password = true`
- Database trigger yang memblokir operasi berdasarkan flag ini
- Middleware/guard di edge function yang mengecek `must_change_password` sebelum memproses request
- Supabase Auth hook (`before_sign_in`, `after_sign_in`) yang memeriksa flag ini

**Implikasi:** User yang tahu cara memanggil API Supabase langsung (via curl, Postman, atau dengan memodifikasi JS di DevTools) dapat melewati seluruh pemaksaan ganti password dan mengakses semua endpoint dengan password default `12345678`.

---

## Poin 3 — Kolom `password_changed_at` / `password_changed`: ada di skema, dipakai di satu alur saja

### `school_config.password_changed` (migrasi `20260629120000`)

```sql
ALTER TABLE public.school_config
    ADD COLUMN IF NOT EXISTS password_changed BOOLEAN NOT NULL DEFAULT FALSE;
```

Kolom ini **hanya digunakan di alur wizard admin sekolah**:

- **Dibaca:** `admin/js/wizard.js:2161` — jika `false`, wizard langsung menampilkan modal ganti password dan `return` (wizard tidak bisa dilanjutkan).
- **Di-set `true`:** `admin/js/api.js:333` — saat admin berhasil mengubah password dari modal wizard.

**Kolom ini tidak berhubungan** dengan `users.must_change_password` dan tidak dipakai di alur login/auth user biasa (guru, siswa, ortu, dll). Fungsinya tunggal: memblokir wizard setup admin sampai password awal diganti.

### Tidak ada `password_changed_at` di tabel `users`

Tidak ditemukan kolom timestamp perubahan password di tabel `users`. Pencarian `password_changed_at`, `password_last_changed`, `pw_changed` pada seluruh file SQL dan migrasi: **0 hasil**.

### Kesimpulan Poin 3

`users.must_change_password` adalah flag boolean yang dipakai di client-side semua portal, bukan di server. `school_config.password_changed` adalah flag terpisah khusus wizard admin, tidak terhubung ke `users.must_change_password` dan tidak dibaca di alur login umum.

---

## Poin 4 — Berapa lama akun bisa pakai password default?

**Tidak ditemukan mekanisme expiry password.**

Pencarian `expir`, `rotate`, `password.*expir`, `max_age` pada seluruh migrasi SQL, edge functions, dan kode JS: tidak ada hasil yang relevan.

Kondisi aktual:
- Tidak ada scheduler/cron yang memeriksa umur password.
- Tidak ada kolom timestamp kapan password terakhir diubah.
- `must_change_password` tidak punya deadline — flag tetap `true` sampai user secara aktif mengubah password via modal.
- Jika user **tidak pernah login** ke portal, flag tidak pernah ditampilkan, dan password `12345678` tetap aktif selamanya.
- Jika user bypass portal (akses API langsung), flag tidak pernah di-clear, tapi juga tidak memblokir.

**Kesimpulan eksplisit: tidak ditemukan mekanisme expiry password. Akun dapat mempertahankan password default `12345678` selamanya, tanpa batasan waktu.**

---

## Ringkasan Temuan

| # | Pertanyaan | Jawaban |
|---|---|---|
| 1 | Password default saat provisioning? | `12345678` untuk semua role kecuali ADMINISTRATIVE (random) |
| 2 | Ada mekanisme paksa ganti? | Ya — `must_change_password=true` + modal client-side di semua portal. **Tapi client-side only, bisa di-bypass via API langsung.** |
| 3 | `password_changed_at` / flag: dipakai di auth guard? | Tidak. `users.must_change_password` hanya dicek JS browser. `school_config.password_changed` hanya untuk wizard admin, tidak untuk user lain. |
| 4 | Ada expiry password? | **Tidak ditemukan mekanisme expiry.** Password default bisa aktif selamanya. |

---

## Catatan untuk Remediasi (di luar scope investigasi ini)

Temuan utama yang perlu diatasi bila/ketika dilakukan remediasi:

1. **Password provisioning non-random** — `bulk-import-users:generateTempPassword()` sudah punya nama fungsi yang tepat tapi isinya literal string; tinggal isi dengan random generator seperti yang sudah ada di `manage-admin-account`.
2. **Tidak ada server-side enforcement** — `must_change_password` perlu dicek di `_shared/auth.ts:resolveAuth()` atau sebagai middleware edge function, bukan hanya di browser.
3. **Tidak ada password expiry** — minimal tambahkan `password_changed_at` timestamp dan cron yang menandai akun yang tidak pernah ganti password lebih dari N hari.
4. **String `12345678` expose di confirm dialog** — `admin/js/dashboard.js:692,695,1852,1855` menampilkan password eksplisit di UI; seharusnya deskripsi generik ("password sementara") tanpa nilai aktual.
