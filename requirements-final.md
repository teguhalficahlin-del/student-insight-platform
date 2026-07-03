# Platform Monitoring Perkembangan Siswa SMK
## Requirements Document — Final & Frozen
**Status: Frozen — tidak ada perubahan tanpa membuka kembali diskusi requirement**

---

## 1. Konteks

- Target: satu sekolah SMK (pilot)
- Developer: solo dev
- Pendekatan: progressive enhancement (lihat bagian 18 untuk detail offline contract)

---

## 2. Filosofi Inti

- **Student Is Main Actor** — siswa adalah subjek perkembangan, bukan objek laporan
- **Evidence Before Opinion** — informasi yang dipublikasikan ke siswa hanya yang sudah disengaja, bukan dugaan atau investigasi yang masih berjalan
- **Parents Are Partners** — orang tua dilibatkan melalui komunikasi yang disengaja, bukan akses otomatis
- **Positive Before Punishment** — Student Update difokuskan pada tujuan perbaikan dan langkah berikutnya

---

## 3. Aktor dan Hak Akses Data

| Aktor          | Lingkup data yang bisa dilihat                       |
|----------------|------------------------------------------------------|
| Guru           | Lihat bagian 3a                                      |
| BK             | Semua siswa                                          |
| Wali kelas     | Semua siswa di kelasnya                              |
| Kaprodi        | Semua siswa di prodinya                              |
| Kepala sekolah | Semua siswa                                          |
| Siswa          | Data dirinya sendiri saja (lihat bagian 11)          |
| Orang tua      | Data anak sendiri saja (lihat bagian 15)             |
| Dinas          | Data agregat saja (tanpa identitas individu)         |
| DuDi           | Siswa PKL yang dibimbingnya saja                     |

### Manfaat eksplisit DuDi

```
Rekam jejak resmi penilaian PKL
→ dokumentasi kehadiran, partisipasi, dan kinerja siswa
→ tidak bergantung pada catatan manual yang mudah hilang

Jalur eskalasi formal ke Kaprodi
→ masalah siswa PKL dapat dieskalasi secara resmi
→ tidak perlu komunikasi informal yang tidak terdokumentasi

Komunikasi terdokumentasi dengan sekolah
→ semua keputusan dan catatan tersimpan di sistem
→ dapat dijadikan referensi evaluasi program PKL berikutnya
```

### 3a. Hak akses guru — detail

Definisi assignment:
```
Assignment adalah relasi aktif antara guru dan kelas/mapel.
Assignment tidak terikat periode waktu tertentu.
Sistem mengakomodir relasi yang ada, tidak memaksakan lifecycle.

Aktif     = relasi masih terdaftar di sistem
Tidak aktif = relasi dihapus atau dinonaktifkan

Tidak ada start_date, end_date, atau status lifecycle.
```

Hak akses berdasarkan assignment:
```
Assignment aktif:
- input absensi siswa
- input observasi siswa
- lihat semua data siswa
- lihat semua kasus siswa

Setelah assignment dinonaktifkan:
- input baru tidak boleh
- view histori siswa lama tetap boleh
- comment di kasus lama tetap boleh
- lihat kasus yang pernah melibatkan dirinya tetap boleh
```

Guru pengganti:
```
Guru pengganti tidak mendapat assignment sementara.
Guru pengganti hanya bisa input absensi
untuk pertemuan yang dia gantikan.
Tidak mendapat akses ke data siswa, kasus, atau observasi.
```

---

## 4. Hak Input per Aktor

| Aktor          | Input                                                                  |
|----------------|------------------------------------------------------------------------|
| Guru           | Absensi per pertemuan, observasi 8 dimensi, keputusan level guru, jurnal pribadi |
| BK             | Keputusan level BK                                                     |
| Wali kelas     | Keputusan level wali kelas, input Achievement siswa di kelasnya        |
| Kaprodi        | Keputusan level kaprodi, input Achievement siswa di prodinya           |
| Kepala sekolah | Inisiasi kasus dengan menentukan level awal penanganan (BK / Wali / Kaprodi), FINAL_DECISION_MADE (keputusan administratif final: dikeluarkan, dipindahkan, atau lainnya) |
| Siswa          | Tidak ada input ke sistem kasus                                        |
| Orang tua      | Pesan ke aktor pilihan (selective addressing)                          |
| Dinas          | Tidak ada                                                              |
| DuDi           | Kehadiran PKL (harian), partisipasi PKL (mingguan), kinerja PKL (mingguan), keputusan level DuDi |

---

## 5. Observasi Siswa

- Dasar hukum: Permendikdasmen No. 10 Tahun 2025
- Dilakukan setiap pertemuan oleh guru mapel
- Input berbasis tap
- 8 dimensi profil lulusan:
  1. Keimanan dan ketakwaan terhadap Tuhan Yang Maha Esa
  2. Kewargaan
  3. Penalaran kritis
  4. Kreativitas
  5. Kolaborasi
  6. Kemandirian
  7. Kesehatan
  8. Komunikasi
