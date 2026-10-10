// API and shared queue tests with synthetic responses; no remote connections.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const read = path => readFileSync(new URL('../'+path,import.meta.url),'utf8');
let passed=0;
const test=async(name,run)=>{await run();console.log(`PASS STUDENT API/QUEUE ${++passed}: ${name}`);};
const quiet={warn(){},error(){},log(){}};
function api(portal) {
    const state={queries:[],rpcs:[],data:[],error:null,labels:[],history:[]};
    const supabase={from:table=>{
        const q={table,calls:[]};state.queries.push(q);
        for(const name of ['select','eq','is','order','range','gte','lte','limit','maybeSingle'])
            q[name]=(...args)=>{q.calls.push([name,...args]);return q;};
        q.then=(ok,fail)=>Promise.resolve({data:structuredClone(state.data),error:state.error}).then(ok,fail);
        return q;
    },rpc:async(name,args)=>{
        state.rpcs.push({name,args});
        return {data:structuredClone(name==='fn_portal_attendance'?state.history:state.labels.filter(r=>args.p_user_ids.includes(r.user_id))),error:state.error};
    }};
    const ctx=vm.createContext({console:quiet,supabase,Date,Map,localStorage:{}});
    const source=read(portal+'/js/api.js').replace(/^import[^\n]*\n/gm,'')
        .replace(/export /g,'').replace(/const supabase = createClient[\s\S]*?\n\}\);/,'');
    vm.runInContext(read('shared/portal-user-labels.js').replace(/export /g,'')+'\n'+source,ctx);
    return {ctx,state};
}
for (const portal of ['student','parent']) {
    const {ctx,state}=api(portal);
    state.labels=[{user_id:'teacher',full_name:'Guru Sintetis',role_type:'GURU'},
        {user_id:'dudi',full_name:'Mitra',dudi_org_name:'Mitra Sintetis',role_type:'DUDI'},
        {user_id:'tu',full_name:'TU Sintetis',role_type:'TU'}];
    await test(portal+' schedule resolves safe name without nested account query',async()=>{
        state.data=[{scheduled_teacher_id:'teacher',session_start:'07:00',session_end:'08:00'}];
        const rows=portal==='student'?await ctx.getScheduleForDate('class','2026-10-10'):await ctx.fetchSchedule('class','2026-10-10','school');
        assert.equal(portal==='student'?rows[0].teacher.full_name:rows[0].teacher,'Guru Sintetis');
        assert(!state.queries.at(-1).calls.find(c=>c[0]==='select')[1].includes('users'));
    });
    await test(portal+' PKL, observation, case handler and event names remain populated',async()=>{
        state.data=portal==='student'?[{placement_id:'p',is_active:true,dudi_user_id:'dudi'}]:{placement_id:'p',dudi_user_id:'dudi'};
        const p=portal==='student'?await ctx.getMyPklPlacement('student'):await ctx.fetchPklPlacement('student');
        assert.equal(portal==='student'?p.dudi.dudi_org_name:p.dudi_name,'Mitra Sintetis');
        state.data=[{observation_id:'o',author_user_id:'tu',observed_at:'2026-10-10'}];
        const obs=portal==='student'?await ctx.getMyObservations('student'):await ctx.fetchObservations('student');
        assert.equal(portal==='student'?obs[0].author.full_name:obs[0].author,'TU Sintetis');
        state.data=[{current_handler_user_id:'tu',events:[{author_user_id:'tu',is_visible_to_student:true}]}];
        const cases=portal==='student'?await ctx.getMyCases('student'):await ctx.fetchCases('student');
        assert.equal(cases[0].handler.full_name,'TU Sintetis');assert.equal(cases[0].events[0].author.full_name,'TU Sintetis');
    });
    await test(portal+' forum resolves author and preserves school scope/audience',async()=>{
        state.data=[{post_id:'p',author_user_id:'tu',forum_post_audience:[{user_id:'self'}]}];
        const rows=await ctx.getForumSekolahPosts('school','self');
        assert.equal(rows[0].author.full_name,'TU Sintetis');assert(!rows[0].forum_post_audience);
        const calls=state.queries.at(-1).calls;
        assert(calls.some(c=>c[1]==='scope_type'&&c[2]==='SEKOLAH'));
        assert(calls.some(c=>c[1]==='school_id'&&c[2]==='school'));
        assert(calls.some(c=>c[1]==='forum_post_audience.user_id'&&c[2]==='self'));
    });
    await test(portal+' failed identity lookup is an error, not a successful nameless list',async()=>{
        state.error=new Error('network failed');await assert.rejects(()=>ctx.getForumSekolahPosts('school','self'));
        state.error=null;
    });
}
const {ctx:student,state}=api('student');
await test('student PKL attendance requires and filters placement, returning its identity',async()=>{
    await assert.rejects(()=>student.getMyPklAttendance('s'));
    await student.getMyPklAttendance('s','p');
    const calls=state.queries.at(-1).calls;
    assert(calls.some(c=>c[1]==='student_id'&&c[2]==='s'));
    assert(calls.some(c=>c[1]==='placement_id'&&c[2]==='p'));
    assert(calls.find(c=>c[0]==='select')[1].includes('placement_id'));
});
await test('student lateness and exit errors propagate; real empty results stay empty',async()=>{
    for(const name of ['getMyLateArrivals','getMyExits']){
        state.error=new Error('network failed');await assert.rejects(()=>student[name]('s'));
        state.error=null;assert.equal((await student[name]('s')).length,0);
    }
});
await test('attendance RPC preserves block grouping, mixed states and historical slots',async()=>{
    state.history=[{block_group_id:'b',session_date:'2026-06-01',session_start:'07:00',session_end:'07:45',subject:{name:'Mapel'},teacher:{full_name:'Guru'},attendance:[{status:'EKSKUL'}]},
        {block_group_id:'b',session_date:'2026-06-01',session_start:'07:45',session_end:'08:30',attendance:[{status:'ALPA',notes:'Catatan'}]}];
    const rows=await student.getMyAttendance('s','2026-01-01','2026-10-10');
    assert.equal(rows.length,1);assert.equal(rows[0].summary_status,'CAMPURAN');assert.equal(rows[0].slots[0].status,'HADIR');
    assert.equal(rows[0].time_range,'07:00 – 08:30');
    assert.deepEqual(JSON.parse(JSON.stringify(state.rpcs.at(-1).args)),{p_student_id:'s',p_date_start:'2026-01-01',p_date_end:'2026-10-10'});
});
await test('safe label helper batches and deduplicates identity IDs',async()=>{
    state.rpcs=[];state.labels=Array.from({length:205},(_,i)=>({user_id:'u'+i,full_name:'Nama'+i}));
    const rows=state.labels.map(l=>({id:l.user_id}));rows.push({id:'u0'});
    await student.attachPortalUserLabels({rpc:async(name,args)=>{state.rpcs.push(args);return {data:state.labels.filter(l=>args.p_user_ids.includes(l.user_id))};}},rows,[['author','id']]);
    assert.equal(state.rpcs.length,3);assert.equal(state.rpcs[0].p_user_ids.length,100);
    assert.equal(rows.at(-1).author.full_name,'Nama0');
});

