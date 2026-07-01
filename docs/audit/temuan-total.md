# Temuan Total — Audit Platform Sekolah SMK

**Dokumen ditulis: 1 Juli 2026.**
Periode audit yang dirangkum: 1 Juli 2026.
Metode: telaah statik read-only (migrasi RLS/multi-tenant, helper functions, edge functions, pipeline jadwal→penugasan→absensi, seluruh portal aktor + `shared/` + `contracts/` + `sw.js`) ditambah satu pemeriksaan runtime read-only (anon REST `schools`). **Tidak ada perubahan kode aplikasi dilakukan** — dokumen ini murni laporan untuk ditindaklanjuti.

Dokumen ini menggabungkan beberapa lintasan audit yang sebelumnya terpisah, kini jadi satu dokumen temuan tunggal:
- **Bagian 1 — Bug Multi-Tenant & RLS** (sisi-server): C1, C2, H1–H3, M1–M3.
- **Bagian 2 — Re-audit Menyeluruh Portal Aktor (lensa A–H)** (sisi-klien): J1–J11 + Audit Level F lengkap (F-1…F-5).
- **Bagian 3 — Audit Local-First** (prinsip arsitektur): LF-1…LF-8.
- **Bagian 4 — Audit Installable (PWA) + atom Responsive** (statik + bukti runtime): IN-1…IN-3, FE-tabel, Responsive #7.

> **Konteks.** Master summary (`00-master-summary.md`, kondisi Juni 2025) **diabaikan sebagai status** — menyesatkan. Audit awal (24 Juni 2025, Level A–G + F2) hanya menelaah **console Admin**; portal aktor belum dibangun saat itu. Bagian 1 dilakukan SETELAH Fase 1 multi-tenant (`school_id` + RLS, migrasi `2026070111xxxx`–`2026070113xxxx`) & Fase 3 branding, dan menemukan klaim "SELESAI" hanya benar parsial. Bagian 2 menutup gap "portal aktor belum pernah diaudit formal".

---

## Ringkasan Severitas (gabungan)

| # | Temuan | Lensa | Severitas |
|---|---|---|---|
| **C1** | Semua RPC `SECURITY DEFINER` + edge function service-role menulis tanpa `school_id` → gagal `NOT NULL` | — | 🔴 CRITICAL → ✅ **FIXED** (1 Juli) |
| **C2** | Resolusi data lintas-tenant di edge function (lookup & `.single()` tak discope `school_id`) | — | 🔴 CRITICAL → ✅ **FIXED** (1 Juli) |
| **J1** | Kontrak offline tidak terpasang di portal mana pun — fitur WAJIB "absensi saat internet mati" tetap kosong; data bisa hilang diam-diam | E, A | 🔴 CRITICAL |
| **LF-1** | Inversi arsitektur: semua portal **Server-First** (`await server → UI`), kebalikan persis dari prinsip local-first yang ditetapkan platform; desain local-first lengkap ada tapi nol implementasi | Local-First | 🔴 CRITICAL |
| **H1** | Isolasi WALI_KELAS & KAPRODI belum tuntas — observasi/kasus/absensi/prestasi/enrolmen masih sekolah-wide | D | 🟠 HIGH → ✅ **FIXED** (1 Juli) |
| **H2** | `fn_kaprodi_program_id()` membaca kolom salah (`program_id` vs `kaprodi_program_id`) | D | 🟠 HIGH → ✅ **FIXED** (1 Juli) |
| **H3** | Flag jabatan multi-role (`is_bk`, `is_kepsek`, `is_waka_*`) tak pernah dibaca RLS (baca) | D | 🟠 HIGH → ✅ **FIXED** (baca; 1 Juli) |
| **J2** | Superadmin tidak bisa melihat daftar sekolah (regresi RLS tenant-isolation) — terkonfirmasi runtime | B, D | 🟠 HIGH → ✅ **FIXED** (1 Juli) |
| **J3** | Rekap kehadiran dihitung pada sumbu tanggal yang salah (`created_at`), tidak konsisten antar portal | C, F2 | 🟠 HIGH → ✅ **FIXED** (1 Juli) |
| **M1** | Policy INSERT terlalu longgar (achievements/cases/case_events/student_updates) tanpa cek peran | D | 🟡 MEDIUM |
| **M2** | Daftar jadwal guru (by `scheduled_teacher_id`) vs RLS absensi (by `teaching_assignment`) bisa mismatch | C, D | 🟡 MEDIUM → ✅ **FIXED** (1 Juli) |
| **M2b** | (Ditemukan saat verifikasi M2) Jalur simpan absensi guru punya 2 bug laten (belum kena krn attendance=0): `recorded_by_user_id` NOT NULL tak terisi; portal kirim `source='MANUAL'` (enum tak valid) | C | 🟠 HIGH → ✅ DB fixed; ⏳ frontend belum deploy |
| **J4** | Tab "Waka Kesiswaan" placeholder mati ditampilkan ke pengguna nyata | A, F2 | 🟡 MEDIUM |
| **J5** | `login_identifier` DUDI diekspos sebagai kolom di tab Kaprodi | D | 🟡 MEDIUM |
| **J6** | Portal aktor (mobile-first) tidak menerapkan prinsip Level H (bottom-nav / exception-first / primary-action-first) | H | 🟡 MEDIUM |
| **J10** | Jadwal `scheduled_teacher_id` vs RLS absensi `teaching_assignment` — dikonfirmasi di kode portal (menguatkan M2) | D, C | 🟡 MEDIUM |
| **J11** | Pasangan warna gagal-kontras (Level G admin) direplikasi di 6 portal terang, tepat pada badge kehadiran; superadmin pakai palet beda (tema gelap) | G, F2 | 🟡 MEDIUM |
| **F-1** | Pesan error mentah (`err.message` teknis Supabase/RLS/JWT) bocor ke pengguna akhir di semua portal | F | 🟡 MEDIUM |
| **F-2** | Input `font-size:14px` (<16px) di keenam portal → HP auto-zoom saat field difokus (portal justru mobile-first) | F (Mobile) | 🟡 MEDIUM |
| **M3** | `shared/branding.js` `_applyToDom` menghilangkan atribut `data-brand` logo saat apply ganda | — | 🟢 LOW |
| **J7** | Umpan balik pakai `alert()`/`confirm()` native, tak konsisten dgn pola status in-page | F | 🟢 LOW |
| **J8** | Superadmin: master key di `sessionStorage` + verifikasi via efek samping | D | 🟢 LOW |
| **J9** | Sumbu tanggal observasi tampil tidak konsisten (`observed_at` vs `created_at`) | F2 | 🟢 LOW |
| **F-3** | Touch target kecil: `.btn-sm`/`.btn-xs` (~26–30px) < ~44px; "Input Kehadiran" & radio absensi guru | F (Mobile) | 🟢 LOW |
| **F-4** | Istilah status tak konsisten lintas portal: "Alpha" (guru/siswa) vs "Tidak Hadir" (ortu/dudi) untuk `TIDAK_HADIR` | F (Bahasa), F2 | 🟢 LOW |
| **F-5** | Tombol baca tanpa state proses (Muat/Filter di siswa/ortu) + tab "Dashboard Guru" campur 2 tugas (jadwal+observasi) | F (Tombol, Beban Kognitif) | 🟢 LOW |
| **LF-2** | Tak ada lapisan baca lokal (`sync_cache`) → tiap buka tab = baca network + spinner; ideal "no spinner / instan" gagal, baca offline = kosong | Local-First | 🟠 HIGH |
| **LF-3** | Optimistic-UI belum ada; bila ditambahkan tanpa fix C1/H3/M2 dulu → "Tersimpan" palsu padahal sync ditolak RLS (kehilangan data senyap). Local-first mensyaratkan write-path benar | Local-First | 🟠 HIGH |
| **LF-6** | Tak ada kebijakan data sensitif di perangkat: `logout()` hanya `signOut()`, tak purge IndexedDB; tak ada wipe-on-logout/enkripsi/skenario perangkat-hilang | Local-First, D | 🟡 MEDIUM |
| **LF-7** | Token sync disimpan statis di memori SW (`getToken: ()=>token`) → tak refresh; offline lama → token kedaluwarsa → sync 401 → item ke dead_letter | Local-First | 🟡 MEDIUM |
| **LF-4/5/8** | Pemisahan Category A/B belum tercermin di kode; kasus belum punya UI (jalur offline kasus tanpa konsumen); migrasi major menghapus antrian belum-sync | Local-First | 🟡 MEDIUM |
| **IN-1** | Identitas PWA hardcoded single-tenant ("SMK Harapan Rokan" + theme statis) di ke-6 manifest → app terinstal tampil identitas sekolah-A untuk semua tenant | Installable | 🟡 MEDIUM |
| **IN-2** | Path aset relatif (`css/…`,`manifest.json`) patah tanpa trailing slash → portal unstyled + manifest 404 (**terbukti runtime**); tertutup redirect GitHub Pages, patah di host lain | Installable, Responsive | 🟡 MEDIUM |
| **FE-tabel** | Tabel responsif menyembunyikan **header saja** (`th:nth-child`), td tak ikut → kolom misalign di mobile (siswa & ortu) | Responsive (Tables) | 🟡 MEDIUM |
| **IN-3** | Ikon hanya SVG `sizes:"any"` (tak ada PNG 192/512); `theme_color` manifest ≠ warna app; tak ada `id` | Installable | 🟢 LOW |
| **Resp-7** | Login numerik (NIP/NIK/NIS) `type=text` tanpa `inputmode` → keyboard HP salah (**terbukti runtime**) | Responsive (Forms) | 🟢 LOW |

