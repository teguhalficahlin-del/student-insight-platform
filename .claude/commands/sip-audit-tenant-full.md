# /sip-audit-tenant-full — Audit Tenant Isolation (Semua Portal)

Versi lengkap `/audit-tenant` yang mencakup SEMUA 9 portal aktual.
Read-only: tidak ada perubahan file, tidak ada commit.

---

## Langkah 1 — Scan query tanpa filter school_id
```bash
grep -rn "supabase\.from(" \
  guru/js/ student/js/ parent/js/ admin/js/ \
  superadmin/js/ tu/js/ dudi/js/ stakeholder/js/ shared/ \
  --include="*.js" \
  | grep -v "school_id\|v_users_staff_directory\|users\|auth\|school_configs\|programs\|academic_periods\|classes_view\|\.test\." \
  | sort
```
Tampilkan output verbatim.

---

## Langkah 2 — Verifikasi tiap hasil
Untuk setiap baris dari Langkah 1, baca ±5 baris di sekitar lokasi tersebut
dan tentukan apakah ada filter `school_id` yang aktif (termasuk yang berasal dari RLS).

Untuk setiap temuan, laporkan:
```
FILE: <path:baris>
TABEL: <nama tabel>
KONTEKS: <ringkasan 1 baris apa yang dilakukan query ini>
FILTER school_id: ADA / TIDAK ADA / DARI RLS
VERDICT: AMAN / PERLU AUDIT / FALSE POSITIVE
```

---

## Langkah 3 — Ringkasan
Tampilkan tabel ringkasan:

| Portal | Jumlah query | Aman | Perlu Audit |
|--------|-------------|------|-------------|
| guru   | … | … | … |
| student | … | … | … |
| parent | … | … | … |
| admin  | … | … | … |
| tu     | … | … | … |
| dudi   | … | … | … |
| stakeholder | … | … | … |
| superadmin | … | … | … |
| shared | … | … | … |

---

## Rules
- `v_users_staff_directory` dianggap AMAN — view ini sudah `security_invoker=true`
- Query ke tabel `users`, `auth.*`, `school_configs` tanpa `school_id` filter
  bisa AMAN jika tabel tersebut tidak ada kolom `school_id`
- Tabel tenant (punya kolom `school_id`) tanpa filter → PERLU AUDIT

**STOP** — jangan ubah apapun, laporkan temuan dan tunggu konfirmasi.
