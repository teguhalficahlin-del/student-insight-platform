# Portal Admin — Referensi Fitur

Portal Admin diakses oleh pengguna dengan role `ADMIN` atau `KEPALA_SEKOLAH`.
Navigasi berbasis panel — satu panel aktif dalam satu waktu, dipilih via sidebar atau bottom nav.

---

## 1. Panel dan Fungsi

| Panel | Fungsi | Async |
|-------|--------|-------|
| Profil & Branding | `renderBrandingPanel()` | ✓ |
| Setup Sekolah | `renderSetupPanel()` | ✓ |
| Program Keahlian | `renderProgramsPanel()` | ✓ |
| Kelas | `renderClassesPanel()` | ✓ |
| Staff | `renderStaffPanel()` | ✓ |
| Siswa | `renderStudentsPanel()` | ✓ |
| Orang Tua | `renderParentsPanel()` | ✓ |
| Alumni | `renderAlumniPanel()` | ✓ |
| DUDI | `renderDudiPanel()` | ✓ |
| Stakeholder | `renderStakeholdersPanel()` | ✓ |
| Jadwal | `renderJadwalPanel()` | ✓ |
| Tahun Akademik | `renderAcademicYearPanel()` | ✓ |
| Log Aktivitas | `renderActivityLogPanel()` | ✓ |
| Export Data | `renderExportPanel()` | ✓ |
| Forum Kelas | `renderForumKelasPanel()` | ✓ |
| Share Portal | `renderSharePortalPanel()` | — |

---

## 2. Panel Profil & Branding

Mengelola identitas sekolah yang ditampilkan di semua portal.

### Field yang Dapat Diedit
| Field | ID Input | Keterangan |
|-------|----------|------------|
| Nama Sekolah | `br-name` | Wajib — tampil di header semua portal |
| NPSN | `br-npsn` | 8 digit |
| Alamat | `br-address` | — |
| Telepon | `br-phone` | format tel |
| URL Logo | `br-logo` | URL publik PNG/JPG, rekomendasi 200×200px |
| Warna Utama | `br-color` + `br-color-picker` | Hex #RRGGBB — tombol dan aksen semua portal |
| Warna Sekunder | `br-color2` + `br-color2-picker` | Opsional — hover dan elemen pendukung |

### Behavior Penting
- Perubahan diterapkan ke semua portal saat halaman di-refresh
- Fungsi: `getSchoolBranding()` untuk fetch, `saveSchoolBranding()` untuk simpan
- **Jika `getSchoolBranding()` gagal saat load:**
  - Flag `brandingLoadFailed = true`
  - Pesan error merah muncul di `#br-msg`: *"Gagal memuat data branding. Silakan refresh halaman sebelum menyimpan."*
  - Tombol `#br-save-btn` otomatis `disabled` — admin tidak bisa menimpa data live dengan field kosong
  - Ini adalah fix CAT-8-B — mencegah admin menyimpan branding kosong akibat fetch gagal

---

## 3. Panel Jadwal

Menampilkan grid jadwal pelajaran per tingkat dan per hari.

### Filter
- **Tingkat** (`#jadwal-grade-tabs`): X / XI / XII — filter kolom kelas
- **Hari** (`#jadwal-day-tabs`): Senin s/d Jumat — filter baris hari

### Behavior Penting
- Grid dirender oleh `buildJadwalGrid(slots, templates, classes, teacherIdMap)`
- Filter dipasang via `?.addEventListener` — jika elemen belum ada di DOM, tidak throw TypeError
- **Jika render grid gagal:** pesan error ditampilkan di `gridArea` dengan warna `--color-danger`
- Ini adalah fix CAT-5-A — optional chaining mencegah crash jika elemen tab belum ada

### Fungsi
- `renderJadwalPanel()` — load data dan render panel
- `loadGrid()` — render ulang grid berdasarkan `activeGrade` dan `activeDay`
- `buildJadwalGrid(slots, templates, classes, teacherIdMap)` — build HTML grid

---

## 4. Export Data

Export data siswa, staff, atau absensi ke format Excel (XLSX).

### Fungsi
- `xlsxExport(headers, rows, sheetName, filename)` — wrapper SheetJS untuk semua export
- `renderExportPanel()` — render panel dengan tombol export per kategori

---

## 5. Catatan Teknis

- Navigasi panel: `navigateToPanel(panelId)` + `syncBottomNav(panel)`
- Password sementara: `generateTempPassword()` + modal `showPwModal(nama, pw)`
- Semua panel async — error di dalam panel tidak propagate ke panel lain
- `SUPABASE_URL`/`SUPABASE_ANON` hardcode di `superadmin/js/dashboard.js` baris 1–2 —
  duplikasi dari `shared/branding.js`, ditandai sebagai technical debt (CAT-2-B),
  perlu konsolidasi ke `shared/config.js` saat refactor.

---

*Dokumen ini adalah referensi definitif portal admin.
Setiap perubahan perilaku fitur harus diupdate di sini sebelum diimplementasi.*
