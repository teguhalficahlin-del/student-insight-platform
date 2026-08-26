# Mapping: Tab Penilaian MiClass → Sub-Tab Penilaian SIP SMK

> Dokumen ini adalah panduan implementasi Sub-Tab Penilaian SIP SMK berdasarkan investigasi Tab Penilaian MiClass.
> Dibuat: 2026-08-26 | Status: Investigasi selesai, siap implementasi

---

## 1. Inventarisasi MiClass

### 1.1 File UI & Komponen

| File | Peran |
|---|---|
| `guru/classroom.html` | Container halaman classroom; meng-host `<div id="panel-penilaian">` yang menjadi mount-point Tab Penilaian |
| `guru/js/classroom-assessment.js` | **Seluruh logika Tab Penilaian** — 4.325 baris, IIFE, tidak ada framework; tiga section collapse (Perencanaan / Pelaksanaan / Rekap) dirender sepenuhnya dari JS ke innerHTML |
| `guru/js/classroom.js` | Bootstrap classroom page; memanggil `initAssessmentTab(cId, tId)` saat tab diklik |

Tidak ada file CSS dedicated; seluruh style ditulis inline via template literal.

### 1.2 File Fungsi / Helper / Utils

| Simbol / Fungsi | Lokasi | Keterangan |
|---|---|---|
| `_nilaiSedangDisimpan` | `classroom-assessment.js:28` | Re-entrancy guard boolean; mencegah double-submit dari semua jalur simpan |
| `_modalId` | `classroom-assessment.js:33` | Instance counter modal; `closeModal(token)` menolak tutup bila token !== _modalId |
| `getPredikat(nilai, rentang)` | `classroom-assessment.js:205` | Iterasi `PREDIKAT_ORDER` dari SB→BB (index terbesar ke 0), return predikat pertama di mana `nilai >= batas_bawah` |
| `validasiRentang(rentang)` | `classroom-assessment.js:258` | Validasi: angka finite, 0–100, tidak overlap antar predikat; mengembalikan pesan galat atau null |
| `hapusRekapTp(tpKktpId)` | `classroom-assessment.js:291` | Hapus `grade_recap` scoped ke classroom+TP+semester+tahun saat nilai diperbarui |
| `hitungRekapTp(tpKktpId)` | `classroom-assessment.js:307` | COUNT rekap per TP (tanpa filter semester) untuk pesan konfirmasi hapus TP |
| `loadAll()` | `classroom-assessment.js:327` | Parallel load 4 sumber: TpKktp (kritis), assessments (kritis), studentGroups (non-kritis), roster (kritis); mengisi `_loadError` jika ada yang gagal |
| `kktpStatColor(nilai, rentang)` | `classroom-assessment.js:219` | SB atau BSH → `var(--success)` (hijau); MB atau BB → `#c0392b` (merah) — ambang ketercapaian de facto = BSH |
| `collectRentang()` / `buildRentangRowsHtml()` | `classroom-assessment.js:237` / 224 | Kumpulkan dan render input rentang 4 predikat |
| `downloadPenilaianExcel` | `classroom-assessment.js` (dikaitkan di `renderMain`) | Unduh Excel penilaian; dinonaktifkan bila `_loadError` ada |
| `toast(msg, ok)` | `classroom-assessment.js:131` | Notifikasi fixed-bottom 2.800 ms; warna hijau (ok=true) atau merah |
| `window.api` | `guru/js/api.js` | Objek singleton semua RPC; lihat §1.3 |

### 1.3 RPC & Edge Function

Semua akses DB dilakukan via `window.api` (Supabase JS client langsung, bukan PostgreSQL RPC function). Tidak ada Edge Function di MiClass untuk fitur penilaian.

