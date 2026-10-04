import { test } from 'node:test'
import assert from 'node:assert/strict'
import { demoPackage } from '../lib/server/demo'
import { packageSchema } from '../lib/server/schema'
import { chunkDocuments,convert,evaluate,trend } from '../lib/server/engine'
import { rankChunks } from '../lib/server/retrieval'
import { generate,safeNarrative,AIError,failureReason,embed } from '../lib/server/gemini'
import { z } from 'zod'
import { exportReview } from '../lib/server/export'

test('Demo inputs are validated and the engine reproduces violations, resolved checks and gaps',()=>{
 const p=demoPackage();assert.equal(p.requirements.length,26);assert.equal(p.documents.length,5);assert.ok(p.observations.length>=60)
 const result=evaluate(p,chunkDocuments(p));const find=(id:string)=>result.findings.find(f=>f.id===id)!
 assert.equal(find('BATTERY-THERMAL').evaluation,'REVIEW_REQUIRED');assert.equal(find('BATTERY-THERMAL').status,'NEW');assert.equal(find('BATTERY-THERMAL').trend,'WORSENING')
 assert.equal(find('SURFACE-WIND').evaluation,'REVIEW_REQUIRED');assert.equal(find('SURFACE-WIND').trend,'IMPROVING')
 assert.equal(find('MOTOR-VIBRATION').evaluation,'CHECK_PASSED');assert.equal(find('MOTOR-VIBRATION').trend,'STABLE')
 assert.equal(find('CHUTE-DEPLOY-TIME').status,'RESOLVED');assert.equal(find('INTERSTAGE-BOND').current,null);assert.equal(find('FIN-INSPECTION').status,'UNRESOLVED')
 assert.equal(result.findings.filter(f=>f.gap).length,2);assert.equal(result.findings.filter(f=>f.evaluation==='REVIEW_REQUIRED').length,3)
})
test('Malformed references, duplicates, timestamps and nonfinite values are rejected',()=>{
 const p=demoPackage();p.observations[1].id=p.observations[0].id;assert.throws(()=>packageSchema.parse(p))
 const q=demoPackage();q.observations[0].timestamp='2026-10-03T00:00:00Z';assert.throws(()=>packageSchema.parse(q))
 const t=demoPackage();t.observations[0].item_id='NOT-A-REQUIREMENT';assert.throws(()=>packageSchema.parse(t))
 const n=demoPackage();n.observations[0].value=Infinity;assert.throws(()=>packageSchema.parse(n))
 const unknown=demoPackage() as unknown as Record<string,unknown>;unknown.readiness_score=99;assert.throws(()=>packageSchema.parse(unknown))
})
test('Stale evidence, incompatible units and conflicting observations cannot become passed checks',()=>{
 const p=demoPackage();p.requirements[0].freshness_minutes=1;p.mission.timestamp='2026-10-02T15:00:00Z';const f=evaluate(p,chunkDocuments(p)).findings[0];assert.equal(f.current,null);assert.equal(f.evaluation,'MISSING_EVIDENCE');assert.ok(f.flags?.includes('STALE'))
 const q=demoPackage();for(const o of q.observations.filter(o=>o.item_id==='BATTERY-THERMAL'))o.unit='s';const g=evaluate(q,chunkDocuments(q)).findings[0];assert.equal(g.current,null);assert.ok(g.flags?.includes('INVALID'))
 const c=demoPackage();c.observations.push({...c.observations[0],id:'CONFLICT',value:1});const h=evaluate(c,chunkDocuments(c)).findings[0];assert.equal(h.evaluation,'REVIEW_REQUIRED');assert.ok(h.flags?.includes('CONFLICTING'));assert.equal(h.trend,'INSUFFICIENT_DATA')
})
test('Trend requires compatible time history; conversions and baseline compatibility are deterministic',()=>{
 assert.equal(convert(113,'F','°C'),45);assert.equal(convert(36,'km/h','m/s'),10);assert.throws(()=>convert(2,'s','m/s'))
 const p=demoPackage();const r=p.requirements[0];assert.equal(trend([{timestamp:'2026-10-02T14:00:00Z',value:41},{timestamp:'2026-10-02T14:30:00Z',value:47}],r),'INSUFFICIENT_DATA')
 p.baseline=null;assert.ok(evaluate(p,chunkDocuments(p)).findings.every(f=>f.status==='NOT_COMPARABLE'&&f.previous===null))
 const q=demoPackage();q.baseline!.configuration_version='other';assert.equal(evaluate(q,chunkDocuments(q)).findings[0].status,'NOT_COMPARABLE')
})
test('Retrieval preserves exact source identity and filters unrelated passages',()=>{
 const p=demoPackage(),chunks=chunkDocuments(p);const ranked=rankChunks('battery temperature thermal limit',chunks)
 assert.ok(ranked.some(c=>c.documentId==='DOC-AVIONICS'));assert.equal(rankChunks('zebras tropical forest',chunks).length,0)
 assert.ok(chunks.every(c=>c.id&&c.version&&c.section&&c.text));assert.throws(()=>safeNarrative('Launch is approved.',{}));assert.throws(()=>safeNarrative('Temperature is 9999 C.',{current:47}))
})
test('Groq chat contract, strict JSON output validation and server-only credentials',async()=>{
 const original=globalThis.fetch,old=process.env.GROQ_API_KEY;process.env.GROQ_API_KEY='test-only'
 try{globalThis.fetch=async(url,init)=>{const b=JSON.parse(String(init?.body));assert.equal(String(url),'https://api.groq.com/openai/v1/chat/completions');assert.equal(b.model,'openai/gpt-oss-120b');assert.equal(b.response_format.type,'json_schema');assert.equal(b.response_format.json_schema.strict,true);assert.equal(b.response_format.json_schema.schema.additionalProperties,false);assert.equal(b.response_format.json_schema.schema.properties.answer.maxLength,undefined);assert.equal(b.messages[0].role,'system');assert.equal(b.reasoning_effort,'low');assert.equal(new Headers(init?.headers).get('Authorization'),'Bearer test-only');assert.equal(new Headers(init?.headers).get('x-goog-api-key'),null);return Response.json({choices:[{finish_reason:'stop',message:{content:'{"answer":"grounded"}'}}]})};assert.deepEqual(await generate('test',{},z.object({answer:z.string().max(20)}).strict()),{answer:'grounded'});globalThis.fetch=async()=>Response.json({choices:[{message:{content:'{"invalid":1}'}}]});await assert.rejects(()=>generate('test',{},z.object({answer:z.string()}).strict()));globalThis.fetch=async()=>Response.json({choices:[{finish_reason:'length',message:{content:'{"answer":"partial"}'}}]});await assert.rejects(()=>generate('test',{},z.object({answer:z.string()})),(error:unknown)=>failureReason(error).code==='INVALID_RESPONSE')}finally{globalThis.fetch=original;if(old===undefined)delete process.env.GROQ_API_KEY;else process.env.GROQ_API_KEY=old}
})

