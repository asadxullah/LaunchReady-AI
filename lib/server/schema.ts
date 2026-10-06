import { z } from 'zod'
import { measurementUnits } from '../units'
const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$/)
const time = z.string().datetime({ offset: true })
const finite = z.number().finite()
const unit = z.enum(measurementUnits)
export const requirementSchema = z.object({
 id, item_id: id, version: z.string().min(1).max(32), title: z.string().min(1).max(200), subsystem: z.enum(['PROPULSION','AVIONICS','STRUCTURE','RECOVERY','ENVIRONMENT']),
 parameter: z.string().min(1).max(120), operator: z.enum(['LTE','GTE','RANGE','CHECKLIST']), lower: finite.optional(), upper: finite.optional(), unit,
 priority: z.enum(['HIGH','MEDIUM','LOW']), configuration_version: z.string().min(1).max(48), test_condition: z.string().min(1).max(120),
 freshness_minutes: finite.positive().max(525600), material_change: finite.nonnegative(), trend_min_minutes: finite.nonnegative().default(20), trend_tolerance: finite.nonnegative().default(0.01),
 evaluation_basis: z.enum(['LATEST','MAXIMUM','MINIMUM','ALL']).optional(),
 source: z.object({ document_id: id, section: z.string().max(150), version: z.string().min(1).max(32) }).strict().nullable(),
 required_document_ids: z.array(id).max(10), action: z.string().min(1).max(800), procedure_id: id.optional(), demo_assumption: z.boolean(),
}).strict().superRefine((r,ctx)=>{
 if (['LTE','RANGE'].includes(r.operator) && r.upper===undefined) ctx.addIssue({code:'custom',message:'upper is required'})
 if (['GTE','RANGE'].includes(r.operator) && r.lower===undefined) ctx.addIssue({code:'custom',message:'lower is required'})
 if (r.operator==='RANGE' && r.lower!>r.upper!) ctx.addIssue({code:'custom',message:'lower must not exceed upper'})
 if (r.operator==='CHECKLIST' && r.unit!=='boolean') ctx.addIssue({code:'custom',message:'Checklist unit must be boolean'})
})
export const observationSchema=z.object({ id, item_id:id, test_id:id, timestamp:time, value:finite, unit, configuration_version:z.string().min(1).max(48), test_condition:z.string().min(1).max(120), valid:z.boolean() }).strict()
export const documentSchema=z.object({ id, version:z.string().min(1).max(32), title:z.string().min(1).max(200), content:z.string().min(1).max(100000), simulated:z.boolean() }).strict()
export const packageSchema=z.object({
 schema_version:z.literal('1'), mission:z.object({id,name:z.string().min(1).max(120),configuration_version:z.string().min(1).max(48),timestamp:time,simulated:z.boolean()}).strict(),
 requirements:z.array(requirementSchema).min(1).max(40), observations:z.array(observationSchema).max(2000),
 checklists:z.array(z.object({item_id:id,state:z.enum(['COMPLETE','INCOMPLETE']),timestamp:time,evidence_document_ids:z.array(id).max(10)}).strict()).max(100).default([]),
 documents:z.array(documentSchema).max(12),
 baseline:z.object({id,timestamp:time,configuration_version:z.string().min(1).max(48),findings:z.array(z.object({item_id:id,requirement_version:z.string().min(1).max(32),unit, test_condition:z.string().min(1).max(120),value:finite.nullable(),evaluation:z.enum(['CHECK_PASSED','REVIEW_REQUIRED','MISSING_EVIDENCE'])}).strict()).max(100)}).strict().nullable().default(null),
}).strict().superRefine((p,ctx)=>{
 const issue=(message:string)=>ctx.addIssue({code:'custom',message})
 for(const [label,values] of [['requirement ID',p.requirements.map(r=>r.id)],['item ID',p.requirements.map(r=>r.item_id)],['observation ID',p.observations.map(o=>o.id)],['document ID',p.documents.map(d=>d.id)],['checklist item',p.checklists.map(c=>c.item_id)],['baseline item',p.baseline?.findings.map(f=>f.item_id)??[]]] as [string,string[]][]) if(new Set(values).size!==values.length)issue(`Duplicate ${label}`)
 const reqs=new Map(p.requirements.map(r=>[r.item_id,r])); const docs=new Set(p.documents.map(d=>d.id));
 for(const o of p.observations){if(!reqs.has(o.item_id))issue(`Unknown observation item ${o.item_id}`);if(Date.parse(o.timestamp)>Date.parse(p.mission.timestamp))issue(`Future observation ${o.id}`)}
 for(const c of p.checklists){if(reqs.get(c.item_id)?.operator!=='CHECKLIST')issue(`Invalid checklist item ${c.item_id}`);if(Date.parse(c.timestamp)>Date.parse(p.mission.timestamp))issue(`Future checklist ${c.item_id}`);if(c.evidence_document_ids.some(d=>!docs.has(d)))issue(`Checklist references unknown document ${c.item_id}`)}
 if(p.baseline && Date.parse(p.baseline.timestamp)>=Date.parse(p.mission.timestamp))issue('Baseline must precede current review')
 for(const f of p.baseline?.findings??[])if(!reqs.has(f.item_id))issue(`Unknown baseline item ${f.item_id}`)
 for(const r of p.requirements){if(r.configuration_version!==p.mission.configuration_version)issue(`Requirement configuration mismatch ${r.item_id}`);if(!p.mission.simulated && r.demo_assumption)issue(`Real mission cannot use a demo assumption: ${r.item_id}`)}
 if(!p.mission.simulated && p.documents.some(d=>d.simulated))issue('Real mission cannot use simulated documents')
 // Required documents may be absent: those references intentionally create visible gaps.
})
export type MissionPackage=z.infer<typeof packageSchema>
export type Requirement=z.infer<typeof requirementSchema>
export const noteSchema=z.object({state:z.enum(['PENDING','ACKNOWLEDGED','NEEDS_ACTION','DISMISSED_WITH_NOTE']),note:z.string().max(2000)}).strict().refine(n=>n.state!=='DISMISSED_WITH_NOTE'||!!n.note.trim(),{message:'A dismissal note is required'})
export const chatSchema=z.object({reviewId:id,question:z.string().trim().min(1).max(1500),findingId:id.nullable().optional()}).strict()