| Method | Tabel | Keterangan |
|---|---|---|
| `api.getTpKktp(classroomId, teacherId)` | `tp_kktp` | Select semua CP/TP/KKTP classroom |
| `api.createTpKktp(classroomId, teacherId, payload)` | `tp_kktp` | Insert TP/KKTP baru |
| `api.updateTpKktp(id, payload)` | `tp_kktp` | Update entri |
| `api.deleteTpKktp(id)` | `tp_kktp` | Delete entri (CASCADE ke grade_recap via FK) |
| `api.getAssessments(classroomId)` | `assessments` | Select semua penilaian beserta join `tp_kktp!tp_kktp_id(judul, tipe)` |
| `api.getAssessmentResults(assessmentId)` | `assessment_results` | Select hasil per penilaian |
| `api.upsertAssessmentResult(...)` | `assessment_results` | Upsert hasil per siswa (UNIQUE assessment_id+student_id) |
| `api.getStudentGroups(classroomId)` | `student_groups` | Select grup diferensiasi |
| `api.getGradeRecap(classroomId, semester, tahunAjaran)` | `grade_recap` | Select rekap semester |
| `api.upsertGradeRecap(classroomId, studentId, tpKktpId, semester, tahunAjaran, payload)` | `grade_recap` | Upsert rekap per siswa |
| `client.from('grade_recap').delete()...` (langsung) | `grade_recap` | Dipakai `hapusRekapTp` — tidak via `window.api` karena tidak ada method hapus di api.js |

### 1.4 Tabel Supabase (ref: `teccdzetrdjowqemnuuc`)

| Tabel | Kolom Kunci | Catatan |
|---|---|---|
| `tp_kktp` | `id, classroom_id, teacher_id, tipe (CP/TP/KKTP), judul, konten, parent_id (self-ref), rentang JSONB, academic_year, semester, mapel, is_visible_siswa, is_visible_ortu, urutan` | Satu tabel untuk CP+TP+KKTP via self-referential parent_id |
| `assessments` | `id, classroom_id, teacher_id, tp_kktp_id, jenis (DIAGNOSTIK/FORMATIF/SUMATIF), teknik, instrumen, tujuan, refleksi_guru, is_visible_siswa, is_visible_ortu, created_at` | Kolom `is_visible_siswa/is_visible_ortu` ditambahkan 20260820; `TES_LISAN` ditambahkan di teknik setelah migration awal |
| `assessment_results` | `id, assessment_id, classroom_id, teacher_id, student_id, status, catatan, umpan_balik, grup_diferensiasi, nilai NUMERIC, kktp_tercapai, tindak_lanjut, UNIQUE(assessment_id, student_id)` | Constraint `assessment_results_nilai_range CHECK (nilai IS NULL OR nilai BETWEEN 0 AND 100)` ditambahkan 20260821 |
| `student_groups` | `id, classroom_id, student_id, grup (A/B/C), UNIQUE(classroom_id, student_id)` | Grup diferensiasi persisten |
| `grade_recap` | `id, classroom_id, student_id, tp_kktp_id, nilai_akhir NUMERIC, kktp_tercapai BOOLEAN, deskripsi_capaian, semester, tahun_ajaran, UNIQUE(classroom_id, student_id, tp_kktp_id, semester, tahun_ajaran)` | Constraint `grade_recap_nilai_akhir_range` ditambahkan 20260821 |
| `classroom_roster` | `id, classroom_id, full_name` | Sumber daftar siswa di Tab Penilaian; ordered by full_name |

---

## 2. User Flow MiClass Tab Penilaian

Rekonstruksi step-by-step dari kode aktual di `classroom-assessment.js`.

### 2.1 Inisialisasi

1. Guru klik tab "Penilaian" di halaman classroom (`classroom.js` memanggil `initAssessmentTab(cId, tId)`).
2. State di-reset: `_selMapel=null`, `_rcSemester=DEFAULT_SEMESTER`, `_rcTahun=DEFAULT_YEAR`, semua pagination ke 0.
3. `DEFAULT_SEMESTER` dan `DEFAULT_YEAR` dihitung dari `new Date().getMonth()`:
   - Bulan ≥ Juli (index 6) → Semester 1, tahun `CY/CY+1`.
   - Bulan < Juli → Semester 2, tahun `(CY-1)/CY`.
4. Panel diisi teks "Memuat data penilaian…".
5. `loadAll()` dipanggil dengan `Promise.all` empat sumber:
   - `getTpKktp` — **kritis**
   - `getAssessments` — **kritis**
   - `getStudentGroups` — non-kritis (gagal hanya dicatat ke console)
   - `loadRoster()` dari `classroom_roster` — **kritis**
6. Jika ada sumber kritis gagal: `_loadError` diisi daftar nama sumber. Unduh Excel dan Simpan Rekap dinonaktifkan. Tombol "↻ Muat ulang" ditampilkan.

