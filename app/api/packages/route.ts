import { query,rateLimit } from '@/lib/server/db'
import { owner, failure, ok, jsonBody } from '@/lib/server/http'
import { demoPackage } from '@/lib/server/demo'
import { savePackage } from '@/lib/server/reviews'
import { ingest } from '@/lib/server/ingest'
import type { MissionPackage } from '@/lib/server/schema'
export const runtime='nodejs'
export async function GET(){try{const key=await owner();const result=await query('SELECT id,body,created_at FROM packages WHERE owner=? ORDER BY created_at DESC LIMIT 30',[key]);return ok(result.rows.map(row=>{const p=JSON.parse(String(row.body)) as MissionPackage;return {id:row.id,name:p.mission.name,simulated:p.mission.simulated,createdAt:row.created_at,requirements:p.requirements.length,observations:p.observations.length,documents:p.documents.length}}))}catch(e){return failure(e)}}
export async function POST(request:Request){try{const key=await owner();await rateLimit(key,'packages',20);await rateLimit('GLOBAL','packages',100);let p:MissionPackage;if(request.headers.get('x-launchready-demo')==='1'){await jsonBody(request);p=demoPackage()}else p=await ingest(request);const id=await savePackage(p,key);return ok({id,name:p.mission.name,simulated:p.mission.simulated,requirements:p.requirements.length,observations:p.observations.length,documents:p.documents.length},201)}catch(e){return failure(e)}}
