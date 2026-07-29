-- ============================================================
-- Forum Sekolah — Schema Extension
-- Extend forum_posts untuk mendukung scope lintas peran
-- (scope_type='SEKOLAH') di samping forum kelas yang sudah ada
-- ============================================================

-- 1. class_id jadi nullable (forum sekolah tidak berbasis kelas)
ALTER TABLE public.forum_posts
  ALTER COLUMN class_id DROP NOT NULL;

-- 2. Tambah scope_type untuk membedakan dua mode forum
ALTER TABLE public.forum_posts
  ADD COLUMN IF NOT EXISTS scope_type text NOT NULL DEFAULT 'KELAS'
  CHECK (scope_type IN ('KELAS', 'SEKOLAH'));

-- 3. Backfill: semua posting lama adalah forum kelas
UPDATE public.forum_posts
SET scope_type = 'KELAS'
WHERE scope_type IS NULL OR scope_type != 'KELAS';

-- 4. Constraint: forum kelas wajib punya class_id,
--    forum sekolah wajib NULL class_id
ALTER TABLE public.forum_posts
  ADD CONSTRAINT chk_forum_posts_scope
  CHECK (
    (scope_type = 'KELAS'   AND class_id IS NOT NULL) OR
    (scope_type = 'SEKOLAH' AND class_id IS NULL)
  );

-- 5. Tabel baru: teacher_piket_assignments
CREATE TABLE IF NOT EXISTS public.teacher_piket_assignments (
  assignment_id uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid        NOT NULL REFERENCES public.users(user_id),
  school_id     uuid        NOT NULL,
  day_of_week   smallint    NOT NULL CHECK (day_of_week BETWEEN 1 AND 6),
  academic_year varchar     NOT NULL,
  is_active     boolean     NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, school_id, day_of_week, academic_year)
);

-- 6. Index untuk teacher_piket_assignments
CREATE INDEX IF NOT EXISTS idx_piket_school_day
  ON public.teacher_piket_assignments(school_id, day_of_week)
  WHERE is_active = true;

-- 7. Index tambahan untuk forum_posts scope lookup
CREATE INDEX IF NOT EXISTS idx_forum_posts_scope
  ON public.forum_posts(school_id, scope_type)
  WHERE scope_type = 'SEKOLAH';

-- 8. RLS untuk teacher_piket_assignments
ALTER TABLE public.teacher_piket_assignments
  ENABLE ROW LEVEL SECURITY;

-- Semua authenticated user di school bisa READ
-- (dibutuhkan saat pembuat forum pilih penerima "Guru Piket hari X")
CREATE POLICY rls_piket_select
  ON public.teacher_piket_assignments FOR SELECT
  USING (school_id = fn_current_school_id());

-- INSERT/UPDATE/DELETE hanya via ADMINISTRATIVE — tidak ada direct client write
CREATE POLICY rls_piket_admin_write
  ON public.teacher_piket_assignments FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE auth_user_id = auth.uid()
        AND school_id = fn_current_school_id()
        AND role_type = 'ADMINISTRATIVE'
    )
  );

-- 9. Storage bucket untuk attachment forum sekolah
--    (PDF / Word, max 10 MB)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'forum-attachments',
  'forum-attachments',
  false,
  10485760,
  ARRAY[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]
)
ON CONFLICT (id) DO NOTHING;

-- Storage RLS: upload hanya authenticated
CREATE POLICY "forum_attachments_upload"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'forum-attachments');

-- Storage RLS: download hanya authenticated
CREATE POLICY "forum_attachments_download"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'forum-attachments');
