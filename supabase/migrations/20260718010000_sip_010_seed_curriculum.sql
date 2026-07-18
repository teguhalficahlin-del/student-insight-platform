-- SIP Sprint 1 — 010: Seed data kurikulum
-- Semua seed menggunakan INSERT ... ON CONFLICT DO UPDATE (UPSERT).
-- CP content TIDAK diisi — hanya placeholder [PENDING].
-- Isi resmi diisi SIP Team dari SK BSKAP No. 046/H/KR/2025.

-- ================================================
-- 1. Curriculum Version
-- ================================================
INSERT INTO core.curriculum_versions (version_id, version_code, name, regulation_ref, effective_from, is_active)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  '2025',
  'Kurikulum Nasional 2025',
  'Permendikdasmen No. 13/2025',
  '2025-07-14',
  true
)
ON CONFLICT (version_code) DO UPDATE SET
  name           = EXCLUDED.name,
  regulation_ref = EXCLUDED.regulation_ref,
  is_active      = EXCLUDED.is_active,
  updated_at     = now();

-- ================================================
-- 2. Education Level: SMK
-- ================================================
INSERT INTO core.education_levels (level_id, code, name)
VALUES ('00000000-0000-0000-0001-000000000001', 'SMK', 'Sekolah Menengah Kejuruan')
ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name;

-- ================================================
-- 3. Phases: Fase E dan F untuk SMK
-- ================================================
INSERT INTO core.phases (phase_id, level_id, code, name, grade_range)
VALUES
  ('00000000-0000-0000-0002-000000000001',
   '00000000-0000-0000-0001-000000000001',
   'E', 'Fase E (Kelas X SMK)', 'Kelas X'),
  ('00000000-0000-0000-0002-000000000002',
   '00000000-0000-0000-0001-000000000001',
   'F', 'Fase F (Kelas XI-XII SMK)', 'Kelas XI-XII')
ON CONFLICT (level_id, code) DO UPDATE SET
  name        = EXCLUDED.name,
  grade_range = EXCLUDED.grade_range;

-- ================================================
-- 4. Subjects — 15 Umum + 5 Kejuruan Lintas Prodi
-- ================================================
-- UMUM
INSERT INTO core.subjects (subject_id, code, name, subject_type, is_generatable)
VALUES
  ('00000000-0000-0000-0010-000000000001', 'PAI',    'Pendidikan Agama Islam & Budi Pekerti',    'UMUM', true),
  ('00000000-0000-0000-0010-000000000002', 'PAK',    'Pendidikan Agama Kristen & Budi Pekerti',  'UMUM', true),
  ('00000000-0000-0000-0010-000000000003', 'PAKat',  'Pendidikan Agama Katolik & Budi Pekerti',  'UMUM', true),
  ('00000000-0000-0000-0010-000000000004', 'PABud',  'Pendidikan Agama Buddha & Budi Pekerti',   'UMUM', true),
  ('00000000-0000-0000-0010-000000000005', 'PAHin',  'Pendidikan Agama Hindu & Budi Pekerti',    'UMUM', true),
  ('00000000-0000-0000-0010-000000000006', 'PAKon',  'Pendidikan Agama Khonghucu & Budi Pekerti','UMUM', true),
  ('00000000-0000-0000-0010-000000000007', 'PPKn',   'Pendidikan Pancasila',                     'UMUM', true),
  ('00000000-0000-0000-0010-000000000008', 'BIN',    'Bahasa Indonesia',                         'UMUM', true),
  ('00000000-0000-0000-0010-000000000009', 'PJOK',   'PJOK',                                     'UMUM', true),
  ('00000000-0000-0000-0010-000000000010', 'SEJ',    'Sejarah',                                  'UMUM', true),
  ('00000000-0000-0000-0010-000000000011', 'SB_MUS', 'Seni Budaya (Musik)',                      'UMUM', true),
  ('00000000-0000-0000-0010-000000000012', 'SB_RUP', 'Seni Budaya (Rupa)',                       'UMUM', true),
  ('00000000-0000-0000-0010-000000000013', 'SB_TEA', 'Seni Budaya (Teater)',                     'UMUM', true),
  ('00000000-0000-0000-0010-000000000014', 'SB_TAR', 'Seni Budaya (Tari)',                       'UMUM', true),
  ('00000000-0000-0000-0010-000000000015', 'MULOK',  'Muatan Lokal',                             'MUATAN_LOKAL', false)
ON CONFLICT (code) DO UPDATE SET
  name            = EXCLUDED.name,
  subject_type    = EXCLUDED.subject_type,
  is_generatable  = EXCLUDED.is_generatable;

