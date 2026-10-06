import type { Finding, Diff } from '../mission'
import type { Chunk } from '../contracts'
import type { MissionPackage, Requirement } from './schema'
import { unitConversions } from '../units'
export const engineVersion='1.1.0'
const round=(x:number)=>Number(x.toFixed(6))
const conversion:Record<string,{family:string;scale:number;offset:number}>=unitConversions
export function convert(value:number,from:string,to:string){const a=conversion[from],b=conversion[to];if(!a||!b||a.family!==b.family)throw new Error(`Incompatible units ${from} / ${to}`);return round((value*a.scale+a.offset-b.offset)/b.scale)}
export function chunkDocuments(p:MissionPackage):Chunk[]{
 const chunks:Chunk[]=[]
 for(const d of p.documents){let section='Document';let text='';let seq=0;const flush=()=>{if(!text.trim())return;const words=text.trim().split(/\s+/);for(let i=0;i<words.length;i+=340){chunks.push({id:`${d.id}-v${d.version}-${++seq}`,documentId:d.id,version:d.version,title:d.title,section,text:words.slice(i,i+400).join(' ')});if(i+400>=words.length)break}text=''};for(const line of d.content.split('\n')){if(/^#{1,6}\s/.test(line)){flush();section=line.replace(/^#+\s*/,'')}else text+=line+'\n'}flush()}
 if(chunks.length>80)throw new Error('Too many document chunks. Use at most 80 short sections.')
 return chunks
}
const distance=(v:number,r:Requirement)=>Math.max(0,(r.lower??-Infinity)-v,v-(r.upper??Infinity))
export function trend(samples:{timestamp:string;value:number}[],r:Requirement){
 if(samples.length<5||r.operator==='CHECKLIST')return 'INSUFFICIENT_DATA' as const
 const first=Date.parse(samples[0].timestamp);const xs=samples.map(o=>(Date.parse(o.timestamp)-first)/60000);if(xs[xs.length-1]<r.trend_min_minutes)return 'INSUFFICIENT_DATA' as const
 const ys=samples.map(o=>distance(o.value,r));const mx=xs.reduce((a,b)=>a+b,0)/xs.length,my=ys.reduce((a,b)=>a+b,0)/ys.length
 const denominator=xs.reduce((a,x)=>a+(x-mx)**2,0);if(!denominator)return 'INSUFFICIENT_DATA' as const
 const slope=xs.reduce((a,x,i)=>a+(x-mx)*(ys[i]-my),0)/denominator
 return slope>r.trend_tolerance?'WORSENING' as const:slope < -r.trend_tolerance?'IMPROVING' as const:'STABLE' as const
}
export function evaluate(p:MissionPackage,chunks:Chunk[]){
 const warnings:string[]=[];const results:Finding[]=[]
 for(const r of p.requirements){
  const flags:string[]=[];const valid:{id:string;timestamp:string;value:number}[]=[]
  for(const o of p.observations.filter(o=>o.item_id===r.item_id)){
   if(!o.valid||o.configuration_version!==r.configuration_version||o.test_condition!==r.test_condition){warnings.push(`${o.id}: excluded invalid or incompatible observation.`);continue}
   try{const value=convert(o.value,o.unit,r.unit);if((r.unit==='events'&&(!Number.isInteger(value)||value<0))||(r.unit==='boolean'&&![0,1].includes(value)))throw new Error('Invalid discrete value');valid.push({...o,value})}catch{warnings.push(`${o.id}: excluded incompatible unit or value.`)}
  }
  if(r.operator==='CHECKLIST'){
   const c=p.checklists.find(c=>c.item_id===r.item_id)
   if(c){valid.push({id:`CHECK-${c.item_id}`,timestamp:c.timestamp,value:c.state==='COMPLETE'?1:0});if(r.required_document_ids.some(id=>!c.evidence_document_ids.includes(id)))flags.push('ABSENT_CHECKLIST_EVIDENCE')}
  }
  valid.sort((a,b)=>Date.parse(a.timestamp)-Date.parse(b.timestamp));
  const conflicts=valid.some((o,i)=>i>0&&o.timestamp===valid[i-1].timestamp&&o.value!==valid[i-1].value)
  if(conflicts)flags.push('CONFLICTING')
  const latest=valid.at(-1)
  const fresh=valid.filter(o=>Date.parse(p.mission.timestamp)-Date.parse(o.timestamp)<=r.freshness_minutes*60000)
  const basis=r.evaluation_basis??'LATEST'
  let selected=latest
  if(r.operator!=='CHECKLIST'&&basis!=='LATEST') selected=fresh.reduce<typeof latest>((chosen,o)=>!chosen||((basis==='MAXIMUM'?o.value:basis==='MINIMUM'?-o.value:distance(o.value,r))>= (basis==='MAXIMUM'?chosen.value:basis==='MINIMUM'?-chosen.value:distance(chosen.value,r)))?o:chosen,undefined)
  let current=selected?.value??null
  if(!latest)flags.push(p.observations.some(o=>o.item_id===r.item_id)?'INVALID':'ABSENT')
  if(latest&&(!selected||Date.parse(p.mission.timestamp)-Date.parse(latest.timestamp)>r.freshness_minutes*60000)){flags.push('STALE');current=null}
  const linked=r.source?chunks.find(c=>c.documentId===r.source!.document_id&&c.version===r.source!.version&&(c.section===r.source!.section||c.section.includes(r.source!.section))):undefined
  if(!linked)flags.push('MISSING_DOCUMENT')
  for(const id of r.required_document_ids)if(!p.documents.some(d=>d.id===id))flags.push(`ABSENT_DOCUMENT:${id}`)
  const unique=valid.filter((o,i)=>i===0||o.timestamp!==valid[i-1].timestamp)
  const gap=flags.some(f=>f!=='CONFLICTING')
  const violation=current!==null&&(r.operator==='CHECKLIST'?current!==1:distance(current,r)>0)
  const evaluation=conflicts||violation?'REVIEW_REQUIRED':gap?'MISSING_EVIDENCE':'CHECK_PASSED'
  const previous=p.baseline?.findings.find(f=>f.item_id===r.item_id)
  let compatible=!!previous&&p.baseline?.configuration_version===r.configuration_version&&previous.requirement_version===r.version&&previous.unit===r.unit&&previous.test_condition===r.test_condition
  const prior=compatible?previous!.value:null
  const open=evaluation!=='CHECK_PASSED',wasOpen=previous?.evaluation!=='CHECK_PASSED'
  let status:Diff
  if(!p.baseline||previous&&!compatible)status='NOT_COMPARABLE'
  else if(!previous)status=open?'NEW':'UNCHANGED'
  else if(open&&!wasOpen)status='NEW'
  else if(!open&&wasOpen)status='RESOLVED'
  else if(previous.evaluation!==evaluation||current!==null&&prior!==null&&Math.abs(current-prior)>r.material_change)status='CHANGED'
  else status=open?'UNRESOLVED':'UNCHANGED'
  const samples=unique.slice(-10)
  // Keep an earlier limit exceedance visible in the chart even if the last sample recovered.
  if(selected&&basis!=='LATEST'&&!samples.some(o=>o.id===selected.id)){samples.shift();samples.push(selected);samples.sort((a,b)=>Date.parse(a.timestamp)-Date.parse(b.timestamp))}
  const label=conflicts||current===null?'INSUFFICIENT_DATA':trend(samples,r)
  const reasons=[linked?'Requirement source and version are linked.':'Requirement source is missing or its section/version does not match.',latest&&current!==null?'Current comparable record is valid and fresh.':'Current usable evidence is absent or stale.',...(basis==='LATEST'?[]:[`Evaluation uses ${basis==='ALL'?'all fresh samples (the greatest limit exceedance, or the latest sample if all meet the limit)':basis.toLowerCase()+' of fresh samples'}.`]),...flags.map(f=>`Evidence flag: ${f}`)]
  if(r.operator!=='CHECKLIST'&&label==='INSUFFICIENT_DATA')reasons.push('Insufficient comparable history for a trend.')
  const confidence=flags.length?'LOW':r.operator!=='CHECKLIST'&&label==='INSUFFICIENT_DATA'?'MEDIUM':'HIGH'
  const ruleBase=r.operator==='CHECKLIST'?'Completed checklist and required evidence':r.operator==='LTE'?`≤ ${r.upper} ${r.unit}`:r.operator==='GTE'?`≥ ${r.lower} ${r.unit}`:`${r.lower}–${r.upper} ${r.unit}`
  const rule=ruleBase+(r.operator!=='CHECKLIST'&&basis!=='LATEST'?` · ${basis==='ALL'?'every imported sample':basis.toLowerCase()}`:'')
  const impact=conflicts?'Conflicting observations require investigation.':current===null?'This item cannot be evaluated from fresh comparable records.':violation?`${current} ${r.unit} does not meet the configured requirement (${rule}).`:`${current} ${r.unit} meets the configured requirement (${rule}).`
  const span=samples.length>1?(Date.parse(samples.at(-1)!.timestamp)-Date.parse(samples[0].timestamp))/60000:0
  results.push({id:r.item_id,title:r.title,subsystem:r.subsystem,status,evaluation,priority:r.priority,previous:prior,current,unit:r.unit,limit:r.upper??null,lowerLimit:r.lower??null,requirement:`${r.id} v${r.version} · ${rule}`,dataId:selected?.id??null,trend:label,confidence,confidenceReasons:reasons,series:r.operator==='CHECKLIST'?[]:samples.map(o=>({time:o.timestamp,value:o.value})),source:linked?{id:linked.id,title:linked.title,section:linked.section,excerpt:linked.text}:null,impact,action:r.action,gap,flags,windowMinutes:round(span),ruleLabel:rule,comparable:compatible,stillOpen:open,requirementVersion:r.version,rawDirection:samples.length>1?(samples.at(-1)!.value>samples[0].value?'RISING':samples.at(-1)!.value<samples[0].value?'FALLING':'UNCHANGED'):'UNAVAILABLE',absoluteChange:current!==null&&prior!==null?round(current-prior):null,percentageChange:current!==null&&prior!==null&&prior!==0&&r.unit!=='events'?round((current-prior)/Math.abs(prior)*100):null})
 }
 return {findings:results,warnings}
}
