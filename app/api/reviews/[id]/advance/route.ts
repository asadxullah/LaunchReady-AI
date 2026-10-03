import { owner,failure,ok,jsonBody } from '@/lib/server/http'
import { advanceReview,publicReview } from '@/lib/server/reviews'
export const runtime='nodejs'
export const maxDuration=60
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){try{await jsonBody(request);return ok(publicReview(await advanceReview((await params).id,await owner())))}catch(e){return failure(e)}}
