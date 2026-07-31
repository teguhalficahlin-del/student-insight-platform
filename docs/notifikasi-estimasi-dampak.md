# Investigasi Tabel Notifications & Estimasi Dampak Push Absensi

> Tanggal: 2026-07-31  
> Basis: query langsung ke DB production (linked)  
> Tidak ada perubahan apapun — murni investigasi.

---

## Output Query Verbatim

### Q1 — Ukuran tabel notifications saat ini

```
┌────────────┬────────────┬───────────────────────────────┬───────────────────────────────┐
│ total_rows │ total_size │            oldest             │            newest             │
├────────────┼────────────┼───────────────────────────────┼───────────────────────────────┤
│ 347        │ 520 kB     │ 2026-07-14 08:22:37.391569+00 │ 2026-07-31 06:27:17.811624+00 │
└────────────┴────────────┴───────────────────────────────┴───────────────────────────────┘
```

### Q2 — Breakdown per tipe notifikasi

```
┌─────────────────────┬────────┬────────────────┐
│        type         │ jumlah │ jumlah_sekolah │
├─────────────────────┼────────┼────────────────┤
│ FORUM_POST_NEW      │ 173    │ 2              │
│ LOGIN_NEW_DEVICE    │ 138    │ 2              │
│ FORUM_COMMENT_NEW   │ 19     │ 2              │
│ LATE_ARRIVAL        │ 8      │ 1              │
│ EXIT_NOTIFICATION   │ 4      │ 1              │
│ PERANGKAT_AJAR      │ 2      │ 1              │
│ CASE_RESTRICTED_NEW │ 2      │ 1              │
│ CASE_STUDENT_UPDATE │ 1      │ 1              │
└─────────────────────┴────────┴────────────────┘
```

### Q3 — Jumlah user aktif SMKN 1 Ujungbatu per role

```
┌────────────────┬────────┐
│   role_type    │ jumlah │
├────────────────┼────────┤
│ SISWA          │ 1056   │
│ ORTU           │ 1053   │
│ GURU           │ 55     │
│ BK             │ 3      │
│ TU             │ 1      │
│ WAKA_KURIKULUM │ 1      │
│ WAKA_HUMAS     │ 1      │
│ WAKA_KESISWAAN │ 1      │
│ KEPSEK         │ 1      │
│ ADMINISTRATIVE │ 1      │
└────────────────┴────────┘
```

### Q4 — Kelas aktif dan rata-rata siswa

```
┌──────────────┬─────────────┬──────────────────────┐
│ jumlah_kelas │ total_siswa │ rata_siswa_per_kelas │
├──────────────┼─────────────┼──────────────────────┤
│ 32           │ 1056        │ 33.0                 │
└──────────────┴─────────────┴──────────────────────┘
```

### Q5 — Sesi mengajar per hari (30 hari terakhir, SMKN 1 Ujungbatu)

```
┌─────┬───────────┬─────────────┬──────────────┬─────────────┐
│ dow │ nama_hari │ jumlah_sesi │ jumlah_kelas │ jumlah_guru │
├─────┼───────────┼─────────────┼──────────────┼─────────────┤
│ 1   │ Monday    │ 892         │ 22           │ 46          │
│ 2   │ Tuesday   │ 1152        │ 22           │ 54          │
│ 3   │ Wednesday │ 1266        │ 22           │ 53          │
│ 4   │ Thursday  │ 1120        │ 22           │ 53          │
│ 5   │ Friday    │ 578         │ 22           │ 41          │
└─────┴───────────┴─────────────┴──────────────┴─────────────┘
```

*Catatan: 22 kelas/hari dari total 32 kelas aktif — konsisten, kemungkinan karena sebagian kelas PKL
atau jadwal bergilir. Jumlah_sesi = akumulasi 4–5 hari per nama_hari selama 30 hari.*

### Q6 — Struktur tabel notifications

```
┌───────────────────┬──────────────────────────┬─────────────┐
│    column_name    │        data_type         │ is_nullable │
├───────────────────┼──────────────────────────┼─────────────┤
│ notification_id   │ uuid                     │ NO          │
│ school_id         │ uuid                     │ NO          │
│ recipient_user_id │ uuid                     │ NO          │
│ case_id           │ uuid                     │ YES         │
│ type              │ type (text)              │ NO          │
│ title             │ text                     │ NO          │
│ body              │ text                     │ NO          │
│ is_read           │ boolean                  │ NO          │
│ created_at        │ timestamp with time zone │ NO          │
│ forum_post_id     │ uuid                     │ YES         │
│ forum_comment_id  │ uuid                     │ YES         │
│ late_arrival_id   │ uuid                     │ YES         │
└───────────────────┴──────────────────────────┴─────────────┘
```

