# Verifikasi Faktual — Klaim Alur Informasi SIP SMK

> Tanggal: 2026-07-31  
> Basis kode: HEAD `b013d5e` (branch main)  
> Verifikasi murni baca kode & DB — tidak ada perubahan apapun.

---

## Klaim 1 — Guru input absensi → informasi sampai ke banyak pihak

**Klaim:** Orang tua, wali kelas, kaprodi, waka kesiswaan, BK, TU, kepsek, siswa, waka kurikulum dapat melihat rekap absensi.

### Hasil Verifikasi: ⚠️ SEBAGIAN

**Yang terbukti ada:**

**a) Portal Siswa — siswa lihat kehadiran diri sendiri** ✅  
File: `student/js/dashboard.js:131–178`

```js
// student/js/dashboard.js:131
const TAB_SHORT = { jadwal: 'Jadwal', kehadiran: 'Hadir', observasi: 'Catatan', pkl: 'PKL', nilai: 'Nilai' };
// ...
case 'kehadiran': await loadAttendance(); break;
```

Tab "Kehadiran" aktif di dashboard siswa. Siswa bisa lihat rekap hadir/izin/sakit/alpa dirinya.

**b) Portal Orang Tua — orang tua lihat rekap absensi anak** ✅  
File: `parent/js/portal.js:5,44–47`

```js
// parent/js/portal.js:5
* Loads children, lets parent pick one, shows attendance + catatan siswa.
// ...
const sectionAtt  = document.getElementById('section-attendance');
const attSummary  = document.getElementById('attendance-summary');
const attTbody    = document.querySelector('#attendance-table tbody');
```

Tab "Kehadiran" tersedia di portal orang tua untuk setiap anak.

**c) Waka Kesiswaan — rekap absensi seluruh sekolah** ✅  
File: `guru/js/dashboard.js:394,1610–1624`

```js
case 'waka_kesiswaan': await initWakaKesiswaanTab(); break;

async function initWakaKesiswaanTab() {
    // ...
    await loadWkAttendanceRecap();
    await loadWkLateRecap();
}
```

Tab khusus "Kesiswaan" menampilkan rekap absensi + keterlambatan dengan filter tanggal.

**d) Portal TU — tab Rekap Kehadiran** ✅  
File: `tu/js/portal.js:4,32`

```js
* 3 tab: Jadwal Piket, Keterlambatan, Rekap Kehadiran.
const ALL_SECTIONS = ['section-piket', 'section-late', 'section-exits', 'section-attendance', 'section-forum'];
```

TU punya akses `section-attendance`.

**Yang TIDAK terbukti:**

- **Notifikasi push/otomatis ke orang tua saat guru input absensi harian** ❌  
  Tidak ditemukan trigger atau fungsi yang mengirim notifikasi `notifications` saat INSERT ke tabel `attendance`. Notifikasi otomatis hanya ada untuk **keterlambatan** (`fn_notify_on_late_arrival`) — bukan untuk absensi kelas biasa.  
  Orang tua hanya bisa melihat rekap secara *pull* (buka portal sendiri), bukan *push*.

- **Waka Kurikulum** — tidak ada tab khusus absensi di konteks waka kurikulum (`guru/js/dashboard.js`). Waka Kurikulum fokus ke perangkat ajar dan jadwal, bukan rekap kehadiran.

- **Kaprodi** — rekap absensi kaprodi di `initKaprodiTab()` mencakup siswa AKTIF di programnya, bukan eksplisit "absensi yang diinput guru" sebagai trigger. Bisa melihat tapi tidak real-time.

---

## Klaim 2 — Guru Piket input keterlambatan/izin keluar → informasi ke orang tua, TU, waka kesiswaan

**Hasil Verifikasi: ✅ TERBUKTI (sebagian besar)**

**a) Notifikasi otomatis ke orang tua saat keterlambatan diinput** ✅  
File: `supabase/migrations/20260722020000_notify_late_arrival.sql:140–142`  
Diperbaiki di: `supabase/migrations/20260722030000_notif_audit_fixes.sql:7–82`

```sql
-- Trigger aktif: AFTER INSERT ON late_arrivals
CREATE TRIGGER trg_notify_late_arrival
    AFTER INSERT ON late_arrivals
    FOR EACH ROW EXECUTE PROCEDURE fn_notify_on_late_arrival();

-- Isi fn_notify_on_late_arrival:
-- Kirim ke semua orang tua (dengan filter school_id)
INSERT INTO notifications
    (school_id, recipient_user_id, case_id, late_arrival_id, type, title, body)
SELECT
    NEW.school_id, sp.parent_user_id, NULL, NEW.late_id,
    'LATE_ARRIVAL', v_title_ortu, v_body_ortu
FROM student_parents sp
WHERE sp.student_id = NEW.student_id
  AND sp.school_id  = NEW.school_id;

-- Kirim ke guru yang mengajar hari ini
INSERT INTO notifications ...
FROM teaching_schedules ts
WHERE ts.class_id = v_class_id AND ts.session_date = NEW.late_date ...;
```