---
---

# BAGIAN 1 — Bug Multi-Tenant & RLS (sisi-server)

Telaah statik atas migrasi RLS/multi-tenant, helper functions, edge functions (penanganan tenant), pipeline jadwal→penugasan→absensi, dan jalur tulis portal guru.

## 🔴 C1 — Jalur tulis sisi-server patah pasca Fase 1 (`school_id` NOT NULL)

> ✅ **STATUS: FIXED (1 Juli 2026).** Perbaikan diterapkan LIVE + terverifikasi runtime:
> - **Migrasi `20260701250000_smart_auto_school_id`** — `fn_auto_set_school_id` kini, di jalur service-role (`auth.uid()`=NULL), **mewarisi `school_id` dari baris induk via FK** (siswa←program, kelas←program, absensi←jadwal, dst). Jalur JWT portal tak berubah. *Bukti:* insert siswa uji tanpa `school_id` (via Management API = kondisi service-role) → `school_id` terisi otomatis `…0001`.
> - **Migrasi `20260701260000_buka_tahun_tenant_aware`** — `fn_buka_tahun_ajaran` stamp `school_id` pada `academic_periods` (tabel tanpa induk) dari `p_config_id`.
> - **Migrasi `20260701270000_apply_schedule_tenant_aware`** — `fn_apply_schedule_templates` stamp `school_id` eksplisit (subjects/assignments/schedules). *Bukti:* RPC dijalankan live → 1330 template, 369 assignment ter-upsert, 0 error NOT NULL.
> - **Edge functions** (`auth.ts` kini mengembalikan `school_id`; stamp eksplisit pada tabel tanpa induk): `bulk-import-programs` (programs), `bulk-import-users`/`-parents`/`-dudi` + `provision-student-accounts` (users). Semua ter-deploy.
> - *Bukti gabungan:* `fn_bulk_import_students` dijalankan live → success=1, siswa+enrolmen keduanya `school_id` terisi. Data uji dihapus.
> - **Residual (belum):** `sync-attendance-batch` (`sync_idempotency` tanpa induk) — ditunda karena sinkronisasi offline belum dibangun (lihat J1/LF-1).

**Akar masalah.** Migrasi `20260701110000_add_school_id_to_tables.sql` menetapkan `school_id` **NOT NULL tanpa default** pada seluruh tabel, lalu pengisian diserahkan ke trigger `fn_auto_set_school_id` (`20260701120000_school_id_functions_triggers.sql`) yang mengambil dari `fn_current_school_id()` → berbasis `auth.uid()`.

Trigger itu **hanya berfungsi untuk klien yang membawa JWT user.** Seluruh penulisan sisi-server memakai **service role** (`supabase/functions/_shared/db.ts` → `getAdminClient`), di mana `auth.uid()` = NULL → `fn_current_school_id()` = NULL → `NEW.school_id` = NULL → **pelanggaran NOT NULL → INSERT gagal.** (`SECURITY DEFINER` tidak menolong: ia mengubah privilege eksekusi, bukan klaim JWT.)

**Terkonfirmasi tidak satu pun menyetel `school_id`:**

| RPC / fungsi | Tabel target | Lokasi |
|---|---|---|
| `fn_bulk_import_students` | `students`, `class_enrollments` | `supabase/migrations/20240201000001_bulk_import_students.sql:34,43` |
| `fn_apply_schedule_templates` | `teaching_assignments`, `teaching_schedules`, `subjects` | `supabase/migrations/20260630230000_fix_apply_schedule.sql:67,78,60` |
| `fn_buka_tahun_ajaran` | `academic_periods`, `class_enrollments` | `supabase/migrations/20250624000000_fn_buka_tahun_ajaran.sql:62,103` |
| sync attendance batch | `attendance`, `teacher_attendance_log`, `sync_idempotency` | `supabase/migrations/20240115000000_sync_attendance_batch.sql:110,159,167` |
| bulk-import schedules/users/parents/classes/programs/dudi/pkl | beragam | edge functions, pola sama |

Satu-satunya yang benar adalah `provision-school` (menyetel `school_id` eksplisit, `supabase/functions/provision-school/index.ts`).

**Dampak berantai (operasional inti):**
1. Impor massal (siswa/guru/ortu/jadwal/DUDI/PKL) gagal.
2. "Terapkan Jadwal" gagal → `teaching_assignments` tak terisi → **CRITICAL#1 (guru tak bisa mencatat absensi) terbuka kembali**, persis blocker yang diklaim sudah selesai.
3. Tutup tahun ajaran (`fn_buka_tahun_ajaran`) gagal.
4. Sinkronisasi absensi offline gagal saat dibangun/dipakai.

**Catatan penting (pembeda):** Penulisan **langsung dari portal** lewat JWT user (mis. guru simpan absensi/observasi via `guru/js/api.js`) **tetap jalan**, karena `auth.uid()` ada sehingga trigger mengisi `school_id` dengan benar. Yang patah **hanya jalur service-role** (RPC `SECURITY DEFINER` & edge function).

**Arah perbaikan (untuk diskusi):** teruskan `school_id` ke RPC sebagai parameter (resolve dari user pemanggil di edge function via `getUserClient`/lookup `users`), ATAU jadikan trigger sadar konteks pemanggil edge function, ATAU set `school_id` eksplisit di tiap INSERT RPC. Perlu keputusan pola tunggal agar konsisten.

---

## 🔴 C2 — Resolusi data lintas-tenant di edge function

> ✅ **STATUS: FIXED (1 Juli 2026).** Diterapkan LIVE + deploy:
> - `school_config.single()` → `.eq('school_id', user.school_id).maybeSingle()` di `bulk-import-students`/`-classes`/`-users`/`-schedules` + `apply-schedule-templates` (tak lagi pecah "multiple rows" saat >1 sekolah).
> - Semua lookup `programs.code`/`classes.name`/`students.nis`/`teachers`/`academic_periods`/`schedule_templates` di edge functions kini discope `.eq('school_id', …)`.
> - `fn_apply_schedule_templates` kini menerima `p_school_id` dan **hanya memproses template sekolah pemanggil** (sebelumnya lintas sekolah); duplikat-periode di `fn_buka_tahun_ajaran` discope per sekolah.
> - **Residual (schema, belum):** unique constraint `programs.code`, `classes(name,academic_year)`, `subjects.code` masih **global** (belum per-sekolah). Dengan onboarding sekolah ke-2, dua sekolah tak bisa memakai kode program / nama kelas / kode subjek yang sama sampai constraint diubah jadi menyertakan `school_id`. Perlu migrasi constraint terpisah sebelum sekolah ke-2 benar-benar dibuat.

Karena service role mem-bypass RLS, lookup yang tidak difilter `school_id` akan menjangkau **semua sekolah**:

- `bulk-import-students`: `school_config ... .single()` (`index.ts:99-102`) → **error "multiple rows returned"** begitu ada >1 sekolah; bahkan dengan 1 sekolah, ia mengambil config sekolah yang mungkin keliru.
- Lookup `programs.code` & `classes.name` tidak discope sekolah → dua sekolah dengan nama kelas sama di tahun ajaran sama → `classMap` keyed-by-name (last-wins) → siswa bisa ter-enroll ke **kelas sekolah lain**.
- `fn_apply_schedule_templates`: `SELECT subject_id FROM subjects WHERE code='KBM'` lintas sekolah → referensi subject milik tenant lain.
- `fn_buka_tahun_ajaran`: cek duplikat `academic_periods` (`WHERE academic_year=... AND semester=...`) tanpa `school_id` → sekolah B diblokir membuka tahun ajaran karena sekolah A sudah memakai string tahun/semester yang sama.

**Konsekuensi:** korupsi data lintas-tenant (silent) dan kegagalan keras (`.single()`) saat sekolah kedua di-onboard. Saat ini "lolos" hanya karena baru ada 1 sekolah live.

---

