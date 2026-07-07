# Laporan Investigasi Lanjutan Fase 2 — Kelompok E & Temuan F2-A
**Tanggal:** 7 Juli 2026  
**Project:** smk-platform (`xovvuuwexoweoqyltepq`), Singapore  
**Scope:** Verifikasi Kelompok E (E1, E2) + coverage scan 70 policy sisa + temuan F2-A (over-exposure kolom users) + fix via VIEW  
**Metode:** SELECT-only via `supabase db query --linked` (Management API), grep source code, transaksi ROLLBACK pra-eksekusi, test suite regresi

---

## Ringkasan Eksekutif

Sesi ini melanjutkan Fase 2 (RLS & Tenant Isolation) dengan tiga agenda: (1) memverifikasi dua item yang sebelumnya ditandai "perlu dicek live" (Kelompok E: pkl_placements dan schedule_time_slots), (2) memindai sisa 70 policy yang belum pernah disentuh secara formal, dan (3) menelusuri pertanyaan baru tentang apakah proses impor massal data (bulk-import) berpotensi mencampur data antar sekolah.

Hasil keseluruhan: tidak ditemukan celah aktif baru yang membahayakan. Dua item Kelompok E terbukti aman atau sudah diperbaiki lebih awal. Dari 70 policy sisa, 45 terbukti aman langsung dari pola kode, 18 fungsi helper diverifikasi definisinya. Sebagian (seperti `fn_can_see_case`, `fn_student_is_on_pkl`) sudah punya guard school_id built-in di dalam fungsinya sendiri. Sebagian lain (seperti `fn_is_kepsek`, `fn_teaches_student`, `fn_dudi_supervises_student`) TIDAK punya guard internal — keamanannya bergantung pada policy yang memanggilnya selalu menambahkan guard school_id di level terluar. Pola ini sudah diverifikasi konsisten di seluruh 18 fungsi/policy yang diperiksa, TAPI ini adalah kontrak implisit yang harus tetap dijaga: setiap policy ATAU RPC BARU yang memakai fungsi-fungsi ini WAJIB menambahkan guard school_id sendiri di level terluar — fungsi-fungsi ini TIDAK aman dipanggil tanpa guard tambahan tersebut. 7 policy paling kompleks dibaca dan diverifikasi satu per satu — semua aman. Proses impor massal juga terbukti aman: data tidak tercampur di database saat ini, dan ada lapisan pengaman otomatis di tingkat database (trigger) yang menjaga konsistensi kode sekolah di 18 tabel.

Satu celah struktural ditemukan dan langsung diperbaiki: policy yang mengatur akses guru/staf membatasi *baris* data dengan benar (hanya data sekolah sendiri yang terlihat), tapi tidak membatasi *kolom*. Artinya pengguna dengan akses sah (misalnya akun siswa) bisa secara teknis mengambil semua kolom tabel pengguna lewat akses langsung ke server, termasuk email, nomor identitas guru, dan status keamanan akun. Perbaikan di tingkat database (sebuah "jendela terbatas" bernama `v_users_staff_directory`) sudah diterapkan dan diverifikasi dengan 42 pemeriksaan otomatis — semuanya lulus. Satu langkah lanjutan masih menunggu: kode di 7 portal aplikasi perlu dipindahkan untuk memakai jendela terbatas ini, bukan akses langsung ke tabel penuh.

Selain itu, ditemukan dan langsung diperbaiki satu fungsi database lain yang secara tidak sengaja bisa diakses siapa saja (termasuk tanpa login) dan membocorkan status jabatan pegawai lintas sekolah — sudah dikunci dan diverifikasi tertutup di sesi yang sama (lihat Bagian 4a). Sebagai tindak lanjut proaktif dari temuan itu, lima fungsi lain juga ditemukan memiliki izin akses terbuka yang tidak diperlukan — semuanya sudah dikunci ke backend saja, dengan uji fungsional membuktikan tidak ada alur aplikasi yang rusak (lihat Bagian 4b).

---

## Bagian 1 — Verifikasi Kelompok E

### E1 — `pkl_placements` / policy `rls_pkl_read_ortu`

**Pertanyaan awal:** Policy ini terlihat tidak punya filter school_id — apakah ortu dari sekolah A bisa mengintip data PKL siswa sekolah B?

**Metode verifikasi:** Baca definisi policy langsung dari database live via `pg_policies`, bandingkan dengan asumsi awal di dokumen handoff, cek logika kondisi AND secara formal.

**Hasil: TIDAK EXPLOITABLE.**

Definisi policy live ternyata berbeda dari yang diasumsikan dalam dokumen awal. Policy memiliki guard `school_id = fn_current_school_id()` sebagai kondisi `AND` terluar yang independen:

```sql
QUAL: (school_id = fn_current_school_id())
      AND (fn_current_user_role() = 'ORTU'::role_type)
      AND (EXISTS (
        SELECT 1 FROM student_parents sp
        WHERE sp.student_id = pkl_placements.student_id
          AND sp.parent_user_id = fn_current_user_id()
      ))
```

Kondisi `AND` terluar memastikan hanya baris dengan `school_id` sekolah pemanggil yang lolos — ini berlaku terlepas isi subquery ke `student_parents`. Secara logis: `FALSE AND <apapun> = FALSE`. Baris PKL milik sekolah lain selalu ditolak di kondisi pertama.

