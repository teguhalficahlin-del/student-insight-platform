-- ============================================================
-- FILE: 00_extensions_enums.sql
-- LAYER: 0 — Extensions + Enums
-- APPLY ORDER: First. No dependencies.
-- ============================================================

-- ------------------------------------------------------------
-- EXTENSIONS
-- ------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "btree_gist";


-- ------------------------------------------------------------
-- ENUM: role_type
-- Single role per user. WALI_KELAS is a designation on User,
-- not a separate role value (see TN-01).
-- ------------------------------------------------------------
CREATE TYPE role_type AS ENUM (
    'GURU',
    'BK',
    'WALI_KELAS',
    'KAPRODI',
    'KEPSEK',
    'DUDI',
    'SISWA',
    'ORTU',
    'ADMINISTRATIVE',
    'STAKEHOLDER',
    'WAKA_KURIKULUM',
    'WAKA_KESISWAAN'
);


-- ------------------------------------------------------------
-- ENUM: student_status
-- ------------------------------------------------------------
CREATE TYPE student_status AS ENUM (
    'AKTIF',
    'PKL',
    'LULUS',
    'KELUAR'
);


-- ------------------------------------------------------------
-- ENUM: attendance_status
-- Applies to student attendance records.
-- ------------------------------------------------------------
-- EKSKUL dihapus (keputusan 3 Juli 2026, migrasi 20260703220000):
-- siswa yang ikut ekstrakurikuler ditandai HADIR.
CREATE TYPE attendance_status AS ENUM (
    'HADIR',
    'TIDAK_HADIR',
    'IZIN',
    'SAKIT'
);


-- ------------------------------------------------------------
-- ENUM: attendance_source
-- Tracks how the attendance value was set.
-- ------------------------------------------------------------
CREATE TYPE attendance_source AS ENUM (
    'AUTO_DETECTED',
    'MANUAL_OVERRIDE',
    'TEACHER_DECLARED'
);


-- ------------------------------------------------------------
-- ENUM: meeting_status
-- Status of the teaching session itself.
-- ------------------------------------------------------------
CREATE TYPE meeting_status AS ENUM (
    'NORMAL',
    'KEGIATAN_SEKOLAH',
    'GURU_TIDAK_HADIR'
);


-- ------------------------------------------------------------
-- ENUM: teacher_attendance_indicator
-- Derived (computed server-side). Never written by clients.
-- See TN-02.
-- ------------------------------------------------------------
CREATE TYPE teacher_attendance_indicator AS ENUM (
    'HADIR',
    'TIDAK_HADIR',
    'PENDING_EVALUATION'
);


-- ------------------------------------------------------------
-- ENUM: observation_sentiment
-- ------------------------------------------------------------
CREATE TYPE observation_sentiment AS ENUM (
    'POSITIF',
    'NEGATIF'
);


-- ------------------------------------------------------------
-- ENUM: observation_dimension
-- 8 dimensions. Frozen after DDL apply (TN-03).
-- ------------------------------------------------------------
CREATE TYPE observation_dimension AS ENUM (
    'AKADEMIK',
    'KEHADIRAN',
    'PERILAKU',
    'SOSIAL',
    'AFEKTIF',
    'BAKAT_MINAT',
    'FISIK',
    'LAINNYA'
);


-- ------------------------------------------------------------
-- ENUM: visibility_level
-- Used by observations and case events.
-- ------------------------------------------------------------
CREATE TYPE visibility_level AS ENUM (
    'PRIVATE',
    'INTERNAL_SCHOOL',
    'STUDENT_VISIBLE'
);


-- ------------------------------------------------------------
-- ENUM: case_audience
-- Audiens per-KASUS (ala-Facebook), diatur pembuat/penangan.
-- Beda sumbu dari visibility_level (yg per-EVENT: internal vs siswa).
--   PRIVATE    — hanya yang terlibat/penangan (default; kasus lahir privat)
--   RESTRICTED — + penonton pilihan di case_audience_members ("orang tertentu")
--   PUBLIC     — semua aktor internal kasus (6 peran)
-- DUDI selalu PRIVATE (tak boleh publikasi).
-- ------------------------------------------------------------
CREATE TYPE case_audience AS ENUM (
    'PRIVATE',
    'RESTRICTED',
    'PUBLIC'
);


-- ------------------------------------------------------------
-- ENUM: achievement_scope
-- ------------------------------------------------------------
CREATE TYPE achievement_scope AS ENUM (
    'SEKOLAH',
    'KABUPATEN',
    'PROVINSI',
    'NASIONAL',
    'INTERNASIONAL'
);


-- ------------------------------------------------------------
-- ENUM: achievement_category
-- ------------------------------------------------------------
CREATE TYPE achievement_category AS ENUM (
    'AKADEMIK',
    'NON_AKADEMIK',
    'SERTIFIKASI',
    'PENGHARGAAN'
);


-- ------------------------------------------------------------
-- ENUM: case_status
-- Terminal state: CLOSED. No events allowed after CLOSED.
-- Invariant INV-1.
-- ------------------------------------------------------------
CREATE TYPE case_status AS ENUM (
    'OPEN',
    'UNDER_REVIEW',
    'INTERVENTION',
    'MONITORING',
    'CLOSED'
);


-- ------------------------------------------------------------
-- ENUM: case_track
-- Determines valid escalation chain.
-- ------------------------------------------------------------
CREATE TYPE case_track AS ENUM (
    'SEKOLAH',
    'PKL'
);


-- ------------------------------------------------------------
-- ENUM: case_event_type
-- All 11 event types. Append-only.
-- ------------------------------------------------------------
CREATE TYPE case_event_type AS ENUM (
    'COMMENT_ADDED',
    'STATUS_CHANGED',
    'DECISION_ESCALATE',
    'DECISION_CLOSE',
    'FINAL_DECISION_MADE',
    'STUDENT_UPDATE_ADDED',
    'PARENT_MESSAGE_RECEIVED',
    'PARENT_MESSAGE_LINKED',
    'PARENT_REPLY_SENT',
    'CASE_LOCKED',
    'CASE_UNLOCKED'
);


-- ------------------------------------------------------------
-- ENUM: message_direction
-- ------------------------------------------------------------
CREATE TYPE message_direction AS ENUM (
    'INBOUND',
    'OUTBOUND'
);


-- ------------------------------------------------------------
-- ENUM: message_link_type
-- ------------------------------------------------------------
CREATE TYPE message_link_type AS ENUM (
    'CASE_LINKED',
    'STANDALONE'
);


-- ------------------------------------------------------------
-- ENUM: semester
-- ------------------------------------------------------------
CREATE TYPE semester AS ENUM (
    '1',
    '2'
);


-- ------------------------------------------------------------
-- ENUM: day_of_week
-- Used by schedule_templates to specify recurring weekly slots.
-- ------------------------------------------------------------
CREATE TYPE day_of_week AS ENUM (
    'SENIN',
    'SELASA',
    'RABU',
    'KAMIS',
    'JUMAT',
    'SABTU'
);
