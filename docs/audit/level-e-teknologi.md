# Audit Level E — Teknologi
Tanggal: 24 Juni 2025

Catatan pembuka yang berlaku untuk seluruh audit ini: rancangan kemampuan kerja tanpa internet (offline) untuk platform ini sudah didokumentasikan secara sangat rinci sebagai spesifikasi, tapi **rancangan itu belum dibangun menjadi aplikasi yang benar-benar berjalan di perangkat guru**. Apa yang sudah benar-benar berjalan adalah bagian penerima data di sisi server (proses penyimpanan absensi) dan console admin (yang tidak punya fitur offline sama sekali, karena memang tidak butuh — admin bekerja dari kantor dengan koneksi internet). Bagian yang seharusnya berjalan di perangkat guru saat tidak ada internet — termasuk aplikasi guru itu sendiri — belum ditemukan dalam kode yang ada.

## Audit Offline-First

### Proses yang Harus Bisa Offline

| Proses | Harus Offline? (menurut rancangan awal) | Implementasi Ada? | Status |
|---|---|---|---|
| Guru mencatat absensi siswa | Ya | Ada di sisi server (proses penerima data sudah matang dan teruji), tapi aplikasi di perangkat guru yang seharusnya menyimpan data ini saat offline **belum dibangun** | Belum lengkap |
| Guru mencatat observasi siswa | Ya | Hanya ada rancangan detail (cara penyimpanan, urutan pengiriman saat online kembali), belum ada aplikasi nyata yang menjalankannya | Belum lengkap |
| Guru membuat dan mengisi kasus siswa, menambah komentar | Ya | Sama seperti di atas — hanya rancangan, belum ada aplikasi nyata | Belum lengkap |
| Guru menulis jurnal pribadi | Ya | Sama seperti di atas | Belum lengkap |
| Guru pengganti mencatat absensi untuk sesi yang digantikan | Ya | Sisi server sudah mendukung skenario ini (mengecek izin guru pengganti dan masa berlaku aksesnya), tapi aplikasi guru penggantinya sendiri belum ada | Belum lengkap |
| BK membuat keputusan kasus, mengubah status kasus, menambah catatan tindak lanjut | Ya | Hanya rancangan, belum ada aplikasi nyata | Belum lengkap |
| Wali Kelas, Kaprodi, Kepala Sekolah melihat data yang sudah pernah tersimpan sebelumnya dan membuat keputusan kasus | Ya | Hanya rancangan, belum ada aplikasi nyata | Belum lengkap |
| Siswa melihat data dirinya yang sudah pernah tersimpan sebelumnya | Ya | Hanya rancangan, belum ada aplikasi nyata (dan memang belum ada aplikasi siswa sama sekali, sesuai temuan audit sebelumnya) | Belum lengkap |
| Notifikasi, pesan orang tua, dan dashboard ringkasan terbaru | Tidak — boleh menunggu koneksi kembali | Tidak relevan diperiksa karena memang tidak wajib offline | Sesuai rancangan |

**Kesimpulan bagian ini:** seluruh proses yang menurut rancangan awal wajib bisa dikerjakan tanpa internet, sampai saat ini **tidak satu pun yang benar-benar bisa dijalankan tanpa internet**, karena aplikasi yang menjalankannya di perangkat guru/BK/staf lain belum dibangun. Console admin yang sudah ada memang tidak butuh kemampuan ini (admin bekerja dari kantor), sehingga ini bukan kekurangan pada bagian yang sudah dibangun — tapi ini berarti kebutuhan inti "guru tetap bisa mencatat absensi walau internet sekolah mati" **belum bisa dipenuhi sama sekali oleh sistem yang ada sekarang**.

### Penyimpanan Lokal
Rancangan penyimpanan lokal di perangkat sudah sangat rinci dirancang, mencakup:
- Tempat penyimpanan khusus untuk data yang menunggu dikirim ke server (absensi, observasi, kasus, jurnal yang diisi saat offline).
- Tempat penyimpanan khusus untuk menyimpan salinan data dari server agar bisa dibaca saat offline (jadwal, data siswa, kasus, daftar penugasan mengajar, profil pengguna).
- Setiap salinan data punya batas waktu berlaku sebelum dianggap basi: data jadwal, siswa, penugasan, dan pendaftaran kelas dirancang berlaku selama 7 hari; data kasus dan observasi dirancang berlaku lebih pendek, 1 hari, karena sifatnya lebih cepat berubah.
- Jika tempat penyimpanan di perangkat penuh atau hampir penuh (di atas 80% kapasitas), rancangannya adalah membersihkan dulu data salinan yang sudah basi sebelum mengambil data baru. Antrian data yang menunggu dikirim dibatasi maksimal 500 item — jika penuh, item yang sudah gagal terkirim paling lama akan disingkirkan dulu untuk memberi ruang bagi data baru.
- Data yang gagal terkirim berulang kali (setelah 5 kali percobaan menurut rancangan) tidak dihapus begitu saja — dipindahkan ke tempat penyimpanan khusus untuk ditelusuri kemudian, dengan batas maksimal 100 item sebelum perlu dibersihkan manual.

