# Inventarisir Fitur Per Tab — Portal Guru

> Tanggal: 2026-07-31  
> Sumber: `guru/dashboard.html`, `guru/js/dashboard.js`, `guru/js/api.js`  
> Murni baca kode — tidak ada perubahan.

**Legenda:**  
✅ Sudah berfungsi — ada kode lengkap + fungsi API terhubung  
🚧 Ada tapi belum sempurna — UI ada, fungsi ada, tapi ada gap/bug diketahui  
📋 Direncanakan tapi belum ada kodenya — tercatat di CLAUDE.md atau schema-ready tapi UI/logic kosong

---

## Tab 1 — Catatan Siswa (`case 'observasi'` → `initObsTab()`)

Nama internal: `observasi`. Tersedia untuk semua role dengan jabatan guru (bukan peran struktural saja).

### Fitur

| # | Fitur | Status | Bukti Kode |
|---|-------|--------|------------|
| 1 | **Form tulis catatan siswa** | ✅ | `initObsForm()` dashboard.js:1072 — field: pilih siswa, dimensi, sentimen, visibilitas, isi, char counter |
| 2 | **Pencarian siswa live** | ✅ | Filter lokal `myStudents` mulai 2 karakter (nama/NIS), dashboard.js:1103 |
| 3 | **Dimensi catatan** | ✅ | 8 pilihan: AKADEMIK, KEHADIRAN, PERILAKU, SOSIAL, AFEKTIF, BAKAT_MINAT, FISIK, LAINNYA |
| 4 | **Sentimen** | ✅ | POSITIF / NETRAL / NEGATIF (Perlu Perhatian) |
| 5 | **Visibilitas catatan** | ✅ | 3 opsi: Siswa saja / Orang tua saja / Siswa & Orang Tua — dashboard.js:1228 |
| 6 | **Simpan offline (queue)** | ✅ | `insertObservation()` api.js:303 — jika offline, antre di localStorage, flush saat online |
| 7 | **Riwayat catatan yang saya tulis** | ✅ | `loadObsHistory()` → `getMyObservations()` api.js:780, tampil dengan badge dimensi+sentimen+visibilitas |
| 8 | **Badge "Disembunyikan admin"** | ✅ | `is_void` flag ditampilkan dengan alasan `void_reason` — dashboard.js:1209 |
| 9 | **Edit / hapus catatan** | 📋 | Tidak ada tombol Edit/Hapus di render catatan (`renderObsHistory`). Hanya tampil read-only |
| 10 | **Filter catatan berdasarkan siswa/dimensi** | 📋 | Tidak ada filter di UI riwayat |

---

## Tab 2 — Pembinaan Siswa (`case 'kasus'` → `initKasusTab()`)

Nama internal: `kasus`. Tersedia untuk GURU, BK, WALI_KELAS, KAPRODI, WAKA_KESISWAAN, KEPSEK.

### Fitur