- Model observasi: Exception-Based Observation
- Guru hanya mencatat kejadian yang layak dicatat:
  - perilaku positif yang menonjol (+)
  - concern yang menonjol (-)
- Tidak ada kewajiban mengobservasi semua siswa di semua dimensi setiap pertemuan

Aturan interpretasi yang tidak boleh dilanggar:
```
Tidak ada catatan
≠ perilaku buruk
≠ perilaku baik
≠ tidak diamati

Artinya hanya:
tidak ada evidence yang layak dicatat pada pertemuan tersebut.
```

### Visibility default observasi

```
Observation (+)
→ Student Visible secara default
→ muncul di Student View sebagai "Perkembangan Positif"
→ guru dapat mengubah ke Internal School jika diperlukan

Observation (-)
→ Internal School secara default
→ tidak terlihat siswa
→ hanya terlihat oleh aktor sekolah yang memiliki akses
```

Pemisahan ini konsisten dengan filosofi:
- Student Is Main Actor → siswa berhak melihat perkembangan positifnya
- Positive Before Punishment → concern tidak otomatis terekspos ke siswa
- Evidence Before Opinion → hanya evidence yang sudah disengaja yang dipublikasikan

- Instrumen dan skala ditentukan terpisah

---

## 6. Absensi

- Per pertemuan, diinput guru mapel
- Status: Hadir / Tidak Hadir / Izin / Sakit
  *(EKSKUL dihapus dari absensi per keputusan 3 Juli 2026 — lihat catatan di bawah)*
- Selama periode PKL, absensi DuDi menggantikan absensi sekolah
- Absensi mengikuti status siswa, bukan periode global sekolah

### Definisi status absensi siswa

```
HADIR
→ siswa hadir di kelas

TIDAK HADIR
→ siswa tidak hadir tanpa keterangan

IZIN
→ siswa tidak hadir dengan keterangan
→ guru dapat menambahkan keterangan teks bebas opsional
   contoh: "urusan keluarga", "keperluan medis", "acara adat"
→ dihitung sebagai ketidakhadiran dalam statistik kehadiran

SAKIT
→ siswa tidak hadir karena sakit
→ dihitung sebagai ketidakhadiran dalam statistik kehadiran

EKSKUL  [DIHAPUS — keputusan 3 Juli 2026]
→ Status EKSKUL dihapus dari absensi. Form absensi guru tidak lagi
   menawarkannya; siswa yang mengikuti kegiatan ekstrakurikuler resmi
   cukup ditandai HADIR.
→ Kompatibilitas data lama: baris absensi lama berstatus EKSKUL
   diperlakukan & ditampilkan sebagai HADIR di seluruh portal
   (guru/wali, siswa, orang tua, rekap alumni admin).
→ Enum DB `attendance_status` masih memuat 'EKSKUL' (nilai usang, tak
   dipakai); opsional dibersihkan lewat migrasi data EKSKUL→HADIR.
```

Pembina ekskul bukan aktor di platform.

### Model input absensi

```
Default: semua siswa dianggap HADIR saat sesi absensi dibuka.

Guru hanya perlu mengubah status siswa yang tidak hadir.

Contoh kelas 30 siswa:
→ 29 hadir   : tidak perlu disentuh (termasuk yang ikut ekskul → HADIR)
→ 1 sakit    : guru ubah ke SAKIT

Tidak ada kewajiban tap untuk setiap siswa.
```

Aturan finalisasi:
```
Sesi absensi dianggap selesai saat guru menutup sesi.
Siswa yang tidak diubah statusnya = HADIR.
```

### Status pertemuan

Pertemuan memiliki status tersendiri yang terpisah dari status absensi siswa:

```
NORMAL
→ guru hadir, absensi siswa dapat diinput

KEGIATAN_SEKOLAH
→ kelas ditiadakan karena kegiatan tertentu
→ guru tetap dianggap HADIR
→ absensi siswa tidak dibuat
→ tidak memicu digest harian kehadiran guru
→ dikecualikan dari denominator kehadiran siswa

GURU_TIDAK_HADIR
→ guru tercatat TIDAK HADIR pada jadwal tersebut
→ absensi siswa tidak dibuat untuk pertemuan ini
→ tidak ditafsirkan sebagai ketidakhadiran siswa
→ dikecualikan dari seluruh perhitungan kehadiran siswa
→ tidak memicu alert ABSENCE_HIGH
→ denominator persentase kehadiran siswa dikurangi satu
```

Prinsip pemisahan:
```
Status siswa     → Hadir / Tidak Hadir / Izin / Sakit
Status guru      → HADIR / TIDAK HADIR / PENDING_EVALUATION
Status pertemuan → NORMAL / KEGIATAN_SEKOLAH / GURU_TIDAK_HADIR

Ketiganya tidak boleh dicampur.
```

### Pilihan guru sebelum atau saat membuka sesi

Guru dapat menandai kondisi jadwal sebelum jam pelajaran dimulai:

```
Pilihan 1 — Input absensi siswa (normal)
→ status pertemuan = NORMAL
→ guru = HADIR

Pilihan 2 — Kelas ditiadakan
→ status pertemuan = KEGIATAN_SEKOLAH
→ guru = HADIR
→ keterangan: teks bebas opsional
   contoh: "Upacara", "Class meeting", "Study tour kelas XII"

Pilihan 3 — Tidak hadir dengan keterangan
→ guru = TIDAK HADIR
→ keterangan: teks bebas opsional
   contoh: "Pelatihan guru", "Rapat dinas", "Sakit"
→ guru dapat menunjuk pengganti (opsional)

  Jika pengganti ditunjuk:
  → status pertemuan = NORMAL
  → Guru pengganti = HADIR untuk jadwal ini
  → absensi siswa diinput oleh guru pengganti
  → guru pengganti tidak mendapat assignment sementara
  → guru pengganti hanya bisa input absensi,
    tidak bisa lihat data siswa, kasus, atau observasi
  → masuk digest harian Kepsek sebagai informasi
    (bukan ketidakhadiran tanpa pengganti)

  Jika pengganti tidak ditunjuk:
  → status pertemuan = GURU_TIDAK_HADIR
  → absensi siswa tidak dibuat
  → masuk digest harian Kepsek
```

### Alur deteksi kehadiran guru — lengkap

```
Guru menandai lebih awal (sebelum jam mulai):
  Pilihan 2 → KEGIATAN_SEKOLAH, guru = HADIR
  Pilihan 3 tanpa pengganti → GURU_TIDAK_HADIR, guru = TIDAK HADIR
  Pilihan 3 dengan pengganti → NORMAL, guru asli = TIDAK HADIR,
                                guru pengganti = HADIR

Guru tidak menandai apapun:
  Setelah jam selesai terlewati:
  → ada input absensi siswa   = HADIR (NORMAL)
  → tidak ada input absensi   = TIDAK HADIR (GURU_TIDAK_HADIR)
  → data belum tersinkron     = PENDING_EVALUATION
```

Aturan sumber kebenaran:
```
Status pertemuan hanya dapat ditetapkan melalui:
1. Pilihan eksplisit guru sebelum jam mulai
2. Deteksi otomatis sistem setelah jam selesai (Bagian 18)

Tidak bisa ditetapkan melalui input manual absensi siswa.
Sumber kebenaran tetap tunggal.
```

---

## 7. Jurnal Guru

- Catatan progres materi, bebas waktu
- Hanya terlihat oleh guru itu sendiri
- Tidak ikut eskalasi, tidak ikut ekspor, tidak muncul di dashboard manapun

---

## 8. Alur Eskalasi

### Dua jalur terpisah (rantai = PENUNTUN, bukan gembok)

```
Jalur sekolah:
GURU → BK → WALI_KELAS → KAPRODI → WAKA_KESISWAAN → KEPSEK

Jalur PKL:
DUDI → KAPRODI → WAKA_KESISWAAN → KEPSEK
```

### Aturan eskalasi (desain Langkah A — mig 20260703250000)

- Eskalasi antar-aktor-internal **BEBAS** (arah mana pun, boleh lompat) — rantai
  di atas hanya penuntun untuk *peringatan* di UI, bukan batasan server.
- Kunci KERAS server: (a) target eskalasi wajib salah satu 6 peran internal
  kasus (GURU, BK, WALI_KELAS, KAPRODI, WAKA_KESISWAAN, KEPSEK) — tolak
  SISWA/ORTU/STAKEHOLDER/DUDI/WAKA_KURIKULUM/TU; (b) **DUDI hanya boleh
  eskalasi ke KAPRODI**.
- Audiens kasus (ala-FB) diatur pembuat: PRIVATE (default) / RESTRICTED
  (orang tertentu) / PUBLIC (semua internal). Notifikasi: japri eskalasi ke
  yang dituju (selalu); siaran hanya kasus publik; privat = senyap.
- Setiap aktor internal boleh: buat, tutup, eskalasi, atur audiens.
- Setiap level memilih: ubah status, Close, atau Escalate
- Semua event dari level bawah tetap bisa dilihat oleh level yang lebih tinggi
- Decision hanya bisa dibuat oleh current_level aktif
- Comment bisa ditambahkan oleh siapa pun yang memiliki akses lihat kasus
- Satu siswa bisa punya lebih dari satu kasus aktif secara bersamaan
- Satu siswa bisa punya kasus aktif di jalur sekolah dan jalur PKL secara bersamaan
- Kaprodi melihat kedua jalur di dashboard yang dipisah

---

## 9. Model Kasus

```
Case
├── owner_role        (role yang membuat kasus)
├── current_level     (role yang sedang memegang kasus)
├── status            (Open / Under Review / Intervention / Monitoring / Closed)
├── is_locked         (boolean)
└── case_events[]
    ├── event_type
    ├── payload
    ├── privacy_level (Private / Internal School / Student Visible)
    ├── acted_by      (user id)
    ├── acted_role    (role saat aksi)
    └── timestamp
```

### Aturan saat kasus dibuat

