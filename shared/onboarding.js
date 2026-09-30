/**
 * @file shared/onboarding.js
 *
 * Password onboarding tunggal untuk SELURUH peran pengguna.
 * Kembaran sisi klien dari supabase/functions/_shared/onboarding.ts —
 * nilainya harus sama persis. Kalau salah satu diubah, ubah keduanya.
 *
 * Dua runtime berbeda (Deno di edge function, browser di portal) tidak bisa
 * berbagi satu berkas, jadi duplikasi ini tidak terhindarkan. Yang bisa
 * dilakukan adalah membuatnya jelas dan hanya ada dua tempat, bukan delapan
 * seperti sebelumnya.
 *
 * SYARAT YANG MENYERTAINYA — JANGAN DILEPAS
 *   Setiap jalur yang menyetel password ini WAJIB memastikan
 *   users.must_change_password = true. Untuk reset dari konsol admin, itu
 *   dilakukan server-side oleh edge function set-user-password.
 */

export const DEFAULT_ONBOARDING_PASSWORD = '12345678';
