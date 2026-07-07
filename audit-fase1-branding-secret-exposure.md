# Audit Fase 1 — Branding/Tenant Identity Leak & Client-Side Secret Exposure
**Tanggal audit:** 6 Juli 2026  
**Metode:** Grep menyeluruh seluruh file `*.html`, `*.js`, `*.json` yang di-serve ke browser + inspeksi manual + git history check  
**Scope:** Hardcoded tenant identity + credential exposure di client-side  

---

## Ringkasan Eksekutif

**Bagian A (Branding):** Ditemukan **10 lokasi hardcode** nama sekolah pertama (`SMK Harapan Rokan`) di seluruh codebase client-side — 8 di `<title>` tag (KOSMETIK), 1 di body teks yang dibaca user langsung (`offline.html:64`, FUNGSIONAL-BERBAHAYA), 1 di `admin/manifest.json` (FUNGSIONAL-BERBAHAYA karena dibaca browser sebagai label PWA). Infrastruktur branding dinamis (`shared/branding.js`, fungsi `applyBranding`, atribut `data-brand`) **sudah ada dan aktif dipakai** di semua portal kecuali `offline.html` dan `superadmin/`. Judul `<title>` hardcode adalah sisa yang **tidak ter-update** oleh sistem branding karena `branding.js` memperbarui `document.title` via `_applyToDom` (baris 130–135) — tetapi ini hanya berlaku saat halaman sudah dimuat dan branding berhasil di-fetch.

**Bagian B (Secret):** Tidak ditemukan credential berbahaya. Satu-satunya key yang di-commit adalah Supabase anon key — JWT dengan klaim `"role":"anon"`, publik by design. Tidak ada `service_role` key, database connection string, atau secret lain di kode client-side maupun git history.

**Temuan tambahan:** Default password `12345678` ter-hardcode di 4 file JS yang di-serve ke browser.

---

## Bagian A — Branding / Tenant Identity Leak

### A.1 Verifikasi Ulang 7 Lokasi dari Discovery

Semua 7 lokasi yang ditemukan discovery masih sama (belum ada perubahan):

| # | File | Baris | Konten |
|---|------|-------|--------|
| A-1 | `guru/dashboard.html` | 6 | `<title>Dashboard Guru — SMK Harapan Rokan</title>` |
| A-2 | `guru/index.html` | 6 | `<title>Portal Guru — SMK Harapan Rokan</title>` |
| A-3 | `student/dashboard.html` | 6 | `<title>Dashboard Siswa — SMK Harapan Rokan</title>` |
| A-4 | `student/index.html` | 6 | `<title>Portal Siswa — SMK Harapan Rokan</title>` |
| A-5 | `stakeholder/dashboard.html` | 6 | `<title>Dashboard Stakeholder — SMK Harapan Rokan</title>` |
| A-6 | `stakeholder/index.html` | 6 | `<title>Portal Stakeholder — SMK Harapan Rokan</title>` |
| A-7 | `offline.html` | 6 | `<title>Offline — SMK Harapan Rokan</title>` |

### A.2 Perluasan — Lokasi di Luar `<title>` Tag

**Temuan baru yang tidak ada di discovery:**

| # | File | Baris | Lokasi | Konten |
|---|------|-------|--------|--------|
| A-8 | `offline.html` | 64 | Body HTML (`<p>`) | `"Perangkat Anda sedang offline. Hubungkan ke internet untuk menggunakan Platform SMK Harapan Rokan."` |
| A-9 | `admin/manifest.json` | 3 | JSON field `"name"` | `"Admin Console — SMK Harapan Rokan"` |
| A-9b | `admin/manifest.json` | 4 | JSON field `"short_name"` | `"Admin SMK HR"` |
| A-10 | `stakeholder/manifest.json` | 2 | JSON field `"name"` | `"Portal Stakeholder — SMK Harapan Rokan"` |
| A-10b | `stakeholder/manifest.json` | 3 | JSON field `"short_name"` | `"Stakeholder SMK HR"` |

