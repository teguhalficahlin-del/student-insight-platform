-- Drop overload lama fn_create_forum_post (9 parameter)
-- Digantikan oleh versi 11 parameter yang sudah live
DROP FUNCTION IF EXISTS public.fn_create_forum_post(
  uuid,    -- p_class_id
  text,    -- p_academic_year
  text,    -- p_content
  text,    -- p_category_code
  uuid[],  -- p_subject_student_ids
  text,    -- p_audience_type
  uuid[],  -- p_specific_user_ids
  text,    -- p_audience_type_2
  uuid[]   -- p_specific_user_ids_2
);