### 2.2 Render Utama

7. `renderMain()` mencetak tiga panel collapse:
   - **Perencanaan Penilaian** → default `display:''` (terbuka)
   - **Pelaksanaan Penilaian** → default `display:none`
   - **Rekap Penilaian** → default `display:none`
8. Event delegation satu handler `handleClick` di root `panel-penilaian`.
9. Klik header → single-expand: tutup semua, buka yang diklik. Rekap: trigger `renderRecap()` saat pertama dibuka.

### 2.3 Section 1 — Perencanaan Penilaian

10. Daftar root TP/KKTP: semua row `tp_kktp` di mana `parent_id IS NULL`.
11. Setiap root TP memiliki children KKTP (row di mana `parent_id === tp.id`) yang ditampilkan indented.
12. Klik header TP → single-expand body yang berisi deskripsi konten + KKTP children.
13. Tombol "+ Tambah TP/KKTP" → `openTpModal(null)`:
    - Field: Tipe (CP/TP/KKTP), Judul/Deskripsi, Konten, TP Induk (hanya KKTP), Rentang predikat BB/MB/BSH/SB (hanya KKTP), Tahun Ajaran, Semester, is_visible_siswa, is_visible_ortu.
    - Validasi frontend: judul wajib (kecuali CP), KKTP harus ada TP induk, rentang: tidak NaN, dalam [0,100], tidak overlap antar predikat.
    - `_nilaiSedangDisimpan = true` → tombol disable → await `createTpKktp` / `updateTpKktp` → toast sukses / tampil error → `finally: _nilaiSedangDisimpan = false`.
    - Hapus TP: hitung rekap dulu via `hitungRekapTp`, tampilkan konfirmasi dengan jumlah rekap yang ikut terhapus.

### 2.4 Section 2 — Pelaksanaan Penilaian

14. Penilaian dikelompokkan per jenis: DIAGNOSTIK → FORMATIF → SUMATIF.
15. Tombol "Edit" penilaian → `openAsmtModal(editId)`:
    - Load `getAssessmentResults(editId)` untuk prefill nilai.
    - Render form: Tujuan, TP yang dinilai, Jenis, Teknik, Instrumen, Instrumen-body, [Catat Nilai jika SUMATIF], Refleksi, is_visible_siswa/ortu.
    - **Instrumen-body** (non-SUMATIF): render input sesuai teknik+instrumen (siswa dipilih per kategori/predikat sebagai chip).
    - **Catat Nilai (SUMATIF)**: siswa dirender sebagai nama-button; paginasi via `asmt-sum-prev/next` dengan dots indicator; satu siswa aktif pada satu waktu.
      - Input: jika TES atau teknik kosong → input angka 0–100; sinon → chip predikat SB/BSH/MB/BB, nilai auto-dihitung sebagai `nilaiTengah(predikat, rentang)`.
      - Tindak lanjut: chip PENGAYAAN / PENGUATAN / PENDAMPINGAN.
      - Ganti siswa aktif → `flushSumActive()` menyimpan nilai ke `_sumNilai` sebelum switch.
16. Simpan penilaian:
    - `_nilaiSedangDisimpan = true`, tombol disable.
    - Upsert `assessments` (create atau update).
    - Untuk SUMATIF: iterate `_sumNilai`, upsert `assessment_results` per siswa yang punya nilai.
    - `hapusRekapTp(tp_kktp_id)` dipanggil untuk membersihkan rekap yang mungkin basi.
    - `closeModal(modalToken)` — hanya tutup bila `_modalId` masih cocok.
    - `finally: _nilaiSedangDisimpan = false`.

### 2.5 Section 3 — Rekap Penilaian