**Tidak ditemukan** nama `SMK Harapan Rokan` atau NPSN `10494399` di:
- Meta tags (`description`, `og:title`, `og:description`, `twitter:title`) — tidak ada meta social tags sama sekali di seluruh portal
- Alt text gambar — tidak ada `<img alt="SMK Harapan Rokan">`
- String notifikasi di kode (`notifications` table diisi server-side, bukan client)
- File JS non-api (`dashboard.js`, `portal.js`, dll.)

### A.3 Status Infrastruktur Branding Dinamis

**Infrastruktur branding dinamis sudah ada dan aktif dipakai:**

| Komponen | File | Baris | Fungsi |
|----------|------|-------|--------|
| Modul utama | `shared/branding.js` | 1–181 | `applyBranding()`, `applyBrandingById()`, `_applyToDom()` |
| Fetch by slug | `shared/branding.js` | 49–73 | Query RPC `fn_school_branding` via REST sebelum login |
| Fetch by ID | `shared/branding.js` | 89–103 | Query `supabase.from('schools')` setelah login |
| Apply DOM | `shared/branding.js` | 105–137 | Update `data-brand="school-name"`, `data-brand="logo"`, `document.title`, CSS var `--color-primary` |

**Portal yang sudah memanggil `applyBranding()` (sebelum login):**

| Portal | File | Baris |
|--------|------|-------|
| Guru (halaman login) | `guru/js/auth.js` | 2, 16 |
| Siswa (halaman login) | `student/js/auth.js` | 2, 16 |
| Orang Tua (halaman login) | `parent/js/auth.js` | 9, 23 |
| Admin (halaman login) | `admin/js/auth.js` | 11, 26 |
| DUDI (halaman login) | `dudi/js/auth.js` | 8, 22 |
| Stakeholder (halaman login) | `stakeholder/js/auth.js` | 2, 16 |

**Portal yang sudah memanggil `applyBrandingById()` (setelah login):**

| Portal | File | Baris |
|--------|------|-------|
| Guru (dashboard) | `guru/js/dashboard.js` | 6, 200 |
| Siswa (dashboard) | `student/js/dashboard.js` | 6, 76 |
| Orang Tua (dashboard) | `parent/js/portal.js` | 8, 123 |
| Admin (dashboard) | `admin/js/dashboard.js` | 8, 1835 |
| DUDI (dashboard) | `dudi/js/dashboard.js` | 6, 218 |
| Stakeholder (dashboard) | `stakeholder/js/dashboard.js` | 6, 32 |

**Tidak memanggil `applyBranding` sama sekali:**
- `offline.html` — tidak mengimpor `branding.js`; tidak ada `<script>` apapun selain inline
- `superadmin/` (login dan dashboard) — tidak ada panggilan ke `branding.js`

**Catatan tentang `document.title`:** `_applyToDom()` di `shared/branding.js:130–135` memperbarui `document.title` dengan logika:
- Jika title punya format `X — Y`, hasilnya menjadi `X — <nama sekolah dari DB>`
- Jika title tidak punya `—`, hasilnya menjadi `<title lama> — <nama sekolah dari DB>`

Artinya, untuk portal yang sudah memanggil `applyBranding()`, title hardcode `"Dashboard Guru — SMK Harapan Rokan"` akan **digantikan secara runtime** menjadi `"Dashboard Guru — <nama sekolah dari DB>"`. Namun penggantian ini hanya terjadi **setelah JavaScript selesai berjalan dan fetch branding berhasil** — sebelum itu, tab browser menampilkan nama hardcode selama jendela waktu load.

### A.4 Fakta tentang Superadmin dan Admin

**`superadmin/dashboard.html:6`:** `<title>Dashboard Superadmin — Platform Sekolah</title>`  
**`admin/dashboard.html:6`:** `<title>Dashboard — Admin Console</title>`

