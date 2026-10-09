// Browser regressions with actual Waka Humas markup, handlers and API functions.
// Synthetic data only; all external browser requests are blocked.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const read = file => readFileSync(new URL('../'+file,import.meta.url),'utf8').replaceAll('\r\n','\n');
function region(source,first,last) {
    const start=source.indexOf(first),end=source.indexOf(last,start+first.length);
    assert(start>=0 && end>start,first);return source.slice(start,end).replaceAll('export ','');
}
const source=read('guru/js/dashboard.js'),api=read('guru/js/api.js');
const browser=await chromium.launch({headless:true});
const context=await browser.newContext();
await context.route('**/*',route=>route.abort());
const page=await context.newPage();
const errors=[];page.on('pageerror',err=>errors.push(err.message));
let passed=0;
async function test(label,fn){await fn();console.log(`PASS UI ${++passed}: ${label}`);}
try {
    await page.setContent('<html><body></body></html>');
    await page.evaluate(markup=>{
        const doc=new DOMParser().parseFromString(markup,'text/html');
        document.body.innerHTML=doc.getElementById('tab-waka_humas').outerHTML;
    },read('guru/dashboard.html'));
    await page.addScriptTag({content:`
        var currentUser={school_id:'school-a'},rpcError=null;
        var studentRows=[
            {student_id:'a',full_name:'Student A',nis:'001',program:{name:'Program A'},placements:[
                {placement_id:'old',is_active:false,dudi:{dudi_org_name:'Old company'}},
                {placement_id:'active',is_active:true,start_date:'2026-09-01',end_date:'2026-12-01',dudi:{dudi_org_name:'Current company'}}]},
            {student_id:'b',full_name:'Student B',nis:'002',program:{name:'Program B'},placements:[
                {placement_id:'old-b',is_active:false,start_date:'2025-09-01',end_date:'2025-12-01',dudi:{dudi_org_name:'Past company'}}]},
            {student_id:'c',full_name:'Student C',nis:'003',program:{name:'Program B'},placements:[]}
        ];
        var recapRows=[{student_id:'a',hadir:4,alpa:1,izin:1,sakit:1,total:7},
            {student_id:'b',hadir:0,alpa:0,izin:0,sakit:0,total:0},
            {student_id:'c',hadir:0,alpa:0,izin:0,sakit:0,total:0}];
        var caseRows=[{student:{full_name:'Student A'},title:'PKL case',status:'MONITORING',
            handler:{full_name:'Handler name'},created_at:'2026-10-01'}];
        function localDateStr(){return '2026-10-09';}
        function esc(v){return String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');}
        function fmt(v){return v??'—';}
        function fe(e){return e.message;}
        const DIMENSION_LABELS={};
        var supabase={
            from(){return {select(){return this;},eq(){return this;},order:async()=>({data:studentRows,error:null})};},
            rpc:async()=>({data:recapRows,error:rpcError})
        };
        async function fetchAllDudiPartners(){return [];}
        async function fetchDudiObservations(){return [];}
        async function getOpenCases(){return caseRows;}
        ${region(api,'export async function fetchAllPklStudents()','// Semua mitra DUDI')}
        ${region(api,'export async function fetchPklAttendance(','export async function fetchDudiObservations(')}
        ${region(source,'const CASE_STATUS_LABEL =','const CASE_STATUS_BADGE =')}
        ${region(source,'let whStudents =','// \u2500\u2500\u2500 TAB KEPSEK')}
    `});
    await test('only active placements count and historical company/period do not appear',async()=>{
        await page.evaluate(()=>initWakaHumasTab());
        assert.equal(await page.locator('#wh-stat-total').innerText(),'3');
        assert.equal(await page.locator('#wh-stat-placed').innerText(),'1');
        const rows=page.locator('#wh-students-body tr');
        assert((await rows.nth(0).innerText()).includes('Current company'));
        assert((await rows.nth(1).innerText()).includes('Belum'));
        assert(!(await rows.nth(1).innerText()).includes('Past company'));
        assert(!(await rows.nth(1).innerText()).includes('2025'));
    });
    await test('aggregate counts render correctly: 4/7 present equals 57 percent',async()=>{
        assert.deepEqual(await page.locator('#wh-recap-body tr').nth(0).locator('td').allTextContents(),
            ['Student A','Program A','4','1','1','1','57%']);
        assert.equal(await page.locator('#wh-recap-body tr').nth(1).locator('td').last().innerText(),'—');
    });
    await test('case stage uses the shared status label rather than handler name',async()=>{
        assert.equal(await page.locator('#wh-cases-body td').nth(2).innerText(),await page.evaluate(()=>CASE_STATUS_LABEL.MONITORING));
        assert(!(await page.locator('#wh-cases-body').innerText()).includes('Handler name'));
    });
    await test('zero aggregate totals show the empty state instead of invented 0 percent attendance',async()=>{
        await page.evaluate(async()=>{recapRows=recapRows.map(r=>({...r,hadir:0,alpa:0,izin:0,sakit:0,total:0}));await loadWhRecap();});
        assert.equal(await page.locator('#wh-recap-body').innerHTML(),'');
        assert.equal(await page.locator('#wh-recap-empty').evaluate(el=>el.style.display),'block');
    });
    await test('recap API outage remains visible and is not mistaken for empty data',async()=>{
        await page.evaluate(async()=>{rpcError=new Error('Synthetic outage');await loadWhRecap();});
        assert((await page.locator('#wh-recap-body').innerText()).includes('Synthetic outage'));
        assert.equal(await page.locator('#wh-recap-empty').evaluate(el=>el.style.display),'none');
    });
    assert.deepEqual(errors,[]);
    console.log(`WAKA_HUMAS_UI_COMPLETE: ${passed} checks passed; synthetic browser data only.`);
} finally { await browser.close(); }
