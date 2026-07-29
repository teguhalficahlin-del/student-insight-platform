# Forum Sekolah — Bug Report

> Audit dilakukan 2026-07-29 terhadap HEAD `95cf58a`.
> Referensi rancangan: `docs/forum-penerima-per-pembuat.md`.
> Total temuan: **11 bug** (2 Critical, 4 High, 4 Medium, 1 Low).

---

## Bug #1 — `SEMUA_GURU` di DB memasukkan semua role staf, bukan hanya guru mapel

**Portal:** guru, tu, semua portal yang pakai tombol "Semua Guru"
**File:** `supabase/migrations/20260729090000_fn_forum_recipient_add_guru_mapel.sql:23-33`
**Kategori:** Bug Logis
**Severity:** Critical

**Deskripsi:**
Branch `SEMUA_GURU` di `fn_get_forum_recipient_candidates` mengembalikan seluruh staf sekolah
(GURU, BK, WAKA_KURIKULUM, WAKA_KESISWAAN, WAKA_HUMAS, KAPRODI, KEPSEK, ADMINISTRATIVE, TU).
Tombol di UI berlabel "Semua Guru" sehingga user mengira hanya guru mapel yang ditambahkan.
Dalam praktik, klik "Semua Guru" akan memasukkan Kepsek, TU, semua Waka, dll. sebagai penerima.

**Bukti:**
```sql
-- fn_get_forum_recipient_candidates, branch SEMUA_GURU (baris 23–33)
IF p_target_group = 'SEMUA_GURU' THEN
    RETURN QUERY
      SELECT u.user_id, u.full_name::text, u.role_type::text, NULL::text
      FROM public.users u
      WHERE u.school_id = v_school_id
        AND u.is_active = true
        AND u.deleted_at IS NULL
        AND u.role_type IN ('GURU','BK','WAKA_KURIKULUM','WAKA_KESISWAAN',
                            'WAKA_HUMAS','KAPRODI','KEPSEK','ADMINISTRATIVE','TU');
```

**Rancangan:**
Tombol "Semua Guru" seharusnya hanya memasukkan guru mapel. Branch `GURU_MAPEL` sudah ada di DB
dan benar (`role_type = 'GURU'`). Inkonsistensi: tombol "Semua Guru" pakai `SEMUA_GURU`,
tapi tombol "Guru tertentu" (picker) pakai `pickerGroup: 'GURU_MAPEL'`.

**Fix yang dibutuhkan:**
Ubah branch `SEMUA_GURU` agar hanya query `role_type = 'GURU'`, atau ganti tombol "Semua Guru"
agar memanggil `GURU_MAPEL`. Namanya juga perlu disesuaikan. Pertimbangkan apakah
"Semua Staf" (semua role) dibutuhkan sebagai opsi terpisah.

---

## Bug #2 — "Guru Wali" tidak ada di panel penerima manapun

**Portal:** guru, tu, semua
**File:** `guru/js/dashboard.js:4565-4610`, `tu/js/portal.js:577-590`, `supabase/migrations/20260729090000_fn_forum_recipient_add_guru_mapel.sql`
**Kategori:** Gap vs Rancangan
**Severity:** Critical

**Deskripsi:**
Rancangan menetapkan bahwa semua role pembuat (Kepsek, semua Waka, Guru Mapel, Wali Kelas,
Guru BK, Guru Piket, Kaprodi, TU) memiliki opsi "Semua Guru Wali" dan "Guru Wali tertentu".
Tidak ada satu portal pun yang mengimplementasikan pilihan ini. DB function juga tidak punya
branch untuk group `GURU_WALI` atau `SEMUA_GURU_WALI`.

**Bukti:**
```js
// guru/js/dashboard.js buildRecipientGroupButtons — branch else (GURU biasa, dll.)
groups = [
    { label: 'Kepsek',   group: 'KEPSEK',           ... },
    { label: 'Waka',     group: 'SEMUA_WAKA',        ... },
    { label: 'Kaprodi',  group: 'SEMUA_KAPRODI',     ... },
    { label: 'Guru',     group: 'SEMUA_GURU',         ... },
    { label: 'Wali Kelas', group: 'SEMUA_WALI_KELAS',...},
    { label: 'Guru BK',  group: 'SEMUA_BK',          ... },
    // ← Guru Wali tidak ada
    ...
];
```