```
Untuk semua aktor kecuali Kepala Sekolah:
  owner_role    = creator_role
  current_level = creator_role
  status        = Open
  is_locked     = false

Untuk Kepala Sekolah:
  owner_role    = KEPSEK
  current_level = assigned_start_level
  status        = Open
  is_locked     = false

  assigned_start_level ∈ {BK, WALI, KAPRODI}
  (tidak boleh GURU — kasus yang diinisiasi Kepsek
   tidak diturunkan kembali ke level pelaksana kelas)
```

Audit trail kasus yang diinisiasi Kepsek:
```
owner_role    = KEPSEK  → diinisiasi oleh Kepala Sekolah
current_level = BK      → ditangani oleh BK
```

### Catatan terminologi untuk Domain Model dan API

`owner_role` dan `current_level` adalah dua konsep yang berbeda:

```
owner_role    → siapa yang memulai tanggung jawab administratif kasus
current_level → siapa yang sedang aktif menangani kasus saat ini
```

Keduanya bisa berbeda. Contoh valid:
```
owner_role    = KEPSEK
current_level = KAPRODI
```

Pada Domain Model dan API, hindari kata "owner" sebagai label tunggal
karena sering ditafsirkan sebagai penanggung jawab aktif. Gunakan:
```
initiated_by_role   → menggantikan owner_role
current_handler_role → menggantikan current_level
```

atau terminologi setara yang memisahkan inisiator dari penanggung jawab aktif.

### Status workflow

```
Open          → kasus baru, belum ada penanganan aktif
Under Review  → sedang diklarifikasi, mengumpulkan informasi
Intervention  → sudah ada tindakan aktif (konseling, mediasi, pembinaan)
Monitoring    → tindakan selesai, sedang dipantau
Closed        → kasus selesai, lifecycle penanganan berakhir
```

### Lifecycle status

```
Open → Under Review → Intervention → Monitoring → Closed
```

- Perubahan status hanya bisa dilakukan oleh current_level aktif
- Escalate adalah event terpisah, bukan perubahan status
- Posisi kasus tercermin dari current_level
- Closed bukan berarti dihapus — histori tetap tersimpan dan dapat diakses

### Event types

```
COMMENT_ADDED
STATUS_CHANGED
DECISION_ESCALATE
DECISION_CLOSE
FINAL_DECISION_MADE         (payload: decision_type, reason, acted_by, timestamp)
STUDENT_UPDATE_ADDED
PARENT_MESSAGE_RECEIVED
PARENT_MESSAGE_LINKED       (payload: message_id, case_id, acted_by, timestamp)
PARENT_REPLY_SENT
CASE_LOCKED
CASE_UNLOCKED
```

### Aturan FINAL_DECISION_MADE

```
Hanya Kepala Sekolah yang bisa membuat event ini.

decision_type ∈ {EXPELLED, TRANSFERRED, OTHER}
reason        → teks bebas (wajib diisi)
acted_by      → user id Kepsek
timestamp     → waktu keputusan

FINAL_DECISION_MADE otomatis menutup kasus:
→ status = Closed
→ tidak perlu DECISION_CLOSE terpisah

Audit trail:
→ keputusan final tercatat eksplisit di timeline
→ tidak tenggelam sebagai penutupan kasus biasa
→ dapat ditemukan langsung jika ada pertanyaan administratif
```

### Aturan current_level

- Hanya berubah melalui event DECISION_ESCALATE
- Tidak bisa diedit langsung
- Tidak boleh null selama status != Closed
- Tidak boleh sama dengan previous_level saat Escalate

---

## 10. Case Lock

- Hanya pemegang current_level aktif yang bisa mengunci dan melepas kunci
- Tujuan lock: mencegah intervensi pihak lain, bukan membekukan pekerjaan pemegang kasus
- Saat case locked, current_level aktif tetap boleh:
  - update status
  - add student update
  - unlock case
  - close case
  - escalate case
- Efek lock terhadap pihak lain:
  - Comment diblokir
  - Parent message diblokir sampai kasus dibuka
  - View tetap terbuka untuk semua aktor
- Melepas kunci: cukup role yang sama, tidak harus user yang sama
- Case lock tidak menghalangi FINAL_DECISION_MADE oleh Kepala Sekolah
  karena FINAL_DECISION_MADE adalah otoritas administratif tertinggi,
  bukan aksi operasional yang tunduk pada mekanisme lock

---

## 11. Level Privasi Konten Kasus

Setiap entry (Comment, Student Update, Internal Note) memiliki pilihan privasi:

```
Private
→ hanya penulis sendiri
→ contoh: catatan pribadi guru, draft investigasi BK

Internal School
→ seluruh aktor sekolah yang memiliki akses kasus
→ tidak terlihat siswa, orang tua, dinas
→ contoh: catatan investigasi, diskusi antar staf

Student Visible
→ siswa terkait + aktor sekolah yang memiliki akses kasus
→ tidak terlihat orang tua
→ contoh: Student Update, rencana tindak lanjut, pesan dukungan
```

### Aturan privasi

