// Browser regressions using the actual markup, handlers and API wrappers.
// Requires Playwright; all API responses are synthetic and browser requests are blocked.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8').replaceAll('\r\n','\n');
function region(text,first,last) {
    const start=text.indexOf(first),end=text.indexOf(last,start+first.length);
    assert(start>=0&&end>start,'Missing source region: '+first);
    return text.slice(start,end).replaceAll('export ','');
}
const source=read('guru/js/dashboard.js'),api=read('guru/js/api.js');
const browser=await chromium.launch({headless:true});
const context=await browser.newContext();
await context.route('**/*',route=>route.abort());
const page=await context.newPage();
page.setDefaultTimeout(5000);
const errors=[];page.on('pageerror',err=>errors.push(err.message));
let passed=0;
async function test(label,fn){await fn();console.log('PASS UI '+(++passed)+': '+label);}
try {
    await page.setContent('<html><body></body></html>');
    await page.evaluate(markup=>{
        const doc=new DOMParser().parseFromString(markup,'text/html');
        document.body.innerHTML=doc.getElementById('tab-waka_kurikulum').outerHTML;
        document.getElementById('tab-waka_kurikulum').style.display='block';
    },read('guru/dashboard.html'));
    await page.addStyleTag({content:read('guru/css/guru.css')+read('guru/css/transitions.css')});
    await page.addScriptTag({content:`
        var today='2026-10-08',calls=[],rpcHook=null,approvalLoads=0;
        var statsRows=[{guru_hadir:1,guru_total:1,guru_belum:1,pct_hadir:100}];
        var dailyRows=[{teacher_id:'t',teacher_name:'Current teacher',session_start:'08:00',session_end:'09:00',subject_name:'Math',class_name:'Test class'}];
        var groupRows=[{teacher_id:'t',teacher_name:'Current teacher',jumlah:2}];
        var detailRows=[{session_date:'2026-10-08',session_start:'08:00',session_end:'09:00',subject_name:'Math',class_name:'Test class'}];
        var dailyError=false,groupError=false,statsError=false,detailError=false;
        function localDateStr(){return today;}
        function esc(v){return String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');}
        function fe(e){return e.message;}
        function fmtTime(v){return String(v??'').slice(0,5);}
        function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};}
        function range(start='2026-10-01',end='2026-10-08'){
            document.getElementById('wk-kur-start').value=start;document.getElementById('wk-kur-end').value=end;
        }
        var supabase={rpc:async function(name,args){
            calls.push({name,args});
            const hooked=rpcHook?.(name,args);if(hooked)return hooked;
            if(name==='fn_waka_kur_stats')return {data:statsRows,error:statsError?new Error('Synthetic stats outage'):null};
            if(name==='fn_pending_attendance_sessions')return {data:dailyRows,error:dailyError?new Error('Synthetic daily outage'):null};
            if(name==='fn_pending_sessions_by_teacher')return {data:groupRows,error:groupError?new Error('Synthetic groups outage'):null};
            if(name==='fn_pending_sessions_detail')return {data:detailRows,error:detailError?new Error('Synthetic detail outage'):null};
            throw new Error('Unexpected RPC '+name);
        }};
        async function getPendingDocApprovals(){approvalLoads++;return [];}
        async function getWakaApprovalHistory(){approvalLoads++;return [];}
        async function getCorePhases(){approvalLoads++;return [];}
        ${region(api,'export async function getWakaKurStats(','// \u2500\u2500\u2500 WAKA KESISWAAN')}
        ${region(source,'let _wkKur1Visible =','// \u2500\u2500\u2500 TAB WAKA HUMAS')}
        ${region(source,'async function loadWakaDocApprovals()','// Dipanggil dari initKepsekTab')}
    `});
    await test('reopening tab refreshes monitoring and never loads hidden approvals',async()=>{
        await page.evaluate(async()=>{await initWakaKurTab();await initWakaKurTab();await loadWakaDocApprovals();});
        assert.equal(await page.locator('#kepsek-approval-section').isVisible(),false);
        assert.equal(await page.evaluate(()=>approvalLoads),0);
        assert.equal(await page.evaluate(()=>calls.filter(c=>c.name==='fn_waka_kur_stats').length),2);
    });
    await test('partial teacher stays pending and labels distinguish participation from incomplete sessions',async()=>{
        assert.equal(await page.locator('#wk-kur-val-hadir').innerText(),'100%');
        assert.equal(await page.locator('#wk-kur-val-pending').innerText(),'1');
        assert((await page.locator('#wk-kur-detail-belum').innerText()).includes('sesi belum diisi'));
        assert((await page.locator('#wk-kur-stats-row').innerText()).includes('Guru mulai mengisi absensi'));
    });
    await test('initial daily error keeps toggle visible, enabled and retryable',async()=>{
        await page.evaluate(()=>dailyError=true);await page.locator('#wk-kur1-btn').click();
        await page.waitForFunction(()=>document.getElementById('wk-kur1-hint').innerText.includes('Synthetic daily outage'));
        assert(await page.locator('#wk-kur1-btn').isVisible());assert(await page.locator('#wk-kur1-btn').isEnabled());
        assert.equal(await page.locator('#wk-kur1-btn').innerText(),'Tampilkan');
        assert.equal(await page.evaluate(()=>_wkKur1Loaded),false);
        await page.evaluate(()=>dailyError=false);await page.locator('#wk-kur1-btn').click();
        await page.waitForFunction(()=>document.getElementById('wk-kur1-btn').innerText==='Sembunyikan');
        assert((await page.locator('#wk-kur1-body').innerText()).includes('Current teacher'));
        await page.locator('#wk-kur1-body tr[data-guru-idx]').click();
        assert((await page.locator('#wk-kur1-detail-0').innerText()).includes('Math'));
    });
    await test('null endpoints are identical in group, stats and detail RPCs',async()=>{
        for(const dates of [['',''],['','2026-10-08'],['2026-10-01','']]) {
            await page.evaluate(async dates=>{range(...dates);calls=[];await loadWkKur2();
                await _wkKur2ToggleDetail('wk-kur2-detail-0','t',dates[0]||null,dates[1]||null);},dates);
            const requests=await page.evaluate(()=>calls);
            assert.equal(requests.length,3);
            for(const request of requests)assert.deepEqual([request.args.p_date_start,request.args.p_date_end],dates.map(v=>v||null));
        }
    });
    await test('reversed range makes no RPC call and valid filter recovers',async()=>{
        await page.evaluate(async()=>{range('2026-10-08','2026-10-01');calls=[];await loadWkKur2();});
        assert.equal(await page.evaluate(()=>calls.length),0);
        assert((await page.locator('#wk-kur2-hint').innerText()).includes('Tanggal awal'));
        assert.equal(await page.locator('#wk-kur2-stats-row').isVisible(),false);
        assert(await page.locator('#wk-kur2-btn').isEnabled());
        await page.evaluate(async()=>{range();await loadWkKur2();});
        assert(await page.locator('#wk-kur2-wrap').isVisible());
    });
    for(const oldError of [false,true]) await test('older range '+(oldError?'error':'response')+' cannot overwrite latest range',async()=>{
        await page.evaluate(async oldError=>{
            const old=deferred();rpcHook=(name,args)=>name==='fn_pending_sessions_by_teacher'&&args.p_date_start==='2026-09-01'?old.promise:null;
            range('2026-09-01');const first=loadWkKur2();range();await loadWkKur2();
            old.resolve(oldError?{error:new Error('Old range error')}:{data:[{teacher_id:'old',teacher_name:'OLD RANGE',jumlah:9}]});
            await first;rpcHook=null;
        },oldError);
        assert((await page.locator('#wk-kur2-body').innerText()).includes('Current teacher'));
        assert(!(await page.locator('#wk-kur2-body').innerText()).includes('OLD RANGE'));
        assert.equal(await page.locator('#wk-kur2-hint').isVisible(),false);
        assert(await page.locator('#wk-kur2-btn').isEnabled());
    });
    for(const oldError of [false,true]) await test('older stats '+(oldError?'error':'response')+' cannot overwrite latest statistics',async()=>{
        await page.evaluate(async oldError=>{
            const old=deferred();rpcHook=(name,args)=>name==='fn_waka_kur_stats'&&args.p_date_start==='2026-09-01'?old.promise:null;
            const first=loadWkKurStats('2026-09-01','2026-09-01');await loadWkKurStats('2026-10-08','2026-10-08');
            old.resolve(oldError?{error:new Error('Old stats error')}:{data:[{guru_hadir:0,guru_total:9,guru_belum:9,pct_hadir:0}]});
            await first;rpcHook=null;
        },oldError);
        assert.equal(await page.locator('#wk-kur-val-hadir').innerText(),'100%');
        assert.equal(await page.locator('#wk-kur-val-pending').innerText(),'1');
    });
    for(const oldError of [false,true]) await test('older daily '+(oldError?'error':'response')+' cannot replace latest daily list',async()=>{
        await page.evaluate(async oldError=>{
            const old=deferred();let firstCall=true;
            rpcHook=name=>name==='fn_pending_attendance_sessions'&&firstCall?(firstCall=false,old.promise):null;
            const first=loadWkKur1(today);await loadWkKur1(today);
            old.resolve(oldError?{error:new Error('Old daily error')}:{data:[{...dailyRows[0],teacher_name:'OLD DAILY'}]});
            await first;rpcHook=null;
        },oldError);
        assert((await page.locator('#wk-kur1-body').innerText()).includes('Current teacher'));
        assert(!(await page.locator('#wk-kur1-body').innerText()).includes('OLD DAILY'));
        assert.equal(await page.locator('#wk-kur1-hint').isVisible(),false);
        assert(await page.locator('#wk-kur1-btn').isEnabled());
    });
    await test('invalid new range cancels an older pending range and stats request',async()=>{
        await page.evaluate(async()=>{
            const oldGroups=deferred(),oldStats=deferred();
            rpcHook=name=>name==='fn_pending_sessions_by_teacher'?oldGroups.promise:name==='fn_waka_kur_stats'?oldStats.promise:null;
            range();const first=loadWkKur2();range('2026-10-08','2026-10-01');await loadWkKur2();
            oldGroups.resolve({data:groupRows});oldStats.resolve({data:statsRows});await first;rpcHook=null;
        });
        assert((await page.locator('#wk-kur2-hint').innerText()).includes('Tanggal awal'));
        assert.equal(await page.locator('#wk-kur2-wrap').isVisible(),false);
        assert.equal(await page.locator('#wk-kur2-stats-row').isVisible(),false);
    });
    await test('detail outage retries after close/reopen and then caches successful result',async()=>{
        await page.evaluate(async()=>{range();await loadWkKur2();detailError=true;calls=[];});
        const teacherRow=page.locator('#wk-kur2-body tr[data-detail-id]');
        await teacherRow.click();
        await page.waitForFunction(()=>document.getElementById('wk-kur2-detail-0-body').innerText.includes('Synthetic detail outage'));
        assert.equal(await page.locator('#wk-kur2-detail-0').getAttribute('data-loaded'),'0');
        await page.evaluate(()=>detailError=false);await teacherRow.click();await teacherRow.click();
        await page.waitForFunction(()=>document.getElementById('wk-kur2-detail-0-body').innerText.includes('Math'));
        await teacherRow.click();await teacherRow.click();
        assert.equal(await page.evaluate(()=>calls.filter(c=>c.name==='fn_pending_sessions_detail').length),2);
    });
    await test('range reload does not accept a stale detached detail response',async()=>{
        await page.evaluate(async()=>{
            await loadWkKur2();const old=deferred();rpcHook=name=>name==='fn_pending_sessions_detail'?old.promise:null;
            const first=_wkKur2ToggleDetail('wk-kur2-detail-0','t','2026-10-01','2026-10-08');
            range('2026-10-02');await loadWkKur2();rpcHook=null;
            await _wkKur2ToggleDetail('wk-kur2-detail-0','t','2026-10-02','2026-10-08');
            old.resolve({data:[{...detailRows[0],subject_name:'OLD DETAIL'}]});await first;
        });
        assert((await page.locator('#wk-kur2-detail-0-body').innerText()).includes('Math'));
        assert(!(await page.locator('#wk-kur2-detail-0-body').innerText()).includes('OLD DETAIL'));
    });
    await test('visible daily table refreshes when returning on next day',async()=>{
        const dates=await page.evaluate(async()=>{
            await loadWkKur1(today);today='2026-10-09';calls=[];await initWakaKurTab();
            return calls.filter(c=>c.name==='fn_pending_attendance_sessions').map(c=>c.args.p_date);
        });
        assert.deepEqual(dates,['2026-10-09']);
        assert.equal(await page.evaluate(()=>_wkKur1Date),'2026-10-09');
        assert(await page.locator('#wk-kur1-wrap').isVisible());
    });
    await test('hidden daily table invalidates cache and loads current day on demand',async()=>{
        const dates=await page.evaluate(async()=>{
            handleWkKur1Btn();today='2026-10-10';calls=[];await initWakaKurTab();
            if(calls.some(c=>c.name==='fn_pending_attendance_sessions'))throw new Error('Hidden table auto-loaded');
            await handleWkKur1Btn();return calls.filter(c=>c.name==='fn_pending_attendance_sessions').map(c=>c.args.p_date);
        });
        assert.deepEqual(dates,['2026-10-10']);
    });
    await test('midnight during daily request cannot cache yesterday as today',async()=>{
        await page.evaluate(async()=>{
            const old=deferred();rpcHook=name=>name==='fn_pending_attendance_sessions'?old.promise:null;
            const first=loadWkKur1(today);today='2026-10-11';old.resolve({data:dailyRows});await first;rpcHook=null;
        });
        assert.equal(await page.evaluate(()=>_wkKur1Loaded),false);
        assert.equal(await page.locator('#wk-kur1-wrap').isVisible(),false);
        assert(await page.locator('#wk-kur1-btn').isEnabled());
        await page.evaluate(async()=>await handleWkKur1Btn());
        assert.equal(await page.evaluate(()=>_wkKur1Date),'2026-10-11');
    });
    await test('group failure remains retryable and does not display an empty-success message',async()=>{
        await page.evaluate(async()=>{range();groupError=true;await loadWkKur2();});
        assert((await page.locator('#wk-kur2-hint').innerText()).includes('Synthetic groups outage'));
        assert(await page.locator('#wk-kur2-btn').isEnabled());
        await page.evaluate(()=>groupError=false);await page.locator('#wk-kur2-btn').click();
        await page.waitForFunction(()=>document.getElementById('wk-kur2-btn').innerText==='Sembunyikan');
        assert(await page.locator('#wk-kur2-wrap').isVisible());
    });
    await test('statistics failure clears stale success details and no-session range is explicit',async()=>{
        await page.evaluate(async()=>{statsError=true;await loadWkKurStats(today,today);});
        assert.equal(await page.locator('#wk-kur-val-hadir').innerText(),'!');
        assert((await page.locator('#wk-kur-detail-sudah').innerText()).includes('Gagal'));
        assert((await page.locator('#wk-kur-detail-belum').innerText()).includes('Synthetic stats outage'));
        await page.evaluate(async()=>{
            statsError=false;const original=statsRows;statsRows=[{guru_hadir:0,guru_total:0,guru_belum:0,pct_hadir:null}];
            await loadWkKurStats(null,null,'wk-kur2','Tidak ada sesi pada rentang ini');statsRows=original;
        });
        assert.equal(await page.locator('#wk-kur2-val-hadir').innerText(),'\u2014');
        assert.equal(await page.locator('#wk-kur2-detail-belum').innerText(),'Tidak ada sesi pada rentang ini');
    });
    await test('updated card labels remain contained at desktop and mobile widths',async()=>{
        for(const width of [1280,390]){
            await page.setViewportSize({width,height:844});
            assert(await page.evaluate(()=>Array.from(document.querySelectorAll('#wk-kur-stats-row > div')).every(card=>{
                const rect=card.getBoundingClientRect();return Array.from(card.children).every(child=>{
                    const text=child.getBoundingClientRect();return text.left>=rect.left&&text.right<=rect.right&&child.scrollWidth<=child.clientWidth;
                });
            })));
        }
    });
    assert.deepEqual(errors,[]);
    console.log('UI_COMPLETE: '+passed+' checks passed; all responses synthetic, no production requests or writes.');
} finally {await browser.close();}
