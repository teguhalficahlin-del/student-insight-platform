// Browser regression tests against the actual Wali markup/functions and API wrappers.
// Requires Playwright. Only network request: the same pinned SheetJS asset used by the app.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const { chromium } = createRequire(import.meta.url)('playwright');
const root = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8').replaceAll('\r\n','\n');
const source = read('guru/js/dashboard.js'), api = read('guru/js/api.js');
function slice(text, start, end) {
    const a = text.indexOf(start), b = text.indexOf(end,a+start.length);
    assert(a >= 0 && b > a, `Missing source region ${start}`);
    return text.slice(a,b).replaceAll('export ', '');
}
const wali = slice(source,'let _waliSummarySeq =','// \u2500\u2500\u2500 TAB BK');
const cases = slice(source,'const CASE_STATUS_LABEL =','// \u2500\u2500\u2500 TAB PIKET');
const helpers = slice(source,'function wireSimpleAccordion(','function generateRekapPembinaan(');
const stats = slice(source,'function buildAttStatCards(','async function loadWkAttendanceRecap(');
const enrolled = slice(api,'export async function getEnrolledStudents(','/**\n * Kehadiran');
const info = slice(api,'export async function getWaliKelasInfo(','/**');
const waliApi = slice(api,'export async function getWaliAttendanceSummary(','// \u2500\u2500\u2500 KAPRODI');
const casesApi = slice(api,'export async function getCases({','/**\n * Jumlah kasus');
const xlsx = await fetch('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js');
assert(xlsx.ok, `SheetJS HTTP ${xlsx.status}`);
const browser = await chromium.launch({headless:true});
const context = await browser.newContext();
await context.route('**/*', route=>route.abort());
const page = await context.newPage();
page.setDefaultTimeout(5000);
const errors=[]; page.on('pageerror',err=>errors.push(err.message));
let passed=0;
async function test(label, fn) { await fn(); console.log(`PASS ${++passed}: ${label}`); }
try {
    await page.setContent('<html><body></body></html>');
    await page.evaluate(markup=>{
        const doc=new DOMParser().parseFromString(markup,'text/html');
        document.body.innerHTML=doc.getElementById('tab-wali_kelas').outerHTML;
        document.getElementById('tab-wali_kelas').style.display='block';
    },read('guru/dashboard.html'));
    await page.addScriptTag({content:await xlsx.text()});
    await page.addScriptTag({content:`
        var currentUser={user_id:'handler',school_id:'school',role_type:'GURU',wali_kelas_class_id:'class'};
        var config={current_academic_year:'2026/2027'},_waliKasusCtx=null,_wkKasusCtx=null;
        var summaryRows=[{student_id:'a',full_name:'Siswa A',nis:'001',hadir:1,izin:0,sakit:0,alpa:1,total:2}];
        var enrollmentRows=[{class_id:'class',academic_year:'2026/2027',withdrawn_at:null,student:{student_id:'a',full_name:'Siswa A',student_status:'AKTIF'}},
            {class_id:'class',academic_year:'2026/2027',withdrawn_at:null,student:{student_id:'pkl',full_name:'Siswa PKL',student_status:'PKL'}},
            {class_id:'class',academic_year:'2026/2027',withdrawn_at:null,student:{student_id:'old',full_name:'Lulus',student_status:'LULUS'}},
            {class_id:'class',academic_year:'2026/2027',withdrawn_at:'2026-10-01',student:{student_id:'withdrawn',full_name:'Keluar',student_status:'AKTIF'}}];
        var sessionRows=[{attendance_id:'1',status:'HADIR',session_date:'2026-10-01',session_start:'08:00',session_end:'09:00',subject_label:'Math',teacher_full_name:'Teacher'},
            {attendance_id:'2',status:'ALPA',session_date:'2026-10-01',session_start:'10:00',session_end:'11:00',subject_label:'Math',teacher_full_name:'Teacher'}];
        var queries=[],tableQueries=[],alerts=[],exports=[],generated=[],caseStatuses={},closedPayload=null;
        var summaryError=false,sessionError=false,rosterError=false;
        var caseRows=[{case_id:'pkl-case',student_id:'pkl',student:{full_name:'Siswa PKL'},track:'PKL',title:'Kasus PKL',status:'OPEN'}];
        function esc(v){return String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');}
        function fe(e){return e.message;} function fmt(v){return String(v??'');} function fmtTime(v){return String(v??'').slice(0,5);}
        function localDateStr(){return '2026-10-07';} function alert(v){alerts.push(v);}
        function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject};}
        var supabase={rpc(name,q){
            const execute=(start=0,end=999)=>{
                queries.push({name,...q,start,end});
                const error=name==='fn_class_attendance_summary'?summaryError:sessionError;
                if(error)return Promise.resolve({data:null,error:new Error('Synthetic '+(name==='fn_class_attendance_summary'?'summary':'session')+' outage')});
                if(q.p_date_start===''||q.p_date_end==='')return Promise.resolve({error:new Error('invalid DATE')});
                return Promise.resolve({data:name==='fn_class_attendance_summary'?summaryRows:sessionRows.slice(start,end+1),error:null});
            };
            return {range(a,b){return execute(a,b);},then(resolve,reject){return execute().then(resolve,reject);}};
        },from(table){const filters=[];let start=0,end=Infinity;
            return {select(){return this;},order(){return this;},
                eq(k,v){filters.push(r=>r[k]===v);return this;},is(k,v){filters.push(r=>r[k]===v);return this;},
                neq(k,v){filters.push(r=>r[k]!==v);return this;},in(k,v){filters.push(r=>v.includes(r[k]));return this;},
                range(a,b){start=a;end=b;return this;},
                maybeSingle:async()=>({data:{name:'Kelas Uji'},error:null}),
                then(resolve,reject){tableQueries.push(table);return Promise.resolve({
                    data:(table==='class_enrollments'?enrollmentRows:caseRows).filter(r=>filters.every(fn=>fn(r))).slice(start,end+1),
                    error:rosterError&&table==='class_enrollments'?new Error('Synthetic roster outage'):null,
                }).then(resolve,reject);}
            };
        }};
        async function getCase(id){return {case_id:id,title:'Case '+id,status:caseStatuses[id]??'MONITORING',current_handler_user_id:'handler'};}
        async function getCoachingCaseEvents(){return [];}
        async function getEscalationCandidates(){return [];}
        async function closeCoachingCase(v){closedPayload=v;caseStatuses[v.caseId]='CLOSED';}
        function generateRekapPembinaan(rows,filter){generated.push({rows,filter});}
        XLSX.writeFile=(wb,name)=>exports.push({wb,name});
        ${enrolled} ${info} ${waliApi} ${casesApi} ${cases} ${helpers} ${stats} ${wali}
    `});
    await test('repeated initialization binds attendance accordion once',async()=>{
        await page.evaluate(async()=>{await initWaliTab();await initWaliTab();});
        await page.locator('#wali-att-card .kp-acc-header').click();
        assert(await page.locator('#wali-att-body').isVisible());
    });
    await test('both conflicting sessions and their times remain visible at 50% attendance',async()=>{
        await page.locator('details[data-student-id="a"] summary').click();
        await page.waitForFunction(()=>document.querySelector('details').innerText.includes('Alpa'));
        const text=await page.locator('details').innerText();
        for(const value of ['50%','Hadir','Alpa','08:00 - 09:00','10:00 - 11:00']) assert(text.includes(value));
        const args=await page.evaluate(()=>queries.at(-1));
        assert.equal(args.name,'fn_wali_attendance_sessions');
        assert.equal(args.p_class_id,'class');assert.equal(args.p_academic_year,'2026/2027');assert.equal(args.p_student_id,'a');
    });
    for(const oldFails of [false,true]) await test(`older ${oldFails?'error':'response'} cannot overwrite the latest date selection`,async()=>{
        await page.evaluate(async oldFails=>{
            const original=getWaliAttendanceSummary,pending=deferred();
            getWaliAttendanceSummary=(c,y,ds,de)=>ds==='2026-09-01'?pending.promise:original(c,y,ds,de);
            document.getElementById('wali-date-start').value='2026-09-01';const first=loadWaliSummary();
            document.getElementById('wali-date-start').value='2026-10-01';await loadWaliSummary();
            if(oldFails)pending.reject(new Error('Old range error'));
            else pending.resolve([{student_id:'old',full_name:'Old range result',HADIR:1,ALPA:0,IZIN:0,SAKIT:0,total:1}]);
            await first;getWaliAttendanceSummary=original;
        },oldFails);
        const text=await page.locator('#wali-att-recap').innerText();
        assert(text.includes('Siswa A'));assert(!text.includes('Old range'));
    });
    await test('coaching includes PKL but daily attendance still excludes PKL, withdrawn and graduated',async()=>{
        assert.deepEqual(await page.evaluate(()=>_waliKasusCtx.extraQuery.studentIds),['a','pkl']);
        assert((await page.locator('#wali-kasus-list-content').innerText()).includes('Kasus PKL'));
        assert.deepEqual(await page.evaluate(async()=>(await getEnrolledStudents('class','2026/2027')).map(s=>s.student_id)),['a']);
    });
    await test('reopening Wali refreshes roster additions/removals without duplicate listeners',async()=>{
        await page.evaluate(async()=>{
            enrollmentRows=enrollmentRows.filter(r=>r.student.student_id!=='a');
            enrollmentRows.push({class_id:'class',academic_year:'2026/2027',withdrawn_at:null,student:{student_id:'new',full_name:'Baru',student_status:'AKTIF'}});
            await initWaliTab();await initWaliTab();tableQueries=[];
        });
        assert.deepEqual(await page.evaluate(()=>_waliKasusCtx.extraQuery.studentIds),['pkl','new']);
        await page.locator('#wali-kasus-filter-btn').click();
        await page.waitForFunction(()=>tableQueries.includes('coaching_cases'));
        assert.equal(await page.evaluate(()=>tableQueries.filter(t=>t==='class_enrollments').length),1);
    });
    await test('slow old roster cannot restore removed students',async()=>{
        await page.evaluate(async()=>{
            const original=getWaliCoachingStudents,pending=deferred();let firstCall=true;
            getWaliCoachingStudents=()=>firstCall?(firstCall=false,pending.promise):original('class','2026/2027');
            const first=initWaliKasusSection();await initWaliKasusSection();
            pending.resolve([{student_id:'removed'}]);await first;getWaliCoachingStudents=original;
        });
        assert.deepEqual(await page.evaluate(()=>_waliKasusCtx.extraQuery.studentIds),['pkl','new']);
    });
    await test('roster outage shows retry and retry restores PKL cases',async()=>{
        await page.evaluate(async()=>{rosterError=true;await initWaliKasusSection();});
        assert((await page.locator('#wali-kasus-list-content').innerText()).includes('Synthetic roster outage'));
        assert.deepEqual(await page.evaluate(()=>_waliKasusCtx.extraQuery.studentIds),[]);
        await page.evaluate(()=>rosterError=false);
        await page.locator('#wali-kasus-list-content button').click();
        await page.waitForFunction(()=>document.getElementById('wali-kasus-list-content').innerText.includes('Kasus PKL'));
    });
    await test('empty scoped case query returns no cases without querying server',async()=>{
        assert.deepEqual(await page.evaluate(async()=>{
            tableQueries=[];const rows=await getCases({studentIds:[]}),all=await getCasesAll({studentIds:[]});
            return {rows,all,queries:tableQueries};
        }),{rows:[],all:[],queries:[]});
    });
    await test('case recap retains refreshed roster and status/track filters',async()=>{
        await page.locator('#wali-kasus-filter-status').selectOption('OPEN');
        await page.locator('#wali-kasus-filter-track').selectOption('PKL');
        await page.locator('#wali-kasus-rekap-btn').click();
        await page.waitForFunction(()=>generated.length===1);
        assert.deepEqual(await page.evaluate(()=>generated[0].rows.map(r=>r.case_id)),['pkl-case']);
    });
    await test('session outage can be retried by closing and reopening detail',async()=>{
        await page.evaluate(async()=>{sessionError=true;await loadWaliSummary();});
        await page.locator('details summary').click();
        await page.waitForFunction(()=>document.querySelector('details').innerText.includes('Synthetic session outage'));
        assert.equal(await page.evaluate(()=>document.querySelector('details > div').dataset.loaded),undefined);
        await page.evaluate(()=>sessionError=false);
        await page.locator('details summary').click();await page.locator('details summary').click();
        await page.waitForFunction(()=>document.querySelector('details').innerText.includes('Alpa'));
    });
    await test('open-ended dates use null in summary and detail, including Excel',async()=>{
        await page.evaluate(async()=>{
            document.getElementById('wali-date-start').value='';document.getElementById('wali-date-end').value='';
            queries=[];await loadWaliSummary();await document.getElementById('wali-recap-export').onclick();
        });
        assert.equal(await page.evaluate(()=>alerts.length),0);
        const queries=await page.evaluate(()=>window.queries);
        assert(queries.some(q=>q.name==='fn_wali_attendance_sessions'));
        assert(queries.every(q=>q.p_date_start===null&&q.p_date_end===null));
        assert((await page.evaluate(()=>exports.at(-1).name)).includes('_awal_akhir.xlsx'));
        await page.locator('details summary').click();
        await page.waitForFunction(()=>document.querySelector('details').innerText.includes('Alpa'));
    });
    await test('detail RPC wrapper paginates beyond 1000 without missing or repeating sessions',async()=>{
        const result=await page.evaluate(async()=>{
            const original=sessionRows;sessionRows=Array.from({length:2505},(_,i)=>({...original[0],attendance_id:String(i)}));
            queries=[];const rows=await getWaliAttendanceSessions('class','2026/2027','a',null,null);
            sessionRows=original;return {count:rows.length,unique:new Set(rows.map(r=>r.attendance_id)).size,ranges:queries.map(q=>[q.start,q.end])};
        });
        assert.deepEqual(result,{count:2505,unique:2505,ranges:[[0,999],[1000,1999],[2000,2999]]});
    });
    await test('Excel sheet names handle duplicates, truncation, reserved summary name and invalid characters',async()=>{
        const result=await page.evaluate(async()=>{
            const names=['Sama','Sama','sama','Ringkasan','RINGKASAN','A'.repeat(40),'A'.repeat(35)+'B',"'Nama:/?*[]\\\\'","''",'Sama (2)'];
            summaryRows=names.map((full_name,i)=>({...summaryRows[0],student_id:'s'+i,nis:String(i),full_name}));
            await document.getElementById('wali-recap-export').onclick();
            const wb=exports.at(-1).wb;
            // Writing and reading actual XLSX catches names that book_append_sheet alone accepts.
            const parsed=XLSX.read(XLSX.write(wb,{type:'array',bookType:'xlsx'}),{type:'array'});
            return {names:parsed.SheetNames,identities:parsed.SheetNames.slice(1).map(n=>parsed.Sheets[n].B1.v),alerts};
        });
        assert.equal(result.names.length,11);assert.equal(new Set(result.names.map(n=>n.toLowerCase())).size,11);
        assert(result.names.every(n=>n.length<=31&&!/[\\/:?*\[\]]/.test(n)&&!n.startsWith("'")&&!n.endsWith("'")));
        assert.equal(result.identities[5],'A'.repeat(40));assert.equal(result.alerts.length,0);
        assert.equal(await page.locator('#wali-recap-export').isDisabled(),false);
    });
    await test('failed export reports error and unlocks download button',async()=>{
        await page.evaluate(async()=>{sessionError=true;await document.getElementById('wali-recap-export').onclick();sessionError=false;});
        assert((await page.evaluate(()=>alerts.at(-1))).includes('Synthetic session outage'));
        assert.equal(await page.locator('#wali-recap-export').isDisabled(),false);
    });
    await test('Monitoring shows closing note and confirmation; close saves note only after second click',async()=>{
        await page.evaluate(()=>openKasusDetail('monitor',_waliKasusCtx));
        assert.equal(await page.locator('#wali-kasus-status-change-controls').isVisible(),false);
        assert(await page.locator('#wali-kasus-status-note').isVisible());
        await page.locator('#wali-kasus-status-note').fill('Ringkasan penutupan uji');
        await page.locator('#wali-kasus-close-btn').click();
        assert.equal(await page.evaluate(()=>closedPayload),null);
        assert(await page.locator('#wali-kasus-status-msg').isVisible());
        assert((await page.locator('#wali-kasus-status-msg').innerText()).includes('tidak bisa dibuka kembali'));
        await page.locator('#wali-kasus-close-btn').click();
        await page.waitForFunction(()=>caseStatuses.monitor==='CLOSED');
        assert.equal(await page.evaluate(()=>closedPayload.note),'Ringkasan penutupan uji');
        await page.waitForFunction(()=>document.getElementById('wali-kasus-actions').style.display==='none');
    });
    await test('template menu still toggles once after repeated initialization',async()=>{
        await page.evaluate(()=>showKasusList(_waliKasusCtx));
        await page.locator('#wali-kasus-template-btn').click();
        assert(await page.locator('#wali-kasus-template-menu').isVisible());
        assert.equal(await page.locator('#wali-kasus-template-menu a[download]').count(),3);
        await page.locator('#wali-kasus-template-btn').click();
        assert.equal(await page.locator('#wali-kasus-template-menu').isVisible(),false);
    });
    await test('no unhandled browser errors',async()=>assert.deepEqual(errors,[]));
    console.log(`${passed} Wali checks passed; all API responses synthetic, no production writes.`);
} finally {await browser.close();}