- Hanya penulis yang bisa mengubah level privasi setelah entry ditulis
- Student Visible ≠ Parent Visible
- Informasi yang terlihat siswa tidak otomatis terlihat orang tua
- Informasi untuk orang tua hanya tersedia melalui Parent Notification atau
  Parent Message yang dikirim secara eksplisit oleh aktor sekolah yang berwenang

---

## 12. Student View

### Yang boleh dilihat siswa

```
✅ Absensi dirinya sendiri
✅ Perkembangan Positif — dari Observation (+) dirinya sendiri
✅ Prestasi & Penghargaan — dari Achievement dirinya sendiri
✅ Status kasus yang melibatkan dirinya (termasuk closed case)
✅ Student Update yang ditandai Student Visible
✅ Rencana tindak lanjut yang harus dijalankan
```

Pemisahan tampilan di Student View:
```
Perkembangan Positif
→ berasal dari Observation dengan sentiment (+)
→ menampilkan dimensi, catatan, dan nama guru
→ contoh: "Kolaborasi — membantu teman menyelesaikan proyek kelompok"

Prestasi & Penghargaan
→ berasal dari entitas Achievement
→ menampilkan judul prestasi, tanggal, dan keterangan
→ contoh: "Juara 2 LKS Kabupaten", "Sertifikasi Industri XYZ"
```

### Yang tidak boleh dilihat siswa

```
❌ Internal Notes
❌ Catatan investigasi
❌ Diskusi antar staf
❌ Identitas pelapor
❌ Dugaan yang belum terverifikasi
❌ Detail eskalasi internal
```

### Closed case di Student View

```
Closed case tetap dapat dilihat oleh siswa sesuai aturan Student Visible.
Closed = lifecycle penanganan selesai, bukan data dihapus.
Histori kasus adalah bagian dari rekam jejak perkembangan siswa.
```

### Student Update — model hibrida

```
Student Update (opsional) → ditulis manual oleh pemegang kasus aktif
Jika tidak diisi          → sistem menampilkan pesan generik berdasarkan status

Pesan generik per status:
Open          → "Laporan sedang diterima oleh pihak sekolah."
Under Review  → "Kasus sedang ditinjau oleh pihak sekolah."
Intervention  → "Sedang dilakukan pendampingan dan tindak lanjut."
Monitoring    → "Perkembangan sedang dipantau."
Closed        → "Penanganan telah selesai dan kasus ditutup."
```

---

## 13. Domain Invariants

```
Invariant 1:
Case.status = Closed
⇒ tidak boleh ada event baru yang mengubah state kasus
⇒ hanya View yang diizinkan
⇒ FINAL_DECISION_MADE tidak boleh dilakukan
   precondition: case.status != Closed

Invariant 2:
DECISION_ESCALATE harus selalu menghasilkan:
current_level != previous_level

Invariant 3:
Untuk setiap case dengan status != Closed:
hanya boleh ada satu current_level aktif
current_level tidak boleh null

Invariant 4:
Case.is_locked = true
⇒ COMMENT_ADDED diblokir untuk semua aktor kecuali current_level aktif
⇒ PARENT_MESSAGE_RECEIVED diblokir sampai kasus dibuka
⇒ View tetap terbuka untuk semua aktor
⇒ current_level aktif tetap boleh: update status, add student update,
   unlock case, close case, escalate case
```

---

## 14. Permission Matrix

```
Aksi                  | Guru | BK  | Wali | Kaprodi | Kepsek | DuDi | Siswa | Ortu
----------------------|------|-----|------|---------|--------|------|-------|-----
Lihat kasus           |  ✓†  |  ✓  |  ✓   |    ✓    |   ✓    |  ✓‡  |  ✓§  |  —
Tambah comment        |  ✓†† |  ✓  |  ✓   |    ✓    |   ✓    |  ✓‡  |  —   |  —
Create case           |  ✓   |  —  |  —   |    —    |   ✓    |  ✓   |  —   |  —
Ubah status           |  ✓*  |  ✓* |  ✓*  |    ✓*   |   ✓*   |  ✓*  |  —   |  —
Decision: Escalate    |  ✓*  |  ✓* |  ✓*  |    ✓*   |   —    |  ✓*  |  —   |  —
Decision: Close       |  ✓*  |  ✓* |  ✓*  |    ✓*   |   ✓*   |  ✓*  |  —   |  —
Final Decision        |  —   |  —  |  —   |    —    |   ✓**  |  —   |  —   |  —
Lock case             |  ✓*  |  ✓* |  ✓*  |    ✓*   |   ✓*   |  ✓*  |  —   |  —
Unlock case           |  ✓*  |  ✓* |  ✓*  |    ✓*   |   ✓*   |  ✓*  |  —   |  —
Kirim pesan           |  —   |  —  |  —   |    —    |   —    |  —   |  —   |  ✓¶

*  hanya saat current_level = role tersebut
** hanya Kepsek, kapan saja selama status != Closed
   otomatis menutup kasus (status = Closed)
†  kasus siswa pada assignment aktif + kasus yang pernah melibatkan dirinya
†† siswa pada assignment aktif + kasus yang pernah melibatkan dirinya
‡  hanya siswa PKL yang dibimbingnya
§  hanya kasus yang melibatkan dirinya, hanya konten Student Visible,
   termasuk closed case
¶  selective addressing — hanya ke aktor yang memiliki hubungan langsung
   dengan siswa
```