| # | Fitur | Status | Bukti Kode |
|---|-------|--------|------------|
| 1 | **Buat kasus baru** | ✅ | `createCase()` api.js:901 — field: siswa, judul, deskripsi, jalur (SEKOLAH/PKL). Default audience PRIVATE |
| 2 | **Pencarian siswa** | ✅ | Lokal + remote (isBroadObserver: BK/waka/kepsek bisa cari lintas sekolah) — dashboard.js:3080 |
| 3 | **Filter kasus (status + jalur)** | ✅ | Filter status (semua/aktif/proses/banding/tutup) + jalur (semua/sekolah/PKL) — dashboard.js:3063 |
| 4 | **Daftar kasus dengan pagination** | ✅ | `loadKasusList()` + muat lebih, 50 kasus per halaman — dashboard.js:3164 |
| 5 | **Detail kasus** | ✅ | `openKasusDetail()` → tampil judul, siswa, status, handler, apakah terkunci — dashboard.js:3229 |
| 6 | **Timeline event** | ✅ | `getCaseEvents()` api.js:885 — tampil semua event (komentar, eskalasi, status, audience) kronologis |
| 7 | **Kirim komentar** | ✅ | `addCaseComment()` api.js — dari panel actions kasus detail |
| 8 | **Eskalasi bebas** | ✅ | Semua internal bisa teruskan ke peran mana pun (bukan hanya linear ke atas). Peringatan jika meneruskan ke bawah — dashboard.js:3316 |
| 9 | **Ubah status kasus** | ✅ | `changeCaseStatus()` — transisi STATUS_AFTER_CURRENT sesuai status saat ini — dashboard.js:3345 |
| 10 | **Tutup kasus** | ✅ | Dua-klik konfirmasi (6 detik timeout). Kepsek/BK/handler bisa tutup — dashboard.js:3362 |
| 11 | **Kelola audiens (PRIVATE/RESTRICTED/PUBLIC)** | ✅ | Toggle 3 level, real-time — dashboard.js:3366 |
| 12 | **Tambah/hapus anggota audiens (mode RESTRICTED)** | ✅ | Search internal user + add/remove chip. Toggle siswa & orang tua terkait via checkbox — dashboard.js:3522 |
| 13 | **Guard offline** | ✅ | Tombol "Buat Kasus" disabled + banner saat offline — dashboard.js:3025 |
| 14 | **Buat kasus saat offline (queue)** | ✅ | `createCase()` api.js:901 — fallback ke localStorage jika offline |
| 15 | **KEPSEK lihat kasus PRIVATE/RESTRICTED** | 📋 | Bug fungsional diketahui — tercatat CLAUDE.md §9. `fn_can_see_case()` belum punya cabang KEPSEK untuk kasus PRIVATE/RESTRICTED. KEPSEK hanya bisa lihat PUBLIC. |

---

## Tab 3 — Jurnal Mengajar (`case 'jurnal'` → `initJurnalTab()`)

Nama internal: `jurnal`. Tab ini punya dua sub-tab: **Catatan** dan **Penilaian**.

### Sub-tab A: Catatan Mengajar

| # | Fitur | Status | Bukti Kode |
|---|-------|--------|------------|
| 1 | **Tulis catatan mengajar** | ✅ | Form textarea + submit — `insertJournalEntry()` api.js:748 |
| 2 | **Tanggal otomatis hari ini** | ✅ | Default `localDateStr()`. Toggle tombol "Ubah Tanggal" untuk pilih tanggal lain — dashboard.js:4160 |
| 3 | **Simpan offline (queue)** | ✅ | Antre di localStorage jika offline, render optimis langsung — dashboard.js:4185 |
| 4 | **Daftar riwayat catatan** | ✅ | `getJournalEntries()` api.js:732 — tampil per tanggal, cache lokal |
| 5 | **Edit catatan** | ✅ | `updateJournalEntry()` api.js:768 — inline edit textarea per card — dashboard.js:4249 |
| 6 | **Hapus catatan** | ✅ | `deleteJournalEntry()` api.js:760 — dua-langkah konfirmasi (Hapus → Ya Hapus/Batal) — dashboard.js:4232 |
| 7 | **Guard hapus offline** | ✅ | Hapus diblokir saat tidak ada koneksi — dashboard.js:4238 |

### Sub-tab B: Penilaian (`initPenilaianTab()`)

Sub-sub-tab: **Setup**, **Input Nilai**, **Hasil**.

#### Setup

