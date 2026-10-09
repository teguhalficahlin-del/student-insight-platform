import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const auth = readFileSync('supabase/functions/_shared/auth.ts', 'utf8');
const syncJournal = readFileSync('supabase/functions/sync-journal/index.ts', 'utf8');

assert.match(auth, /teaching_assignments\(count\)/,
  'resolver auth harus memuat jumlah teaching assignment');
assert.match(auth, /export function isTeacherUser\(/,
  'resolver auth harus menyediakan predicate guru');
assert.match(auth, /user\.teacher_code\?\.trim\(\)/,
  'predicate guru harus menerima teacher_code');
assert.match(auth, /user\.teaching_assignments\?\.\[0\]\?\.count/,
  'predicate guru harus menerima teaching assignment');
assert.match(syncJournal, /isTeacherUser\(user\)/,
  'sync-journal harus memakai predicate guru');
assert.doesNotMatch(syncJournal, /const STAFF_ROLES\s*=/,
  'sync-journal tidak boleh mengotorisasi jurnal berdasarkan role list');
assert.match(syncJournal, /Hanya guru yang dapat menyimpan jurnal/,
  'pesan penolakan harus menyebut batasan guru');

console.log('guru-jurnal-auth: 7 checks passed');
