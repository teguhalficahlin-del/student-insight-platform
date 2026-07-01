/**
 * @file shared/branding.js
 *
 * Fase 3: Branding per sekolah dari database.
 * Dibaca oleh semua portal via: import { applyBranding } from '../shared/branding.js'
 *
 * Slug sekolah diambil dari (urutan prioritas):
 *   1. URL param  ?school=smkhr
 *   2. Subdomain  smkhr.domain.com  (jika bagian host ≥ 3 segmen)
 */

const SUPABASE_URL  = 'https://xovvuuwexoweoqyltepq.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhvdnZ1dXdleG93ZW9xeWx0ZXBxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIyMDk0NzUsImV4cCI6MjA5Nzc4NTQ3NX0.mFwmVfSqYM7ITURtLC143BsurK6Yr31WFViJe5PFGN8';

function getSlugFromURL() {
    const param = new URLSearchParams(window.location.search).get('school');
    if (param) return param.toLowerCase().trim();
    const parts = window.location.hostname.split('.');
    if (parts.length >= 3) return parts[0].toLowerCase();
    return null;
}

function adjustColor(hex, amount) {
    const num = parseInt(hex.replace('#', ''), 16);
    const r = Math.min(255, Math.max(0, (num >> 16) + amount));
    const g = Math.min(255, Math.max(0, ((num >> 8) & 0xff) + amount));
    const b = Math.min(255, Math.max(0, (num & 0xff) + amount));
    return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
}

/**
 * Fetch branding by slug and apply to DOM.
 * @param {string|null} slug - jika null, baca dari URL/subdomain
 * @returns {object|null} branding data atau null jika tidak ditemukan
 */
export async function applyBranding(slug = null) {
    const resolvedSlug = slug ?? getSlugFromURL();
    if (!resolvedSlug) return null;

    let branding = null;
    try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/fn_school_branding`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'apikey': SUPABASE_ANON,
            },
            body: JSON.stringify({ p_slug: resolvedSlug }),
        });
        if (!res.ok) return null;
        const rows = await res.json();
        branding = Array.isArray(rows) ? rows[0] : rows;
        if (!branding?.school_id) return null;
    } catch {
        return null;
    }

    return _applyToDom(branding);
}

/**
 * Kembalikan school_id dari slug URL (tanpa apply DOM).
 * Berguna untuk portal yang perlu filter data setelah login.
 */
export function getSchoolSlug() {
    return getSlugFromURL();
}

/**
 * Apply branding menggunakan school_id (untuk halaman dashboard setelah login).
 * Memerlukan supabase client yang sudah ter-autentikasi.
 * @param {string} schoolId - UUID school_id dari currentUser
 * @param {object} supabaseClient - instance supabase-js yang sudah login
 */
export async function applyBrandingById(schoolId, supabaseClient) {
    if (!schoolId || !supabaseClient) return null;
    try {
        const { data } = await supabaseClient
            .from('schools')
            .select('school_id, name, logo_url, primary_color, secondary_color')
            .eq('school_id', schoolId)
            .single();
        if (!data) return null;
        return _applyToDom(data);
    } catch {
        return null;
    }
}

function _applyToDom(branding) {
    const root = document.documentElement;
    if (branding.primary_color) {
        root.style.setProperty('--color-primary', branding.primary_color);
        const dark = branding.secondary_color || adjustColor(branding.primary_color, -30);
        root.style.setProperty('--color-primary-dark', dark);
    }
    document.querySelectorAll('[data-brand="school-name"]').forEach(el => {
        el.textContent = branding.name;
    });
    if (branding.logo_url) {
        document.querySelectorAll('[data-brand="logo"]').forEach(el => {
            if (el.tagName === 'IMG') {
                el.src = branding.logo_url;
                el.alt = branding.name;
                return;
            }
            const img = document.createElement('img');
            img.src = branding.logo_url;
            img.alt = branding.name;
            img.setAttribute('data-brand', 'logo');
            img.style.cssText = 'width:52px;height:52px;object-fit:contain;border-radius:10px;margin-bottom:4px';
            el.replaceWith(img);
        });
    }
    const titleParts = document.title.split('—');
    if (titleParts.length >= 2) {
        document.title = `${titleParts[0].trim()} — ${branding.name}`;
    } else {
        document.title = `${document.title} — ${branding.name}`;
    }
    return branding;
}