| # | Fitur | Status | Bukti Kode |
|---|-------|--------|------------|
| 1 | **Pilih konteks (kelas + mapel + tahun + semester)** | ✅ | Dropdown dari `teaching_assignments` — dashboard.js:7859 |
| 2 | **Tambah / Edit Tujuan Pembelajaran (TP)** | ✅ | Form: kode TP, deskripsi, urutan, berlaku untuk (semua/kelas tertentu), KKTP rows — dashboard.js:8290 |
| 3 | **KKTP (Kriteria Ketercapaian)** | ✅ | Baris dinamis: batas bawah, batas atas, predikat, keterangan — `saveKktpRows()` |
| 4 | **Link TP ke elemen CP Kurikulum Merdeka** | ✅ | Panel CP auto-muat dari `getCpForSubject()` — dropdown elemen CP — dashboard.js:8329 |
| 5 | **Upload CP & TP via Excel** | ✅ | `parseCpTpExcel()` — template bisa diunduh — dashboard.js:7931 |
| 6 | **Download template Excel CP/TP** | ✅ | `downloadCpTpTemplate()` — dashboard.js:8511 |
| 7 | **Hapus TP** | ✅ | `deleteTp()` — warn + download backup Excel nilai sebelum hapus jika ada data — dashboard.js:8464 |
| 8 | **Pengaturan bobot penilaian (Grading Settings)** | ✅ | Formatif on/off, metode (rata-rata/bobot), bobot sumatif vs formatif — `saveGradingSettings()` |

#### Input Nilai

| # | Fitur | Status | Bukti Kode |
|---|-------|--------|------------|
| 1 | **Grid input nilai per siswa per TP** | ✅ | `initPenilaianInputTab()` — tabel siswa × TP, field angka 0–100 — dashboard.js:8870 |
| 2 | **Input nilai sumatif dan formatif** | ✅ | Kolom terpisah sesuai `grading_settings.formatif_included` |
| 3 | **Simpan nilai** | ✅ | `saveInputNilai()` — upsert ke tabel `student_scores` |
| 4 | **Export nilai ke Excel** | 📋 | Tombol download template ada, tetapi download nilai yang sudah diisi belum ada — hanya download template kosong |

#### Hasil Nilai

| # | Fitur | Status | Bukti Kode |
|---|-------|--------|------------|
| 1 | **Hitung nilai akhir** | ✅ | `hitungNilaiAkhir()` → RPC `fn_calculate_grade_summary` — dashboard.js:9230 |
| 2 | **Tampil grid hasil (nilai akhir + predikat)** | ✅ | `renderHasilGrid()` — tabel: nama, nilai akhir, predikat, deskripsi naratif, status publikasi — dashboard.js:9164 |
| 3 | **Edit deskripsi naratif per siswa** | ✅ | Textarea inline per baris → `simpanNaratif()` → update `grade_summaries` — dashboard.js:9197 |
| 4 | **Publikasi nilai ke siswa & orang tua** | ✅ | `publikasiNilai()` → update `published_at` + lock `grading_settings` — dashboard.js:9266 |
| 5 | **Download nilai akhir ke Excel/PDF** | 📋 | Tidak ada tombol ekspor hasil akhir. Siswa/ortu hanya bisa lihat via portal masing-masing setelah dipublikasi |

---

## Tab 4 — Perangkat Ajar (`case 'perangkat_ajar'` → `initPerangkatAjarTab()`)

Nama internal: `perangkat_ajar`. Tersedia untuk semua guru.

### Fitur

