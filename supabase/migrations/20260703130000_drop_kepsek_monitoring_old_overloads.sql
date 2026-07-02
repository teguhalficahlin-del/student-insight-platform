-- Drop overload lama fn_kepsek_monitoring(text) dari v1 dan v2
-- agar tidak ada ambiguitas saat memanggil versi baru (text, text)
DROP FUNCTION IF EXISTS fn_kepsek_monitoring(text);
