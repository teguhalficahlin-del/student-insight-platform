-- ============================================================
-- Perbaikan fn_toggle_tp_taught — HTTP 400 / SQLSTATE 42702
--
-- GEJALA:
--   POST /rest/v1/rpc/fn_toggle_tp_taught -> 400 Bad Request
--   setiap kali guru mencentang TP di tab Jurnal.
--
-- PENYEBAB (direproduksi, bukan diduga):
--   BEGIN...ROLLBACK dengan sesi guru sungguhan disimulasikan lewat
--   set_config('request.jwt.claims', ...) menghasilkan:
--
--     SQLSTATE = 42702
--     MESSAGE  = column reference "teacher_id" is ambiguous
--
--   RETURNS TABLE (id, teacher_id, class_id, tp_id, school_id,
--   is_taught, taught_at, updated_at) mendeklarasikan kedelapan nama
--   itu sebagai variabel OUT PL/pgSQL. Di dalam badan fungsi,
--   ON CONFLICT (teacher_id, class_id, tp_id) menjadi ambigu antara
--   variabel OUT dan kolom tabel. PostgreSQL memetakan 42702 ke
--   HTTP 400, itulah error yang terlihat di browser.
--
--   Ambiguitas ini tidak terdeteksi saat CREATE FUNCTION karena
--   PL/pgSQL hanya memeriksa sintaks di waktu pembuatan; resolusi
--   nama baru terjadi saat eksekusi pertama.
--
-- PERBAIKAN:
--   Tambah #variable_conflict use_column di baris pertama badan
--   fungsi. Direktif ini memerintahkan PL/pgSQL memenangkan KOLOM
--   saat sebuah nama bisa berarti kolom atau variabel.
--
--   Aman untuk fungsi ini karena semua variabel yang benar-benar
--   dipakai sebagai nilai punya nama yang tidak bertabrakan dengan
--   kolom manapun: v_teacher_id, v_school_id, p_class_id, p_tp_id,
--   p_is_taught. Jadi tidak ada satu pun referensi variabel yang
--   berubah arti akibat direktif ini — yang berubah hanya
--   ON CONFLICT, yang memang seharusnya menunjuk kolom.
--
-- KENAPA BUKAN MENGGANTI NAMA KOLOM OUT:
--   Mengganti id -> out_id dan seterusnya juga menghilangkan
--   ambiguitas, tapi sekaligus mengubah nama field pada JSON balasan
--   RPC. Itu permukaan API yang dipakai klien; direktif satu baris
--   memperbaiki bug tanpa menyentuhnya.
--
-- IDEMPOTENSI: CREATE OR REPLACE. Signature tidak berubah
--   (uuid, text, boolean), jadi tidak ada overload baru yang lahir
--   dan tidak perlu DROP lebih dulu.
--
-- PRIVILEGE (CLAUDE.md 6c): SECURITY DEFINER dipertahankan, disertai
--   satu GRANT + dua REVOKE. CREATE OR REPLACE tidak mereset ACL,
--   tapi ketiganya ditulis ulang agar migration ini utuh berdiri
--   sendiri kalau dijalankan di database yang belum punya fungsinya.
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_toggle_tp_taught(
    p_class_id  uuid,
    p_tp_id     text,
    p_is_taught boolean
)
RETURNS TABLE (
    id         uuid,
    teacher_id uuid,
    class_id   uuid,
    tp_id      text,
    school_id  uuid,
    is_taught  boolean,
    taught_at  timestamptz,
    updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE
    v_teacher_id uuid := fn_current_user_id();
    v_school_id  uuid := fn_current_school_id();
BEGIN
    IF v_teacher_id IS NULL OR v_school_id IS NULL THEN
        RAISE EXCEPTION 'Sesi tidak ditemukan';
    END IF;

    RETURN QUERY
    INSERT INTO tp_taught_status (teacher_id, class_id, tp_id, school_id, is_taught, taught_at, updated_at)
    VALUES (
        v_teacher_id,
        p_class_id,
        p_tp_id,
        v_school_id,
        p_is_taught,
        CASE WHEN p_is_taught THEN now() ELSE NULL END,
        now()
    )
    ON CONFLICT (teacher_id, class_id, tp_id) DO UPDATE
        SET is_taught  = EXCLUDED.is_taught,
            taught_at  = CASE WHEN EXCLUDED.is_taught THEN now() ELSE NULL END,
            updated_at = now()
    RETURNING
        tp_taught_status.id,
        tp_taught_status.teacher_id,
        tp_taught_status.class_id,
        tp_taught_status.tp_id,
        tp_taught_status.school_id,
        tp_taught_status.is_taught,
        tp_taught_status.taught_at,
        tp_taught_status.updated_at;
END;
$function$;

GRANT   EXECUTE ON FUNCTION public.fn_toggle_tp_taught(uuid, text, boolean) TO authenticated;
REVOKE  EXECUTE ON FUNCTION public.fn_toggle_tp_taught(uuid, text, boolean) FROM anon;
REVOKE  EXECUTE ON FUNCTION public.fn_toggle_tp_taught(uuid, text, boolean) FROM PUBLIC;

COMMIT;