**Rancangan:**
> "Semua Guru Wali / Guru Wali tertentu — Pilih nama: [✅ nama guru wali 1] [✅ nama guru wali 2] ..."

**Fix yang dibutuhkan:**
1. Tambah branch `SEMUA_GURU_WALI` di `fn_get_forum_recipient_candidates`:
   query `guru_wali_assignments` join `users` filter `school_id` + `is_active`.
2. Tambah entry group di semua panel penerima (guru, TU, dan portal lain).

---

## Bug #3 — Kaprodi "Guru Jurusan" tidak memfilter berdasarkan jurusan

**Portal:** guru (panel Kaprodi)
**File:** `guru/js/dashboard.js:4583-4584`, `supabase/migrations/20260729090000_fn_forum_recipient_add_guru_mapel.sql:23`
**Kategori:** Bug Fungsional
**Severity:** High

**Deskripsi:**
Panel Kaprodi mendefinisikan tombol "Guru Jurusan" dengan `group: 'SEMUA_GURU'` dan
`programId: scope.kaprodi_program_id`. Tapi branch `SEMUA_GURU` di DB tidak menggunakan
parameter `p_program_id` sama sekali. Akibatnya, Kaprodi yang klik "Semua Guru Jurusan"
akan menambahkan SEMUA staf sekolah sebagai penerima, bukan hanya guru di jurusannya.

**Bukti:**
```js
// guru/js/dashboard.js:4583-4584
{ label: 'Guru Jurusan', group: 'SEMUA_GURU', hasIndividual: true,
  pickerGroup: 'GURU_MAPEL', programId: scope.kaprodi_program_id },
```
```sql
-- fn_get_forum_recipient_candidates branch SEMUA_GURU tidak menggunakan p_program_id
IF p_target_group = 'SEMUA_GURU' THEN
    ...
    AND u.role_type IN ('GURU','BK',...); -- tidak ada AND u.program_id = p_program_id
```

**Rancangan:**
> "Semua Guru jurusannya" → difilter ke jurusan kaprodi secara default.

**Fix yang dibutuhkan:**
Buat branch baru `GURU_JURUSAN` di DB yang query `teaching_assignments` join `users`
filter `program_id = p_program_id`. Atau tambahkan kondisi `p_program_id` di branch
`SEMUA_GURU` jika `p_program_id IS NOT NULL`. Ubah group di panel Kaprodi ke branch baru.

---

## Bug #4 — Panel Kaprodi tidak punya grup "Kaprodi" (sesama kaprodi) sesuai rancangan

**Portal:** guru (panel Kaprodi)
**File:** `guru/js/dashboard.js:4583-4592`
**Kategori:** Gap vs Rancangan
**Severity:** High

**Deskripsi:**
Rancangan menyatakan Kaprodi bisa mengirim ke "Semua Kaprodi" dan "Kaprodi tertentu (filter jurusan)".
Implementasi panel Kaprodi tidak memiliki entry ini sama sekali.

**Bukti:**
```js
// guru/js/dashboard.js:4583-4592 — branch isKaprodi
groups = [
    { label: 'Guru Jurusan',     group: 'SEMUA_GURU',         ... },
    { label: 'Wali Kls Jurusan', group: 'WALI_KELAS_JURUSAN', ... },
    { label: 'Guru BK',          group: 'SEMUA_BK',           ... },
    { label: 'Siswa Jurusan',    group: 'SISWA_JURUSAN',       ... },
    { label: 'Ortu Jurusan',     group: 'ORTU_JURUSAN',        ... },
    { label: 'Kepsek',           group: 'KEPSEK',              ... },
    { label: 'Waka',             group: 'SEMUA_WAKA',          ... },
    { label: 'TU / Admin',       group: 'SEMUA_TU',            ... },
    // ← Semua Kaprodi / Kaprodi tertentu tidak ada
];
```

**Rancangan:**
> "Semua Kaprodi / Kaprodi tertentu — Filter jurusan: [AKL | BDP | TJKT | ...]"