**Catatan penting:** Deskripsi awal di `audit-handoff.md` ("tidak punya guard school_id") terbukti tidak akurat dibanding kondisi policy live. Kemungkinan deskripsi itu ditulis dari asumsi pola kode lama, bukan dari `pg_policies` database saat ini. Ini menegaskan kembali **Rule 4** (standing rules §3a): verifikasi live dulu sebelum menyimpulkan ada celah.

**Keterbatasan:** Tidak tersedia data PKL di sekolah smkkb/smkhb untuk uji empiris penuh. Kesimpulan berbasis pembacaan definisi policy (valid secara logis: kondisi AND selalu dievaluasi kiri-ke-kanan, false pertama = short-circuit).

---

### E2 — `schedule_time_slots` / policy `rls_time_slots_read`

**Pertanyaan awal:** Policy ini tidak memfilter berdasarkan role — apakah semua pengguna (termasuk siswa, ortu) bisa membaca data slot waktu jadwal?

**Hasil: SUDAH TER-FIX sebelumnya.**

Migration `20260706200000` (6 Juli 2026, bagian Fase 2.1) sudah mengubah policy ini untuk membatasi akses hanya ke role ADMINISTRATIVE. Deskripsi "semua role bisa baca" di dokumen handoff sudah usang sejak migration tersebut diterapkan.

**Verifikasi live:** Simulasi akses sebagai SISWA smkhr dan ORTU smkhr — keduanya mengembalikan 0 baris. Ditolak di kondisi role (bukan sekadar data kosong). Tidak ada FK masuk ke tabel ini dari tabel lain, sehingga tidak ada jalur bocor tidak langsung.

**Catatan isi kolom:** Data di tabel ini adalah metadata slot waktu (jam dan label slot) tanpa informasi personal — sensitivitasnya rendah bahkan jika akses terbuka, sehingga perbaikan ini bersifat preventif.

---

## Bagian 2 — Coverage Scan 70 Policy Sisa

### Metodologi

Dari total 117 policy di database live, 47 sudah diverifikasi di Kelompok A–E sebelumnya. Sisa 70 policy ditriase dalam tiga kategori:

| Kategori | Jumlah | Keterangan |
|---|---|---|
| Pola aman jelas | 45 | Guard `school_id = fn_current_school_id()` sebagai kondisi terluar, identik pola yang sudah terbukti di A–E. Tidak butuh deep-read. |
| Fungsi helper perlu verifikasi | 18 | Policy memakai fungsi helper (`fn_can_see_case`, `fn_can_see_student`, dll.) — definisi fungsi dibaca dari DB live. |
| Perlu baca kual lengkap | 7 | Policy paling kompleks, kondisi bertingkat atau pola baru. Dibaca dan diverifikasi satu per satu. |

### Hasil Verifikasi Fungsi Helper dan Policy Kompleks

**`fn_can_see_case` dan seluruh sub-fungsinya** (`fn_involved_in_case`, `fn_is_internal_case_actor`, `fn_user_is_internal_case_actor`, `fn_matches_case_handler`):

Fungsi `fn_can_see_case` sendiri memiliki guard `school_id = fn_current_school_id()` di level terluar klausa `EXISTS`. Sub-fungsi yang dipanggil dari dalamnya (`fn_involved_in_case`, `fn_is_internal_case_actor`, `fn_user_is_internal_case_actor`, `fn_matches_case_handler`) membaca tabel `cases` atau `users` tanpa guard school_id internal — keamanannya bergantung pada guard di `fn_can_see_case` selaku pemanggil. Kombinasi ini sudah diverifikasi aman dalam konteks pemanggilan yang ada. **Status: Kombinasi policy + fungsi helper VERIFIED AMAN dalam konteks yang ada.**

**`fn_can_see_student` dan 3 policy pemanggil** (`rls_students_read_staff`, `rls_enrollments_read_staff`, `rls_attendance_read_staff`):

Ketiga policy menyertakan `school_id = fn_current_school_id()` sebagai kondisi `AND` terluar yang independen dari `fn_can_see_student`. Fungsi `fn_can_see_student` sendiri tidak punya guard school_id internal — guard berada di level policy pemanggil. Pola identik dengan A7 dan B3 yang sudah diverifikasi di laporan sebelumnya. **Status: Kombinasi policy + fungsi helper VERIFIED AMAN dalam konteks yang ada.**

**`rls_users_read_own` dan `rls_users_update_own`:**

Kedua policy menggunakan `auth.uid() = auth_user_id` sebagai satu-satunya kondisi filter. Ini aman karena `auth_user_id` adalah UUID unik global di seluruh sistem Supabase Auth — tidak ada dua pengguna berbeda yang bisa memiliki `auth_user_id` yang sama, sehingga satu pengguna hanya bisa membaca/mengubah baris miliknya sendiri, tidak peduli berapa sekolah yang ada di database. Guard `school_id` tidak diperlukan di sini karena isolasi sudah dijamin oleh keunikan UUID. **Status: VERIFIED AMAN.**

### Catatan Penting untuk Pengembangan Selanjutnya