**Tidak ada kolom `expires_at`, `deleted_at`, atau mekanisme TTL.**

### Q7 — Trigger pada tabel notifications

```
(hasil kosong — tidak ada trigger)
```

**Tidak ada trigger auto-delete, archival, atau pruning pada tabel notifications.**

---

## Analisis Data

### Volume sesi harian (dari Q5)

| Hari | Total sesi 30 hari | Perkiraan minggu | Sesi/hari |
|------|-------------------|-----------------|-----------|
| Senin | 892 | 4 | ~223 |
| Selasa | 1.152 | 5 | ~230 |
| Rabu | 1.266 | 5 | ~253 |
| Kamis | 1.120 | 5 | ~224 |
| Jumat | 578 | 5 | ~116 |
| **Rata-rata** | | | **~209 sesi/hari** |

### Laju pertumbuhan notifikasi saat ini (dari Q1)

- 347 baris dalam 17 hari (14–31 Juli 2026)
- **Laju saat ini: ~20 baris/hari**
- Dominasi: FORUM (173+19=192 = 55%) + LOGIN_NEW_DEVICE (138 = 40%)
- LATE_ARRIVAL hanya 8 rows dalam 17 hari = **~0,5 baris/hari** — ini menunjukkan absensi belum masuk ke notifikasi sama sekali

### Ukuran rata-rata per baris

- 520 kB / 347 baris = **~1,5 kB/baris** (termasuk overhead indeks)
- Data aktual per baris: ±350–400 bytes (uuid × 6 + text fields)
- Rasio indeks overhead: ~3–4× data mentah (normal untuk tabel dengan banyak FK index)

---

## Estimasi Dampak Jika Push Absensi Diaktifkan

### Asumsi

| Parameter | Nilai | Sumber |
|-----------|-------|--------|
| Total siswa aktif | 1.056 | Q3+Q4 |
| Kelas aktif per hari | 22 | Q5 |
| Rata-rata siswa per kelas | 33 | Q4 |
| Sesi mengajar per hari | ~209 | Q5 |
| Tingkat ketidakhadiran nasional SMK | ~10% | estimasi umum |
| Siswa tidak hadir per hari | ~105 siswa | 1.056 × 10% |
| Orang tua per siswa | ~1 | Q3: 1.053 ortu / 1.056 siswa |

### Skenario A — Notifikasi per hari (ringkasan harian, 1 notif/siswa/hari)

Penerima notif per siswa tidak hadir:
- Orang tua: 1
- Wali kelas kelas-nya: 1
- Guru BK (rata-rata 3 BK / 32 kelas): ~0,09 per siswa
- Total per siswa tidak hadir: ~2,1 penerima

```
Notifikasi/hari  = 105 siswa tidak hadir × 2,1 penerima
               ≈ 220 notifikasi/hari
Notifikasi/bulan = 220 × 22 hari sekolah
               ≈ 4.840 notifikasi/bulan
Pertumbuhan/bulan = 4.840 × 1,5 kB
               ≈ 7,3 MB/bulan
```

### Skenario B — Notifikasi per sesi (trigger tiap sesi, seperti model keterlambatan)

Setiap sesi: ~33 siswa × 10% alpa = ~3,3 siswa tidak hadir per sesi  
Penerima per siswa per sesi: orang tua (1) + guru yang mengajar (sudah di kelas, tidak perlu dinotif) + wali kelas (1) = ~2 penerima

```
Notifikasi/hari  = 209 sesi × 3,3 siswa alpa × 2 penerima
               ≈ 1.379 notifikasi/hari
Notifikasi/bulan = 1.379 × 22
               ≈ 30.338 notifikasi/bulan
Pertumbuhan/bulan = 30.338 × 1,5 kB
               ≈ 45,5 MB/bulan
```

### Skenario C — Notifikasi ke semua pihak (klaim dokumen internal: ortu, wali kelas, kaprodi, waka, BK, TU, kepsek, siswa)

Penerima per siswa tidak hadir: ortu(1) + wali kelas(1) + kaprodi(1) + waka kesiswaan(1) + BK(1) + TU(1) + kepsek(1) + siswa sendiri(1) = **8 penerima**

```
Notifikasi/hari  = 105 siswa × 8 penerima
               ≈ 840 notifikasi/hari
Notifikasi/bulan = 840 × 22
               ≈ 18.480 notifikasi/bulan
Pertumbuhan/bulan = 18.480 × 1,5 kB
               ≈ 27,7 MB/bulan
```

