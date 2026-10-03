import { parse } from 'csv-parse/sync'
import { packageSchema } from './schema'
import { HttpError, jsonBody, sameOrigin } from './http'
const MAX=3*1024*1024
export async function ingest(request:Request){
 if(request.headers.get('content-type')?.includes('application/json'))return packageSchema.parse(await jsonBody(request,MAX))
 sameOrigin(request)
 if(!request.headers.get('content-type')?.includes('multipart/form-data'))throw new HttpError(415,'Upload JSON, or a JSON manifest with CSV and Markdown/TXT documents.')
 const reader=request.body?.getReader();if(!reader)throw new HttpError(400,'Empty upload.');const chunks:Uint8Array[]=[];let bytes=0;while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.length;if(bytes>MAX){await reader.cancel();throw new HttpError(413,'Combined upload exceeds 3 MB.')}chunks.push(value)}
 let form:FormData;try{form=await new Response(Buffer.concat(chunks),{headers:{'Content-Type':request.headers.get('content-type')!}}).formData()}catch{throw new HttpError(400,'Malformed multipart upload.')}
 for(const key of form.keys())if(!['package','observations','documents'].includes(key))throw new HttpError(400,`Unknown upload field: ${key}`)
 const file=form.get('package');if(!(file instanceof File)||!file.name.endsWith('.json'))throw new HttpError(400,'A JSON mission package is required.')
 let raw:Record<string,unknown>;try{raw=JSON.parse(await file.text());if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error()}catch{throw new HttpError(400,'The mission package is not a JSON object.')}
 const csv=form.get('observations');if(csv){if(!(csv instanceof File)||!csv.name.endsWith('.csv'))throw new HttpError(400,'Observations must be CSV.');try{raw.observations=parse(await csv.text(),{columns:true,bom:true,skip_empty_lines:true,trim:true,max_record_size:10000}).map((unknownRow:unknown)=>{const row=unknownRow as Record<string,string>;if(!row.value?.trim()||!['true','false'].includes(row.valid))throw new Error();return {...row,value:Number(row.value),valid:row.valid==='true'}})}catch{throw new HttpError(422,'Invalid observation CSV. Use the sample headers and numeric values; valid must be true or false.')}}
 const docs=form.getAll('documents');if(docs.length>12)throw new HttpError(422,'At most 12 documents are supported.')
 if(docs.length&&!Array.isArray(raw.documents))throw new HttpError(422,'The manifest needs a documents array.')
 for(const doc of docs){if(!(doc instanceof File)||!/^.+\.(md|txt)$/i.test(doc.name))throw new HttpError(422,'Supporting documents must be Markdown or TXT.');const id=doc.name.replace(/\.(md|txt)$/i,'');const manifestDoc=(raw.documents as Record<string,unknown>[]).find(d=>d.id===id);if(!manifestDoc)throw new HttpError(422,`Document ${doc.name} must match a document ID in the manifest.`);manifestDoc.content=await doc.text()}
 return packageSchema.parse(raw)
}
