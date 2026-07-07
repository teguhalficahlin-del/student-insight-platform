# Discovery: Student Insight Platform
**Tanggal discovery:** 6 Juli 2026  
**Metode:** Pembacaan langsung source code, migration files, dan contract files  
**Cakupan:** Seluruh repository di folder root

---

## 1. Peta Modul & Peran

### 1.1 Daftar Portal (Folder)

| Folder | File HTML | File JS Utama | Status |
|--------|-----------|---------------|--------|
| `guru/` | `index.html`, `dashboard.html` | `api.js`, `auth.js`, `dashboard.js`, `offline.js`, `sw-guard.js` | Fungsional |
| `student/` | `index.html`, `dashboard.html` | `api.js`, `auth.js`, `dashboard.js`, `sw-guard.js` | Fungsional (terbatas) |
| `parent/` | `index.html`, `portal.html` | `api.js`, `auth.js`, `portal.js`, `sw-guard.js` | Fungsional (terbatas) |
| `admin/` | `index.html`, `dashboard.html`, `setup.html`, `tutup-tahun.html`, `wizard.html` | `api.js`, `auth.js`, `dashboard.js`, `import.js`, `schedule-builder.js`, `semester.js`, `setup-wizard.js`, `tutup-tahun.js`, `wizard.js`, `sw-guard.js` | Fungsional (paling lengkap) |
| `superadmin/` | `index.html`, `dashboard.html` | `auth.js`, `dashboard.js` | Fungsional |
| `dudi/` | `index.html`, `dashboard.html` | `api.js`, `auth.js`, `dashboard.js`, `offline.js`, `sw-guard.js` | Fungsional |
| `stakeholder/` | `index.html`, `dashboard.html` | `api.js`, `auth.js`, `dashboard.js`, `sw-guard.js` | Fungsional (terbatas) |

Tidak ada folder untuk `kepsek/` atau `bk/` sebagai portal terpisah — fungsionalitas Kepala Sekolah, BK, Wali Kelas, Kaprodi, dan Waka diimplementasikan sebagai **tab kondisional di dalam `guru/dashboard.html`**.

### 1.2 Fitur per Portal

#### Portal Guru (`guru/dashboard.html`)

Tab yang ada di HTML (bukti: baris 44–568):

| Tab ID | Nama Tab | Koneksi Backend |
|--------|----------|-----------------|
| `tab-guru` | Jadwal Mengajar & Rekap Kehadiran | `supabase.from('teaching_schedules')`, `supabase.from('attendance')` |
| `tab-observasi` | Observasi Karakter | `supabase.from('observations')` |
| `tab-wali_kelas` | Wali Kelas (kondisional) | `supabase.from('class_enrollments')`, `supabase.from('students')` |
| `tab-bk` | BK — Kasus & Siswa (kondisional) | `supabase.from('cases')`, `supabase.rpc('fn_kepsek_monitoring')` |
| `tab-kaprodi` | Kaprodi — PKL & Program (kondisional) | `supabase.from('pkl_placements')`, `supabase.from('pkl_attendance')` |
| `tab-waka_humas` | Waka Humas (kondisional) | `supabase.from('cases')` |
| `tab-waka_kesiswaan` | Waka Kesiswaan (kondisional) | `supabase.from('students')`, `supabase.from('attendance')` |
| `tab-waka_kurikulum` | Waka Kurikulum (kondisional) | `supabase.from('teaching_schedules')` |
| `tab-kepsek` | Kepala Sekolah (kondisional) | `supabase.rpc('fn_kepsek_monitoring')` |
| `tab-ks_admin` | Admin (kondisional) | Edge functions via `fetch()` |
| `tab-jurnal` | Jurnal Guru | `supabase.from('teacher_journals')` |
| `tab-kasus` | Kasus | `supabase.from('cases')`, `supabase.from('case_events')` |