> ✅ **STATUS H1+H2+H3: FIXED (1 Juli 2026, LIVE + terverifikasi via login RLS).** Migrasi `20260701280000_rls_isolate_staff_read`. Model akses (opsi A, dikonfirmasi pemilik): guru→siswa yang diajar; wali→+kelasnya; kaprodi→+jurusannya; BK/Kepsek/Waka→se-sekolah (via role_type **atau** flag). Fungsi baru `fn_can_see_student()` (= `fn_is_schoolwide_observer` ∪ `fn_teaches_student` ∪ `fn_wali_of_student` ∪ `fn_kaprodi_of_student`) menggantikan kebijakan baca-staf blanket di 7 tabel (students/observations/cases/achievements/attendance/class_enrollments/pkl_placements). **H2:** `fn_kaprodi_program_id()` kini `COALESCE(kaprodi_program_id, program_id jika role KAPRODI)`. **H3:** `fn_is_schoolwide_observer()` membaca role_type **atau** flag `is_bk/is_kepsek/is_waka_*` (sisi-**baca**). *Bukti runtime (login akun uji):* Kepsek & Waka Kesiswaan lihat 1296 (semua); Guru biasa **215** (hanya yang diajar); Wali **121** (diajar+kelas walian 26); Kaprodi **111** (= jurusannya). **Residual:** H3 sisi-**tulis** (GURU+flag `is_kepsek` belum bisa melakukan aksi tulis kepsek mis. keputusan final) belum digarap; policy WRITE masih keyed `role_type`.

## 🟠 H1 — Isolasi WALI_KELAS & KAPRODI belum tuntas

Master summary menandai CRITICAL#2 ("Wali Kelas & Kaprodi bisa lihat data semua siswa") sebagai SELESAI, mengacu migrasi `20260701220000` & `20260701230000`. Namun kedua migrasi itu **hanya menyempitkan tabel `students` & `pkl`**.

Di `20260701130000_rls_add_school_filter.sql`, `WALI_KELAS` & `KAPRODI` (role_type) **masih membaca seluruh sekolah tanpa scope** pada:

| Policy | Baris | Tabel |
|---|---|---|
| `rls_observations_read_staff` | :382 | semua observasi (termasuk teks bebas sensitif & visibility non-publik) |
| `rls_cases_read_admin` | :427 | semua kasus disiplin/BK |
| `rls_attendance_read_staff` | :322 | semua absensi |
| `rls_achievements_read_staff` | :503 | semua prestasi |
| `rls_enrollments_read_staff` | :181 | semua enrolmen kelas |

**Akibat:** Kaprodi tak bisa *melihat daftar* siswa di luar programnya, tapi **bisa membaca semua catatan observasi & kasus** seluruh sekolah — justru data paling sensitif. Isolasi privasi hanya menutup pintu depan (daftar siswa), bukan brankas (catatan).

> Catatan model: "wali kelas" umumnya `role_type='GURU'` + `wali_kelas_class_id`; baris di atas memakai literal `WALI_KELAS`/`KAPRODI` (role_type). Severitas penuh berlaku untuk akun ber-role_type tersebut (mis. Kaprodi dedikasi). Perlu konfirmasi cara provisioning kaprodi (role_type vs flag) untuk memastikan cakupan riil.

---

## 🟠 H2 — `fn_kaprodi_program_id()` membaca kolom yang salah

`fn_kaprodi_program_id()` (`20260701220000:23-31`) mengembalikan `users.program_id`. Namun desain multi-role menyimpan program yang **dikepalai** di `users.kaprodi_program_id` (`20260630110000_multi_role_staff.sql:11`, komentar: "Program keahlian yang dikepalai. Non-null = Kaprodi").

- Frontend memakai `kaprodi_program_id` (`guru/js/api.js:55` `getJabatan`, dan program efektif = `kaprodi_program_id ?? program_id`).
- RLS memakai `program_id`.

**Akibat:** tidak sinkron. Untuk kaprodi rangkap jabatan (`role_type='GURU'`, `program_id`=program asalnya, `kaprodi_program_id`=program yang dikelola), RLS men-scope ke program **asal**, bukan yang dikelola. Predikat `program_id = fn_kaprodi_program_id()` pada `rls_students_read_kaprodi`/`rls_pkl_read_kaprodi` juga terpenuhi oleh **sembarang user yang punya `program_id`** (semua GURU), sehingga nama policy menyesatkan (bukan benar-benar "cek kaprodi"). Untuk kaprodi dedikasi, fungsionalitas bisa benar **atau** kosong tergantung kolom mana yang diisi saat provisioning.

---

## 🟠 H3 — Flag jabatan multi-role tak pernah dibaca RLS

`is_bk`, `is_kepsek`, `is_waka_kurikulum`, `is_waka_kesiswaan` (`20260630110000`) hanya muncul di komentar, data uji, dan frontend (`getJabatan` menampilkan tab). **Nol policy RLS** yang merujuk flag ini — semua keyed `fn_current_user_role()` (role_type).

**Akibat:** GURU dengan `is_bk=TRUE` **tidak mendapat akses data BK**; `is_kepsek=TRUE` tidak mendapat wewenang kepsek; dst. Tab jabatan muncul di dashboard, tetapi data di baliknya kosong/ditolak RLS. Hanya `wali_kelas_class_id` (via `fn_wali_kelas_class_id()`) yang benar-benar berfungsi.

Ini adalah **kambuhnya pola root-cause** yang sudah dicatat di audit RLS 30 Juni (`project-rls-audit`): *"RLS keying ke role_type, padahal jabatan disimpan sebagai FLAG"*. Saat itu diperbaiki untuk WAKA_* via penambahan ke array role; flag boolean lain belum. (Lihat juga **J4/J6/J10** di Bagian 2 — tab jabatan muncul tapi kosong/ditolak adalah dampak yang sama di lapisan portal.)

---

## 🟡 M1 — Policy INSERT terlalu longgar (tanpa cek peran)

Di `20260701130000_rls_add_school_filter.sql`, policy berikut hanya `WITH CHECK (school_id = fn_current_school_id())` **tanpa cek peran**:

- `rls_achievements_write` (:500)
- `rls_cases_insert` (:424)
- `rls_case_events_insert_handler` (:468)
- `rls_student_updates_insert` (:687)

**Akibat:** setiap user terautentikasi (termasuk SISWA/ORTU/DUDI) dapat meng-INSERT baris ini untuk sekolahnya — mis. siswa menambahkan prestasi (`achievements`) untuk dirinya sendiri atau orang lain. Mungkin sebagian disengaja untuk jalur sinkronisasi, tetapi di level RLS saat ini terbuka dan perlu dikonfirmasi/diperketat.

---

> ✅ **STATUS M2: FIXED (1 Juli 2026, LIVE + terverifikasi via login guru).** Migrasi `20260701290000_attendance_scheduled_teacher` — `rls_attendance_rw_guru` kini mengizinkan menulis absensi bila user adalah **guru terjadwal** sesi (`scheduled_teacher_id`) ATAU pemilik assignment aktif. Data live 100% konsisten (0 sesi akan ditolak) → perbaikan preventif untuk guru pengganti/edit manual.
>
> ⚠️ **M2b — 2 bug LATEN jalur simpan absensi guru ditemukan saat verifikasi** (belum pernah kena karena live attendance=0):
> 1. `attendance.recorded_by_user_id` NOT NULL tanpa default, portal & trigger tak mengisinya → **FIXED** migrasi `20260701300000_attendance_auto_recorded_by` (trigger isi dari `fn_current_user_id()`). ✅ LIVE.
> 2. `guru/js/api.js upsertAttendance` mengirim `source: 'MANUAL'` yang **bukan** nilai enum `attendance_source` valid (sah: `AUTO_DETECTED`/`MANUAL_OVERRIDE`/`TEACHER_DECLARED`) → diperbaiki ke `'TEACHER_DECLARED'` di `guru/js/api.js`. ⏳ **BELUM DEPLOY** (butuh `git push origin main`).
>
> *Bukti gabungan (login guru-biasa via JWT):* simpan absensi 1 siswa **berhasil** — `recorded_by_user_id` & `school_id` terisi otomatis, status HADIR tersimpan. Data uji dihapus. **Sampai frontend di-deploy, portal live masih mengirim `source='MANUAL'` → simpan absensi tetap gagal 400.**

## 🟡 M2 — Mismatch daftar jadwal vs RLS absensi

`guru/js/api.js:84` `getMyScheduleForDate` memfilter sesi via `scheduled_teacher_id = userId` (langsung di `teaching_schedules`). Sementara RLS tulis absensi `rls_attendance_rw_guru` (`20260701130000:304`) mensyaratkan adanya `teaching_assignment` **aktif** milik user untuk sesi tersebut.

