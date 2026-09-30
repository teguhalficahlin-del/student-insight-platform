/**
 * @file _shared/onboarding.ts
 *
 * Password onboarding tunggal untuk SELURUH peran pengguna:
 * guru dan staf, siswa, orang tua, DUDI, tata usaha, stakeholder.
 *
 * KENAPA SATU NILAI TETAP, BUKAN ACAK
 *   Sekolah mendistribusikan kredensial secara lisan dan lewat pesan singkat.
 *   Password acak 12 karakter harus dicatat satu per satu oleh admin, lalu
 *   didiktekan ke ratusan orang — dalam praktiknya gagal, dan admin akhirnya
 *   menuliskannya di tempat yang justru tidak aman. Satu nilai yang diketahui
 *   semua orang, dipaksa ganti saat login pertama, lebih jujur soal model
 *   ancamannya dan jauh lebih mungkin benar-benar dijalankan.
 *
 * SYARAT YANG MENYERTAINYA — JANGAN DILEPAS
 *   Setiap jalur yang memakai konstanta ini WAJIB menyetel
 *   users.must_change_password = true. Tanpa itu, akun akan selamanya
 *   memakai password yang diketahui umum. Pasangan ini tidak boleh dipisah.
 *
 * RISIKO YANG DITERIMA
 *   Siapa pun yang tahu identitas login seseorang (NIP, NISN, NIK, kode
 *   stakeholder, nama usaha DUDI) dapat masuk lebih dulu sebelum pemilik
 *   akun sempat login pertama kali. Jendelanya berakhir begitu pemilik akun
 *   login dan mengganti passwordnya. Risiko ini sudah berlaku untuk akun
 *   siswa sejak awal; migration ini menyeragamkan perlakuan, bukan
 *   memperkenalkan kelas risiko baru.
 *
 * SEJARAH
 *   ADM-01 dan ADM-02 sempat mengubah jalur guru/staf dan orang tua menjadi
 *   password acak, sementara jalur siswa tetap '12345678'. Akibatnya platform
 *   punya dua konvensi sekaligus, dan komentar di migration Agustus 2026
 *   masih menyebut must_change_password sebagai penanda "masih memakai
 *   password default '12345678'" — dokumentasi dan kode sudah tidak sejalan.
 *   Berkas ini mengembalikan satu konvensi tunggal.
 *
 * KEMBARANNYA DI SISI KLIEN
 *   shared/onboarding.js — nilai harus sama persis. Kalau salah satu diubah,
 *   ubah keduanya.
 */

export const DEFAULT_ONBOARDING_PASSWORD = '12345678';