Tab kondisional ditampilkan berdasarkan flag jabatan user (`is_bk`, `is_kepsek`, `is_waka_kesiswaan`, dll.) yang dibaca dari tabel `users`.

Backend calls di `guru/js/api.js` mencakup (bukti: baris 13–987):
- Auth: `fn_resolve_login_email`, `signInWithPassword`, `fn_register_login_device`
- Absensi: `supabase.from('attendance')`, `supabase.from('teaching_schedules')`
- PKL: `supabase.from('pkl_attendance')`, `supabase.from('pkl_placements')`
- Kasus: edge function `sync-case`
- Monitoring: `supabase.rpc('fn_kepsek_monitoring')`
- Notifikasi: `supabase.rpc('fn_count_unread_notifications')`
- Admin ops: edge function `manage-admin-account`
- Programs: `supabase.from('programs')`

#### Portal Siswa (`student/dashboard.html`)

Tab yang ada di HTML (bukti: baris 43–131):

| Tab ID | Nama Tab | Koneksi Backend |
|--------|----------|-----------------|
| `tab-jadwal` | Jadwal Pelajaran | `supabase.from('teaching_schedules')` |
| `tab-kehadiran` | Kehadiran | `supabase.from('attendance')` |
| `tab-observasi` | Observasi (yang visible ke siswa) | `supabase.from('observations')` |
| `tab-pkl` | PKL | `supabase.from('pkl_placements')`, `supabase.from('pkl_attendance')` |

Backend calls di `student/js/api.js` (baris 13–244): hanya auth dan `fn_count_unread_notifications`. Backend calls lain ada di `student/js/dashboard.js` tapi minimal — `dashboard.js` hanya berisi auth guard (baris 66–71).

**Catatan:** `student/js/dashboard.js` hanya mempunyai auth guard, tidak ada fetch data domain. Kemungkinan data domain di-load langsung dari inline scripts di HTML atau melalui modul terpisah yang tidak teridentifikasi dari grep.

#### Portal Orang Tua (`parent/portal.html`)

Seksi yang ada di HTML (bukti: baris 16–131):
- Informasi PKL (absensi 30 hari terakhir)
- Jadwal Pelajaran
- Kehadiran
- Catatan Guru
- Kasus Tentang Anak Saya

Backend calls di `parent/js/api.js` (baris 10–268): auth + `fn_count_unread_notifications`. `parent/js/portal.js` hanya berisi auth guard (baris 111). Tidak ditemukan fetch data domain di `portal.js` secara langsung.

#### Portal Admin (`admin/dashboard.html`)

Menu sidebar (bukti: baris 20–50):
- **Setup:** Setup Sekolah, Profil & Branding
- **Data Master:** Program Keahlian, Kelas & Rombel
- **Pengguna:** Staf & Peran, Siswa, Alumni, Orang Tua, DUDI, Stakeholder
- **Jadwal:** Jadwal
- **Sistem:** Tutup Semester, Tahun Ajaran Baru, Export Data, Log Aktivitas

Backend calls di `admin/js/api.js` (baris 16–1057) mencakup:
- Programs & Classes: `supabase.from('programs')`, `supabase.from('classes')`
- Students: `supabase.from('students')`, edge fn `purge-expired-students`
- Branding: `supabase.rpc('fn_update_school_branding')`
- Bulk import: edge fn `bulk-import-users`, `bulk-import-students`, `bulk-import-schedules`, dll.
- Schedule: edge fn `apply-schedule-templates`, `provision-student-accounts`
- Staff: `supabase.rpc('fn_get_stale_staff')`, `supabase.rpc('fn_deactivate_stale_staff')`
- Academic year: edge fn `cancel-academic-year`
- User management: `supabase.from()` + edge fn `manage-admin-account`

#### Portal DUDI (`dudi/dashboard.html`)

Seksi yang ada di HTML (bukti: baris 16–194):
- Absensi Harian (input)
- Tambah Catatan / Observasi
- Riwayat Catatan
- Laporan Masalah PKL (kasus)
- Riwayat Absensi (14 hari terakhir)

