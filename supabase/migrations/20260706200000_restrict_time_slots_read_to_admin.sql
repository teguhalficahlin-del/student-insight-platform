-- ============================================================
-- Migration: 20260706200000_restrict_time_slots_read_to_admin.sql
--
-- Fase 2.1 audit: rls_time_slots_read sebelumnya terbuka ke semua
-- role terautentikasi (hanya dibatasi school_id). Investigasi kode
-- mengonfirmasi tidak ada pemakaian tabel ini di portal non-admin
-- (guru, siswa, ortu, dudi, stakeholder, superadmin) — baik di kode
-- aktif, uncommitted work, maupun dokumentasi rencana fitur.
--
-- Pengetatan: tambah kondisi role ADMINISTRATIVE agar hanya TU/admin
-- yang bisa membaca slot waktu. rls_time_slots_write tidak diubah
-- (sudah membatasi ke ADMINISTRATIVE sejak mig 20260701350000).
-- ============================================================

DROP POLICY IF EXISTS rls_time_slots_read ON schedule_time_slots;

CREATE POLICY rls_time_slots_read ON schedule_time_slots
    FOR SELECT
    USING (
        school_id = fn_current_school_id()
        AND fn_current_user_role() = 'ADMINISTRATIVE'::role_type
    );
