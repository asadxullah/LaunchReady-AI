import { findings as fixtures } from '../mission'
import { packageSchema, type MissionPackage, type Requirement } from './schema'
export function demoPackage():MissionPackage{
 const timestamp='2026-10-02T14:30:00Z'
 const docs=new Map<string,{id:string;version:string;title:string;content:string;simulated:boolean}>()
 const requirements:Requirement[]=[],observations:MissionPackage['observations']=[],checklists:MissionPackage['checklists']=[],baseline:NonNullable<MissionPackage['baseline']>['findings']=[]
 for(const f of fixtures){
  const docId=`DOC-${f.subsystem}`;const section=f.source?.section??'Inspection'
  if(f.source){const d=docs.get(docId)??{id:docId,version:'1',title:`Demo ${f.subsystem.toLowerCase()} requirements`,content:'',simulated:true};d.content+=`\n# ${section}\n${f.source.excerpt}\n`;docs.set(docId,d)}
  const isChecklist=f.limit===null
  requirements.push({id:`REQ-${f.id}`,item_id:f.id,version:'1',title:f.title,subsystem:f.subsystem as Requirement['subsystem'],parameter:f.id,operator:isChecklist?'CHECKLIST':'LTE',...(isChecklist?{}:{upper:f.limit!}),unit:isChecklist?'boolean':f.unit as Requirement['unit'],priority:f.priority,configuration_version:'demo-v1',test_condition:'bench-A',freshness_minutes:120,material_change:f.id==='SURFACE-WIND'?.5:.2,trend_min_minutes:20,trend_tolerance:.01,source:f.source?{document_id:docId,section,version:'1'}:null,required_document_ids:isChecklist?[`RECORD-${f.id}`]:[docId],action:f.action,demo_assumption:true})
  for(const [i,s] of f.series.entries())observations.push({id:`${f.id}-${i+1}`,item_id:f.id,test_id:`TEST-${f.id}`,timestamp:`2026-10-02T${s.time}:00Z`,value:s.value,unit:f.unit as Requirement['unit'],configuration_version:'demo-v1',test_condition:'bench-A',valid:true})
  if(!f.series.length&&f.current!==null)observations.push({id:`${f.id}-1`,item_id:f.id,test_id:`TEST-${f.id}`,timestamp,value:f.current,unit:f.unit as Requirement['unit'],configuration_version:'demo-v1',test_condition:'bench-A',valid:true})
  if(['BATTERY-THERMAL','MOTOR-VIBRATION','CHUTE-DEPLOY-TIME'].includes(f.id)) observations.push({id:`${f.id}-0`,item_id:f.id,test_id:`TEST-${f.id}`,timestamp:'2026-10-02T13:55:00Z',value:f.series[0].value,unit:f.unit as Requirement['unit'],configuration_version:'demo-v1',test_condition:'bench-A',valid:true})
  if(f.id!=='INTERSTAGE-BOND')baseline.push({item_id:f.id,requirement_version:'1',unit:isChecklist?'boolean':f.unit as Requirement['unit'],test_condition:'bench-A',value:f.previous,evaluation:f.id==='CHUTE-DEPLOY-TIME'?'REVIEW_REQUIRED':f.id==='SURFACE-WIND'?'REVIEW_REQUIRED':f.id==='FIN-INSPECTION'?'MISSING_EVIDENCE':'CHECK_PASSED'})
 }
 for(const [id,subsystem,unit,upper,values] of [
  ['AMBIENT-TEMP','ENVIRONMENT','°C',40,[25,25,25.1,25.1,25,25,25]],
  ['AVIONICS-EVENT-COUNT','AVIONICS','events',15,[12,12,12,12,12,12,12]],
  ['RECOVERY-TEST-DURATION','RECOVERY','s',12,[9,9,9,9,9,9,9]],
  ['WIND-GUST','ENVIRONMENT','m/s',12,[10,10.1,10,10,10.2,10,10]],
 ] as [string,Requirement['subsystem'],Requirement['unit'],number,number[]][]){
  const d=docs.get(`DOC-${subsystem}`)!;d.content+=`\n# ${id}\nIllustrative ${id} upper limit: ${upper} ${unit}. Retain a current comparable record.\n`
  requirements.push({id:`REQ-${id}`,item_id:id,version:'1',title:id.toLowerCase().replaceAll('-',' '),subsystem,parameter:id,operator:'LTE',upper,unit,priority:'LOW',configuration_version:'demo-v1',test_condition:'bench-A',freshness_minutes:120,material_change:.5,trend_min_minutes:20,trend_tolerance:.01,source:{document_id:d.id,section:id,version:'1'},required_document_ids:[d.id],action:'Retain the test record and request engineering review if the configured limit is exceeded.',demo_assumption:true})
  values.forEach((value,i)=>observations.push({id:`${id}-${i}`,item_id:id,test_id:`TEST-${id}`,timestamp:`2026-10-02T14:${String(i*5).padStart(2,'0')}:00Z`,value,unit,configuration_version:'demo-v1',test_condition:'bench-A',valid:true}))
  baseline.push({item_id:id,requirement_version:'1',unit,test_condition:'bench-A',value:values[0],evaluation:'CHECK_PASSED'})
 }
 const structure=docs.get('DOC-STRUCTURE')!;structure.content+='\n# Checklist\nIllustrative review checklist: retain a completed record and linked subsystem requirement document for each item.\n'
 for(let i=1;i<=15;i++){const item=`INSPECTION-${String(i).padStart(2,'0')}`;requirements.push({id:`REQ-${item}`,item_id:item,version:'1',title:`Supporting inspection ${i}`,subsystem:'STRUCTURE',parameter:item,operator:'CHECKLIST',unit:'boolean',priority:'LOW',configuration_version:'demo-v1',test_condition:'bench-A',freshness_minutes:1440,material_change:0,trend_min_minutes:20,trend_tolerance:.01,source:{document_id:structure.id,section:'Checklist',version:'1'},required_document_ids:[structure.id],action:'Review the completed record and its supporting document.',demo_assumption:true});checklists.push({item_id:item,state:'COMPLETE',timestamp,evidence_document_ids:[structure.id]});baseline.push({item_id:item,requirement_version:'1',unit:'boolean',test_condition:'bench-A',value:1,evaluation:'CHECK_PASSED'})}
 return packageSchema.parse({schema_version:'1',mission:{id:'ASTER-2',name:'Aster-2',configuration_version:'demo-v1',timestamp,simulated:true},requirements,observations,checklists,documents:[...docs.values()],baseline:{id:'REVIEW-01',timestamp:'2026-10-02T13:30:00Z',configuration_version:'demo-v1',findings:baseline}})
}
