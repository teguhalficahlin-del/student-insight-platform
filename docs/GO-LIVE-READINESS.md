# GO-LIVE READINESS — SIP SMK

**Versi:** 1.1  
**Tanggal dibuat:** 26 Agustus 2026  
**Tujuan:** Dokumen ini adalah standar resmi yang menentukan kapan SIP SMK layak digunakan massal. Setiap audit, sprint, dan keputusan go-live harus mengacu pada dokumen ini.

**Prinsip dasar:** "Layak digunakan massal" bukan berarti zero bug. Layak artinya: tidak ada data yang hilang, tidak ada celah keamanan kritis, dan alur utama bekerja reliably. Bug yang tersisa ditangani sambil berjalan dengan proses yang terdefinisi.

---

## CARA MENGGUNAKAN DOKUMEN INI

Setiap audit menghasilkan satu output: **Go / No-Go**.

Format hasil audit:
```
Audit: [nama auditor] — [tanggal]
Tier 1 Status: X/7 terpenuhi
Blocker tersisa: [daftar item yang belum terpenuhi]
Keputusan: GO / NO-GO
```

**Go-live hanya boleh dilakukan jika semua Tier 1 terpenuhi.** Tidak ada pengecualian.

---

## TIER 1 — BLOCKER (Wajib selesai sebelum satu sekolah pun go-live)

### T1-01: Zero Critical/High Security Vulnerability

**Indikator:** Tidak ada open finding dengan severity CRITICAL atau HIGH dari audit keamanan terakhir.

**Cara verifikasi:**
- Buka dokumen status audit keamanan terakhir
- Setiap finding harus memiliki status salah satu dari:
  - ✅ Fixed — dengan referensi commit/migration
  - ✅ Accepted Risk — dengan justifikasi tertulis mengapa risiko diterima
  - ❌ Open — ini blocker
- Jalankan audit keamanan ulang (dengan akses DB live) untuk verifikasi tidak ada finding baru yang belum tertangani
- Semua finding dari semua sumber audit harus berstatus Fixed atau Accepted Risk

**Tidak terpenuhi jika:** Ada satu pun finding CRITICAL atau HIGH berstatus Open.

---

### T1-02: Alur Absensi Bekerja End-to-End

**Indikator:** Guru bisa input absensi kelas → data tersimpan → rekap muncul di portal Ortu dalam < 60 detik, untuk semua 5 status kehadiran.

**Cara verifikasi (manual test script):**
1. Login sebagai Guru dengan kelas aktif
2. Input absensi: 1 siswa Hadir, 1 Sakit, 1 Izin, 1 Alpha, 1 Terlambat
3. Submit → konfirmasi tidak ada error
4. Login sebagai Ortu dari salah satu siswa
5. Buka rekap absensi → status muncul sesuai input Guru
6. Cek waktu antara submit Guru dan tampil di Ortu: < 60 detik
7. Query DB langsung: konfirmasi semua 5 baris tersimpan dengan benar

**Catatan:** Dijalankan oleh orang selain Romo (guru rekan atau staf sekolah yang belum familiar).

**Tidak terpenuhi jika:** Ada satu skenario yang gagal, error, atau data tidak konsisten.

---

### T1-03: Alur Penilaian Bekerja End-to-End

**Indikator:** Guru input nilai TP → KKTP terhitung → grade_recap tersimpan → data tetap ada setelah refresh dan reload.

**Cara verifikasi (manual test script):**
1. Login sebagai Guru dengan siswa dan TP aktif
2. Input nilai untuk 3 siswa, 2 TP berbeda
3. Submit → konfirmasi tidak ada error
4. Refresh halaman → nilai masih muncul sama
5. Cek KKTP terhitung otomatis dan hasilnya masuk akal
6. Query DB: konfirmasi assessment_results, student_grades, grade_recap semua terisi
7. Logout dan login ulang → data masih sama

**Tidak terpenuhi jika:** Nilai hilang setelah refresh, KKTP tidak terhitung, atau ada inkonsistensi antara UI dan DB.

---

### T1-04: Data Tidak Hilang Saat Error

**Indikator:** Tidak ada skenario di mana data terhapus, corrupt, atau hilang secara senyap tanpa notifikasi ke pengguna.

