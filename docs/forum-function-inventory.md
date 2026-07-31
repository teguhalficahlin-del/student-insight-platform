# Inventaris Fungsi Tab Forum — Portal Guru

> File: `guru/js/dashboard.js`
> Diperbarui: 31 Jul 2026

---

## 1. State Variables

| Variabel | Tipe | Keterangan |
|----------|------|------------|
| `_forumMode` | `string` | Mode tampil: `'masuk'` atau `'terkirim'` |
| `_forumOffset` | `number` | Offset pagination posting |
| `_forumHasMore` | `boolean` | Masih ada posting berikutnya |
| `_forumTabInit` | `boolean` | Guard agar init hanya sekali |
| `_forumScope` | `object\|null` | Scope user dari `fn_get_user_forum_scope` (role, program, class) |
| `_forumEditPostId` | `uuid\|null` | `null` = buat baru, uuid = mode edit |
| `_forumRecipients` | `Map<uid, candidate>` | Penerima terpilih (individu + dari grup) |
| `_forumGroupLabels` | `Map<groupKey, string>` | Label chip per grup terpilih |
| `_forumGroupBtns` | `Map<groupKey, HTMLElement>` | Referensi tombol grup untuk toggling class |
| `_forumGroupUids` | `Map<groupKey, Set<uid>>` | UID per grup (untuk un-select) |
| `_forumPrograms` | `array` | Cache `[{ program_id, name }]` |
| `_forumClasses` | `array` | Cache `[{ class_id, name, grade_level, program_id }]` |
| `_pickerGroupDef` | `object\|null` | Definisi grup yang sedang dibuka di picker |
| `_pickerCandidates` | `array` | Kandidat yang di-fetch dari DB untuk picker flat |
| `_pickerSelected` | `Map<uid, candidate>` | Pilihan sementara di picker flat |

### State Drill-down Siswa / Ortu

| Variabel | Tipe | Keterangan |
|----------|------|------------|
| `_drillType` | `'SISWA_DRILL'\|'ORTU_DRILL'\|null` | Jenis drill-down aktif |
| `_drillExpanded` | `Set<program_id>` | Jurusan yang ter-expand |
| `_drillJurusanAll` | `Set<program_id>` | Jurusan yang dipilih semua |
| `_drillKelasAll` | `Set<class_id>` | Kelas yang dipilih semua |
| `_drillIndividu` | `Map<uid, candidate>` | Individu yang dipilih manual |
| `_drillKelasExpanded` | `Set<class_id>` | Kelas yang ter-expand |
| `_drillKelasData` | `Map<class_id, candidates[]>` | Cache kandidat per kelas |
| `_drillJurusanCount` | `Map<program_id, number>` | Cache jumlah kandidat per jurusan |
| `_drillKelasCount` | `Map<class_id, number>` | Cache jumlah kandidat per kelas |

### State Drill-down Guru Piket

| Variabel | Tipe | Keterangan |
|----------|------|------------|
| `_drillPiketExpanded` | `Set<dayOfWeek>` | Hari yang ter-expand |
| `_drillPiketHariAll` | `Set<dayOfWeek>` | Hari yang dipilih semua |
| `_drillPiketIndividu` | `Map<uid, candidate>` | Individu yang dipilih manual |
| `_drillPiketHariData` | `Map<dayOfWeek, candidates[]>` | Cache kandidat per hari |
| `_drillPiketHariCount` | `Map<dayOfWeek, number>` | Cache jumlah kandidat per hari |

### State Drill-down Wali Kelas

| Variabel | Tipe | Keterangan |
|----------|------|------------|
| `_drillWaliExpanded` | `Set<grade_level>` | Grade yang ter-expand (10/11/12) |
| `_drillWaliGradeAll` | `Set<grade_level>` | Grade yang dipilih semua |
| `_drillWaliSelected` | `Map<uid, candidate>` | Individu yang dipilih manual |
| `_waliKelasCache` | `Map<class_name, candidate>\|null` | Cache semua wali kelas (dimuat sekali saat buka) |

---

## 2. Fungsi Init & Load

