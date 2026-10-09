// Actual TU markup, event handlers and API payloads; browser network blocked.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const read = file => readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const api = read('tu/js/api.js');
const source = read('tu/js/portal.js').replace(/^import[\s\S]*?;\r?\n/gm, '');
const script = source.slice(0, source.indexOf('init().catch('));
const browser = await chromium.launch({headless:true});
const context = await browser.newContext();
await context.route('**/*', route => route.abort());
const page = await context.newPage();
const errors = []; page.on('pageerror', err => errors.push(err.message));
let passed = 0;
async function test(label, fn) { await fn(); console.log(`PASS UI ${++passed}: ${label}`); }
function apiRegion(first, last) {
    const start = api.indexOf(first), end = last ? api.indexOf(last, start) : api.length;
    assert(start >= 0 && end > start); return api.slice(start,end).replaceAll('export ', '');
}
try {
    await page.setContent('<html><body></body></html>');
    await page.evaluate(markup => {
        document.body.innerHTML = new DOMParser().parseFromString(markup,'text/html').body.innerHTML;
    }, read('tu/portal.html'));
    await page.addStyleTag({content:read('tu/css/tu.css')});
    await page.addScriptTag({content:`
        var userRow = {user_id:'tu-a',school_id:'school-a',role_type:'TU',is_active:true,deleted_at:null};
        var postRow = {post_id:'post-a',school_id:'school-a',author_user_id:'tu-a',title:'Judul lama',
            body:'Isi lama\\nBaris kedua',attachment_name:'dokumen.pdf',attachment_path:'school-a/old.pdf',
            created_at:'2026-10-09T01:00:00Z',is_withdrawn:false};
        var comments=[],uploads=[],removed=[],updates=[],signouts=[],redirects=[],intervals=[];
        var commentError=null,attachmentError=null;
        var scope={role_type:'TU'};
        class Query {
            constructor(table){this.table=table;this.filters={};}
            select(){return this;} eq(key,value){this.filters[key]=value;return this;}
            is(){return this;} in(){return this;} order(){return this;} range(){return this;}
            insert(row){this.insertRow=row;return this;} update(row){this.updateRow=row;return this;}
            upsert(){return this;}
            async maybeSingle(){return {data:this.table==='users'?userRow:postRow,error:null};}
            then(resolve,reject){return this.run().then(resolve,reject);}
            async run(){
                if(this.insertRow){
                    if(commentError)return {error:commentError};
                    comments.push({...this.insertRow,comment_id:'comment-'+comments.length,
                        created_at:'2026-10-09T02:00:00Z',author:{full_name:'Synthetic TU'}});
                }
                if(this.updateRow){
                    if(this.updateRow.attachment_path && attachmentError)return {error:attachmentError};
                    updates.push({id:this.filters.post_id,...this.updateRow}); Object.assign(postRow,this.updateRow);
                }
                return {data:this.table==='forum_post_comments'?comments:this.table==='forum_posts'?[postRow]:[],error:null};
            }
        }
        var supabase={
            from:table=>new Query(table),
            auth:{getUser:async()=>({data:{user:{id:'auth-a'}}}),signOut:async options=>{signouts.push(options);}},
            rpc:name=>({maybeSingle:async()=>({data:scope}),then:resolve=>Promise.resolve({data:[],error:null}).then(resolve)}),
            storage:{from:()=>({
                createSignedUrl:async()=>({data:{signedUrl:'https://example.invalid/signed.pdf'}}),
                upload:async(path)=>{uploads.push(path);return {error:null};},
                remove:async(paths)=>{removed.push(...paths);return {error:null};}
            })}
        };
        function getLoginUrl(){return '/tu/index.html';}
        var accessLocation={replace:url=>redirects.push(url)};
        var nativeSetInterval=setInterval;setInterval=fn=>{intervals.push(fn);};
        function ackWithRetry(){} function initAckQueue(){} function registerAckHandler(){}
        ${apiRegion('export async function getCurrentUserRow(', 'export async function fetchSchoolConfig(')}
        ${apiRegion('export async function getForumSekolahPosts(')}
        ${script.replaceAll('window.location.replace(getLoginUrl())','accessLocation.replace(getLoginUrl())')}
        currentUser=userRow;schoolConfig={current_academic_year:'2026/2027'};
    `});
    await page.evaluate(async()=>{showTab('section-forum',{noHistory:true});await initForumSection();await openForumDetail(postRow);});
    await test('Edit click prefills old title/body/attachment and closes the detail modal',async()=>{
        await page.locator('#btn-forum-edit').click();
        assert.equal(await page.locator('#forum-input-title').inputValue(),'Judul lama');
        assert.equal(await page.locator('#forum-input-body').inputValue(),'Isi lama\nBaris kedua');
        assert.equal(await page.locator('#forum-file-name').innerText(),'dokumen.pdf');
        assert.equal(await page.locator('#forum-recipient-field').evaluate(el=>el.style.display),'none');
        assert.equal(await page.locator('#modal-forum-detail').evaluate(el=>el.style.display),'none');
    });
    await test('saving untouched edit preserves content, attachment and existing audience',async()=>{
        await page.locator('#btn-forum-modal-simpan').click();
        await page.waitForFunction(()=>document.getElementById('modal-forum-post').style.display==='none');
        const state=await page.evaluate(()=>({title:postRow.title,body:postRow.body,path:postRow.attachment_path,
            uploads,removed,update:updates[0]}));
        assert.equal(state.title,'Judul lama');assert.equal(state.body,'Isi lama\nBaris kedua');
        assert.equal(state.path,'school-a/old.pdf');assert.deepEqual(state.uploads,[]);assert.deepEqual(state.removed,[]);
        assert(!('attachment_path' in state.update));assert(!('audience' in state.update));
    });
    await test('edit replaces attachment and removes only the previous file after successful save',async()=>{
        await page.evaluate(()=>openForumModal(postRow));
        await page.locator('#forum-input-file').setInputFiles({name:'replacement.pdf',mimeType:'application/pdf',buffer:Buffer.from('synthetic pdf')});
        await page.locator('#btn-forum-modal-simpan').click();
        await page.waitForFunction(()=>document.getElementById('modal-forum-post').style.display==='none');
        const state=await page.evaluate(()=>({post:postRow,uploads,removed}));
        assert.equal(state.post.attachment_path,state.uploads[0]);assert.equal(state.post.attachment_name,'replacement.pdf');
        assert.deepEqual(state.removed,['school-a/old.pdf']);
    });
    await test('failed attachment replacement retains old attachment and cleans the new upload',async()=>{
        const oldPath=await page.evaluate(()=>postRow.attachment_path);
        await page.evaluate(()=>{attachmentError={message:'Synthetic attachment failure'};openForumModal(postRow);});
        await page.locator('#forum-input-file').setInputFiles({name:'failed.docx',mimeType:'application/octet-stream',buffer:Buffer.from('synthetic')});
        page.once('dialog',dialog=>dialog.accept());
        await page.locator('#btn-forum-modal-simpan').click();
        await page.waitForFunction(()=>removed.length===2);
        assert.equal(await page.evaluate(()=>postRow.attachment_path),oldPath);
        assert.equal(await page.evaluate(()=>removed[1]),await page.evaluate(()=>uploads[1]));
        await page.evaluate(()=>{attachmentError=null;});
    });
    await test('new draft clears edit values and restores recipient controls',async()=>{
        await page.locator('#btn-forum-buat').click();
        assert.equal(await page.locator('#forum-input-title').inputValue(),'');
        assert.equal(await page.locator('#forum-input-body').inputValue(),'');
        assert.equal(await page.locator('#forum-file-name').innerText(),'');
        assert.equal(await page.locator('#forum-recipient-field').evaluate(el=>el.style.display),'');
        await page.locator('#btn-forum-modal-batal').click();
    });
    await test('comment click sends TU author identity and refreshes comment list',async()=>{
        await page.evaluate(()=>openForumDetail(postRow));
        await page.locator('#forum-comment-input').fill('Komentar sintetis');
        await page.locator('#btn-forum-comment-submit').click();
        await page.waitForFunction(()=>comments.length===1);
        assert.deepEqual(await page.evaluate(()=>({post:comments[0].post_id,school:comments[0].school_id,author:comments[0].author_user_id})),
            {post:'post-a',school:'school-a',author:'tu-a'});
        assert((await page.locator('#detail-forum-comments-list').innerText()).includes('Komentar sintetis'));
        assert.equal(await page.locator('#forum-comment-input').inputValue(),'');
    });
    await test('rejected comment remains editable and displays the error',async()=>{
        await page.evaluate(()=>{commentError={message:'Synthetic comment denial'};});
        await page.locator('#forum-comment-input').fill('Belum tersimpan');
        await page.locator('#btn-forum-comment-submit').click();
        await page.waitForFunction(()=>document.getElementById('forum-comment-error').style.display==='block');
        assert.equal(await page.locator('#forum-comment-input').inputValue(),'Belum tersimpan');
        assert.equal(await page.evaluate(()=>comments.length),1);
    });
    await test('active TU stays signed in; inactive/deleted/wrong-role/missing identities sign out locally',async()=>{
        assert.equal(await page.evaluate(()=>verifyTuAccess()),true);
        for (const change of [{is_active:false},{deleted_at:'2026-10-09'},{role_type:'GURU'},null]) {
            const result=await page.evaluate(async change=>{
                userRow=change?{user_id:'tu-a',school_id:'school-a',role_type:'TU',is_active:true,deleted_at:null,...change}:null;
                return await verifyTuAccess();
            },change);
            assert.equal(result,false);
        }
        assert.deepEqual(await page.evaluate(()=>signouts),Array(4).fill({scope:'local'}));
        assert.deepEqual(await page.evaluate(()=>redirects),Array(4).fill('/tu/index.html'));
    });
    await test('visible-tab periodic guard detects deactivation of an existing session',async()=>{
        await page.evaluate(async()=>{
            userRow={user_id:'tu-a',school_id:'school-a',role_type:'TU',is_active:true,deleted_at:null};
            await verifyTuAccess();initTuAccessGuard();userRow.is_active=false;await intervals[0]();
        });
        assert.equal(await page.evaluate(()=>signouts.length),5);
    });
    await test('edit fields remain usable at desktop and mobile widths',async()=>{
        await page.evaluate(()=>{currentUser={user_id:'tu-a'};openForumModal(postRow);});
        for (const width of [1280,390]) {
            await page.setViewportSize({width,height:900});
            const title=await page.locator('#forum-input-title').boundingBox();
            const body=await page.locator('#forum-input-body').boundingBox();
            assert(title.width>0 && body.width>0);assert(title.y+title.height<=body.y);
            assert((await page.screenshot()).length>1000);
        }
    });
    assert.deepEqual(errors,[]);
    console.log(`TU_PORTAL_UI_COMPLETE: ${passed} checks passed; synthetic browser data only.`);
} finally { await browser.close(); }
