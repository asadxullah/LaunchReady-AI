import { z } from 'zod'
import { owner, failure, ok, jsonBody } from '@/lib/server/http'
import { query,rateLimit } from '@/lib/server/db'
import { startReview } from '@/lib/server/reviews'
import type { ReviewRecord } from '@/lib/contracts'
export const runtime='nodejs'
export async function GET(){try{const key=await owner();const result=await query('SELECT body FROM reviews WHERE owner=? ORDER BY created_at DESC LIMIT 30',[key]);return ok(result.rows.map(row=>{const r=JSON.parse(String(row.body)) as ReviewRecord;return {id:r.id,name:r.mission.name,simulated:r.mission.simulated,status:r.status,stage:r.stage,createdAt:r.createdAt}}))}catch(e){return failure(e)}}
export async function POST(request:Request){try{const {packageId}=z.object({packageId:z.string().uuid()}).strict().parse(await jsonBody(request));const key=await owner();await rateLimit(key,'reviews',10);await rateLimit('GLOBAL','reviews',40);return ok(await startReview(packageId,key),201)}catch(e){return failure(e)}}
