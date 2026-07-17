# Pembinaan Siswa — Tab Kasus

Tab untuk mencatat, memantau, dan mengeskalasi kasus pembinaan siswa.
Nama internal: `kasus`. Tersedia untuk semua role kecuali ADMINISTRATIVE
(ADMINISTRATIVE bisa melihat tapi tidak bisa membuat kasus).

---

## 1. Daftar Kasus

### Filter
- **Status**: Semua / Buka / Ditinjau / Intervensi / Monitoring / Tutup
- **Jalur**: Semua / Sekolah / PKL
- Filter langsung memuat ulang daftar tanpa klik tombol

### Tampilan Baris
Tiap kasus menampilkan: judul · badge status · nama siswa · jalur ·
handler saat ini · tanggal dibuat

### Paginasi
Tombol **Muat lebih…** di bawah daftar jika ada kasus tambahan.
Data lama tidak dihapus — kasus baru ditambahkan ke bawah.

---

## 2. Membuat Kasus Baru

Tombol **+ Buat Kasus** membuka modal. Tidak tersedia jika:
- Role ADMINISTRATIVE
- Tidak ada koneksi internet (tombol disabled + banner peringatan)

### Form
- **Siswa**: autocomplete (min. 2 karakter) — scope tergantung role (lihat §8)
- **Jalur Penanganan**: Sekolah atau PKL
  - Kaprodi: bisa pilih
  - DUDI: selalu PKL (field disembunyikan)
  - Semua lain: selalu Sekolah (field disembunyikan)
- **Audience**: Privat / Orang Tertentu / Semua Internal
- **Judul**: min. 5 karakter
- **Deskripsi**: min. 20 karakter

---

## 3. Detail Kasus

Klik baris kasus → beralih ke tampilan detail (list-view disembunyikan).
Tombol **← Kembali ke Daftar** kembali ke list-view.

### Header Kasus
Menampilkan: judul · badge status · nama siswa · jalur · dibuka oleh ·
handler saat ini · ikon 🔒 jika terkunci

---

## 4. Status Kasus

| Status | Label |
|---|---|
| OPEN | Buka |
| UNDER_REVIEW | Ditinjau |
| INTERVENTION | Intervensi |
| MONITORING | Monitoring |
| CLOSED | Tutup |

### Transisi Status (one-way)
```
OPEN → DITINJAU → INTERVENSI → MONITORING → (hanya CLOSE)
```

Status tidak bisa mundur. MONITORING adalah status terminal sebelum ditutup —
tidak ada pilihan ubah status, hanya bisa CLOSE.

| Dari | Bisa ke |
|---|---|
| Buka | Ditinjau, Intervensi, Monitoring |
| Ditinjau | Intervensi, Monitoring |
| Intervensi | Monitoring |
| Monitoring | — (hanya bisa ditutup) |

---

## 5. Audience (Visibilitas Kasus)

| Nilai | Label | Siapa yang bisa lihat |
|---|---|---|
| PRIVATE | 🔒 Privat | Pembuat kasus dan handler aktif saja |
| RESTRICTED | 👥 Orang Tertentu | Pembuat, handler, dan individu yang ditambahkan secara eksplisit |
| PUBLIC | 🌐 Semua Internal | Semua staf internal sekolah |

Audience dapat diubah setelah kasus dibuat.
Hanya role internal (GURU, BK, WALI_KELAS, KAPRODI, WAKA_KESISWAAN, KEPSEK)
yang bisa mengelola audience. DUDI tidak bisa mengubah audience.

---

## 6. Eskalasi

### Rantai Referensi
Jalur Sekolah: GURU → BK → WALI_KELAS → KAPRODI → WAKA_KESISWAAN → KEPSEK

Jalur PKL: DUDI → KAPRODI → WAKA_KESISWAAN → KEPSEK

Catatan penting:
- Eskalasi bebas ke peran internal mana pun — rantai di atas adalah
  panduan, bukan batasan keras
- UI memberi peringatan jika eskalasi ke role yang lebih rendah,
  tapi tidak diblokir
- DUDI hanya bisa eskalasi ke KAPRODI
- Setelah dieskalasi, role yang menerima menjadi handler baru

---

## 7. Tindakan dalam Kasus

Panel tindakan tersembunyi jika kasus sudah CLOSED.

| Tindakan | Siapa |
|---|---|
| Tambah komentar | Semua yang punya akses lihat kasus |
| Eskalasi ke role lain | Handler aktif + role internal |
| Kelola audience | Role internal (bukan DUDI) |
| Ubah status | Handler aktif + Kepsek + BK + Waka Kesiswaan |
| Tutup kasus | Handler aktif + Kepsek |

---

## 8. Timeline Kasus

Setiap tindakan tercatat sebagai event di timeline kasus:

| Event | Keterangan |
|---|---|
| COMMENT_ADDED | Komentar baru ditambahkan |
| STATUS_CHANGED | Status kasus berubah |
| DECISION_ESCALATE | Kasus dieskalasi ke role lain |
| DECISION_CLOSE | Kasus ditutup |
| FINAL_DECISION_MADE | Keputusan akhir dibuat |

---

## 9. Pencarian Siswa

Scope pencarian siswa saat membuat kasus berbeda per role:

| Role | Scope Pencarian |
|---|---|
| BK, Waka Kesiswaan, Kepsek | Seluruh siswa aktif di sekolah |
| Guru, Wali Kelas, Kaprodi | Hanya siswa yang diajar/diwalikan/di program |
| DUDI | Hanya siswa yang sedang PKL di DUDI tersebut |

Autocomplete aktif setelah minimal 2 karakter diketik.
Pencarian lokal diprioritaskan; fallback ke server jika tidak ditemukan.

---

## 10. Isolasi Akses

| Aspek | Aturan |
|---|---|
| Visibilitas kasus | Bergantung audience (PRIVATE/RESTRICTED/PUBLIC) |
| Antar sekolah | Tidak ada akses silang (RLS school_id) |
| ADMINISTRATIVE | Tidak bisa membuat kasus |
| DUDI | Hanya bisa buat kasus PKL, hanya bisa eskalasi ke KAPRODI |
| Kasus CLOSED | Panel tindakan disembunyikan — tidak ada aksi yang bisa dilakukan |

---

## 11. Fitur Offline

- Tombol **Buat Kasus** dinonaktifkan saat tidak ada koneksi internet
- Banner peringatan offline ditampilkan di atas daftar kasus
- Membaca daftar kasus dan detail kasus yang sudah dimuat tetap bisa
  dilakukan dari cache (tergantung implementasi cache per portal)

---

## 12. Fungsi yang Dipanggil

| Fungsi | Kegunaan |
|---|---|
| `initKasusTab()` | Init tab — guard, preload siswa, bind form dan filter |
| `loadKasusList()` | Load daftar kasus dengan filter status + jalur + paginasi |
| `openKasusDetail()` | Buka detail kasus — fetch kasus + events secara paralel |
| `renderKasusDetail()` | Render header kasus |
| `renderKasusEvents()` | Render timeline events |
| `renderKasusActions()` | Render panel tindakan (tersembunyi jika CLOSED) |
| `createCase()` | API: buat kasus baru |
| `getCase()` | API: ambil detail satu kasus |
| `getCaseEvents()` | API: ambil timeline events kasus |

---

*Dokumen ini adalah referensi definitif.
Setiap perubahan perilaku fitur harus diupdate di sini sebelum diimplementasi.*