---

## 15. Komunikasi Orang Tua

### Selective addressing

```
Orang tua memilih satu atau lebih aktor tujuan.
Sistem hanya menampilkan aktor yang memiliki hubungan langsung dengan siswa:
  - Guru mapel yang mengajar anaknya
  - Wali kelas
  - BK
  - Kaprodi yang relevan
  - Pembimbing PKL (jika siswa sedang PKL)

Hanya aktor yang dipilih yang bisa melihat pesan.
Aktor lain tidak bisa melihat.
```

### Dengan kasus aktif

- Hanya pemegang current_level aktif yang bisa membalas
- Pesan tercatat sebagai bagian dari timeline kasus
- Jika kasus sedang terkunci, pesan orang tua diblokir sampai kasus dibuka

### Tanpa kasus aktif

- Orang tua tetap bisa mengirim pesan ke aktor yang dipilih
- Pesan berdiri sendiri — bukan kasus, tidak punya lifecycle
- Aktor penerima bisa memutuskan:
  - Hubungkan ke kasus yang ada
  - Buat kasus baru
  - Biarkan sebagai percakapan umum

### Prinsip UX orang tua

- Konsep kasus tidak pernah terlihat oleh orang tua
- Orang tua hanya melihat: "Pesan terkirim" atau "Pesan sedang ditindaklanjuti"
- Student Visible ≠ Parent Visible
- Informasi untuk orang tua hanya melalui Parent Notification atau Parent Message
  yang dikirim eksplisit oleh aktor sekolah yang berwenang

---

## 16. Struktur Tabel Inti (Perkiraan)

```
students
users
roles

programs              → Program Keahlian
classes               → Rombel / Kelas

teaching_assignments
teaching_schedules
substitute_schedules  → Jadwal guru pengganti

attendance
observations
achievements

cases
case_events

parent_messages

teacher_journals

teacher_attendance
```

---

## 17. Keputusan yang Ditunda (Bukan Blocker Pilot)

- Transfer ownership kasus saat guru/BK pindah tugas → override admin
- State "dikembalikan" / Reopen → diperluas setelah pilot
- Instrumen dan skala observasi 8 dimensi → didiskusikan terpisah
- Detail agregat data dinas → didefinisikan setelah pilot
- Multi-parent (ayah, ibu, wali) → didiskusikan setelah pilot
- Mutasi siswa (pindah kelas, pindah jurusan, lulus, keluar) → didiskusikan setelah pilot
- Parent Notification eksplisit dari sekolah → didiskusikan setelah pilot
- School Configurable Threshold untuk alert → dievaluasi setelah data pilot tersedia
- Kategorisasi alasan ketidakhadiran guru (enum) → dievaluasi setelah pola penggunaan nyata terbentuk
- Teacher Declaration vs Administrative Validation → pasca-pilot, saat ini Pilihan 3 dianggap valid tanpa verifikasi

---

## 18. Indikator Kehadiran Guru

### Definisi

Kehadiran guru dalam sistem bukan fakta kehadiran fisik secara absolut, melainkan **indikator kehadiran berdasarkan aktivitas sistem** — ada atau tidak ada bukti aktivitas mengajar yang tercatat.

### Sumber data

Indikator kehadiran guru tidak diinput secara terpisah, melainkan dideteksi otomatis dari aktivitas input absensi siswa.

### Data jadwal mengajar (input baru)

```
Jadwal mengajar
├── guru
├── kelas
├── mata pelajaran
├── hari
├── jam mulai
└── jam selesai
```

- Satu guru bisa punya lebih dari satu jadwal per hari
- Setiap jadwal dievaluasi secara independen

### Logika deteksi kehadiran

```
Setelah jam selesai terlewati:
→ ada input absensi siswa dari guru ini untuk kelas ini hari ini
  = HADIR
→ tidak ada input absensi siswa
  = TIDAK HADIR
```

### Status antara saat offline

```
Jam selesai terlewati
↓
Belum ada data absensi siswa
↓
Status sementara = PENDING_EVALUATION
↓
Data offline masuk setelah sinkronisasi
↓
Evaluasi ulang → HADIR atau TIDAK HADIR (final)
```

Status tidak boleh difinalisasi sebelum sistem yakin tidak ada data yang masih tertahan di perangkat offline.

### Prinsip dashboard Kepala Sekolah

```
Dashboard Kepsek dirancang berbasis pengecualian:
→ tampilkan yang membutuhkan perhatian, bukan semua data
→ default view: anomali hari ini, bukan rekap lengkap

Contoh yang ditampilkan:
→ guru tidak hadir tanpa pengganti
→ siswa dengan alert aktif
→ kasus yang belum ditangani lebih dari X hari

Bukan:
→ seluruh data absensi sekolah
→ seluruh daftar observasi
→ semua kasus yang sudah Closed
```

### Hak akses dan notifikasi

