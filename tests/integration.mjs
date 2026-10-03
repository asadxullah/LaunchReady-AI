import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp,rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join,resolve } from 'node:path'
const dir=await mkdtemp(join(tmpdir(),'launchready-test-'));const origin='http://127.0.0.1:3105';let output=''
const server=spawn(process.execPath,['--import',resolve('tests/mock-gemini.mjs'),'node_modules/next/dist/bin/next','start','--port','3105','--hostname','127.0.0.1'],{env:{...process.env,GEMINI_API_KEY:'integration-test-only',TURSO_DATABASE_URL:`file:${dir}/app.db`,TURSO_AUTH_TOKEN:'',NEXT_TELEMETRY_DISABLED:'1'},stdio:['ignore','pipe','pipe']})
server.stdout.on('data',b=>{output+=b});server.stderr.on('data',b=>{output+=b});let cookie=''
async function request(path,init={},session=cookie){const headers=new Headers(init.headers);if(session)headers.set('Cookie',session);const response=await fetch(origin+path,{...init,headers});if(!cookie&&response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];return response}
const json=(body,extra={})=>({method:'POST',headers:{'Content-Type':'application/json',...extra},body:JSON.stringify(body)})
async function data(path,init){const r=await request(path,init);const body=await r.json();assert.ok(r.ok,`${path}: ${r.status} ${JSON.stringify(body)}`);return body}
async function run(packageId){let r=await data('/api/reviews',json({packageId}));for(let i=0;i<10&&r.status!=='COMPLETE';i++)r=await data(`/api/reviews/${r.id}/advance`,json({}));assert.equal(r.status,'COMPLETE');return r}
try{
 let ready=false;for(let i=0;i<100;i++){if(server.exitCode!==null)throw new Error(output);try{const r=await fetch(origin+'/api/health');if(r.ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,100))}if(!ready)throw new Error('Server did not start: '+output)
 await data('/api/packages');assert.ok(cookie)
 const loaded=await data('/api/packages',json({}, {'x-launchready-demo':'1'}));const review=await run(loaded.id)
 assert.equal(review.findings.length,26);assert.equal(review.retrievalMode,'vector');assert.ok(review.events.filter(e=>e.stage.endsWith('AGENT')).every(e=>e.mode==='gemini'))
 const battery=review.findings.find(f=>f.id==='BATTERY-THERMAL');assert.equal(battery.current,47);assert.equal(battery.evaluation,'REVIEW_REQUIRED');assert.ok(review.chunks.every(c=>!('vector' in c)))
 const denied=await request(`/api/reviews/${review.id}`,{},'launchready_session='+'a'.repeat(64));assert.equal(denied.status,404)
 const originDenied=await request('/api/reviews',json({packageId:loaded.id},{Origin:'https://untrusted.example'}));assert.equal(originDenied.status,403)
 const badNote=await request(`/api/reviews/${review.id}/notes`,json({findingId:battery.id,state:'DISMISSED_WITH_NOTE',note:''}));assert.equal(badNote.status,422)
 await data(`/api/reviews/${review.id}/notes`,json({findingId:battery.id,state:'NEEDS_ACTION',note:'Repeat thermal test.'}));const after=await data(`/api/reviews/${review.id}`);assert.equal(after.notes[battery.id].note,'Repeat thermal test.');assert.equal(after.findings[0].evaluation,'REVIEW_REQUIRED')
 const chat=await data('/api/chat',json({reviewId:review.id,question:'Why is battery temperature flagged?',findingId:battery.id}));assert.match(chat.mode,/Gemini/);assert.ok(chat.citations.includes(battery.id));assert.ok(chat.chunkIds.every(id=>review.chunks.some(c=>c.id===id)))
 await data('/api/chat',json({reviewId:review.id,question:'What was my previous question?',findingId:battery.id}));const history=await data(`/api/chat?reviewId=${review.id}`);assert.equal(history.length,4)
 const md=await (await request(`/api/reviews/${review.id}/export`)).text();assert.ok(md.includes('Repeat thermal test.'));assert.ok(md.includes('does not approve or certify launches'));for(const f of review.findings)assert.ok(md.includes(f.id))
 const sample=await data('/api/sample');sample.mission.name='Uploaded scenario';sample.mission.id='CUSTOM-1';sample.baseline=null;for(const o of sample.observations.filter(o=>o.item_id===battery.id))o.value=20
 const form=new FormData();form.set('package',new File([JSON.stringify(sample)],'mission.json',{type:'application/json'}));const uploaded=await data('/api/packages',{method:'POST',body:form});const custom=await run(uploaded.id);assert.equal(custom.mission.name,'Uploaded scenario');assert.equal(custom.findings[0].current,20);assert.equal(custom.findings[0].status,'NOT_COMPARABLE');assert.equal(custom.findings[0].evaluation,'CHECK_PASSED')
 const invalid=structuredClone(sample);invalid.observations[0].value='bad';assert.equal((await request('/api/packages',json(invalid))).status,422)
 const csv='id,item_id,test_id,timestamp,value,unit,configuration_version,test_condition,valid\nONLY-1,BATTERY-THERMAL,TEST-1,2026-10-02T14:30:00Z,47,°C,demo-v1,bench-A,true\n';const csvForm=new FormData();csvForm.set('package',new File([JSON.stringify(sample)],'mission.json'));csvForm.set('observations',new File([csv],'observations.csv'));const csvP=await data('/api/packages',{method:'POST',body:csvForm});assert.equal(csvP.observations,1)
 // Inject a malicious API result through a test-only trigger; model JSON references must be checked.
 const malicious=await data('/api/chat',json({reviewId:review.id,question:'TEST_UNKNOWN_CITATION',findingId:battery.id}));assert.equal(malicious.mode,'Rule-based fallback')
 const fallbackPackage=structuredClone(sample);fallbackPackage.requirements[0].title='FAIL-AI';const failedP=await data('/api/packages',json(fallbackPackage));const fallback=await run(failedP.id);assert.equal(fallback.status,'COMPLETE');assert.ok(fallback.events.filter(e=>e.stage.endsWith('AGENT')).every(e=>e.mode==='fallback'));assert.equal(fallback.findings[0].current,20);assert.ok(fallback.narrative.summary.includes('configured checks'));assert.equal(fallback.narrative.summaryMode,'code');assert.equal(fallback.narrative.summaryFailure.code,'QUOTA');assert.ok(fallback.narrative.summaryFailure.reason.includes('429'));const fallbackExport=await (await request(`/api/reviews/${fallback.id}/export`)).text();assert.ok(fallbackExport.includes('Code-generated fallback'));assert.ok(fallbackExport.includes('QUOTA'));
 for(const [status,code] of [[401,'AUTHENTICATION'],[429,'QUOTA'],[504,'TIMEOUT']]){const reply=await data('/api/chat',json({reviewId:review.id,question:`TEST_HTTP_${status}`}));assert.equal(reply.mode,'Rule-based fallback');assert.equal(reply.failure.code,code);assert.ok(reply.answer.includes('Code-generated review summary'));const saved=await data(`/api/chat?reviewId=${review.id}`);assert.equal(saved.at(-1).failure.code,code)}
 const missing=await request('/api/chat',json({reviewId:review.id,question:'Hello',findingId:'NO-SUCH-FINDING'}));assert.equal(missing.status,404)
 console.log('Integration passed: real HTTP upload, all agent stages, scoped storage, notes, exports, chat history, invalid input, CSV, and rejected fabricated citations.')
}finally{server.kill('SIGTERM');await new Promise(r=>{if(server.exitCode!==null)r();else server.once('exit',r)});await rm(dir,{recursive:true,force:true})}
