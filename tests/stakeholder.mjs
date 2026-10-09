// Actual markup, controller and API payloads; browser network blocked, synthetic identities.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

const read = file => readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const stripImports = source => source.replace(/^import[\s\S]*?;\r?\n/gm, '');
const api = read('stakeholder/js/api.js');
const apiPredicate = api.slice(api.indexOf('export function isActiveStakeholder('),api.indexOf('export async function loginWithIdentifier('));
const apiQueries = api.slice(api.indexOf('export async function getCurrentUserRow('));
const dashboardSource = stripImports(read('stakeholder/js/dashboard.js'));
const dashboard = dashboardSource.slice(0,dashboardSource.indexOf('init().catch('));
const browser = await chromium.launch({headless:true});
const context = await browser.newContext({timezoneId:'America/Los_Angeles'});
await context.route('**/*', route => route.abort());
let passed = 0;
const errors = [];
async function test(label, fn) { await fn(); console.log(`PASS UI ${++passed}: ${label}`); }
async function setup(file, script) {
    const page = await context.newPage();
    page.on('pageerror', err => errors.push(err.message));
    await page.clock.install({time:new Date('2026-09-30T17:30:00Z')});
    await page.setContent('<html><body></body></html>');
    await page.evaluate(markup => {
        document.body.innerHTML = new DOMParser().parseFromString(markup,'text/html').body.innerHTML;
        document.querySelectorAll('script').forEach(el=>el.remove());
    },read(file));
    await page.addStyleTag({content:read('stakeholder/css/stakeholder.css')});
    await page.addScriptTag({content:`
        var STAKEHOLDER_ROLES=['STAKEHOLDER'];
        var userRow={user_id:'stake-a',school_id:'school-a',full_name:'Synthetic Stakeholder',role_type:'STAKEHOLDER',is_active:true,deleted_at:null};
        var authUser={id:'auth-a'},signouts=[],redirects=[],calls=[],selections=[],intervals=[],pending=[];
        var manual=false,summaryError=null;
        var monitoringData={summary:{pct_siswa:70,pct_guru:80,siswa_hadir:7,siswa_total:10,guru_hadir:4,guru_total:5,count_late:2,count_exits:3},
            chart:[{date:'2026-10-01',pct_siswa:70,pct_guru:80,count_late:2,count_exits:3}],by_month:false,data_earliest:'2024-01-01'};
        var summaryData={total_siswa:10,total_pkl:2,total_staf:5,total_program:2,total_kelas:3,kehadiran_bulan_pct:80,sesi_hari_ini:3,hadir_hari_ini:7,updated_at:'2026-10-01T00:00:00Z'};
        class Query {
            constructor(table){this.table=table;}
            select(columns){selections.push(columns);return this;} eq(){return this;}
            async maybeSingle(){return {data:userRow,error:null};}
            async single(){return {data:{current_academic_year:'2026/2027'},error:null};}
        }
        var supabase={from:table=>new Query(table),auth:{
            getUser:async()=>({data:{user:authUser}}),signOut:async options=>{signouts.push(options);}
        },rpc:async(name,args)=>{
            calls.push({name,args});
            if(name==='fn_stakeholder_summary')return {data:summaryData,error:summaryError};
            if(manual)return new Promise(resolve=>pending.push(resolve));
            return {data:monitoringData,error:null};
        }};
        var charts=[];
        class Chart {
            constructor(canvas,config){this.config=config;this.destroyed=false;charts.push(this);}
            destroy(){this.destroyed=true;}
        }
        function applyBrandingById(){} function checkMustChangePassword(){} function initLoginGuard(){}
        function initSessionGuard(){} function showPwaBanner(){} function logout(){}
        function applyBranding(){return Promise.resolve({school_id:'school-a'});}
        function loginWithIdentifier(){return Promise.resolve();}
        function getLoginUrl(){return '/stakeholder/index.html';}
        var accessLocation={replace:url=>redirects.push(url)};
        setInterval=fn=>{intervals.push(fn);};
        ${apiPredicate.replaceAll('export ','')}
        ${apiQueries.replaceAll('export ','')}
        ${script.replaceAll('window.location.replace(', 'accessLocation.replace(')}
    `});
    return page;
}
try {
    const page = await setup('stakeholder/dashboard.html',dashboard);
    await test('active account loads actual API; user row explicitly selects deleted_at',async()=>{
        await page.evaluate(()=>init());
        assert.equal(await page.locator('#app').evaluate(el=>el.style.display),'block');
        assert.equal(await page.locator('#ks-pct-siswa').innerText(),'70%');
        assert((await page.evaluate(()=>selections)).some(columns=>columns.includes('deleted_at')));
    });
    await test('WIB range defaults work even with a non-WIB device clock',async()=>{
        assert.equal(await page.locator('#ks-range-start').inputValue(),'2026-09-25');
        assert.equal(await page.locator('#ks-range-end').inputValue(),'2026-10-01');
        await page.locator('.ks-period-btn[data-period="hari_ini"]').click();
        assert.deepEqual(await page.evaluate(()=>calls.at(-1)),{name:'fn_kepsek_monitoring',args:{
            p_period:'hari_ini',p_academic_year:null,p_date_start:null,p_date_end:null,
        }});
    });
    await test('refresh preserves the full custom date range',async()=>{
        await page.locator('#ks-range-start').fill('2026-08-15');
        await page.locator('#ks-range-end').fill('2026-09-17');
        await page.locator('#ks-range-btn').click();
        await page.locator('#refresh-btn').click();
        assert.deepEqual(await page.evaluate(()=>calls.filter(c=>c.name==='fn_kepsek_monitoring').at(-1).args),{
            p_period:'rentang',p_academic_year:null,p_date_start:'2026-08-15',p_date_end:'2026-09-17',
        });
    });
    await test('refresh preserves the previous academic year',async()=>{
        await page.locator('.ks-period-btn[data-period="tahun_ajaran_lalu"]').click();
        await page.locator('#refresh-btn').click();
        assert.deepEqual(await page.evaluate(()=>calls.filter(c=>c.name==='fn_kepsek_monitoring').at(-1).args),{
            p_period:'tahun_ajaran_lalu',p_academic_year:'2025/2026',p_date_start:null,p_date_end:null,
        });
    });
    await test('a slower old success cannot overwrite newest metrics/chart/filter',async()=>{
        await page.evaluate(()=>{
            manual=true;window.oldRequest=loadKepsekMonitoring('7_hari');window.newRequest=loadKepsekMonitoring('hari_ini');
        });
        await page.evaluate(async()=>{
            pending[1]({data:{...monitoringData,summary:{...monitoringData.summary,pct_siswa:90},
                chart:[{date:'2026-10-01',pct_siswa:90}]},error:null});await newRequest;
            pending[0]({data:{...monitoringData,summary:{...monitoringData.summary,pct_siswa:10},
                chart:[{date:'2026-09-30',pct_siswa:10}]},error:null});await oldRequest;
        });
        assert.equal(await page.locator('#ks-pct-siswa').innerText(),'90%');
        assert.equal(await page.evaluate(()=>_monitoringFilter.period),'hari_ini');
        assert.equal(await page.evaluate(()=>_ksChart.config.data.datasets[0].data[0]),90);
    });
    await test('a slower old error cannot erase the newest successful result',async()=>{
        await page.evaluate(()=>{pending=[];window.oldRequest=loadKepsekMonitoring('7_hari');window.newRequest=loadKepsekMonitoring('hari_ini');});
        await page.evaluate(async()=>{
            pending[1]({data:monitoringData,error:null});await newRequest;
            pending[0]({data:null,error:{message:'Old synthetic error'}});await oldRequest;
        });
        assert.equal(await page.locator('#ks-monitoring-error').evaluate(el=>el.style.display),'none');
        assert.equal(await page.locator('#ks-count-late').innerText(),'2 siswa');
    });
    await test('latest error clears all old counts, details and chart',async()=>{
        await page.evaluate(()=>{pending=[];window.newRequest=loadKepsekMonitoring('7_hari');});
        assert.equal(await page.evaluate(()=>_ksChart),null);
        await page.evaluate(async()=>{pending[0]({data:null,error:{message:'Latest synthetic error'}});await newRequest;manual=false;});
        for (const selector of ['#ks-pct-siswa','#ks-pct-guru','#ks-count-late','#ks-count-exits'])
            assert.equal(await page.locator(selector).innerText(),'—');
        assert.equal(await page.locator('#ks-chart-hint').innerText(),'');
        assert.equal(await page.locator('#ks-detail-guru').innerText(),'');
        assert.equal(await page.locator('#ks-monitoring-error').evaluate(el=>el.style.display),'block');
    });
    await test('null/zero denominator is unavailable; genuine zero attendance stays 0%',async()=>{
        await page.evaluate(async()=>{
            monitoringData.summary={pct_siswa:0,pct_guru:null,siswa_total:0,guru_total:0};
            monitoringData.chart=[{date:'2026-10-01',pct_siswa:null,pct_guru:null}];
            await loadKepsekMonitoring('hari_ini');
        });
        assert.equal(await page.locator('#ks-pct-siswa').innerText(),'—');
        assert.equal(await page.locator('#ks-pct-guru').innerText(),'—');
        assert.equal(await page.evaluate(()=>_ksChart.config.options.plugins.tooltip.callbacks.label({
            parsed:{y:null},dataset:{label:'Kehadiran',yAxisID:'y1'},
        })),'Kehadiran: —');
        await page.evaluate(async()=>{monitoringData.summary={pct_siswa:0,pct_guru:0,siswa_total:10,guru_total:5};await loadKepsekMonitoring('hari_ini');});
        assert.equal(await page.locator('#ks-pct-siswa').innerText(),'0%');
        assert.equal(await page.locator('#ks-pct-guru').innerText(),'0%');
    });
    await test('summary error clears stale values rather than displaying an earlier snapshot',async()=>{
        await page.evaluate(async()=>{summaryError={message:'Synthetic summary failure'};await loadSummary();});
        assert.equal(await page.locator('#st-siswa').innerText(),'—');
        assert.equal(await page.locator('#updated-at').innerText(),'—');
    });
    await test('metric and period controls remain visible at desktop/mobile widths',async()=>{
        for (const width of [1280,390]) {
            await page.setViewportSize({width,height:900});
            assert(await page.locator('#ks-range-btn').isVisible());
            assert(await page.locator('#refresh-btn').isVisible());
            const size = await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,width:innerWidth}));
            assert(size.scroll <= size.width,`overflow at ${width}`);
            await page.screenshot({path:join(tmpdir(),`sip-stakeholder-${width}.png`),fullPage:true});
        }
    });
    await test('account revoked during in-flight request hides dashboard and discards response',async()=>{
        await page.evaluate(async()=>{
            pending=[];manual=true;window.newRequest=loadKepsekMonitoring('7_hari');userRow.is_active=false;
            await verifyStakeholderAccess();pending[0]({data:monitoringData,error:null});await newRequest;
        });
        assert.equal(await page.locator('#app').evaluate(el=>el.style.display),'none');
        assert.equal(await page.evaluate(()=>_ksChart),null);
        assert.deepEqual(await page.evaluate(()=>signouts),[{scope:'local'}]);
        assert.equal(await page.evaluate(()=>redirects.at(-1)),'/stakeholder/index.html');
    });
    await page.close();
    await test('startup denies inactive/deleted/null-active/wrong-role/missing rows before any RPC',async()=>{
        for (const change of [{is_active:false},{deleted_at:'2026-10-01'},{is_active:null},{role_type:'GURU'},null]) {
            const denied = await setup('stakeholder/dashboard.html',dashboard);
            await denied.evaluate(async change=>{userRow=change?{...userRow,...change}:null;await init();},change);
            assert.equal(await denied.evaluate(()=>calls.length),0);
            assert.deepEqual(await denied.evaluate(()=>signouts),[{scope:'local'}]);
            assert.notEqual(await denied.locator('#app').evaluate(el=>el.style.display),'block');
            await denied.close();
        }
    });
    await test('visible session revalidation detects deactivation without reloading',async()=>{
        const guarded = await setup('stakeholder/dashboard.html',dashboard);
        await guarded.evaluate(async()=>{await init();userRow.deleted_at='2026-10-01';window.dispatchEvent(new Event('focus'));});
        await guarded.waitForFunction(()=>signouts.length===1);
        assert.equal(await guarded.locator('#app').evaluate(el=>el.style.display),'none');
        assert.equal(await guarded.evaluate(()=>intervals.length),1);
        await guarded.close();
    });
    await test('login rejects disabled/deleted sessions and submitted credentials locally',async()=>{
        const auth = stripImports(read('stakeholder/js/auth.js'));
        for (const change of [{is_active:false},{deleted_at:'2026-10-01'}]) {
            const login = await setup('stakeholder/index.html',`userRow={...userRow,...${JSON.stringify(change)}};${auth}`);
            await login.waitForFunction(()=>signouts.length===1);
            assert.equal(await login.evaluate(()=>redirects.length),0);
            await login.locator('#identifier').fill('synthetic');
            await login.locator('#password').fill('synthetic');
            await login.locator('#login-btn').click();
            await login.waitForFunction(()=>signouts.length===2);
            assert.equal(await login.locator('#login-error').evaluate(el=>el.style.display),'block');
            assert.deepEqual(await login.evaluate(()=>signouts),[{scope:'local'},{scope:'local'}]);
            await login.close();
        }
    });
    assert.deepEqual(errors,[]);
    console.log(`${passed} stakeholder browser tests passed; network blocked.`);
} finally { await browser.close(); }