```
Dashboard kehadiran guru → hanya Kepala Sekolah (realtime, berbasis cache)
Notifikasi TIDAK HADIR   → digest harian, bukan per kejadian

Format digest harian (contoh pukul 16:00):
"3 guru tidak hadir hari ini: A, B, C"

Alasan digest bukan per kejadian:
10 guru tidak hadir = 10 notifikasi = spam
Digest melayani: "apa yang perlu saya tahu hari ini?"
Dashboard melayani: "saya ingin melihat detail sekarang."
```

### Tabel baru yang dibutuhkan

```
teaching_schedules    → jadwal mengajar guru
teacher_attendance    → indikator kehadiran hasil deteksi
  ├── teacher_id
  ├── schedule_id
  ├── attendance_status  (HADIR / TIDAK HADIR / PENDING_EVALUATION)
  ├── attendance_source  (AUTO_DETECTED / MANUAL_OVERRIDE / TEACHER_DECLARED)
  └── timestamp
```

Definisi attendance_source:
```
AUTO_DETECTED    → sistem mendeteksi otomatis setelah jam selesai
MANUAL_OVERRIDE  → koreksi administratif setelah fakta
TEACHER_DECLARED → guru menandai sebelum jam mulai
                   (Pilihan 2: KEGIATAN_SEKOLAH)
                   (Pilihan 3: GURU_TIDAK_HADIR)
```

### Catatan implementasi

- `AUTO_DETECTED` — status ditetapkan otomatis oleh sistem setelah jam selesai
- `MANUAL_OVERRIDE` — koreksi administratif untuk kasus nyata seperti:
  - guru hadir tapi lupa input absensi
  - koneksi belum tersinkron saat evaluasi
  - jam pelajaran digunakan untuk kegiatan sekolah
- Override bukan requirement pilot, tetapi field `attendance_source` disiapkan
  sejak DDL agar tidak perlu perombakan schema setelah pilot

### Override reason

```
MANUAL_OVERRIDE dapat menyertakan:
override_reason (opsional, teks bebas)

Tujuan:
memberikan konteks administratif atas koreksi indikator kehadiran.

Contoh:
"Mendampingi lomba provinsi"
"Rapat dinas luar sekolah"
"Guru pengganti mengajar"
"Kegiatan class meeting"
```

Kategorisasi alasan ketidakhadiran guru (enum) bukan bagian dari pilot.
Dapat dievaluasi setelah data pilot tersedia dan pola penggunaan nyata terbentuk.

---

## 19. Offline Contract

### Prinsip dasar

```
Fitur pencatatan dan pengambilan keputusan
harus tetap berfungsi tanpa koneksi internet.

Perubahan disimpan lokal dan disinkronkan saat koneksi tersedia.

Fitur komunikasi, notifikasi, dan dashboard agregat
dapat tertunda sampai koneksi tersedia.

Semua dashboard yang dapat dibuka saat offline
harus menampilkan waktu sinkronisasi terakhir.

Status kehadiran guru tidak boleh difinalisasi
sebelum data offline yang tertahan telah diproses.
```

### Kategori A — Harus tetap berjalan offline

Aktivitas inti operasional sekolah. Jika berhenti saat internet hilang, pengguna akan kembali ke kertas.

```
Guru:
✅ Input absensi siswa
✅ Input observasi 8 dimensi
✅ Membuat kasus
✅ Update kasus
✅ Comment kasus
✅ Menulis jurnal
✅ Input absensi sebagai guru pengganti
   (substitute_schedules harus tersinkron ke perangkat
    guru pengganti sebelum atau saat ditunjuk)

BK:
✅ Membaca data yang sudah tersinkron sebelumnya
✅ Membuat keputusan kasus
✅ Update status kasus
✅ Membuat Student Update
✅ Comment kasus

Wali kelas / Kaprodi / Kepala sekolah:
✅ Melihat cache data terakhir
✅ Membaca kasus yang sudah pernah tersinkron
✅ Membuat keputusan kasus

Siswa:
✅ Melihat data dirinya yang sudah pernah tersinkron
```

Semua perubahan yang dibuat offline masuk local queue dan disinkronkan saat koneksi tersedia.

### Kategori B — Boleh menunggu koneksi

Fitur komunikasi dan agregasi. Jika tertunda beberapa jam tidak merusak operasional kelas.

```
⏳ Notifikasi (eskalasi kasus, kehadiran guru, pesan masuk)
⏳ Pesan orang tua (disimpan sebagai pending, dikirim saat online)
⏳ Dashboard agregat terbaru (kepala sekolah, kaprodi, dinas)
⏳ Sinkronisasi lintas perangkat
```

### Indikator UI wajib

Semua dashboard yang dapat dibuka saat offline harus menampilkan:

```
"Data terakhir tersinkron: [tanggal] [waktu]"
```

---

## 20. Alert Sistem

### Prinsip dasar

```
Sistem memberi sinyal. Manusia mengambil keputusan.

Alert menampilkan data objektif — bukan rekomendasi tindakan.
Keputusan tetap sepenuhnya di tangan profesional.
```

### Contoh alert