| Fungsi | Deskripsi singkat | Status |
|--------|-------------------|--------|
| `initForumTab()` | Init tab Forum: load scope user, programs, classes, lalu load posts. Guard `_forumTabInit`. | ✅ Berfungsi |
| `loadForumPosts(append)` | Fetch posting inbox/terkirim via RPC `get_forum_posts` + pagination offset. `append=false` reset list. | ✅ Berfungsi |

---

## 3. Fungsi Render Posting

| Fungsi | Deskripsi singkat | Status |
|--------|-------------------|--------|
| `renderForumPostCard(post)` | Render satu card posting: judul, body preview, tanggal, jumlah komentar, badge acknowledge. | ✅ Berfungsi |
| `wireForumCards()` | Pasang event listener `click` pada semua `.forum-card` untuk buka detail + acknowledge. | ✅ Berfungsi |

---

## 4. Fungsi Modal Buat / Edit Posting

| Fungsi | Deskripsi singkat | Status |
|--------|-------------------|--------|
| `openForumModal(postId)` | Buka modal buat posting baru (`postId=null`) atau edit (`postId=uuid`). Reset form + bangun tombol penerima. | ✅ Berfungsi |
| `closeForumModal()` | Tutup modal buat/edit posting, reset semua state penerima. | ✅ Berfungsi |
| `submitForumPost()` | Validasi form, kumpulkan recipients, kirim RPC `create_forum_post` atau `update_forum_post`. | ✅ Berfungsi |

---

## 5. Fungsi Panel Penerima

| Fungsi | Deskripsi singkat | Status |
|--------|-------------------|--------|
| `buildRecipientGroupButtons()` | Render tombol grup penerima berdasarkan `_forumScope` (role user). Tiap grup punya tombol "Semua" + opsional "tertentu". | ✅ Berfungsi |
| `addRecipientGroup(groupDef, btnEl)` | Handle klik tombol grup: fetch semua kandidat (mode `semua`) atau buka picker/drill-down (mode `tertentu`). Toggle bila diklik ulang. | ✅ Berfungsi |
| `renderRecipientChips()` | Render chip-chip penerima + counter total. Tampil label grup bila dipilih via "Semua". | ✅ Berfungsi |

---

## 6. Fungsi Picker Flat (Individu Reguler)

| Fungsi | Deskripsi singkat | Status |
|--------|-------------------|--------|
| `openRecipientPicker(groupDef)` | Buka modal picker flat: reset `picker-list` ke `display:block`, sembunyikan `picker-tree`, hapus `drillMode`. Lalu fetch kandidat. | ✅ Berfungsi (fix A/B — e552600) |
| `loadPickerCandidates()` | Fetch kandidat via `getForumRecipientCandidates` dengan filter jurusan/kelas/hari sesuai groupDef. | ✅ Berfungsi |
| `renderPickerList()` | Render daftar kandidat di `#picker-list` dengan filter search + jabatan. Pasang checkbox change. | ✅ Berfungsi |
| `closeRecipientPicker()` | Sembunyikan modal, reset `_pickerGroupDef` dan `_pickerCandidates`. | ✅ Berfungsi |
| `_initPickerWiring(modal)` | Pasang event listeners modal picker (batal, backdrop click, search input, filter change, tambahkan). Hanya sekali (`dataset.wired`). Dispatch ke mode drill yang aktif. | ✅ Berfungsi |

---

## 7. Fungsi Drill-down Siswa / Ortu

| Fungsi | Deskripsi singkat | Status |
|--------|-------------------|--------|
| `openDrillDownPicker(drillType)` | Buka drill-down Siswa atau Ortu: reset state, set `drillMode='1'`, render tree. | ✅ Berfungsi |
| `renderDrillTree()` | Render tree 3 level: jurusan → kelas → individu. Badge counter per node. Filter search. | ✅ Berfungsi |
| `_toggleDrillKelas(classId, className, programId)` | Toggle expand kelas. Lazy-fetch kandidat per kelas jika belum di-cache. | ✅ Berfungsi |
| `submitDrillDown()` | Kumpulkan pilihan dari `_drillJurusanAll`, `_drillKelasAll`, `_drillIndividu`. Fetch real list untuk jurusan/kelas all. Tambah ke `_forumRecipients`. | ✅ Berfungsi |
| `closeDrillDownPicker()` | Sembunyikan modal, hapus `drillMode`, sembunyikan `picker-tree`, clear state. | ✅ Berfungsi |