Backend calls di `dudi/js/api.js` (baris 9–282): auth, edge fn `sync-case`, `fn_count_unread_notifications`.

#### Portal Stakeholder (`stakeholder/dashboard.html`)

Seksi yang ada di HTML (bukti: baris 20–53):
- Ringkasan Sekolah

Backend calls di `stakeholder/js/api.js` (baris 13–62): auth + `supabase.rpc('fn_stakeholder_summary')`.

#### Portal Superadmin (`superadmin/dashboard.html`)

Backend calls di `superadmin/js/dashboard.js` (baris 1–448):
- Edge fn `list-schools`, `provision-school`, `delete-school`, `update-school-status`
- Edge fn `reset-admin-password`, `set-maintenance`, `platform-stats`

---

## 2. Peta Skema Data

### 2.1 Tabel Berdasarkan Domain

#### Domain: Tenant / Sekolah

| Tabel | Kolom Utama | school_id | Sumber |
|-------|-------------|-----------|--------|
| `schools` | `school_id` (PK), `name`, `npsn`, `address`, `phone`, `logo_url`, `primary_color`, `is_active` | — (tabel induk) | mig `20260701100000` |
| `school_config` | `school_id` (FK), `current_academic_year`, `current_semester`, `slug`, `password_changed_at` | Ya | contracts `01_reference_identity_org.sql:330` |
| `public.platform_config` | `key`, `value`, `updated_at` | Tidak | mig `20260702150000` |

#### Domain: User & Identitas

| Tabel | Kolom Utama | school_id | Sumber |
|-------|-------------|-----------|--------|
| `users` | `user_id` (PK), `auth_user_id` (FK→auth.users), `full_name`, `email`, `login_identifier`, `identifier_type`, `role_type`, `program_id`, `wali_kelas_class_id`, `dudi_org_name`, `teacher_code`, `is_active`; jabatan flags: `is_bk`, `is_kepsek`, `is_waka_kurikulum`, `is_waka_kesiswaan`, `kaprodi_program_id`; alumni: `alumni_career_track`, `alumni_career_note` | Ya | contracts `01:64` + mig `20260630110000` + mig `20260702220000` |
| `students` | `student_id` (PK), `nis`, `full_name`, `program_id`, `student_status`, `user_id` (FK→users, nullable), `graduated_at`, `graduated_academic_year`, `alumni_career_track`, `alumni_career_note`, `anonymized_at` | Ya | contracts `01:114` + mig `20260702220000` |
| `student_parents` | `id` (PK), `student_id` (FK), `parent_user_id` (FK) | Ya | contracts `01:146` |
| `login_devices` | `device_id` (PK), `user_id` (FK), `fingerprint`, `last_seen_at`, `user_agent` | (via user) | mig `20260704110000` |

#### Domain: Organisasi Sekolah

| Tabel | Kolom Utama | school_id | Sumber |
|-------|-------------|-----------|--------|
| `programs` | `program_id` (PK), `code`, `name`, `is_active` | Ya | contracts `01:17` |
| `subjects` | `subject_id` (PK), `code`, `name`, `is_active` | Ya | contracts `01:34` |
| `classes` | `class_id` (PK), `name`, `program_id`, `academic_year`, `grade_level`, `is_active` | Ya | contracts `01:170` |
| `class_enrollments` | `enrollment_id` (PK), `student_id`, `class_id`, `academic_year`, `semester`, `enrolled_at`, `withdrawn_at` | Ya | contracts `01:198` |
| `academic_periods` | `id` (PK), `academic_year`, `semester`, `start_date`, `end_date`, `status` | Ya | contracts `01:233` |

#### Domain: Jadwal