```
✓ "Siswa X absen 8 kali bulan ini"
✓ "Dimensi Kemandirian siswa Y muncul sebagai concern 3 kali berturut-turut"
✓ "Guru A belum mencatat observasi apapun untuk kelas Y selama 2 minggu"

✗ "Pertimbangkan konseling BK untuk siswa X"
✗ "Rekomendasikan pertemuan orang tua untuk siswa Y"
✗ "Siswa Z belum ada observasi 2 minggu" ← tidak valid setelah Opsi D
   (tidak ada observasi = tidak ada kejadian menonjol, bukan indikator masalah)
```

### Visibility alert

```
Visibility Alert = Visibility Data

Alert terlihat oleh semua aktor yang memiliki hak melihat
data siswa terkait. Tidak ada permission baru.

Guru        → alert siswa pada assignment aktif
Wali        → alert seluruh siswa di kelasnya
BK          → alert seluruh siswa sekolah
Kaprodi     → alert seluruh siswa di prodinya
Kepsek      → alert seluruh siswa sekolah
DuDi        → alert siswa PKL yang dibimbingnya
Siswa       → tidak melihat alert operasional
Orang tua   → tidak melihat alert operasional
```

### Threshold sistem (default pilot)

```
ABSENCE_HIGH
→ absen ≥ 5 kali dalam 30 hari

CONCERN_REPEATED
→ dimensi yang sama muncul sebagai concern (-)
  3 kali atau lebih dalam 30 hari

TEACHER_NO_RECORD
→ guru tidak mencatat observasi apapun untuk satu kelas
  selama 14 hari berturut-turut
  (memonitor aktivitas pencatatan guru, bukan kondisi siswa)
```

Catatan: alert berbasis observasi mengukur frekuensi evidence yang tercatat,
bukan ketiadaan observasi. Ketiadaan observasi bukan sinyal negatif.

### Kategorisasi alert

```
Alert Perkembangan Siswa:
  ABSENCE_HIGH        → berbasis data absensi siswa
  CONCERN_REPEATED    → berbasis frekuensi evidence observasi

Monitoring Aktivitas Pencatatan:
  TEACHER_NO_RECORD   → berbasis aktivitas guru di sistem
                        bukan kondisi siswa
```

Keduanya tidak boleh dicampur dalam satu kategori di UI maupun API.
TEACHER_NO_RECORD adalah sinyal operasional sistem,
bukan indikator perkembangan siswa.

TEACHER_NO_RECORD memicu pertanyaan:
"Apakah proses pencatatan berjalan?"

Bukan kesimpulan:
"Guru bermasalah."

Tidak ada observasi 14 hari bisa berarti:
- kelas relatif stabil, tidak ada evidence yang layak dicatat
- jadwal berubah
- kegiatan sekolah
Konteks tetap harus diverifikasi oleh manusia.

Nilai threshold bersifat sementara dan akan dievaluasi setelah pilot berdasarkan:
- Threshold mana yang terlalu sensitif
- Threshold mana yang tidak pernah muncul
- Threshold mana yang benar-benar berguna

### Keputusan yang ditunda

```
School Configurable Threshold → kandidat fitur pasca-pilot
Rekomendasi berbasis AI       → kandidat fitur pasca-pilot,
                                setelah data pilot cukup untuk kalibrasi
```

---

## 21. Struktur Organisasi Sekolah

### Hierarki domain

```
Sekolah
└── Program Keahlian (dikelola Kaprodi)
    └── Rombel / Kelas (dikelola Wali Kelas)
        └── Siswa
```

### Program Keahlian

```
Contoh: TKJ, AKL, TKR, RPL
Dikelola oleh: Kaprodi
Satu Kaprodi mengelola satu Program Keahlian
Satu Program Keahlian bisa memiliki banyak Rombel
```

### Rombel / Kelas

```
Contoh: X TKJ 1, X TKJ 2, XI AKL 1, XII TKR 3
Dikelola oleh: Wali Kelas
Satu Wali Kelas mengelola satu Rombel
Satu Rombel berada di bawah satu Program Keahlian
```

### Relasi yang bergantung pada Rombel

```
Wali Kelas    → melihat semua siswa di Rombel-nya
Wali Kelas    → input Achievement untuk siswa di Rombel-nya
Orang tua     → melihat Wali Kelas dari Rombel anaknya
Alert sistem  → dikelompokkan per Rombel
```

### Relasi yang bergantung pada Program Keahlian

```
Kaprodi       → melihat semua siswa di Program Keahlian-nya
Kaprodi       → input Achievement untuk siswa di Program Keahlian-nya
Kaprodi       → melihat dashboard PKL siswa di Program Keahlian-nya
```

### Tahun ajaran

```
Pilot mengasumsikan satu tahun ajaran aktif.
Tidak ada mekanisme pergantian tahun ajaran untuk pilot.
Mutasi siswa antar Rombel atau Program Keahlian
ditunda ke pasca-pilot (lihat Bagian 17).
```

---

*Dokumen ini frozen. Perubahan hanya boleh dilakukan setelah membuka kembali diskusi requirement secara eksplisit.*
