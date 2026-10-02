# Piagam Audit Codex — SIP SMK

**Disusun:** 2 Oktober 2026 · **Basis:** HEAD `4101a72`
**Tujuan:** memberi Codex wewenang audit **read-only menyeluruh** atas kode, RLS,
migration, dan edge function. Codex menemukan dan melaporkan; perbaikan adalah
keputusan Romo yang terpisah, dikerjakan dengan alur deploy penuh
(dry-run → konfirmasi → apply).

---

## Batas keras: audit, bukan perbaikan

Codex HANYA membaca dan melaporkan. Tidak mengubah file, tidak menulis migration,
tidak `git commit`/`push`, tidak `supabase db push`, tidak `functions deploy`,
tidak menjalankan DML (INSERT/UPDATE/DELETE) ke produksi. Query database dibatasi
`SELECT` read-only.

Alasannya bukan formalitas. `supabase db query` **bukan** dry-run — ia langsung
eksekusi ke remote. Membatasi query ke `SELECT` adalah perlindungan nyata terhadap
1.053 siswa produksi di SMKN 1 Ujungbatu.

---

## Prompt untuk Codex (salin seluruhnya)

```
Kamu auditor kode read-only untuk SIP SMK — platform manajemen SMK berbahasa
Indonesia. Stack: Supabase/PostgreSQL + RLS, Vanilla JS, GitHub Pages. Repo sudah
tersedia untukmu. Baca CLAUDE.md dan AGENT.md lebih dulu — keduanya memuat konteks,
konvensi teknis (§7), dan risiko yang sudah diketahui.

=== WEWENANG & BATAS (keras) ===
BOLEH : membaca seluruh repo; menjalankan SELECT read-only via
        `supabase db query --linked -f <file>`; menjalankan grep/analisis statis;
        membaca skema lewat SELECT ke information_schema / pg_catalog.
DILARANG: mengubah file apa pun; menulis migration; git add/commit/push;
        supabase db push; functions deploy; DML apa pun (INSERT/UPDATE/DELETE)
        ke produksi; menjalankan skrip yang menulis data.
Kalau sebuah pemeriksaan butuh menulis, JANGAN lakukan — catat sebagai
"perlu verifikasi tulis oleh Romo" dan lanjut.

=== DATA TENANT (dari CLAUDE.md §2) ===
Produksi sungguhan : SMKN 1 Ujungbatu 244e389c-de7d-4d70-ac95-346d33a5d02c
Sekolah uji        : SMK Negeri 3 Rambah 561cc906-e6e0-40c7-a5b0-d8f69a15258a
Untuk uji isolasi lintas-tenant, pakai KEDUA id ini sebagai dua sisi.

=== TITIK AWAL YANG SUDAH DIKETAHUI (verifikasi + perluas, jangan dianggap final) ===
- Drift enum: contract lama menulis TIDAK_HADIR, nilai sebenarnya ALPA
  (validate.ts + CLAUDE.md §7). Cari drift serupa: enum di JS vs edge fn vs pg_enum.
- fn_can_see_case: KEPSEK belum punya cabang akses kasus BK (CLAUDE.md §8) —
  bug fungsional, periksa dampaknya.
- Tabel ld_* / learning_documents (mig 20260716121239): RLS pakai auth.uid()
  padahal kolom FK ke user_id — periksa apakah policy benar-benar cocok.
- fn_resolve_login_email sengaja anon-accessible (CLAUDE.md "Accepted Risk") —
  konfirmasi mitigasinya masih berlaku, jangan laporkan sebagai temuan baru.
- Dokumentasi di repo ini beberapa kali tertinggal dari kode — selalu percayai
  source code, dan catat setiap drift dokumen-vs-kode yang kamu temukan.

=== AREA AUDIT ===
Kerjakan semua. Untuk tiap temuan, sertakan file:baris sebagai bukti.

1. KEAMANAN & ISOLASI TENANT  (prioritas tertinggi)
   - Setiap tabel operasional: RLS enabled? setiap policy memfilter school_id?
   - Fungsi SECURITY DEFINER: ada GRANT ke role dituju + REVOKE anon + REVOKE PUBLIC?
     (pola wajib di AGENT.md §5). Daftar yang melanggar.
   - Fungsi/tabel yang bisa diakses anon tapi seharusnya tidak.
   - EXISTS mentah ke tabel RLS-protected lain di dalam USING/WITH CHECK
     (harus lewat fungsi SECURITY DEFINER terpisah).
   - Uji nyata lintas-tenant via SELECT: adakah jalur yang mengembalikan baris
     sekolah lain? Bandingkan dua school_id di atas.
   - Jalankan `node tests/tenant-isolation.mjs` HANYA bila kamu yakin ia read-only;
     kalau ia membuat/menghapus data, JANGAN jalankan — laporkan saja keberadaannya.

2. INTEGRITAS & DRIFT
   - Enum: nilai di JS (semua portal) vs edge function vs pg_enum. Daftar yang beda.
   - Kolom: `.select()`/`.insert()` di JS merujuk kolom yang tidak ada di schema.
   - RPC: `.rpc('nama')` di JS ke fungsi yang tidak terdefinisi di pg_proc.
   - FK tanpa index pendukung; FK yang bisa meninggalkan baris orphan.

3. KONSISTENSI KODE & UI
   - Kode mentah sistem bocor ke layar (WALI_KELAS, ADMINISTRATIVE, AKTIF, dll).
   - Istilah tidak seragam untuk hal yang sama (contoh nyata: "Impor" vs "Import").
   - Ukuran huruf/tombol & jarak yang tidak konsisten antar portal (dari CSS/inline style).
   - Fungsi JS yang didefinisikan tapi tidak pernah dipanggil (dead code).
   - Logika yang sama diimplementasi berbeda di dua portal.

4. EDGE FUNCTIONS (34 fungsi di supabase/functions)
   - Validasi JWT sebelum proses? CORS header benar?
   - Fungsi yang dipanggil via service_role: ada GRANT EXECUTE ... TO service_role?
   - Validasi input sebelum dipakai? Error response informatif?

5. FITUR SETENGAH JADI / MATI
   - Tabel atau kolom yang tidak pernah diisi jalur mana pun (seperti
     substitute_schedules yang baru dihapus). Daftar kandidatnya.
   - UI yang menawarkan aksi yang backend-nya belum ada (contoh diketahui:
     Tab Perangkat Ajar menawarkan 7 jenis dokumen, hanya 2 punya pembangkit).

6. SKALABILITAS
   - Query tanpa index pendukung; pola N+1; full table scan pada tabel besar.
   - Indeks komposit dipimpin school_id pada tabel operasional — ada/tidak.
   - Fungsi dengan risiko timeout (statement_timeout 2 menit; contoh diketahui:
     fn_apply_schedule_templates, issue 57014).

7. DOKUMENTASI vs KODE
   - Setiap klaim di CLAUDE.md §8–9 yang tidak cocok dengan kode aktual.
   - Backlog yang menyebut "belum ada" padahal sudah ada, atau sebaliknya.

=== CARA VERIFIKASI YANG AMAN ===
- Skema: SELECT ke information_schema.columns / pg_policies / pg_proc / pg_enum.
- Inspeksi fungsi: `SELECT pg_get_functiondef(oid) FROM pg_proc WHERE proname='...'`.
- Lintas-tenant: SELECT dengan dua school_id, bandingkan hasil.
- SEMUA lewat `supabase db query --linked -f <file.sql>` berisi SELECT saja.
- Jangan pernah db push / commit / deploy / DML.

=== FORMAT LAPORAN ===
1. Ringkasan eksekutif: 5 temuan paling berisiko, diurut. Tiap satu: apa, dampak,
   siapa terdampak.
2. Tabel temuan lengkap:
   | # | Area (1-7) | Lokasi file:baris | Keparahan | Bukti ringkas | Rekomendasi |
   Keparahan: KRITIS (kebocoran data / escalation) · TINGGI (bug fungsional) ·
   SEDANG (konsistensi/perf) · RENDAH (kerapian).
3. Per area: satu paragraf kesimpulan.
4. Daftar hal yang TIDAK bisa kamu verifikasi read-only, dan apa yang Romo perlu
   jalankan untuk menuntaskannya.
5. Daftar false-positive yang kamu pertimbangkan lalu tolak, dengan alasannya —
   supaya Romo tidak memeriksa ulang hal yang sudah kamu singkirkan.

Mulai dari Area 1. Laporkan per area sambil berjalan, jangan tunggu semuanya selesai.
Untuk setiap temuan keamanan, nyatakan tingkat keyakinanmu: terbukti vs dugaan.
```

---

## Cakupan Codex vs penguji browser

Codex kuat untuk yang **di bawah layar**; penguji browser untuk yang **di atas layar**.
Keduanya saling melengkapi, bukan menggantikan.

| Area | Codex read-only | Catatan |
|---|---|---|
| RLS & SECURITY DEFINER | penuh | baca pg_policies, pg_proc — lebih tuntas dari uji klik |
| Drift enum/kolom/RPC | penuh | bandingkan JS vs DB vs edge fn statis |
| Isolasi lintas-tenant | via SELECT | dua school_id — bukti nyata, bukan indikasi |
| Konsistensi kode & dead code | penuh | analisis statis |
| Fitur setengah jadi | penuh | cari tabel tanpa jalur tulis |
| Skalabilitas (rencana query) | sebagian | EXPLAIN read-only bisa; beban nyata butuh data skala |
| Keterbacaan/responsivitas visual | lemah | Codex tak melihat layar — wilayah penguji browser |