**Fix yang dibutuhkan:**
Tambah entry `{ label: 'Kaprodi', group: 'SEMUA_KAPRODI', hasIndividual: true, needsJurusan: true }`
di branch `isKaprodi`. DB branch `SEMUA_KAPRODI` dan `KAPRODI_JURUSAN` sudah ada.

---

## Bug #5 — Else branch (GURU, WALI_KELAS, dll.) tidak punya "Semua Siswa"

**Portal:** guru
**File:** `guru/js/dashboard.js:4594-4610`
**Kategori:** Gap vs Rancangan
**Severity:** High

**Deskripsi:**
Panel penerima untuk role guru biasa (GURU, WALI_KELAS, BK, dll.) — branch `else` — tidak
memiliki tombol "Semua Siswa". Hanya ada "Siswa Kelas" dan "Siswa Jurusan". Sementara panel
Kepsek/Waka (baris 4573) memiliki "Semua Siswa". Rancangan menyebut "Semua Siswa" tersedia
untuk semua role pembuat.

**Bukti:**
```js
// guru/js/dashboard.js:4573 — hanya di branch isKepsek/isWaka/isAdmin
{ label: 'Semua Siswa', group: 'SEMUA_SISWA', hasIndividual: false },

// guru/js/dashboard.js:4594-4610 — branch else tidak ada entri SEMUA_SISWA
groups = [
    ...
    { label: 'Siswa Kelas',   group: 'SISWA_KELAS',   ... },
    { label: 'Siswa Jurusan', group: 'SISWA_JURUSAN',  ... },
    // ← Semua Siswa tidak ada
    ...
];
```

**Rancangan:**
> "Semua Siswa" tersedia untuk GURU MAPEL, WALI KELAS, GURU BK, GURU PIKET, dll.

**Fix yang dibutuhkan:**
Tambah `{ label: 'Semua Siswa', group: 'SEMUA_SISWA', hasIndividual: false }` di branch `else`.
DB branch `SEMUA_SISWA` sudah ada.

---

## Bug #6 — TU bisa broadcast ke "Semua TU/Admin" — rancangan melarang ini

**Portal:** tu
**File:** `tu/js/portal.js:590`
**Kategori:** Gap vs Rancangan
**Severity:** Medium

**Deskripsi:**
Portal TU memiliki tombol "Semua TU / Admin" (group `SEMUA_TU`). Rancangan secara eksplisit
melarang TU/Admin broadcast ke seluruh staf TU.

**Bukti:**
```js
// tu/js/portal.js:590
{ label: 'Semua TU / Admin', group: 'SEMUA_TU', hasIndividual: true },
// ← tombol "Semua TU / Admin" ada
```

**Rancangan:**
> ⚠️ "Semua TU/Admin" tidak tersedia — TU tidak broadcast ke seluruh staf TU.
> Hanya tersedia: "TU / Admin tertentu" (individual picker).

**Fix yang dibutuhkan:**
Di panel TU, ganti entry menjadi `{ label: 'TU / Admin', group: 'SEMUA_TU', hasIndividual: true, labelSemua: null }`
dengan logika yang tidak menampilkan tombol "Semua TU/Admin", hanya tombol picker "TU/Admin tertentu".
Atau hapus `hasIndividual: false` dan set ulang agar hanya picker yang muncul.

---

## Bug #7 — Picker "Wali Kelas tertentu" tidak punya filter kelas (X/XI/XII)

**Portal:** guru, tu
**File:** `guru/js/dashboard.js:4570`, `tu/js/portal.js:581`, `supabase/migrations/20260729090000_fn_forum_recipient_add_guru_mapel.sql`
**Kategori:** Gap vs Rancangan
**Severity:** Medium

**Deskripsi:**
Tombol "Wali Kelas tertentu" membuka picker dengan filter hanya jurusan (`needsJurusan: true`).
Rancangan mensyaratkan dua filter: jurusan DAN kelas (X/XI/XII). DB function juga tidak punya
branch `WALI_KELAS_KELAS` (filter berdasarkan grade_level/tingkat).

**Bukti:**
```js
// guru/js/dashboard.js:4570
{ label: 'Wali Kelas', group: 'SEMUA_WALI_KELAS', hasIndividual: true, needsJurusan: true },
// ← needsKelas tidak ada
```