---

## Perbandingan Skenario

| Skenario | Notif/hari | Notif/bulan | Storage/bulan | Kali lipat vs sekarang |
|----------|-----------|-------------|--------------|------------------------|
| Saat ini (tanpa absensi) | ~20 | ~440 | ~0,66 MB | 1× |
| A — Ringkasan harian | ~220 | ~4.840 | ~7,3 MB | 11× |
| C — Semua pihak, sekali/hari | ~840 | ~18.480 | ~27,7 MB | 42× |
| B — Per sesi (model keterlambatan) | ~1.379 | ~30.338 | ~45,5 MB | 69× |

---

## Proyeksi Pertumbuhan Tabel

### Supabase free tier
- Database storage: **500 MB** total (semua tabel)
- Tidak ada batas jumlah baris eksplisit
- Tidak ada batas query rate untuk Postgres

### Estimasi bulan ke batas storage (hanya tabel notifications)

| Skenario | Storage/bulan | Bulan ke 500 MB |
|----------|-------------|-----------------|
| Saat ini | 0,66 MB | ~757 bulan (tidak relevan) |
| A | 7,3 MB | ~68 bulan |
| B (per sesi) | 45,5 MB | ~11 bulan |
| C (semua pihak) | 27,7 MB | ~18 bulan |

**Kesimpulan storage:** Tidak ada skenario yang melebihi batas free tier dalam waktu dekat secara storage murni, karena 500 MB masih jauh. Tapi perlu dipertimbangkan bahwa 500 MB adalah total semua tabel.

### Risiko lebih nyata: performa query

Tabel `notifications` saat ini **tidak memiliki mekanisme TTL atau archival** (Q7 kosong).  
Dengan skenario B (per sesi), tabel akan tumbuh:
- Setelah 1 tahun sekolah (~200 hari): 1.379 × 200 = **275.800 baris**
- Setelah 3 tahun: **~827.400 baris**

Query `getRecentNotifications(15)` yang dipanggil setiap menit di portal parent dan student akan membaca tabel yang semakin besar tanpa TTL. Pada skala jutaan baris tanpa partisi, latensi query akan terasa.

---

## Temuan Kritis

### 1. Tidak ada TTL / archival (risiko tinggi jangka panjang)
Tabel `notifications` tidak punya `expires_at`, trigger auto-delete, atau job archival.  
Semua notifikasi dari Juli 2026 masih ada. Dengan volume push absensi, tabel ini akan tumbuh tanpa batas.

**Rekomendasi sebelum mengaktifkan push absensi:** tambahkan mekanisme pruning (misal: hapus notifikasi `is_read = true` yang lebih dari 90 hari, via pg_cron atau Supabase Edge Function terjadwal).

### 2. Tidak ada indeks pada `is_read` atau `created_at` yang diketahui
Query `getRecentNotifications()` filter `recipient_user_id` + `ORDER BY created_at DESC` — perlu dipastikan ada indeks composite `(recipient_user_id, created_at DESC)`.

### 3. Volume LATE_ARRIVAL sangat rendah (8 baris / 17 hari)
Padahal trigger `trg_notify_late_arrival` sudah terpasang sejak migrasi Juli 22.  
Ini mengindikasikan **pencatatan keterlambatan di portal piket belum banyak digunakan** — bukan karena tidak ada siswa terlambat.

### 4. Skenario yang paling tepat untuk dikembangkan
Berdasarkan volume dan risiko, **Skenario A (ringkasan harian, sekali per siswa per hari)** adalah yang paling aman:
- Hanya ~220 notif/hari vs 1.379 (per sesi)
- Tidak membombardir wali kelas/BK dengan notif per mata pelajaran
- Cukup informatif untuk orang tua
- Mudah diimplementasi via pg_cron jam 06:00 WIB (setelah absensi pagi diinput)

---

## Ringkasan Eksekutif

| Aspek | Status |
|-------|--------|
| Tabel notifications saat ini | 347 baris, 520 kB, ~20 notif/hari |
| Mekanisme TTL/pruning | ❌ Tidak ada |
| Notifikasi absensi saat ini | ❌ Tidak ada (hanya keterlambatan) |
| Batas storage Supabase free tier | 500 MB (tidak terancam jangka pendek) |
| Risiko utama | Performa query jangka panjang tanpa TTL |
| Skenario rekomendasi | A — ringkasan harian ~220 notif/hari |
| Pra-syarat sebelum aktifkan | Implementasi TTL/pruning terlebih dahulu |