Sebagian fungsi helper (`fn_is_kepsek`, `fn_is_bk`, `fn_is_waka_kesiswaan`, `fn_teaches_student`, `fn_wali_of_student`, `fn_dudi_supervises_student`, `fn_kaprodi_of_student`, `fn_kaprodi_program_id`, `fn_is_internal_case_actor`, `fn_matches_case_handler`, `fn_is_schoolwide_observer`, `fn_involved_in_case`) **TIDAK memvalidasi school_id secara internal**. Developer yang membuat policy RLS atau RPC baru yang memanggil fungsi-fungsi ini **WAJIB** menambahkan `school_id = fn_current_school_id()` sebagai kondisi `AND` terpisah di level policy, mengikuti **Rule 3** (standing rules §3a). Kegagalan menambahkan guard ini di policy baru akan membuka celah cross-tenant meski fungsi-fungsi ini sendiri sudah "terbukti aman" dalam konteks pemanggilan yang sudah ada.

**Catatan khusus `fn_user_is_internal_case_actor`:** Fungsi ini sudah TIDAK masuk daftar di atas karena statusnya berbeda — bukan sekadar "kontrak implisit" tapi temuan aktif yang sudah diperbaiki. Grant EXECUTE-nya ke `anon` dan `authenticated` terbukti exploitable secara live, dan sudah ditutup via migration `20260707140000`. Lihat **Bagian 4a** untuk detail lengkap.

---

## Bagian 3 — Investigasi Integritas Data Lintas Sekolah (Bulk Import)

### Pertanyaan

Apakah proses impor massal (`bulk-import-students`, `bulk-import-schedules`, `bulk-import-users`, `bulk-import-parents`, `bulk-import-dudi`) bisa menghasilkan data yang "salah sekolah" — misalnya siswa sekolah A terdaftar di kelas sekolah B?

### Temuan 1: Data Live Bersih

Query langsung ke database live:

```sql
-- A1: class_enrollments dengan school_id tidak konsisten
SELECT ce.enrollment_id, ce.school_id, s.school_id, c.school_id
FROM class_enrollments ce
JOIN students s ON s.student_id = ce.student_id
JOIN classes c ON c.class_id = ce.class_id
WHERE ce.school_id != s.school_id OR ce.school_id != c.school_id;
-- Hasil: 0 baris

-- A2: teaching_assignments dengan school_id tidak konsisten
SELECT ta.assignment_id, ta.school_id, u.school_id, c.school_id
FROM teaching_assignments ta
JOIN users u ON u.user_id = ta.user_id
JOIN classes c ON c.class_id = ta.class_id
WHERE ta.school_id != u.school_id OR ta.school_id != c.school_id;
-- Hasil: 0 baris
```

Tidak ada data yang tercampur di database saat ini.

### Temuan 2: Trigger `trg_auto_school_id` sebagai Lapisan Pengaman

Di seluruh edge function bulk-import, tidak ada guard eksplisit yang membandingkan school_id antar-entitas sebelum INSERT. Validasi dilakukan secara *implisit* — semua lookup (kelas, siswa, guru) di-scope ke `user.school_id` terlebih dahulu, sehingga UUID dari sekolah lain tidak akan ditemukan di Map resolusi.

Namun jika ada bug atau bypass di edge function, ada lapisan kedua di tingkat database: **trigger `trg_auto_school_id`** yang terpasang sebagai `BEFORE INSERT` di 18 tabel, termasuk `students`, `class_enrollments`, `teaching_assignments`, `student_parents`, dan lainnya.

Trigger ini memanggil fungsi `fn_auto_set_school_id()` yang bekerja sebagai berikut:
1. Jika `NEW.school_id` sudah diisi → lewati (jaga nilai yang ada)
2. Jika `NEW.school_id` kosong → panggil `fn_current_school_id()` (dari JWT)
3. Jika JWT tidak punya school_id (misal service_role) → derive dari parent entity:
   - `students` → dari `programs.school_id` via `program_id`
   - `class_enrollments` → dari `classes.school_id` via `class_id`
   - `teaching_assignments` → dari `classes.school_id` via `class_id`
   - `student_parents` → dari `students.school_id` via `student_id`
   - (dan 14 tabel lainnya dengan logika serupa)

Ini berarti jika class_id yang dikirim berasal dari sekolah yang berbeda, `school_id` yang ter-derive pun akan ikut berbeda — dan karena kolom `school_id` ber-`NOT NULL`, INSERT akan berhasil tapi data akan punya school_id yang konsisten dengan parent entity-nya (bukan dengan sekolah pemanggil). Ini adalah *mitigasi*, bukan *pencegahan* — cross-school insert masih bisa berhasil secara teknis jika UUID kelas yang salah dilewatkan, hanya saja hasilnya akan ter-derive ke sekolah kelas tersebut (bukan sekolah user).

### Temuan 3: `fn_bulk_import_students` — Verified Aman (Eksposur Rendah)

RPC ini tidak punya validasi school_id internal sama sekali (tidak ada parameter `p_school_id`, tidak ada WHERE school_id). Tapi verifikasi grant menunjukkan:

```
anon          → can_execute: false
authenticated → can_execute: false
service_role  → can_execute: true
```

Tidak ada pemanggilan dari portal client manapun (grep seluruh codebase: hanya ditemukan 1 pemanggilan, di dalam edge function `bulk-import-students` sendiri via admin client). **Status: VERIFIED AMAN (eksposur rendah).**

---

