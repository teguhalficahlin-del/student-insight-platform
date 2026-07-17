# Definisi Fitur: Tab Catatan Siswa (Observasi)

## 1. Gambaran Umum

Tab Catatan Siswa adalah fitur untuk guru mencatat observasi perkembangan
siswa secara kualitatif. Berbeda dengan kasus pembinaan yang punya alur
eskalasi formal, catatan siswa adalah catatan harian yang bersifat
informatif — tidak ada eskalasi atau perubahan status.

Tab ini hanya tersedia untuk role GURU.

---

## 2. Form Tulis Catatan

Field yang tersedia:

| Field | Keterangan |
|---|---|
| Siswa | Autocomplete dari daftar siswa yang diajar guru (min. 2 karakter). Scope sama dengan tab Pembinaan Siswa — lihat docs/features/pembinaan-siswa.md §9. Ditegakkan juga di RLS: fn_guru_teaches_student(student_id). |

Scope pencarian siswa sama dengan tab Pembinaan Siswa —
lihat docs/features/pembinaan-siswa.md §9 untuk detail per role.
Guru biasa hanya bisa mencatat untuk siswa yang diajarnya
(ditegakkan juga di level RLS: fn_guru_teaches_student).

| Dimensi | Kategori observasi — 8 pilihan |
| Sentimen | Penilaian umum — 3 pilihan |
| Visibilitas | Siapa yang bisa membaca catatan ini |
| Catatan | Teks bebas, maksimal 1000 karakter |

### Dimensi Observasi (8 pilihan)
| Kode | Label |
|---|---|
| AKADEMIK | Akademik |
| KEHADIRAN | Kehadiran |
| PERILAKU | Perilaku |
| SOSIAL | Sosial |
| AFEKTIF | Afektif |
| BAKAT_MINAT | Bakat & Minat |
| FISIK | Fisik |
| LAINNYA | Lainnya |

### Sentimen (3 pilihan)
| Kode | Label | Warna |
|---|---|---|
| POSITIF | Positif | Hijau |
| NETRAL | Netral | Abu-abu |
| NEGATIF | Perlu Perhatian | Merah |

### Visibilitas (3 pilihan)
| Kode | Label | Siapa yang bisa baca |
|---|---|---|
| SISWA_DAN_ORTU | 👨‍👩‍👦 Siswa & Orang Tua | Siswa dan orang tua siswa |
| SISWA_SAJA | 🎓 Siswa saja | Hanya siswa |
| ORTU_SAJA | 👨‍👩‍👧 Orang Tua saja | Hanya orang tua siswa |

---

## 3. Mekanisme Simpan (Offline-First)

Catatan disimpan via mekanisme offline-first:
1. Jika online → langsung kirim ke server via `submitObservation` (RPC)
2. Jika offline → disimpan ke IndexedDB, dikirim ke server saat koneksi kembali

Status hasil: `synced` (berhasil online) atau `queued` (antri offline).

---

## 4. Riwayat Catatan Saya

Menampilkan semua catatan yang pernah ditulis guru yang sedang login.
Maksimal 100 catatan terbaru (`limit(100)`).

Setiap baris menampilkan:
- Nama siswa
- Dimensi, sentimen (dengan warna), visibilitas
- Isi catatan
- Tanggal observasi

### Catatan yang Disembunyikan (is_void)
Jika admin memvoid catatan, baris tetap tampil di riwayat guru
dengan tampilan redup (opacity 0.55) dan label:
"⊘ Disembunyikan oleh admin" + alasan void jika ada.

Guru tidak bisa menghapus atau memvoid catatan sendiri —
hanya ADMINISTRATIVE yang bisa memvoid.

---

## 5. Isolasi Akses

| Role | Akses |
|---|---|
| GURU pembuat | Tulis dan baca catatan milik sendiri saja |
| SISWA | Baca catatan milik sendiri, visibility SISWA_SAJA atau SISWA_DAN_ORTU, is_void = false |
| ORTU | Baca catatan milik anak, visibility ORTU_SAJA atau SISWA_DAN_ORTU, is_void = false |
| ADMINISTRATIVE | Hanya bisa memvoid catatan (UPDATE is_void) — tidak bisa baca isi |
| Staf lain (BK, Waka, Kepsek, dll) | Tidak ada akses apapun |
| Antar sekolah | Tidak ada akses silang (RLS school_id) |

Catatan observasi adalah milik guru pembuat — staf lain termasuk BK,
Waka, Kaprodi, dan Kepsek tidak bisa membaca catatan guru lain.
Ini berbeda dengan tab Pembinaan Siswa (kasus) yang memungkinkan
koordinasi antar staf.

### Batasan Insert
Guru hanya bisa membuat catatan untuk siswa yang diajarnya
(`fn_guru_teaches_student(student_id)`). Tidak bisa membuat catatan
atas nama guru lain (`author_user_id = fn_current_user_id()`).

---

## 6. Perbedaan dengan Tab Pembinaan Siswa (Kasus)

| Aspek | Catatan Siswa | Pembinaan Siswa |
|---|---|---|
| Tujuan | Catatan informatif harian | Penanganan masalah formal |
| Eskalasi | Tidak ada | Ada — antar role |
| Status | Tidak ada | OPEN→DITINJAU→INTERVENSI→MONITORING→CLOSED |
| Visibilitas | Siswa/Ortu bisa baca | Hanya staf internal |
| Hapus | Tidak bisa (hanya admin void) | Tidak bisa |
| Offline | ✅ IndexedDB | ✅ IndexedDB |

---

## 7. Tidak Ada Fitur Hapus

Catatan tidak bisa dihapus oleh guru — hanya admin yang bisa memvoid.
Ini menjaga integritas riwayat observasi siswa.

---

## 8. Fungsi yang Dipanggil

| Fungsi | Kegunaan |
|---|---|
| `initObsTab()` | Init tab — panggil initObsForm + loadObsHistory |
| `initObsForm()` | Setup form — autocomplete siswa, bind submit |
| `insertObservation()` | Buat observasi baru via saveObservation |
| `saveObservation()` | Online-first save — RPC atau IndexedDB queue |
| `loadObsHistory()` | Load riwayat catatan guru yang login |
| `getMyObservations()` | API: ambil observasi milik guru (max 100) |
| `renderObsHistory()` | Render daftar catatan di UI |

---

---

## Catatan Perubahan

Fitur Catat Prestasi dihapus pada Juli 2026 — tabel, RLS, API, dan UI dihapus
sepenuhnya. Tidak ada data yang hilang karena fitur belum pernah dipakai.

---

*Dokumen ini adalah referensi definitif.
Setiap perubahan perilaku fitur harus diupdate di sini sebelum diimplementasi.*
