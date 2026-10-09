import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';

const source = readFileSync(new URL('../admin/js/wizard.js', import.meta.url), 'utf8');
const names = ['parseForumCsv', 'importForumBk', 'importForumGuruWali', 'importDutySchedule',
    'renderForumImportResult', 'renderWzFkBkTab', 'renderWzFkGuruWaliTab', 'renderWzGpTab',
    'fileToCsv', 'stripLeadingApostropheCells', 'stripLeadingApostropheCsv'];
const functions = names.map(name => {
    const definition = source.match(new RegExp(`(?:async )?function ${name}\\([\\s\\S]*?\\n}`))?.[0];
    assert.ok(definition, name);
    return definition;
}).join('\n');
// Fetch only the existing pinned public dependency; browser requests are blocked below.
const response = await fetch('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js');
assert.ok(response.ok, `SheetJS HTTP ${response.status}`);
const sheetJs = await response.text();
assert.equal(createHash('sha384').update(sheetJs).digest('base64'),
    'vtjasyidUo0kW94K5MXDXntzOJpQgBKXmE7e2Ga4LG0skTTLeBi97eFAXsqewJjw');
const screenshots = mkdtempSync(join(tmpdir(), 'sip-forum-assignments-'));
const browser = await chromium.launch({ headless: true });
let passed = 0;
async function test(label, fn) {
    await fn();
    console.log(`PASS UI ${++passed}: ${label}`);
}
const definitions = [
    { fn:'renderWzFkBkTab', importer:'importForumBk', prefix:'wz-fk-bk',
        csv:'"nama_kelas","kode_program","nip_bk"\r\n"X, SINTETIS",TKJ,"00123456789012345678"\r\n"X, SINTETIS",TKJ,"00123456789012345678"\r\n"X, SINTETIS",TKJ,UNKNOWN' },
    { fn:'renderWzFkGuruWaliTab', importer:'importForumGuruWali', prefix:'wz-fk-gw',
        csv:'"nis_siswa","nama_siswa","nip_guru_wali"\r\n"001","Siswa, \"\"Sintetis\"\"\nMultiline","00123456789012345678"\r\n"001",Siswa,"00123456789012345678"\r\n001,Siswa,UNKNOWN' },
    { fn:'renderWzGpTab', importer:'importDutySchedule', prefix:'wz-gp',
        csv:'"nama_guru","nip_guru","hari"\r\n"Guru, Sintetis","00123456789012345678",SENIN\r\nGuru,"00123456789012345678",SENIN\r\nGuru,UNKNOWN,SELASA' },
];
try {
    for (const viewport of [{ width:1280, height:800 }, { width:390, height:844 }]) {
        const page = await browser.newPage({ viewport });
        const pageErrors = [];
        page.on('pageerror', error => pageErrors.push(error.message));
        await page.route('**/*', route => route.abort());
        await page.setContent('<html class="page-wizard"><body class="page-wizard"><main class="wz-shell"><div id="wz-forum-tab-content"></div></main></body></html>');
        await page.addStyleTag({ content:readFileSync(new URL('../admin/css/admin.css', import.meta.url), 'utf8') });
        await page.addScriptTag({ content:sheetJs });
        await page.addScriptTag({ content:`
            const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c =>
                ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
            const esc = escapeHtml;
            const confirm = () => true;
            const EXCEL_TEMPLATES = {};
            const VALID_DAYS = new Set(['SENIN','SELASA','RABU','KAMIS','JUMAT','SABTU']);
            const staff = [{user_id:'u1',full_name:'Guru Sintetis',login_identifier:'00123456789012345678',role_type:'GURU'}];
            let _wzFkClasses = [{class_id:'c1',program_id:'p1',name:'X, SINTETIS'}];
            let _wzFkBkStaff = staff, _wzFkGuruWaliCands = staff, _wzGpStaff = staff;
            let _wzFkBkAssignments = [], _wzFkGwAssignments = [], _wzGpSchedules = [];
            let _wzFkAcademicYear = '2026/2027', _wzGpAcademicYear = '2026/2027', _wzGpSemester = 1;
            let _wzFkCurrentUserId = 'admin', studentReadError = null;
            const getSchoolConfig = async () => ({current_academic_year:'2026/2027',current_semester:1,school_id:'school'});
            const getCurrentUserRow = async () => ({user_id:'admin'});
            const getClasses = async () => _wzFkClasses;
            const getPrograms = async () => [{program_id:'p1',name:'SINTETIS',code:'TKJ'}];
            const getForumBkStaff = async () => staff;
            const getForumGuruWaliCandidates = async () => staff;
            const getDutyStaffCandidates = async () => staff;
            const getBkAssignments = async () => _wzFkBkAssignments;
            const getGuruWaliAssignments = async () => _wzFkGwAssignments;
            const getDutySchedules = async () => _wzGpSchedules;
            const assignBkToClass = async (class_id,bk_user_id) => {
                if (_wzFkBkAssignments.length) return 'exists';
                _wzFkBkAssignments.push({assignment_id:'a1',class_id,bk_user_id}); return 'a1';
            };
            const assignGuruWaliToStudent = async (student_id,guru_user_id) => {
                if (_wzFkGwAssignments.length) return 'exists';
                _wzFkGwAssignments.push({assignment_id:'a1',student_id,guru_user_id}); return 'a1';
            };
            const assignDutySchedule = async (user_id,day_of_week) => {
                if (_wzGpSchedules.length) return 'exists';
                _wzGpSchedules.push({duty_id:'d1',user_id,day_of_week}); return 'd1';
            };
            const supabase = { from(table) {
                const query = {
                    select(){return query;},eq(){return query;},is(){return query;},
                    then(resolve,reject){
                        const student = {student_id:'s1',full_name:'Siswa Sintetis',nis:'001'};
                        return Promise.resolve({data:table==='students'?[student]:[{student}],
                            error:table==='students'?studentReadError:null}).then(resolve,reject);
                    }
                }; return query;
            }};
            function resetAssignments() {
                _wzFkBkAssignments = []; _wzFkGwAssignments = []; _wzGpSchedules = [];
            }
        ` + functions });
        await test(`CSV keeps BOM, quotes, long NIP, leading zeros and blank row numbers (${viewport.width})`, async () => {
            const parsed = await page.evaluate(() => parseForumCsv(
                '\uFEFF"nis_siswa","nip_guru_wali"\r\n001,"\'00123456789012345678"\r\n,\r\n002,UNKNOWN',
                ['nis_siswa','nip_guru_wali']));
            assert.deepEqual(parsed.lines, [
                ['nis_siswa','nip_guru_wali'], ['001','00123456789012345678'], ['',''], ['002','UNKNOWN']
            ]);
        });
        await test(`missing header fails clearly (${viewport.width})`, async () => {
            const message = await page.evaluate(() => {
                try { parseForumCsv('nis_siswa\n001', ['nis_siswa','nip_guru_wali']); }
                catch (error) { return error.message; }
            });
            assert.match(message, /Kolom wajib: nis_siswa, nip_guru_wali/);
        });
        for (const definition of definitions) {
            await test(`mixed import summary survives real rerender: ${definition.importer} (${viewport.width})`, async () => {
                await page.evaluate(fn => { resetAssignments(); return window[fn](); }, definition.fn);
                await page.locator(`#${definition.prefix}-file`).setInputFiles({
                    name:'synthetic.csv',mimeType:'text/csv',buffer:Buffer.from(definition.csv)
                });
                await page.locator(`#${definition.prefix}-import-btn`).click();
                await page.waitForFunction(id => document.getElementById(id)?.textContent.includes('UNKNOWN'), `${definition.prefix}-result`);
                const text = await page.locator(`#${definition.prefix}-result`).textContent();
                assert.match(text, /1 penugasan berhasil/);
                assert.match(text, /1 baris dilewati/);
                assert.equal(await page.locator(`#${definition.prefix}-result .alert-danger`).count(), 1);
                assert.match(text, /Baris 4/);
                assert.match(text, /UNKNOWN/);
                assert.equal(await page.locator(`#${definition.prefix}-result`).evaluate(node => node.isConnected), true);
                await page.screenshot({ path:join(screenshots, `${definition.prefix}-${viewport.width}.png`), fullPage:true });
            });
            await test(`Excel upload preserves identifiers and mixed results: ${definition.importer} (${viewport.width})`, async () => {
                const bytes = await page.evaluate(csv => {
                    const workbook = XLSX.read(csv, {type:'string',raw:true,FS:','});
                    return Array.from(new Uint8Array(XLSX.write(workbook, {type:'array',bookType:'xlsx'})));
                }, definition.csv);
                await page.evaluate(fn => { resetAssignments(); return window[fn](); }, definition.fn);
                await page.locator(`#${definition.prefix}-file`).setInputFiles({
                    name:'synthetic.xlsx', mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                    buffer:Buffer.from(bytes),
                });
                await page.locator(`#${definition.prefix}-import-btn`).click();
                await page.waitForFunction(id => document.getElementById(id)?.textContent.includes('UNKNOWN'), `${definition.prefix}-result`);
                const text = await page.locator(`#${definition.prefix}-result`).textContent();
                assert.match(text, /1 penugasan berhasil/);
                assert.match(text, /1 baris dilewati/);
                assert.match(text, /Baris 4/);
            });
            await test(`all-error import remains visible and retry enabled: ${definition.importer} (${viewport.width})`, async () => {
                await page.evaluate(fn => { resetAssignments(); return window[fn](); }, definition.fn);
                await page.locator(`#${definition.prefix}-file`).setInputFiles({
                    name:'synthetic.csv', mimeType:'text/csv',
                    buffer:Buffer.from(definition.csv.replaceAll('00123456789012345678', 'UNKNOWN')),
                });
                await page.locator(`#${definition.prefix}-import-btn`).click();
                await page.waitForFunction(id => document.getElementById(id)?.textContent.includes('UNKNOWN'), `${definition.prefix}-result`);
                assert.equal(await page.locator(`#${definition.prefix}-result .alert-success`).count(), 0);
                assert.equal(await page.locator(`#${definition.prefix}-import-btn`).isEnabled(), true);
            });
        }
        await test(`student query errors are not mislabeled as missing NIS (${viewport.width})`, async () => {
            const message = await page.evaluate(async () => {
                studentReadError = {message:'SYNTHETIC DATABASE ERROR'};
                try { await importForumGuruWali('nis_siswa,nip_guru_wali\n001,00123456789012345678'); }
                catch (error) { return error.message; }
                finally { studentReadError = null; }
            });
            assert.equal(message, 'SYNTHETIC DATABASE ERROR');
        });
        assert.deepEqual(pageErrors, []);
        await page.close();
    }
    console.log(`TOTAL ${passed} browser scenarios passed; synthetic data, browser network blocked.`);
    console.log(`Screenshots: ${screenshots}`);
} finally { await browser.close(); }