17. Lazy-load: dipanggil saat section dibuka pertama kali via `renderRecap()`.
18. Filter aktif: Jenis (default: SUMATIF), Semester, Tahun Ajaran, Teknik, Instrumen.
19. **Daftar Nilai** (tabel 1): menampilkan nilai per penilaian per siswa. Paginasi `_rcPage1`, 5 baris per halaman (`RC_PAGE_SIZE = 5`).
20. **Hasil Nilai** (tabel 2, hanya SUMATIF): menampilkan nilai akhir + predikat + KKTP. Paginasi `_rcPage2`, 5 baris per halaman.
21. Metode nilai akhir: rata-rata / bobot (input bobot per penilaian) / nilai terbaik.
22. **KKTP**: `getPredikat(nilai, rentang)` — loop `PREDIKAT_ORDER = ['BB','MB','BSH','SB']` dari index 3 ke 0 (SB pertama), return predikat pertama di mana `nilai >= rentang[p][0]`. Tidak ada masalah gap rentang.
23. Warna KKTP: SB atau BSH → hijau (`var(--success)`); MB atau BB → merah. Threshold ketercapaian de facto = BSH.
24. Rekap Formatif: paginasi `_rcPageF`. Rekap Diagnostik: paginasi `_rcPageD`.
25. Tombol "Simpan Rekap" → `upsertGradeRecap` per siswa, scope ke classroom+TP+semester+tahun. Dinonaktifkan bila `_loadError`.

### 2.6 Edge Cases yang Sudah Di-handle

- Gagal load parsial: panel error dengan daftar sumber gagal dan tombol reload.
- Double-submit: `_nilaiSedangDisimpan` + tombol disable.
- Menutup modal di tengah simpan: klik latar dan tombol ×/Batal dicek terhadap `_nilaiSedangDisimpan`.
- Modal ganda (race condition): `_modalId` token.
- Nilai null/NaN: `getPredikat` mengembalikan `PREDIKAT_ORDER[0]` (BB) jika semua gagal; `kktpStatText` mengembalikan 'KKTP —' bila nilai null.
- Rentang KKTP overlap: ditolak `validasiRentang`.
- KKTP yatim (tanpa TP induk): ditolak modal TP.
- Rekap basi: `hapusRekapTp` dipanggil saat nilai diperbarui.
- Rekap tersimpan saat TP dihapus: pesan konfirmasi menyebut jumlah rekap.
- Nilai di luar [0,100]: constraint DB `assessment_results_nilai_range` menolaknya.

---

## 3. Inventarisasi SIP SMK Sub-Tab Penilaian (as-is)

### 3.1 File UI & Komponen

| File | Peran |
|---|---|
| `guru/js/penilaian.js` | Modul ES (≈1.800 baris) dengan `import` dari `./api.js`; tiga section collapse (Perencanaan / Pelaksanaan / Rekap Nilai) via DOM innerHTML; tidak ada dedicated .html |
| Halaman guru utama | Render container section `#pen-perencanaan-body`, `#pen-pelaksanaan-body`, `#pen-rekap-body` |

Satu fungsi `injectStyles()` menyuntikkan seluruh CSS melalui `<style id="pen-styles">` ke `<head>`.

### 3.2 File Fungsi / Helper / Utils

| Simbol / Fungsi | Lokasi | Keterangan |
|---|---|---|
| `flushSumActive()` | `penilaian.js:976` | Simpan nilai siswa aktif ke `_sumNilai` sebelum switch |
| `kktpPredikat(nilai)` | `penilaian.js:1626` | Iterasi SB→BB, cek `nilai >= range[0] && nilai <= range[1]` — **BUG**: nilai di celah antara rentang tidak cocok ke predikat mana pun, return `null` |
| `nilaiTengah(pred, rent)` | `penilaian.js:962` | Identik dengan MiClass |
| `extractLabelSiswa(konten, teknik, instrumen)` | `penilaian.js:1448` | Balik peta instrumen-centric JSONB ke `{ student_id: label }` untuk rekap non-SUMATIF |
| `renderBodyInstrumen / wireBodyInstrumen / collectBodyInstrumen` | `penilaian.js:630/703/772` | Render, event, dan collect data isi penilaian non-SUMATIF |
| `prefillBodyInstrumen` | `penilaian.js:854` | Prefill form edit penilaian dari konten JSONB |
| `renderPerencanaan / renderPelaksanaan / renderRecap` | `penilaian.js:460/1389/1439` | Render tiap section |
| `openAsmtModal(editAsmt)` | `penilaian.js:1171` | Modal penilaian — tidak ada `_nilaiSedangDisimpan`; hanya `btn.disabled=true` |
| `openModal({ title, bodyHtml, onSave, wide })` | `penilaian.js:221` | Helper modal generik; error tampil di footer modal |
| `renderSumPage(container)` | `penilaian.js:1117` | Render daftar nama siswa dengan paginasi `SUM_PAGE_SIZE=8` per halaman |
| `ensureUser()` | `penilaian.js:95` | Lazy init `_schoolId`, `_teacherId` via `getCurrentUserRow()` |
| `getCpForSubject` | `api.js` via RPC | Fetch CP nasional via `fn_get_cp_for_subject` |