-- KEJURUAN LINTAS PRODI
INSERT INTO core.subjects (subject_id, code, name, subject_type, is_generatable)
VALUES
  ('00000000-0000-0000-0010-000000000016', 'MAT',  'Matematika',                        'KEJURUAN_LINTAS_PRODI', true),
  ('00000000-0000-0000-0010-000000000017', 'BING', 'Bahasa Inggris',                    'KEJURUAN_LINTAS_PRODI', true),
  ('00000000-0000-0000-0010-000000000018', 'INF',  'Informatika',                       'KEJURUAN_LINTAS_PRODI', true),
  ('00000000-0000-0000-0010-000000000019', 'IPAS', 'Projek IPAS',                       'KEJURUAN_LINTAS_PRODI', true),
  ('00000000-0000-0000-0010-000000000020', 'PKW',  'Projek Kreatif & Kewirausahaan',    'KEJURUAN_LINTAS_PRODI', true)
ON CONFLICT (code) DO UPDATE SET
  name           = EXCLUDED.name,
  subject_type   = EXCLUDED.subject_type,
  is_generatable = EXCLUDED.is_generatable;

-- ================================================
-- 5. Subject Phases
-- Mapel UMUM (15): muncul di Fase E DAN Fase F
-- INF + IPAS: hanya Fase E
-- PKW: hanya Fase F
-- MAT + BING: Fase E DAN Fase F
-- MULOK: Fase E DAN Fase F
-- ================================================

-- Helper: versi dan fase UUID
-- version: 00000000-0000-0000-0000-000000000001
-- fase E:  00000000-0000-0000-0002-000000000001
-- fase F:  00000000-0000-0000-0002-000000000002

-- 15 mapel UMUM — Fase E
INSERT INTO core.subject_phases (subject_id, phase_id, version_id)
SELECT s.subject_id,
       '00000000-0000-0000-0002-000000000001',
       '00000000-0000-0000-0000-000000000001'
FROM core.subjects s
WHERE s.code IN ('PAI','PAK','PAKat','PABud','PAHin','PAKon',
                 'PPKn','BIN','PJOK','SEJ','SB_MUS','SB_RUP',
                 'SB_TEA','SB_TAR','MULOK')
ON CONFLICT (subject_id, phase_id, version_id) DO NOTHING;

-- 15 mapel UMUM — Fase F
INSERT INTO core.subject_phases (subject_id, phase_id, version_id)
SELECT s.subject_id,
       '00000000-0000-0000-0002-000000000002',
       '00000000-0000-0000-0000-000000000001'
FROM core.subjects s
WHERE s.code IN ('PAI','PAK','PAKat','PABud','PAHin','PAKon',
                 'PPKn','BIN','PJOK','SEJ','SB_MUS','SB_RUP',
                 'SB_TEA','SB_TAR','MULOK')
ON CONFLICT (subject_id, phase_id, version_id) DO NOTHING;

-- MAT + BING — Fase E dan F
INSERT INTO core.subject_phases (subject_id, phase_id, version_id)
SELECT s.subject_id, p.phase_id, '00000000-0000-0000-0000-000000000001'
FROM core.subjects s
CROSS JOIN core.phases p
WHERE s.code IN ('MAT','BING')
  AND p.level_id = '00000000-0000-0000-0001-000000000001'
ON CONFLICT (subject_id, phase_id, version_id) DO NOTHING;

-- INF + IPAS — hanya Fase E
INSERT INTO core.subject_phases (subject_id, phase_id, version_id)
SELECT s.subject_id,
       '00000000-0000-0000-0002-000000000001',
       '00000000-0000-0000-0000-000000000001'
FROM core.subjects s
WHERE s.code IN ('INF','IPAS')
ON CONFLICT (subject_id, phase_id, version_id) DO NOTHING;

-- PKW — hanya Fase F
INSERT INTO core.subject_phases (subject_id, phase_id, version_id)
SELECT s.subject_id,
       '00000000-0000-0000-0002-000000000002',
       '00000000-0000-0000-0000-000000000001'
FROM core.subjects s
WHERE s.code IN ('PKW')
ON CONFLICT (subject_id, phase_id, version_id) DO NOTHING;

-- ================================================
-- 6. Capaian Pembelajaran — placeholder per subject_phase
-- cp_umum = '[PENDING — diisi SIP Team dari SK BSKAP No. 046/H/KR/2025]'
-- ================================================
INSERT INTO core.capaian_pembelajaran (subject_phase_id, version_id, cp_umum, is_active)
SELECT
  sp.subject_phase_id,
  sp.version_id,
  '[PENDING — diisi SIP Team dari SK BSKAP No. 046/H/KR/2025]',
  true
FROM core.subject_phases sp
ON CONFLICT (subject_phase_id, version_id) DO NOTHING;