| Tabel | Kolom Utama | school_id | Sumber |
|-------|-------------|-----------|--------|
| `schedule_templates` | `template_id` (PK), `teacher_id`, `class_id`, `subject_id`, `day_of_week`, `start_time`, `end_time`, `academic_year`, `semester` | Ya | contracts `01b` |
| `schedule_time_slots` | `slot_id` (PK), `day_of_week`, `start_time`, `end_time`, `label` | Ya | mig (implicit) |
| `teaching_assignments` | `assignment_id` (PK), `teacher_id`, `class_id`, `subject_id`, `academic_year`, `semester` | Ya | contracts `01:295` |
| `teaching_schedules` | `schedule_id` (PK), `assignment_id`, `class_id`, `subject_id`, `scheduled_teacher_id`, `session_date`, `session_start`, `session_end`, `meeting_status`, `teacher_indicator`, `academic_year`, `semester` | Ya | contracts `02:17` |
| `substitute_schedules` | `substitute_id` (PK), `schedule_id`, `substitute_user_id`, `granted_by_user_id`, `sync_token`, `sync_token_expires_at` | Ya | contracts `02:72` |

#### Domain: Presensi

| Tabel | Kolom Utama | school_id | Sumber |
|-------|-------------|-----------|--------|
| `attendance` | `attendance_id` (PK), `schedule_id`, `student_id`, `status` (HADIR/TIDAK_HADIR/IZIN/SAKIT), `source`, `is_void`, `void_reason`, `recorded_by_user_id`, `notes` | Ya | contracts `02:126` |
| `teacher_attendance_log` | `log_id` (PK), `schedule_id`, `user_id`, `activity_type`, `logged_at` | Ya | contracts `04:123` |
| `pkl_placements` | `placement_id` (PK), `student_id`, `dudi_user_id`, `start_date`, `end_date`, `is_active` | Ya | contracts `01:264` |
| `pkl_attendance` | `pkl_attendance_id` (PK), `student_id`, `dudi_user_id`, `attendance_date`, `status`, `note` | Ya | mig `20260630130000` |
| `sync_idempotency` | `key` (PK), `created_at` | Ya | mig (implicit) |

#### Domain: Observasi Karakter

| Tabel | Kolom Utama | school_id | Sumber |
|-------|-------------|-----------|--------|
| `observations` | `observation_id` (PK), `student_id`, `author_user_id`, `sentiment` (POSITIF/NEGATIF), `dimension`, `content`, `visibility` (PRIVATE/RESTRICTED/PUBLIC/STUDENT_VISIBLE/INTERNAL_SCHOOL), `visibility_override_flag`, `class_id`, `schedule_id`, `observed_at` | Ya | contracts `02:163` + mig `20260706130000` |
| `observation_audience_members` | `id` (PK), `observation_id`, `target_user_id`, `school_id` | Ya | mig `20260706130001` |
| `achievements` | `achievement_id` (PK), `student_id`, `recorded_by_user_id`, `title`, `description`, `category`, `scope`, `achieved_at`, `is_voided`, `voided_at`, `void_reason` | Ya | contracts `02:201` |

#### Domain: BK / Manajemen Kasus

| Tabel | Kolom Utama | school_id | Sumber |
|-------|-------------|-----------|--------|
| `cases` | `case_id` (PK), `student_id`, `created_by_user_id`, `initiated_by_role`, `current_handler_role`, `is_locked`, `status`, `track` (SEKOLAH/PKL), `title`, `description`, `audience` (PRIVATE/RESTRICTED/PUBLIC), `closed_at`, `closed_by_user_id` | Ya | contracts `03:36` |
| `case_events` | `event_id` (PK), `case_id`, `event_type`, `author_user_id`, `author_role_at_time`, `new_handler_role`, `privacy_level`, `payload` (JSONB), `parent_message_id` | Ya | contracts `03:115` |
| `case_audience_members` | `id` (PK), `case_id`, `target_user_id` | (via case) | mig `20260703250000` |

#### Domain: Komunikasi

