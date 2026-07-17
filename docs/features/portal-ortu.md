# Portal Orang Tua

Portal untuk orang tua memantau perkembangan anak di sekolah.
Multi-anak: jika orang tua punya lebih dari satu anak terdaftar,
bisa switch antar anak via selector di bagian atas.

---

## 1. Tab Jadwal Pelajaran

### Toggle Tampilan
- **Hari ini** (default): menampilkan jadwal anak hari ini
- **Minggu ini**: menampilkan jadwal Senin–Jumat minggu berjalan

### Tampilan Accordion
Jadwal ditampilkan sebagai accordion per hari — konsisten dengan portal Siswa.
- Satu accordion = satu hari
- Isi accordion: tabel Jam · Mata Pelajaran · Guru
- Jika tidak ada jadwal → tampil "tidak ada jadwal"
- View Hari ini: accordion terbuka otomatis
- View Minggu ini: accordion hari ini terbuka, hari lain tertutup

### Sumber Data
Data jadwal diambil dari `class_id` anak yang sedang aktif dipilih —
bukan jadwal guru, bukan jadwal pribadi orang tua.
Orang tua melihat jadwal yang sama dengan yang dilihat anak di portal Siswa.

### Fungsi
- `loadSchedule(classId)` — load dan render jadwal hari ini
- `loadWeekSchedule(classId)` — load dan render jadwal minggu ini
- `fetchSchedule(classId, date)` — fetch jadwal satu hari dari DB
- `fetchWeekSchedule(classId)` — fetch 5 hari paralel via fetchSchedule

### Catatan Teknis
- `currentClassId` disimpan di module scope — dipakai saat toggle Hari/Minggu
- Jika anak belum terdaftar di kelas → tampil pesan, tidak ada query ke DB
- Tanggal Senin–Jumat dihitung dari hari ini via offset `getDay()`

---

*Dokumen ini adalah referensi definitif.
Setiap perubahan perilaku fitur harus diupdate di sini sebelum diimplementasi.*
