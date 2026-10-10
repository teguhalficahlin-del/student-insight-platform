// Actual student markup and handlers with synthetic APIs. All external requests blocked.
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const markup=read('student/dashboard.html').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'')
    .replace(/<link\b[^>]*>/gi,'').replace('</head>','<style>'+read('student/css/student.css')+'</style></head>');
const code=read('student/js/dashboard.js').replace(/import\s+[\s\S]*?from\s+['"][^'"]+['"];\s*/g,'')
    .replace(/init\(\)\.catch\(err => \{[\s\S]*?\n\}\);/,'');
let passed=0, external=0;const errors=[];
const test=async(name,run)=>{await run();console.log(`PASS STUDENT UI ${++passed}: ${name}`);};
const browser=await chromium.launch({headless:true});
const context=await browser.newContext({timezoneId:'Asia/Jakarta'});
const shots=mkdtempSync(join(tmpdir(),'sip-student-fix-'));
await context.route('**/*',r=>{
    if(r.request().url().startsWith('http://localhost:49101/student/dashboard.html'))
        return r.fulfill({body:markup,contentType:'text/html'});
    external++;return r.abort();
});
function stubs(){
    const STUDENT_ROLES=['SISWA'],ACTIVE_STUDENT_STATUSES=['AKTIF','PKL'];
    window.mock={dates:[],schedule:[{session_start:'07:00',session_end:'08:00',subject:{name:'Mapel Sintetis'},teacher:{full_name:'Guru Sintetis'}}],
        status:'AKTIF',pklCalls:[],lateCalls:0,exitCalls:0,failLate:false,failExit:false,
        placements:[{placement_id:'new',is_active:true,start_date:'2026-09-01',end_date:'2026-12-01',dudi:{dudi_org_name:'Mitra Baru'}},
            {placement_id:'old',is_active:false,start_date:'2026-06-01',end_date:'2026-08-01',dudi:{dudi_org_name:'Mitra Lama'}}],
        attendance:{new:[{attendance_date:'2026-10-10',status:'HADIR',notes:'Penempatan baru'}],old:[{attendance_date:'2026-06-01',status:'ALPA',notes:'Penempatan lama'}]},
        sign:async()=>({data:{signedUrl:'https://example.invalid/file'}})
    };
    window.mock.grades=[{subject_name:'Matematika',academic_year:'2026/2027',semester:1,nilai_akhir:82,predikat:'Tuntas',label:'SUMATIF - Ulangan 1',deskripsi_naratif:'Umpan balik'},
        {subject_name:'Matematika',academic_year:'2026/2027',semester:1,nilai_akhir:88,predikat:null,label:'Rekap tersimpan',deskripsi_naratif:'Capaian tersimpan'}];
    window.mock.pkl=async id=>window.mock.attendance[id]??[];
    const supabase={auth:{getUser:async()=>({data:{user:{id:'auth'}}}),signOut:async()=>{}},
        rpc:async()=>({data:{success:true,grades:window.mock.grades}}),storage:{from:()=>({createSignedUrl:path=>window.mock.sign(path)})}};
    const getCurrentUserRow=async()=>({user_id:'user',school_id:'school',role_type:'SISWA'});
    const getMyStudent=async()=>({student_id:'student',full_name:'Siswa Sintetis',nis:'001',student_status:window.mock.status});
    const getSchoolConfig=async()=>({current_academic_year:'2026/2027',current_semester:1});
    const getMyClass=async()=>({class_id:'class',class:{name:'X Sintetis'}});
    const getScheduleForDate=async(classId,date)=>{window.mock.dates.push(date);return window.mock.schedule;};
    const getMyAttendance=async()=>[],getMyObservations=async()=>[],getMyCases=async()=>[];
    const getMyPklPlacements=async()=>window.mock.placements;
    const getMyPklAttendance=(studentId,id)=>{window.mock.pklCalls.push(id);return window.mock.pkl(id);};
    const getUnreadNotifCount=async()=>0,getRecentNotifications=async()=>[],markNotificationsRead=async()=>{};
    const getMyLateArrivals=async()=>{window.mock.lateCalls++;if(window.mock.failLate)throw Error('network failed');return [];};
    const getMyExits=async()=>{window.mock.exitCalls++;if(window.mock.failExit)throw Error('network failed');return [];};
    const getForumSekolahPosts=async()=>[],addForumSekolahAck=async()=>{};
    const applyBrandingById=async()=>{},checkMustChangePassword=async()=>{},initLoginGuard=async()=>{},registerLoginDevice=()=>{};
    const initSessionGuard=()=>{},showPwaBanner=()=>{},getLoginUrl=()=>'/login',logout=async()=>{};
    const registerAckHandler=()=>{},initAckQueue=()=>{},ackWithRetry=async()=>{};
}
async function setup(hash='',status='AKTIF'){
    const p=await context.newPage();p.on('pageerror',e=>errors.push(e.message));
    await p.clock.install({time:new Date('2026-10-10T05:00:00Z')});
    await p.goto('http://localhost:49101/student/dashboard.html'+hash);
    const source=stubs.toString();
    await p.addScriptTag({content:source.slice(source.indexOf('{')+1,source.lastIndexOf('}'))+code+
        '\nwindow.audit={init,loadWeekSchedule,loadPkl,loadTabContent,openForumDetail,closeForumDetail,loadNilaiGrid,activateTab};'});
    await p.evaluate(status=>{window.mock.status=status;},status);
    return p;
}
try{
    const p=await setup('#kehadiran');await p.evaluate(()=>window.audit.init());
    await test('deep-link then Jadwal initializes date and weekly controls',async()=>{
        await p.locator('#tab-nav [data-tab=jadwal]').click();await p.waitForFunction(()=>window.mock.dates.length>0);
        assert.equal(await p.locator('#sched-date').inputValue(),'2026-10-10');
        await p.locator('#sched-view-minggu').click();await p.waitForFunction(()=>window.mock.dates.length===6);
        assert.equal(await p.locator('#sched-view-minggu-panel').evaluate(el=>el.style.display),'block');
    });
    await test('revisiting Jadwal does not duplicate listeners or change Monday-Friday scope',async()=>{
        await p.locator('#tab-nav [data-tab=kehadiran]').click();await p.locator('#tab-nav [data-tab=jadwal]').click();
        await p.waitForFunction(()=>window.mock.dates.length===11);
        await p.evaluate(()=>{window.mock.dates=[];});await p.locator('#sched-view-hari').click();
        await p.waitForFunction(()=>window.mock.dates.length===1);
        await p.evaluate(()=>{window.mock.dates=[];return window.audit.loadWeekSchedule();});
        assert.deepEqual(await p.evaluate(()=>window.mock.dates),['2026-10-05','2026-10-06','2026-10-07','2026-10-08','2026-10-09']);
    });
    await test('browser back into Jadwal uses same initialized controls',async()=>{
        await p.locator('#tab-nav [data-tab=forum]').click();await p.goBack();
        await p.waitForFunction(()=>document.getElementById('tab-jadwal').classList.contains('active'));
        assert.equal(await p.locator('#sched-date').inputValue(),'2026-10-10');
    });
    const q=await setup('#pkl','PKL');await q.evaluate(()=>window.audit.init());
    await test('active placement recap excludes old placement attendance',async()=>{
        assert.equal(await q.locator('#pkl-placement-select').inputValue(),'new');
        assert.equal(await q.locator('#pkl-pct').textContent(),'100%');
        assert(!(await q.locator('#pkl-recap-body').textContent()).includes('lama'));
        assert.deepEqual(await q.evaluate(()=>window.mock.pklCalls),['new']);
    });
    await test('historical placement remains selectable with its own recap',async()=>{
        await q.locator('#pkl-placement-select').selectOption('old');
        await q.waitForFunction(()=>document.getElementById('pkl-pct').textContent==='0%');
        assert((await q.locator('#pkl-info').textContent()).includes('Mitra Lama'));
        assert((await q.locator('#pkl-recap-body').textContent()).includes('lama'));
    });
    await test('failed PKL load hides stale recap and retries when revisiting tab',async()=>{
        await q.evaluate(()=>{window.mock.pkl=async()=>{throw Error('network failed');};return window.audit.loadPkl();});
        assert.equal(await q.locator('#pkl-stats').isVisible(),false);assert.equal(await q.locator('#pkl-recap-card').isVisible(),false);
        const before=await q.evaluate(()=>window.mock.pklCalls.length);
        await q.evaluate(()=>{window.mock.pkl=async id=>window.mock.attendance[id];return window.audit.loadTabContent('pkl');});
        assert.equal(await q.evaluate(()=>window.mock.pklCalls.length),before+1);assert.equal(await q.locator('#pkl-stats').isVisible(),true);
    });
    await test('empty PKL placement or empty attendance clears prior rows and statistics',async()=>{
        await q.evaluate(()=>{window.mock.pkl=async()=>[];return window.audit.loadPkl();});
        assert.equal(await q.locator('#pkl-recap-card').isVisible(),false);assert.equal(await q.locator('#pkl-pct').textContent(),'—');
        await q.evaluate(()=>{window.mock.placements=[];return window.audit.loadPkl();});
        assert.equal(await q.locator('#pkl-stats').isVisible(),false);assert.equal(await q.locator('#pkl-placement-field').isVisible(),false);
    });
    await test('slow old-placement response cannot overwrite newly selected placement',async()=>{
        await q.evaluate(()=>{window.mock.placements=[{placement_id:'new',is_active:true,dudi:{full_name:'Mitra Baru'}},{placement_id:'old',dudi:{full_name:'Mitra Lama'}}];
            window.mock.pkl=id=>id==='old'?new Promise(r=>{window.mock.resolveOld=r;}):Promise.resolve(window.mock.attendance.new);return window.audit.loadPkl();});
        await q.locator('#pkl-placement-select').selectOption('old');await q.waitForFunction(()=>!!window.mock.resolveOld);
        await q.locator('#pkl-placement-select').selectOption('new');await q.waitForFunction(()=>document.getElementById('pkl-pct').textContent==='100%');
        await q.evaluate(()=>window.mock.resolveOld([{status:'ALPA',notes:'Tidak boleh tampil'}]));
        assert(!(await q.locator('#pkl-recap-body').textContent()).includes('Tidak boleh tampil'));
        assert((await q.locator('#pkl-info').textContent()).includes('Mitra Baru'));
    });
    await test('lateness/exit errors are visible and revisit retries both histories',async()=>{
        const r=await setup('#kehadiran');await r.evaluate(()=>{window.mock.failLate=true;window.mock.failExit=true;return window.audit.init();});
        assert.match(await r.locator('#late-hint').textContent(),/Gagal memuat/);assert.match(await r.locator('#exits-hint').textContent(),/Gagal memuat/);
        await r.evaluate(()=>{window.mock.failLate=false;window.mock.failExit=false;return window.audit.loadTabContent('kehadiran');});
        assert.equal(await r.evaluate(()=>window.mock.lateCalls),2);assert.equal(await r.evaluate(()=>window.mock.exitCalls),2);
        assert(!(await r.locator('#late-hint').textContent()).includes('Gagal'));await r.close();
    });
    await test('partial history failure still retries rather than freezing failed section',async()=>{
        const r=await setup('#kehadiran');await r.evaluate(()=>{window.mock.failExit=true;return window.audit.init();});
        await r.evaluate(()=>{window.mock.failExit=false;return window.audit.loadTabContent('kehadiran');});
        assert.equal(await r.evaluate(()=>window.mock.exitCalls),2);await r.close();
    });
    await test('late signed attachment A cannot attach to already-open post B',async()=>{
        await p.evaluate(()=>{window.mock.sign=()=>new Promise(r=>{window.mock.resolveSign=r;});window.audit.openForumDetail({post_id:'a',title:'Posting A',body:'A',attachment_path:'a.pdf',attachment_name:'A.pdf'});});
        await p.evaluate(()=>window.audit.openForumDetail({post_id:'b',title:'Posting B',body:'B'}));
        await p.evaluate(()=>window.mock.resolveSign({data:{signedUrl:'https://example.invalid/A.pdf'}}));
        assert.equal(await p.locator('#detail-forum-title').textContent(),'Posting B');
        assert.equal(await p.locator('#detail-forum-attachment').textContent(),'');
    });
    await test('opening another attached post immediately clears previous attachment',async()=>{
        await p.evaluate(()=>window.audit.openForumDetail({post_id:'a',title:'A',body:'A',attachment_url:'https://example.invalid/A.pdf'}));
        assert.equal(await p.locator('#detail-forum-attachment a').count(),1);
        await p.evaluate(()=>{window.mock.sign=()=>new Promise(r=>{window.mock.resolveSign=r;});window.audit.openForumDetail({post_id:'b',title:'B',body:'B',attachment_path:'b.pdf'});});
        assert.equal(await p.locator('#detail-forum-attachment a').count(),0);
        await p.evaluate(()=>window.mock.resolveSign({data:{signedUrl:'https://example.invalid/B.pdf'}}));
        assert.equal(await p.locator('#detail-forum-attachment a').getAttribute('href'),'https://example.invalid/B.pdf');
    });
    await test('closing forum detail invalidates pending attachment and signing errors show failure',async()=>{
        await p.evaluate(()=>{window.mock.sign=()=>new Promise(r=>{window.mock.resolveSign=r;});window.audit.openForumDetail({post_id:'a',title:'A',body:'A',attachment_path:'a.pdf'});window.audit.closeForumDetail();});
        await p.evaluate(()=>window.mock.resolveSign({data:{signedUrl:'https://example.invalid/A.pdf'}}));
        assert.equal(await p.locator('#detail-forum-attachment a').count(),0);
        await p.evaluate(()=>{window.mock.sign=async()=>{throw Error('network failed');};return window.audit.openForumDetail({post_id:'a',title:'A',body:'A',attachment_path:'a.pdf',attachment_url:'https://example.invalid/stale.pdf'});});
        assert.equal(await p.locator('#detail-forum-attachment a').count(),0);assert.match(await p.locator('#detail-forum-attachment').textContent(),/Gagal/);
    });
    await test('grades render actual scores, assessment labels and escaped teacher feedback',async()=>{
        await p.evaluate(()=>window.audit.loadTabContent('nilai'));
        assert.match(await p.locator('#nilai-grid').textContent(),/82.0/);assert.match(await p.locator('#nilai-grid').textContent(),/88.0/);
        assert.match(await p.locator('#nilai-grid').textContent(),/SUMATIF - Ulangan 1/);
        await p.evaluate(()=>{window.mock.grades[0].deskripsi_naratif='<img src=x onerror=alert(1)>';return window.audit.loadNilaiGrid();});
        assert.equal(await p.locator('#nilai-grid img').count(),0);
    });
    await test('all first-route sections initialize with no external network or page errors',async()=>{
        for(const tab of ['jadwal','kehadiran','observasi','forum','nilai','pkl']){
            const r=await setup('#'+tab,tab==='pkl'?'PKL':'AKTIF');await r.evaluate(()=>window.audit.init());
            assert.equal(await r.locator('#tab-'+tab).isVisible(),true);await r.close();
        }
        assert.equal(external,0);assert.deepEqual(errors,[]);
    });
    await test('populated grade and PKL layouts fit desktop and mobile widths',async()=>{
        for(const width of [1280,390,320]){
            await q.setViewportSize({width,height:850});await q.evaluate(()=>window.audit.activateTab('pkl'));
            await q.screenshot({path:join(shots,'pkl-'+width+'.png'),fullPage:true});
            assert(await q.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
            await p.setViewportSize({width,height:850});await p.evaluate(()=>{window.audit.closeForumDetail();window.audit.activateTab('nilai');});
            await p.screenshot({path:join(shots,'nilai-'+width+'.png'),fullPage:true});
            assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
        }
    });
    await p.close();await q.close();
    console.log(`STUDENT_UI_COMPLETE: ${passed} passed; synthetic only; screenshots ${shots}`);
}finally{await context.close();await browser.close();}