| Tabel | Kolom Utama | school_id | Sumber |
|-------|-------------|-----------|--------|
| `parent_messages` | `message_id` (PK), `sender_user_id`, `student_id`, `direction`, `link_type`, `case_id`, `visible_to_user_ids` (UUID[]), `subject`, `body`, `reply_to_message_id` | Ya | contracts `04:30` |
| `notifications` | `id` (PK), `school_id`, `recipient_user_id`, `case_id`, `type` (ESCALATION_DM/CASE_BROADCAST), `title`, `body`, `is_read`, `created_at` | Ya | mig `20260703280000` |
| `student_updates` | `update_id` (PK), `student_id`, `created_by_user_id`, `content`, `update_type` | Ya | contracts `04:159` |

#### Domain: Operasional Guru

| Tabel | Kolom Utama | school_id | Sumber |
|-------|-------------|-----------|--------|
| `teacher_journals` | `journal_id` (PK), `owner_user_id`, `schedule_id` (nullable), `class_id` (nullable), `entry_date`, `content` | Ya | contracts `04:94` |
| `audit_log` | `id` (bigint PK), `school_id`, `table_name`, `operation`, `row_id`, `row_snapshot` (JSONB), `deleted_by`, `deleted_at` | Ya (text) | mig `20260704140000` |

### 2.2 Total Tabel

Berdasarkan `contracts/` + migration files:

**Dari contracts:** `programs`, `subjects`, `users`, `students`, `student_parents`, `classes`, `class_enrollments`, `academic_periods`, `pkl_placements`, `teaching_assignments`, `school_config`, `schedule_templates` (01b), `teaching_schedules`, `substitute_schedules`, `attendance`, `observations`, `achievements`, `cases`, `case_events`, `case_audience_members`, `parent_messages`, `teacher_journals`, `teacher_attendance_log`, `student_updates`

**Ditambahkan via migration:** `schools`, `pkl_attendance`, `schedule_time_slots`, `sync_idempotency`, `platform_config`, `login_devices`, `notifications`, `audit_log`, `observation_audience_members`

**Total: 33 tabel**

---

## 3. Stack & Arsitektur Aktual

### 3.1 Stack

| Layer | Teknologi | Bukti |
|-------|-----------|-------|
| Frontend | HTML5 + Vanilla JavaScript (ES Modules) | Semua portal: `<script type="module">` |
| CSS Framework | Tabler Icons (webfont CDN), custom CSS per portal | `guru/dashboard.html:10`: `cdn.jsdelivr.net/npm/@tabler/icons-webfont@3` |
| Charts | Chart.js 4 (CDN) | `guru/dashboard.html:12`: `cdn.jsdelivr.net/npm/chart.js@4` |
| Spreadsheet import | SheetJS/xlsx 0.18.5 (CDN) | `admin/dashboard.html:12`: `cdn.jsdelivr.net/npm/xlsx@0.18.5` |
| Database | Supabase (PostgreSQL + RLS) | `guru/js/api.js:13`: URL `xovvuuwexoweoqyltepq.supabase.co` |
| Auth | Supabase Auth | `guru/js/api.js:34`: `supabase.auth.signInWithPassword` |
| Backend Functions | Supabase Edge Functions (Deno) | Folder `supabase/functions/` |
| Hosting (frontend) | GitHub Pages | `docs/panduan-superadmin.md:36`: `teguhalficahlin-del.github.io/student-insight-platform/` |
| Offline Queue | IndexedDB (via `offline.js`) | `guru/js/offline.js` |
| Service Worker | **Dinonaktifkan** (self-destruct) | `admin/dashboard.html:82–89`: SW dikomentari; `sw.js` berisi unregister |
| Node.js (server-side tools saja) | Digunakan untuk edge function tooling | `node_modules/@fast-csv`, `archiver` |

### 3.2 Daftar Edge Functions

Folder `supabase/functions/` (33 fungsi):