**Cara verifikasi:**
1. Code review: semua operasi INSERT dan UPDATE di seluruh codebase yang menyentuh tabel sensitif (assessment_results, student_grades, grade_recap, attendance, coaching_cases, coaching_case_events) harus berjalan dalam transaksi database atau menggunakan RPC Supabase yang atomik
2. Konfirmasi via DB: tidak ada mekanisme partial insert yang bisa lolos RLS — setiap INSERT yang gagal di tengah jalan harus rollback seluruh operasi
3. Cek error handling di kode klien: setiap mutation harus menangani error secara eksplisit (tidak ada fire-and-forget untuk operasi yang mengubah data penting)
4. Konfirmasi: tidak ada tabel sensitif yang mengizinkan NULL pada kolom yang seharusnya wajib terisi (constraint NOT NULL pada kolom kritis)

**Tidak terpenuhi jika:** Ada mutation data penting yang berjalan tanpa transaksi, atau ada operasi yang bisa menghasilkan partial state tanpa error handling.

---

### T1-05: Error Tracking Aktif

**Indikator:** Error tracking aktif menerima event dari semua 8 portal dan alert dikirim ke Romo saat terjadi error baru.

**Cara verifikasi:**
1. Buka dashboard error tracking → proyek SIP SMK terdaftar
2. Trigger intentional error di setiap portal (8 portal): akses halaman yang tidak ada, submit form invalid
3. Semua 8 error muncul di dashboard dalam < 30 detik
4. Email/notifikasi alert diterima Romo untuk error baru

**Tidak terpenuhi jika:** Satu pun portal tidak mengirim event ke error tracking, atau notifikasi tidak berfungsi.

**Status saat ini:** ❌ Belum dikonfigurasi.

---

### T1-06: Uptime Monitoring Aktif

**Indikator:** Monitor eksternal berjalan dan pernah berhasil mengirim alert ketika sistem tidak dapat diakses.

**Cara verifikasi:**
1. Buka dashboard uptime monitoring
2. Semua 8 portal URL terdaftar sebagai monitor
3. Test alert: matikan satu endpoint 5 menit → alert diterima via WhatsApp/email → endpoint kembali → monitor hijau
4. History tersedia: bisa lihat uptime 30 hari ke belakang

**Tidak terpenuhi jika:** Monitoring belum ada, atau alert tidak terkirim saat endpoint down.

**Status saat ini:** ❌ Belum dikonfigurasi.

---

### T1-07: Guard Student↔School di rls_cc_update

**Indikator:** UPDATE pada tabel `coaching_cases` tidak bisa mengganti `student_id` ke siswa dari sekolah lain, bahkan setelah INSERT yang sah.

**Cara verifikasi:**
1. Jalankan uji behavioral BEGIN…ROLLBACK:
   - INSERT `coaching_cases` yang valid (student dari sekolah yang benar) → berhasil
   - UPDATE `student_id` pada baris tersebut ke siswa dari sekolah lain → harus ditolak (42501 atau error RLS)
2. Konfirmasi via query: `SELECT with_check FROM pg_policies WHERE tablename = 'coaching_cases' AND policyname = 'rls_cc_update'` — harus mengandung predikat `fn_student_in_current_school(student_id)` atau equivalent

**Tidak terpenuhi jika:** UPDATE berhasil mengganti `student_id` ke siswa sekolah lain tanpa error.

**Status saat ini:** ❌ Belum ada — `rls_cc_update` saat ini hanya cek `school_id = fn_current_school_id()`, tidak ada guard `student_id`.

---

## TIER 2 — TARGET (Wajib selesai dalam 30 hari pertama operasi)

Item Tier 2 tidak memblokir go-live pilot, tapi **wajib selesai sebelum ekspansi ke sekolah kedua**.

| Kode | Item | Indikator Konkret | Status |
|------|------|-------------------|--------|
| T2-01 | Sprint Forum-1 selesai | STORAGE-01, RLS-01, RLS-02, EDGE-01 semua closed; audit keamanan ulang dengan DB live konfirmasi fixed | ❌ Open |
| T2-02 | Test suite Sprint C selesai | `node tests/tenant-isolation.mjs` — CHECK 7/11/12/13/14 semua hijau, zero stub log.pass() palsu | ❌ Open |
| T2-03 | Fungsi orphan di-DROP | Query pg_proc → fn_involved_in_case dan fn_is_case_subject_or_parent = 0 baris | ❌ Open |
| T2-04 | Response time support | Log: setiap laporan masalah direspons < 24 jam — diverifikasi dari log tiket | ❌ Belum bisa diukur |
| T2-05 | Onboarding guide tersedia | Admin sekolah baru bisa setup dari nol tanpa bantuan Romo — diuji oleh orang yang belum pernah pakai | ❌ Belum ada |
| T2-06 | Export nilai ke e-Rapor SMK | SIP SMK bisa export nilai per kelas dalam format Excel yang kompatibel dengan template import e-Rapor SMK resmi Kemendikbud; guru bisa upload file tersebut ke e-Rapor tanpa perlu entri ulang manual | ❌ Belum ada |