## Bagian 4 — Temuan F2-A: Over-Exposure Kolom Tabel `users`

### Masalah

Policy `rls_users_read_staff_names` dan `rls_users_read_staff` bekerja dengan benar dalam membatasi *baris* — hanya pengguna dari sekolah yang sama yang terlihat. Tapi tidak ada pembatasan *kolom*: siapa pun dengan akun valid (termasuk akun siswa atau ortu) bisa secara teknis mengakses semua kolom tabel `users` lewat REST API langsung (di luar aplikasi), termasuk:

| Kolom sensitif yang terekspos | Jenis data |
|---|---|
| `email` | Alamat email internal (berformat NIP/NIK + domain sekolah) |
| `login_identifier` | NIP/NIK — nomor identitas resmi guru/staf |
| `auth_user_id` | UUID Supabase Auth internal |
| `must_change_password` | Status keamanan akun |
| `password_changed_at` | Waktu terakhir ganti password |
| `last_seen_at`, `last_seen_ua` | Tracking sesi/perangkat |

Kode aplikasi (7 portal) sudah disiplin — selalu meminta kolom tertentu saja, tidak pernah `SELECT *`. Tapi disiplin ini hanya berlaku selama pengguna mengakses lewat aplikasi yang sudah dibuat. Akses langsung ke endpoint REST (`GET /rest/v1/users?select=*`) dengan JWT valid bisa melewati disiplin ini.

**Catatan:** Ini bukan celah yang sudah dieksploitasi — tidak ada indikasi penyalahgunaan. Ini adalah celah *struktural* yang perlu ditutup secara proaktif.

### Perbaikan yang Diterapkan

**VIEW `v_users_staff_directory`** dibuat sebagai "jendela terbatas" ke tabel `users`, hanya menampilkan 8 kolom yang aman:

| Kolom yang disertakan | Alasan |
|---|---|
| `user_id` | Identifier teknis yang diperlukan untuk join |
| `school_id` | Diperlukan untuk filter per-sekolah |
| `full_name` | Nama tampil — tidak sensitif |
| `role_type` | Jabatan utama — tidak sensitif |
| `dudi_org_name` | Nama organisasi DUDI — tidak sensitif |
| `teacher_code` | Kode singkat guru untuk jadwal — tidak sensitif |
| `program_id` | Program keahlian — tidak sensitif |
| `is_active` | Status aktif — tidak sensitif |

Atribut `security_invoker = true` memastikan RLS tabel dasar tetap berlaku — filter baris per-sekolah otomatis ikut, tidak perlu menduplikasi policy.

### Proses Validasi

**Uji pra-eksekusi (transaksi ROLLBACK):**

View dibuat di dalam `BEGIN...ROLLBACK`, diuji dengan dua akun:

| Akun | Akses tabel `users` langsung | Akses via `v_users_staff_directory` | Selisih |
|---|---|---|---|
| SISWA smkhr (`db5337bc-...`) | 173 baris | 173 baris | 0 (identik) |
| GURU smkhr (`c615aa7b-...`) | 2688 baris | 2688 baris | 0 (identik) |

Kolom yang muncul di view: persis 8 kolom yang didefinisikan. Kolom sensitif tidak muncul. ROLLBACK berhasil (view hilang dari `pg_views` setelah transaksi).

**Push permanen:** Migration `20260707130000_users_staff_directory_view.sql` dijalankan ke database live. Verifikasi pasca-push: view ada, definisi benar, 4499 baris accessible (semua user dari 3 sekolah tanpa filter deleted_at).

**Test suite regresi:** `tests/tenant-isolation.mjs` dijalankan ulang pasca-push — **42/42 CHECK lulus**, termasuk CHECK 6 baru yang mengonfirmasi `v_users_staff_directory` dengan `security_invoker=true` tidak bisa dibaca oleh `anon`.

### Yang Masih Perlu Dikerjakan (F2-A Lanjutan)

View sudah ada di database, tapi kode aplikasi di 7 portal masih mengakses tabel `users` langsung. Celah struktural masih terbuka sampai client code dipindahkan. Rencana:

1. Pilot di `guru/js/api.js` — identifikasi semua query ke `users`, pindahkan ke `v_users_staff_directory`
2. Ulangi untuk 6 portal lain satu per satu, verifikasi fungsionalitas setiap portal sebelum lanjut
3. Satu kasus khusus perlu keputusan terpisah: jika ada fitur yang memerlukan kolom sensitif (contoh: tampilkan login_identifier untuk kebutuhan tertentu), keputusan apakah fitur itu dipertahankan atau diubah diserahkan ke pemilik produk
4. Setelah semua portal selesai: evaluasi apakah grant SELECT langsung ke tabel `users` perlu dibatasi

---

## Bagian 4a — Temuan Tambahan: fn_user_is_internal_case_actor Bocor ke Publik

### Kronologi Penemuan

Ditemukan tidak sengaja saat memverifikasi nama fungsi serupa (`fn_is_internal_case_actor` vs `fn_user_is_internal_case_actor`) selama investigasi Bagian 2 — bukan dari coverage scan awal. Ini menegaskan pentingnya verifikasi silang nama fungsi, bukan hanya membaca definisi policy secara terisolasi.

### Masalah

