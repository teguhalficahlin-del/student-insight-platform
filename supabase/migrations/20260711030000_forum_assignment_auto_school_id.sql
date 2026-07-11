-- Migration: forum_assignment_auto_school_id
-- Tujuan: tambah trigger trg_auto_school_id ke
-- bk_class_assignments dan guru_wali_assignments
-- agar school_id terisi otomatis dari fn_current_school_id()
-- saat INSERT tanpa school_id eksplisit.
-- Catatan: fn_auto_set_school_id sudah ada dan dipakai
-- oleh 18+ tabel lain — kita hanya pasang trigger baru
-- tanpa mengubah fungsinya.

CREATE TRIGGER trg_auto_school_id
    BEFORE INSERT ON bk_class_assignments
    FOR EACH ROW EXECUTE FUNCTION fn_auto_set_school_id();

CREATE TRIGGER trg_auto_school_id
    BEFORE INSERT ON guru_wali_assignments
    FOR EACH ROW EXECUTE FUNCTION fn_auto_set_school_id();