| # | Fitur | Status | Bukti Kode |
|---|-------|--------|------------|
| 1 | **Dashboard dokumen per mapel+fase** | ✅ | `loadPerangkatAjarDashboard()` — group by `core_subject_id + phase_id`, progress bar, daftar 7 tipe dokumen — dashboard.js:5966 |
| 2 | **Progress bar per mapel** | ✅ | Skor: ATP=20%, ProTa=10%, ProSem1=10%, ProSem2=10%, PPM=50%. Warna merah/kuning/hijau — dashboard.js:6021 |
| 3 | **Profil Mengajar** | ✅ | `openProfilMengajarModal()` — isi filosofi, metode, kondisi kelas, cara penilaian, dll. Dipakai AI prompt — dashboard.js:6812 |
| 4 | **Konteks Kelas** | ✅ | `openKonteksKelasModal()` — isi kondisi sarana, DUDI, narasumber, dll. — dashboard.js:6995 |
| 5 | **Generate ATP (AI)** | ✅ | `openConfirmGenerateModal()` → `fn_generate_atp` (Edge Function) — preview profil + konteks sebelum generate — dashboard.js:7139 |
| 6 | **Generate Program Tahunan (ProTa) dari ATP** | ✅ | `generateProta()` → RPC backend — tombol muncul jika ATP ada tapi ProTa belum ada — dashboard.js:7548 |
| 7 | **Upload ATP (PDF/DOCX)** | ✅ | `uploadATPFlow()` — upload ke Supabase Storage, pilih mapel+fase — dashboard.js:7754 |
| 8 | **Buat dokumen manual (tanpa AI)** | ✅ | `openBuatDokumenModal()` — pilih tipe (ProTa/ProSem/PPM/LKPD/Soal/Rubrik), cek prasyarat, simpan ke `teacher_documents` — dashboard.js:6126 |
| 9 | **Pemeriksaan prasyarat dokumen** | ✅ | Warning muncul jika ProTa belum ada saat buat ProSem, dst. — dashboard.js:6143 |
| 10 | **Detail dokumen** | ✅ | `openDetailDokumenModal()` — tampil status, info, update status (DRAFT→DIREVIEW), link ke generate ulang — dashboard.js:6287 |
| 11 | **Update status dokumen** | ✅ | `updateDocumentStatus()` api.js — guru update dari DRAFT → DIREVIEW_GURU — dashboard.js:6390 |
| 12 | **Review dan sahkan dokumen (Waka Kurikulum)** | ✅ | `wakaApproveDoc()` → RPC `fn_waka_approve_doc` — panel approval khusus waka — dashboard.js:6540 |
| 13 | **Hapus dokumen** | ✅ | `deleteTeacherDocument()` api.js — dari panel detail — dashboard.js:6612 |
| 14 | **Generate Program Semester (ProSem)** | 📋 | Tipe PROGRAM_SEMESTER ada di `openBuatDokumenModal()` (manual), tapi tidak ada tombol "Generate ProSem (AI)" — harus buat manual atau tunggu fitur |
| 15 | **Generate PPM (AI)** | 📋 | Tipe PPM ada di modal buat dokumen manual. Tidak ada alur generate AI untuk PPM — tercatat CLAUDE.md §9 backlog "Generate Promes, PPM, LKPD, Soal, Rubrik" |
| 16 | **Generate LKPD (AI)** | 📋 | Sama seperti PPM — belum ada alur AI |
| 17 | **Generate Soal (AI)** | 📋 | Belum ada alur AI |
| 18 | **Generate Rubrik (AI)** | 📋 | Belum ada alur AI |
| 19 | **Download dokumen sebagai .docx** | 📋 | Tercatat CLAUDE.md §9: "Download .docx dari `content_json` hasil generate". Belum ada kode download docx dari content_json — hanya bisa download file yang di-upload (PDF/DOCX asli) |
| 20 | **Filter mapel picker untuk Waka Kurikulum Generate ATP** | 📋 | Tercatat CLAUDE.md §9: "Filter mapel picker Generate ATP guru Waka Kurikulum". Saat ini picker tidak memfilter berdasarkan konteks Waka |
| 21 | **Regenerate limits (counter per tahun ajaran)** | 📋 | Tercatat CLAUDE.md §9 backlog jauh. Schema-ready (`generation_jobs`) tapi UI belum punya counter/quota |

---

## Tab 5 — Forum (`case 'forum'` → `initForumTab()`)

Nama internal: `forum`. Tersedia untuk semua portal (guru, student, parent, TU, admin).

### Fitur

