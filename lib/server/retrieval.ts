import type { Chunk, ReviewRecord } from '../contracts'
import { embed, failureReason } from './gemini'
import type { AIFailure } from '../contracts'
export const tokens=(text:string)=>new Set(text.toLowerCase().match(/[a-z0-9]{3,}/g)??[])
export function lexicalScore(query:string,text:string){const a=tokens(query),b=tokens(text);if(!a.size)return 0;let matches=0;for(const t of a)if(b.has(t))matches++;return matches/a.size}
export function cosine(a:number[],b:number[]){if(a.length!==b.length)return 0;let ab=0,aa=0,bb=0;for(let i=0;i<a.length;i++){ab+=a[i]*b[i];aa+=a[i]**2;bb+=b[i]**2}return aa&&bb?ab/Math.sqrt(aa*bb):0}
export function rankChunks(query:string,chunks:Chunk[],vector?:number[],cutoff=.25){return chunks.map(c=>({chunk:c,score:vector&&c.vector?cosine(vector,c.vector):lexicalScore(query,`${c.title} ${c.section} ${c.text}`)})).filter(x=>x.score>=cutoff).sort((a,b)=>b.score-a.score).slice(0,3).map(x=>x.chunk)}
export async function retrieveReview(review:ReviewRecord){
 let warning:AIFailure|undefined
 try{const vectors=await embed(review.chunks.map(c=>c.text),'document');review.chunks=review.chunks.map((c,i)=>({...c,vector:vectors[i]}));review.retrievalMode='vector'}catch(e){review.retrievalMode='lexical';warning=failureReason(e)}
 let queries:number[][]|undefined
 if(review.retrievalMode==='vector')try{queries=await embed(review.findings.map(f=>`${f.id} ${f.subsystem} ${f.requirement} ${f.title}`),'query')}catch(e){review.retrievalMode='lexical';warning=failureReason(e)}
 review.candidates={}
 review.findings.forEach((f,i)=>{const ranked=rankChunks(`${f.id} ${f.subsystem} ${f.requirement} ${f.title}`,review.chunks,queries?.[i]);const linked=review.chunks.find(c=>c.id===f.source?.id);review.candidates[f.id]=Array.from(new Set([...(linked?[linked.id]:[]),...ranked.map(c=>c.id)])).slice(0,3)})
 return warning
}
