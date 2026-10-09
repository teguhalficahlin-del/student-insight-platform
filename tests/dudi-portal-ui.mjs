// Real DUDI markup/handlers and IndexedDB, with synthetic clients and no external requests.
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const html = read('dudi/dashboard.html').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'')
    .replace(/<link\b[^>]*>/gi,'').replace('</head>','<style>'+read('dudi/css/dudi.css')+'</style></head>');
const dashboard = read('dudi/js/dashboard.js').replace(/import\s+[\s\S]*?from\s+['"][^'"]+['"];\s*/g,'')
    .replace(/\ninit\(\)\.catch[\s\S]*$/,'');
const offline = read('dudi/js/offline.js').replace(/import[^\n]*\n/,'').replace(/export /g,'');
const screenshots = mkdtempSync(join(tmpdir(),'sip-dudi-'));
const browser = await chromium.launch({headless:true});
const context = await browser.newContext({timezoneId:'Asia/Jakarta'});
const url = 'http://localhost:49099/dudi/dashboard.html';
let external = 0, passed = 0;
const errors=[];
await context.route('**/*',route=>{
    if(route.request().url()===url) return route.fulfill({status:200,contentType:'text/html',body:html});
    external++;return route.abort();
});
async function test(label, run) { await run(); console.log(`PASS DUDI UI ${++passed}: ${label}`); }
const student={placement_id:'p1',student_id:'s1',full_name:'Siswa Sintetis',nis:'001',start_date:'2026-09-01',end_date:'2026-12-31',is_active:true};
async function setup({cached=[],fresh=[student],history=[]}={}) {
    const p=await context.newPage();p.on('pageerror',e=>errors.push(e.message));
    await p.clock.install({time:new Date('2026-10-10T05:00:00Z')});
    await p.goto(url);
    await p.evaluate(({cached,fresh,history})=>{
        localStorage.clear();if(cached.length)localStorage.setItem('dudi:placements-u1',JSON.stringify(cached));
        window.mock={fresh,history,obs:[],saves:[],notes:[],fetch:async()=>new Map(),freshFetch:async()=>fresh};
    },{cached,fresh,history});
    await p.addScriptTag({content:`
        const supabase={auth:{getUser:async()=>({data:{user:{id:'a1'}}})}};
        const getCurrentUserRow=async()=>({user_id:'u1',school_id:'school1',full_name:'DUDI Sintetis',role_type:'DUDI'});
        const isDudi=u=>u?.role_type==='DUDI';
        const applyBrandingById=()=>{document.querySelector('[data-brand]').textContent='Sekolah Sintetis';};
        const getLoginUrl=()=>'/login';const checkMustChangePassword=async()=>{};const initLoginGuard=async()=>{};const initSessionGuard=()=>{};
        const logout=async()=>{};const showPwaBanner=()=>{};const initAckQueue=()=>{};
        const fetchMyPlacements=()=>window.mock.freshFetch();
        const fetchAttendanceForDate=(ids,date)=>window.mock.fetch(ids,date);
        const fetchRecentAttendance=async ids=>{window.mock.historyIds=ids;return window.mock.history;};
        const fetchMyObservations=async ids=>{window.mock.observationIds=ids;return window.mock.obs;};
        const saveObservation=async x=>{window.mock.notes.push(x);};
        const pendingCount=async()=>0;const clearOfflineQueue=async()=>{};const flushPending=async()=>({synced:0,remaining:0,failed:[]});
        const saveAttendanceOffline=async x=>{window.mock.saves.push(x);return {status:'synced'};};
    `+dashboard+`
        window.audit={init,loadAttendanceForDate,loadHistory,renderObsHistory,refreshViews,
            setPlacements:x=>{placements=x;placementVersion++;},state:()=>placements};
    `});
    return p;
}
try {
    let p=await setup();await p.evaluate(()=>window.audit.init());
    await test('all sections render and date input forbids future dates',async()=>{
        assert.deepEqual(await p.locator('section h3').allTextContents(),['Absensi Harian','Tambah Catatan Siswa','Riwayat Catatan Siswa','Riwayat Absensi (90 Hari Terakhir)']);
        assert.equal(await p.locator('#attendance-date').getAttribute('max'),'2026-10-10');
        assert.equal(await p.locator('#stat-total').textContent(),'1');
    });
    await test('late previous-date response cannot overwrite selected date or save wrong day',async()=>{
        await p.evaluate(()=>{
            window.mock.fetch=(ids,date)=>new Promise(res=>{window.mock['resolve'+date]=()=>res(new Map([['p1',{status:date==='2026-10-07'?'HADIR':'SAKIT'}]]));});
            document.getElementById('attendance-date').value='2026-10-07';window.audit.loadAttendanceForDate('2026-10-07');
            document.getElementById('attendance-date').value='2026-10-08';window.audit.loadAttendanceForDate('2026-10-08');
            window.mock['resolve2026-10-08']();
        });
        await p.waitForFunction(()=>document.querySelector('input[value=SAKIT]')?.checked);
        await p.evaluate(()=>{window.mock['resolve2026-10-07']();window.mock.fetch=async()=>new Map();});
        await p.locator('.attendance-save-btn').click();await p.waitForFunction(()=>window.mock.saves.length===1);
        assert.equal(await p.evaluate(()=>window.mock.saves[0].date),'2026-10-08');
    });
    await test('blank and future dates show no editable attendance',async()=>{
        for(const date of ['','2030-01-01']) {
            await p.evaluate(date=>{document.getElementById('attendance-date').value=date;return window.audit.loadAttendanceForDate(date);},date);
            assert.equal(await p.locator('.attendance-save-btn').count(),0);
            assert.equal(await p.locator('#stat-absent-today').textContent(),'0');
        }
    });
    await test('short and whitespace-padded invalid notes are rejected without writing',async()=>{
        await p.locator('#obs-student').selectOption('s1');await p.locator('#obs-sentiment').selectOption('POSITIF');await p.locator('#obs-dimension').selectOption('AKADEMIK');
        for(const content of ['abc','        abc        ',' '.repeat(20),'a'.repeat(1001)]) {
            await p.locator('#obs-content').evaluate((el,value)=>{el.value=value;},content);
            await p.locator('#obs-form').dispatchEvent('submit');
            assert.match(await p.locator('#obs-error').innerText(),/10 sampai 1000/);
        }
        assert.equal(await p.evaluate(()=>window.mock.notes.length),0);
    });
    await test('valid trimmed note succeeds and historical note content is escaped',async()=>{
        await p.evaluate(()=>window.audit.refreshViews());
        assert.equal(await p.locator('#obs-student').inputValue(),'s1');
        await p.locator('#obs-content').fill('  Catatan siswa sintetis valid  ');await p.locator('#obs-submit').click();
        await p.waitForFunction(()=>window.mock.notes.length===1);
        assert.equal(await p.evaluate(()=>window.mock.notes[0].content),'Catatan siswa sintetis valid');
        await p.evaluate(()=>window.audit.renderObsHistory([{student_id:'s1',sentiment:'POSITIF',dimension:'AKADEMIK',observed_at:'2026-10-10',content:'<img src=x onerror=window.xss=1>'}],new Map([['s1','<script>unsafe</script>']])));
        assert.equal(await p.locator('#obs-history-list img, #obs-history-list script').count(),0);
    });
    await p.close();
    p=await setup({cached:[student],fresh:[{...student,placement_id:'p2',student_id:'s2',full_name:'Siswa Baru'}]});
    await p.evaluate(()=>{window.mock.freshFetch=()=>new Promise(res=>window.mock.resolveFresh=res);});
    const started=p.evaluate(()=>window.audit.init());await p.waitForSelector('.attendance-row');
    await test('cached placement cannot be saved before verification',async()=>{assert.equal(await p.locator('.attendance-save-btn').count(),0);});
    await p.evaluate(()=>window.mock.resolveFresh(window.mock.fresh));await started;
    await test('fresh placements refresh attendance, observation picker and both histories',async()=>{
        assert.equal(await p.locator('.attendance-save-btn').getAttribute('data-placement-id'),'p2');
        assert.equal(await p.locator('#obs-student option[value=s1]').count(),0);
        assert.deepEqual(await p.evaluate(()=>window.mock.historyIds),['p2']);
        assert.deepEqual(await p.evaluate(()=>window.mock.observationIds),['s2']);
    });
    await test('empty fresh placement list clears cached attendance and histories',async()=>{
        await p.evaluate(()=>{window.audit.setPlacements([]);return window.audit.refreshViews();});
        assert.equal(await p.locator('.attendance-row').count(),0);assert.equal(await p.locator('#stat-total').textContent(),'0');
        assert.equal(await p.locator('#obs-student option').count(),1);
    });await p.close();
    const past={...student,placement_id:'old',student_id:'old-student',full_name:'Siswa Selesai',start_date:'2026-08-01',end_date:'2026-09-30',is_active:false};
    p=await setup({fresh:[student,past],history:[{placement_id:'old',student_id:'old-student',attendance_date:'2026-09-20',status:'HADIR'}]});
    await p.evaluate(()=>{window.mock.obs=[{student_id:'old-student',sentiment:'POSITIF',dimension:'AKADEMIK',content:'Catatan siswa yang selesai PKL',observed_at:'2026-09-20'}];return window.audit.init();});
    await test('completed placement attendance and observation history stay visible',async()=>{
        assert.match(await p.locator('#history-tbody').innerText(),/Siswa Selesai/);
        assert.match(await p.locator('#obs-history-list').innerText(),/Siswa Selesai/);
        assert.equal(await p.locator('#obs-student option[value=old-student]').count(),0);
        await p.evaluate(()=>{document.getElementById('attendance-date').value='2026-09-20';return window.audit.loadAttendanceForDate('2026-09-20');});
        const row=p.locator('[data-placement-id=old]');assert.equal(await row.locator('.attendance-save-btn').count(),0);
        assert.equal(await row.locator('input:disabled').count(),4);
    });
    for(const width of [1280,390,320]) await test('layout, controls and screenshot '+width,async()=>{
        await p.setViewportSize({width,height:900});
        assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
        await p.screenshot({path:join(screenshots,`dudi-${width}.png`),fullPage:true});
    });await p.close();
    p=await context.newPage();await p.goto(url);
    await p.evaluate(source=>{
        window.netOnline=false;Object.defineProperty(navigator,'onLine',{get:()=>window.netOnline,configurable:true});
        window.writes=[];window.writeFn=async payload=>{window.writes.push(payload.status);return {error:null};};
        window.offlineSource=source;
        window.off=new Function('supabase',source+';return {saveAttendanceOffline,flushPending,pendingCount,clearOfflineQueue};')({from:()=>({upsert:payload=>({abortSignal:signal=>window.writeFn(payload,signal)})})});
        window.owner={userId:'u1',schoolId:'school1'};
        window.payload={placementId:'p1',studentId:'s1',date:'2026-10-10',...window.owner};
    },offline);
    await test('offline save followed by online correction removes older queued value',async()=>{
        assert.equal((await p.evaluate(()=>window.off.saveAttendanceOffline({...window.payload,status:'HADIR'}))).status,'queued');
        await p.evaluate(()=>window.netOnline=true);
        assert.equal((await p.evaluate(()=>window.off.saveAttendanceOffline({...window.payload,status:'SAKIT'}))).status,'synced');
        assert.equal(await p.evaluate(()=>window.off.pendingCount(window.owner)),0);
        await p.evaluate(()=>window.off.flushPending(window.owner));assert.deepEqual(await p.evaluate(()=>window.writes),['SAKIT']);
    });
    await test('edit during in-flight flush is retained rather than deleted',async()=>{
        await p.evaluate(async()=>{
            window.netOnline=false;await window.off.saveAttendanceOffline({...window.payload,status:'HADIR'});window.netOnline=true;
            window.writeFn=payload=>new Promise(res=>window.resolveWrite=()=>{window.writes.push(payload.status);res({error:null});});
            window.inflight=window.off.flushPending(window.owner);
        });await p.waitForFunction(()=>!!window.resolveWrite);
        await p.evaluate(()=>{window.netOnline=false;window.nextSave=window.off.saveAttendanceOffline({...window.payload,status:'SAKIT'});window.resolveWrite();});
        await p.evaluate(async()=>{await window.inflight;await window.nextSave;});
        assert.equal(await p.evaluate(()=>window.off.pendingCount(window.owner)),1);
        await p.evaluate(async()=>{window.netOnline=true;window.writeFn=async payload=>{window.writes.push(payload.status);return {error:null};};await window.off.flushPending(window.owner);});
        assert.equal(await p.evaluate(()=>window.writes.at(-1)),'SAKIT');
    });
    await test('server rejection is reported honestly and not retried as a network failure',async()=>{
        await p.evaluate(async()=>{window.netOnline=false;await window.off.saveAttendanceOffline({...window.payload,status:'IZIN'});window.netOnline=true;window.writeFn=async()=>({error:{message:'403 Forbidden'}});});
        const result=await p.evaluate(()=>window.off.flushPending(window.owner));assert.equal(result.synced,0);assert.equal(result.failed.length,1);assert.equal(result.remaining,0);
        assert.equal((await p.evaluate(()=>window.off.saveAttendanceOffline({...window.payload,status:'IZIN'}))).status,'error');
        assert.equal(await p.evaluate(()=>window.off.pendingCount(window.owner)),0);
    });
    await test('two tabs serialize a flush and a newer online correction',async()=>{
        await p.evaluate(async()=>{
            window.netOnline=false;await window.off.saveAttendanceOffline({...window.payload,status:'HADIR'});window.netOnline=true;
            window.resolveWrite=null;window.writeFn=payload=>new Promise(res=>window.resolveWrite=()=>{window.writes.push(payload.status);res({error:null});});
            window.inflight=window.off.flushPending(window.owner);
        });await p.waitForFunction(()=>!!window.resolveWrite);
        const other=await context.newPage();await other.goto(url);
        await other.evaluate(source=>{
            window.secondWrites=[];
            window.otherOff=new Function('supabase',source+';return {saveAttendanceOffline};')({from:()=>({upsert:payload=>({abortSignal:async()=>{window.secondWrites.push(payload.status);return {error:null};}})})});
            window.correction=window.otherOff.saveAttendanceOffline({placementId:'p1',studentId:'s1',date:'2026-10-10',userId:'u1',schoolId:'school1',status:'SAKIT'});
        },offline);
        assert.deepEqual(await other.evaluate(()=>window.secondWrites),[]);
        await p.evaluate(()=>window.resolveWrite());await p.evaluate(()=>window.inflight);await other.evaluate(()=>window.correction);
        assert.deepEqual(await other.evaluate(()=>window.secondWrites),['SAKIT']);
        assert.equal(await p.evaluate(()=>window.off.pendingCount(window.owner)),0);await other.close();
    });
    await test('confirmed logout cancels own stuck submission before clearing the queue',async()=>{
        await p.evaluate(async()=>{
            window.netOnline=false;await window.off.saveAttendanceOffline({...window.payload,status:'HADIR'});window.netOnline=true;
            window.started=false;window.writeFn=(payload,signal)=>new Promise(res=>{window.started=true;signal.addEventListener('abort',()=>res({error:{message:'AbortError'}}),{once:true});});
            window.inflight=window.off.flushPending(window.owner);
        });await p.waitForFunction(()=>window.started);
        await p.evaluate(()=>window.off.clearOfflineQueue(window.owner));await p.evaluate(()=>window.inflight);
        assert.equal(await p.evaluate(()=>window.off.pendingCount(window.owner)),0);
    });
    await test('flush and logout cleanup leave another account queue untouched',async()=>{
        await p.evaluate(async()=>{window.netOnline=false;await window.off.saveAttendanceOffline({...window.payload,placementId:'p-other',userId:'u2',status:'HADIR'});await window.off.saveAttendanceOffline({...window.payload,status:'IZIN'});});
        await p.evaluate(()=>window.off.clearOfflineQueue(window.owner));
        assert.equal(await p.evaluate(()=>window.off.pendingCount({userId:'u2',schoolId:'school1'})),1);
        assert.equal(await p.evaluate(()=>window.off.pendingCount(window.owner)),0);
        await p.evaluate(()=>window.off.clearOfflineQueue({userId:'u2',schoolId:'school1'}));
    });
    await test('network errors preserve only the latest queued correction',async()=>{
        await p.evaluate(async()=>{
            window.netOnline=true;window.writeFn=async()=>({error:{message:'Failed to fetch'}});
            await window.off.saveAttendanceOffline({...window.payload,status:'HADIR'});
            await window.off.saveAttendanceOffline({...window.payload,status:'SAKIT'});
        });
        assert.equal(await p.evaluate(()=>window.off.pendingCount(window.owner)),1);
        const blocked=await p.evaluate(()=>window.off.flushPending(window.owner));assert.equal(blocked.remaining,1);assert.equal(blocked.failed.length,0);
        await p.evaluate(async()=>{window.writeFn=async payload=>{window.writes.push(payload.status);return {error:null};};await window.off.flushPending(window.owner);});
        assert.equal(await p.evaluate(()=>window.writes.at(-1)),'SAKIT');
    });
    await test('same-page fallback serializes operations without Web Locks',async()=>{
        await p.evaluate(async()=>{
            Object.defineProperty(navigator,'locks',{value:undefined,configurable:true});
            window.netOnline=false;await window.off.saveAttendanceOffline({...window.payload,status:'HADIR'});window.netOnline=true;
            window.resolveWrite=null;window.writeFn=payload=>new Promise(res=>window.resolveWrite=()=>{window.writes.push(payload.status);res({error:null});});
            window.inflight=window.off.flushPending(window.owner);
        });await p.waitForFunction(()=>!!window.resolveWrite);
        await p.evaluate(()=>{window.netOnline=false;window.nextSave=window.off.saveAttendanceOffline({...window.payload,status:'SAKIT'});window.resolveWrite();});
        await p.evaluate(async()=>{await window.inflight;await window.nextSave;});
        assert.equal(await p.evaluate(()=>window.off.pendingCount(window.owner)),1);
        await p.evaluate(()=>window.off.clearOfflineQueue(window.owner));
    });
    await p.close();
    await test('no browser exceptions or external requests',async()=>{assert.deepEqual(errors,[]);assert.equal(external,0);});
    console.log(`DUDI browser: ${passed} passed; screenshots ${screenshots}`);
} finally { await context.close();await browser.close(); }