| # | Fitur | Status | Bukti Kode |
|---|-------|--------|------------|
| 1 | **Inbox posting masuk** | ✅ | Sub-tab "Masuk" → `getForumSekolahPosts()` — posting yang dikirim ke saya — dashboard.js:4467 |
| 2 | **Tab posting terkirim** | ✅ | Sub-tab "Terkirim" → `getForumSekolahSentPosts()` — dashboard.js:4471 |
| 3 | **Buat posting baru** | ✅ | Modal dengan judul, isi, panel penerima, lampiran PDF/Word — dashboard.js:4490 |
| 4 | **Panel penerima dua-level (grup + individu)** | ✅ | Tombol grup (Semua Waka, Semua Guru, Siswa per kelas, dll.) → drill-down individu via picker — dashboard.js:4546 |
| 5 | **Drill-down SISWA per jurusan → kelas** | ✅ | 3-level: tombol SISWA → expand jurusan → expand kelas → pilih individu — dashboard.js:~4700 |
| 6 | **Drill-down ORTU per jurusan → kelas** | ✅ | Sama dengan SISWA — dashboard.js |
| 7 | **Drill-down WALI KELAS per tingkat (X/XI/XII)** | ✅ | 2-level: tingkat → wali kelas per kelas — dashboard.js:5570 |
| 8 | **Drill-down GURU PIKET per hari (Senin–Sabtu)** | ✅ | Expand per hari → daftar guru piket hari itu — dashboard.js (commit `931edf2`) |
| 9 | **Chip penerima** | ✅ | Setiap penerima terpilih muncul sebagai chip removable, hitungan jumlah penerima — dashboard.js:4554 |
| 10 | **Lampiran PDF/Word (maks 10 MB)** | ✅ | Upload via `uploadForumAttachment()`, URL disimpan di posting — dashboard.html:276 |
| 11 | **Detail posting + komentar** | ✅ | Modal detail: isi posting, lampiran, thread komentar, counter baca/komentar — dashboard.js:4570 |
| 12 | **Kirim komentar** | ✅ | `submitForumComment()` → `addForumSekolahComment()` — dashboard.js:4579 |
| 13 | **Edit posting sendiri** | ✅ | `openForumModal(postId)` → mode edit — button tampil di detail jika author — dashboard.js:4577 |
| 14 | **Hapus posting sendiri** | ✅ | Confirm dialog → `deleteForumSekolahPost()` — dashboard.js:4579 |
| 15 | **Muat lebih (pagination 20)** | ✅ | Tombol "Muat lebih banyak" — dashboard.js:4480 |
| 16 | **Notifikasi lonceng (unread count)** | ✅ | Poll tiap 60 detik, badge merah — `refreshNotifBadge()` dashboard.js:77 |
| 17 | **Dropdown notifikasi 15 terbaru** | ✅ | `getRecentNotifications(15)` — tampil judul + body — dashboard.js:90 |
| 18 | **Tanda baca (acknowledgement)** | 🚧 | Counter `ackCnt` tampil di card (baris `✓ N dibaca`), tapi tidak ada tombol "tandai dibaca" yang terlihat di UI. Kemungkinan dicatat otomatis saat posting dibuka (perlu konfirmasi) |
| 19 | **Filter/cari posting** | 📋 | Tidak ada fitur pencarian atau filter berdasarkan judul/pengirim/tanggal |
| 20 | **Notifikasi push (FCM)** | 📋 | Tercatat CLAUDE.md §9 backlog jauh. Saat ini notifikasi hanya in-app via polling |

---

## Rangkuman

| Tab | Fitur ✅ | Fitur 🚧 | Fitur 📋 |
|-----|---------|---------|---------|
| Catatan Siswa | 8 | 0 | 2 |
| Pembinaan Siswa | 14 | 0 | 1 |
| Jurnal — Catatan | 7 | 0 | 0 |
| Jurnal — Penilaian | 13 | 0 | 2 |
| Perangkat Ajar | 13 | 0 | 8 |
| Forum | 17 | 1 | 2 |
| **Total** | **72** | **1** | **15** |

### Fitur 📋 Yang Paling Impactful (urutan prioritas bisnis)

1. **Download .docx** dari `content_json` hasil generate ATP/ProTa — guru tidak bisa pakai dokumen tanpa ini
2. **Generate ProSem / PPM / LKPD / Soal / Rubrik via AI** — pipeline AI hanya selesai sampai ProTa
3. **Edit/hapus catatan siswa** — catatan yang salah tidak bisa dikoreksi oleh guru sendiri
4. **Export nilai akhir ke Excel** — dibutuhkan untuk koordinasi nilai dengan bagian TU/wali kelas
5. **Filter mapel Waka Kurikulum di Generate ATP** — UX blocker kecil untuk role waka
