import { owner,failure,HttpError } from '@/lib/server/http'
import { getReview } from '@/lib/server/reviews'
import { exportReview } from '@/lib/server/export'
export const runtime='nodejs'
export async function GET(_:Request,{params}:{params:Promise<{id:string}>}){try{const r=await getReview((await params).id,await owner());if(r.status!=='COMPLETE')throw new HttpError(409,'Report is not complete yet.');return new Response(exportReview(r),{headers:{'Content-Type':'text/markdown; charset=utf-8','Content-Disposition':`attachment; filename="LaunchReady-${r.id}.md"`,'Cache-Control':'no-store'}})}catch(e){return failure(e)}}
