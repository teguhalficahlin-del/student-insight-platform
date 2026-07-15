-- Tambah block_group_id ke teaching_schedules
ALTER TABLE teaching_schedules
  ADD COLUMN IF NOT EXISTS block_group_id UUID;

-- Isi block_group_id untuk semua data existing
-- Logika: slot berurutan (gap ≤ 40 menit) dengan guru+kelas+hari sama = 1 blok
WITH ordered AS (
  SELECT
    schedule_id,
    scheduled_teacher_id,
    class_id,
    session_date,
    session_start,
    LAG(session_end) OVER (
      PARTITION BY scheduled_teacher_id, class_id, session_date
      ORDER BY session_start
    ) AS prev_end
  FROM teaching_schedules
),
flagged AS (
  SELECT *,
    CASE
      WHEN prev_end IS NULL THEN 1
      WHEN EXTRACT(EPOCH FROM (session_start - prev_end)) / 60 > 40 THEN 1
      ELSE 0
    END AS is_new_block
  FROM ordered
),
grouped AS (
  SELECT
    schedule_id,
    SUM(is_new_block) OVER (
      PARTITION BY scheduled_teacher_id, class_id, session_date
      ORDER BY session_start
      ROWS UNBOUNDED PRECEDING
    ) AS block_number,
    scheduled_teacher_id,
    class_id,
    session_date
  FROM flagged
),
block_uuids AS (
  SELECT DISTINCT
    scheduled_teacher_id,
    class_id,
    session_date,
    block_number,
    gen_random_uuid() AS block_uuid
  FROM grouped
)
UPDATE teaching_schedules ts
SET block_group_id = bu.block_uuid
FROM grouped g
JOIN block_uuids bu ON (
  bu.scheduled_teacher_id = g.scheduled_teacher_id
  AND bu.class_id = g.class_id
  AND bu.session_date = g.session_date
  AND bu.block_number = g.block_number
)
WHERE ts.schedule_id = g.schedule_id;