**Rancangan:**
> "Wali Kelas tertentu — Filter jurusan: [Semua | AKL | ...] + Filter kelas: [Semua | X | XI | XII]"

**Fix yang dibutuhkan:**
1. Tambah branch `WALI_KELAS_TINGKAT` di DB yang filter by `c.grade_level = p_grade_level`
   (atau gunakan parameter `p_class_id` sebagai proxy level).
2. Tambah `needsKelas: true` pada entry Wali Kelas, dan handle di picker agar filter
   jurusan dan kelas dikombinasikan sebelum query DB.

---

## Bug #8 — Ortu tab Terkirim: query inline langsung ke `forum_posts`, bukan via api.js

**Portal:** parent
**File:** `parent/js/portal.js:843-855`
**Kategori:** Inkonsistensi
**Severity:** Medium

**Deskripsi:**
Tab Terkirim ortu menggunakan query langsung `.from('forum_posts').select(...)` inline di
`loadForumPosts()` — bukan melalui fungsi helper `getForumSekolahSentPosts` di `api.js`.
Semua portal lain (guru, TU) menggunakan helper API. Ini inkonsistensi maintenance dan
berpotensi menyebabkan bug jika skema berubah (hanya api.js yang diupdate).

**Bukti:**
```js
// parent/js/portal.js:843-855 — inline query untuk tab Terkirim
const { data, error } = await supabase
    .from('forum_posts')
    .select(`post_id, title, body, created_at, is_edited,
             author_user_id,
             acknowledgements:forum_post_acknowledgements(user_id),
             audience:forum_post_audience(user_id)`)
    .eq('scope_type', 'SEKOLAH')
    .eq('school_id', currentUser.school_id)
    .eq('author_user_id', currentUser.user_id)
    ...
```
Vs guru/TU yang memanggil `getForumSekolahSentPosts(schoolId, userId, LIMIT, offset)`.

**Fix yang dibutuhkan:**
Pindahkan query ini ke fungsi `getForumSekolahSentPosts` di `parent/js/api.js`
(clone dari `guru/js/api.js:1159`), lalu panggil dari `loadForumPosts()` di `parent/js/portal.js`.

---

## Bug #9 — TU portal tidak support attachment pada posting forum

**Portal:** tu
**File:** `tu/js/portal.js:862-910`
**Kategori:** Inkonsistensi
**Severity:** Medium

**Deskripsi:**
Portal guru mendukung upload attachment (file) saat membuat posting forum, termasuk
upload ke Supabase Storage dan menyimpan `attachment_url`/`attachment_name`. Portal TU
tidak memiliki fitur ini sama sekali — tidak ada input file, tidak ada upload logic.

**Bukti:**
```js
// guru/js/dashboard.js:4916-4923 — upload attachment
const path = `forum/${currentUser.school_id}/${Date.now()}_${file.name}`;
await supabase.storage.from('forum-attachments').upload(path, file, ...);
const { data: pub } = supabase.storage.from('forum-attachments').getPublicUrl(path);
// ← attachmentUrl dikirim ke fn_create_forum_post

// tu/js/portal.js:891-897 — createForumSekolahPost tanpa attachment
await createForumSekolahPost(title, body, recipientIds, academicYear);
// ← tu/js/api.js:createForumSekolahPost tidak terima attachment param
```

**Fix yang dibutuhkan:**
Tambah input file, upload logic, dan parameter attachment ke `submitForumPost` di TU portal.
Sinkronkan signature `tu/js/api.js:createForumSekolahPost` dengan versi di `guru/js/api.js`
(tambahkan destructured `{ attachmentUrl, attachmentName }` option).

---

## Bug #10 — `getParentForumRecipients` tidak filter `school_id` secara eksplisit

**Portal:** parent
**File:** `parent/js/api.js:393-440`
**Kategori:** Bug Logis
**Severity:** Medium