test('Groq retries a transient 503 once and retains the original timeout budget',async()=>{
 const original=globalThis.fetch,old=process.env.GROQ_API_KEY;process.env.GROQ_API_KEY='test-only'
 try{
  let calls=0
  globalThis.fetch=async()=>++calls===1?Response.json({}, {status:503}):Response.json({choices:[{finish_reason:'stop',message:{content:'{"answer":"recovered"}'}}]})
  assert.deepEqual(await generate('test',{},z.object({answer:z.string()}),1000),{answer:'recovered'});assert.equal(calls,2)
  calls=0;let signal:AbortSignal|undefined
  globalThis.fetch=async(_url,init)=>{calls++;if(calls===1)return Response.json({}, {status:503});signal=init?.signal as AbortSignal;return new Promise<Response>(()=>{})}
  const started=Date.now();await assert.rejects(()=>generate('test',{},z.object({answer:z.string()}),350),(error:unknown)=>failureReason(error).code==='TIMEOUT');assert.equal(calls,2);assert.equal(signal?.aborted,true);assert.ok(Date.now()-started<600)
  calls=0;globalThis.fetch=async()=>{calls++;return Response.json({}, {status:503})}
  await assert.rejects(()=>generate('test',{},z.object({answer:z.string()}),20),(error:unknown)=>failureReason(error).httpStatus===503);assert.equal(calls,1)
  calls=0;globalThis.fetch=async()=>{calls++;return Response.json({}, {status:429})}
  await assert.rejects(()=>generate('test',{},z.object({answer:z.string()})),(error:unknown)=>failureReason(error).code==='QUOTA');assert.equal(calls,1)
 }finally{globalThis.fetch=original;if(old===undefined)delete process.env.GROQ_API_KEY;else process.env.GROQ_API_KEY=old}
})