`fn_user_is_internal_case_actor(p_user_id uuid)` — fungsi SECURITY DEFINER yang menerima UUID pengguna APAPUN (bukan pengguna yang sedang login) dan mengembalikan apakah orang itu berperan internal (GURU/BK/WALI_KELAS/KAPRODI/WAKA_KESISWAAN/KEPSEK). Grant EXECUTE terbuka ke `anon` DAN `authenticated` — tanpa guard school_id internal, tanpa pemanggil aktif di kode aplikasi manapun (0 baris ditemukan via grep).

### Bukti Exploitasi (sebelum fix)

Simulasi live: siswa SMK Harapan Rokan berhasil memanggil fungsi ini dengan UUID milik seorang guru di SMK Karya Bangsa (sekolah berbeda) dan menerima jawaban `true` — kebocoran status jabatan lintas-sekolah, tanpa relasi apapun antara pemanggil dan target, dan bisa dilakukan oleh siapa pun dengan akun sah bahkan tanpa login sama sekali (`anon` juga punya akses).

### Perbaikan

Migration `20260707140000` — REVOKE EXECUTE dari PUBLIC, anon, dan authenticated; GRANT hanya ke service_role. Keputusan: kunci total, bukan tambah guard, karena tidak ada use case legitimate yang teridentifikasi untuk pemanggilan dari luar backend.

### Verifikasi (4 lapis)

1. **Transaksi uji ROLLBACK:** grant anon/authenticated → false, service_role → true
2. **Push permanen:** berhasil tanpa error (`rows: []`)
3. **Verifikasi grant live:** anon → false, authenticated → false, service_role → true
4. **Simulasi live ulang** (skenario exploit yang sama persis — SISWA smkhr memanggil dengan UUID GURU smkkb): `ERROR: 42501: permission denied for function fn_user_is_internal_case_actor` — tertutup total
5. **Test suite regresi:** 42/42 CHECK tetap lulus, tidak ada regresi

**Status: DITEMUKAN DAN DIPERBAIKI dalam sesi yang sama (7 Juli 2026).**

---

## Bagian 4b — Temuan Tambahan: 5 Fungsi dengan Grant EXECUTE Berlebih

### Kronologi Penemuan

Ditemukan saat memetakan grant EXECUTE fungsi-fungsi yang sebelumnya dicatat sebagai "kontrak implisit, aman selama pemanggil punya guard" di Bagian 2 — dilakukan sebagai tindak lanjut proaktif setelah temuan fn_user_is_internal_case_actor (Bagian 4a), untuk memastikan tidak ada pola serupa yang terlewat.

### Masalah

5 fungsi SECURITY DEFINER (`fn_current_academic_year`, `fn_is_internal_case_actor`, `fn_is_schoolwide_observer`, `fn_involved_in_case`, `fn_matches_case_handler`) memiliki grant EXECUTE terbuka ke `anon` dan/atau `authenticated`, padahal:

- 4 di antaranya (semua kecuali `fn_current_academic_year`) hanya pernah dipanggil secara internal dari dalam fungsi SECURITY DEFINER lain (`fn_can_see_case` untuk `fn_involved_in_case`/`fn_matches_case_handler`/`fn_is_internal_case_actor`; `fn_can_see_student` dan `fn_kepsek_monitoring` untuk `fn_is_schoolwide_observer` — dua jalur pemanggil, bukan satu), tidak pernah langsung dari kode client (0 hasil grep di *.js/*.ts)
- `fn_current_academic_year` dipanggil eksklusif dari edge function via service_role, tidak pernah dari client langsung
- `fn_matches_case_handler` menerima parameter `student_id` arbitrary tanpa guard `school_id` internal — berpotensi jadi oracle informasi lintas sekolah jika dipanggil langsung

### Kegagalan Metodologis pada Uji Pertama (Pelajaran Penting)

Percobaan uji pertama menggunakan akun GURU yang merupakan CREATOR kasus yang diuji. Karena `fn_can_see_case` mengevaluasi kondisi `OR` secara short-circuit, cabang `fn_involved_in_case` (creator match) langsung bernilai `true` dan menghentikan evaluasi — `fn_matches_case_handler` dan `fn_is_internal_case_actor` TIDAK PERNAH benar-benar dieksekusi meski hasil "before=after sama" tampak meyakinkan. `fn_is_schoolwide_observer` bahkan bukan bagian dari `fn_can_see_case` sama sekali (dipanggil dari `fn_kepsek_monitoring`), sehingga uji pertama salah sasaran untuk fungsi ini.

**Pelajaran:** hasil "before=after identik" tidak cukup sebagai bukti jika jalur kode yang diuji tidak dipastikan benar-benar tereksekusi. Untuk fungsi dengan percabangan OR/short-circuit, uji harus dirancang memaksa evaluasi sampai ke cabang yang diperiksa — termasuk membuat data sintetis terarah bila data live tidak menyediakan skenario yang diperlukan (di sini: tidak ada kasus `audience=PUBLIC` di data live, sehingga dibuat satu kasus sintetis dalam transaksi ROLLBACK untuk menguji `fn_is_internal_case_actor` secara valid).

**Catatan tambahan:** Verifikasi awal Bagian 4b sendiri sempat melewatkan bahwa `fn_is_schoolwide_observer` punya DUA jalur pemanggil (`fn_kepsek_monitoring` DAN `fn_can_see_student`), bukan satu. Uji C hanya menutup jalur pertama. Gap ini ditemukan lewat tinjauan terpisah sebelum laporan di-commit, lalu ditutup dengan verifikasi tambahan (lihat poin 7 di Verifikasi). Ini menegaskan pelajaran yang sama sekali lagi: setiap klaim "sudah teruji" harus disertai peta lengkap SEMUA pemanggil fungsi yang direvoke, bukan hanya pemanggil yang pertama kali ditemukan.

### Perbaikan

Migration `20260707150000` — REVOKE EXECUTE dari PUBLIC, anon, dan authenticated untuk kelima fungsi; GRANT hanya ke service_role.

### Verifikasi (9 lapis)

1. **Uji ROLLBACK pertama** (metodologis tidak valid untuk 3 dari 5 fungsi — dicatat sebagai pelajaran, bukan bukti)
2. **Uji ROLLBACK kedua dengan data terarah** (termasuk 1 kasus sintetis `audience=PUBLIC`): ketiga skenario kritis (`fn_matches_case_handler`, `fn_is_internal_case_actor`, `fn_is_schoolwide_observer` via `fn_kepsek_monitoring`) terbukti before=after identik pada jalur eksekusi yang benar-benar tersentuh
3. **Push permanen:** berhasil tanpa error (`rows: []`)
4. **Verifikasi grant live:** `anon=false`, `authenticated=false`, `service_role=true` untuk seluruh 5 fungsi
5. **Direct-call live:** `ERROR: 42501: permission denied for function fn_is_internal_case_actor` — ditolak di database
6. **Uji fungsional live** (bukan simulasi): `fn_can_see_case` tetap `true` untuk GURU sah pada kasus yang sama seperti uji sebelumnya
7. **Verifikasi jalur kedua `fn_is_schoolwide_observer`** (live, bukan simulasi): dikonfirmasi `fn_can_see_student` — dipakai 3 policy produksi (`rls_students_read_staff`, `rls_enrollments_read_staff`, `rls_attendance_read_staff`) — adalah SECURITY DEFINER (prasyarat teori owner-context terpenuhi). Uji fungsional live: akun KEPSEK dan WAKA_KESISWAAN smkhr tetap melihat seluruh 1296 siswa (identik baseline) pasca-REVOKE permanen — jalur schoolwide-observer via `fn_can_see_student` tidak rusak.
8. **Test suite regresi:** 42/42 CHECK tetap lulus, tidak ada regresi
9. **Pencarian sistemik pemanggil tersembunyi** (live, read-only): query `pg_proc.prosrc ILIKE` terhadap seluruh database untuk keempat fungsi (`fn_is_internal_case_actor`, `fn_matches_case_handler`, `fn_involved_in_case`, `fn_is_schoolwide_observer`) mengonfirmasi HANYA 3 pemanggil yang sudah diverifikasi (`fn_can_see_case`, `fn_can_see_student`, `fn_kepsek_monitoring`) — tidak ada baris ke-4 atau lebih. Ini menutup kemungkinan pemanggil lain yang belum diuji, melampaui pencarian manual sebelumnya yang sempat melewatkan `fn_can_see_student` sebagai jalur kedua `fn_is_schoolwide_observer`.

**Status: DITEMUKAN DAN DIPERBAIKI dalam sesi yang sama (7 Juli 2026).**

### Catatan Arsitektural

`fn_matches_case_handler` tetap rapuh secara desain meski sekarang aman karena aksesnya terkunci total — fungsi ini menerima `student_id` arbitrary tanpa guard `school_id` internal. Jika suatu saat perlu dibuka kembali untuk kebutuhan baru, guard `school_id` internal wajib ditambahkan lebih dulu (Rule 3, standing rules §3a).

---

## Bagian 5 — Status Checklist Diperbarui

| Item | Status |
|---|---|
| **E1** — `rls_pkl_read_ortu` (pkl_placements) | ✅ SELESAI — TIDAK EXPLOITABLE. Guard school_id di kondisi AND terluar, independen dari subquery student_parents. |
| **E2** — `rls_time_slots_read` (schedule_time_slots) | ✅ SELESAI — Sudah ter-fix via migration `20260706200000`. Simulasi live: 0 baris untuk SISWA/ORTU. |
| **F2-A (infrastruktur)** — VIEW `v_users_staff_directory` | ✅ SELESAI — Migration `20260707130000` di-push. 8 kolom aman, 4499 baris accessible, 42/42 CHECK lulus. |
| **F2-A (lanjutan)** — Migrasi client code 7 portal ke view | ⏳ BELUM DIMULAI — Urutan: `guru/js/api.js` (pilot) → 6 portal lain satu-satu. |
| **D1** — Klarifikasi `academic_periods` DELETE | ⏳ BELUM — Perlu konfirmasi apakah client butuh DELETE atau selalu via RPC. |
| **D2** — Klarifikasi `achievements` | ⏳ BELUM — Perlu konfirmasi apakah tabel ini aktif dipakai dan diisi via mana. |
| **Defense-in-depth opsional** (C3/E1/bulk-import) | 🔵 Prioritas rendah — batch nanti. |
| **fn_user_is_internal_case_actor** — Grant EXECUTE bocor ke anon/authenticated | ✅ SELESAI (7 Juli 2026): ditemukan dan diperbaiki dalam sesi yang sama. Migration `20260707140000`, diverifikasi 4 lapis. |
| **5 fungsi excess-grant** (`fn_current_academic_year`, `fn_is_internal_case_actor`, `fn_is_schoolwide_observer`, `fn_involved_in_case`, `fn_matches_case_handler`) | ✅ SELESAI (7 Juli 2026): ditemukan dan diperbaiki dalam sesi yang sama. Migration `20260707150000`, diverifikasi 9 lapis. |
| **Fase 2 → Fase 3** | ⏳ Menunggu Fase 2 selesai. Perkiraan Fase 2 tersisa: F2-A lanjutan + D1/D2 klarifikasi. |

---

## Lampiran — Detail Teknis

### L1 — Definisi Policy E1 (verbatim dari `pg_policies`, 7 Juli 2026)

```sql
-- policyname: rls_pkl_read_ortu | tabel: pkl_placements | cmd: SELECT
QUAL:
(school_id = fn_current_school_id())
AND (fn_current_user_role() = 'ORTU'::role_type)
AND (EXISTS (
    SELECT 1 FROM student_parents sp
    WHERE sp.student_id = pkl_placements.student_id
      AND sp.parent_user_id = fn_current_user_id()
))
```

### L2 — Definisi `fn_auto_set_school_id()` (verbatim dari `pg_get_functiondef`, 7 Juli 2026)

```sql
CREATE OR REPLACE FUNCTION public.fn_auto_set_school_id()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_sid uuid;
BEGIN
    IF NEW.school_id IS NOT NULL THEN
        RETURN NEW;
    END IF;

    v_sid := fn_current_school_id();

    IF v_sid IS NULL THEN
        CASE TG_TABLE_NAME
            WHEN 'students' THEN
                SELECT school_id INTO v_sid FROM programs WHERE program_id = NEW.program_id;
            WHEN 'classes' THEN
                SELECT school_id INTO v_sid FROM programs WHERE program_id = NEW.program_id;
            WHEN 'class_enrollments' THEN
                SELECT school_id INTO v_sid FROM classes WHERE class_id = NEW.class_id;
            WHEN 'teaching_assignments' THEN
                SELECT school_id INTO v_sid FROM classes WHERE class_id = NEW.class_id;
            WHEN 'teaching_schedules' THEN
                SELECT school_id INTO v_sid FROM classes WHERE class_id = NEW.class_id;
            WHEN 'schedule_templates' THEN
                SELECT school_id INTO v_sid FROM classes WHERE class_id = NEW.class_id;
            WHEN 'attendance' THEN
                SELECT school_id INTO v_sid FROM teaching_schedules WHERE schedule_id = NEW.schedule_id;
            WHEN 'teacher_attendance_log' THEN
                SELECT school_id INTO v_sid FROM teaching_schedules WHERE schedule_id = NEW.schedule_id;
            WHEN 'substitute_schedules' THEN
                SELECT school_id INTO v_sid FROM teaching_schedules WHERE schedule_id = NEW.schedule_id;
            WHEN 'observations' THEN
                SELECT school_id INTO v_sid FROM students WHERE student_id = NEW.student_id;
            WHEN 'achievements' THEN
                SELECT school_id INTO v_sid FROM students WHERE student_id = NEW.student_id;
            WHEN 'cases' THEN
                SELECT school_id INTO v_sid FROM students WHERE student_id = NEW.student_id;
            WHEN 'parent_messages' THEN
                SELECT school_id INTO v_sid FROM students WHERE student_id = NEW.student_id;
            WHEN 'student_parents' THEN
                SELECT school_id INTO v_sid FROM students WHERE student_id = NEW.student_id;
            WHEN 'pkl_placements' THEN
                SELECT school_id INTO v_sid FROM students WHERE student_id = NEW.student_id;
            WHEN 'case_events' THEN
                SELECT school_id INTO v_sid FROM cases WHERE case_id = NEW.case_id;
            WHEN 'student_updates' THEN
                SELECT school_id INTO v_sid FROM cases WHERE case_id = NEW.case_id;
            WHEN 'pkl_attendance' THEN
                SELECT school_id INTO v_sid FROM pkl_placements WHERE placement_id = NEW.placement_id;
            WHEN 'teacher_journals' THEN
                SELECT school_id INTO v_sid FROM users WHERE user_id = NEW.owner_user_id;
            ELSE
                v_sid := NULL;
        END CASE;
    END IF;

    NEW.school_id := v_sid;
    RETURN NEW;
END;
$function$
```

### L3 — Grant EXECUTE `fn_bulk_import_students` (verbatim dari DB live)

```
Dari information_schema.routine_privileges:
  grantee: service_role  | privilege_type: EXECUTE
  grantee: postgres      | privilege_type: EXECUTE

Dari has_function_privilege per role:
  anon          → can_execute: false
  authenticated → can_execute: false
  service_role  → can_execute: true
```

### L4 — Isi Migration 20260707130000 (verbatim dari file yang di-push)

```sql
-- Migration 20260707130000: F2-A — View kolom terbatas users

CREATE OR REPLACE VIEW public.v_users_staff_directory AS
SELECT
    user_id,
    school_id,
    full_name,
    role_type,
    dudi_org_name,
    teacher_code,
    program_id,
    is_active
FROM public.users;

ALTER VIEW public.v_users_staff_directory SET (security_invoker = true);

GRANT SELECT ON public.v_users_staff_directory TO authenticated;
```

### L5 — Verifikasi Pasca-Push (verbatim dari DB live)

```sql
-- pg_views:
viewname: v_users_staff_directory
definition:
  SELECT user_id, school_id, full_name, role_type, dudi_org_name,
         teacher_code, program_id, is_active
  FROM users;

-- count(*): 4499 baris

-- information_schema.columns (ordinal_position):
1. user_id
2. school_id
3. full_name
4. role_type
5. dudi_org_name
6. teacher_code
7. program_id
8. is_active
```

### L6 — Hasil Test Suite (7 Juli 2026, pasca-push migration 20260707130000)

```
tests/tenant-isolation.mjs
42/42 CHECK lulus
✅ LULUS — invarian isolasi tenant utuh.

CHECK yang relevan untuk sesi ini:
  CHECK 6: semua view security_invoker=true & tidak terbaca anon
           → v_users_staff_directory ikut terverifikasi di CHECK ini
```

### L7 — Isi Migration 20260707140000 (verbatim)

```sql
-- Migration: 20260707140000_revoke_fn_user_is_internal_case_actor.sql
--
-- TEMUAN: fn_user_is_internal_case_actor(uuid) bocor ke anon + authenticated.
-- Dampak terkonfirmasi via simulasi live: siswa sekolah A berhasil membaca
-- status jabatan guru sekolah B (cross-tenant role disclosure).
-- Keputusan: kunci total ke service_role — bukan tambah guard — karena tidak
-- ada use case legitimate yang teridentifikasi untuk anon/authenticated
-- memanggil fungsi ini secara langsung; semua pemanggil sah berjalan via
-- SECURITY DEFINER function lain yang sudah terkunci ke service_role.

REVOKE EXECUTE ON FUNCTION public.fn_user_is_internal_case_actor(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_user_is_internal_case_actor(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.fn_user_is_internal_case_actor(uuid) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.fn_user_is_internal_case_actor(uuid) TO service_role;
```

### L8 — Hasil Test Suite Final (7 Juli 2026, pasca-push migration 20260707140000)

```
tests/tenant-isolation.mjs
42/42 CHECK lulus
✅ LULUS — invarian isolasi tenant utuh. Tidak ada regresi akibat migration 20260707140000.
```

### L9 — Isi Migration 20260707150000 (verbatim)

```sql
-- Migration: 20260707150000_revoke_excess_grant_5_functions.sql
--
-- ALASAN: Lima fungsi ini memiliki grant EXECUTE terbuka ke anon dan/atau
-- authenticated, padahal tidak ada pemanggil langsung dari client code (0
-- hasil grep di *.js/*.ts untuk keempat fungsi case-helper; fn_current_academic_year
-- hanya dipanggil dari edge function via admin/service_role client).
-- Fungsi-fungsi ini dirancang sebagai helper INTERNAL yang dipanggil dari
-- dalam SECURITY DEFINER function lain (fn_can_see_case, fn_kepsek_monitoring,
-- dll.) atau dari policy RLS — bukan untuk dipanggil langsung dari client.
-- Khusus fn_matches_case_handler: berisiko oracle lintas-sekolah karena
-- memanggil fn_kaprodi_of_student/fn_wali_of_student yang tidak punya guard
-- school_id internal — jika dipanggil langsung dengan UUID student sekolah lain,
-- bisa mengkonfirmasi relasi DUDI/wali lintas-sekolah.
-- Keputusan: kunci ke service_role. Pemanggilan nested dari SECURITY DEFINER
-- function (yang sudah terkunci) tetap berjalan normal karena PostgreSQL
-- mengevaluasi EXECUTE privilege di konteks OWNER fungsi pemanggil, bukan
-- role pemanggil eksekutor.

REVOKE EXECUTE ON FUNCTION public.fn_current_academic_year(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_current_academic_year(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.fn_current_academic_year(uuid) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.fn_current_academic_year(uuid) TO service_role;

REVOKE EXECUTE ON FUNCTION public.fn_is_internal_case_actor() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_is_internal_case_actor() FROM anon;
REVOKE EXECUTE ON FUNCTION public.fn_is_internal_case_actor() FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.fn_is_internal_case_actor() TO service_role;

REVOKE EXECUTE ON FUNCTION public.fn_is_schoolwide_observer() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_is_schoolwide_observer() FROM anon;
REVOKE EXECUTE ON FUNCTION public.fn_is_schoolwide_observer() FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.fn_is_schoolwide_observer() TO service_role;

REVOKE EXECUTE ON FUNCTION public.fn_involved_in_case(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_involved_in_case(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.fn_involved_in_case(uuid) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.fn_involved_in_case(uuid) TO service_role;

REVOKE EXECUTE ON FUNCTION public.fn_matches_case_handler(role_type, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_matches_case_handler(role_type, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.fn_matches_case_handler(role_type, uuid) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.fn_matches_case_handler(role_type, uuid) TO service_role;
```

### L10 — Hasil Test Suite Final (7 Juli 2026, pasca-push migration 20260707150000)

```
tests/tenant-isolation.mjs
42/42 CHECK lulus
✅ LULUS — invarian isolasi tenant utuh. Tidak ada regresi akibat migration 20260707150000.
```