**Deskripsi:**
Fungsi `getParentForumRecipients(classId)` melakukan 4 query paralel ke tabel
`users`, `bk_class_assignments`, `guru_wali_assignments`, dan `teaching_schedules`
tanpa menyertakan filter `school_id` eksplisit. Isolasi tenant bergantung sepenuhnya
pada RLS. Jika RLS pada salah satu tabel tidak lengkap, user_id dari sekolah lain
bisa masuk sebagai penerima. Ini juga mempersulit debugging dan audit keamanan.

**Bukti:**
```js
// parent/js/api.js:400-412
supabase.from('bk_class_assignments')
    .select('bk_user_id')
    .eq('class_id', classId)
    .eq('is_active', true),
    // ← tidak ada .eq('school_id', schoolId)

supabase.from('guru_wali_assignments')
    .select('guru_user_id')
    .eq('is_active', true)
    .in('student_id', ...),
    // ← tidak ada .eq('school_id', schoolId)
```

**Fix yang dibutuhkan:**
Tambahkan `.eq('school_id', schoolId)` (terima parameter `schoolId` di fungsi)
pada semua 4 query di `getParentForumRecipients`. Tambahkan juga filter
`AND school_id = fn_current_school_id()` jika query ini nanti dipindahkan ke RPC.

---

## Bug #11 — Panel Kaprodi tidak punya "Siswa tertentu", "Ortu tertentu", "Siswa kelas tertentu", "Ortu kelas tertentu"

**Portal:** guru (panel Kaprodi)
**File:** `guru/js/dashboard.js:4583-4592`
**Kategori:** Gap vs Rancangan
**Severity:** Low

**Deskripsi:**
Rancangan Kaprodi menyertakan: "Siswa kelas tertentu", "Siswa jurusan tertentu",
"Siswa tertentu" (individual), "Orang Tua kelas tertentu", "Orang Tua jurusan tertentu",
"Orang Tua tertentu". Implementasi panel Kaprodi hanya punya "Siswa Jurusan" dan
"Ortu Jurusan" — keduanya hanya filter by jurusan, tidak ada picker kelas atau picker individual.

**Bukti:**
```js
// guru/js/dashboard.js:4587-4588 — branch isKaprodi
{ label: 'Siswa Jurusan', group: 'SISWA_JURUSAN', hasIndividual: true, needsJurusan: true },
{ label: 'Ortu Jurusan',  group: 'ORTU_JURUSAN',  hasIndividual: true, needsJurusan: true },
// ← Siswa Kelas, Siswa tertentu, Ortu Kelas, Ortu tertentu tidak ada
```

**Rancangan:**
> Kaprodi: "Siswa kelas tertentu — Filter jurusan + kelas — Pilih kelas"
> Kaprodi: "Siswa tertentu — Filter jurusan + kelas — Pilih nama"
> Kaprodi: "Orang Tua kelas tertentu, Orang Tua tertentu" (serupa)

**Fix yang dibutuhkan:**
Tambahkan entry berikut di branch `isKaprodi`:
```js
{ label: 'Siswa Kelas',  group: 'SISWA_KELAS',  hasIndividual: true, needsKelas: true },
{ label: 'Ortu Kelas',   group: 'ORTU_KELAS',   hasIndividual: true, needsKelas: true },
```
DB branch `SISWA_KELAS` dan `ORTU_KELAS` sudah ada dan sudah benar.

---

## Ringkasan Prioritas

| # | Severity | Judul |
|---|----------|-------|
| 1 | Critical | `SEMUA_GURU` di DB memasukkan semua role staf |
| 2 | Critical | "Guru Wali" tidak ada di panel penerima manapun |
| 3 | High | Kaprodi "Guru Jurusan" tidak filter by jurusan |
| 4 | High | Panel Kaprodi tidak ada grup "Kaprodi" |
| 5 | High | Branch else tidak ada "Semua Siswa" |
| 6 | Medium | TU bisa "Semua TU/Admin" — rancangan melarang |
| 7 | Medium | Picker Wali Kelas tidak ada filter kelas (X/XI/XII) |
| 8 | Medium | Ortu tab Terkirim query inline bukan via api.js |
| 9 | Medium | TU tidak support attachment |
| 10 | Medium | `getParentForumRecipients` tanpa filter school_id eksplisit |
| 11 | Low | Panel Kaprodi tidak ada Siswa/Ortu kelas/individual |
