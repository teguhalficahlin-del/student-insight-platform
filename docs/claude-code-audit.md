# Claude Code Audit — SIP SMK
> Dibuat 29 Juli 2026. Tujuan: pemetaan kapabilitas .claude/, pola kerja berulang,
> dan rekomendasi slash commands + CLAUDE.md yang lebih efektif.

---

## 1. Apa yang sudah ada di `.claude/`

### File aktif
| File | Isi |
|------|-----|
| `.claude/commands/audit-tenant.md` | Satu slash command `/audit-tenant` — cari query `supabase.from()` tanpa filter `school_id` di semua portal JS |
| `.claude/settings.local.json` | 60+ allow-list permissions: browser tools, WebFetch ke domain Kemendikbud/pendidikan, Bash supabase, beberapa Skill |
| `.claude/launch.json` | Konfigurasi dev server (untuk browser preview) |

### Yang TIDAK ada
- Tidak ada `.claude/agents/` — tidak ada custom agent
- Tidak ada `.claude/skills/` lokal
- Hanya satu slash command (`/audit-tenant`), padahal ada minimal 5–7 pola kerja berulang yang layak dijadikan command

---

## 2. Pola Kerja Berulang (kandidat slash command)

Berdasarkan AGENT_WORKING_RULES.md, aturan-prompt-claude-code-sip-smk.md, CLAUDE.md,
dan docs/CONTEXT.md, pola berikut muncul terus-menerus di setiap sesi:

### Pola A — Verifikasi Sesi Pembuka
Setiap sesi selalu dimulai dengan ritual yang sama:
1. `pwd` → cek mengandung "SIP SMK"
2. Konfirmasi AGENT_WORKING_RULES.md + CLAUDE.md sudah dibaca
3. `git log --oneline -5` + `git status`
4. `ls supabase/migrations/ | tail -5`

**Saat ini:** harus ditulis ulang manual di setiap prompt.

### Pola B — Investigasi Fungsi Database
Selalu muncul sebelum migration apapun:
- `pg_get_functiondef(oid)` untuk baca body fungsi
- `EXPLAIN ANALYZE` untuk estimasi waktu di tabel besar
- Query edge case checklist (campuran data lama/baru, tipe data operator valid)

### Pola C — Dry-Run Migration
Urutan yang sama setiap kali:
```sql
BEGIN;
  -- isi migration
ROLLBACK; -- test
-- (review verbatim)
BEGIN;
  -- isi migration
COMMIT;
```
Diikuti: `supabase db push --linked --dry-run` → review → konfirmasi → real push.

### Pola D — Verifikasi SECURITY DEFINER
Setiap fungsi SECURITY DEFINER baru wajib dua `REVOKE` tambahan.
Ini selalu dicek manual, dan pernah terlewat di satu sesi (jadi poin aturan eksplisit).

### Pola E — Cross-Portal School_id Check
Identik dengan `/audit-tenant` yang sudah ada, tapi hanya mencakup satu subset portal.
Perlu diperluas ke `parent/`, `student/`, `tu/`, `dudi/` yang ditambahkan belakangan.

### Pola F — Pre-Push Self Review 5 Poin
Checklist yang sama muncul di setiap prompt Mode B:
1. Side effect ke tenant lain?
2. Migration idempotent?
3. REVOKE dua lapis?
4. Diff verbatim sudah direview?
5. Risiko data loss?

### Pola G — Deploy Sequence
Urutan deploy yang tidak boleh berubah:
`supabase db push --linked --dry-run` → review → `supabase db push --linked` →
`supabase functions deploy ... --project-ref xovvuuwexoweoqyltepq` (jika ada) →
`git push origin main`

---

## 3. Rekomendasi Slash Commands Baru

### `/sip-start` — Verifikasi Sesi Pembuka
```
Jalankan ritual pembuka sesi:
1. Verifikasi pwd mengandung "SIP SMK" — STOP jika tidak
2. Tampilkan: git log --oneline -5, git status --short
3. Tampilkan: ls supabase/migrations/ | tail -5
4. Tampilkan HEAD saat ini dan cocokkan dengan HEAD di CLAUDE.md §2
5. Laporkan gap jika HEAD berbeda
Output verbatim semua. STOP, tunggu instruksi.
```
**Dampak:** menghilangkan 4 baris boilerplate di awal setiap prompt.

---

