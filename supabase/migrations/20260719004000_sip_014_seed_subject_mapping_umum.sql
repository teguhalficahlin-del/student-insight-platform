-- Seed: mapping 11 mapel umum SMKN 1 Ujungbatu → core.subjects
-- school_id: 244e389c-de7d-4d70-ac95-346d33a5d02c (SMK N 1 Ujungbatu)
-- Semua program_id = NULL (berlaku lintas program / mapel umum)
-- mapping_type = 'AUTO' (seeded oleh sistem)

INSERT INTO public.subject_cp_mapping
  (school_id, subject_id, program_id, core_subject_id, mapping_type)
VALUES
  -- AGAMA → PAI (Pendidikan Agama Islam & Budi Pekerti)
  -- Seed hanya PAI karena mayoritas siswa Muslim. Agama lain bisa ditambah kemudian.
  (
    '244e389c-de7d-4d70-ac95-346d33a5d02c',
    'f98c9736-90f1-43d1-bd39-b0b550441d56',  -- AGAMA
    NULL,
    '00000000-0000-0000-0010-000000000001',  -- PAI
    'AUTO'
  ),

  -- B.IND → BIN (Bahasa Indonesia)
  (
    '244e389c-de7d-4d70-ac95-346d33a5d02c',
    '18792be4-dda7-44f4-8f0c-b3fffa4e1038',  -- B.IND
    NULL,
    '00000000-0000-0000-0010-000000000008',  -- BIN
    'AUTO'
  ),

  -- B.INDO → BIN (Bahasa Indonesia) — kode duplikat di sekolah, mapel sama
  (
    '244e389c-de7d-4d70-ac95-346d33a5d02c',
    '629dda51-ba28-44c3-bbc6-276f639c1a9e',  -- B.INDO
    NULL,
    '00000000-0000-0000-0010-000000000008',  -- BIN
    'AUTO'
  ),

  -- B.ING → BING (Bahasa Inggris)
  (
    '244e389c-de7d-4d70-ac95-346d33a5d02c',
    '50e697f4-78f8-4dcd-bda8-66a47b54c58c',  -- B.ING
    NULL,
    '00000000-0000-0000-0010-000000000017',  -- BING
    'AUTO'
  ),

  -- B.INGG → BING (Bahasa Inggris) — kode duplikat di sekolah, mapel sama
  (
    '244e389c-de7d-4d70-ac95-346d33a5d02c',
    '59a9331e-5b6b-4aa0-9c75-4ce1a4c9ea8f',  -- B.INGG
    NULL,
    '00000000-0000-0000-0010-000000000017',  -- BING
    'AUTO'
  ),

  -- INF → INF (Informatika)
  (
    '244e389c-de7d-4d70-ac95-346d33a5d02c',
    '190952e8-2c65-48b2-bf38-78b9d24ca8e9',  -- INF
    NULL,
    '00000000-0000-0000-0010-000000000018',  -- INF (Informatika)
    'AUTO'
  ),

  -- IPAS → IPAS (Projek IPAS)
  (
    '244e389c-de7d-4d70-ac95-346d33a5d02c',
    'dbaac96c-7445-4956-beb4-d98eccf8821f',  -- IPAS
    NULL,
    '00000000-0000-0000-0010-000000000019',  -- IPAS
    'AUTO'
  ),

  -- MTK → MAT (Matematika)
  (
    '244e389c-de7d-4d70-ac95-346d33a5d02c',
    'a0ab6452-75b9-422e-81a7-88a92642b773',  -- MTK
    NULL,
    '00000000-0000-0000-0010-000000000016',  -- MAT
    'AUTO'
  ),

  -- PJOK → PJOK
  (
    '244e389c-de7d-4d70-ac95-346d33a5d02c',
    '33de0925-eed0-463b-8f7e-7dab83c9e50a',  -- PJOK
    NULL,
    '00000000-0000-0000-0010-000000000009',  -- PJOK
    'AUTO'
  ),

  -- PKN → PPKn (Pendidikan Pancasila)
  (
    '244e389c-de7d-4d70-ac95-346d33a5d02c',
    '7e3d4553-fa99-4bf5-bd34-6f923a847ddd',  -- PKN
    NULL,
    '00000000-0000-0000-0010-000000000007',  -- PPKn
    'AUTO'
  ),

  -- PPKN → PPKn (Pendidikan Pancasila) — kode duplikat di sekolah, mapel sama
  (
    '244e389c-de7d-4d70-ac95-346d33a5d02c',
    '39bf0dd4-edda-461c-bf51-5a74434f6820',  -- PPKN
    NULL,
    '00000000-0000-0000-0010-000000000007',  -- PPKn
    'AUTO'
  ),

  -- SB → SB_MUS (Seni Budaya Musik) sebagai default
  -- Guru bisa diubah ke SB_RUP/SB_TEA/SB_TAR sesuai pilihan seni yang diajarkan
  (
    '244e389c-de7d-4d70-ac95-346d33a5d02c',
    'd1dc6b32-ba7d-461c-923d-6a4b88c3584f',  -- SB
    NULL,
    '00000000-0000-0000-0010-000000000011',  -- SB_MUS
    'AUTO'
  ),

  -- SJR → SEJ (Sejarah)
  (
    '244e389c-de7d-4d70-ac95-346d33a5d02c',
    'a620c9a8-a0d3-4da6-aba5-9b5d0c65f8bf',  -- SJR
    NULL,
    '00000000-0000-0000-0010-000000000010',  -- SEJ
    'AUTO'
  )

ON CONFLICT (school_id, subject_id, program_id, core_subject_id)
DO UPDATE SET
  is_active = true,
  mapping_type = EXCLUDED.mapping_type;