### 3.3 RPC & Edge Function

| Fungsi / RPC | Jenis | Tabel | Keterangan |
|---|---|---|---|
| `fn_get_cp_for_subject(subject_id, program_code, grade_level)` | PostgreSQL FUNCTION SECURITY DEFINER | `core.subject_name_mapping`, `core.cp_elements`, `core.cp_phases` | Cascade matching mapel lokal → CP nasional (HIGH/MEDIUM/LOW confidence) |
| `getTps(kelasId, subjectId, year, semester)` | Supabase query | `learning_objectives` | Filter class+subject+year+semester |
| `getKktps(learningObjectiveId)` | Supabase query | `assessment_criteria` | Select KKTP per TP |
| `getAssessments(schoolId, kelasId, subjectId, year, semester)` | Supabase query | `assessments` | Filter 5 kolom; include `konten` JSONB |
| `getAssessmentResults(asmtId)` | Supabase query | `assessment_results` (atau `student_grades`?) | Baca nilai per siswa per assessment |
| `upsertAssessmentResult(schoolId, kelasId, asmtId, sid, payload)` | Supabase upsert | `assessment_results` | Upsert per siswa per assessment |
| `upsertGradeRecapBatch(schoolId, classId, loId, semester, year, rows)` | Supabase upsert | `grade_recap` | Batch upsert rekap; semua row atau tidak sama sekali |

### 3.4 Tabel Supabase (ref: `xovvuuwexoweoqyltepq`)

| Tabel | Kolom Kunci | Catatan |
|---|---|---|
| `learning_objectives` | `id, school_id, teacher_id, class_id, subject_id, academic_year, semester, kode_tp, deskripsi_tp, urutan, element_id (FK ke core.cp_elements)` | TP saja; KKTP di tabel terpisah |
| `assessment_criteria` | `id, learning_objective_id, school_id, teacher_id, keterangan, rentang JSONB, batas_bawah, batas_atas, urutan` | KKTP; constraint: 1 TP = 1 KKTP (dibuat di UI) |
| `assessments` | `id, school_id, teacher_id, class_id, subject_id, academic_year, semester, judul, jenis (DIAGNOSTIK_NK/DIAGNOSTIK_K/FORMATIF/SUMATIF), teknik, tanggal DATE, tujuan, konten JSONB, refleksi_guru, is_visible_siswa, is_visible_ortu, is_published, learning_objective_id (loose ref)` | Kolom `konten` menyimpan seluruh data instrumen non-SUMATIF |
| `student_grades` | `id, assessment_id, student_id, school_id, teacher_id, judul, nilai_angka NUMERIC(5,2), deskripsi, tindak_lanjut, is_published` | Nilai per siswa per assessment (SUMATIF) |
| `assessment_rubric_criteria` | `id, assessment_id, school_id, teacher_id, nama, bobot NUMERIC(5,2), deskripsi_level JSONB, urutan` | Kriteria rubrik terstruktur |
| `assessment_rubric_results` | `id, criteria_id, assessment_id, student_id, school_id, teacher_id, level_dipilih, skor_hasil NUMERIC(5,2), UNIQUE(criteria_id, student_id)` | Hasil rubrik per kriteria per siswa |
| `grade_recap` | `id, school_id, class_id, student_id, learning_objective_id, nilai_akhir, kktp_tercapai, deskripsi_capaian, semester, academic_year, UNIQUE(school_id, class_id, student_id, learning_objective_id, semester, academic_year)` | Rekap final per TP per siswa |
| `student_groups` | Sesuai pola MiClass | Grup diferensiasi |

---

## 4. Gap Analysis

