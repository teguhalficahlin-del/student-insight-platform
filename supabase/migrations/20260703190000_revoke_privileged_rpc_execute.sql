-- =====================================================================
-- 20260703190000_revoke_privileged_rpc_execute.sql
--
-- PERBAIKAN AUDIT MULTI-TENANT — Temuan 1, 2, 3, 6, 8
--
-- LATAR BELAKANG
--   Fungsi SECURITY DEFINER berikut mewarisi default Supabase
--   `GRANT EXECUTE ... TO PUBLIC`, sehingga dapat dipanggil LANGSUNG
--   oleh peran `anon`/`authenticated` via PostgREST (/rest/v1/rpc/...),
--   MELEWATI seluruh pemeriksaan auth di Edge Function.
--
--   Dibuktikan hidup di produksi (probe anon):
--     - fn_sync_observation      -> P0004 author_not_found  (body tereksekusi)
--     - fn_batalkan_tahun_ajaran -> P0001 config not found  (body tereksekusi)
--
--   Pola benar sudah diterapkan di migration 2024
--   (fn_sync_attendance_batch, fn_bulk_import_students) tetapi TIDAK
--   diterapkan pada fungsi yang ditambahkan Juni–Juli 2026.
--
-- STRATEGI
--   A. REVOKE EXECUTE dari PUBLIC/anon/authenticated pada fungsi yang
--      HANYA dipanggil Edge Function (via service_role).
--      service_role mempertahankan EXECUTE (dibuktikan: has_function_privilege
--      service_role pada fn_sync_attendance_batch = true), dan ditegaskan
--      kembali dengan GRANT eksplisit di bawah.
--   B. GUARD INTERNAL (defense-in-depth) yang SERVICE_ROLE-SAFE:
--      pemeriksaan hanya ditegakkan bila ada sesi user (auth.uid() NOT NULL);
--      panggilan service_role (auth.uid() = NULL) dibiarkan lolos agar
--      jalur Edge Function yang sah tidak rusak.
--   C. Untuk fungsi yang MEMANG dipanggil langsung dari frontend oleh user
--      login (fn_stakeholder_summary, fn_get_stale_staff,
--      fn_deactivate_stale_staff dari admin/stakeholder dashboard),
--      REVOKE HANYA dari `anon` — `authenticated` dipertahankan.
--
-- IDEMPOTEN: aman dijalankan ulang.
-- TIDAK menyentuh data baris; hanya hak akses + badan fungsi.
-- =====================================================================


-- =====================================================================
-- TEMUAN 2 (HIGH) — Injeksi lintas tenant: observasi / kasus / jurnal
-- Guard: penulis harus = akun login (kecuali service_role).
-- =====================================================================

