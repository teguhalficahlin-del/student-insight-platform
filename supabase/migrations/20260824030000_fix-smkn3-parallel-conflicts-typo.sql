-- ============================================================
-- Migration: 20260824030000_fix-smkn3-parallel-conflicts-typo.sql
-- Tanggal  : 24 Agustus 2026
--
-- Tenant   : SMK Negeri 3 Rambah (slug smkn3)
--            school_id     = 561cc906-e6e0-40c7-a5b0-d8f69a15258a
--            academic_year = 2026/2027, semester = 1
--
-- LATAR BELAKANG
--   Import jadwal (commit 63b9621) menghasilkan 416 schedule_templates.
--   Pemeriksaan bentrok guru menemukan 49 grup (teacher_id, day_of_week,
--   start_time) dengan >1 class_id. Setelah diperiksa isinya:
--     - 38 grup  : mapel IDENTIK di kedua kelas  -> kelas paralel yang SAH
--     -  4 grup  : mapel beda HANYA karena typo  -> paralel juga
--     -  7 grup  : mapel benar-benar berbeda     -> bentrok sungguhan
--   Menghapus 49 baris secara buta akan menghilangkan 42 jam pelajaran sah.
--
-- OPERASI (URUTAN WAJIB A -> C -> B)
--   A. allow_parallel_teaching = true untuk 7 guru kelas paralel.
--   C. Perbaiki 4 typo subject_label.
--   B. Hapus 1 baris dari tiap grup bentrok sungguhan (KEEP ONE).
--
--   KENAPA C SEBELUM B — INI BUKAN URUTAN BEBAS:
--   CTE bentrok_sungguhan membedakan grup lewat normalisasi subject_label.
--   Selama typo masih ada, 'B.NGGRIS' != 'B.INGGRIS' dan
--   'B.INDNESIA' != 'B.INDONESIA', sehingga 4 grup paralel ikut terklasifikasi
--   sebagai bentrok sungguhan. Terverifikasi di remote (BEGIN/ROLLBACK):
--     urutan A -> B -> C  : akan_dihapus = 11  (SALAH, 4 baris sah ikut hilang)
--     urutan A -> C -> B  : akan_dihapus =  7  (BENAR)
--
-- DAMPAK DATA
--   schedule_templates smkn3: 416 -> 409 baris (-7)
--   users smkn3            : 7 baris allow_parallel_teaching false -> true
--   Aman dari FK: teaching_assignments = 0, teaching_schedules = 0.
--
-- IDEMPOTEN
--   A: SET true, dijalankan ulang tetap true.
--   C: WHERE exact-match typo; setelah diperbaiki 0 baris cocok.
--   B: setelah bersih, CTE bentrok_sungguhan kosong -> JOIN 0 baris -> DELETE 0.
--
-- ROLLBACK: tidak otomatis. Baris yang dihapus ada di
--           scratchpad/import_smkn3.sql (commit 63b9621) untuk direkonstruksi.
-- ============================================================

BEGIN;

-- ── OPERASI A ────────────────────────────────────────────────
-- Guru moving class / team teaching: bentrok jam diabaikan untuk mereka.
--
-- Tabel users dilindungi trigger fn_guard_users_protected_columns() dengan
-- allowlist default-deny (hanya last_seen_at/last_seen_ua/updated_at). Migration
-- berjalan sebagai role migrasi -- bukan service_role, dan fn_current_user_role()
-- NULL -- jadi kena default-deny. Jalur resmi untuk migration adalah flag LOCAL
-- di bawah (reset otomatis di akhir transaksi). Pola sama dengan
-- 20260724050000_fix_teacher_code_irawati.sql.
SELECT set_config('app.bypass_users_guard', 'on', true);

UPDATE users
SET    allow_parallel_teaching = true
WHERE  school_id    = '561cc906-e6e0-40c7-a5b0-d8f69a15258a'
  AND  teacher_code IN ('AM','AW','IH','NS','RH','WD','YS');

-- ── OPERASI C ────────────────────────────────────────────────
-- Exact match, bukan LIKE/ILIKE — tidak menyentuh label lain.
UPDATE schedule_templates
SET    subject_label = 'B. INGGRIS'
WHERE  school_id     = '561cc906-e6e0-40c7-a5b0-d8f69a15258a'
  AND  academic_year = '2026/2027'
  AND  semester      = '1'
  AND  subject_label = 'B.NGGRIS';

