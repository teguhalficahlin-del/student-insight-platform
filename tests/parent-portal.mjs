import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const api = read('parent/js/api.js');
const portal = read('parent/js/portal.js');
const html = read('parent/portal.html');
const migration = read('supabase/migrations/20261012100000_parent_portal_hardening.sql');
let passed = 0;

function test(name, condition) {
    assert.ok(condition, name);
    console.log(`PASS PARENT PORTAL ${++passed}: ${name}`);
}

test('children query is tenant-scoped and selects only current active enrollment',
    /fetchChildren\(parentUserId, schoolId\)[\s\S]*?\.eq\('school_id', schoolId\)[\s\S]*?academic_year === academicYear && !e\.withdrawn_at/.test(api));
test('forum helper limits class enrollment lookup to selected child',
    /getParentForumRecipients\(studentId, classId, schoolId\)[\s\S]*?\.eq\('student_id', studentId\)[\s\S]*?\.eq\('school_id', schoolId\)/.test(api));
test('parent post sends selected child identity to RPC',
    /p_subject_student_ids:\s*\[studentId\]/.test(api) && /child\.student_id,\s*\n\s*_forumIdemKey/.test(portal));
test('server trigger rejects unrelated parent-forum recipients',
    /fn_validate_parent_forum_audience[\s\S]*?Penerima forum orang tua tidak terkait/.test(migration) &&
    /trg_validate_parent_forum_audience/.test(migration) &&
    /forum_post_subjects/.test(migration) &&
    /v_subject_student_ids/.test(migration));
test('PKL attendance is scoped by placement and visible 30-day range',
    /fetchPklAttendanceSummary\(studentId, placementId, dateStart, dateEnd\)/.test(api) &&
    /\.eq\('placement_id', placementId\)[\s\S]*?\.gte\('attendance_date', dateStart\)[\s\S]*?\.lte\('attendance_date', dateEnd\)/.test(api) &&
    /placement\.placement_id, localDateStr\(startDate\), endDate/.test(portal));
test('failed tabs remain retryable',
    /tabLoaded\[key\] = loaded/.test(portal) && !/tabLoaded\[key\] = true/.test(portal));
test('child switch invalidates stale in-flight responses',
    /_loadChildAbort\.abort\(\)/.test(portal) && /signal\?\.aborted/.test(portal) && /_loadChildAbort\?\.signal === signal/.test(portal));
test('week schedule surfaces request failures instead of converting them to empty data',
    /rows: await fetchSchedule\(classId, date, schoolId\)/.test(api) &&
    !/fetchSchedule\(classId, date, schoolId\)[\s\S]*?catch\(\) => \(\{ date, rows: \[\] \}\)/.test(api));
test('sent forum posts retain attachment fields',
    /post_id, title, body, attachment_url, attachment_name, attachment_path,/.test(api));
test('forum detail invalidates late responses and does not fall back from failed signing',
    /_forumDetailToken/.test(portal) && /if \(token !== _forumDetailToken\) return/.test(portal) &&
    /if \(signError \|\| !signed\?\.signedUrl\) throw/.test(portal));
test('parent forum exposes comment read and insert controls',
    /getForumPostComments\(postId\)/.test(api) && /addForumPostComment\(postId, body, schoolId, authorUserId\)/.test(api) &&
    /detail-forum-comments-list/.test(html) && /btn-forum-comment-submit/.test(html) &&
    /submitForumComment/.test(portal));

console.log(`PARENT_PORTAL_COMPLETE: ${passed} passed; static/synthetic only`);