**Akibat:** bila `scheduled_teacher_id` dan kepemilikan assignment berbeda (guru pengganti, assignment di-nonaktifkan, atau pipeline assignment tidak konsisten), guru melihat sesi di layar tetapi **penyimpanan absensi ditolak diam-diam** oleh RLS. Perlu memastikan kedua sumber kebenaran selalu sinkron. (Dikonfirmasi di lapisan portal pada **J10**, Bagian 2.)

---

## 🟢 M3 — `shared/branding.js` apply ganda menghilangkan node logo

`_applyToDom` (`shared/branding.js:100-108`) memanggil `el.replaceWith(img)` pada `[data-brand="logo"]`, sehingga atribut `data-brand` hilang. Saat `applyBranding()` (pra-login) lalu `applyBrandingById()` (pasca-login) dipanggil berurutan di halaman yang sama, apply tahap kedua tak menemukan node logo → logo tak ter-refresh. Kosmetik, prioritas rendah.

---
---

# BAGIAN 2 — Re-Audit Menyeluruh Portal Aktor (lensa A–H, sisi-klien)

Telaah seluruh portal aktor (`guru/`, `student/`, `parent/`, `dudi/`, `stakeholder/`, `superadmin/`) + `shared/` + `contracts/` + `sw.js` + ke-7 file `*/css/*.css`, dengan menerapkan kerangka lensa audit **A–H** (`docs/audit/level-a … level-h`).

## 🔴 J1 — Kontrak offline tidak terpasang; fitur WAJIB "absensi saat internet mati" tetap kosong

**Akar masalah.** Seluruh mesin offline yang dirancang sangat rinci — `contracts/12_sync_engine.js`, `10_permission_engine.js`, `12_offline_queue.js`, `12_idb_schema.js`, `11_api_contract.js` — **adalah dead code.** Pencarian referensi menunjukkan modul-modul ini hanya saling-impor di dalam `contracts/` + dirujuk dokumen audit + filenya sendiri. **Tidak ada satu pun portal yang meng-import-nya.**

Bukti jalur nyata:
- `guru/js/dashboard.js:6-19` hanya meng-import `api.js`. Simpan absensi: `saveAttendance()` → `upsertAttendance()` (`guru/js/api.js:135`) = `supabase.from('attendance').upsert(...)` **langsung online**. Tidak ada antrian/IndexedDB.
- `sw.js:92-95` — request ke `*.supabase.co` = **network-only** (`event.respondWith(fetch(request))`). Saat offline, fetch gagal → simpan gagal.
- `sw.js:104-119` — navigasi HTML offline → fallback `offline.html`. SW hanya melakukan caching aset statis; **tidak** ada Background Sync, tidak ada `OfflineQueue`, tidak memuat `SyncEngine`.

**Dampak.** Guru di kelas tanpa internet menekan "Simpan Kehadiran (N siswa)" → error jaringan → data **tidak diantrikan, hilang**. Kebutuhan inti yang diklasifikasi **WAJIB** di Level A ("guru tetap bisa mencatat absensi walau internet sekolah mati") dan temuan HIGH Level E ("belum bisa dipenuhi sama sekali") **masih berlaku penuh** meskipun aplikasi guru kini sudah ada — yang dibangun adalah UI online, bukan kapabilitas offline. Berlaku juga untuk observasi, jurnal, dan absensi PKL DUDI (semua tulis langsung online).

**Catatan.** Ini bukan korupsi data, melainkan absennya fitur + risiko kehilangan data senyap. Sebelum platform dijual ke sekolah dengan koneksi tidak stabil (proposisi nilai utamanya), klaim "bisa dipakai tanpa internet" tidak boleh dibuat. Arah perbaikan (untuk diskusi): wiring `SyncEngine`/`OfflineQueue` ke portal guru + bangun receiver server untuk observasi/kasus/jurnal (saat ini hanya absensi siswa yang punya `sync-attendance-batch`).

---

> ✅ **STATUS: FIXED (1 Juli 2026, gerbang terverifikasi runtime).** Edge function baru `list-schools` (digerbang `X-Superadmin-Key`, baca `schools` via service-role → tembus RLS dengan aman) menggantikan baca anon-REST. `superadmin/js/dashboard.js loadSchools()` kini memanggilnya dengan header kunci. *Bukti:* tanpa-kunci & kunci-salah → 401; baca `schools` via service-role mengembalikan sekolah (terbukti berulang sesi ini). Konfirmasi visual UI ada pada vendor pemegang `SUPERADMIN_KEY`. Frontend perlu deploy (`git push`).

## 🟠 J2 — Superadmin tidak bisa melihat daftar sekolah (regresi RLS) — TERKONFIRMASI runtime

`superadmin/js/dashboard.js:43-46` `loadSchools()` membaca tabel `schools` lewat **REST anon** (apikey + Authorization = anon key). Superadmin **bukan** user Supabase auth — autentikasinya key-based (`x-superadmin-key`, lihat `auth.js`), jadi request REST tidak membawa JWT user.

Setelah migrasi tenant-isolation (`20260701210000`), policy `rls_schools_read_own` `USING (school_id = fn_current_school_id())`; `fn_current_school_id()` berbasis `auth.uid()` yang **NULL untuk anon** → 0 baris.

**Bukti runtime (1 Juli 2026):**
```
GET /rest/v1/schools?select=school_id,name,slug,is_active  (header anon)  →  []
GET /rest/v1/school_config?select=...                       (header anon)  →  []
```

**Dampak.** Panel "Daftar Sekolah" selalu menampilkan "Belum ada sekolah terdaftar." walau sekolah ada. Vendor bisa **mendaftarkan** sekolah baru (lewat edge fn `provision-school` service-role) tapi **tidak bisa memverifikasi/mengaudit** tenant yang sudah ada. Regresi langsung dari kerja isolasi tenant. Arah perbaikan: sediakan endpoint baca daftar sekolah via edge function `x-superadmin-key` (service-role), bukan anon REST.

---

> ✅ **STATUS: FIXED (1 Juli 2026, terverifikasi runtime).** `student/js/api.js getMyAttendance` & `guru/js/api.js getWaliAttendanceSummary` kini memfilter **`session_date`** (mulai dari `teaching_schedules`, `!inner` ke attendance) — sama seperti portal Ortu. *Bukti (login siswa, absensi uji tanggal-sesi 2027-07-05 vs tanggal-input 2026-07-01):* rentang tanggal-sesi → 1 baris (benar); rentang tanggal-input → 0 baris (dulu terbalik). Data uji dihapus. Frontend perlu deploy (`git push`).

## 🟠 J3 — Rekap kehadiran dihitung pada sumbu tanggal yang salah, tidak konsisten antar portal

Konsep yang sama ("kehadiran dalam rentang tanggal") diimplementasikan **tiga cara berbeda**, dua di antaranya salah sumbu:

| Lokasi | Sumbu filter rentang | Benar? |
|---|---|---|
| `student/js/api.js:122-123` `getMyAttendance` | `attendance.created_at` (waktu insert) — padahal kolom tampil = `schedule.session_date` | ❌ salah |
| `guru/js/api.js:244-245` `getWaliAttendanceSummary` | `attendance.created_at` | ❌ salah |
| `parent/js/api.js:108-137` `fetchAttendance` | `teaching_schedules.session_date` (mulai dari schedule, `!inner` ke attendance) | ✅ benar |
| `dudi`/`student-PKL` (`pkl_attendance`) | kolom `attendance_date` sungguhan | ✅ benar |

Menariknya portal Ortu **sudah** diperbaiki dengan komentar eksplisit ("PostgREST silently ignores filters on embedded relations… Flip the query"), tapi tampilan-diri Siswa dan rekap Wali belum ikut.

**Dampak.** Persentase kehadiran & "dalam rentang" untuk **view siswa-sendiri** dan **rekap wali kelas** dihitung berdasarkan **kapan baris dibuat**, bukan tanggal sesi kelas. Setiap entri terlambat/backfill (atau kelak hasil sync offline) jatuh ke jendela tanggal yang salah → `% Hadir` keliru. Karena indikator kehadiran adalah metrik inti platform, ini menyentuh kebenaran angka yang dilihat wali kelas & siswa. Perbaikan: samakan ke pola query Ortu (filter `session_date`).

---

## 🟡 J4 — Tab "Waka Kesiswaan" placeholder mati ditampilkan ke pengguna nyata

`guru/dashboard.html:228-235` tab `waka_kesiswaan` berisi "Fitur dalam pengembangan…"; `guru/js/dashboard.js:109` `case 'waka_kesiswaan': break;` (no-op). User dengan `role_type='WAKA_KESISWAAN'` atau flag `is_waka_kesiswaan` mendapat tab yang muncul tapi kosong fungsi.