| Fitur / Komponen | MiClass | SIP SMK (as-is) | Klasifikasi | Catatan |
|---|---|---|---|---|
| **KKTP: ambang ketercapaian** | `kktpStatColor`: SB atau BSH = hijau — threshold BSH | `kktp_tercapai: pred !== 'BB'` — threshold MB (salah) | **FIX-FIRST** | Ubah ke `pred === 'SB' \|\| pred === 'BSH'` |
| **KKTP: pencocokan rentang eksklusif** | `getPredikat`: `nilai >= batas_bawah` — tidak bisa jatuh di celah | `kktpPredikat`: `nilai >= range[0] && nilai <= range[1]` — nilai desimal di celah return `null` | **FIX-FIRST** | Ganti ke pendekatan MiClass: loop SB→BB, return pertama `nilai >= batas_bawah` |
| **Re-entrancy guard simpan** | `_nilaiSedangDisimpan` + `_modalId` — guard berlapis | Hanya `btn.disabled=true` | **ADOPT** | Port `_nilaiSedangDisimpan` + token modal |
| **Paginasi rekap (Section 3)** | `RC_PAGE_SIZE = 5` per halaman | Tidak ada — semua siswa sekaligus | **ADOPT** | Tambahkan paginasi rekap |
| **Paginasi Sumatif input** | 8 nama per halaman | 8 nama per halaman (`SUM_PAGE_SIZE=8`) | IDENTIK | Tidak perlu perubahan |
| **Tiga section collapse** | Perencanaan / Pelaksanaan / Rekap | Perencanaan / Pelaksanaan / Rekap | IDENTIK | Tidak perlu perubahan |
| **Jenis penilaian** | 3 jenis: DIAGNOSTIK / FORMATIF / SUMATIF | 4 jenis: DIAGNOSTIK_NK / DIAGNOSTIK_K / FORMATIF / SUMATIF | **ADAPT** | Rekap harus mengakomodasi 4 jenis |
| **Struktur TP/KKTP** | Satu tabel `tp_kktp` dengan self-referential `parent_id` | Dua tabel: `learning_objectives` + `assessment_criteria` | **ADAPT** | UI logic harus load dari dua query |
| **Integrasi CP Nasional** | Tidak ada | Via `fn_get_cp_for_subject` + `core.cp_elements` | **SKIP** | SIP SMK lebih unggul; tidak perlu diadopsi ke MiClass |
| **Hapus rekap saat nilai berubah** | `hapusRekapTp()` dipanggil setelah upsert results | Tidak ada — rekap bisa basi | **ADOPT** | Port `hapusRekapTp` ke SIP SMK |
| **Error handling load parsial** | Panel error + daftar sumber gagal + tombol reload | Pesan error sederhana | **ADOPT** | Port pola `_loadError` + tombol retry |
| **Visibilitas per penilaian** | `is_visible_siswa` + `is_visible_ortu` | `is_visible_siswa` + `is_visible_ortu` | IDENTIK | Sudah ada di kedua repo |
| **Simpan rekap batch** | Upsert satu per satu per siswa | `upsertGradeRecapBatch` — batch sekaligus | **ADAPT** | SIP SMK lebih efisien |
| **Unduh Excel** | Ada | Tidak ada | **SKIP** | Kebutuhan berbeda per produk |
| **Tanggal penilaian** | Tidak ada | `tanggal DATE` wajib | **SKIP** | SIP SMK-specific |
| **Rubrik terstruktur** | Rubrik sebagai JSONB di `konten` | Tabel `assessment_rubric_criteria` + `assessment_rubric_results` | **SKIP** | SIP SMK-specific |
| **Constraint nilai DB** | `CHECK (nilai IS NULL OR nilai BETWEEN 0 AND 100)` di `assessment_results` dan `grade_recap` | Belum ada di `student_grades` | **ADOPT** | Tambahkan CHECK constraint |
| **Konfirmasi hapus TP dengan jumlah rekap** | Hitung dan sebut jumlah rekap yang ikut terhapus | Pesan generik tanpa jumlah | **ADOPT** | UX yang lebih aman |
| **Dropdown mapel (multi-mapel)** | Hanya untuk WALI_KELAS_SD | Tidak relevan (guru mapel fix per kelas di SMK) | **SKIP** | Konteks SD vs SMK berbeda |

---

## 5. RPC & Tabel Mapping

