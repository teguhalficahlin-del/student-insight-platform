-- ============================================================
-- T1-07 — Ganti GUC app.coaching_sync_active dengan pg_trigger_depth()
--
-- MASALAH:
--   app.coaching_sync_active adalah GUC biasa. Setiap klien bisa
--   menyalakannya sendiri lewat set_config('app.coaching_sync_active',
--   'true', true) — fungsi yang tersedia bebas via PostgREST. Empat
--   policy RLS dan satu trigger guard bergantung padanya, sehingga
--   pengaman integritas kasus BK bisa dilucuti dari sisi klien.
--
--   Terbukti perilaku sebelum migration ini (BEGIN...ROLLBACK):
--     - GURU creator menyalakan GUC lalu UPDATE langsung: status,
--       is_shared_to_parent, dan closed_at ikut berubah TANPA satu pun
--       baris di coaching_case_events (jejak audit hilang).
--     - Staf NON-handler menyalakan GUC lalu INSERT event ke kasus
--       milik orang lain: BERHASIL (n=1). Tanpa GUC ditolak 42501.
--       Lewat pintu ini penyerang bisa memicu ESCALATED / CLOSED /
--       SHARED_TO_PARENT pada kasus siapa pun di sekolahnya.
--
-- MENGAPA AMAN MENGHAPUS CABANG GUC DARI POLICY:
--   coaching_cases, coaching_case_events, dan coaching_case_handlers
--   dimiliki postgres dengan relforcerowsecurity = false, dan kedua
--   trigger penulisnya (fn_coaching_case_sync_handler,
--   fn_coaching_case_log_create) adalah SECURITY DEFINER milik
--   postgres (rolbypassrls = true). Artinya jalur sah TIDAK PERNAH
--   dievaluasi RLS sama sekali. Diverifikasi perilaku: handler
--   'authenticated' TANPA menyetel GUC tetap bisa INSERT
--   STATUS_CHANGED (status berubah) dan ESCALATED (handler pindah,
--   handover tercatat). Jadi cabang GUC di policy adalah dead code
--   untuk jalur sah — ia semata-mata pintu yang bisa dibuka klien.
--
-- AMBANG pg_trigger_depth() — TERUKUR, bukan diasumsikan:
--   Ada DUA frame yang berbeda:
--     (a) frame EXECUTOR — dipakai ekspresi RLS / DEFAULT / CHECK:
--           klien langsung = 0 ; dari dalam trigger = 1
--     (b) frame DALAM TRIGGER — dipakai fn_coaching_case_guard:
--           klien langsung = 1 ; dari trigger sync = 2
--   Karena itu policy memakai > 0 dan trigger guard memakai <= 1.
--   Di policy, > 0 dan > 1 sama-sama selalu false untuk klien;
--   > 0 dipilih karena jujur menyatakan invariannya: 'harus berasal
--   dari dalam trigger'.
--
-- CAKUPAN: 4 policy + 1 fungsi trigger.
--   rls_cce_insert: HANYA cabang GUC yang dihapus. Cabang
--   EXISTS(current_handler_user_id = fn_current_user_id() AND
--   status <> 'CLOSED') DIPERTAHANKAN — itulah jalur sah handler
--   menambah catatan/eskalasi (INSERT klien, depth 0).
--
-- ASUMSI YANG HARUS DIJAGA:
--   pg_trigger_depth() adalah heuristik TOPOLOGI, bukan otentikasi.
--   Ia membuktikan 'dipanggil dari dalam trigger', bukan 'dari
--   trigger yang benar'. Aman selama satu-satunya trigger yang
--   menulis ketiga tabel ini adalah fn_coaching_case_sync_handler
--   dan fn_coaching_case_log_create. JIKA TRIGGER BARU DITAMBAHKAN
--   pada coaching_cases / coaching_case_handlers / coaching_case_events,
--   ambang di migration ini WAJIB direview ulang.
--
-- CATATAN:
--   PERFORM set_config('app.coaching_sync_active', ...) di
--   fn_coaching_case_log_create dan fn_coaching_case_sync_handler
--   tidak dihapus di sini (kedua fungsi di luar scope perubahan ini);
--   setelah migration ia menjadi no-op tak berbahaya. Kandidat
--   pembersihan di sprint lanjutan.
--
-- IDEMPOTENSI: CREATE OR REPLACE untuk fungsi; DROP POLICY IF EXISTS
--   + CREATE POLICY untuk policy (PostgreSQL tidak punya
--   CREATE POLICY IF NOT EXISTS).
--
-- PRIVILEGE (CLAUDE.md 6c): fn_coaching_case_guard adalah trigger
--   function SECURITY DEFINER. Fungsi trigger tidak pernah dipanggil
--   langsung oleh role manapun (return type = trigger), sehingga tidak
--   ada GRANT EXECUTE yang perlu diberikan; ACL dibiarkan apa adanya.
-- ============================================================