CREATE OR REPLACE FUNCTION public.fn_sync_observation(
    p_idempotency_key text, p_observation_id uuid, p_author_user_id uuid,
    p_student_id uuid, p_sentiment text, p_dimension text, p_visibility text,
    p_content text, p_observed_at timestamp with time zone,
    p_schedule_id uuid DEFAULT NULL::uuid, p_class_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_school_id UUID;
BEGIN
    -- GUARD (service_role-safe): user login hanya boleh menulis atas namanya sendiri
    IF auth.uid() IS NOT NULL
       AND fn_current_user_id() IS DISTINCT FROM p_author_user_id THEN
        RAISE EXCEPTION 'akses ditolak: penulis harus akun yang sedang login'
            USING ERRCODE = '42501';
    END IF;

    -- Derive school_id dari penulis
    SELECT school_id INTO v_school_id
    FROM users
    WHERE user_id = p_author_user_id;

    IF v_school_id IS NULL THEN
        RAISE EXCEPTION 'author_not_found: user_id = %', p_author_user_id
            USING ERRCODE = 'P0004';
    END IF;

    INSERT INTO observations (
        observation_id, author_user_id, student_id,
        sentiment, dimension, visibility, content, observed_at,
        schedule_id, class_id, school_id
    ) VALUES (
        p_observation_id, p_author_user_id, p_student_id,
        p_sentiment::observation_sentiment,
        p_dimension::observation_dimension,
        p_visibility::visibility_level,
        p_content, p_observed_at,
        p_schedule_id, p_class_id, v_school_id
    )
    ON CONFLICT (observation_id) DO UPDATE SET
        sentiment   = EXCLUDED.sentiment,
        dimension   = EXCLUDED.dimension,
        visibility  = EXCLUDED.visibility,
        content     = EXCLUDED.content,
        observed_at = EXCLUDED.observed_at,
        updated_at  = NOW();

    IF p_idempotency_key IS NOT NULL THEN
        INSERT INTO sync_idempotency (
            idempotency_key, function_name, result_json, school_id
        ) VALUES (
            p_idempotency_key, 'sync-observation',
            jsonb_build_object('observation_id', p_observation_id),
            v_school_id
        )
        ON CONFLICT (idempotency_key) DO NOTHING;
    END IF;

    RETURN jsonb_build_object('observation_id', p_observation_id);
END;
$function$;


CREATE OR REPLACE FUNCTION public.fn_sync_case(
    p_idempotency_key text, p_case_id uuid, p_student_id uuid,
    p_created_by_user_id uuid, p_initiated_by_role text, p_track text,
    p_title text, p_description text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_school_id UUID;
BEGIN
    -- GUARD (service_role-safe): pembuat kasus harus = akun login
    IF auth.uid() IS NOT NULL
       AND fn_current_user_id() IS DISTINCT FROM p_created_by_user_id THEN
        RAISE EXCEPTION 'akses ditolak: pembuat kasus harus akun yang sedang login'
            USING ERRCODE = '42501';
    END IF;

    SELECT school_id INTO v_school_id
    FROM users
    WHERE user_id = p_created_by_user_id;

    IF v_school_id IS NULL THEN
        RAISE EXCEPTION 'author_not_found: user_id = %', p_created_by_user_id
            USING ERRCODE = 'P0004';
    END IF;

    INSERT INTO cases (
        case_id, student_id, created_by_user_id,
        initiated_by_role, current_handler_role,
        track, title, description, school_id
    ) VALUES (
        p_case_id, p_student_id, p_created_by_user_id,
        p_initiated_by_role, p_initiated_by_role,
        p_track, p_title, p_description, v_school_id
    )
    ON CONFLICT (case_id) DO NOTHING;

    IF p_idempotency_key IS NOT NULL THEN
        INSERT INTO sync_idempotency (
            idempotency_key, function_name, result_json, school_id
        ) VALUES (
            p_idempotency_key, 'sync-case',
            jsonb_build_object('case_id', p_case_id),
            v_school_id
        )
        ON CONFLICT (idempotency_key) DO NOTHING;
    END IF;

    RETURN jsonb_build_object('case_id', p_case_id);
END;
$function$;


CREATE OR REPLACE FUNCTION public.fn_sync_journal(
    p_idempotency_key text, p_journal_id uuid, p_owner_user_id uuid,
    p_entry_date date, p_content text,
    p_schedule_id uuid DEFAULT NULL::uuid, p_class_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_school_id UUID;
BEGIN
    -- GUARD (service_role-safe): pemilik jurnal harus = akun login
    IF auth.uid() IS NOT NULL
       AND fn_current_user_id() IS DISTINCT FROM p_owner_user_id THEN
        RAISE EXCEPTION 'akses ditolak: pemilik jurnal harus akun yang sedang login'
            USING ERRCODE = '42501';
    END IF;

    SELECT school_id INTO v_school_id
    FROM users
    WHERE user_id = p_owner_user_id;

    IF v_school_id IS NULL THEN
        RAISE EXCEPTION 'owner_not_found: user_id = %', p_owner_user_id
            USING ERRCODE = 'P0004';
    END IF;

    INSERT INTO teacher_journals (
        journal_id, owner_user_id, entry_date, content,
        schedule_id, class_id, school_id
    ) VALUES (
        p_journal_id, p_owner_user_id, p_entry_date, p_content,
        p_schedule_id, p_class_id, v_school_id
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


-- =====================================================================
-- TEMUAN 3 (HIGH) — Manipulasi jadwal lintas tenant (school_id dari param)
-- Guard: user login harus admin/kepsek DI sekolah p_school_id.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.fn_apply_schedule_templates(
    p_academic_year text, p_semester semester, p_school_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_subject_id  uuid;
    v_start       date;
    v_end         date;
    v_templates   integer;
    v_assignments integer;
    v_schedules   integer;
BEGIN
    -- GUARD (service_role-safe): batasi user login ke sekolahnya sendiri + peran
    IF auth.uid() IS NOT NULL AND (
           p_school_id IS DISTINCT FROM fn_current_school_id()
        OR NOT (fn_is_kepsek() OR fn_current_user_role() = 'ADMINISTRATIVE')
    ) THEN
        RAISE EXCEPTION 'akses ditolak: hanya admin/kepsek sekolah terkait'
            USING ERRCODE = '42501';
    END IF;

    SELECT count(*) INTO v_templates
    FROM schedule_templates
    WHERE academic_year = p_academic_year AND semester = p_semester
      AND school_id = p_school_id;

    IF v_templates = 0 THEN
        RETURN jsonb_build_object('templates_found', 0, 'assignments_upserted', 0, 'schedules_generated', 0);
    END IF;

    SELECT start_date, end_date INTO v_start, v_end
    FROM academic_periods
    WHERE academic_year = p_academic_year AND semester = p_semester
      AND school_id = p_school_id;

    IF v_start IS NULL THEN
        RAISE EXCEPTION 'Periode akademik % semester % belum terdaftar', p_academic_year, p_semester;
    END IF;

    SELECT subject_id INTO v_subject_id
    FROM subjects WHERE code = 'KBM' AND school_id = p_school_id;
    IF v_subject_id IS NULL THEN
        INSERT INTO subjects (code, name, is_active, school_id)
        VALUES ('KBM', 'Kegiatan Belajar Mengajar', true, p_school_id)
        RETURNING subject_id INTO v_subject_id;
    END IF;

    INSERT INTO teaching_assignments (user_id, class_id, subject_id, academic_year, semester, is_active, school_id)
    SELECT DISTINCT t.teacher_id, t.class_id, v_subject_id, p_academic_year, p_semester, true, p_school_id
    FROM schedule_templates t
    WHERE t.academic_year = p_academic_year AND t.semester = p_semester
      AND t.school_id = p_school_id
    ON CONFLICT (user_id, class_id, subject_id, academic_year, semester)
    DO UPDATE SET is_active = true;
    GET DIAGNOSTICS v_assignments = ROW_COUNT;

    INSERT INTO teaching_schedules
        (assignment_id, class_id, subject_id, scheduled_teacher_id,
         session_date, session_start, session_end,
         academic_year, semester, meeting_status, teacher_indicator, school_id)
    SELECT a.assignment_id, t.class_id, v_subject_id, t.teacher_id,
           gs.d::date, t.start_time, t.end_time,
           p_academic_year, p_semester,
           'NORMAL'::meeting_status, 'PENDING_EVALUATION'::teacher_attendance_indicator, p_school_id
    FROM schedule_templates t
    JOIN teaching_assignments a
      ON a.user_id        = t.teacher_id
     AND a.class_id       = t.class_id
     AND a.subject_id     = v_subject_id
     AND a.academic_year  = p_academic_year
     AND a.semester       = p_semester
    JOIN generate_series(v_start::timestamp, v_end::timestamp, interval '1 day') gs(d)
      ON extract(isodow from gs.d) = CASE t.day_of_week::text
            WHEN 'SENIN'  THEN 1 WHEN 'SELASA' THEN 2 WHEN 'RABU' THEN 3
            WHEN 'KAMIS'  THEN 4 WHEN 'JUMAT'  THEN 5 WHEN 'SABTU' THEN 6 END
    WHERE t.academic_year = p_academic_year AND t.semester = p_semester
      AND t.school_id = p_school_id
    ON CONFLICT (class_id, scheduled_teacher_id, session_date, session_start)
    DO NOTHING;
    GET DIAGNOSTICS v_schedules = ROW_COUNT;

    RETURN jsonb_build_object(
        'templates_found',      v_templates,
        'assignments_upserted', v_assignments,
        'schedules_generated',  v_schedules
    );
END;
$function$;


-- =====================================================================
-- TEMUAN 1 (CRITICAL) — Pembatalan tahun ajaran destruktif lintas tenant
-- Guard: user login harus admin/kepsek DI sekolah pemilik config.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.fn_batalkan_tahun_ajaran(p_config_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_school_id       UUID;
    v_cur_year        TEXT;
    v_cur_sem         semester;
    v_prev_year       TEXT;
    v_prev_sem        semester;
    v_deleted_enroll  INTEGER := 0;
    v_restored        INTEGER := 0;
    v_deleted_periods INTEGER := 0;
BEGIN
    SELECT school_id, current_academic_year, current_semester
        INTO v_school_id, v_cur_year, v_cur_sem
        FROM school_config WHERE config_id = p_config_id;
    IF v_school_id IS NULL THEN
        RAISE EXCEPTION 'school_config dengan id % tidak ditemukan', p_config_id;
    END IF;

    -- GUARD (service_role-safe): user login hanya boleh membatalkan sekolahnya sendiri
    IF auth.uid() IS NOT NULL AND (
           v_school_id IS DISTINCT FROM fn_current_school_id()
        OR NOT (fn_is_kepsek() OR fn_current_user_role() = 'ADMINISTRATIVE')
    ) THEN
        RAISE EXCEPTION 'akses ditolak: hanya admin/kepsek sekolah terkait'
            USING ERRCODE = '42501';
    END IF;

    -- Tahun/semester sebelumnya (untuk dipulihkan ke school_config)
    SELECT academic_year, semester INTO v_prev_year, v_prev_sem
    FROM academic_periods
    WHERE school_id = v_school_id
      AND (academic_year < v_cur_year
           OR (academic_year = v_cur_year AND semester < v_cur_sem))
    ORDER BY academic_year DESC, semester DESC
    LIMIT 1;

    IF v_prev_year IS NULL THEN
        RAISE EXCEPTION 'Tidak ada tahun ajaran sebelumnya untuk dipulihkan. Pembatalan dihentikan demi keamanan.';
    END IF;

    -- (1) Pulihkan enrollment tahun lama untuk siswa yang naik kelas
    UPDATE class_enrollments
        SET withdrawn_at = NULL, updated_at = now()
    WHERE school_id = v_school_id
      AND academic_year = v_prev_year
      AND withdrawn_at IS NOT NULL
      AND student_id IN (
          SELECT student_id FROM class_enrollments
          WHERE school_id = v_school_id AND academic_year = v_cur_year
      );
    GET DIAGNOSTICS v_restored = ROW_COUNT;

    -- (2) Hapus enrollment tahun baru (hasil kenaikan kelas)
    DELETE FROM class_enrollments
    WHERE school_id = v_school_id AND academic_year = v_cur_year;
    GET DIAGNOSTICS v_deleted_enroll = ROW_COUNT;

    -- (3) Hapus periode tahun baru (semua semester tahun tsb)
    DELETE FROM academic_periods
    WHERE school_id = v_school_id AND academic_year = v_cur_year;
    GET DIAGNOSTICS v_deleted_periods = ROW_COUNT;

    -- (4) Kembalikan school_config ke tahun/semester sebelumnya
    UPDATE school_config
        SET current_academic_year = v_prev_year,
            current_semester      = v_prev_sem,
            updated_at            = now()
    WHERE config_id = p_config_id;

    RETURN jsonb_build_object(
        'success',              true,
        'cancelled_year',       v_cur_year,
        'cancelled_semester',   v_cur_sem,
        'restored_year',        v_prev_year,
        'restored_semester',    v_prev_sem,
        'deleted_enrollments',  v_deleted_enroll,
        'restored_enrollments', v_restored,
        'deleted_periods',      v_deleted_periods
    );
END;
$function$;


-- =====================================================================
-- TEMUAN 6 (MEDIUM) — Privilege escalation dalam-tenant: nonaktifkan staf
-- Dipanggil langsung dari admin dashboard (authenticated), BUKAN via edge.
-- => JANGAN revoke authenticated. Tambah guard peran (admin/kepsek).
-- =====================================================================

CREATE OR REPLACE FUNCTION public.fn_deactivate_stale_staff()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_count integer;
    v_sid   uuid := fn_current_school_id();
BEGIN
    -- GUARD: hanya admin/kepsek yang boleh menonaktifkan staf
    IF NOT (fn_is_kepsek() OR fn_current_user_role() = 'ADMINISTRATIVE') THEN
        RAISE EXCEPTION 'akses ditolak: hanya admin/kepsek'
            USING ERRCODE = '42501';
    END IF;

    WITH stale AS (
        SELECT user_id FROM fn_get_stale_staff()
    )
    UPDATE users
       SET is_active = FALSE
     WHERE user_id IN (SELECT user_id FROM stale)
       AND school_id = v_sid;

    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$function$;


-- =====================================================================
-- BAGIAN A — REVOKE + GRANT service_role
-- =====================================================================

-- Temuan 1–3: HANYA dipanggil Edge Function via service_role.
-- Aman dicabut penuh dari PUBLIC/anon/authenticated.
DO $$
DECLARE fn text;
BEGIN
    FOREACH fn IN ARRAY ARRAY[
        'fn_batalkan_tahun_ajaran(uuid)',
        'fn_sync_observation(text,uuid,uuid,uuid,text,text,text,text,timestamptz,uuid,uuid)',
        'fn_sync_case(text,uuid,uuid,uuid,text,text,text,text)',
        'fn_sync_journal(text,uuid,uuid,date,text,uuid,uuid)',
        'fn_apply_schedule_templates(text,semester,uuid)'
    ]
    LOOP
        EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%s FROM PUBLIC, anon, authenticated;', fn);
        EXECUTE format('GRANT  EXECUTE ON FUNCTION public.%s TO service_role;', fn);
    END LOOP;
END $$;

-- Temuan 6 & 8: dipanggil langsung dari frontend oleh user login.
-- Cabut dari PUBLIC+anon, lalu GRANT balik ke `authenticated` (dashboard admin/
-- stakeholder tetap jalan). REVOKE dari `anon` saja TIDAK cukup selama grant
-- PUBLIC default masih ada — anon tetap lolos lewat PUBLIC.
REVOKE EXECUTE ON FUNCTION public.fn_deactivate_stale_staff()  FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.fn_deactivate_stale_staff()  TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.fn_get_stale_staff()         FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.fn_get_stale_staff()         TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.fn_stakeholder_summary()     FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.fn_stakeholder_summary()     TO authenticated, service_role;


-- =====================================================================
-- VERIFIKASI (jalankan manual setelah apply — jangan bagian dari transaksi)
-- =====================================================================
-- 1) anon TIDAK boleh lagi punya EXECUTE pada fungsi privileged:
--    SELECT proname,
--           has_function_privilege('anon',          oid,'EXECUTE') AS anon,
--           has_function_privilege('authenticated', oid,'EXECUTE') AS auth,
--           has_function_privilege('service_role',  oid,'EXECUTE') AS svc
--    FROM pg_proc
--    WHERE proname IN ('fn_sync_observation','fn_sync_case','fn_sync_journal',
--                      'fn_batalkan_tahun_ajaran','fn_apply_schedule_templates',
--                      'fn_deactivate_stale_staff','fn_get_stale_staff',
--                      'fn_stakeholder_summary');
--    HARUS: anon=false untuk semua; svc=true untuk Temuan 1–3;
--           auth=true untuk fn_deactivate/get_stale/stakeholder_summary.
--
-- 2) Probe anon PostgREST (harus 'permission denied for function ...'):
--    curl -X POST .../rest/v1/rpc/fn_sync_observation  -H "apikey: <ANON>" ...
--    curl -X POST .../rest/v1/rpc/fn_batalkan_tahun_ajaran -H "apikey: <ANON>" ...
--
-- 3) Smoke test jalur sah: simpan observasi via UI guru (edge sync-observation)
--    dan buka dashboard stakeholder/admin — harus tetap berfungsi.
-- =====================================================================
