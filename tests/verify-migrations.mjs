#!/usr/bin/env node
/**
 * tests/verify-migrations.mjs
 *
 * P4-B: Bandingkan file migrasi lokal vs tabel schema_migrations live.
 *
 * Mendeteksi tiga kondisi:
 *   MISSING  — file ada lokal tapi tidak tercatat di DB (belum di-apply atau lupa catat).
 *   PHANTOM  — tercatat di DB tapi file tidak ada lokal (apply manual tanpa file, atau file dihapus).
 *   OK       — sinkron.
 *
 * Cara pakai:
 *   SUPABASE_URL=https://... SUPABASE_SERVICE_KEY=sbp_... node tests/verify-migrations.mjs
 *
 * Service role key diperlukan karena schema_migrations ada di schema supabase_migrations
 * yang tidak aksesibel oleh anon/authenticated key.
 * Ambil dari: Supabase Dashboard → Project Settings → API → service_role (jangan commit!).
 */

import { readdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '..', 'supabase', 'migrations');

const SUPABASE_URL      = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error('❌ Set env vars: SUPABASE_URL dan SUPABASE_SERVICE_KEY');
    console.error('   Contoh: SUPABASE_URL=https://xxx.supabase.co SUPABASE_SERVICE_KEY=sbp_... node tests/verify-migrations.mjs');
    process.exit(1);
}

async function fetchAppliedMigrations() {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/`, {
        method: 'POST',
        headers: {
            'Content-Type':  'application/json',
            'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
            'apikey':        SUPABASE_SERVICE_KEY,
        },
        // Query via RPC — schema_migrations ada di schema supabase_migrations
        body: JSON.stringify({
            query: `SELECT version FROM supabase_migrations.schema_migrations ORDER BY version`,
        }),
    });

    // Fallback: coba lewat Management API (butuh sbp_ token)
    if (!res.ok) {
        const mgmtRes = await fetch(`https://api.supabase.com/v1/projects/${extractProjectRef(SUPABASE_URL)}/database/query`, {
            method: 'POST',
            headers: {
                'Content-Type':  'application/json',
                'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
            },
            body: JSON.stringify({ query: `SELECT version FROM supabase_migrations.schema_migrations ORDER BY version` }),
        });
        if (!mgmtRes.ok) {
            const txt = await mgmtRes.text();
            throw new Error(`Gagal query schema_migrations: ${mgmtRes.status} ${txt}`);
        }
        const data = await mgmtRes.json();
        return (data ?? []).map(r => r.version);
    }

    const data = await res.json();
    return (data ?? []).map(r => r.version);
}

function extractProjectRef(url) {
    // https://xovvuuwexoweoqyltepq.supabase.co → xovvuuwexoweoqyltepq
    return new URL(url).hostname.split('.')[0];
}

async function getLocalMigrationVersions() {
    const files = await readdir(MIGRATIONS_DIR);
    return files
        .filter(f => f.endsWith('.sql'))
        .map(f => f.replace('.sql', ''))
        .sort();
}

async function main() {
    console.log('🔍 Verifikasi konsistensi migrasi (P4-B)\n');

    let applied;
    try {
        applied = await fetchAppliedMigrations();
    } catch (err) {
        console.error('❌ Tidak dapat mengambil schema_migrations dari DB live:');
        console.error('  ', err.message);
        console.error('\n💡 Pastikan SUPABASE_SERVICE_KEY adalah service_role key (bukan anon key).');
        process.exit(1);
    }

    const local  = await getLocalMigrationVersions();
    const appliedSet = new Set(applied);
    const localSet   = new Set(local);

    const missing = local.filter(v => !appliedSet.has(v));
    const phantom = applied.filter(v => !localSet.has(v));
    const ok      = local.filter(v => appliedSet.has(v));

    console.log(`📁 File lokal       : ${local.length}`);
    console.log(`🗄️  Tercatat di DB   : ${applied.length}`);
    console.log(`✅ Sinkron          : ${ok.length}`);
    console.log(`⚠️  MISSING (lokal tapi belum di DB) : ${missing.length}`);
    console.log(`👻 PHANTOM (di DB tapi tidak ada file): ${phantom.length}`);

    if (missing.length > 0) {
        console.log('\n⚠️  MISSING — file ada lokal, belum tercatat di DB:');
        missing.forEach(v => console.log(`   ${v}`));
        console.log('   → Apply dengan: supabase db query --linked --file supabase/migrations/<versi>.sql');
        console.log('   → Lalu catat: INSERT INTO supabase_migrations.schema_migrations(version) VALUES (\'<versi>\');');
    }

    if (phantom.length > 0) {
        console.log('\n👻 PHANTOM — tercatat di DB tapi file tidak ada lokal:');
        phantom.forEach(v => console.log(`   ${v}`));
        console.log('   → Cek apakah file dihapus/di-rename, atau apply dilakukan manual tanpa file.');
    }

    if (missing.length === 0 && phantom.length === 0) {
        console.log('\n✅ Semua migrasi sinkron — tidak ada selisih.');
    } else {
        process.exit(1);
    }
}

main().catch(err => { console.error(err); process.exit(1); });