| Fungsi / Method MiClass | Tabel MiClass | Padanan di SIP SMK | Tabel SIP SMK | Status |
|---|---|---|---|---|
| `api.getTpKktp(classroomId, teacherId)` | `tp_kktp` | `getTps(kelasId, subjectId, year, semester)` + `getKktps(tpId)` | `learning_objectives` + `assessment_criteria` | ADAPT — dua call terpisah |
| `api.createTpKktp` | `tp_kktp` | `createTp` / `createKktp` | `learning_objectives` / `assessment_criteria` | ADAPT |
| `api.updateTpKktp` | `tp_kktp` | `updateTp` / `updateKktp` | `learning_objectives` / `assessment_criteria` | ADAPT |
| `api.deleteTpKktp` | `tp_kktp` | `deleteTp` / `deleteKktp` | `learning_objectives` / `assessment_criteria` | ADAPT |
| `api.getAssessments(classroomId)` | `assessments` | `getAssessments(schoolId, kelasId, subjectId, year, semester)` | `assessments` | ADAPT — tambah school_id, subject_id |
| `api.getAssessmentResults(asmtId)` | `assessment_results` | `getAssessmentResults(asmtId)` | `assessment_results` (atau `student_grades`?) | ADOPT — verifikasi nama tabel aktual |
| `api.upsertAssessmentResult(...)` | `assessment_results` | `upsertAssessmentResult(schoolId, kelasId, asmtId, sid, payload)` | `assessment_results` | ADAPT — tambah schoolId |
| `api.getStudentGroups(classroomId)` | `student_groups` | `getStudentGroups(schoolId, kelasId)` | `student_groups` | ADAPT — tambah schoolId |
| `api.upsertGradeRecap(...)` | `grade_recap` (`classroom_id`, `tp_kktp_id`, `tahun_ajaran`) | `upsertGradeRecapBatch(schoolId, classId, loId, semester, year, rows)` | `grade_recap` (`school_id`, `class_id`, `learning_objective_id`, `academic_year`) | ADAPT — mapping FK + field name berbeda |
| `client.from('grade_recap').delete()` | `grade_recap` | Tidak ada (belum diimplementasi) | `grade_recap` | ADOPT — implementasi `hapusRekapTp` |
| `hitungRekapTp(tpKktpId)` | `grade_recap` | Tidak ada | — | ADOPT |
| *(tidak ada)* | — | `fn_get_cp_for_subject(...)` | `core.subject_name_mapping`, `core.cp_elements` | SIP SMK-only |

---

## 6. Backlog Implementasi Terurut

Urutan: FIX-FIRST → ADOPT (schema/backend dulu, UI belakangan) → ADAPT.

| # | Item | Kompleksitas | Dependency | File Terdampak |
|---|---|---|---|---|
| 1 | **FIX: Ambang KKTP — ubah `pred !== 'BB'` ke `pred === 'SB' \|\| pred === 'BSH'`** | S | — | `guru/js/penilaian.js:1703` |
| 2 | **FIX: Logika rentang eksklusif — ganti `nilai >= r[0] && nilai <= r[1]` ke `nilai >= batas_bawah` (pendekatan MiClass)** | S | — | `guru/js/penilaian.js:1626–1636` |
| 3 | **ADOPT: Constraint DB nilai 0–100 di `student_grades` dan `grade_recap`** | S | — | Migration baru di `supabase/migrations/` |
| 4 | **ADOPT: Implementasi `hapusRekapTp` di SIP SMK** — hapus rekap scope class+TP+semester+year saat nilai diperbarui | M | #3 | `guru/js/api.js`, `guru/js/penilaian.js` (openAsmtModal save path) |
| 5 | **ADOPT: Re-entrancy guard `_nilaiSedangDisimpan` + modal token** | M | — | `guru/js/penilaian.js` (openAsmtModal, openKktpModal, openTpModal) |
| 6 | **ADOPT: Error handling load parsial** — `_loadError` pattern + tombol reload | M | — | `guru/js/penilaian.js` (renderPelaksanaan, renderPerencanaan) |
| 7 | **ADOPT: Konfirmasi hapus TP dengan jumlah rekap** — hitung dulu, sebutkan di dialog | S | #4 | `guru/js/penilaian.js` (confirmDeleteTp) |
| 8 | **ADOPT: Paginasi rekap (Section 3)** — tambah `RC_PAGE_SIZE=5` dan prev/next di `_renderRecapContent` | M | — | `guru/js/penilaian.js` |
| 9 | **ADAPT: Verifikasi konsistensi jenis penilaian** — `DIAGNOSTIK_NK` dan `DIAGNOSTIK_K` terdokumentasi dan konsisten di CHECK constraint DB | S | — | Migration, `guru/js/penilaian.js`, `guru/js/api.js` |
| 10 | **ADAPT: Selaraskan tabel nilai siswa** — verifikasi apakah `assessment_results` atau `student_grades` yang dipakai; pastikan RLS lengkap | L | — | `supabase/migrations/`, `guru/js/api.js` |