Ini **bertentangan dengan Keputusan Domain yang Dikunci di Level A**: Export Data & Log Aktivitas sengaja **disembunyikan** justru agar placeholder kosong tidak membingungkan pengguna. Prinsip yang sama belum diterapkan konsisten ke tab Waka Kesiswaan. (Bandingkan: tab Waka Kurikulum nyata berfungsi — "Guru Tidak Hadir Hari Ini".)

---

## 🟡 J5 — `login_identifier` DUDI diekspos sebagai kolom di tab Kaprodi

`guru/js/api.js:305-314` `fetchDudiPartners` menyeleksi `login_identifier`; `guru/js/dashboard.js:550-552` `renderKpDudi` menampilkan kolom **"Login"** berisi identifier login DUDI. Kaprodi melihat ID login mitra eksternal. Mirip ekspos row-level yang sudah "diterima" untuk siswa/ortu (Level D, F4), tapi di sini secara eksplisit dijadikan kolom tabel. Perlu konfirmasi apakah disengaja; jika tidak, hapus kolom Login.

---

## 🟡 J6 — Portal aktor (mobile-first) tidak menerapkan prinsip Level H

Level H (`level-h-mobile-first.md`) adalah rubrik desain **khusus untuk portal aktor** (smartphone perangkat utama). Temuan:

- **#15 Navigation First / Bottom Nav:** semua portal memakai **top `tab-nav`** (guru `dashboard.html:27`, student) atau seksi bertumpuk (parent/dudi). Tidak ada bottom navigation untuk fitur harian (absensi/jadwal). Di HP, aksi paling sering justru bukan yang termudah dijangkau ibu jari.
- **#16 Exception First:** dashboard tidak menonjolkan "apa yang perlu tindakan".
  - Kepsek (`dashboard.js:714` `initKepsekTab`) = 4 kartu statistik saja; tidak ada "indikator yang memerlukan keputusan".
  - Guru membuka tabel jadwal, bukan "siswa belum diabsen / kelas berikutnya".
- **#2 Primary Action First / #8 Minimize Navigation:** absensi (aksi terpenting guru) butuh: tab Guru → jadwal hari ini → "Input Kehadiran" → expand accordion → "Simpan". Bisa dipadatkan.

Severitas MEDIUM karena bersifat prinsip, tapi dokumen H adalah rubrik eksplisit yang diminta diterapkan ke portal ini.

---

## 🟡 J10 — Jadwal vs RLS absensi — dikonfirmasi di kode portal (menguatkan M2)

`guru/js/api.js:84-96` `getMyScheduleForDate` memfilter sesi via `scheduled_teacher_id = userId`. RLS tulis absensi (`rls_attendance_rw_guru`, lihat **M2** Bagian 1) mensyaratkan `teaching_assignment` aktif untuk sesi itu. Bila keduanya tak sinkron (guru pengganti, assignment nonaktif, atau **C1 yang membuat assignment tak terisi**), guru **melihat** sesi & daftar siswa tetapi **simpan absensi ditolak**. Selain itu `getMyStudents` (selektor observasi, `api.js:155`) juga berbasis `teaching_assignments` → ikut kosong bila **C1** belum diperbaiki.

---

## 🟡 J11 — Kegagalan kontras Level G direplikasi ke badge yang paling sering dibaca

Audit Level G (admin) sudah menyatakan tiga pasangan teks/latar **gagal WCAG AA 4.5:1**. Token yang sama persis kini dipakai di **keenam portal terang** (`--color-success #16a34a`, `--color-warning #d97706`, `--color-danger #dc2626` + bg muda masing-masing — identik di `guru/student/parent/dudi/stakeholder/.css`, mis. `student/css/student.css:15-19`, `guru/css/guru.css:15-20`):

| Pasangan | Rasio | Dipakai untuk |
|---|---|---|
| `#16a34a` di `#ecfdf3` | **3,12:1 ❌** | `.badge-hadir`, `.status-ok`, `.obs` positif |
| `#d97706` di `#fffbeb` | **3,07:1 ❌** | `.badge-sakit` |
| `#dc2626` di `#fef2f2` | **4,41:1 ❌** | `.badge-tidak-hadir`, `.status-err` |
| `#6b7280` di `#f4f6f8` | **~4,47:1 ❌** | teks `.hint`, `.att-nis`, label tabel |

**Dampak lebih berat dari di Admin.** Di admin pasangan ini muncul di pesan impor/peringatan (jarang). Di portal aktor, justru menempel pada **badge status kehadiran** — elemen yang dilihat siswa & orang tua **setiap kali** membuka portal (Hadir/Sakit/Izin/Alpha), sering di HP di bawah cahaya terang. Rekomendasi sama dgn Level G: gelapkan teks hijau/oranye (mis. `#15803d`/`#b45309`) agar punya jarak aman dari 4,5:1.

**Konsistensi (F2/G):**
- 6 portal aktor berbagi token terang yang sama (baik). **`superadmin` menyimpang total** — tema gelap (`--color-bg #0f172a`, palet slate/indigo, `success #22c55e`/`danger #ef4444`). Di tema gelap kontrasnya aman; tapi ini satu-satunya portal bertema beda. Karena vendor-only, dapat diterima — dicatat sebagai inkonsistensi sadar.
- `.badge-izin` ditulis tak konsisten: `guru`=`#eff6ff`, `parent`=`#eff4ff`, `dudi`=hardcode `#eff6ff`+`#1d4ed8` (bukan token). Kosmetik.
- **Tidak ada** `prefers-color-scheme` maupun `@media print` di portal mana pun (sama seperti admin). Untuk PWA mobile, dark mode lebih diharapkan pengguna daripada di console desktop — catatan LOW, bukan blocker.

---

## 🟢 J7 — Umpan balik native `alert()`/`confirm()` tak konsisten

`guru/js/dashboard.js:374` `alert('Pilih siswa terlebih dahulu.')`; `:795` `confirm('Hapus catatan ini?')` + `:801` `alert('Gagal menghapus…')`. Sebagian besar portal pakai elemen status in-page (`status-msg`, `obs-status`); dialog native menyimpang dari pola itu dan kurang ramah mobile.

---

## 🟢 J8 — Superadmin: master key di `sessionStorage` + verifikasi via efek samping

`superadmin/js/auth.js` menyimpan key mentah di `sessionStorage` (terjangkau XSS) dan "memverifikasi" key dengan **POST body kosong ke `provision-school`** (401=salah, 400=benar). `dashboard.js:4-5` hanya menggerbang pada keberadaan `sa_key`. Proteksi sebenarnya ada di server (edge fn cek `x-superadmin-key`), jadi dampak rendah, tapi pola verifikasi-via-efek-samping rapuh dan key client-side sebaiknya dicatat.

---

## 🟢 J9 — Sumbu tanggal observasi tampil tidak konsisten

`parent/js/api.js:194` menampilkan `created_at`; `student/js/api.js:143` mengurutkan & menampilkan `observed_at`; `dudi/js/dashboard.js:306` `observed_at ?? created_at`. Kosmetik, tapi tanggal observasi yang sama bisa tampak berbeda antar portal.

---

## Audit Level F (lengkap) — Portal Aktor

Pass khusus Level F (Keterbacaan & UX) menelusuri 10 sub-audit (Bahasa, Beban Kognitif, Hierarki, Dashboard, Form, Tabel, Tombol & Aksi, Pesan Kesalahan, Mobile, 5-Detik) ke ke-6 portal + superadmin.

### 🟡 F-1 — Pesan error mentah bocor ke pengguna akhir *(Audit Pesan Kesalahan)*

Semua portal menampilkan `err.message` apa adanya ke layar pengguna, mis.:
- `student/js/dashboard.js`: `Gagal memuat: ${esc(err.message)}` (jadwal), `<td>${esc(err.message)}</td>` (kehadiran/observasi).
- `guru/js/dashboard.js`: `Gagal: ${esc(err.message)}`, `Gagal memuat: ${esc(err.message)}` (jadwal/absensi/wali/bk).
- `parent/js/portal.js`, `dudi/js/dashboard.js`: pola sama.

Saat RLS menolak (mis. *"new row violates row-level security policy for table …"*), JWT kedaluwarsa (*"JWT expired"*), atau jaringan putus, **siswa & orang tua melihat teks teknis Postgres/Supabase** — bukan bahasa biasa + tindakan, persis yang dilarang Audit Pesan Kesalahan Level F. **Rekomendasi:** petakan ke pesan generik ("Gagal memuat data. Periksa koneksi lalu coba lagi.") dan kirim detail teknis ke `console` saja. (Pembeda dari **J7**: J7 soal *dialog native*; F-1 soal *isi pesan teknis*.)

### 🟡 F-2 — Input `font-size:14px` memicu auto-zoom HP *(Audit Mobile)*

