# Definisi Fitur: Tab Forum Kelas

## 1. Gambaran Umum

Forum Kelas adalah papan komunikasi kelas yang memungkinkan guru
berbagi informasi, pengumuman, atau catatan dengan pihak yang relevan
— siswa, orang tua, BK, dan wali kelas.

Berbeda dengan Catatan Siswa yang bersifat privat (guru → siswa/ortu saja),
Forum Kelas bersifat terbuka ke pihak yang dipilih dan mendukung
komunikasi yang melibatkan banyak pihak.

Prinsip penggunaan:
- Gunakan Catatan Siswa jika informasi tidak perlu diketahui pihak lain
- Gunakan Forum Kelas jika informasi perlu diketahui BK, wali kelas,
  atau pihak lain yang relevan

Tab Forum Kelas tersedia di portal: Guru, Siswa, Orang Tua.

---

## 2. Siapa yang Bisa Membuat Posting

Hanya GURU yang bisa membuat posting baru.
Siswa dan orang tua hanya bisa membaca posting yang ditujukan kepada mereka.

RLS INSERT forum_posts (with_check aktual dari pg_policies):
  school_id = fn_current_school_id()
  AND author_user_id = fn_current_user_id()

Tidak ada filter role di RLS. Pembatasan "hanya guru yang bisa posting"
ditegakkan di level UI — portal siswa dan ortu tidak punya form buat posting,
bukan karena RLS.

---

## 3. Visibilitas Posting

Saat membuat posting, guru memilih siapa yang bisa melihat via kolom
`visibility` di tabel `forum_posts`. Nilai dan artinya:

| Nilai DB | Label di UI | Siapa yang bisa lihat |
|---|---|---|
| STAF_SAJA | Staf saja | Guru yang mengajar kelas ini + wali kelas + BK + oversight (WAKA/KEPSEK) |
| ORTU_SISWA_SUBJEK | Orang tua & siswa yang dibahas | Staf di atas + siswa subjek posting + orang tua mereka |
| ORTU_SISWA_KELAS | Semua orang tua & siswa kelas ini | Staf di atas + seluruh siswa kelas + seluruh orang tua siswa kelas |
| PUBLIK | Semua (publik) | Semua pihak yang relevan dengan kelas ini |
| ORANG_TERTENTU | Orang tertentu saja | Individu yang dipilih secara eksplisit — disimpan di tabel `forum_post_audience` |

Visibilitas tidak bisa diubah setelah posting dibuat
(dikunci oleh RLS WITH CHECK pada policy `rls_forum_posts_update`).

### Dua Dropdown Audience (Kombinasi)
Guru bisa memilih dua audience sekaligus via dua dropdown:

- **Dropdown 1** (wajib): audience utama
- **Dropdown 2** (opsional): audience tambahan — hasil digabung (union)

Contoh kombinasi:
| Dropdown 1 | Dropdown 2 | Hasil |
|---|---|---|
| Staf saja | Orang tua & siswa yang dibahas | Staf + ortu + siswa subjek |
| Staf saja | (kosong) | Hanya staf |
| Orang tua & siswa yang dibahas | Staf saja | Sama dengan baris pertama |

Kedua nilai disimpan di kolom `audience_type` dan `audience_type_2`
di tabel `forum_posts`.

### Kapan Menggunakan ORANG_TERTENTU
Gunakan ORANG_TERTENTU ketika tidak ada pilihan visibility lain yang tepat:

| Skenario | Mengapa perlu ORANG_TERTENTU |
|---|---|
| Hanya BK tertentu yang perlu tahu | STAF_SAJA mencakup semua staf kelas |
| Orang tua siswa tahu, tapi siswa tidak | ORTU_SISWA_SUBJEK selalu menyertakan siswa |
| Kombinasi staf tertentu + ortu tertentu | Tidak ada visibility tunggal yang cover ini |
| Hanya Waka atau Kaprodi tanpa staf lain | STAF_SAJA mencakup semua staf kelas |

Untuk skenario lain, gunakan visibility yang lebih tepat:
- Semua staf kelas → STAF_SAJA
- Siswa yang dibahas + orang tuanya → ORTU_SISWA_SUBJEK
- Seluruh kelas (siswa + ortu) → ORTU_SISWA_KELAS
- Semua pihak → PUBLIK

### Siapa yang Bisa Dipilih di ORANG_TERTENTU
- Staf internal yang bertugas di kelas (guru, BK, wali kelas, kaprodi, waka, kepsek)
- Orang tua siswa aktif di kelas
- Siswa tidak bisa dipilih secara individual — untuk menyertakan siswa
  gunakan ORTU_SISWA_SUBJEK atau ORTU_SISWA_KELAS
- Untuk mencari orang tua siswa tertentu, ketik nama siswa —
  sistem menampilkan orang tua dengan label 'Orang tua dari: Nama Siswa'
- DUDI dan STAKEHOLDER tidak muncul di picker — hanya staf internal
  dan orang tua siswa aktif di kelas yang bisa dipilih

---

## 4. Forum Per Kelas

Setiap kelas punya forum tersendiri — tidak digabung antar kelas.
Guru yang mengajar di beberapa kelas bisa beralih antar forum
via filter kelas di UI.

Filter aktif saat query: `class_id + academic_year`.

---

## 5. Edit dan Tarik Posting

### Edit Posting
Guru bisa mengedit isi posting miliknya setelah disimpan,
selama belum ada komentar.