### `/sip-migration-check` — Validasi Migration Sebelum Apply
```
ARGS: <nama_fungsi_atau_tabel>

Untuk migration yang sedang disiapkan:
1. Cek apakah ada SECURITY DEFINER — jika ada, verifikasi ada REVOKE dua lapis
2. Cek idempotency: ada IF NOT EXISTS / OR REPLACE?
3. Untuk fungsi: jalankan pg_get_functiondef(oid) untuk verifikasi definisi existing
4. Estimasi rows terdampak jika ada UPDATE/DELETE — jalankan EXPLAIN ANALYZE
5. Jalankan BEGIN...ROLLBACK test, tampilkan output verbatim

Checklist 5 poin:
- [ ] Side effect ke tenant lain?
- [ ] Idempotent?
- [ ] REVOKE dua lapis jika SECURITY DEFINER?
- [ ] Diff verbatim?
- [ ] Risiko data loss?

STOP setelah checklist — tunggu konfirmasi push.
```
**Dampak:** menghilangkan checklist manual yang sama di setiap prompt migration.

---

### `/sip-deploy` — Sequence Deploy yang Aman
```
Jalankan urutan deploy berikut secara berurutan, STOP setelah setiap output:

1. supabase db push --linked --dry-run
   → Tampilkan output verbatim
   → Verifikasi: hanya migration yang dimaksud yang muncul, tidak ada drift
   → STOP, tunggu konfirmasi lanjut

2. (Setelah konfirmasi) supabase db push --linked
   → Tampilkan output verbatim

3. Jika ada edge function berubah (sebutkan di args):
   supabase functions deploy <nama> --project-ref xovvuuwexoweoqyltepq
   → Tampilkan output verbatim

4. git push origin main
   → Tampilkan output verbatim

TIDAK ADA langkah yang di-skip. TIDAK ADA push tanpa konfirmasi eksplisit setelah dry-run.
```
**Dampak:** mencegah urutan deploy yang salah (kode live memanggil RPC yang belum ada).

---

### `/sip-fn-inspect` — Inspeksi Fungsi PostgreSQL
```
ARGS: <nama_fungsi>

1. Jalankan query untuk ambil oid:
   SELECT oid FROM pg_proc WHERE proname = '<nama_fungsi>';
2. Jalankan pg_get_functiondef(oid) — tampilkan verbatim
3. Cek: apakah SECURITY DEFINER? Ada REVOKE FROM anon?
4. Cek: apakah dipanggil di sisi klien (grep semua portal JS)?
5. Tampilkan signature + calling convention

Output verbatim semua. STOP.
```
**Dampak:** menggantikan `\df+` yang hanya tampilkan signature (bukan body).
Insiden `MIN(uuid)` yang lolos ke migration bisa dicegah.

---

### `/sip-audit-tenant-full` — Versi Lengkap audit-tenant
```
Versi lengkap /audit-tenant yang mencakup SEMUA portal (termasuk parent/, student/, tu/):

grep -rn "supabase.from(" admin/js/ guru/js/ student/js/ parent/js/ \
  superadmin/js/ stakeholder/js/ shared/ tu/js/ dudi/js/ \
  --include="*.js" \
  | grep -v "school_id\|users\|auth\|school_configs\|programs\|academic_periods\|classes_view" \
  | grep -v "\.test\." \
  | sort

Untuk setiap hasil:
- Nama file + baris
- Tabel yang di-query
- Ada filter school_id di ±5 baris? (cek)
- Verdict: AMAN / PERLU AUDIT

Output verbatim. STOP.
```
**Dampak:** menutup gap `/audit-tenant` yang belum mencakup portal baru (`parent/`, `student/`, `tu/`).

---

### `/sip-invert` — INVERT Check (Skenario Gagal)
```
ARGS: <deskripsi perubahan yang akan diapply>

Jawab eksplisit dengan mekanisme konkret (kutip logika SQL/kode):
1. Apa yang bisa salah kalau ini diterapkan?
2. Skenario silent-failure? (kelihatan sukses padahal sebagian gagal)
3. Skenario concurrent/race condition? (dua user, dua tab, klik ganda)
4. Untuk migration data: baris campuran lama/baru? Konflik nilai? Waktu eksekusi?
5. Apakah operator/fungsi valid untuk tipe kolom sebenarnya?

STOP setelah laporan. Jangan apply apapun.
```
**Dampak:** menegakkan aturan INVERT dari aturan-prompt §4 yang sering terlewat.

---

## 4. Rekomendasi Perbaikan CLAUDE.md

### Yang sudah baik di CLAUDE.md sekarang
- Data kritis (school_id, slug) sudah ada dan akurat
- Constraint teknis (enum, timeout, parser Excel) sudah lengkap
- Backlog prioritas terstruktur
- Template prompt sudah ada

### Gap yang perlu ditambahkan