BEGIN;

-- == 1. fn_coaching_case_guard: GUC -> pg_trigger_depth() <= 1 ==
CREATE OR REPLACE FUNCTION public.fn_coaching_case_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
    -- T1-07: dulu memeriksa GUC app.coaching_sync_active, yang bisa disetel
    -- siapa saja lewat set_config() sehingga guard ini bisa dilucuti klien.
    -- pg_trigger_depth() tidak bisa dipalsukan dari luar. Fungsi ini berjalan
    -- SEBAGAI trigger, jadi kedalamannya (terukur):
    --   1 = UPDATE datang langsung dari klien                -> guard HARUS aktif
    --   2 = UPDATE datang dari fn_coaching_case_sync_handler -> guard dilewati
    IF pg_trigger_depth() <= 1 THEN
        IF NEW.current_handler_user_id IS DISTINCT FROM OLD.current_handler_user_id
        OR NEW.status                  IS DISTINCT FROM OLD.status
        OR NEW.is_shared_to_student    IS DISTINCT FROM OLD.is_shared_to_student
        OR NEW.is_shared_to_parent     IS DISTINCT FROM OLD.is_shared_to_parent
        OR NEW.closed_at               IS DISTINCT FROM OLD.closed_at
        OR NEW.closed_by_user_id       IS DISTINCT FROM OLD.closed_by_user_id
        THEN
            RAISE EXCEPTION
                'integrity_guard: gunakan INSERT ke coaching_case_events untuk mengubah state kasus. '
                'Direct UPDATE tidak diizinkan. case_id=%', OLD.case_id
                USING ERRCODE = 'P0003';
        END IF;
    END IF;
    RETURN NEW;
END;
$function$
;


-- == 2. rls_cc_update ==========================================
--    USING     : GUC -> pg_trigger_depth() > 0
--    WITH CHECK: tambah fn_student_in_current_school(student_id)
--                (lapis kedua di atas trg_coaching_case_immutable_creator
--                 yang sudah memblokir perubahan student_id)
DROP POLICY IF EXISTS rls_cc_update ON public.coaching_cases;

CREATE POLICY rls_cc_update ON public.coaching_cases
    FOR UPDATE
    TO authenticated
    USING (
        school_id = fn_current_school_id()
        AND pg_trigger_depth() > 0
    )
    WITH CHECK (
        school_id = fn_current_school_id()
        AND fn_student_in_current_school(student_id)
    );

-- == 3. rls_cch_insert: GUC -> pg_trigger_depth() > 0 ==========
DROP POLICY IF EXISTS rls_cch_insert ON public.coaching_case_handlers;

CREATE POLICY rls_cch_insert ON public.coaching_case_handlers
    FOR INSERT
    TO authenticated
    WITH CHECK (
        school_id = fn_current_school_id()
        AND pg_trigger_depth() > 0
    );

-- == 4. rls_cch_update: GUC -> pg_trigger_depth() > 0 ==========
--    Policy lama tidak punya WITH CHECK eksplisit; dipertahankan
--    apa adanya (PostgreSQL memakai USING untuk keduanya).
DROP POLICY IF EXISTS rls_cch_update ON public.coaching_case_handlers;

CREATE POLICY rls_cch_update ON public.coaching_case_handlers
    FOR UPDATE
    TO authenticated
    USING (
        school_id = fn_current_school_id()
        AND pg_trigger_depth() > 0
    );

-- == 5. rls_cce_insert: hapus HANYA cabang GUC =================
--    Cabang handler dipertahankan utuh — itulah jalur sah klien
--    (INSERT langsung, depth 0) untuk menambah catatan/eskalasi.
DROP POLICY IF EXISTS rls_cce_insert ON public.coaching_case_events;

CREATE POLICY rls_cce_insert ON public.coaching_case_events
    FOR INSERT
    TO authenticated
    WITH CHECK (
        school_id          = fn_current_school_id()
        AND author_user_id = fn_current_user_id()
        AND EXISTS (
            SELECT 1
            FROM   coaching_cases c
            WHERE  c.case_id                 = coaching_case_events.case_id
              AND  c.current_handler_user_id = fn_current_user_id()
              AND  c.status                  <> 'CLOSED'::case_status
        )
    );

COMMIT;
