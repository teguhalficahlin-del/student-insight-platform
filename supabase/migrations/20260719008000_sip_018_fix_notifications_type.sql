-- SIP-018: Tambah type PERANGKAT_AJAR ke check constraint notifications

ALTER TABLE public.notifications
  DROP CONSTRAINT IF EXISTS notifications_type_check;

ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_type_check
  CHECK (type IN (
    'ESCALATION_DM',
    'CASE_BROADCAST',
    'LOGIN_NEW_DEVICE',
    'OBSERVATION_NEW',
    'CASE_RESTRICTED_NEW',
    'CASE_STUDENT_UPDATE',
    'FORUM_POST_NEW',
    'FORUM_COMMENT_NEW',
    'PERANGKAT_AJAR'
  ));
