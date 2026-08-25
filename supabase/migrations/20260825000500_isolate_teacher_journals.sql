-- Isolasi penuh teacher_journals dari fitur lain.
-- Keputusan arsitektur: Catatan Jurnal independen.
-- Verifikasi pra-migration (2026-08-25): teacher_journals 0 baris;
-- schedule_id/tp_id/class_id semuanya 0 terisi.

BEGIN;

-- 1. DROP trigger sinyal kehadiran guru (bug desain —
--    sinyal kehadiran hanya boleh dari input absensi).
--    attendance + observations tetap memakai fn_teacher_attendance_signal.
DROP TRIGGER IF EXISTS trg_teacher_signal_journal ON teacher_journals;

-- 2. Ganti fn_sync_journal SEBELUM kolom di-DROP.
--    WAJIB: fungsi lama INSERT ke schedule_id + class_id. plpgsql tidak
--    divalidasi saat DROP COLUMN, jadi tanpa langkah ini migration lolos
--    tapi SEMUA simpan jurnal gagal saat runtime.
--    Signature dipertahankan persis (p_schedule_id, p_class_id tetap
--    diterima lalu diabaikan) supaya edge function sync-journal —
--    yang selalu mengirim kedua parameter — tidak perlu diubah.
CREATE OR REPLACE FUNCTION public.fn_sync_journal(
    p_idempotency_key text,
    p_journal_id      uuid,
    p_owner_user_id   uuid,
    p_entry_date      date,
    p_content         text,
    p_schedule_id     uuid DEFAULT NULL::uuid,
    p_class_id        uuid DEFAULT NULL::uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    v_school_id UUID;
BEGIN
    -- DEAD GUARD: auth.uid() selalu NULL saat dipanggil via service_role
    -- dari edge function sync-journal. Blok ini tidak pernah dieksekusi.
    -- Proteksi owner dilakukan di edge function (pre-check owner_user_id)
    -- dan di RLS policy rls_journals_owner (FOR ALL, USING + WITH CHECK).
    -- Jangan hapus blok ini — biarkan sebagai dokumentasi intent.
    IF auth.uid() IS NOT NULL
       AND fn_current_user_id() IS DISTINCT FROM p_owner_user_id THEN
        RAISE EXCEPTION 'akses ditolak: pemilik jurnal harus akun yang sedang login'
            USING ERRCODE = '42501';
    END IF;

    -- p_schedule_id dan p_class_id sengaja TIDAK dipakai: kolomnya sudah
    -- dilepas demi isolasi. Parameter dipertahankan demi kompatibilitas
    -- pemanggil (edge function sync-journal, contracts/11_api_contract.js).

    SELECT school_id INTO v_school_id
    FROM users
    WHERE user_id = p_owner_user_id;
    IF v_school_id IS NULL THEN
        RAISE EXCEPTION 'owner_not_found: user_id = %', p_owner_user_id
            USING ERRCODE = 'P0004';
    END IF;

    INSERT INTO teacher_journals (
        journal_id, owner_user_id, entry_date, content, school_id
    ) VALUES (
        p_journal_id, p_owner_user_id, p_entry_date, p_content, v_school_id
    )
    ON CONFLICT (journal_id) DO UPDATE SET
        entry_date = EXCLUDED.entry_date,
        content    = EXCLUDED.content,
        updated_at = NOW();

    IF p_idempotency_key IS NOT NULL THEN
        INSERT INTO sync_idempotency (
            idempotency_key, function_name, result_json, school_id
        ) VALUES (
            p_idempotency_key, 'sync-journal',
            jsonb_build_object('journal_id', p_journal_id),
            v_school_id
        )
        ON CONFLICT (idempotency_key) DO NOTHING;
    END IF;

    RETURN jsonb_build_object('journal_id', p_journal_id);
END;
$function$;

-- 3. DROP kolom yang tidak dipakai JS (sisa desain lama, semua NULL).
--    FK-nya (schedule_id/class_id RESTRICT, tp_id SET NULL) ikut terlepas.
ALTER TABLE teacher_journals
    DROP COLUMN IF EXISTS schedule_id,
    DROP COLUMN IF EXISTS tp_id,
    DROP COLUMN IF EXISTS class_id;

-- Kolom yang DIPERTAHANKAN:
--   journal_id, owner_user_id, entry_date, content,
--   created_at, updated_at, school_id,
--   kondisi_kelas, catatan_tambahan, tindak_lanjut

COMMIT;
