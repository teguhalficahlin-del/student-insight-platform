-- Migration: drop-old-cases
-- Drop tabel lama (cases, case_events, case_audience_members), view dependennya,
-- fungsi-fungsi trigger lama, dan enum lama (case_audience, case_event_type).
--
-- DIPERTAHANKAN: case_status, case_track (masih dipakai di coaching_cases)
-- DIPERTAHANKAN: coaching_case_event_type (enum baru, bukan lama)
--
-- Catatan CASCADE:
--   DROP TABLE cases CASCADE → drop FK constraint di notifications + student_updates.
--   174 baris notifications yang punya case_id tetap ada; FK constraint dihapus,
--   kolom case_id menjadi plain UUID tanpa referential constraint. Ini by-design:
--   notifikasi lama tetap tersimpan, referensi ke kasus lama tidak lagi valid.

-- 1. Drop view yang bergantung pada case_events dan case_event_type enum
DROP VIEW IF EXISTS v_case_timeline;

-- 2. Drop tabel lama (urutan: child dulu, parent terakhir)
DROP TABLE IF EXISTS case_audience_members CASCADE;
DROP TABLE IF EXISTS case_events CASCADE;
DROP TABLE IF EXISTS cases CASCADE;

-- 3. Drop RLS policy lama di student_updates yang masih mereferensikan fn_can_see_case
--    Policy ini mengacu sistem kasus lama — tidak relevan setelah drop tabel lama.
DROP POLICY IF EXISTS rls_student_updates_read_student ON student_updates;
DROP POLICY IF EXISTS rls_student_updates_read_parent ON student_updates;

-- 4. Drop fungsi-fungsi trigger dan helper lama
--    (trigger di cases/case_events sudah ikut terdrop bersama tabelnya)
DROP FUNCTION IF EXISTS fn_can_see_case(uuid);
DROP FUNCTION IF EXISTS fn_is_internal_case_actor();
DROP FUNCTION IF EXISTS fn_user_is_internal_case_actor(uuid);
DROP FUNCTION IF EXISTS fn_case_sync_handler();
DROP FUNCTION IF EXISTS fn_case_guard_denormalized();
DROP FUNCTION IF EXISTS fn_case_immutable_fields();
DROP FUNCTION IF EXISTS fn_case_validate_escalate();
DROP FUNCTION IF EXISTS fn_case_log_create_event();
DROP FUNCTION IF EXISTS fn_sync_case(text, uuid, uuid, uuid, text, text, text, text, text);

-- 5. Drop enum lama
--    case_event_type: sudah tidak dipakai setelah v_case_timeline di-drop
--    case_audience: hanya dipakai di cases.audience (sudah di-drop)
DROP TYPE IF EXISTS case_event_type;
DROP TYPE IF EXISTS case_audience;