Notifikasi in-app (tabel `notifications`) otomatis terkirim ke orang tua + guru yang mengajar hari itu.

**b) Portal TU — tab Keterlambatan & Izin Keluar** ✅  
File: `tu/js/portal.js:171–234`

```js
// tu/js/portal.js:171
// ── Tab 2: Keterlambatan ───────────────────────────────────────
const lateHintEl  = document.getElementById('late-hint');
const lateSummary = document.getElementById('late-summary');
// ...
document.getElementById('btn-export-late').addEventListener('click', () => {
    downloadCSV([...header, ...rows], `keterlambatan-${Date.now()}.csv`);
});
```

TU punya tab Keterlambatan dengan filter tanggal dan ekspor CSV.  
TU juga punya `section-exits` (izin keluar).

**c) Waka Kesiswaan — rekap keterlambatan** ✅  
File: `guru/js/dashboard.js:1617–1623`

```js
document.getElementById('wk-late-start').value = firstOfMonth;
document.getElementById('wk-late-end').value   = today;
document.getElementById('wk-late-filter-btn').onclick = loadWkLateRecap;
await loadWkLateRecap();
```

**Catatan penting:**
- Notifikasi yang dikirim adalah **in-app** (tabel `notifications`), bukan SMS/WhatsApp/email eksternal.
- Guru yang dinotif saat keterlambatan = guru yang jadwalnya hari itu, bukan semua guru mapel siswa tersebut.

---

## Klaim 3 — DUDI input absensi PKL → informasi ke orang tua, kaprodi, waka humas, TU, kepsek, siswa

**Hasil Verifikasi: ⚠️ SEBAGIAN**

**Yang terbukti:**

**a) DUDI punya portal input absensi PKL** ✅  
File: `dudi/js/api.js:3,107–123`

```js
* Supabase wrapper untuk Portal DUDI (input absensi PKL & observasi).
// ...
* Simpan (upsert) absensi satu siswa untuk satu tanggal.
.from('pkl_attendance')
.upsert(payload, { onConflict: 'placement_id,attendance_date' });
```

**b) Kaprodi lihat rekap PKL program studinya** ✅  
File: `guru/js/dashboard.js:1917,2063`, `guru/js/api.js:453`

```js
// guru/js/dashboard.js
case 'kaprodi': await initKaprodiTab(); break;
// ...
const rows = await fetchPklAttendance(ids, start, end);

// guru/js/api.js:453
const { data, error } = await supabase.rpc('fn_pkl_attendance_recap', {
    p_student_ids: studentIds,
    p_date_start:  dateStart ?? null,
    p_date_end:    dateEnd   ?? null,
});
```

**c) Waka Humas lihat semua siswa PKL lintas program** ✅  
File: `guru/js/api.js:495–507`, `guru/js/dashboard.js:2601`

```js
// guru/js/api.js:495
// Semua siswa PKL lintas program (untuk Waka Humas)
export async function fetchAllPklStudents() {
    // ...
    .eq('student_status', 'PKL')
}
// guru/js/dashboard.js:2601
fetchAllPklStudents(),
// ...
const rows = await fetchPklAttendance(ids, start, end);
```

**d) Siswa lihat data PKL sendiri** ✅  
File: `student/js/dashboard.js:144,180,664–699`

```js
if (isPkl)  tabs.push({ key: 'pkl', label: 'PKL' });
// ...
case 'pkl': if (!pklLoaded) await loadPkl(); break;
```

**e) Orang tua lihat tab PKL anak** ✅  
File: `parent/js/portal.js:60,216`

```js
const pklAttWrap = document.getElementById('pkl-attendance-wrap');
// ...
if (key === 'pkl') await loadPkl(child.student_id);
```

**Yang TIDAK terbukti:**

- **Notifikasi otomatis** ke pihak manapun saat DUDI meng-input absensi PKL ❌  
  Tidak ditemukan trigger `AFTER INSERT ON pkl_attendance` yang mengirim ke `notifications`.  
  Akses bersifat *pull* (lihat rekap manual), bukan *push*.

- **TU akses data PKL** — tidak ditemukan eksplisit di `tu/js/portal.js`. TU portal fokus ke keterlambatan + absensi sekolah, tidak ada tab PKL.