test('Groq failures give specific safe reasons for timeout, network, access, quota and model errors',async()=>{
 const original=globalThis.fetch,old=process.env.GROQ_API_KEY;process.env.GROQ_API_KEY='test-only'
 try {
  for(const [status,code] of [[401,'AUTHENTICATION'],[403,'PERMISSION'],[404,'MODEL_NOT_FOUND'],[429,'QUOTA'],[503,'PROVIDER_UNAVAILABLE'],[504,'TIMEOUT'],[400,'REQUEST_REJECTED']] as [number,string][]){
   globalThis.fetch=async()=>Response.json({error:'test'}, {status});await assert.rejects(()=>generate('test',{},z.object({answer:z.string()})),(e:unknown)=>{const f=failureReason(e);assert.equal(f.code,code);assert.equal(f.httpStatus,status);assert.ok(f.reason.includes(String(status)));assert.ok(!f.reason.includes('test-only'));return true})
  }
  globalThis.fetch=async()=>{throw new TypeError('fetch failed')};await assert.rejects(()=>generate('test',{},z.object({answer:z.string()})),(e:unknown)=>failureReason(e).code==='NETWORK')
  let signal:AbortSignal|undefined;globalThis.fetch=async(_url,init)=>{signal=init?.signal as AbortSignal;return new Promise<Response>(()=>{})};const started=Date.now();await assert.rejects(()=>generate('test',{},z.object({answer:z.string()}),20),(e:unknown)=>{assert.equal(failureReason(e).code,'TIMEOUT');assert.ok(failureReason(e).reason.includes('cancelled'));return true});assert.ok(Date.now()-started<1000);assert.equal(signal?.aborted,true)
  delete process.env.GROQ_API_KEY;await assert.rejects(()=>generate('test',{},z.object({answer:z.string()})),(e:unknown)=>failureReason(e).code==='NOT_CONFIGURED')
 } finally {globalThis.fetch=original;if(old===undefined)delete process.env.GROQ_API_KEY;else process.env.GROQ_API_KEY=old}
})


test('Gemini embedding credentials remain separate from Groq generation',async()=>{
 const original=globalThis.fetch,old=process.env.GEMINI_API_KEY;process.env.GEMINI_API_KEY='embedding-only'
 try{
  globalThis.fetch=async(url,init)=>{assert.match(String(url),/generativelanguage.googleapis.com.*batchEmbedContents/);const headers=new Headers(init?.headers);assert.equal(headers.get('x-goog-api-key'),'embedding-only');assert.equal(headers.get('Authorization'),null);const body=JSON.parse(String(init?.body));assert.equal(body.requests[0].model,'models/gemini-embedding-2');assert.equal(body.requests[0].outputDimensionality,768);return Response.json({embeddings:[{values:Array(768).fill(.1)}]})}
  assert.equal((await embed(['battery'],'query'))[0].length,768)
  delete process.env.GEMINI_API_KEY;await assert.rejects(()=>embed(['battery'],'query'),(error:unknown)=>failureReason(error).code==='NOT_CONFIGURED'&&failureReason(error).reason.includes('Gemini'))
 }finally{globalThis.fetch=original;if(old===undefined)delete process.env.GEMINI_API_KEY;else process.env.GEMINI_API_KEY=old}
})