Kolom yang bisa diedit: `body`, `title`, `is_pinned`, `category_id`, `updated_at`.
Kolom yang tidak bisa diubah setelah posting dibuat (dikunci RLS WITH CHECK):
`class_id`, `visibility`, `academic_year`, `school_id`, `author_user_id`.

### Tarik Posting
Guru bisa menarik kembali posting miliknya (`is_withdrawn = true`).

Posting yang ditarik:
- Tetap ada di DB (soft delete via flag boolean)
- Tampil di feed dengan teks [Posting ini telah ditarik] dan opacity 60%
- Tidak bisa dipulihkan dari UI
- Masih bisa dilihat oleh author dan admin (KEPSEK/WAKA_KESISWAAN)
  — dikontrol oleh `fn_can_read_forum_post`

Hanya author posting yang bisa menarik — dikunci oleh RLS UPDATE
(`author_user_id = fn_current_user_id()`).

---

## 6. Komentar

### Siapa yang Bisa Berkomentar
Komentar dibatasi via RLS allowlist — hanya role berikut yang bisa berkomentar:
- Staf internal: GURU, BK, WALI_KELAS, KAPRODI, KEPSEK, ADMINISTRATIVE,
  WAKA_KURIKULUM, WAKA_KESISWAAN, WAKA_HUMAS
- Orang Tua (ORTU)

Yang tidak bisa berkomentar:
- SISWA — hanya bisa membaca
- DUDI — tidak terlibat di forum kelas internal
- STAKEHOLDER — pihak eksternal, tidak punya akses forum

Ditegakkan di level RLS (bukan hanya UI):
school_id + author_user_id + fn_can_read_forum_post(post_id)
+ fn_current_user_role() = ANY([10 role di atas])

### Edit Komentar
Policy UPDATE ada di DB (rls_forum_comments_update) tapi tidak ada
tombol edit komentar di UI manapun (guru, siswa, ortu).
Dicatat sebagai backlog — belum diimplementasi.

### Hapus Komentar
Komentar bisa dihapus oleh:
- Author komentar sendiri
- KEPSEK dan WAKA_KESISWAAN

Hapus komentar bersifat hard delete (permanen) — berbeda dengan
posting yang menggunakan soft delete (is_withdrawn).

---

## 7. Isolasi Akses (via `fn_can_read_forum_post`)

| Aktor | Akses |
|---|---|
| GURU (author) | Buat + edit + tarik posting milik sendiri; baca semua posting di kelasnya |
| GURU (wali kelas) | Baca semua posting di kelas yang ia jadi wali |
| GURU (mapel) | Baca semua posting di kelas yang ia ajar |
| GURU (BK) | Baca posting yang punya setidaknya satu subjek siswa di kelasnya |
| GURU (guru wali) | Baca posting yang subjeknya adalah siswa tanggungannya |
| KAPRODI | Baca semua posting di kelas program yang ia kelola |
| WAKA / KEPSEK | Baca semua posting di semua kelas (termasuk posting yang ditarik) |
| SISWA | Baca posting yang ada di `forum_post_audience` untuk dirinya |
| ORTU | Baca posting dengan visibility `PARENT_VISIBLE` untuk anak mereka yang aktif di kelas |
| Antar sekolah | Tidak ada akses silang — semua query filter `school_id = fn_current_school_id()` |
| Posting ditarik | Masih tampil sebagai placeholder [Posting ini telah ditarik] — hanya author dan admin yang bisa lihat isi |
| Komentar ditarik | Dihapus permanen — tidak tampil sama sekali |

---

## 8. Fungsi dan Tabel Database

| Fungsi / Tabel | Kegunaan |
|---|---|
| `fn_create_forum_post` | RPC atomic — buat posting + insert audience members |
| `fn_can_read_forum_post(post_id)` | Cek apakah user bisa baca posting tertentu (9 cabang role) |
| `fn_get_forum_member_details` | Ambil daftar anggota kelas untuk picker "orang tertentu" |
| `forum_posts` | Tabel utama posting (13 kolom termasuk `visibility`, `is_withdrawn`) |
| `forum_post_audience` | Penerima spesifik untuk visibility `ORANG_TERTENTU` |
| `forum_post_subjects` | Siswa yang menjadi subjek posting (opsional) |
| `forum_post_comments` | Komentar pada posting (hard delete saat ditarik) |
| `forum_post_acknowledgements` | Rekaman "sudah baca" per user per posting |

---

## 9. Catatan Teknis

- Forum bersifat flat — tidak ada thread/reply bertingkat
- Posting diurutkan: `is_pinned DESC, created_at DESC`
- Pagination: 20 posting per halaman, tombol "Muat lebih banyak"
- RLS UPDATE `with_check` mengunci `class_id`, `visibility`, `academic_year`
  setelah posting dibuat — hanya `body`, `title`, `is_pinned`, `category_id`
  yang bisa diedit oleh author
- `withdrawForumComment` pakai hard `DELETE` — berbeda dengan posting
  yang pakai soft delete via `is_withdrawn = true`
- Tabel `forum_post_audience` mengelola penerima untuk `ORANG_TERTENTU`
  dan juga dipakai oleh siswa sebagai gate akses (cabang 9 di `fn_can_read_forum_post`)
- `skipAudienceFilter` di client (dashboard.js) hanya mempengaruhi query JOIN —
  RLS `fn_can_read_forum_post` tetap menjadi penjaga akhir di sisi database

---

*Dokumen ini adalah referensi definitif.
Setiap perubahan perilaku fitur harus diupdate di sini sebelum diimplementasi.*
