/**
 * @file _shared/identifier.ts
 *
 * Converts identity documents (NIP/NIS/NIK/nama usaha) into the
 * internal email format required by Supabase Auth, and generates
 * URL-safe slugs for DUDI org names.
 *
 * Domain mapping (see contracts/01_reference_identity_org.sql,
 * users.identifier_type):
 *   NIP        -> {nip}@staff.internal
 *   NIS        -> {nis}@siswa.internal
 *   NIK        -> {nik}@ortu.internal
 *   NAMA_USAHA -> {slug}@dudi.internal
 *
 * Usage:
 *   const email = toInternalEmail('123456', 'NIP');
 *   const slug  = generateSlug('PT Maju Jaya Teknik');
 *   const safe  = resolveCollision(slug, existingSlugs);
 */

export type IdentifierType = 'NIP' | 'NIS' | 'NIK' | 'NAMA_USAHA' | 'KODE_KHUSUS';

const DOMAIN_BY_TYPE: Record<IdentifierType, string> = {
    NIP:          'staff.internal',
    NIS:          'siswa.internal',
    NIK:          'ortu.internal',
    NAMA_USAHA:   'dudi.internal',
    KODE_KHUSUS:  'stakeholder.internal',
};

/**
 * Converts a name (or any free text) into a URL-safe slug:
 * lowercase, spaces -> hyphens, strip anything that isn't
 * alphanumeric or a hyphen, collapse repeated hyphens.
 */
export function generateSlug(name: string): string {
    return name
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9-]/g, '')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
}

/**
 * Converts an identifier + its type into the internal email used
 * for Supabase Auth sign-in. NAMA_USAHA is slugified first; other
 * types are used as-is (digits only by convention).
 */
export function toInternalEmail(identifier: string, type: IdentifierType): string {
    const domain = DOMAIN_BY_TYPE[type];
    if (!domain) {
        throw new Error(`Tipe identifier tidak dikenal: ${type}`);
    }

    const local = type === 'NAMA_USAHA'
        ? generateSlug(identifier)
        : identifier.trim().toLowerCase();

    if (!local) {
        throw new Error(`Identifier kosong setelah normalisasi (type=${type})`);
    }

    return `${local}@${domain}`;
}

/**
 * If `slug` already exists in `existingSlugs`, appends -2, -3, ...
 * until a free slug is found. Returns the original slug untouched
 * if there's no collision.
 */
export function resolveCollision(slug: string, existingSlugs: string[]): string {
    const taken = new Set(existingSlugs);
    if (!taken.has(slug)) return slug;

    let suffix = 2;
    let candidate = `${slug}-${suffix}`;
    while (taken.has(candidate)) {
        suffix += 1;
        candidate = `${slug}-${suffix}`;
    }
    return candidate;
}
