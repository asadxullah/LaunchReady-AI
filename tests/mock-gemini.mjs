// Only loaded by the integration test child process, never by the app.
const original=globalThis.fetch
const vector=text=>{const values=Array(768).fill(0);for(const token of text.toLowerCase().match(/[a-z0-9]+/g)||[]){let n=0;for(const c of token)n=(n*31+c.charCodeAt(0))>>>0;values[n%768]++}return values}
globalThis.fetch=async(url,init)=>{
 if(!String(url).startsWith('https://generativelanguage.googleapis.com/'))return original(url,init)
 const body=JSON.parse(String(init?.body))
 const code=JSON.stringify(body).match(/TEST_HTTP_(\d{3})/)?.[1];if(code)return Response.json({error:'test failure'}, {status:Number(code)})
 if(JSON.stringify(body).includes('FAIL-AI'))return Response.json({error:'quota test'}, {status:429})
 if(String(url).includes('batchEmbedContents'))return Response.json({embeddings:body.requests.map(r=>({values:vector(r.content.parts[0].text)}))})
 const {task,context}=JSON.parse(body.input);let result
 if(task.startsWith('Evidence Agent'))result={links:context.candidates.map(c=>({findingId:c.findingId,chunkIds:c.chunks.slice(0,1).map(x=>x.id),quotes:c.chunks.slice(0,1).map(x=>x.text.slice(0,1000))}))}
 else if(task.startsWith('Analysis Agent'))result={relationships:[{text:'Wind is improving while its current check still requires review.',findingIds:['SURFACE-WIND'],hypothesis:false}]}
 else if(task.startsWith('Report Agent'))result={summary:'Battery temperature and wind require review. Missing inspection evidence remains open.',findingIds:context.findings.map(f=>f.id)}
 else if(context.question==='TEST_UNKNOWN_CITATION')result={answer:'Unsupported finding.',citations:['INVENTED'],chunkIds:[]}
 else result={answer:context.question.toLowerCase().includes('previous')?'The previous question was about the battery temperature finding.':'Battery temperature is above its configured limit. Repeat the configured test and request engineering review.',citations:['BATTERY-THERMAL'],chunkIds:context.chunks.slice(0,1).map(c=>c.id)}
 return Response.json({outputs:[{type:'text',text:JSON.stringify(result)}]})
}
