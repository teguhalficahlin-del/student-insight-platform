# /sip-start — Verifikasi Pembuka Sesi SIP SMK

Jalankan seluruh langkah ini secara berurutan. Tampilkan semua output verbatim.

## Langkah 1 — Verifikasi pwd
```bash
pwd
```
Pastikan output mengandung `"SIP SMK"`. Jika tidak → **STOP**, laporkan ke user.

## Langkah 2 — Status repo
```bash
git log --oneline -7
git status --short
```

## Langkah 3 — Migration terbaru
```bash
ls supabase/migrations/ | tail -7
```

## Langkah 4 — Cek sinkronisasi HEAD
Ambil HEAD dari output `git log` di Langkah 2.
Bandingkan dengan HEAD yang tertulis di `CLAUDE.md §2`.
Jika berbeda → laporkan gap dan nilai mana yang benar (live = benar).

## Langkah 5 — Portal yang sedang aktif dikerjakan
```bash
git log --oneline --since="3 days ago"
```
Rangkum dalam 1–2 kalimat: portal/fitur apa yang paling banyak berubah belakangan ini.

## Output akhir
Tampilkan ringkasan:
- HEAD saat ini
- Jumlah file modified/untracked
- Migration terbaru (nama file)
- Status sinkronisasi HEAD vs CLAUDE.md
- Portal/fitur yang sedang aktif

**STOP** — tunggu instruksi task berikutnya.