function queue({brokenStorage=false}={}) {
    const storage=new Map(),navigator={onLine:false},events=[];
    const ctx=vm.createContext({console:quiet,Date,Map,JSON,Math,navigator,
        localStorage:{getItem:k=>{if(brokenStorage)throw Error('denied');return storage.get(k)??null;},setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},
        window:{addEventListener(){},dispatchEvent:e=>events.push(e.detail)},document:{addEventListener(){}},
        CustomEvent:class {constructor(name,args){this.detail=args.detail;}},setTimeout:()=>1});
    vm.runInContext(read('shared/ack-queue.js').replace(/export /g,''),ctx);
    ctx.initAckQueue({userId:'self'});
    return {ctx,navigator,storage,events};
}
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
for(const brokenStorage of [false,true]) await test('queued-during-flush ack survives '+(brokenStorage?'memory fallback':'localStorage'),async()=>{
    const {ctx,navigator}=queue({brokenStorage});ctx.registerAckHandler('notif',async()=>{throw Error('offline');});
    await ctx.ackWithRetry('notif','old','old');const gate=deferred();
    ctx.registerAckHandler('notif',p=>p==='old'?gate.promise:Promise.reject(Error('offline')));
    navigator.onLine=true;const flush=ctx.flushAckQueue();await ctx.ackWithRetry('notif','new','new');
    assert.equal(ctx.pendingAckCount(),2);gate.resolve();await flush;assert.equal(ctx.pendingAckCount(),1);
});
await test('requeued same key wins over successful or failed snapshot flush',async()=>{
    for(const fail of [false,true]){
        const {ctx,navigator,storage}=queue();ctx.registerAckHandler('notif',async()=>{throw Error('offline');});
        await ctx.ackWithRetry('notif','old','same');const gate=deferred();
        ctx.registerAckHandler('notif',p=>p==='old'?gate.promise.then(()=>{if(fail)throw Error('failed');}):Promise.reject(Error('offline')));
        navigator.onLine=true;const flush=ctx.flushAckQueue();await ctx.ackWithRetry('notif','new','same');gate.resolve();await flush;
        const entries=JSON.parse(storage.get('sip_ack_queue_v1'));assert.equal(entries.length,1);
        assert.equal(entries[0].payload,'new');assert.equal(entries[0].attempts,0);
    }
});
await test('concurrent immediate success cannot remove a newer failed ack',async()=>{
    const {ctx,storage}=queue();const gate=deferred();ctx.registerAckHandler('notif',p=>p==='old'?gate.promise:Promise.reject(Error('offline')));
    const ack=ctx.ackWithRetry('notif','old','same');await ctx.ackWithRetry('notif','new','same');gate.resolve();await ack;
    assert.equal(JSON.parse(storage.get('sip_ack_queue_v1'))[0].payload,'new');
});
await test('five retries drop an ack and emit rollback signal',async()=>{
    const {ctx,navigator,events}=queue();ctx.registerAckHandler('notif',async()=>{throw Error('offline');});
    await ctx.ackWithRetry('notif','old','old');navigator.onLine=true;
    for(let i=0;i<5;i++)await ctx.flushAckQueue();assert.equal(ctx.pendingAckCount(),0);
    assert(events.some(e=>e.dropped));
});
await test('legacy entries still retry, foreign account expired entries stay intact',async()=>{
    const {ctx,navigator,storage,events}=queue();storage.set('sip_ack_queue_v1',JSON.stringify([
        {key:'legacy',kind:'notif',payload:'legacy',userId:'self',queuedAt:Date.now(),attempts:0},
        {key:'foreign',kind:'notif',payload:'foreign',userId:'other',queuedAt:0,attempts:0},
        {key:'expired',kind:'notif',payload:'expired',userId:'self',queuedAt:0,attempts:0}]));
    const sent=[];ctx.registerAckHandler('notif',async p=>sent.push(p));navigator.onLine=true;await ctx.flushAckQueue();
    assert.deepEqual(sent,['legacy']);assert.equal(ctx.pendingAckCount(),1);assert(events.some(e=>e.dropped));
});
await test('account switch during network request preserves owners and stops old flush',async()=>{
    const {ctx,navigator,storage}=queue();ctx.registerAckHandler('notif',async()=>{throw Error('offline');});
    await ctx.ackWithRetry('notif','old','same');const gate=deferred();
    ctx.registerAckHandler('notif',p=>p==='old'?gate.promise:Promise.reject(Error('offline')));
    navigator.onLine=true;const flush=ctx.flushAckQueue();ctx.initAckQueue({userId:'other'});
    await ctx.ackWithRetry('notif','new','same');gate.resolve();await flush;
    const entries=JSON.parse(storage.get('sip_ack_queue_v1'));assert.equal(entries.length,1);assert.equal(entries[0].userId,'other');
});
await test('unknown handler and offline flush do not consume queue entries',async()=>{
    const {ctx,navigator}=queue();ctx.registerAckHandler('notif',async()=>{throw Error('offline');});await ctx.ackWithRetry('notif','old','old');
    await ctx.flushAckQueue();assert.equal(ctx.pendingAckCount(),1);ctx.registerAckHandler('notif',null);
    navigator.onLine=true;await ctx.flushAckQueue();assert.equal(ctx.pendingAckCount(),1);
});
console.log(`STUDENT_API_QUEUE_COMPLETE: ${passed} passed; synthetic only`);
