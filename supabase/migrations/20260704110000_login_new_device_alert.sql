-- ============================================================
-- Migration 20260704110000: peringatan login dari perangkat baru
--
-- Item 5 (Opsi A): saat sebuah perangkat yang BELUM PERNAH dipakai
-- login ke akun, munculkan notifikasi tahan-lama di lonceng
-- ("Login dari perangkat baru ..."). Login perdana (perangkat
-- pertama) SENYAP agar tidak memicu alarm palsu.
--
-- Melengkapi shared/login-guard.js (deteksi sesi GANDA/concurrent,
-- banner sementara). Di sini: RIWAYAT perangkat + alarm di lonceng.
-- ============================================================

-- ── 1. Perluas CHECK tipe notifikasi ─────────────────────────
ALTER TABLE notifications DROP CONSTRAINT notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
    CHECK (type IN ('ESCALATION_DM','CASE_BROADCAST','LOGIN_NEW_DEVICE'));

-- ── 2. Tabel riwayat perangkat login ─────────────────────────
CREATE TABLE login_devices (
    device_id    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID        NOT NULL REFERENCES users(user_id)   ON DELETE CASCADE,
    school_id    UUID        NOT NULL REFERENCES schools(school_id),
    device_hash  TEXT        NOT NULL,
    user_agent   TEXT        NOT NULL DEFAULT '',
    label        TEXT        NOT NULL DEFAULT '',
    first_seen   TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, device_hash)
);

CREATE INDEX idx_login_devices_user ON login_devices(user_id, last_seen DESC);

COMMENT ON TABLE login_devices IS
    'Riwayat perangkat (browser) yang pernah login per user. '
    'Dipakai untuk peringatan "login dari perangkat baru" di lonceng. '
    'Semua tulis lewat fn_register_login_device (SECURITY DEFINER).';

-- ── 3. RLS: user hanya lihat perangkatnya sendiri ────────────
ALTER TABLE login_devices ENABLE ROW LEVEL SECURITY;

CREATE POLICY rls_login_devices_read ON login_devices FOR SELECT
    USING (
        user_id   = fn_current_user_id()
        AND school_id = fn_current_school_id()
    );

-- Tak ada GRANT INSERT/UPDATE/DELETE ke authenticated: semua tulis
-- hanya via fn_register_login_device (mencegah pemalsuan lintas-user).
GRANT SELECT ON login_devices TO authenticated;
GRANT ALL    ON login_devices TO service_role;

-- ── 4. RPC daftar perangkat + alarm bila baru ────────────────
-- return: 'known' | 'first' | 'new'
CREATE OR REPLACE FUNCTION fn_register_login_device(
    p_device_hash TEXT,
    p_user_agent  TEXT DEFAULT '',
    p_label       TEXT DEFAULT ''
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_user_id   UUID := fn_current_user_id();
    v_school_id UUID := fn_current_school_id();
    v_device    login_devices%ROWTYPE;
    v_count     INT;
    v_label     TEXT := left(coalesce(nullif(btrim(p_label), ''), 'perangkat tak dikenal'), 120);
BEGIN
    IF v_user_id IS NULL OR v_school_id IS NULL THEN
        RAISE EXCEPTION 'Sesi tidak valid';
    END IF;
    IF p_device_hash IS NULL OR length(btrim(p_device_hash)) < 16 THEN
        RAISE EXCEPTION 'device_hash tidak valid';
    END IF;

    -- Sudah dikenal? → perbarui last_seen, tidak ada alarm.
    SELECT * INTO v_device
    FROM   login_devices
    WHERE  user_id = v_user_id AND device_hash = p_device_hash;

    IF FOUND THEN
        UPDATE login_devices SET last_seen = now(), label = v_label
        WHERE  device_id = v_device.device_id;
        RETURN 'known';
    END IF;

    -- Perangkat baru: apakah ini perangkat PERTAMA user?
    SELECT count(*) INTO v_count FROM login_devices WHERE user_id = v_user_id;

    INSERT INTO login_devices (user_id, school_id, device_hash, user_agent, label)
    VALUES (v_user_id, v_school_id, p_device_hash, left(coalesce(p_user_agent, ''), 400), v_label);

    -- Perangkat pertama = senyap (login perdana wajar).
    IF v_count = 0 THEN
        RETURN 'first';
    END IF;

    -- Perangkat baru ke-2+ → alarm tahan-lama di lonceng.
    INSERT INTO notifications (school_id, recipient_user_id, case_id, type, title, body)
    VALUES (
        v_school_id, v_user_id, NULL, 'LOGIN_NEW_DEVICE',
        'Login dari perangkat baru',
        format('Akun Anda baru saja login dari perangkat baru: %s. Jika ini bukan Anda, segera ganti kata sandi.', v_label)
    );

    RETURN 'new';
END;
$$;

REVOKE ALL     ON FUNCTION fn_register_login_device(TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION fn_register_login_device(TEXT, TEXT, TEXT) TO authenticated;
