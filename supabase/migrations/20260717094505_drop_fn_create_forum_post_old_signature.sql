-- Hapus versi lama fn_create_forum_post (7 parameter)
-- Versi baru (9 parameter) sudah ada dari migration sebelumnya
DROP FUNCTION IF EXISTS fn_create_forum_post(
  uuid,    -- p_class_id
  text,    -- p_academic_year
  text,    -- p_content
  text,    -- p_category_code
  uuid[],  -- p_subject_student_ids
  text,    -- p_audience_type
  uuid[]   -- p_specific_user_ids
);
