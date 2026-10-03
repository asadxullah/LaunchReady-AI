import { owner,failure,ok } from '@/lib/server/http'
import { getReview,publicReview } from '@/lib/server/reviews'
export const runtime='nodejs'
export async function GET(_:Request,{params}:{params:Promise<{id:string}>}){try{return ok(publicReview(await getReview((await params).id,await owner())))}catch(e){return failure(e)}}