`_shared`, `apply-schedule-templates`, `bulk-import-classes`, `bulk-import-dudi`, `bulk-import-parents`, `bulk-import-pkl`, `bulk-import-programs`, `bulk-import-schedules`, `bulk-import-students`, `bulk-import-users`, `cancel-academic-year`, `delete-school`, `delete-user`, `list-schools`, `manage-admin-account`, `open-academic-year`, `platform-stats`, `provision-school`, `provision-student-accounts`, `purge-expired-students`, `purge-user`, `reset-admin-password`, `restore-user`, `set-maintenance`, `set-user-password`, `sync-attendance-batch`, `sync-case`, `sync-journal`, `sync-observation`, `update-school-status`, `update-user-identifier`

### 3.3 Isolasi Multi-Tenant

Mekanisme: **Row Level Security (RLS) PostgreSQL** dengan fungsi pembantu `fn_current_school_id()`.

Contoh nyata dari `supabase/migrations/20260701130000_rls_add_school_filter.sql`, baris 17–43:

```sql
CREATE POLICY rls_users_read_own ON users FOR SELECT
    USING (auth_user_id = auth.uid());

CREATE POLICY rls_users_read_staff ON users FOR SELECT
    USING (school_id = fn_current_school_id()
    ...);

CREATE POLICY rls_users_write_administrative ON users FOR ALL
    USING (school_id = fn_current_school_id()
    ...
    WITH CHECK (school_id = fn_current_school_id()
    ...);
```

Semua 25+ tabel domain mendapat kolom `school_id UUID REFERENCES schools(school_id)` via migration `20260701110000_add_school_id_to_tables.sql`. Setiap query RLS menyertakan filter `school_id = fn_current_school_id()` agar data lintas-tenant tidak bocor.

Guard-rail otomatis: `tests/tenant-isolation.mjs` (CHECK 1–7).

---

## 4. Jejak Definisi Produk dalam Kode

### 4.1 Nama & Branding

| Lokasi | Konten | Bukti |
|--------|--------|-------|
| `admin/wizard.html:6` | `<title>Setup Wizard — Student Insight Platform</title>` | HTML title tag |
| `admin/wizard.html:19` | `<span class="wz-brand">Student Insight Platform</span>` | Visible branding di UI onboarding |
| `docs/panduan-superadmin.md:36` | URL `teguhalficahlin-del.github.io/student-insight-platform/superadmin/` | GitHub Pages path |
| `docs/service-worker-status.md:1` | `# Status Service Worker — Student Insight Platform` | Dokumen internal |

**Nama lama / inkonsisten yang masih ada di kode:**

| Lokasi | Konten | Bukti |
|--------|--------|-------|
| `guru/dashboard.html:6` | `<title>Dashboard Guru — SMK Harapan Rokan</title>` | Hardcoded nama sekolah |
| `guru/index.html:6` | `<title>Portal Guru — SMK Harapan Rokan</title>` | Hardcoded nama sekolah |
| `student/dashboard.html:6` | `<title>Dashboard Siswa — SMK Harapan Rokan</title>` | Hardcoded nama sekolah |
| `student/index.html:6` | `<title>Portal Siswa — SMK Harapan Rokan</title>` | Hardcoded nama sekolah |
| `stakeholder/dashboard.html:6` | `<title>Dashboard Stakeholder — SMK Harapan Rokan</title>` | Hardcoded nama sekolah |
| `stakeholder/index.html:6` | `<title>Portal Stakeholder — SMK Harapan Rokan</title>` | Hardcoded nama sekolah |
| `offline.html:6` | `<title>Offline — SMK Harapan Rokan</title>` | Hardcoded nama sekolah |
| `superadmin/dashboard.html:6` | `<title>Dashboard Superadmin — Platform Sekolah</title>` | Nama generik, bukan "Student Insight Platform" |
| `admin/dashboard.html:6` | `<title>Dashboard — Admin Console</title>` | Tanpa nama produk |

### 4.2 Dokumen Definisi Produk