`.input` = **14px** di **keenam** portal (`guru/css/guru.css:55`, `student:56`, `parent:82`, `dudi:85`, `stakeholder:53`, `superadmin:47`). iOS Safari mem-zoom otomatis saat field <16px difokus — setiap kali pengguna mengetuk kotak tanggal/teks, layar membesar tiba-tiba. Ini **temuan F-Mobile yang sama dgn console Admin**, tapi **lebih relevan** karena portal aktor justru **mobile-first** (admin desktop-only secara desain). **Rekomendasi:** input ≥16px (atau 16px khusus breakpoint mobile).

### 🟢 F-3 — Touch target di bawah anjuran *(Audit Mobile)*

`.btn-sm` (`padding 6px 12px`, ~30px) dan `.btn-xs` (`padding 4px 8px`, ~26px) di bawah ~44px area sentuh nyaman. Guru memakai `.btn-xs` untuk **"Input Kehadiran"** dan radio status absensi berukuran kecil → risiko salah sentuh di HP saat mengisi absensi cepat. **Rekomendasi:** perbesar tombol aksi utama harian ke ≥44px tinggi.

### 🟢 F-4 — Istilah status tak konsisten lintas portal *(Audit Bahasa / Konsistensi)*

`TIDAK_HADIR` ditampilkan **"Alpha"** di `guru/js/dashboard.js` & `student/js/dashboard.js` (`STATUS_LABELS`), tapi **"Tidak Hadir"** di `parent/js/portal.js` & `dudi/js/dashboard.js`. Status yang sama tampak beda antara layar siswa ("Alpha") dan layar orang tuanya ("Tidak Hadir"). **Rekomendasi:** satukan satu istilah (mis. "Tidak Hadir/Alpha" konsisten) di seluruh portal.

### 🟢 F-5 — Tombol baca tanpa state + satu layar dua tugas *(Audit Tombol & Aksi / Beban Kognitif)*

