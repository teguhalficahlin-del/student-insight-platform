-- Hardening kepala sekolah:
--   * akun nonaktif tidak lagi mendapat akses Kepsek/monitoring;
--   * rentang parsial tidak mencampur data di luar batas tanggal;
--   * aksi kasus Kepsek konsisten dengan akses baca kasusnya;
--   * penghapusan admin serial dan atomik per sekolah.

CREATE OR REPLACE FUNCTION public.fn_is_kepsek()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.users u
        WHERE u.auth_user_id = auth.uid()
          AND u.is_active IS TRUE
          AND u.deleted_at IS NULL
          AND (u.role_type = 'KEPSEK'::role_type OR u.is_kepsek IS TRUE)
    );
$$;

CREATE OR REPLACE FUNCTION public.fn_kepsek_monitoring(
    p_period        text DEFAULT 'hari_ini'::text,
    p_academic_year text DEFAULT NULL::text,
    p_date_start    date DEFAULT NULL::date,
    p_date_end      date DEFAULT NULL::date
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    v_school_id   uuid;
    v_boleh_lihat boolean;
    v_date_start  date;
    v_date_end    date;
    v_by_month    boolean := FALSE;
    v_ay_year     int;
    v_summary     jsonb;
    v_chart       jsonb;
BEGIN
    SELECT school_id,
           (is_active IS TRUE AND deleted_at IS NULL
            AND (role_type IN ('KEPSEK', 'STAKEHOLDER') OR COALESCE(is_kepsek, FALSE)))
    INTO v_school_id, v_boleh_lihat
    FROM users
    WHERE auth_user_id = auth.uid()
    LIMIT 1;

    IF v_school_id IS NULL THEN
        RAISE EXCEPTION 'User tidak ditemukan atau tidak memiliki school_id';
    END IF;
    IF NOT v_boleh_lihat THEN
        RAISE EXCEPTION 'Akses ditolak: monitoring ini hanya untuk Kepala Sekolah dan Stakeholder';
    END IF;

    CASE p_period
        WHEN 'hari_ini' THEN
            v_date_start := CURRENT_DATE;
            v_date_end   := CURRENT_DATE;
        WHEN '7_hari' THEN
            v_date_start := CURRENT_DATE - 6;
            v_date_end   := CURRENT_DATE;
        WHEN 'minggu_lalu' THEN
            v_date_start := date_trunc('week', CURRENT_DATE - 7)::date;
            v_date_end   := date_trunc('week', CURRENT_DATE)::date - 1;
        WHEN 'bulan_lalu' THEN
            v_date_start := date_trunc('month', CURRENT_DATE - interval '1 month')::date;
            v_date_end   := date_trunc('month', CURRENT_DATE)::date - 1;
        WHEN 'tahun_ajaran_lalu' THEN
            IF p_academic_year IS NULL THEN
                RAISE EXCEPTION 'p_academic_year wajib diisi untuk periode tahun_ajaran_lalu';
            END IF;
            v_ay_year    := split_part(p_academic_year, '/', 1)::int;
            v_date_start := make_date(v_ay_year, 7, 1);
            v_date_end   := make_date(v_ay_year + 1, 6, 30);
            v_by_month   := TRUE;
        WHEN 'rentang' THEN
            IF p_date_start IS NULL OR p_date_end IS NULL THEN
                RAISE EXCEPTION 'p_date_start dan p_date_end wajib diisi untuk periode rentang';
            END IF;
            IF p_date_start > p_date_end THEN
                RAISE EXCEPTION 'p_date_start tidak boleh setelah p_date_end' USING ERRCODE = '22007';
            END IF;
            v_date_start := p_date_start;
            v_date_end   := p_date_end;
            v_by_month   := (p_date_end - p_date_start) > 60;
        ELSE
            v_date_start := CURRENT_DATE;
            v_date_end   := CURRENT_DATE;
    END CASE;

    SELECT jsonb_build_object(
        'pct_siswa',
            (SELECT CASE WHEN COUNT(DISTINCT s.student_id) > 0
                THEN round(100.0 *
                    COUNT(DISTINCT CASE WHEN a.status = 'HADIR' AND NOT a.is_void
                          AND ts2.session_date BETWEEN v_date_start AND v_date_end
                          THEN a.student_id END) /
                    COUNT(DISTINCT s.student_id), 1)
                ELSE NULL END
             FROM students s
             LEFT JOIN attendance a ON a.student_id = s.student_id
             LEFT JOIN teaching_schedules ts2
               ON ts2.schedule_id = a.schedule_id
              AND ts2.meeting_status = 'NORMAL'
              AND ts2.school_id = v_school_id
             WHERE s.school_id = v_school_id
               AND s.student_status IN ('AKTIF', 'PKL')),
        'pct_guru',
            (SELECT CASE WHEN COUNT(DISTINCT ts3.scheduled_teacher_id) > 0
                THEN round(100.0 *
                    COUNT(DISTINCT CASE WHEN EXISTS (
                        SELECT 1 FROM attendance ax
                        WHERE ax.schedule_id = ts3.schedule_id AND NOT ax.is_void
                    ) THEN ts3.scheduled_teacher_id END) /
                    COUNT(DISTINCT ts3.scheduled_teacher_id), 1)
                ELSE NULL END
             FROM teaching_schedules ts3
             WHERE ts3.session_date BETWEEN v_date_start AND v_date_end
               AND ts3.school_id = v_school_id
               AND ts3.meeting_status = 'NORMAL'),
        'siswa_hadir',
            (SELECT COUNT(DISTINCT CASE WHEN a.status = 'HADIR' AND NOT a.is_void
                          AND ts2.session_date BETWEEN v_date_start AND v_date_end
                          THEN a.student_id END)
             FROM students s
             LEFT JOIN attendance a ON a.student_id = s.student_id
             LEFT JOIN teaching_schedules ts2
               ON ts2.schedule_id = a.schedule_id
              AND ts2.meeting_status = 'NORMAL'
              AND ts2.school_id = v_school_id
             WHERE s.school_id = v_school_id
               AND s.student_status IN ('AKTIF', 'PKL')),
        'siswa_total',
            (SELECT COUNT(DISTINCT s.student_id)
             FROM students s
             WHERE s.school_id = v_school_id
               AND s.student_status IN ('AKTIF', 'PKL')),
        'guru_hadir',
            (SELECT COUNT(DISTINCT CASE WHEN EXISTS (
                        SELECT 1 FROM attendance ax
                        WHERE ax.schedule_id = ts3.schedule_id AND NOT ax.is_void
                    ) THEN ts3.scheduled_teacher_id END)
             FROM teaching_schedules ts3
             WHERE ts3.session_date BETWEEN v_date_start AND v_date_end
               AND ts3.school_id = v_school_id
               AND ts3.meeting_status = 'NORMAL'),
        'guru_total',
            (SELECT COUNT(DISTINCT ts3.scheduled_teacher_id)
             FROM teaching_schedules ts3
             WHERE ts3.session_date BETWEEN v_date_start AND v_date_end
               AND ts3.school_id = v_school_id
               AND ts3.meeting_status = 'NORMAL'),
        'count_late',
            (SELECT COUNT(*) FROM late_arrivals la
             WHERE la.school_id = v_school_id
               AND la.late_date BETWEEN v_date_start AND v_date_end),
        'count_exits',
            (SELECT COUNT(*) FROM student_exits se
             WHERE se.school_id = v_school_id
               AND se.exit_date BETWEEN v_date_start AND v_date_end)
    ) INTO v_summary;

    IF v_by_month THEN
        WITH v_siswa_aktif AS MATERIALIZED (
            SELECT COUNT(DISTINCT student_id) AS total
            FROM students
            WHERE school_id = v_school_id
              AND student_status IN ('AKTIF', 'PKL')
        )
        SELECT COALESCE(jsonb_agg(pt ORDER BY pt->>'date'), '[]'::jsonb)
        INTO v_chart
        FROM (
            SELECT jsonb_build_object(
                'date', to_char(b.bulan, 'YYYY-MM-01'),
                'pct_siswa', CASE WHEN (SELECT total FROM v_siswa_aktif) > 0
                    THEN round(100.0 * (
                        SELECT COUNT(DISTINCT s2.student_id)
                        FROM students s2
                        JOIN attendance a2 ON a2.student_id = s2.student_id
                        JOIN teaching_schedules ts_inner
                          ON ts_inner.schedule_id = a2.schedule_id
                         AND ts_inner.meeting_status = 'NORMAL'
                         AND ts_inner.school_id = v_school_id
                        WHERE s2.school_id = v_school_id
                          AND s2.student_status IN ('AKTIF', 'PKL')
                          AND a2.status = 'HADIR'
                          AND NOT a2.is_void
                          AND ts_inner.session_date BETWEEN v_date_start AND v_date_end
                          AND date_trunc('month', ts_inner.session_date) = b.bulan
                    ) / (SELECT total FROM v_siswa_aktif), 1)
                    ELSE NULL END,
                'pct_guru', (
                    SELECT CASE WHEN COUNT(DISTINCT ts2.scheduled_teacher_id) > 0
                        THEN round(100.0 *
                            COUNT(DISTINCT CASE WHEN EXISTS (
                                SELECT 1 FROM attendance ax
                                WHERE ax.schedule_id = ts2.schedule_id AND NOT ax.is_void
                            ) THEN ts2.scheduled_teacher_id END) /
                            COUNT(DISTINCT ts2.scheduled_teacher_id), 1)
                        ELSE NULL END
                    FROM teaching_schedules ts2
                    WHERE ts2.session_date BETWEEN v_date_start AND v_date_end
                      AND date_trunc('month', ts2.session_date) = b.bulan
                      AND ts2.school_id = v_school_id
                      AND ts2.meeting_status = 'NORMAL'
                ),
                'count_late', (
                    SELECT COUNT(*) FROM late_arrivals la
                    WHERE la.school_id = v_school_id
                      AND la.late_date BETWEEN v_date_start AND v_date_end
                      AND date_trunc('month', la.late_date) = b.bulan
                ),
                'count_exits', (
                    SELECT COUNT(*) FROM student_exits se
                    WHERE se.school_id = v_school_id
                      AND se.exit_date BETWEEN v_date_start AND v_date_end
                      AND date_trunc('month', se.exit_date) = b.bulan
                )
            ) AS pt
            FROM (
                SELECT date_trunc('month', ts.session_date)::date AS bulan
                FROM teaching_schedules ts
                WHERE ts.session_date BETWEEN v_date_start AND v_date_end
                  AND ts.school_id = v_school_id
                  AND ts.meeting_status = 'NORMAL'
                GROUP BY 1
            ) b
        ) sub;
    ELSE
        WITH v_siswa_aktif AS MATERIALIZED (
            SELECT COUNT(DISTINCT student_id) AS total
            FROM students
            WHERE school_id = v_school_id
              AND student_status IN ('AKTIF', 'PKL')
        )
        SELECT COALESCE(jsonb_agg(pt ORDER BY pt->>'date'), '[]'::jsonb)
        INTO v_chart
        FROM (
            SELECT jsonb_build_object(
                'date', ts.session_date::text,
                'pct_siswa', CASE WHEN (SELECT total FROM v_siswa_aktif) > 0
                    THEN round(100.0 * (
                        SELECT COUNT(DISTINCT s2.student_id)
                        FROM students s2
                        JOIN attendance a2 ON a2.student_id = s2.student_id
                        JOIN teaching_schedules ts_inner
                          ON ts_inner.schedule_id = a2.schedule_id
                         AND ts_inner.meeting_status = 'NORMAL'
                         AND ts_inner.school_id = v_school_id
                        WHERE s2.school_id = v_school_id
                          AND s2.student_status IN ('AKTIF', 'PKL')
                          AND a2.status = 'HADIR'
                          AND NOT a2.is_void
                          AND ts_inner.session_date = ts.session_date
                    ) / (SELECT total FROM v_siswa_aktif), 1)
                    ELSE NULL END,
                'pct_guru', (
                    SELECT CASE WHEN COUNT(DISTINCT ts2.scheduled_teacher_id) > 0
                        THEN round(100.0 *
                            COUNT(DISTINCT CASE WHEN EXISTS (
                                SELECT 1 FROM attendance ax
                                WHERE ax.schedule_id = ts2.schedule_id AND NOT ax.is_void
                            ) THEN ts2.scheduled_teacher_id END) /
                            COUNT(DISTINCT ts2.scheduled_teacher_id), 1)
                        ELSE NULL END
                    FROM teaching_schedules ts2
                    WHERE ts2.session_date = ts.session_date
                      AND ts2.school_id = v_school_id
                      AND ts2.meeting_status = 'NORMAL'
                ),
                'count_late', (
                    SELECT COUNT(*) FROM late_arrivals la
                    WHERE la.school_id = v_school_id
                      AND la.late_date = ts.session_date
                ),
                'count_exits', (
                    SELECT COUNT(*) FROM student_exits se
                    WHERE se.school_id = v_school_id
                      AND se.exit_date = ts.session_date
                )
            ) AS pt
            FROM teaching_schedules ts
            WHERE ts.session_date BETWEEN v_date_start AND v_date_end
              AND ts.school_id = v_school_id
              AND ts.meeting_status = 'NORMAL'
            GROUP BY ts.session_date
        ) sub;
    END IF;

    RETURN jsonb_build_object(
        'period', p_period,
        'date_start', v_date_start,
        'date_end', v_date_end,
        'by_month', v_by_month,
        'summary', v_summary,
        'chart', v_chart,
        'data_earliest', (
            SELECT MIN(ts.session_date)
            FROM teaching_schedules ts
            WHERE ts.school_id = v_school_id
              AND ts.meeting_status = 'NORMAL'
        )
    );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.fn_kepsek_monitoring(text, text, date, date) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_kepsek_monitoring(text, text, date, date) FROM anon, PUBLIC;

DROP POLICY IF EXISTS rls_cce_insert ON public.coaching_case_events;
CREATE POLICY rls_cce_insert ON public.coaching_case_events
    FOR INSERT TO authenticated
    WITH CHECK (
        school_id = fn_current_school_id()
        AND author_user_id = fn_current_user_id()
        AND (
            current_setting('app.coaching_sync_active', TRUE) = 'true'
            OR fn_is_kepsek()
            OR EXISTS (
                SELECT 1 FROM coaching_cases c
                WHERE c.case_id = coaching_case_events.case_id
                  AND c.current_handler_user_id = fn_current_user_id()
                  AND c.status <> 'CLOSED'::case_status
            )
        )
    );

CREATE OR REPLACE FUNCTION public.fn_remove_school_admin(
    p_actor_user_id uuid,
    p_target_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
    v_school_id uuid;
    v_target record;
    v_admin_count integer;
BEGIN
    SELECT school_id INTO v_school_id
    FROM users
    WHERE user_id = p_actor_user_id
      AND is_active IS TRUE
      AND deleted_at IS NULL
      AND (role_type = 'KEPSEK'::role_type OR is_kepsek IS TRUE)
    LIMIT 1;

    IF v_school_id IS NULL THEN
        RAISE EXCEPTION 'Akses ditolak: hanya Kepala Sekolah aktif yang dapat menghapus admin';
    END IF;
    IF p_actor_user_id = p_target_user_id THEN
        RAISE EXCEPTION 'Tidak dapat menghapus akun Anda sendiri';
    END IF;

    -- Semua penghapusan admin memakai kunci sekolah yang sama, sehingga dua
    -- request terakhir tidak dapat sama-sama melewati batas minimum admin.
    PERFORM pg_advisory_xact_lock(hashtextextended(v_school_id::text, 0));

    SELECT auth_user_id, role_type, full_name
    INTO v_target
    FROM users
    WHERE user_id = p_target_user_id
      AND school_id = v_school_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Akun tidak ditemukan di sekolah ini';
    END IF;
    IF v_target.role_type <> 'ADMINISTRATIVE'::role_type THEN
        RAISE EXCEPTION 'Hanya akun ADMINISTRATIVE yang dapat dihapus dari sini';
    END IF;

    SELECT COUNT(*) INTO v_admin_count
    FROM users
    WHERE school_id = v_school_id
      AND role_type = 'ADMINISTRATIVE'::role_type
      AND is_active IS TRUE
      AND deleted_at IS NULL;

    IF v_admin_count <= 1 THEN
        RAISE EXCEPTION 'Tidak dapat menghapus admin terakhir sekolah ini';
    END IF;

    PERFORM set_config('app.bypass_users_guard', 'on', true);
    UPDATE users
    SET deleted_at = NOW(), is_active = FALSE
    WHERE user_id = p_target_user_id
      AND school_id = v_school_id;

    RETURN jsonb_build_object(
        'deleted', TRUE,
        'user_id', p_target_user_id,
        'auth_user_id', v_target.auth_user_id,
        'full_name', v_target.full_name
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_remove_school_admin(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_remove_school_admin(uuid, uuid) TO service_role;
