-- ============================================================
-- FILE: 08_seed_reference.sql
-- LAYER: Seed Data — Reference + Bootstrap
-- APPLY ORDER: Last. After 07_indexes_views.sql.
--
-- Contains:
--   1. Program Keahlian (common SMK programs)
--   2. Mata Pelajaran (common subjects)
--   3. Bootstrap instructions (no auto-created user rows —
--      user provisioning is done via Supabase Auth + Edge Function)
--
-- NOTE: This seed is for a pilot SMK. Programs and subjects
-- must be reviewed and adjusted per the actual school's
-- kurikulum before first deploy. These are safe defaults.
-- ============================================================


-- ============================================================
-- PROGRAMS (Program Keahlian)
-- Adjust to match actual school programs before deploy.
-- ============================================================

INSERT INTO programs (code, name) VALUES
    ('TKJ',   'Teknik Komputer dan Jaringan'),
    ('RPL',   'Rekayasa Perangkat Lunak'),
    ('MM',    'Multimedia'),
    ('AK',    'Akuntansi dan Keuangan Lembaga'),
    ('OTKP',  'Otomatisasi dan Tata Kelola Perkantoran'),
    ('BDP',   'Bisnis Daring dan Pemasaran'),
    ('TEI',   'Teknik Elektronika Industri'),
    ('TP',    'Teknik Pemesinan'),
    ('TKR',   'Teknik Kendaraan Ringan Otomotif'),
    ('TBSM',  'Teknik dan Bisnis Sepeda Motor')
ON CONFLICT (code) DO NOTHING;


-- ============================================================
-- SUBJECTS (Mata Pelajaran)
-- Covers Kurikulum Merdeka SMK structure.
-- Adjust per actual school schedule before deploy.
-- ============================================================

INSERT INTO subjects (code, name) VALUES
    -- Umum / Adaptif
    ('BIND',    'Bahasa Indonesia'),
    ('BING',    'Bahasa Inggris'),
    ('MTK',     'Matematika'),
    ('PAI',     'Pendidikan Agama Islam dan Budi Pekerti'),
    ('PPKn',    'Pendidikan Pancasila'),
    ('PJOK',    'Pendidikan Jasmani, Olahraga dan Kesehatan'),
    ('SB',      'Seni Budaya'),
    ('SEJ',     'Sejarah'),

    -- Kejuruan Umum (lintas program)
    ('IPA-K',   'Ilmu Pengetahuan Alam dan Sosial Kejuruan'),
    ('PKK',     'Projek Kreatif dan Kewirausahaan'),
    ('PKL',     'Praktik Kerja Lapangan'),

    -- TKJ / RPL / MM
    ('DPTSI',   'Dasar-dasar Teknik Jaringan Komputer dan Telekomunikasi'),
    ('DPTI',    'Dasar-dasar Teknik Informatika'),
    ('TKJL',    'Administrasi Infrastruktur Jaringan'),
    ('TKJA',    'Administrasi Sistem Jaringan'),
    ('RPLK',    'Pemrograman Berorientasi Objek'),
    ('RPLD',    'Basis Data'),
    ('MMD',     'Desain Grafis'),
    ('MMP',     'Produksi Film Pendek'),

    -- Akuntansi / OTKP / BDP
    ('DPAKL',   'Dasar-dasar Akuntansi dan Keuangan Lembaga'),
    ('AKTJ',    'Akuntansi Perusahaan Jasa dan Dagang'),
    ('KPKT',    'Korespondensi dan Kearsipan'),
    ('MP',      'Manajemen Pemasaran'),

    -- Teknik
    ('DPTM',    'Dasar-dasar Teknik Mesin'),
    ('DPTE',    'Dasar-dasar Teknik Otomotif'),
    ('GAMBAR',  'Gambar Teknik Manufaktur'),
    ('PDTO',    'Pekerjaan Dasar Teknik Otomotif')

ON CONFLICT (code) DO NOTHING;


-- ============================================================
-- BOOTSTRAP NOTES
-- (No actual INSERT — instructions for first deploy)
-- ============================================================

-- Step 1: Create KEPSEK user via Supabase Auth (email + password)
--         This produces an auth.users row with a UUID.

-- Step 2: Run this INSERT once with the actual auth UUID:
--
--   INSERT INTO users (auth_user_id, full_name, email, role_type)
--   VALUES (
--       '<auth_uuid_from_supabase_dashboard>',
--       'Nama Kepala Sekolah',
--       'kepsek@smkpilot.sch.id',
--       'KEPSEK'
--   );
--
-- Step 3: KEPSEK then provisions all other users via the admin UI
--         (which calls an Edge Function with service-role key).
--         The Edge Function creates auth.users + users rows atomically.

-- Step 4: For SISWA and ORTU accounts, provisioning is done in bulk
--         via import CSV → Edge Function → auth.users + users + students
--         in a single transaction per row.

COMMENT ON TABLE programs IS
    'Seed: 10 common SMK programs. Review and adjust before first deploy. '
    'Add/remove programs via KEPSEK admin UI after initial seed.';

COMMENT ON TABLE subjects IS
    'Seed: Kurikulum Merdeka SMK subject list. Adjust per actual school kurikulum. '
    'PKL subject (code=PKL) is required — used for PKL case track identification.';