**Catatan penting:** seluruh penjelasan di atas adalah rancangan tertulis, bukan sesuatu yang sudah benar-benar berjalan di perangkat mana pun saat ini — karena aplikasi yang memakai rancangan penyimpanan ini belum dibangun.

### Ketahanan Data

| Skenario | Ditangani? | Catatan |
|---|---|---|
| Browser/aplikasi ditutup saat offline, padahal ada data yang sudah diinput tapi belum terkirim | Dirancang untuk aman (data tersimpan permanen di perangkat, bukan hanya di memori sementara, sehingga tidak hilang saat aplikasi ditutup) | Belum bisa dipastikan benar-benar aman karena belum ada aplikasi nyata yang bisa diuji langsung |
| Mekanisme pemulihan jika ada gangguan di tengah proses penyimpanan/pengiriman data | Dirancang ada (item yang macet di tengah proses akan otomatis dikembalikan ke status menunggu setelah waktu tertentu, lalu dicoba lagi) | Sama seperti di atas — rancangan ada, belum teruji di aplikasi nyata |

### Skenario Uji

1. **Internet mati saat input absensi** — *Tidak bisa diuji dari kode yang ada*, karena tidak ada aplikasi guru yang berjalan untuk mengetes skenario ini secara nyata. Rancangannya sudah mengantisipasi ini (data tersimpan lokal dulu, dikirim nanti), tapi ini murni rancangan di atas kertas (dan dalam bentuk file rujukan kode yang belum dipakai aplikasi mana pun), bukan sesuatu yang sudah dibuktikan bekerja.
2. **Refresh halaman saat offline** — *Tidak bisa diuji*, dengan alasan yang sama: tidak ada aplikasi operasional (selain console admin, yang tidak relevan untuk skenario ini karena admin selalu online).
3. **Perangkat dimatikan/di-restart saat ada data yang masih menunggu terkirim** — *Tidak bisa diuji*, sama seperti di atas. Rancangan menyebutkan penyimpanan bersifat permanen (bukan sementara di memori), yang seharusnya tahan terhadap perangkat dimatikan, tapi ini belum bisa dibuktikan karena belum ada aplikasi nyata untuk dicoba.
4. **Koneksi kembali setelah lama offline** — *Tidak bisa diuji* di sisi aplikasi guru (belum ada), namun di sisi server, proses penerima data absensi sudah benar-benar dibangun dan sudah mengantisipasi pengiriman berulang dengan aman (dijelaskan di bagian Sinkronisasi di bawah). Jadi separuh dari skenario ini (sisi server) sudah siap, separuh lainnya (sisi aplikasi guru yang mengirim) belum ada.

## Audit Sinkronisasi

### Konflik Data
**Untuk absensi siswa secara khusus: CLEAR — sudah ditangani dengan baik di sisi server.** Proses penyimpanan absensi mengunci satu sesi pelajaran tertentu saat sedang diproses, sehingga dua pengiriman data yang bersamaan untuk sesi yang sama akan diproses satu per satu, bukan tabrakan. Jika ada dua catatan kehadiran berbeda untuk siswa yang sama di sesi yang sama, **catatan yang diproses paling akhir akan menggantikan catatan sebelumnya** — kecuali catatan sebelumnya sudah dibatalkan secara resmi, yang dalam hal itu catatan baru tidak akan menimpa pembatalan tersebut.

**Untuk proses lain (observasi, kasus, jurnal): rancangan ada secara umum, tapi penanganan konflik detail untuk masing-masing belum bisa diverifikasi** karena belum ada aplikasi nyata dan belum ada proses penerima data di server seperti yang sudah ada untuk absensi (saat ini hanya absensi yang punya proses penerima data khusus di server).

