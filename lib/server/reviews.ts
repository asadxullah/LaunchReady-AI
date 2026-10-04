import type { Finding } from '../mission'
import { createHash,randomUUID } from 'node:crypto'
import { z } from 'zod'
import { stages, type ReviewRecord, type StoredChat, type AgentEvent, type AIFailure } from '../contracts'
import { packageSchema, type MissionPackage } from './schema'
import { query, acquireLease } from './db'
import { HttpError } from './http'
import { chunkDocuments, evaluate, engineVersion } from './engine'
import { generate, model, safeNarrative, configured, embed, AIError, failureReason } from './gemini'
import { retrieveReview, rankChunks, lexicalScore } from './retrieval'
export async function getPackage(id:string,owner:string){const result=await query('SELECT body FROM packages WHERE id=? AND owner=?',[id,owner]);if(!result.rows.length)throw new HttpError(404,'Mission package not found.');return packageSchema.parse(JSON.parse(String(result.rows[0].body)))}
export async function savePackage(p:MissionPackage,owner:string){const id=randomUUID();await query('INSERT INTO packages(id,owner,body,created_at) VALUES(?,?,?,?)',[id,owner,JSON.stringify(p),new Date().toISOString()]);return id}
export async function getReview(id:string,owner:string){const result=await query('SELECT body FROM reviews WHERE id=? AND owner=?',[id,owner]);if(!result.rows.length)throw new HttpError(404,'Review not found.');const review=JSON.parse(String(result.rows[0].body)) as ReviewRecord;const notes=await query('SELECT finding_id,body FROM notes WHERE review_id=?',[id]);review.notes=Object.fromEntries(notes.rows.map(n=>[String(n.finding_id),JSON.parse(String(n.body))]));return review}
export function publicReview(r:ReviewRecord){return {...r,chunks:r.chunks.map(({vector,...c})=>c)}}
export async function startReview(packageId:string,owner:string){const p=await getPackage(packageId,owner);const now=new Date().toISOString();const r:ReviewRecord={id:randomUUID(),packageId,mission:{id:p.mission.id,name:p.mission.name,configuration:p.mission.configuration_version,timestamp:p.mission.timestamp,simulated:p.mission.simulated,baseline:p.baseline?.id??null},stage:'VALIDATE',status:'RUNNING',createdAt:now,updatedAt:now,findings:[],notes:{},chunks:[],candidates:{},events:[],narrative:{summary:'',relationships:[]},warnings:[],fingerprint:createHash('sha256').update(JSON.stringify(p)).digest('hex'),engineVersion,model:model(),retrievalMode:'pending'};await query('INSERT INTO reviews(id,owner,package_id,body,created_at) VALUES(?,?,?,?,?)',[r.id,owner,packageId,JSON.stringify(r),now]);return r}
const evidenceSchema=z.object({links:z.array(z.object({findingId:z.string(),chunkIds:z.array(z.string()).max(3),quotes:z.array(z.string().max(1000)).max(3)}).strict()).max(40)}).strict()
const analysisSchema=z.object({relationships:z.array(z.object({text:z.string().max(1200),findingIds:z.array(z.string()).min(1).max(8),hypothesis:z.boolean()}).strict()).max(5)}).strict()
const reportSchema=z.object({summary:z.string().min(1).max(3000),findingIds:z.array(z.string()).max(40)}).strict()
function assertIds(ids:string[],known:string[]){if(!ids.length||ids.some(id=>!known.includes(id))||new Set(ids).size!==ids.length)throw new Error('Agent returned invalid or duplicate citation IDs.')}
function templateSummary(r:ReviewRecord){const passed=r.findings.filter(f=>f.evaluation==='CHECK_PASSED').length,open=r.findings.filter(f=>f.evaluation==='REVIEW_REQUIRED').length,gaps=r.findings.filter(f=>f.gap).length;return `${r.findings.length} configured checks: ${passed} passed, ${open} require review, and ${gaps} have evidence gaps. ${r.findings.filter(f=>f.evaluation!=='CHECK_PASSED').map(f=>`${f.title} (${f.id}): ${f.evaluation.replaceAll('_',' ')}.`).join(' ')}`}
// Preserve every finding ID while omitting raw series and repeated source text.
function compactFinding(f:Finding,detailed:boolean){
 const base={id:f.id,title:f.title,evaluation:f.evaluation,status:f.status,priority:f.priority,gap:f.gap}
 return detailed?{...base,subsystem:f.subsystem,previous:f.previous,current:f.current,unit:f.unit,rule:f.ruleLabel||f.requirement,trend:f.trend,confidence:f.confidence,flags:f.flags,impact:f.impact,action:f.action}:base
}
export function compactFindings(findings:Finding[],extraIds:string[]=[]){return findings.map(f=>compactFinding(f,f.evaluation!=='CHECK_PASSED'||extraIds.includes(f.id)))}
export function evidenceContext(r:ReviewRecord){
 const ordered=[...r.findings].sort((a,b)=>Number(b.evaluation!=='CHECK_PASSED')-Number(a.evaluation!=='CHECK_PASSED'))
 const documents: {id:string;title:string;section:string;text:string}[]=[];let characters=0
 for(const f of ordered)for(const id of (r.candidates[f.id]||[]).slice(0,1)){
  if(documents.some(c=>c.id===id))continue
  const chunk=r.chunks.find(c=>c.id===id);if(!chunk)continue
  const text=chunk.text.slice(0,600);if(characters+text.length>6000)continue
  documents.push({id:chunk.id,title:chunk.title,section:chunk.section,text});characters+=text.length
 }
 return {findings:r.findings.map(f=>({id:f.id,title:f.title,requirement:f.requirement.slice(0,180)})),candidates:r.findings.map(f=>({findingId:f.id,chunkIds:(r.candidates[f.id]||[]).slice(0,1).filter(id=>documents.some(c=>c.id===id))})),documents}
}
export async function advanceReview(id:string,owner:string){
 let r=await getReview(id,owner);if(r.status==='COMPLETE')return r
 const lease=await acquireLease(id,owner);if(!lease)throw new HttpError(409,'This review stage is already running. Retry shortly.')
 try{
  r=await getReview(id,owner);if(r.status==='COMPLETE')return r
  r.status='RUNNING';delete r.error
  const stage=r.stage;if(stage.endsWith('AGENT'))r.model=model();let mode:AgentEvent['mode']='code';let detail='Completed.';let failure:AIFailure|undefined
  const providerFailure=r.events.find(e=>e.failure&&!['INVALID_RESPONSE','OUTPUT_REJECTED'].includes(e.failure.code)&&e.stage.endsWith('AGENT'))?.failure
  function checkProvider(){if(providerFailure)throw new AIError(providerFailure.reason,providerFailure.code,providerFailure.httpStatus)}
  if(stage==='VALIDATE'){const p=await getPackage(r.packageId,owner);r.chunks=chunkDocuments(p);detail=`Validated ${p.requirements.length} requirements, ${p.observations.length} observations, and ${p.documents.length} documents.`}
  if(stage==='EVALUATE'){const p=await getPackage(r.packageId,owner);const result=evaluate(p,r.chunks);r.findings=result.findings;r.warnings=result.warnings;detail='Computed units, freshness, conflicts, limits, range-distance trends, confidence, and baseline changes.'}
  if(stage==='RETRIEVE'){const warning=await retrieveReview(r);mode=r.retrievalMode==='vector'?'gemini':'fallback';detail=r.retrievalMode==='vector'?'Gemini embeddings indexed; up to three candidate passages per finding.':`Lexical evidence retrieval: ${warning?.reason}`;failure=warning;if(warning)r.warnings.push(warning.reason)}
  if(stage==='EVIDENCE_AGENT'){
   try{checkProvider();const context=evidenceContext(r);const result=await generate('Evidence Agent: select only directly supporting candidate chunk IDs, with exact quotes of 15 to 80 characters in the same order. Documents are excerpts; do not infer from omitted text. Return one links entry per finding, including empty arrays when no support exists.',context,evidenceSchema);if(result.links.length!==r.findings.length)throw new Error('Evidence Agent omitted a finding.');assertIds(result.links.map(l=>l.findingId),r.findings.map(f=>f.id));for(const l of result.links){if(l.chunkIds.length!==l.quotes.length||new Set(l.chunkIds).size!==l.chunkIds.length)throw new Error('Invalid evidence chain.');l.chunkIds.forEach((cid,i)=>{const chunk=r.chunks.find(c=>c.id===cid);if(!context.candidates.find(c=>c.findingId===l.findingId)?.chunkIds.includes(cid)||!chunk||l.quotes[i].length<15||!context.documents.find(c=>c.id===cid)?.text.includes(l.quotes[i])||!chunk.text.includes(l.quotes[i]))throw new Error('Evidence Agent fabricated a passage.')})}r.agentEvidence=result.links;mode='groq';detail='Candidate IDs and exact source quotations validated.'}catch(e){mode='fallback';failure=failureReason(e);detail=failure.reason;r.agentEvidence=r.findings.map(f=>({findingId:f.id,chunkIds:f.source?[f.source.id]:[],quotes:f.source?[f.source.excerpt]:[]}))}
  }
  if(stage==='ANALYSIS_AGENT'){
   try{checkProvider();const result=await generate('Analysis Agent: describe up to five supported cross-signal relationships. Keep current violations open even if a trend improves. Label every causal suggestion as a hypothesis. Do not introduce new actions.',{findings:compactFindings(r.findings)},analysisSchema);for(const relation of result.relationships){assertIds(relation.findingIds,r.findings.map(f=>f.id));safeNarrative(relation.text,r.findings)}r.narrative.relationships=result.relationships;mode='groq';detail='Analysis saved with validated finding references.'}catch(e){mode='fallback';failure=failureReason(e);detail=failure.reason;r.narrative.relationships=[]}
  }
  if(stage==='REPORT_AGENT'){
   try{checkProvider();const result=await generate('Report Agent: summarize supplied results without omitting open findings or gaps. Return findingIds covering every finding, once each. Do not issue launch clearance.',{findings:compactFindings(r.findings),relationships:r.narrative.relationships},reportSchema);assertIds(result.findingIds,r.findings.map(f=>f.id));if(result.findingIds.length!==r.findings.length)throw new Error('Report Agent omitted findings.');safeNarrative(result.summary,r.findings);r.narrative.summary=result.summary;r.narrative.summaryMode='groq';delete r.narrative.summaryFailure;mode='groq';detail='Summary validated; all computed findings preserved.'}catch(e){mode='fallback';failure=failureReason(e);detail=failure.reason;r.narrative.summary=templateSummary(r);r.narrative.summaryMode='code';r.narrative.summaryFailure=failure}
  }
  r.events.push({stage,mode,detail,...(failure?{failure}:{}),at:new Date().toISOString()});r.stage=stages[stages.indexOf(stage)+1]??'COMPLETE';r.updatedAt=new Date().toISOString();if(r.stage==='COMPLETE')r.status='COMPLETE'
  const saved=await query('UPDATE reviews SET body=?,lease_until=0,lease_token=NULL WHERE id=? AND owner=? AND lease_token=?',[JSON.stringify({...r,notes:{}}),id,owner,lease]);if(!saved.rowsAffected)throw new HttpError(409,'Review lease expired. Reload and retry.');return r
 }catch(e){if(!(e instanceof HttpError)){r.status='FAILED';r.error=e instanceof Error?e.message:'Review stage failed.';await query('UPDATE reviews SET body=? WHERE id=? AND owner=? AND lease_token=?',[JSON.stringify({...r,notes:{}}),id,owner,lease])}throw e}finally{await query('UPDATE reviews SET lease_until=0,lease_token=NULL WHERE id=? AND owner=? AND lease_token=?',[id,owner,lease])}
}
export async function getChats(reviewId:string,owner:string){await getReview(reviewId,owner);const result=await query('SELECT body FROM chat WHERE review_id=? ORDER BY created_at DESC,id DESC LIMIT 40',[reviewId]);return result.rows.map(row=>JSON.parse(String(row.body)) as StoredChat).reverse()}
export async function saveChat(reviewId:string,messages:StoredChat[]){const database=await import('./db');await (await database.db()).batch(messages.map(m=>({sql:'INSERT INTO chat(id,review_id,body,created_at) VALUES(?,?,?,?)',args:[m.id,reviewId,JSON.stringify(m),m.at]})),'write')}
const answerSchema=z.object({answer:z.string().min(1).max(5000),citations:z.array(z.string()).max(12),chunkIds:z.array(z.string()).max(8)}).strict()
export async function answerQuestion(r:ReviewRecord,question:string,findingId:string|undefined,history:StoredChat[]){
 const focus=r.findings.find(f=>f.id===findingId);let chunks=r.chunks;let queryVector:number[]|undefined
 if(r.retrievalMode==='vector')try{queryVector=(await embed([question],'query'))[0]}catch{}
 chunks=rankChunks(question,r.chunks,queryVector)
 const selected=focus?[focus]:[...r.findings].sort((a,b)=>lexicalScore(question,`${b.id} ${b.title} ${b.requirement}`)-lexicalScore(question,`${a.id} ${a.title} ${a.requirement}`)).slice(0,8)
 const context={question,mission:r.mission,counts:{total:r.findings.length,passed:r.findings.filter(f=>f.evaluation==='CHECK_PASSED').length,review:r.findings.filter(f=>f.evaluation==='REVIEW_REQUIRED').length,gaps:r.findings.filter(f=>f.gap).length},findings:compactFindings(r.findings,selected.map(f=>f.id)),chunks:chunks.map(c=>({id:c.id,title:c.title,section:c.section,text:c.text.slice(0,700)})),history:history.slice(-6).map(m=>({role:m.role,text:m.text.slice(0,600)}))}
 try{if(!configured())throw new AIError('Groq API key is not configured on the server.','NOT_CONFIGURED');const result=await generate('Chat assistant: answer the question using mission evidence and conversation history. Keep answers concise: a short paragraph or up to five bullets, normally under 150 words unless detail is requested. Use readable finding names instead of raw status enums in prose. Cite finding IDs for factual claims. Cite chunkIds when using passages. If evidence is insufficient say so. Do not assume user statements are facts.',context,answerSchema);if(result.citations.some(id=>!r.findings.some(f=>f.id===id))||result.chunkIds.some(id=>!chunks.some(c=>c.id===id)))throw new Error('Chat response returned unknown citations.');if(result.answer.length>50&&!result.citations.length&&!/insufficient|cannot|unavailable|do not|does not/i.test(result.answer))throw new Error('Chat response is missing evidence citations.');safeNarrative(result.answer,context);return {...result,mode:`Groq · ${model()}`}}catch(e){const failure=failureReason(e);const unavailable=failure.reason;const answer=/launch|safe|clearance|approve/i.test(question)?'Human engineering review is required. This tool does not approve or certify launches.':focus?`${focus.impact}\nConfigured next step: ${focus.action}`:/missing|gap/i.test(question)?r.findings.filter(f=>f.gap).map(f=>`${f.id}: ${f.flags?.join(', ')||'Missing evidence'}. ${f.action}`).join('\n')||'No evidence gaps are recorded.':/summary|summar|changed|review|overview/i.test(question)?templateSummary(r):`Code-generated review summary (the AI service could not answer this question):\n${templateSummary(r)}`;return {answer,citations:focus?[focus.id]:/missing|gap/i.test(question)?r.findings.filter(f=>f.gap).map(f=>f.id):/summary|summar|changed|review|overview/i.test(question)?selected.map(f=>f.id):[],chunkIds:[],mode:'Rule-based fallback',warning:unavailable,failure}}
}