**A. Daftar portal yang diperbarui:**
CLAUDE.md §3 masih menyebut 7 portal, tapi repo sekarang sudah punya:
- `tu/` (Tata Usaha) — baru, ada di git history
- `parent/` (menggantikan `ortu/`?) — perlu klarifikasi

**B. Urutan deploy eksplisit:**
CLAUDE.md §4c Git tidak menyebut urutan `db push → functions deploy → git push`.
Ini ada di AGENT_WORKING_RULES.md §4 tapi tidak di CLAUDE.md.
Duplikasi di AGENT_WORKING_RULES sudah benar, tapi CLAUDE.md seharusnya referensikan.

**C. Larangan `EXISTS` mentah di RLS:**
Sudah di AGENT_WORKING_RULES.md §5 tapi tidak di CLAUDE.md.
Ini adalah aturan keamanan kritis — sebaiknya ada di kedua dokumen.

**D. Catatan `service_role` bukan superuser:**
Sama — ada di AGENT_WORKING_RULES.md §5, tidak di CLAUDE.md.

**E. HEAD perlu diperbarui:**
CLAUDE.md §2 masih menunjuk HEAD `1e75cd7` (26 Jul 2026).
HEAD aktual sekarang adalah `cc4d138` (29 Jul 2026).
Ini adalah sumber konfusi jika dipakai sebagai referensi migration.

---

## 5. Gap: Cara Kerja Sekarang vs Optimal

| Aspek | Sekarang | Optimal |
|-------|----------|---------|
| Pembuka sesi | 4–5 baris boilerplate diketik ulang manual | `/sip-start` — satu command |
| Cek migration | Checklist 5 poin ditulis manual di setiap prompt | `/sip-migration-check` |
| Inspeksi fungsi DB | `pg_get_functiondef` ditulis manual, sering lupa vs `\df+` | `/sip-fn-inspect` |
| Deploy sequence | Urutan diingat dari AGENT_WORKING_RULES, sering tidak lengkap di prompt | `/sip-deploy` |
| INVERT check | Kadang ada, kadang tidak | `/sip-invert` sebagai langkah wajib |
| Audit tenant | `/audit-tenant` hanya 6 portal lama | `/sip-audit-tenant-full` untuk semua portal |
| Sinkronisasi HEAD | CLAUDE.md HEAD tidak diperbarui otomatis | tambah ke `/sip-start` — bandingkan HEAD live vs CLAUDE.md |
| CONTEXT.md vs CLAUDE.md | Ada duplikasi besar antara keduanya | konsolidasi: CLAUDE.md untuk Claude Code, CONTEXT.md untuk Claude Chat |

### Insight kritis
**Duplikasi CLAUDE.md dan docs/CONTEXT.md** adalah risiko nyata:
dua dokumen yang seharusnya sinkron tapi tidak ada mekanisme untuk menjaganya tetap sama.
Ketika CLAUDE.md diperbarui (misalnya HEAD), CONTEXT.md tidak ikut diperbarui — dan sebaliknya.
Rekomendasi: buat CONTEXT.md sebagai superset dari CLAUDE.md (menambah bagian "Cara Kerja Sesi"),
bukan dokumen yang mereplikasi isinya.

---

## 6. Prioritas Implementasi

| Prioritas | Command/Perubahan | Alasan |
|-----------|-------------------|--------|
| 1 | Perbarui HEAD di CLAUDE.md ke `cc4d138` | Data kritis salah → konfusi migration |
| 2 | `/sip-audit-tenant-full` | Portal `tu/`, `parent/`, `student/` belum dicakup — security gap potensial |
| 3 | `/sip-start` | Dipakai setiap sesi — ROI tertinggi |
| 4 | `/sip-migration-check` | Mencegah insiden seperti `MIN(uuid)` terulang |
| 5 | `/sip-deploy` | Mencegah urutan deploy yang salah |
| 6 | `/sip-fn-inspect` | Gantikan `\df+` yang misleading |
| 7 | `/sip-invert` | Menegakkan aturan yang sudah ada tapi sering terlewat |
| 8 | Tambah aturan `EXISTS`/`service_role` ke CLAUDE.md | Sync dengan AGENT_WORKING_RULES |

---

## Checklist Akhir (sesuai AGENT_WORKING_RULES §7)

- [x] pwd terverifikasi mengandung "SIP SMK"
- [x] AGENT_WORKING_RULES.md dan CLAUDE.md sudah dibaca — disebutkan di awal
- [x] Hanya membuat `docs/claude-code-audit.md` — tidak ada file lain yang tersentuh
- [x] Output: dokumen ini adalah hasilnya
- [x] Tidak ada push/deploy yang dijalankan