### Duplikasi Event
CLEAR untuk absensi — sudah ditangani dengan baik. Setiap pengiriman data diberi tanda pengenal unik. Jika tanda pengenal yang sama dikirim dua kali (misalnya karena aplikasi guru mengirim ulang tanpa sadar setelah koneksi putus-sambung), server akan mengenali bahwa data ini sudah pernah diproses sebelumnya dan mengembalikan hasil yang sama tanpa memprosesnya dua kali — jadi tidak akan ada data ganda meskipun pengiriman yang sama terjadi berkali-kali.

### Merge Strategy
Untuk absensi: strategi penggabungan data sudah jelas dan sudah diimplementasikan — data terbaru menang, kecuali ada pembatalan resmi yang mengunci catatan tersebut. Tidak ditemukan potensi data hilang dalam proses ini untuk absensi.

Untuk proses lain (observasi, kasus, jurnal): rancangan umum menyebutkan urutan prioritas pengiriman saat koneksi kembali (absensi paling diutamakan, lalu kasus, observasi, dan jurnal paling akhir), tapi belum ada proses penerima data yang benar-benar dibangun untuk selain absensi, sehingga belum bisa dipastikan apakah strategi penggabungannya akan benar-benar berjalan tanpa kehilangan data saat sungguhan diimplementasikan.

### Recovery
CLEAR untuk absensi dari sisi server — jika terjadi gangguan di tengah proses penyimpanan (misalnya sesi yang dituju ternyata tidak valid), seluruh proses akan dibatalkan utuh (tidak ada data yang tersimpan sebagian), sehingga data tidak akan berada dalam keadaan setengah jadi yang membingungkan.

Untuk sisi aplikasi guru (pengiriman ulang otomatis saat koneksi gagal di tengah jalan): rancangannya ada dan cukup matang (percobaan ulang otomatis, deteksi proses yang macet lalu dikembalikan ke status menunggu), tapi karena aplikasi ini belum dibangun, kemampuan pemulihan ini belum bisa dibuktikan benar-benar bekerja di perangkat sungguhan.

## Temuan & Rekomendasi

**HIGH**
- Kebutuhan paling mendasar dari seluruh rancangan ini — guru tetap bisa mencatat absensi dan catatan siswa lain saat internet sekolah mati — **belum bisa dipenuhi sama sekali**, karena aplikasi yang seharusnya berjalan di perangkat guru belum dibangun. Yang sudah siap hanyalah bagian penerima data di sisi server dan rancangan tertulis yang sangat rinci. Rekomendasi: sebelum platform ini diperkenalkan sebagai solusi untuk sekolah dengan koneksi internet tidak stabil, perlu kejelasan rencana dan jadwal pembangunan aplikasi guru yang benar-benar bisa bekerja tanpa internet — jangan menjanjikan kemampuan "bisa dipakai tanpa internet" kepada sekolah sebelum bagian ini ada.
- Karena belum ada aplikasi nyata, seluruh klaim ketahanan data saat perangkat dimatikan mendadak atau koneksi terputus lama **belum pernah benar-benar diuji** di kondisi nyata — hanya berdasarkan rancangan di atas kertas. Rekomendasi: begitu aplikasi guru mulai dibangun, uji langsung keempat skenario ini (mati internet saat mencatat, refresh halaman, perangkat di-restart, koneksi kembali setelah lama offline) sebelum diluncurkan ke sekolah.

**MEDIUM**
- Mekanisme pencegahan duplikasi dan penanganan konflik yang sudah matang dan teruji baru ada untuk absensi siswa. Proses serupa untuk observasi, kasus siswa, dan jurnal guru — yang menurut rancangan sama-sama wajib bisa dicatat tanpa internet — belum punya proses penerima data yang setara di sisi server. Rekomendasi: bangun proses penerima data yang sama untuk observasi dan kasus siswa sebelum aplikasi guru offline mulai dikerjakan, supaya keduanya bisa dikembangkan dan diuji bersamaan.

**LOW**
- Rancangan menyebutkan data yang gagal terkirim berulang kali akan disimpan terpisah untuk ditelusuri, tapi penyimpanan ini tidak akan terhapus otomatis dan butuh pembersihan manual. Belum ada cara bagi admin sekolah untuk melihat atau membersihkan data semacam ini dari jarak jauh jika suatu saat ada laporan dari guru bahwa catatannya "tidak pernah sampai ke sistem". Rekomendasi: saat aplikasi guru offline mulai dibangun, sertakan juga cara bagi admin untuk melihat status pengiriman data yang bermasalah, supaya bisa membantu guru menelusuri data yang hilang.
