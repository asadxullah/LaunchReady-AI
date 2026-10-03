import { owner,failure,ok,jsonBody,HttpError } from '@/lib/server/http'
import { getReview } from '@/lib/server/reviews'
import { noteSchema } from '@/lib/server/schema'
import { query } from '@/lib/server/db'
import { z } from 'zod'
export const runtime='nodejs'
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){try{const {findingId,...raw}=z.object({findingId:z.string().max(96),state:z.string(),note:z.string()}).strict().parse(await jsonBody(request));const note=noteSchema.parse(raw);const id=(await params).id,r=await getReview(id,await owner());if(r.status!=='COMPLETE')throw new HttpError(409,'Finish the review before saving notes.');if(!r.findings.some(f=>f.id===findingId))throw new HttpError(404,'Finding not found.');const saved={...note,note:note.note.trim(),savedAt:new Date().toISOString()};await query('INSERT INTO notes(review_id,finding_id,body) VALUES(?,?,?) ON CONFLICT(review_id,finding_id) DO UPDATE SET body=excluded.body',[id,findingId,JSON.stringify(saved)]);return ok(saved)}catch(e){return failure(e)}}
