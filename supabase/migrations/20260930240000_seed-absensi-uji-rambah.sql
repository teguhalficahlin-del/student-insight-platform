-- ============================================================
-- Migration: 20260930240000_seed-absensi-uji-rambah.sql
--
-- TUJUAN
--   Mengisi data absensi siswa untuk SEKOLAH UJI SMK Negeri 3 Rambah,
--   supaya tab-tab portal guru yang menampilkan kehadiran tidak kosong
--   saat diaudit oleh penguji luar.
--
--   HANYA untuk sekolah uji (561cc906-...). SMKN 1 Ujungbatu — satu-satunya
--   tenant produksi sungguhan — tidak tersentuh.
--
-- CAKUPAN
--   - Tujuh tanggal sesi TERBARU yang benar-benar ada di teaching_schedules
--     Rambah dan <= hari ini. Mandiri: menyesuaikan diri dengan tanggal yang
--     memang termaterialisasi, tanpa mengarang tanggal baru.
--   - Hanya sesi meeting_status = 'NORMAL' (sesi yang memang berlangsung).
--   - Setiap siswa yang aktif ter-enrol di kelas sesi itu.
--
-- ISI STATUS — campuran realistis, deterministik
--   Ditentukan dari hash(schedule_id + student_id), jadi hasilnya stabil bila
--   migration dijalankan ulang dan tidak semua 'HADIR' (layar absensi terlihat
--   seperti kondisi nyata):
--     ~88% HADIR · ~5% IZIN · ~4% SAKIT · ~3% ALPA
--   Enum diverifikasi dari _shared/validate.ts (sumber klien) + CLAUDE.md §7:
--   nilai 'ALPA' — BUKAN 'TIDAK_HADIR' (di-rename mig 20260716164801).
--
-- KEAMANAN & KETAHANAN
--   - source = 'TEACHER_DECLARED' — jujur: ini pengisian oleh sistem meniru
--     deklarasi guru, bukan AUTO_DETECTED.
--   - recorded_by_user_id = scheduled_teacher_id sesi itu. Trigger
--     trg_auto_recorded_by hanya mengisi bila NULL, jadi nilai eksplisit ini
--     tidak ditimpa.
--   - is_void = FALSE.
--   - ON CONFLICT (schedule_id, student_id) DO NOTHING — idempoten, menghormati
--     uq_attendance_per_session. Menjalankan ulang tidak menggandakan.
--
-- BATASAN YANG DISADARI (bukan bug)
--   INSERT langsung ini TIDAK menempuh fn_sync_attendance_batch, jadi TIDAK
--   menghasilkan sinyal teacher_attendance_log / teacher_indicator. Data
--   kehadiran SISWA terisi penuh; metrik "apakah guru hadir mengajar" yang
--   berasal dari log itu tetap mengikuti keadaan aslinya. Untuk audit tampilan
--   tab, kehadiran siswa adalah yang menentukan.
--
-- VOLUME
--   Rambah kecil (77 siswa). Perkiraan beberapa ribu baris — jauh di bawah
--   statement_timeout 2 menit. Jalankan EXPLAIN dulu bila ragu (§6g).
-- ============================================================

INSERT INTO attendance (
    schedule_id, student_id, status, source,
    recorded_by_user_id, school_id, is_void
)
SELECT
    ts.schedule_id,
    ce.student_id,
    (CASE
        WHEN (('x' || substr(md5(ts.schedule_id::text || ce.student_id::text), 1, 8))::bit(32)::bigint & 2147483647) % 100 < 88 THEN 'HADIR'
        WHEN (('x' || substr(md5(ts.schedule_id::text || ce.student_id::text), 1, 8))::bit(32)::bigint & 2147483647) % 100 < 93 THEN 'IZIN'
        WHEN (('x' || substr(md5(ts.schedule_id::text || ce.student_id::text), 1, 8))::bit(32)::bigint & 2147483647) % 100 < 97 THEN 'SAKIT'
        ELSE 'ALPA'
     END)::attendance_status,
    'TEACHER_DECLARED'::attendance_source,
    ts.scheduled_teacher_id,
    ts.school_id,
    FALSE
FROM teaching_schedules ts
JOIN class_enrollments ce
       ON ce.class_id       = ts.class_id
      AND ce.academic_year  = ts.academic_year
      AND ce.semester       = ts.semester
      AND ce.withdrawn_at    IS NULL
WHERE ts.school_id      = '561cc906-e6e0-40c7-a5b0-d8f69a15258a'
  AND ts.meeting_status = 'NORMAL'
  AND ts.session_date IN (
        SELECT session_date
        FROM (
            SELECT DISTINCT session_date
            FROM teaching_schedules
            WHERE school_id    = '561cc906-e6e0-40c7-a5b0-d8f69a15258a'
              AND session_date <= CURRENT_DATE
            ORDER BY session_date DESC
            LIMIT 7
        ) tujuh_hari_terakhir
      )
ON CONFLICT (schedule_id, student_id) DO NOTHING;
