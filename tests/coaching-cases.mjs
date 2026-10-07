// Local regression tests: Node 24+, Playwright, no database or network requests.
// Run: node --experimental-vm-modules tests/coaching-cases.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire, stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const root = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');
let passed = 0;
async function test(name, fn) {
    await fn();
    console.log(`PASS ${++passed}: ${name}`);
}

async function testEdge() {
    const ids = Array.from({ length: 6 }, (_, i) => `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
    const [school, otherSchool, author, student, caseId, key] = ids;
    let handler;
    let state;
    const admin = {
        from(table) {
            const filters = [];
            return {
                select() { return this; },
                eq(column, value) { filters.push([column, value]); return this; },
                limit() { return this; },
                async maybeSingle() {
                    state.queries.push({ table, filters });
                    if (state.errors[table]) return { data: null, error: new Error('Synthetic API outage') };
                    const row = state.rows[table];
                    return { data: row && filters.every(([k, v]) => row[k] === v) ? row : null, error: null };
                },
            };
        },
        async rpc(name, args) { state.writes.push({ name, args }); return { error: null }; },
    };
    const context = vm.createContext({
        Request, Response, console: { error() {} },
        Deno: { serve(fn) { handler = fn; } },
    });
    const modules = new Map();
    async function moduleAt(url) {
        if (modules.has(url.href)) return modules.get(url.href);
        let mod;
        if (url.pathname.endsWith('/auth.ts')) {
            mod = new vm.SyntheticModule(['resolveAuth', 'isAuthError'], function () {
                this.setExport('resolveAuth', async () => state.authError ?? { user: state.user });
                this.setExport('isAuthError', result => result instanceof Response);
            }, { context, identifier: url.href });
        } else if (url.pathname.endsWith('/db.ts')) {
            mod = new vm.SyntheticModule(['getAdminClient'], function () {
                this.setExport('getAdminClient', () => admin);
            }, { context, identifier: url.href });
        } else {
            mod = new vm.SourceTextModule(stripTypeScriptTypes(readFileSync(url, 'utf8')), {
                context, identifier: url.href,
            });
        }
        modules.set(url.href, mod);
        await mod.link((specifier, parent) => moduleAt(new URL(specifier, parent.identifier)));
        return mod;
    }
    await (await moduleAt(new URL('supabase/functions/sync-case/index.ts', root))).evaluate();
    function reset() {
        state = {
            user: { user_id: author, school_id: school, role_type: 'GURU' },
            rows: { students: { student_id: student, school_id: school } },
            errors: {}, queries: [], writes: [],
        };
    }
    const body = { idempotency_key: key, case_id: caseId, student_id: student,
        created_by_user_id: author, track: 'SEKOLAH', title: 'Kasus sintetis',
        description: 'Deskripsi pengujian sintetis yang cukup panjang.' };
    const call = patch => handler(new Request('https://local.test/sync-case', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, ...patch }),
    }));
    await test('same-school case reaches RPC with authenticated author', async () => {
        reset(); assert.equal((await call()).status, 200);
        assert.equal(state.writes.length, 1);
        assert.equal(state.writes[0].args.p_created_by_user_id, author);
        assert.equal(state.writes[0].args.p_student_id, student);
    });
    for (const [name, configure, status] of [
        ['foreign student', () => state.rows.students.school_id = otherSchool, 403],
        ['missing student', () => delete state.rows.students, 403],
        ['student lookup outage', () => state.errors.students = true, 500],
        ['spoofed author', () => {}, 403],
        ['WAKA_KURIKULUM creation remains forbidden', () => state.user.role_type = 'WAKA_KURIKULUM', 403],
        ['student role creation forbidden', () => state.user.role_type = 'SISWA', 403],
    ]) {
        await test(`edge rejects ${name} without writes`, async () => {
            reset(); configure();
            assert.equal((await call(name === 'spoofed author' ? { created_by_user_id: student } : {})).status, status);
            assert.equal(state.writes.length, 0);
        });
    }
    for (const mode of ['wrong-track', 'unassigned', 'inactive', 'foreign-placement', 'outage', 'assigned']) {
        await test(`DUDI legacy save guard: ${mode}`, async () => {
            reset(); state.user.role_type = 'DUDI';
            if (!['unassigned', 'wrong-track'].includes(mode)) state.rows.pkl_placements = {
                placement_id: caseId, school_id: mode === 'foreign-placement' ? otherSchool : school,
                student_id: student, dudi_user_id: author, is_active: mode !== 'inactive',
            };
            if (mode === 'outage') state.errors.pkl_placements = true;
            assert.equal((await call({ track: mode === 'wrong-track' ? 'SEKOLAH' : 'PKL' })).status,
                mode === 'assigned' ? 200 : mode === 'outage' ? 500 : 403);
            assert.equal(state.writes.length, mode === 'assigned' ? 1 : 0);
            if (mode === 'assigned') assert.equal(state.writes[0].args.p_audience, 'PRIVATE');
        });
    }
    for (const mode of ['same-scope', 'foreign-school', 'other-function']) {
        await test(`idempotency is scoped: ${mode}`, async () => {
            reset(); state.rows.sync_idempotency = { idempotency_key: key,
                school_id: mode === 'foreign-school' ? otherSchool : school,
                function_name: mode === 'other-function' ? 'sync-observation' : 'sync-case',
                result_json: { case_id: caseId } };
            const response = await call();
            assert.equal(response.status, 200);
            assert.equal(state.writes.length, mode === 'same-scope' ? 0 : 1);
        });
    }
}

async function testUI() {
    const { chromium } = require('playwright');
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    await context.route('**/*', route => route.abort());
    const source = read('guru/js/dashboard.js');
    const code = source.slice(source.indexOf('const CASE_STATUS_LABEL ='), source.indexOf('// \u2500\u2500\u2500 TAB PIKET'));
    assert(code.includes('async function initKasusTab()') && code.includes('async function refreshKasusDetail('));
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.setDefaultTimeout(5000);
    await page.setContent('<html><body></body></html>');
    await page.evaluate(markup => {
        const doc = new DOMParser().parseFromString(markup, 'text/html');
        doc.querySelectorAll('script,link,img,iframe').forEach(el => el.remove());
        document.body.innerHTML = doc.getElementById('tab-kasus').outerHTML;
        document.getElementById('tab-kasus').style.display = 'block';
    }, read('guru/dashboard.html'));
    await page.addScriptTag({ content: `
        var currentUser={user_id:'handler',role_type:'GURU',school_id:'school'};
        var jabatan=['guru'],isBroadObserver=false,kaprodiAllStudents=[],_wkKasusCtx=null;
        var myStudents=[{student_id:'a',full_name:'Siswa A',nis:'001'},{student_id:'b',full_name:'Siswa B',nis:'002'}];
        var saved=[],writes=[],poolError=true,listError=false,caseError=false,listRows=[],requests=[];
        var candidates=[{user_id:'dudi',role_type:'DUDI',full_name:'DUDI',relation_label:'DUDI'},
            {user_id:'bk',role_type:'BK',full_name:'BK',relation_label:'BK'}];
        var statuses={},handlers={};
        function esc(v){return String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');}
        function fmt(v){return String(v??'');} function fe(e){return e.message;}
        function markKasusAsSeen(){} function wireKasusDownloadButtons(){}
        function sipPrepareOpen(el){el.classList.remove('sip-exit');}
        function sipCloseOverlay(el){el.style.display='none';}
        function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject};}
        function record(id){return {case_id:id,title:'Kasus '+id,description:'Deskripsi sintetis',track:'SEKOLAH',
            status:statuses[id]??'OPEN',current_handler_user_id:handlers[id]??'handler',student:{full_name:'Siswa Uji'}};}
        async function ensureStudentPool(){if(poolError)throw new Error('Synthetic pool failure');}
        async function getCases(q){requests.push(q);if(listError)throw new Error('Synthetic list failure');return listRows.slice(q.offset,q.offset+q.limit);}
        async function getEscalationCandidates(){return candidates;}
        async function getCase(id){if(caseError)throw new Error('Synthetic detail failure');return record(id);}
        async function getCoachingCaseEvents(){return [];}
        async function createCase(v){saved.push(v);return {case_id:'saved'};}
        async function addCoachingNote(v){writes.push({type:'note',...v});}
        async function escalateCoachingCase(v){writes.push({type:'escalate',...v});handlers[v.caseId]=v.newHandlerUserId;}
        async function changeCoachingCaseStatus(v){writes.push({type:'status',...v});statuses[v.caseId]=v.newStatus;}
        async function closeCoachingCase(v){writes.push({type:'close',...v});statuses[v.caseId]='CLOSED';}
        async function shareCoachingCaseToStudent(id){writes.push({type:'share-student',caseId:id});}
        async function shareCoachingCaseToParent(id){writes.push({type:'share-parent',caseId:id});}
        async function unshareCoachingCaseFromStudent(){} async function unshareCoachingCaseFromParent(){}
        ${code}
    ` });
    const visible = id => page.locator('#' + id).isVisible();
    const open = id => page.evaluate(id => openKasusDetail(id), id);
    try {
        await test('student-pool failure is visible; retry initializes intact form', async () => {
            await page.evaluate(() => initKasusTab());
            assert(await visible('kasus-list-error'));
            assert.equal(await page.evaluate(() => _kasusTabInit), false);
            await page.evaluate(() => poolError = false);
            await page.locator('#kasus-list-error button').click();
            await page.waitForFunction(() => _kasusTabInit && !document.getElementById('kasus-list-error'));
            assert.equal(await page.locator('#kasus-create-form').count(), 1);
        });
        await test('editing selected student clears ID and blocks wrong-student save', async () => {
            await page.evaluate(() => openKasusModal());
            await page.locator('#kasus-c-student-search').fill('Siswa A');
            await page.locator('#kasus-c-student-list [data-id="a"]').click();
            await page.locator('#kasus-c-student-search').fill('Siswa B');
            assert.equal(await page.locator('#kasus-c-student-id').inputValue(), '');
            await page.locator('#kasus-c-title').fill('Kasus sintetis');
            await page.locator('#kasus-c-desc').fill('Deskripsi pengujian sintetis cukup panjang.');
            await page.locator('#kasus-create-submit-btn').click();
            assert.equal(await page.evaluate(() => saved.length), 0);
            await page.locator('#kasus-c-student-list [data-id="b"]').click();
            await page.locator('#kasus-create-submit-btn').click();
            await page.waitForFunction(() => saved.length === 1);
            assert.equal(await page.evaluate(() => saved[0].studentId), 'b');
        });
        await test('remote search cannot restore stale results after clear or reopen', async () => {
            await page.evaluate(() => {isBroadObserver=true;searchWait=deferred();searchStudents=()=>searchWait.promise;openKasusModal();});
            await page.locator('#kasus-c-student-search').fill('Siswa A');
            await page.locator('#kasus-c-student-search').fill('');
            await page.evaluate(async () => {searchWait.resolve([]);await searchWait.promise;});
            assert.equal(await visible('kasus-c-student-list'), false);
            await page.evaluate(() => searchWait=deferred());
            await page.locator('#kasus-c-student-search').fill('Siswa A');
            await page.evaluate(async () => {closeKasusModal();openKasusModal();searchWait.resolve([]);await searchWait.promise;});
            assert.equal(await visible('kasus-c-student-list'), false);
            await page.evaluate(() => {isBroadObserver=false;closeKasusModal();});
        });
        await test('same-case refresh preserves draft; another case clears draft and visibility', async () => {
            await open('a');
            await page.locator('#kasus-comment-text').fill('Draft A');
            await page.locator('#kasus-comment-visible').check();
            await page.evaluate(() => refreshKasusDetail());
            assert.equal(await page.locator('#kasus-comment-text').inputValue(), 'Draft A');
            assert.equal(await page.locator('#kasus-comment-visible').isChecked(), true);
            await open('b');
            assert.equal(await page.locator('#kasus-comment-text').inputValue(), '');
            assert.equal(await page.locator('#kasus-comment-visible').isChecked(), false);
        });
        for (const role of ['GURU','BK','WALI_KELAS','KAPRODI','WAKA_KESISWAAN','WAKA_KURIKULUM','WAKA_HUMAS','KEPSEK']) {
            await test(`${role} handler sees escalation/share; DUDI excluded`, async () => {
                await page.evaluate(role => currentUser.role_type=role, role);
                await open('role-' + role);
                assert(await visible('kasus-escalate-block'));
                assert(await visible('kasus-audience-block'));
                assert.deepEqual(await page.locator('#kasus-escalate-to option').evaluateAll(els=>els.map(el=>el.value)), ['bk']);
            });
        }
        await test('Waka Humas/Kurikulum controls send the currently selected case', async () => {
            for (const role of ['WAKA_HUMAS', 'WAKA_KURIKULUM']) {
                await page.evaluate(role => currentUser.role_type=role, role);
                const id='actions-'+role;
                await open(id);
                await page.locator('#kasus-share-student-btn').click();
                await page.waitForFunction(id => writes.some(w=>w.type==='share-student'&&w.caseId===id), id);
                await page.waitForFunction(() => document.getElementById('kasus-actions').style.display==='block');
                await page.locator('#kasus-share-parent-btn').click();
                await page.waitForFunction(id => writes.some(w=>w.type==='share-parent'&&w.caseId===id), id);
                await page.waitForFunction(() => document.getElementById('kasus-actions').style.display==='block');
                await page.locator('#kasus-escalate-btn').click();
                await page.waitForFunction(id => writes.some(w=>w.type==='escalate'&&w.caseId===id), id);
                await page.waitForFunction(() => document.getElementById('kasus-actions').style.display==='none');
            }
        });
        await test('non-handler and closed cases hide all actions', async () => {
            await page.evaluate(() => handlers.other='someone-else');
            await open('other'); assert.equal(await visible('kasus-actions'), false);
            await page.evaluate(() => statuses.closed='CLOSED');
            await open('closed'); assert.equal(await visible('kasus-actions'), false);
        });
        await test('Monitoring can close with confirmation and summary', async () => {
            await page.evaluate(() => {currentUser.role_type='GURU';statuses.monitor='MONITORING';});
            await open('monitor');
            assert(await visible('kasus-close-btn'));
            assert.equal(await visible('kasus-status-change-controls'), false);
            await page.locator('#kasus-status-note').fill('Ringkasan selesai');
            await page.locator('#kasus-close-btn').click();
            assert.equal(await page.evaluate(() => writes.filter(w=>w.type==='close').length), 0);
            await page.locator('#kasus-close-btn').click();
            await page.waitForFunction(() => statuses.monitor==='CLOSED');
            assert.equal(await page.evaluate(() => writes.find(w=>w.type==='close').note), 'Ringkasan selesai');
        });
        await test('closing summary is displayed and HTML escaped', async () => {
            await page.evaluate(() => renderKasusEvents([{event_type:'CLOSED',payload:{old_status:'MONITORING',
                new_status:'CLOSED',summary:'Selesai <img src=x onerror=alert(1)>'},created_at:'2026-10-07'}]));
            assert((await page.locator('#kasus-events-list').innerText()).includes('Selesai <img'));
            assert.equal(await page.locator('#kasus-events-list img').count(), 0);
        });
        await test('slow detail, candidate and refresh responses cannot overwrite a new case', async () => {
            await page.evaluate(async () => {
                const original=getCase, pending=deferred();
                getCase=id=>id==='slow'?pending.promise:original(id);
                const first=openKasusDetail('slow');await openKasusDetail('fast');
                pending.resolve(record('slow'));await first;getCase=original;
            });
            assert((await page.locator('#kasus-detail-header').innerText()).includes('Kasus fast'));
            await page.evaluate(async () => {
                const original=getEscalationCandidates, pending=deferred(), started=deferred();
                getEscalationCandidates=id=>{if(id==='candidate-old'){started.resolve();return pending.promise;}return original(id);};
                const first=openKasusDetail('candidate-old');await started.promise;await openKasusDetail('candidate-new');
                pending.resolve([{user_id:'old',role_type:'BK',full_name:'Old'}]);await first;getEscalationCandidates=original;
            });
            assert.equal(await page.locator('#kasus-escalate-to').inputValue(), 'bk');
            await page.evaluate(async () => {
                const original=getCase,pending=deferred();getCase=id=>id==='candidate-new'?pending.promise:original(id);
                const first=refreshKasusDetail();await openKasusDetail('refresh-new');
                pending.resolve(record('candidate-new'));await first;getCase=original;
            });
            assert((await page.locator('#kasus-detail-header').innerText()).includes('Kasus refresh-new'));
        });
        await test('A-B-A race and stale errors cannot replace the latest detail', async () => {
            await page.evaluate(async () => {
                const original=getCase,pending=deferred();let count=0;
                getCase=id=>id==='race-a'&&++count===1?pending.promise:original(id);
                const first=openKasusDetail('race-a');await openKasusDetail('race-b');await openKasusDetail('race-a');
                pending.resolve({...record('race-a'),title:'Old A'});await first;getCase=original;
            });
            assert((await page.locator('#kasus-detail-header').innerText()).includes('Kasus race-a'));
            await page.evaluate(async () => {
                const original=getCase,pending=deferred();getCase=id=>id==='error-old'?pending.promise:original(id);
                const first=openKasusDetail('error-old');await openKasusDetail('error-new');
                pending.reject(new Error('Old failure'));await first;getCase=original;
            });
            assert.equal(await page.locator('#kasus-detail-header [role="alert"]').count(), 0);
        });
        await test('old comment completion cannot clear the new case draft', async () => {
            await open('comment-old');
            await page.evaluate(() => {noteWait=deferred();originalNote=addCoachingNote;addCoachingNote=()=>noteWait.promise;});
            await page.locator('#kasus-comment-text').fill('Old note');
            await page.locator('#kasus-comment-submit-btn').click();
            await open('comment-new');
            await page.locator('#kasus-comment-text').fill('New draft');
            await page.evaluate(async () => {noteWait.resolve();await noteWait.promise;addCoachingNote=originalNote;});
            assert.equal(await page.locator('#kasus-comment-text').inputValue(), 'New draft');
            assert.equal(await page.locator('#kasus-comment-submit-btn').isDisabled(), false);
        });
        await test('refresh failure is visible and retry restores detail/actions', async () => {
            await page.evaluate(async () => {caseError=true;await refreshKasusDetail();});
            assert.equal(await visible('kasus-actions'), false);
            assert((await page.locator('#kasus-detail-header').innerText()).includes('Synthetic detail failure'));
            await page.evaluate(() => caseError=false);
            await page.locator('#kasus-detail-header button').click();
            await page.waitForFunction(() => document.getElementById('kasus-actions').style.display==='block');
        });
        await test('pagination failure preserves rows and enables retry/load-more', async () => {
            await page.evaluate(async () => {showKasusList();listRows=Array.from({length:55},(_,i)=>record('page-'+i));await loadKasusList();listError=true;});
            assert.equal(await page.locator('.kasus-row').count(), 50);
            await page.locator('#kasus-load-more-btn').click();
            await page.waitForFunction(() => !!document.getElementById('kasus-list-error'));
            assert.equal(await page.locator('#kasus-load-more-btn').isDisabled(), false);
            assert.equal(await page.locator('.kasus-row').count(), 50);
            await page.evaluate(() => listError=false);
            await page.locator('#kasus-list-error button').click();
            await page.waitForFunction(() => document.querySelectorAll('.kasus-row').length===55);
            assert.equal(await page.evaluate(() => kasusCtxDefault.offset), 55);
            assert.equal(await page.locator('#kasus-load-more-btn').count(), 0);
            assert.equal(await page.evaluate(() => requests.at(-1).offset), 50);
        });
        await test('shared role-panel contexts preserve independent selection and close placement', async () => {
            await page.evaluate(async () => {
                const copy=document.getElementById('tab-kasus').cloneNode(true);
                for(const el of [copy,...copy.querySelectorAll('[id]')])el.id=el.id.replace('kasus','testrole');
                document.body.appendChild(copy);
                const ctx=makeKasusCtx('testrole');
                const close=kEl(ctx,'close-btn');kEl(ctx,'actions').appendChild(close);
                kEl(ctx,'status-change-controls').removeAttribute('id');
                statuses.shared='MONITORING';await openKasusDetail('shared',ctx);
                window.sharedCase=ctx.currentId;
            });
            assert(await visible('testrole-close-btn'));
            assert.equal(await page.evaluate(() => sharedCase), 'shared');
            assert.equal(await page.evaluate(() => kasusCtxDefault.currentId), null);
        });
        await test('no unhandled browser errors', async () => assert.deepEqual(errors, []));
    } finally {
        await browser.close();
    }
}

await testEdge();
await testUI();
console.log(`${passed} regression tests passed; no production writes.`);
