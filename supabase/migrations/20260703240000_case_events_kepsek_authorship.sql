-- ============================================================
-- Migration 20260703240000: E3-2 — tutup celah authorship di policy KEPSEK
--
-- Temuan E3 (3 Juli 2026): policy insert case_events untuk handler biasa
-- SUDAH memverifikasi author_user_id = fn_current_user_id() DAN
-- author_role_at_time = fn_current_user_role() (anti-pemalsuan jejak).
-- TAPI rls_case_events_insert_kepsek hanya cek (school_id + fn_is_kepsek())
-- → seorang KEPSEK bisa menyisipkan event dengan author_user_id /
-- author_role_at_time milik orang lain (memalsukan SIAPA/peran di timeline
-- immutable). Severity low (KEPSEK = tepercaya, dalam sekolahnya) tapi
-- inkonsisten dengan policy handler.
--
-- Perbaikan: samakan — KEPSEK pun harus bertindak sebagai dirinya sendiri.
-- Aman: semua call-site klien mengirim authorUserId = currentUser.user_id &
-- authorRole = currentUser.role_type (= fn_current_user_id()/role) → nol
-- dampak ke KEPSEK sah. INV-1 (no-event-on-closed) tetap dijaga trigger
-- trg_case_events_no_closed, jadi tak perlu diulang di policy.
--
-- ROLLBACK: DROP POLICY rls_case_events_insert_kepsek; lalu CREATE versi lama
--   (WITH CHECK: school_id = fn_current_school_id() AND fn_is_kepsek()).
-- ============================================================

BEGIN;

DROP POLICY IF EXISTS rls_case_events_insert_kepsek ON case_events;

CREATE POLICY rls_case_events_insert_kepsek ON case_events
    FOR INSERT WITH CHECK (
        school_id            = fn_current_school_id()
        AND fn_is_kepsek()
        AND author_user_id      = fn_current_user_id()
        AND author_role_at_time = fn_current_user_role()
    );

COMMIT;