- Tombol baca "Muat"/"Filter" di portal Siswa & "Filter"/jadwal di Ortu **tidak mengubah state** saat memproses (mayoritas tombol *simpan* sudah punya "Menyimpan…", jadi ini soal kelengkapan, bukan dua pola). Dampak rendah karena aksi baca cepat.
- Tab **"Dashboard Guru"** mencampur dua tugas dalam satu layar (Jadwal Mengajar + form Tulis Observasi); portal Ortu menumpuk 3 seksi sekaligus (jadwal+kehadiran+observasi). Menyentuh Audit Beban Kognitif/Hierarki (dan H#1 *One Screen One Purpose*).

### Sub-audit Level F yang sebagian besar SUDAH BAIK (terverifikasi)

- **Bahasa (login):** label login sudah **"NIP / NIK"** (bukan "Identifier" mentah seperti temuan admin) — perbaikan nyata; pesan login juga ramah ("NIP/NIK atau password salah").
- **Bahasa (enum):** nilai status/dimensi dipetakan via `STATUS_LABELS`/`DIMENSION_LABELS` → tak ada kode mentah `TIDAK_HADIR`/`BAKAT_MINAT` bocor ke UI (kecuali fallback `?? r.status` yang jarang terpakai).
- **Form & 5-Detik:** label `<label for>` lengkap, placeholder jelas, empty-state informatif di semua tabel ("Belum ada data … pada rentang ini"); DUDI bahkan punya penghitung karakter (`0/1000`) + batas "(10–1000 karakter)".
- **Tabel:** semua tabel dibungkus `.table-wrapper`/`.table-scroll` (bisa digeser horizontal di HP) — berbeda dari admin yang tak punya; jumlah kolom wajar.
- **Pesan in-page (positif):** DUDI & superadmin pakai `alert alert-success/danger` in-page (bukan dialog native) — pola yang seharusnya ditiru guru (lihat **J7**).

## Hal yang Sudah Baik (terverifikasi) — Portal Aktor

- **XSS:** semua portal mem-`esc()` konten user sebelum `innerHTML` (guru/student/parent/dudi/stakeholder). Tidak ditemukan injeksi langsung konten user.
- **Mobile dasar:** semua HTML login & dashboard portal aktor punya `<meta viewport>` + `<link manifest>` (berbeda dari console Admin yang "khusus desktop").
- **PostgREST embedded-filter pitfall:** `parent/js/api.js` menanganinya dengan benar (pola yang seharusnya ditiru student/wali — lihat J3).
- **Default visibilitas observasi aman:** guru default `INTERNAL_SCHOOL`; pembacaan siswa/ortu mem-filter ganda `visibility='STUDENT_VISIBLE'` (pertahanan berlapis di samping RLS).
- **Isolasi tenant per-portal:** semua dashboard memanggil `applyBrandingById(currentUser.school_id, …)` dan bergantung pada RLS untuk scope data — konsisten dengan arsitektur multi-tenant.

---
---

# BAGIAN 3 — Audit Local-First (prinsip arsitektur)

**Definisi yang dipakai (ditetapkan pemilik platform):** *Local-first adalah prinsip arsitektur di mana setiap portal membaca dan menulis data operasional ke penyimpanan lokal sebagai sumber kerja utama. Sinkronisasi dengan server dilakukan di belakang layar untuk menjaga konsistensi data antar perangkat dan antar portal, tanpa menghambat pekerjaan pengguna.* Offline-first adalah konsekuensi alami: karena data operasional sudah di perangkat, banyak fungsi tetap jalan saat koneksi putus.

Urutan kerja yang dituju (Local-First) vs yang ada sekarang (Server-First):

```
Local-First (dituju)                 Server-First (kondisi nyata semua portal)
  User                                 User
   ↓                                    ↓
  Local DB (IndexedDB)                 await Supabase
   ↓                                    ↓
  UI langsung berubah                  (spinner "Memuat…")
   ↓                                    ↓
  Background Sync → Server             Response → UI berubah
```

**Verdict desain vs implementasi.** Spesifikasi `contracts/12_offline_sync_reference.md` mendeskripsikan arsitektur local-first **yang lengkap dan matang** (stores `offline_queue`/`sync_cache`/`conflict_queue`/`dead_letter`/`sync_meta`; idempotency key; priority order; 409 conflict flow; storage guard; pemisahan Category A vs B). **Namun nol baris implementasi memakainya** (lihat J1). Jadi platform punya *cetak biru* local-first yang baik tetapi *berjalan* sebagai Server-First murni — **bertentangan dengan prinsip arsitekturnya sendiri** (memori `project-progressive-enhancement`).

## 🔴 LF-1 — Inversi arsitektur: semua portal Server-First

Setiap **tulis** = `await supabase…` lalu UI dari respons server: `guru` `await upsertAttendance()` → status (`dashboard.js:288`), `await insertObservation()` (`:379`), `await insertJournalEntry()` (`:759`); `dudi` `await saveAttendance()` → "✓ Tersimpan" (`dashboard.js:201`); `kaprodi` `await createPlacement()`. Setiap **baca** = `await supabase…select` + spinner "Memuat…" (`loadSchedule`, `loadAttendance`, `loadObservations`, `loadWaliSummary`, …). Inilah loop Server-First yang persis ditolak prinsip platform. **Tidak ada** IndexedDB, tidak ada enqueue-lokal, tidak ada render-dari-cache. Ini temuan induk yang J1 hanya satu gejalanya (offline). Dampak: aplikasi terasa lambat (tiap interaksi menunggu server) **dan** rapuh (server sibuk/lambat/putus = pekerjaan terhenti).

## 🟠 LF-2 — Tidak ada lapisan baca lokal → tidak ada "instan", baca offline kosong

Store `sync_cache` + `pullData()` + `cacheRead()` (dirancang untuk render offline & stale-while-revalidate) **tak terpakai**. Tiap buka tab memicu baca network baru; saat offline `sw.js` (network-only untuk Supabase) gagal → layar kosong/`offline.html`, bukan data terakhir. Ideal local-first **#1 (no spinner/instan)** dan **#3 (network optional untuk baca)** gagal. Untuk portal baca-mayoritas (Siswa/Ortu/Stakeholder/Kepsek), justru *cache-first read* inilah nilai utamanya — dan itu belum ada.

## 🟠 LF-3 — Optimistic-UI belum ada, dan berbahaya bila ditambahkan sebelum write-path RLS benar

Saat ini UI jujur (Server-First menampilkan penolakan nyata). Tapi target local-first ("klik → Tersimpan → sync") **tidak boleh dibangun di atas write-path yang masih menolak**: **C1** (NOT NULL `school_id`), **H3** (flag jabatan ditolak RLS), **M2** (jadwal vs assignment) membuat sebagian tulisan **ditolak diam-diam di server**. Dalam model optimistic, guru sudah yakin "absensi tersimpan" lalu pergi, padahal item gagal sync → **kehilangan data tak disadari**. **Prasyarat:** Bagian 1 (C1/H3/M2) harus tuntas sebelum optimistic-write diaktifkan. Local-first **memperbesar** dampak bug tulis yang ada, bukan menutupinya.

## 🟡 LF-4 — Pemisahan Category A (tulis-operasional) vs Category B (baca-agregat) belum tercermin di kode

Desain sudah benar memisah **Category A** (absensi/observasi/kasus/jurnal → offline-capable) dari **Category B** (pesan ortu, dashboard agregat → online-only). Implementasi memperlakukan **semua seragam online**. Maka rekomendasi arsitektur: **local-first-write** untuk guru/DUDI (operasional), **cache-first-read** untuk Siswa/Ortu/Stakeholder/Kepsek — *bukan* "semuanya IndexedDB→Sync yang identik". Mengikuti split Category A/B yang sudah didokumentasikan menghindari permukaan konflik yang tak perlu di portal baca.

## 🟡 LF-5 — Kasus/eskalasi: desain sudah server-arbitrated — pertahankan, jangan optimistic naif

Absensi cocok untuk last-write-wins + idempotency (penulis tunggal per sesi). **Kasus** punya invarian otoritatif server (`current_handler`, urutan eskalasi, `is_locked`, append-only) → desain **sudah benar** menanganinya via `CONFLICT_CASE_STATE` (409) → `conflict_queue` → resolusi manual. Catatan: jalur offline "kasus" **belum punya UI konsumen** sama sekali (tab BK guru hanya baca observasi; tak ada UI kasus/eskalasi di portal mana pun). Jadi Category-A "case/case_event" adalah desain tanpa pemakai. Risiko hanya muncul bila implementer kelak memangkasnya jadi optimistic-write — jangan.

## 🟡 LF-6 — Tak ada kebijakan data sensitif di perangkat

Local-first berarti observasi/kasus/daftar siswa **mengendap di IndexedDB perangkat** (guru/HP pribadi). `logout()` di semua portal hanya `supabase.auth.signOut()` — **tidak** mem-purge penyimpanan lokal. Belum ada kebijakan **wipe-on-logout**, enkripsi at-rest, atau penanganan **perangkat hilang**. Ideal local-first **#6 (privasi/keamanan)**. Saat mesin local-first diaktifkan, logout WAJIB menghapus `sync_cache` + antrian, dan perlu keputusan enkripsi/TTL untuk data sensitif.

## 🟡 LF-7 — Token sync statis di memori Service Worker → tak refresh

Desain menyetel `getToken: async () => event.data.token` (token disalin sekali via `SW_CONFIG`). Token ini **tidak ikut auto-refresh** Supabase (refresh terjadi di main thread, tak sampai ke SW). Offline lama → token kedaluwarsa → saat koneksi kembali, sync dapat **401** → `markFailed` berulang → item ke `dead_letter`. Ideal **#3/#5** (network optional + longevity) terancam. Perlu mekanisme refresh token untuk SW sebelum local-first dipakai produksi.

## 🟡 LF-8 — Migrasi schema major menghapus antrian belum-sync

`_clearQueuesForMigration()` meng-`DELETE` `offline_queue` saat major version bump (dengan peringatan ke user). Bila guru punya absensi belum-sync lalu app rilis update breaking, **data tertunda terhapus**. Trade-off ini didokumentasikan, tapi tetap risiko **longevity (ideal #5)** — perlu pertimbangan flush-paksa sebelum migrasi.

## Scorecard 7 Keputusan Arsitektur Local-First (yang Anda sebut)

| Keputusan | Status di kode | Catatan |
|---|---|---|
| Kapan baca server vs lokal | ❌ selalu server | `sync_cache`/`cacheRead` tak terpakai (LF-2) |
| Kapan sinkronisasi | ❌ tak ada | `requestSync`/Background Sync tak dipanggil (J1) |
| Bagaimana jika konflik | 🟡 desain ada, tak jalan | 409→conflict_queue untuk kasus; LWW+idempotency untuk absensi (LF-5) |
| Dua perangkat ubah data sama | 🟡 desain ada, tak jalan | idempotency + LWW (absensi) cukup; kasus server-arbitrated |
| Bagaimana jika sync gagal | 🟡 desain ada, tak jalan | retry 5× → dead_letter; LF-7 (token) ancam jalur ini |
| Bagaimana jika perangkat hilang | ❌ tak ditangani | LF-6 (tak ada wipe/enkripsi) |
| Privasi data lokal at-rest | ❌ tak ditangani | LF-6 |

## Hal yang Sudah Baik (Local-First)

- **Desain sangat matang** (`12_offline_sync_reference.md` + `contracts/12_*`): idempotency key, priority order (absensi dulu), dead-letter, storage guard, conflict flow, **pemisahan Category A/B** — fondasi yang benar bila kelak diimplementasikan.
- **Receiver server absensi sudah ada** (`sync-attendance-batch` + idempotency) — separuh jalur Category A (absensi) siap di server; tinggal sisi klien + receiver untuk observasi/kasus/jurnal.
- Pemisahan **Category B online-only** (pesan ortu, dashboard agregat) tepat — tidak semua data perlu local-first.

---

# BAGIAN 4 — Audit Installable (PWA) + atom Responsive

Lensa **Installable** (standar pemilik platform) diterapkan sebagai lensa baru; dari **Responsive** hanya diambil atom unik yang belum tercakup Level H/F/G (Functional Equivalence, tabel-responsif, `inputmode`, no-horizontal-scroll). Metode: baca ke-6 `manifest.json` + CSS `@media`, **plus bukti runtime** (server statik lokal `serve` @ `localhost:3001`, Service Worker + Cache API + resize 375px + screenshot).

## Bukti runtime yang TERVERIFIKASI BAIK

- **Service Worker aktif**, scope root (`http://localhost:3001/`), state `active`.
- **Offline Bootstrap (#5) TERBUKTI:** cache `smkhr-v6` berisi **42 entri**; `caches.match('/guru/dashboard.html')` dan `caches.match('/offline.html')` keduanya **hit** → shell aplikasi tersaji dari cache saat offline. Precache mencakup shell + CSS/JS semua portal + `offline.html` + ikon.
- **Manifest valid** di path kanonik (`GET /guru/manifest.json` → **200**, ter-parse): `display:standalone`, `start_url`, `scope:"./"` per-portal, `orientation`, `theme_color`, `lang:"id"`, ikon `any`+`maskable`.
- **Independent Portal (#7):** tiap portal harian punya manifest + scope sendiri; **superadmin sengaja tanpa manifest** (selaras pengecualian standar).
- **No horizontal scroll (Responsive):** di 375px pada login, `scrollWidth == clientWidth` (375) → tak ada geser horizontal pada layout utama.
- **Adaptive Layout (#3):** semua portal punya breakpoint `@media` (640/600/480) — bukan sekadar mengecil.
- **Browser-First (#1/#2/#8):** portal jalan di browser tanpa install; install opsional.

## 🟡 IN-1 — Identitas PWA hardcoded single-tenant (multi-tenant tension)

Ke-6 `manifest.json` **hardcode "SMK Harapan Rokan"** di `name`/`short_name` (mis. `guru/manifest.json:2-3` "Portal Guru — SMK Harapan Rokan") dan `theme_color:#1a56db`/`background_color:#f0f4ff` statis. Branding **in-app** dinamis per-sekolah (dari DB via `applyBrandingById`), tetapi identitas **saat diinstal** (nama app, ikon, theme, splash) diambil dari manifest **statis** → guru SMK-B yang meng-install dari deployment yang sama mendapat nama/ikon **"SMK Harapan Rokan"**. Melanggar Installable **#4 Consistent Identity "sesuai identitas sekolah"** di konteks multi-tenant. **Rekomendasi:** manifest per-tenant (subdomain/slug) atau identitas platform generik (bukan nama satu sekolah). Catatan: `theme_color` manifest `#1a56db` juga ≠ `--color-primary #1d4ed8` app (drift kecil).

## 🟡 IN-2 — Path aset relatif patah tanpa trailing slash (TERBUKTI runtime)

Ditemukan lewat screenshot: login **tampil tanpa styling** saat dimuat di `/guru` (tanpa trailing slash). Sebab: `<link href="css/guru.css">` & `<link rel="manifest" href="manifest.json">` **relatif** → di `/guru` teratasi ke **root** (`/css/guru.css`, `/manifest.json`), bukan `/guru/…`.

**Bukti runtime:**
```
di /guru      : fetch('/css/guru.css') → 404 ; .login-card background = transparan (tak ter-style)
path benar    : fetch('/guru/css/guru.css') → 200
manifest      : href 'manifest.json' @ /guru → /manifest.json → 404
```

Di **GitHub Pages** ini **tertutup** oleh redirect 301 otomatis `/guru` → `/guru/`, jadi produksi saat ini aman. Namun **rapuh**: di host tanpa redirect trailing-slash — termasuk **config `serve` milik repo ini sendiri** (`.claude/launch.json`) — seluruh portal memuat **tanpa CSS + tanpa manifest + module script gagal**. **Rekomendasi:** pakai path root-absolut, `<base href>`, atau jamin trailing-slash. (Runtime testing menangkap ini; pembacaan statik tidak.)

## 🟡 FE-tabel — Tabel responsif menyembunyikan header saja → kolom misalign

`student/css/student.css:180` `.table th:nth-child(2){ display:none }` (≤480px) dan `parent/css/parent.css:369` `.data-table th:nth-child(4){ display:none }` menyembunyikan **sel header** tetapi **tak ada aturan `td` pasangannya**. Akibat: baris header kehilangan satu sel sementara baris data tetap lengkap → **kolom bergeser/misalign**, dan data (Mata Pelajaran di siswa / Guru di ortu) tetap tampil **tanpa header**. Melanggar Responsive **#6** ("jangan potong data penting" + tabel tetap usable). **Rekomendasi:** sembunyikan `th`+`td` berpasangan, atau pakai card-layout di mobile. (Keyakinan tinggi dari CSS; render runtime terhalang butuh login.)

## 🟢 IN-3 — Ikon & metadata manifest

Ikon hanya **SVG `sizes:"any"`** (`../icons/icon.svg` + `icon-maskable.svg`); **tak ada raster PNG 192/512**. Chrome modern menerima SVG untuk installability, tetapi splash maskable Android / browser lama / sebagian alur install mengharapkan PNG 192 & 512 — **perlu verifikasi di perangkat target**. Juga: tak ada field `id` (disarankan untuk stabilitas identitas PWA).

## 🟢 Resp-7 — Keyboard tak sesuai tipe data (TERBUKTI runtime)

Input login untuk NIP/NIK/NIS bersifat numerik tetapi `type="text"` tanpa `inputmode` — runtime: `input#identifier` → `type=text`, `inputmode=null`. Di HP memunculkan keyboard teks penuh, bukan numerik. **Rekomendasi:** `inputmode="numeric"` (tetap `type=text` bila NIP boleh berawalan 0). Menguatkan **F-2** (input `font-size` runtime terukur **~13,3px < 16px** → konfirmasi auto-zoom).

---

# Cakupan, Keyakinan & Urutan Tindak Lanjut

## Cakupan & Batasan

**Bagian 1 (sisi-server).** Ditelaah: seluruh migrasi RLS & multi-tenant, helper functions (`fn_current_*`, `fn_kaprodi_program_id`, `fn_wali_kelas_class_id`, dll), `_shared/db.ts`, `bulk-import-students`, `provision-school`, `fn_apply_schedule_templates`, `fn_buka_tahun_ajaran`, `guru/js/api.js`. Keyakinan: C1/C2/H1/H2/H3 tinggi secara statik; belum diverifikasi runtime terhadap DB live. Pembuktian ideal: 1 impor uji + 1 "Terapkan Jadwal" pada kondisi ≥1 sekolah, amati error `NOT NULL`/`multiple rows`.

**Bagian 2 (sisi-klien).** Lensa yang diterapkan: A (J1, J4), B (J2), C (J3, J10), D (J2, J5, J8, J10), E (J1), **F — pass lengkap 10 sub-audit (J7, F-1…F-5 + bagian "sudah baik")**, F2 (J3, J4, J9, J11, F-4), G (J11 — kontras/warna/badge/dark-mode/cetak, dari pembacaan ke-7 CSS portal), H (J6). **Kedelapan dimensi A–H terpakai dengan kedalaman setara.** Ditelaah: seluruh JS+HTML portal aktor (termasuk login & dashboard HTML), ke-7 file `*/css/*.css`, `shared/branding.js`, `contracts/*`, `sw.js`. Pemeriksaan runtime: anon REST `schools`/`school_config` (J2).

**Bagian 4 (Installable + atom Responsive).** Statik: ke-6 `manifest.json`, CSS `@media`. **Runtime (bukti):** server statik `serve` @ localhost:3001 → Service Worker (aktif, scope root), Cache API (offline bootstrap terbukti: 42 entri, shell hit), fetch manifest/CSS (path relatif patah tanpa trailing slash — IN-2), resize 375px (no-h-scroll, input 13,3px, `inputmode=null`), screenshot (menyingkap IN-2). Tidak bisa diuji runtime: tabel pasca-login (butuh kredensial) — FE-tabel dari CSS. Server dihentikan setelah uji.

**Bagian 3 (local-first).** Lensa: prinsip arsitektur local-first (definisi pemilik platform) + ketujuh ideal local-first. Ditelaah: spesifikasi `contracts/12_offline_sync_reference.md`, `12_sync_engine.js`, `12_offline_queue` (ref), `12_idb_schema` (ref), `10_permission_engine.js`, jalur baca/tulis nyata tiap portal, `sw.js`, dan `logout()` tiap portal. Keyakinan tinggi (statik): desain vs implementasi sangat kontras (desain lengkap, implementasi nol). Belum ditelaah: korektheid baris-per-baris internal `12_offline_queue.js`/`12_sync_engine.js` (karena tak terpakai — uji unit `10_permission_engine.test.js` ada tapi modulnya tak ter-wire).

## Urutan Tindak Lanjut yang Disarankan

**Sisi-server (Bagian 1) — kerjakan lebih dulu, memblokir operasional inti:**
1. **C1** — pulihkan jalur tulis sisi-server (meruntuhkan kembali CRITICAL#1).
2. **C2** — buat edge function/RPC sadar-tenant (mendesak sebelum onboarding sekolah ke-2).
3. **H1 + H3** — tuntaskan isolasi aktor pada tabel sensitif & jadikan flag jabatan benar-benar dibaca RLS.
4. **H2** — selaraskan kolom kaprodi (frontend vs RLS).
5. **M1/M2/M3** — perketat policy INSERT, sinkronkan jadwal↔assignment, rapikan branding.

**Sisi-klien (Bagian 2):**
6. **J2** — pulihkan daftar sekolah superadmin (kecil, memblokir operasi vendor; via edge fn service-role).
7. **J3** — samakan rekap kehadiran siswa & wali ke filter `session_date` (kebenaran metrik inti; pola Ortu sudah ada untuk ditiru).
8. **J1** — keputusan strategis: wiring offline ke portal guru, atau setel ekspektasi "online-only" secara jujur (menyentuh proposisi nilai utama).
9. **J4/J10** — sembunyikan tab Waka Kesiswaan sampai berfungsi; selaraskan jadwal↔assignment (bergantung C1).
10. **J5–J9, J11** — privasi kolom Login DUDI, prinsip Level H, dialog non-native, konsistensi tanggal, kontras warna badge.
11. **F-1/F-2** (MEDIUM) — petakan pesan error ke bahasa biasa (jangan bocorkan `err.message`); naikkan input ke ≥16px agar HP tak auto-zoom. **F-3/F-4/F-5** (LOW) — perbesar touch target absensi, samakan istilah "Alpha/Tidak Hadir", lengkapi state tombol baca.

**Local-first (Bagian 3) — keputusan arsitektur, kerjakan setelah write-path benar:**
12. **Prasyarat: C1 + H3 + M2 dulu** (LF-3) — optimistic-write tak boleh dibangun di atas jalur tulis yang masih ditolak RLS.
13. **LF-1/LF-2** — wiring `SyncEngine`/`OfflineQueue`/`sync_cache` ke portal **tulis-operasional** (guru, DUDI) sebagai local-first-write, dan **cache-first-read** ke portal baca (siswa/ortu/stakeholder/kepsek) — ikuti split Category A/B yang sudah didesain (LF-4), jangan "semuanya sama".
14. **LF-6/LF-7** — kebijakan data lokal (wipe-on-logout, enkripsi/TTL, perangkat hilang) + refresh token di SW, sebelum produksi.
15. Bangun receiver server untuk observasi/kasus/jurnal (setara `sync-attendance-batch`) agar Category A tuntas; pertahankan model server-arbitrated untuk kasus (LF-5).

**Installable + Responsive (Bagian 4):**
16. **IN-2** (MEDIUM) — jamin trailing-slash / pakai path absolut atau `<base href>` agar portal tak patah di host non-GitHub-Pages.
17. **IN-1** (MEDIUM) — identitas PWA per-tenant atau generik (bukan hardcode satu sekolah).
18. **FE-tabel** (MEDIUM) — perbaiki hide-kolom mobile (sembunyikan `th`+`td`, atau card-layout).
19. **IN-3 / Resp-7** (LOW) — tambah ikon PNG 192/512 + `id`; `inputmode="numeric"` pada login.