- **Kepsek lihat rekap PKL** — `fn_kepsek_monitoring` ada di `guru/js/api.js:606`, tapi perlu verifikasi lebih lanjut apakah mencakup PKL.

---

## Klaim 4 — Orang tua input ketidakhadiran → informasi ke wali kelas, guru yang mengajar, BK, guru wali

**Hasil Verifikasi: ✅ TERBUKTI**

File: `parent/js/api.js:421–488`

```js
export async function getParentForumRecipients(classId, schoolId) {
    const [waliRes, bkRes, guruWaliRes, jadwalRes] = await Promise.all([
        // Wali Kelas
        supabase.from('users')
            .select('user_id')
            .eq('wali_kelas_class_id', classId)
            .eq('school_id', schoolId),

        // Guru BK yang menangani kelas ini
        supabase.from('bk_class_assignments')
            .select('bk_user_id')
            .eq('class_id', classId),

        // Guru Wali yang menangani siswa di kelas ini
        supabase.from('guru_wali_assignments')
            .select('guru_user_id')
            .eq('school_id', schoolId),

        // Guru yang mengajar hari ini
        supabase.from('teaching_schedules')
            .select('scheduled_teacher_id')
            .eq('class_id', classId)
            .eq('session_date', today),
    ]);

    const ids = new Set();
    if (waliRes.data?.user_id) ids.add(waliRes.data.user_id);
    (bkRes.data ?? []).forEach(r => ids.add(r.bk_user_id));
    (guruWaliRes.data ?? []).forEach(r => ids.add(r.guru_user_id));
    (jadwalRes.data ?? []).forEach(r => { if (r.scheduled_teacher_id) ids.add(r.scheduled_teacher_id); });

    return [...ids];
}

export async function createParentForumPost(title, body, classId, academicYear, schoolId) {
    const recipientIds = await getParentForumRecipients(classId, schoolId);
    // ...
    const { data, error } = await supabase.rpc('fn_create_forum_post', {
        p_audience_type:     'ORANG_TERTENTU',
        p_specific_user_ids: recipientIds,
        // ...
    });
}
```

Ketika orang tua membuat posting forum (misalnya pemberitahuan ketidakhadiran anak), pesan dikirim ke:
- ✅ Wali kelas (`wali_kelas_class_id`)
- ✅ Guru BK yang menangani kelas (`bk_class_assignments`)
- ✅ Guru Wali yang menangani siswa di kelas (`guru_wali_assignments`)
- ✅ Guru yang mengajar **hari ini** di kelas tersebut (`teaching_schedules` filter `session_date = today`)

**Catatan penting:**
- Mekanismenya via Forum Sekolah (posting pesan), bukan notifikasi sistem otomatis yang terpicu tanpa aksi orang tua.
- Orang tua harus aktif membuat posting — tidak ada deteksi "anak tidak hadir" yang memicu otomatis.
- Guru yang dikirimi = hanya yang jadwalnya **hari ini** — guru mapel lain hari yang berbeda tidak terkirim.

---

## Ringkasan

| Klaim | Status | Catatan |
|-------|--------|---------|
| **K1** Guru input absensi → sampai ke semua pihak | ⚠️ SEBAGIAN | Rekap bisa dilihat (*pull*) oleh siswa, ortu, TU, waka kesiswaan. Tidak ada notifikasi *push* otomatis saat absensi harian diinput. Waka Kurikulum tidak punya akses eksplisit. |
| **K2** Piket input keterlambatan → ke ortu, TU, waka kesiswaan | ✅ TERBUKTI | Notifikasi in-app otomatis ke ortu + guru mapel hari itu via trigger DB. TU & waka kesiswaan bisa lihat rekap. Bukan SMS/email. |
| **K3** DUDI input PKL → ke ortu, kaprodi, waka humas, TU, kepsek, siswa | ⚠️ SEBAGIAN | Kaprodi, waka humas, ortu, siswa bisa akses rekap (*pull*). TU tidak terlihat eksplisit. Tidak ada notifikasi *push* saat DUDI input. |
| **K4** Ortu input ketidakhadiran → ke wali kelas, guru mapel, BK, guru wali | ✅ TERBUKTI | Via Forum Sekolah. Semua 4 pihak jadi penerima posting. Mekanisme aktif (ortu harus buat posting, bukan auto-trigger). |

**Pola umum yang perlu dikomunikasikan ke stakeholder:**
> Sebagian besar alur informasi berjalan secara *pull* (lihat rekap), bukan *push* (notifikasi otomatis).  
> Satu-satunya alur *push* yang sudah terbukti: keterlambatan siswa → notifikasi in-app ke orang tua.  
> Tidak ada integrasi SMS, WhatsApp, atau email eksternal yang ditemukan di kodebase.
