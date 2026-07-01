# Panduan Superadmin — Platform Sekolah

**Untuk:** Teguh Alficahlin (Vendor / Pemilik Platform)  
**Versi:** 1.1 (2 Juli 2026)

---

## Daftar Isi

1. [Apa Itu Superadmin?](#1-apa-itu-superadmin)
2. [Cara Masuk](#2-cara-masuk)
3. [Mendaftarkan Sekolah Baru](#3-mendaftarkan-sekolah-baru)
4. [Menyimpan Kredensial Admin Sekolah](#4-menyimpan-kredensial-admin-sekolah)
5. [Melihat Daftar Sekolah Terdaftar](#5-melihat-daftar-sekolah-terdaftar)
6. [Cara Keluar](#6-cara-keluar)
7. [Jika Ada Masalah](#7-jika-ada-masalah)
8. [Ganti Superadmin Key](#8-ganti-superadmin-key)

---

## 1. Apa Itu Superadmin?

Panel superadmin digunakan untuk **mendaftarkan sekolah baru** ke platform dan **memantau semua sekolah** yang sudah terdaftar.

Panel ini hanya untuk Anda sebagai pemilik platform — bukan untuk kepala sekolah, guru, atau staf sekolah.

---

## 2. Cara Masuk

Buka URL ini di browser:

```
https://teguhalficahlin-del.github.io/student-insight-platform/superadmin/
```

Masukkan Superadmin Key berikut pada kolom "Superadmin Key", lalu klik **Masuk**:

```
&9p*7Mpa0OkMxqzfFqbkBTG*jOM7*ETo
```

> Simpan key ini di tempat aman (misalnya aplikasi Notes terkunci di HP atau password manager). Jangan bagikan ke siapa pun.

---

## 3. Mendaftarkan Sekolah Baru

Setelah masuk, isi formulir **"Daftarkan Sekolah Baru"** di bagian atas dashboard.

### A. Data Sekolah

| Field | Wajib? | Contoh isi |
|---|---|---|
| **Nama Sekolah** | ✅ | `SMK Karya Bangsa` |
| **NPSN** | — | `20500123` |
| **Telepon** | — | `081312345678` |
| **Alamat** | — | `Jl. Merdeka No. 45, Pekanbaru, Riau` |

### B. Akun Admin IT

| Field | Wajib? | Contoh isi |
|---|---|---|
| **Nama Admin IT** | ✅ | `Rudi Hartono` |
| **NIP / NIK Admin IT** | ✅ | `198503152010011002` |

> NIP/NIK ini menjadi username login Admin IT di portal `/admin/`. Tidak boleh sama dengan NIP/NIK yang sudah terdaftar di sekolah lain di platform ini.

### C. Branding Sekolah (semua opsional)

| Field | Contoh isi | Keterangan |
|---|---|---|
| **Slug URL** | `smkkb` | Huruf kecil dan angka saja. Setelah diisi, URL login semua portal sekolah ini menjadi `?school=smkkb`. Boleh dikosongkan. |
| **URL Logo** | `https://i.imgur.com/contoh.png` | Link gambar logo sekolah. Muncul di halaman login dan header semua portal. |
| **Warna Primer** | `#16a34a` | Warna utama (header, tombol). Klik color picker atau ketik kode hex. |
| **Warna Sekunder** | `#15803d` | Warna hover/aksen. Biasanya versi lebih gelap dari warna primer. |

Klik **Daftarkan Sekolah**. Proses berlangsung beberapa detik.

---

## 4. Menyimpan Kredensial Admin Sekolah

Setelah pendaftaran berhasil, muncul kotak seperti ini:

```
Nama Sekolah          : SMK Harapan Rokan
Login Admin (NIP/NIK) : 197801012005011001
Password Sementara    : Xk7#mP2q
```

> ⚠️ **Password hanya tampil sekali.** Setelah halaman ditutup atau di-refresh, password tidak bisa dilihat lagi.

**Yang harus dilakukan segera:**
1. Salin password sementara tersebut.
2. Kirimkan NIP/NIK + password ke Admin IT sekolah (via WhatsApp atau tatap muka).
3. Minta Admin IT login di:
   ```
   https://teguhalficahlin-del.github.io/student-insight-platform/admin/
   ```
   dan segera ganti password saat pertama masuk.

**Jika password terlewat tidak disalin:**
1. Buka `https://supabase.com/dashboard/project/xovvuuwexoweoqyltepq`
2. Klik **Authentication → Users**
3. Cari email/identifier Admin IT yang baru didaftarkan
4. Klik **Send password reset** atau set password baru manual

---

## 5. Melihat Daftar Sekolah Terdaftar

Bagian bawah dashboard menampilkan tabel semua sekolah yang terdaftar:

| Kolom | Keterangan |
|---|---|
| **Nama Sekolah** | Nama resmi sekolah |
| **NPSN** | Nomor Pokok Sekolah Nasional |
| **URL Slug** | Kode URL sekolah, misal `?school=smkhr` |
| **Warna** | Preview kotak warna primer + kode hex |
| **Telepon** | Nomor kontak sekolah |
| **Status** | `Aktif` atau `Nonaktif` |
| **Terdaftar** | Tanggal sekolah didaftarkan |

Tabel dimuat otomatis saat dashboard dibuka.

> Untuk mengubah data sekolah (misal nonaktifkan sekolah atau ubah nama), buka:  
> `https://supabase.com/dashboard/project/xovvuuwexoweoqyltepq/editor` → tabel `schools` → edit baris yang diinginkan.

---

## 6. Cara Keluar

Klik tombol **Keluar** di pojok kanan atas. Sesi terhapus dan Anda kembali ke halaman login.

Sesi tidak otomatis berakhir selama tab browser masih terbuka — selalu klik Keluar setelah selesai.

---

## 7. Jika Ada Masalah

### "Key salah. Coba lagi."
Key yang aktif saat ini adalah `&9p*7Mpa0OkMxqzfFqbkBTG*jOM7*ETo` — pastikan disalin persis, tidak ada spasi di awal/akhir.

### Tabel sekolah kosong atau "Gagal memuat"
1. Periksa koneksi internet.
2. Refresh halaman dan login ulang.
3. Jika masih gagal, cek log edge function di:  
   `https://supabase.com/dashboard/project/xovvuuwexoweoqyltepq/functions/list-schools/logs`

### Gagal mendaftarkan sekolah

| Pesan error | Penyebab | Solusi |
|---|---|---|
| `NIP/NIK already registered` | NIP/NIK Admin IT sudah dipakai di sekolah lain | Gunakan NIP/NIK berbeda, atau cek apakah admin ini sudah pernah didaftarkan |
| `school name already exists` | Nama sekolah sudah terdaftar | Cek tabel sekolah; mungkin sudah pernah didaftarkan sebelumnya |
| `Error 500` | Masalah di sisi server | Cek log di: `https://supabase.com/dashboard/project/xovvuuwexoweoqyltepq/functions/provision-school/logs` |

---

## 8. Ganti Superadmin Key

Jika key perlu diganti (misal karena bocor atau ingin rotasi rutin), jalankan perintah ini dari folder project:

```bash
npx supabase secrets set SUPERADMIN_KEY="key-baru-anda" --project-ref xovvuuwexoweoqyltepq
```

Setelah key diganti, sesi superadmin yang sedang aktif otomatis tidak valid — harus login ulang dengan key baru.

---

## Ringkasan Cepat

| Hal | Detail |
|---|---|
| **URL Superadmin** | `https://teguhalficahlin-del.github.io/student-insight-platform/superadmin/` |
| **Superadmin Key** | `&9p*7Mpa0OkMxqzfFqbkBTG*jOM7*ETo` |
| **URL Admin Sekolah** | `https://teguhalficahlin-del.github.io/student-insight-platform/admin/` |
| **Supabase Dashboard** | `https://supabase.com/dashboard/project/xovvuuwexoweoqyltepq` |
| **Reset password user** | Supabase Dashboard → Authentication → Users |
| **Edit data sekolah** | Supabase Dashboard → Table Editor → tabel `schools` |
