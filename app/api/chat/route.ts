import { randomUUID } from 'node:crypto'
import { owner, failure, ok, jsonBody, HttpError } from '@/lib/server/http'
import { rateLimit } from '@/lib/server/db'
import { chatSchema } from '@/lib/server/schema'
import { answerQuestion,getReview,getChats,saveChat } from '@/lib/server/reviews'
import type { StoredChat } from '@/lib/contracts'
export const runtime='nodejs'
export const maxDuration=60
export async function GET(request:Request){try{const id=new URL(request.url).searchParams.get('reviewId');if(!id)throw new HttpError(400,'Review ID is required.');return ok(await getChats(id,await owner()))}catch(e){return failure(e)}}
export async function POST(request:Request){try{const input=chatSchema.parse(await jsonBody(request));const key=await owner(),r=await getReview(input.reviewId,key);if(r.status!=='COMPLETE')throw new HttpError(409,'Finish the review before asking questions.');if(input.findingId&&!r.findings.some(f=>f.id===input.findingId))throw new HttpError(404,'Context finding not found.');await rateLimit(key,'chat',30);await rateLimit('GLOBAL','chat',200);const history=await getChats(r.id,key);const answer=await answerQuestion(r,input.question,input.findingId??undefined,history);const user:StoredChat={id:randomUUID(),role:'user',text:input.question,citations:[],chunkIds:[],mode:'You',at:new Date().toISOString()};const assistant:StoredChat={id:randomUUID(),role:'assistant',text:answer.answer,citations:answer.citations,chunkIds:answer.chunkIds,mode:answer.mode,...('failure' in answer?{failure:answer.failure}:{}),at:new Date(Date.now()+1).toISOString()};await saveChat(r.id,[user,assistant]);return ok({...answer,messages:[user,assistant]})}catch(e){return failure(e)}}
