-- Migration: 20261003100000_fix-ld-policy-exists-rls.sql
--
-- Temuan audit #14: policy ld_* menggunakan EXISTS langsung ke tabel ber-RLS
-- (ld_documents, users) di dalam klausa USING, yang dilarang per aturan teknis
-- SIP SMK (CLAUDE.md §7). Perbaikan: buat dua fungsi SECURITY DEFINER sebagai
-- helper, ganti EXISTS mentah di 4 policy dengan panggilan ke helper tersebut.
--
-- Helper baru:
--   fn_ld_doc_owned_by_caller(uuid)  → dokumen dimiliki pemanggil di sekolahnya
--   fn_ld_doc_in_caller_school(uuid) → dokumen ada di sekolah pemanggil (tanpa syarat pemilik)
--
-- Policy yang diperbarui:
--   ld_document_nodes.node_via_document
--   ld_document_tp_links.tp_link_via_document
--   ld_document_versions.version_owner
--   ld_teacher_knowledge.teacher_knowledge_owner
--
-- Semantik tidak berubah — hanya jalur evaluasi yang dipindah ke SECURITY DEFINER.

BEGIN;

-- ── 1. Helper: apakah dokumen dimiliki caller di sekolahnya? ──────────────────
CREATE OR REPLACE FUNCTION public.fn_ld_doc_owned_by_caller(p_document_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
    SELECT EXISTS (
        SELECT 1 FROM ld_documents d
        WHERE d.document_id = p_document_id
          AND d.created_by  = auth.uid()
          AND d.school_id   = fn_current_school_id()
    );
$$;

GRANT  EXECUTE ON FUNCTION fn_ld_doc_owned_by_caller(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION fn_ld_doc_owned_by_caller(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION fn_ld_doc_owned_by_caller(uuid) FROM PUBLIC;

-- ── 2. Helper: apakah dokumen ada di sekolah caller? ─────────────────────────
CREATE OR REPLACE FUNCTION public.fn_ld_doc_in_caller_school(p_document_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
    SELECT EXISTS (
        SELECT 1 FROM ld_documents d
        WHERE d.document_id = p_document_id
          AND d.school_id   = fn_current_school_id()
    );
$$;

GRANT  EXECUTE ON FUNCTION fn_ld_doc_in_caller_school(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION fn_ld_doc_in_caller_school(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION fn_ld_doc_in_caller_school(uuid) FROM PUBLIC;

-- ── 3. Perbarui policy ld_document_nodes ─────────────────────────────────────
DROP POLICY IF EXISTS node_via_document ON ld_document_nodes;
CREATE POLICY node_via_document ON ld_document_nodes
    USING ( fn_ld_doc_owned_by_caller(document_id) );

-- ── 4. Perbarui policy ld_document_tp_links ──────────────────────────────────
DROP POLICY IF EXISTS tp_link_via_document ON ld_document_tp_links;
CREATE POLICY tp_link_via_document ON ld_document_tp_links
    USING ( fn_ld_doc_owned_by_caller(document_id) );

-- ── 5. Perbarui policy ld_document_versions ──────────────────────────────────
DROP POLICY IF EXISTS version_owner ON ld_document_versions;
CREATE POLICY version_owner ON ld_document_versions
    USING ( published_by = auth.uid() AND fn_ld_doc_in_caller_school(document_id) );

-- ── 6. Perbarui policy ld_teacher_knowledge ──────────────────────────────────
-- Semantik lama: teacher_id = auth.uid() AND EXISTS (users WHERE user_id = teacher_id AND school_id = fn_current_school_id())
-- Karena teacher_id = auth.uid(), EXISTS hanya mengecek bahwa user ada di sekolah saat ini
-- yang identik dengan fn_current_school_id() IS NOT NULL (fn_current_school_id lookup dari users).
-- Sederhanakan: teacher_id = auth.uid() — fn_current_school_id() sudah implisit cek keberadaan.
DROP POLICY IF EXISTS teacher_knowledge_owner ON ld_teacher_knowledge;
CREATE POLICY teacher_knowledge_owner ON ld_teacher_knowledge
    USING ( teacher_id = auth.uid() AND fn_current_school_id() IS NOT NULL );

COMMIT;