---

## 7. Catatan Arsitektur

### 7.1 Identitas Entitas Berbeda Fundamental

MiClass menggunakan `classroom_id` sebagai satu-satunya kunci konteks (classroom = guru + kelas + mapel + sekolah dalam satu entitas). SIP SMK memisah: `school_id + class_id + subject_id + teacher_id`. **Setiap adaptasi fungsi MiClass harus menambahkan `school_id` dan `subject_id` ke parameter dan RLS policy.**

### 7.2 Struktur TP/KKTP Berbeda

**MiClass**: satu tabel `tp_kktp` dengan `parent_id` self-referential dan kolom `tipe` (CP/TP/KKTP). Satu query cukup untuk load seluruh hierarki.

**SIP SMK**: dua tabel terpisah `learning_objectives` (TP) dan `assessment_criteria` (KKTP). Load hierarki memerlukan dua query berurutan atau query dengan join. Constraint "1 TP = 1 KKTP" ada di UI (tombol tambah KKTP disembunyikan), bukan di DB.

### 7.3 Penyimpanan Data Non-SUMATIF Berbeda

**MiClass**: simpan hasil per baris di `assessment_results` dengan kolom `status`, `catatan`, `grup_diferensiasi`.

**SIP SMK**: seluruh data non-SUMATIF disimpan sebagai JSONB di `assessments.konten` (instrumen-centric). `extractLabelSiswa()` membalik peta ini saat rekap. Tidak ada query per-siswa untuk nilai non-SUMATIF.

Saat adaptasi: pertimbangkan row-per-siswa (seperti MiClass) untuk kemudahan query rekap, vs JSONB instrumen-centric untuk fleksibilitas instrumen kompleks.

### 7.4 Dua Bug KKTP — Wajib Diperbaiki Sebelum Apapun

**Bug #1 — Ambang ketercapaian salah**: `pred !== 'BB'` mengklaim MB = tercapai. Ini salah secara pedagogis; guru akan melihat siswa MB dilaporkan "KKTP tercapai". Perbaiki ke `pred === 'SB' || pred === 'BSH'` **sebelum data rekap manapun tersimpan**.

**Bug #2 — Batas rentang eksklusif**: `nilai >= range[0] && nilai <= range[1]` akan gagal mengklasifikasikan nilai desimal yang jatuh di gap antar rentang (contoh: nilai=54.5 bila BB=[0,54] dan MB=[55,69] → return `null`). MiClass menghindari ini dengan hanya mengecek `nilai >= batas_bawah`. Perbaiki **sebelum sekolah menginput nilai nyata**.

### 7.5 Grade Recap Unique Key Berbeda

**MiClass**: `UNIQUE(classroom_id, student_id, tp_kktp_id, semester, tahun_ajaran)`.

**SIP SMK**: `UNIQUE(school_id, class_id, student_id, learning_objective_id, semester, academic_year)`. Upsert harus menyertakan semua 6 kolom konflik.

### 7.6 Tidak Ada Guard Re-entrancy di SIP SMK

MiClass memiliki dua lapisan proteksi double-submit: `_nilaiSedangDisimpan` (module-level boolean) dan `_modalId` (token per instance modal). SIP SMK hanya mengandalkan `btn.disabled = true` — tidak melindungi dari jalur trigger lain (shortcut keyboard, pemanggilan programatik). Harus di-adopt sebelum tombol simpan di-reuse dari jalur lain.

### 7.7 Rekap SIP SMK Tidak Ada Paginasi

Di kelas besar (30+ siswa), `_renderRecapContent` merender semua baris ke DOM sekaligus tanpa batching. Ini bisa menyebabkan freeze UI. Paginasi MiClass (`RC_PAGE_SIZE=5`) **wajib diadopsi**.

---

*Dokumen ini dibuat dari investigasi kode aktual. Tidak ada file di kedua repo yang diubah pada tahap ini.*