---

## 8. Fungsi Drill-down Guru Piket

| Fungsi | Deskripsi singkat | Status |
|--------|-------------------|--------|
| `openDrillDownPiketPicker()` | Buka drill-down Guru Piket: reset state, set `drillMode='piket'`, render tree hari. | ✅ Berfungsi |
| `renderPiketTree()` | Render tree 2 level: hari (Senin–Sabtu) → individu guru piket. Badge counter per hari. | ✅ Berfungsi |
| `_togglePiketHari(day)` | Toggle expand hari. Lazy-fetch guru piket per hari dari DB jika belum di-cache. | ✅ Berfungsi |
| `submitDrillDownPiket()` | Kumpulkan pilihan dari `_drillPiketHariAll` + `_drillPiketIndividu`. Fetch real list untuk hari-all. Tambah ke `_forumRecipients`. | ✅ Berfungsi |
| `closeDrillDownPiketPicker()` | Sembunyikan modal, hapus `drillMode`, sembunyikan `picker-tree`, clear state. | ✅ Berfungsi |

---

## 9. Fungsi Drill-down Wali Kelas

| Fungsi | Deskripsi singkat | Status |
|--------|-------------------|--------|
| `openDrillDownWaliKelasPicker()` | Buka drill-down Wali Kelas: reset state, set `drillMode='wali'`, fetch semua wali kelas sekali ke `_waliKelasCache`, lalu render tree. | ⚠️ Perlu uji (baru — 8f9a060) |
| `renderWaliKelasTree()` | Render tree 2 level: grade (X/XI/XII) → flat list wali kelas. Checkbox "Semua Wali Kelas X" + individu per kelas. Badge counter di header grade. | ⚠️ Perlu uji (baru — 8f9a060) |
| `submitWaliKelasDrillDown()` | Gabungkan `_drillWaliGradeAll` (ekspansi ke individu via cache) + `_drillWaliSelected` ke `_forumRecipients`. | ⚠️ Perlu uji (baru — 8f9a060) |
| `closeDrillDownWaliKelasPicker()` | Sembunyikan modal, hapus `drillMode`, sembunyikan `picker-tree`, clear state. | ⚠️ Perlu uji (baru — 8f9a060) |

---

## 10. Fungsi Modal Detail Posting

| Fungsi | Deskripsi singkat | Status |
|--------|-------------------|--------|
| `openForumDetail(postId)` | Buka modal detail: fetch post lengkap, render body + attachment, load komentar, pasang tombol edit/acknowledge. | ✅ Berfungsi |
| `closeForumDetail()` | Tutup modal detail. | ✅ Berfungsi |
| `loadForumComments(postId)` | Fetch komentar posting, render daftar komentar di modal detail. | ✅ Berfungsi |
| `submitForumComment()` | Validasi input komentar, kirim via RPC `add_forum_comment`, reload komentar. | ✅ Berfungsi |

---

## Ringkasan Status

| Kategori | ✅ Berfungsi | ⚠️ Perlu uji | ❌ Bug diketahui |
|----------|-------------|--------------|-----------------|
| State variables | 22 | 4 | 0 |
| Init & Load | 2 | 0 | 0 |
| Render posting | 2 | 0 | 0 |
| Modal buat/edit | 3 | 0 | 0 |
| Panel penerima | 3 | 0 | 0 |
| Picker flat | 5 | 0 | 0 |
| Drill-down Siswa/Ortu | 5 | 0 | 0 |
| Drill-down Guru Piket | 5 | 0 | 0 |
| **Drill-down Wali Kelas** | 0 | **4** | 0 |
| Modal detail | 4 | 0 | 0 |
| **Total** | **29** | **4** | **0** |

> Semua ⚠️ adalah fungsi drill-down Wali Kelas yang baru diimplementasi di commit `8f9a060` dan belum diverifikasi di production.
