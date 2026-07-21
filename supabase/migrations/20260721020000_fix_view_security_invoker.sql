-- Fix security_invoker dan anon REVOKE untuk dua view.
-- TEMUAN 1: v_core_subjects — security_invoker off + anon bocor
-- TEMUAN 2: v_cp_for_generate — security_invoker off (REVOKE sudah benar)

ALTER VIEW public.v_core_subjects    SET (security_invoker = true);
ALTER VIEW public.v_cp_for_generate  SET (security_invoker = true);

REVOKE ALL    ON public.v_core_subjects FROM anon;
REVOKE SELECT ON public.v_core_subjects FROM PUBLIC;
