import { createClient, type Client, type InValue } from '@libsql/client'
import { mkdirSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
let client:Client|undefined; let ready:Promise<void>|undefined
export async function db(){
 if(!client){
  const url=process.env.TURSO_DATABASE_URL || 'file:./data/launchready.db'
  if(process.env.VERCEL && !/^libsql:|^https:/.test(url))throw new Error('Configure TURSO_DATABASE_URL and TURSO_AUTH_TOKEN for persistent storage on Vercel.')
  if(url.startsWith('file:'))mkdirSync('data',{recursive:true})
  client=createClient({url,authToken:process.env.TURSO_AUTH_TOKEN})
 }
 if(!ready)ready=client.batch([
  'CREATE TABLE IF NOT EXISTS packages (id TEXT PRIMARY KEY, owner TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL)',
  'CREATE INDEX IF NOT EXISTS packages_owner ON packages(owner)',
  'CREATE TABLE IF NOT EXISTS reviews (id TEXT PRIMARY KEY, owner TEXT NOT NULL, package_id TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL, lease_until INTEGER NOT NULL DEFAULT 0, lease_token TEXT)',
  'CREATE INDEX IF NOT EXISTS reviews_owner ON reviews(owner)',
  'CREATE TABLE IF NOT EXISTS notes (review_id TEXT NOT NULL, finding_id TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY(review_id,finding_id))',
  'CREATE TABLE IF NOT EXISTS chat (id TEXT PRIMARY KEY, review_id TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL)',
  'CREATE INDEX IF NOT EXISTS chat_review ON chat(review_id,created_at)',
  'CREATE TABLE IF NOT EXISTS limits (owner TEXT NOT NULL, action TEXT NOT NULL, bucket INTEGER NOT NULL, count INTEGER NOT NULL, PRIMARY KEY(owner,action,bucket))',
 ],'write').then(()=>{}).catch(e=>{ready=undefined;throw e})
 await ready;return client
}
export async function query(sql:string,args:InValue[]=[]){return (await db()).execute({sql,args})}
export async function rateLimit(owner:string,action:string,max:number){
 const bucket=Math.floor(Date.now()/3600000)
 const result=await query('INSERT INTO limits(owner,action,bucket,count) VALUES(?,?,?,1) ON CONFLICT(owner,action,bucket) DO UPDATE SET count=count+1 RETURNING count',[owner,action,bucket])
 if(Number(result.rows[0].count)>max){const e=new Error('Hourly limit reached. Try again later.');Object.assign(e,{status:429});throw e}
 await query('DELETE FROM limits WHERE bucket < ?',[bucket-24])
}
export async function acquireLease(reviewId:string,owner:string){const token=randomUUID();const result=await query('UPDATE reviews SET lease_until=?,lease_token=? WHERE id=? AND owner=? AND lease_until<?',[Date.now()+90000,token,reviewId,owner,Date.now()]);return result.rowsAffected?token:null}
