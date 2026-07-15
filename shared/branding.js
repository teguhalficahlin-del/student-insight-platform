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
    // Subdomain detection: hanya berlaku untuk custom domain (bukan github.io)
    const host  = window.location.hostname;
    const parts = host.split('.');
    if (parts.length >= 3 && !host.endsWith('.github.io')) return parts[0].toLowerCase();
    // Fallback: slug dari sesi sebelumnya (untuk PWA yang dibuka tanpa ?school=)
    try { const s = localStorage.getItem('school_slug'); if (s) return s; } catch { /* private mode */ }
    return null;
}

// Buat singkatan dari slug: "smkn1ub" → "N1UB", "smkhr" → "HR", "smkcontoh" → "CONT"
function _slugToAbbr(slug) {
    var s = (slug || '').toLowerCase().replace(/^smk/, '').replace(/[^a-z0-9]/g, '');
    return (s.slice(0, 4) || slug.slice(0, 4)).toUpperCase();
}

// Buat data-URI SVG ikon style K: mortarboard + SMK + SIP serif
function _makeIconDataURI(abbr, color) {
    var bg  = color || '#1d4ed8';
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">' +
        '<rect width="512" height="512" rx="96" fill="' + bg + '"/>' +
        '<polygon points="256,112 340,152 256,192 172,152" fill="rgba(255,255,255,0.85)"/>' +
        '<line x1="340" y1="152" x2="340" y2="210" stroke="rgba(255,255,255,0.85)" stroke-width="18" stroke-linecap="round"/>' +
        '<text x="256" y="298" font-family="Arial,sans-serif" font-weight="700" font-size="88" ' +
            'fill="rgba(255,255,255,0.65)" text-anchor="middle" dominant-baseline="middle" letter-spacing="4">SMK</text>' +
        '<text x="256" y="408" font-family="Georgia,serif" font-weight="700" font-size="128" ' +
            'fill="#ffffff" text-anchor="middle" dominant-baseline="middle">SIP</text>' +
        '</svg>';
    return 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)));
}

function _injectDynamicManifest(slug, branding = null) {
    const el = document.querySelector('link[rel="manifest"]');
    if (!el || !slug) return;

    const name      = branding?.name || slug.toUpperCase();
    // "SMKN 1 Ujungbatu" → "SMKN1 Ujungbatu" sehingga Android wrap jadi 2 baris
    const shortName = name.replace(/\b(SMK[A-Za-z]*)\s+(\d)/i, '$1$2');
    const color     = branding?.primary_color || '#1a56db';
    const iconURI   = _makeIconDataURI('SIP', color);
    const dynIcon   = { src: iconURI, sizes: '512x512', type: 'image/svg+xml', purpose: 'any maskable' };
    const icons     = branding?.logo_url
        ? [{ src: branding.logo_url, sizes: '512x512', type: 'image/png', purpose: 'any maskable' }, dynIcon]
        : [dynIcon];

    // Bangun manifest langsung tanpa fetch — blob URL ter-set synchronous
    // sehingga sudah siap sebelum user sempat tap "Add to Home Screen"
    const manifest = {
        name,
        short_name: shortName,
        description: 'Portal ' + name,
        start_url:  './index.html?school=' + encodeURIComponent(slug),
        scope:      './',
        display:    'standalone',
        orientation:'any',
        theme_color:      color,
        background_color: color,
        lang:  'id',
        icons,
    };

    const blob = new Blob([JSON.stringify(manifest)], { type: 'application/manifest+json' });
    el.href = URL.createObjectURL(blob);
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
/**
 * Kembalikan URL halaman login dengan slug sekolah yang tersimpan di localStorage.
 * Dipakai semua portal untuk redirect logout / sesi habis.
 */
export function getLoginUrl(page = 'index.html') {
    try {
        const slug = localStorage.getItem('school_slug');
        return slug ? `${page}?school=${encodeURIComponent(slug)}` : page;
    } catch { return page; }
}

export async function applyBranding(slug = null) {
    const resolvedSlug = slug ?? getSlugFromURL();
    if (!resolvedSlug) return null;
    try { localStorage.setItem('school_slug', resolvedSlug); } catch { /* private mode */ }

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

    _injectDynamicManifest(resolvedSlug, branding);
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
            .select('school_id, name, logo_url, primary_color, secondary_color, slug')
            .eq('school_id', schoolId)
            .single();
        if (!data) return null;
        if (data.slug) try { localStorage.setItem('school_slug', data.slug); } catch { /* private mode */ }
        _injectDynamicManifest(data.slug, data);
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

// ─────────────────────────────────────────────────────────────
// BANNER PEMELIHARAAN PLATFORM-WIDE (kemungkinan_buruk 6.4/7.3)
// branding.js diimpor semua portal → banner otomatis muncul di mana saja.
// ─────────────────────────────────────────────────────────────

async function checkMaintenanceBanner() {
    try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/fn_maintenance_status`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON },
            body:    '{}',
        });
        if (!res.ok) return;
        const status = await res.json();
        if (status?.active) renderMaintenanceBanner(status.message);
    } catch { /* fail-safe: jika gagal fetch, jangan tampilkan apa-apa */ }
}

function renderMaintenanceBanner(message) {
    if (document.getElementById('maintenance-banner')) return;
    const bar = document.createElement('div');
    bar.id = 'maintenance-banner';
    bar.setAttribute('role', 'status');
    bar.style.cssText =
        'position:fixed;top:0;left:0;right:0;z-index:100000;background:#b45309;color:#fff;' +
        'padding:10px 16px;text-align:center;font-size:14px;font-weight:600;' +
        'box-shadow:0 2px 8px rgba(0,0,0,.2);line-height:1.4';
    bar.textContent = '🛠 ' + (message?.trim() ||
        'Sistem sedang dalam pemeliharaan. Beberapa fitur mungkin tidak tersedia sementara.');
    const applyPad = () => { document.body.style.paddingTop = bar.offsetHeight + 'px'; };
    document.body.appendChild(bar);
    applyPad();
    window.addEventListener('resize', applyPad);
}

if (typeof window !== 'undefined') {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', checkMaintenanceBanner);
    } else {
        checkMaintenanceBanner();
    }
}