| File | Konten Relevan | Baris |
|------|----------------|-------|
| `requirements-final.md:1` | `# Platform Monitoring Perkembangan Siswa SMK` — judul | 1 |
| `requirements-final.md:3` | `## Requirements Document — Final & Frozen` — status frozen | 3 |
| `requirements-final.md:11` | `Target: satu sekolah SMK (pilot)` | 11 |
| `requirements-final.md:16` | `Student Is Main Actor — siswa adalah subjek perkembangan, bukan objek laporan` | Bagian 2 |
| `requirements-final.md:17` | `Evidence Before Opinion` | Bagian 2 |
| `requirements-final.md:18` | `Parents Are Partners` | Bagian 2 |
| `requirements-final.md:19` | `Positive Before Punishment` | Bagian 2 |
| `docs/README.md:3` | `Diperbarui & direkonsiliasi dengan kode: 4 Juli 2026` | 3 |
| `contracts/00_extensions_enums.sql:1` | File paling awal dari schema contract | — |
| `contracts/09_event_schema_reference.md:2` | `Version: 1.0.0 / Status: Frozen` — event schema | 2–3 |

---

## 5. Status Data Aktual

### 5.1 Seed Data yang Ada di Migrations

| Tabel | Data Seed | Sumber Migration |
|-------|-----------|------------------|
| `schools` | 1 baris: `school_id = '00000000-0000-0000-0000-000000000001'`, nama `'SMK Harapan Rokan'`, NPSN `'10494399'` | `20260701100000:29` |
| `academic_periods` | 1 baris: periode aktif (detail dalam migration) | `20260703160000:29` |

Tidak ada seed data lain yang ditemukan di migration files untuk tabel: `students`, `users`, `attendance`, `observations`, `cases`, `teacher_journals`, `pkl_placements`, `pkl_attendance`, `achievements`, `notifications`, `parent_messages`.

### 5.2 Sekolah yang Diketahui Ada (dari Kode)

Dari migration `20260705020000_set_smkkb_slug.sql` (nama file) dan referensi di `docs/README.md:baris sekolah uji`:
- `smkhr` — SMK Harapan Rokan (sekolah pertama, seed via migration)
- `smkhb` — disebutkan di `docs/README.md` sebagai data uji
- `smkkb` — disebutkan di `docs/README.md` + migration `20260705020000` menyebut slug `smkkb`

### 5.3 Pernyataan Status di Dokumen Internal

Dari `docs/README.md` (baris status terkini):
> "pra-launch (3 sekolah data uji: smkhr, smkhb, smkkb). Boleh migrasi skema agresif; belum ada data operasional nyata."

Ini menunjukkan semua tabel domain (presensi, observasi, BK, PKL) kemungkinan berisi data uji, bukan data operasional. Tidak ada query `COUNT(*)` langsung yang dapat dijalankan dari discovery ini — pernyataan di atas dikutip dari dokumen internal, bukan diverifikasi via query live.

### 5.4 Fitur yang Skemanya Ada tapi Belum Ditemukan UI-nya

| Fitur | Tabel/Fungsi | Catatan |
|-------|-------------|---------|
| `parent_messages` | Tabel ada, skema lengkap | Tidak ditemukan UI khusus pesan masuk/keluar di `parent/portal.html` — hanya ada seksi "Catatan Guru" |
| `achievements` | Tabel ada | Tidak ditemukan tab/seksi achievements di portal manapun dari grep |
| `student_updates` | Tabel ada di contracts | Tidak ditemukan UI khusus |
| `substitute_schedules` | Tabel ada | Tidak ditemukan UI penugasan guru pengganti |
| `teacher_attendance_log` | Tabel ada | Sistem-only (tidak ada UI input) |
| `observation_audience_members` | Tabel ada (mig `20260706130001`, hari ini) | Baru ditambahkan, UI belum dikonfirmasi |

---

*Dokumen ini hanya mencatat fakta berdasarkan bukti kode per tanggal discovery. Tidak ada opini, penilaian kualitas, atau rekomendasi.*