---

## TIER 3 — ONGOING (Tidak ada deadline, dikerjakan selamanya)

Item Tier 3 tidak memblokir apapun. Ini standar operasional yang dijaga setelah go-live.

| Kode | Item | Target | Cara Ukur |
|------|------|--------|-----------|
| T3-01 | Bug dari pengguna ditangani | Tidak ada bug medium/low dibiarkan > 30 hari tanpa update status | Bug tracker: tanggal masuk vs status terakhir |
| T3-02 | Uptime terjaga | ≥ 99% per bulan | Dashboard monitoring — laporan bulanan |
| T3-03 | Error rate terkendali | < 1% dari total request per minggu | Dashboard error tracking — laporan mingguan |
| T3-04 | Performa acceptable | Response time p95 < 3 detik untuk semua halaman utama | Dashboard performance monitoring |
| T3-05 | Security patch | Dependency dengan known CVE di-update dalam 14 hari setelah advisory | GitHub Dependabot atau cek manual mingguan |

---

## TEMPLATE AUDIT

Gunakan template ini setiap kali audit go-live readiness dijalankan:

```
# AUDIT GO-LIVE READINESS
Auditor     : [nama]
Tanggal     : [tanggal]
Metode      : [manual test / automated / DB query / kombinasi]

## TIER 1 CHECKLIST

| Kode  | Item                              | Status      | Catatan |
|-------|-----------------------------------|-------------|---------|
| T1-01 | Zero critical/high vulnerability  | ✅/❌/⚠️   |         |
| T1-02 | Alur absensi end-to-end           | ✅/❌/⚠️   |         |
| T1-03 | Alur penilaian end-to-end         | ✅/❌/⚠️   |         |
| T1-04 | Data tidak hilang saat error      | ✅/❌/⚠️   |         |
| T1-05 | Error tracking aktif              | ✅/❌/⚠️   |         |
| T1-06 | Uptime monitoring aktif           | ✅/❌/⚠️   |         |
| T1-07 | Guard rls_cc_update student↔school| ✅/❌/⚠️   |         |

## HASIL

Tier 1 terpenuhi : X/7
Blocker tersisa  : [daftar kode item yang ❌]
Keputusan        : GO / NO-GO

## CATATAN TAMBAHAN
[temuan di luar checklist, rekomendasi, hal yang perlu diinvestigasi lebih lanjut]
```

---

## STATUS SAAT INI (26 Agustus 2026)

Berdasarkan pekerjaan yang sudah selesai hingga hari ini:

| Kode  | Item | Status |
|-------|------|--------|
| T1-01 | Zero critical/high vulnerability | ⚠️ Sebagian — Sprint Forum-1 belum dikerjakan |
| T1-02 | Alur absensi end-to-end | ⚠️ Belum diverifikasi dengan test script formal |
| T1-03 | Alur penilaian end-to-end | ⚠️ Fitur ada, belum diverifikasi formal |
| T1-04 | Data tidak hilang saat error | ⚠️ Belum diuji secara formal |
| T1-05 | Error tracking aktif | ❌ Belum dikonfigurasi |
| T1-06 | Uptime monitoring aktif | ❌ Belum dikonfigurasi |
| T1-07 | Guard rls_cc_update student↔school | ❌ Belum ada |

**Keputusan saat ini: NO-GO**

Blocker yang paling mendesak:
1. T1-05 — Error tracking perlu dikonfigurasi
2. T1-06 — Uptime monitoring perlu dikonfigurasi
3. T1-07 — rls_cc_update perlu ditambahkan guard student↔school
4. T1-01 — Sprint Forum-1 perlu diselesaikan

---

## RIWAYAT PERUBAHAN

| Versi | Tanggal | Perubahan |
|-------|---------|-----------|
| 1.0 | 26 Agu 2026 | Dokumen pertama dibuat |
| 1.1 | 26 Agu 2026 | Revisi berdasarkan review: T1-04 rapor turun ke T2-06 (export Excel e-Rapor); rls_cc_update naik dari T2-03 ke T1-07; T1-05 cara verifikasi diubah ke code review; T1-06/T1-07 renumbered dari T1-06/T1-07 sebelumnya |