Fakta dari kode:
- `superadmin/js/dashboard.js` tidak mengimpor `branding.js` dan tidak memanggil `applyBranding` sama sekali (grep: tidak ada hasil)
- `superadmin/dashboard.html` tidak memiliki elemen `data-brand`
- Superadmin beroperasi lintas semua tenant (memanggil edge fn `list-schools`, `provision-school`, `delete-school`) sehingga tidak memiliki satu `school_id` tunggal yang bisa jadi basis branding
- Admin (`admin/dashboard.html:17`) memiliki `data-brand="school-name"` dan memanggil `applyBrandingById` — nama sekolah akan diganti runtime. Title hardcode `"Dashboard — Admin Console"` tidak mengandung nama sekolah spesifik

### A.5 Klasifikasi Seluruh Temuan Bagian A

| # | File | Baris | Konten | Klasifikasi |
|---|------|-------|--------|-------------|
| A-1 | `guru/dashboard.html` | 6 | `<title>` hardcode | **KOSMETIK** — diganti runtime oleh `_applyToDom` saat branding berhasil di-fetch |
| A-2 | `guru/index.html` | 6 | `<title>` hardcode | **KOSMETIK** — sama, `applyBranding()` dipanggil di `auth.js:16` |
| A-3 | `student/dashboard.html` | 6 | `<title>` hardcode | **KOSMETIK** — diganti runtime |
| A-4 | `student/index.html` | 6 | `<title>` hardcode | **KOSMETIK** — diganti runtime |
| A-5 | `stakeholder/dashboard.html` | 6 | `<title>` hardcode | **KOSMETIK** — diganti runtime |
| A-6 | `stakeholder/index.html` | 6 | `<title>` hardcode | **KOSMETIK** — diganti runtime |
| A-7 | `offline.html` | 6 | `<title>` hardcode | **KOSMETIK** — `offline.html` tidak memanggil `branding.js`, tetapi title tab browser bukan konten yang dibaca user sebagai informasi |
| A-8 | `offline.html` | 64 | Teks `<p>` di body | **FUNGSIONAL-BERBAHAYA** — kalimat ini dibaca langsung oleh user sebagai informasi ketika offline; untuk tenant SMK lain, kalimat ini salah |
| A-9 | `admin/manifest.json` | 3–4 | `"name"` dan `"short_name"` PWA | **FUNGSIONAL-BERBAHAYA** — nama PWA yang ter-install di layar utama perangkat; untuk tenant SMK lain, label PWA akan menampilkan nama sekolah yang salah |
| A-10 | `stakeholder/manifest.json` | 2–3 | `"name"` dan `"short_name"` PWA | **FUNGSIONAL-BERBAHAYA** — sama seperti A-9; label PWA ter-install salah untuk tenant lain |

---

## Bagian B — Client-Side Secret Exposure

### B.1 Credential yang Ditemukan di File JS/HTML

**Satu-satunya credential yang ditemukan:** Supabase anon key

Nilai (sama di semua file):
```
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhvdnZ1dXdleG93ZW9xeWx0ZXBxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIyMDk0NzUsImV4cCI6MjA5Nzc4NTQ3NX0.mFwmVfSqYM7ITURtLC143BsurK6Yr31WFViJe5PFGN8
```

Payload JWT terdecode (bukti: output python decode):
```json
{"iss":"supabase","ref":"xovvuuwexoweoqyltepq","role":"anon","iat":1782209475,"exp":2097785475}
```

Klaim `"role":"anon"` — bukan `service_role`.

Lokasi file yang mengandung key ini:

| File | Baris | Nama Variabel |
|------|-------|---------------|
| `admin/js/api.js` | 17 | `SUPABASE_ANON_KEY` |
| `dudi/js/api.js` | 10 | `SUPABASE_ANON_KEY` |
| `guru/js/api.js` | 14 | `SUPABASE_ANON_KEY` (exported) |
| `parent/js/api.js` | 11 | `SUPABASE_ANON_KEY` |
| `shared/branding.js` | 13 | `SUPABASE_ANON` |
| `stakeholder/js/api.js` | 14 | `SUPABASE_ANON_KEY` |
| `student/js/api.js` | 14 | `SUPABASE_ANON_KEY` |
| `superadmin/js/dashboard.js` | 2 | `SUPABASE_ANON` |