UPDATE schedule_templates
SET    subject_label = 'B. INDONESIA'
WHERE  school_id     = '561cc906-e6e0-40c7-a5b0-d8f69a15258a'
  AND  academic_year = '2026/2027'
  AND  semester      = '1'
  AND  subject_label = 'B.INDNESIA';

-- ── OPERASI B ────────────────────────────────────────────────
-- KEEP ONE per grup. Tiebreak template_id::text (BUKAN ctid — ctid adalah
-- physical tuple id yang bisa bergeser kena VACUUM; BUKAN MIN(template_id)
-- — function min(uuid) tidak ada di PostgreSQL).
WITH bentrok_sungguhan AS (
    SELECT teacher_id, day_of_week, start_time
    FROM   schedule_templates
    WHERE  school_id     = '561cc906-e6e0-40c7-a5b0-d8f69a15258a'
      AND  academic_year = '2026/2027'
      AND  semester      = '1'
    GROUP  BY teacher_id, day_of_week, start_time
    HAVING COUNT(DISTINCT class_id) > 1
       AND COUNT(DISTINCT UPPER(REPLACE(REPLACE(subject_label,' ',''),'.',''))) > 1
),
keep AS (
    SELECT DISTINCT ON (t.teacher_id, t.day_of_week, t.start_time)
           t.template_id
    FROM   schedule_templates t
    JOIN   bentrok_sungguhan b USING (teacher_id, day_of_week, start_time)
    WHERE  t.school_id     = '561cc906-e6e0-40c7-a5b0-d8f69a15258a'
      AND  t.academic_year = '2026/2027'
      AND  t.semester      = '1'
    ORDER  BY t.teacher_id, t.day_of_week, t.start_time, t.template_id::text
)
DELETE FROM schedule_templates d
WHERE  d.school_id     = '561cc906-e6e0-40c7-a5b0-d8f69a15258a'
  AND  d.academic_year = '2026/2027'
  AND  d.semester      = '1'
  AND  (d.teacher_id, d.day_of_week, d.start_time) IN (
           SELECT teacher_id, day_of_week, start_time FROM bentrok_sungguhan)
  AND  d.template_id NOT IN (SELECT template_id FROM keep);

-- ── GUARD ──────────────────────────────────────────────
-- Gagalkan seluruh transaksi kalau hasilnya tidak sesuai target.
DO $guard$
DECLARE
    v_paralel  integer;
    v_bentrok  integer;
    v_typo     integer;
BEGIN
    SELECT COUNT(*) INTO v_paralel
    FROM   users
    WHERE  school_id = '561cc906-e6e0-40c7-a5b0-d8f69a15258a'
      AND  teacher_code IN ('AM','AW','IH','NS','RH','WD','YS')
      AND  allow_parallel_teaching;
    IF v_paralel <> 7 THEN
        RAISE EXCEPTION 'Operasi A gagal: % dari 7 guru ber-allow_parallel_teaching', v_paralel;
    END IF;

    SELECT COUNT(*) INTO v_typo
    FROM   schedule_templates
    WHERE  school_id = '561cc906-e6e0-40c7-a5b0-d8f69a15258a'
      AND  academic_year = '2026/2027' AND semester = '1'
      AND  subject_label IN ('B.NGGRIS','B.INDNESIA');
    IF v_typo <> 0 THEN
        RAISE EXCEPTION 'Operasi C gagal: masih ada % baris typo', v_typo;
    END IF;

    SELECT COUNT(*) INTO v_bentrok
    FROM  (SELECT 1
           FROM   schedule_templates
           WHERE  school_id = '561cc906-e6e0-40c7-a5b0-d8f69a15258a'
             AND  academic_year = '2026/2027' AND semester = '1'
           GROUP  BY teacher_id, day_of_week, start_time
           HAVING COUNT(DISTINCT class_id) > 1
              AND COUNT(DISTINCT UPPER(REPLACE(REPLACE(subject_label,' ',''),'.',''))) > 1) x;
    IF v_bentrok <> 0 THEN
        RAISE EXCEPTION 'Operasi B gagal: masih ada % grup bentrok sungguhan', v_bentrok;
    END IF;
END
$guard$;

COMMIT;
