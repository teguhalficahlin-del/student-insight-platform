-- ============================================================
-- Migration: 20260706180000_guard_users_protected_columns.sql
--
-- MASALAH: authenticated punya GRANT UPDATE di semua 26 kolom tabel users
-- (dari Supabase default privileges). rls_users_update_own hanya membatasi
-- BARIS (auth_user_id = auth.uid()), tidak membatasi KOLOM. Sehingga user
-- biasa bisa melakukan privilege escalation:
--   supabase.from('users').update({role_type:'ADMINISTRATIVE', is_kepsek:true})
-- ...dan berhasil pada baris miliknya sendiri.
--
-- SOLUSI: BEFORE UPDATE trigger dengan allowlist kolom ketat.
-- Non-ADMINISTRATIVE hanya boleh mengubah: last_seen_at, last_seen_ua,
-- updated_at. Kolom lain apapun (termasuk yang mungkin ditambahkan nanti)
-- diblokir dengan EXCEPTION 42501.
--
-- TIGA BYPASS YANG SAH:
--   1. current_user = 'service_role' — semua edge function pakai service_role
--      key via getAdminClient() (supabase-js/REST, bukan pg driver langsung).
--      PostgREST switch role ke 'service_role' sebelum eksekusi. Konsisten
--      dengan RLS yang juga di-bypass oleh service_role.
--   2. fn_current_user_role() = 'ADMINISTRATIVE' — admin portal kelola user
--      lain. Baris yang boleh disentuh sudah dijaga rls_users_write_administrative.
--   3. set_config('app.bypass_users_guard','on',true) — diset HANYA oleh
--      fn_confirm_password_changed() SECURITY DEFINER sebelum UPDATE-nya.
--      Parameter ketiga true = LOCAL = reset otomatis di akhir transaksi,
--      tidak bisa bocor ke request lain.
-- ============================================================


-- ── 1. Trigger function: penjaga kolom protektif ────────────

CREATE OR REPLACE FUNCTION fn_guard_users_protected_columns()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    old_j        jsonb;
    new_j        jsonb;
    allowed_keys text[] := ARRAY['last_seen_at', 'last_seen_ua', 'updated_at'];
    k            text;
BEGIN
    -- Bypass 1: service_role (semua edge function via getAdminClient()).
    -- PostgREST switch current_user ke 'service_role' saat request memakai
    -- service_role key — sama dengan mekanisme RLS bypass yang sudah ada.
    IF current_user = 'service_role' THEN
        RETURN NEW;
    END IF;

    -- Bypass 2: admin portal kelola user lain. Baris yang boleh disentuh
    -- sudah dijaga oleh rls_users_write_administrative.
    IF fn_current_user_role() = 'ADMINISTRATIVE' THEN
        RETURN NEW;
    END IF;

    -- Bypass 3: jalur resmi ganti password via fn_confirm_password_changed()
    -- SECURITY DEFINER. Flag di-set LOCAL — reset otomatis akhir transaksi.
    IF current_setting('app.bypass_users_guard', true) = 'on' THEN
        RETURN NEW;
    END IF;

    -- Default-deny: bandingkan OLD vs NEW setelah strip kolom yang diizinkan.
    -- Jika ada perbedaan di kolom lain, tolak.
    old_j := to_jsonb(OLD);
    new_j := to_jsonb(NEW);
    FOREACH k IN ARRAY allowed_keys LOOP
        old_j := old_j - k;
        new_j := new_j - k;
    END LOOP;

    IF old_j IS DISTINCT FROM new_j THEN
        RAISE EXCEPTION 'Perubahan kolom ini tidak diizinkan lewat update langsung. Hubungi admin sekolah.'
            USING ERRCODE = '42501';
    END IF;

    RETURN NEW;
END;
$$;

-- Trigger function returns trigger — tidak bisa dipanggil via PostgREST RPC.
-- REVOKE tetap ditambahkan sebagai defense-in-depth (standing rule).
REVOKE EXECUTE ON FUNCTION fn_guard_users_protected_columns() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION fn_guard_users_protected_columns() FROM anon;

CREATE TRIGGER trg_guard_users_protected_columns
    BEFORE UPDATE ON public.users
    FOR EACH ROW
    EXECUTE FUNCTION fn_guard_users_protected_columns();


-- ── 2. Update fn_confirm_password_changed: tambah bypass flag ─
--
-- Diperlukan agar trigger baru tidak memblokir jalur resmi ganti
-- password yang selama ini berjalan lewat fn_confirm_password_changed.
-- must_change_password dan password_changed_at bukan di allowlist,
-- sehingga tanpa bypass trigger akan menolak UPDATE ini.

CREATE OR REPLACE FUNCTION fn_confirm_password_changed()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- Set bypass flag sebelum UPDATE — LOCAL (parameter ke-3 = true)
    -- berarti flag reset otomatis di akhir transaksi ini saja.
    PERFORM set_config('app.bypass_users_guard', 'on', true);

    UPDATE users
    SET must_change_password = false,
        password_changed_at  = now()
    WHERE auth_user_id = auth.uid();
END;
$$;

-- Pertahankan grants/revokes yang sudah ada dari mig 150000/160000/170000.
-- CREATE OR REPLACE tidak mengubah ACL yang sudah ada, tapi kita eksplisit
-- ulang untuk kejelasan dan keamanan.
GRANT   EXECUTE ON FUNCTION fn_confirm_password_changed() TO authenticated;
REVOKE  EXECUTE ON FUNCTION fn_confirm_password_changed() FROM PUBLIC;
REVOKE  EXECUTE ON FUNCTION fn_confirm_password_changed() FROM anon;

COMMENT ON FUNCTION fn_confirm_password_changed IS
    'Satu-satunya jalur resmi untuk mengubah must_change_password dan '
    'password_changed_at. Dipanggil HANYA setelah supabase.auth.updateUser() '
    'berhasil di shared/change-password.js. Set bypass_users_guard sebelum '
    'UPDATE agar tidak terblokir trg_guard_users_protected_columns.';