**Klasifikasi seluruh temuan:** **AMAN** — Supabase anon key adalah credential publik by design. Keamanan bergantung sepenuhnya pada RLS policy di database, bukan pada kerahasiaan key.

### B.2 Pemeriksaan `service_role` dan Credential Berbahaya

| Pola Dicari | Hasil | File |
|-------------|-------|------|
| `service_role` di file `*.html`, `*.js` client-side | Tidak ditemukan | — |
| `SERVICE_ROLE` | Tidak ditemukan | — |
| Connection string `user:password@host` atau `postgresql://` | Tidak ditemukan | — |
| JWT dengan klaim `"role":"service_role"` | Tidak ditemukan | — |
| `jwt_secret`, `db_password`, `DATABASE_URL` | Tidak ditemukan di client-side | — |

Kemunculan string `service_role` yang ditemukan di git history:
```
+GRANT EXECUTE ON FUNCTION fn_notify_on_observation() TO service_role;
+GRANT EXECUTE ON FUNCTION fn_notify_on_case_created() TO service_role;
```
— Ini adalah pernyataan SQL `GRANT` di migration file (server-side), bukan credential client-side.

### B.3 File `.env` atau Credential Files di Repo

`.gitignore` mencantumkan `.env` di baris pertama — file ini tidak di-commit.

Pemeriksaan: tidak ditemukan file `.env`, `.key`, `.pem`, `.p12`, `.secret` di working tree.

### B.4 Git History — Secret yang Pernah Ada

Perintah: `git log --all -p | grep -i "service_role|ANON_KEY|jwt_secret|db_password|DATABASE_URL"`

Hasil: Hanya anon key yang ditemukan di history, muncul sejak commit pertama yang mengandung file `api.js`. Tidak ada bukti `service_role` JWT, `jwt_secret`, `DATABASE_URL`, atau credential berbahaya lain yang pernah di-commit lalu dihapus.

---

## Temuan Tambahan (Di Luar Scope)

### T-1: Default Password Hardcode di Client-Side JS

Nilai `"12345678"` sebagai default password ditemukan di file JS yang di-serve ke browser:

| File | Baris | Konten |
|------|-------|--------|
| `dudi/js/api.js` | 32 | `throw new Error('Password salah. Jika baru pertama login, gunakan password default: 12345678')` |
| `parent/js/api.js` | 37 | `throw new Error('Password salah. Jika baru pertama login, gunakan password default: 12345678')` |
| `stakeholder/js/api.js` | 38 | `throw new Error('Password salah. Jika baru pertama login, gunakan password default: 12345678')` |
| `student/js/api.js` | 42 | `throw new Error('Password salah. Jika baru pertama login, gunakan password default: 12345678')` |
| `admin/js/dashboard.js` | 692 | `confirm(... "Password akan diset ke \"12345678\"...")` |
| `admin/js/dashboard.js` | 695 | `await adminResetUserPassword(userId, '12345678')` |
| `admin/js/dashboard.js` | 1852 | `confirm(... "Password akan diset ke \"12345678\"...")` |
| `admin/js/dashboard.js` | 1855 | `await adminResetUserPassword(userId, '12345678')` |

Dicatat sebagai temuan tambahan; analisis mendalam di luar scope audit ini.

### T-2: Inkonsistensi Nama Variabel Anon Key

Di `shared/branding.js:13` dan `superadmin/js/dashboard.js:2`, variabel bernama `SUPABASE_ANON` (tanpa `_KEY`), sementara 6 file lain menggunakan `SUPABASE_ANON_KEY`. Bukan masalah keamanan — hanya penamaan tidak konsisten. Dicatat sebagai temuan tambahan.

---

*Dokumen ini hanya mencatat fakta berdasarkan bukti kode. Tidak ada rekomendasi perbaikan di dokumen ini.*
