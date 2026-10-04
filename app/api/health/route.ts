import { db } from '@/lib/server/db'
import { configured,model,embeddingsConfigured,embeddingModel } from '@/lib/server/gemini'
import { ok } from '@/lib/server/http'
export const runtime='nodejs'
export async function GET(){try{await db();return ok({database:'connected',ai:configured()?'configured':'not_configured',provider:'groq',model:model(),embeddings:embeddingsConfigured()?'configured':'not_configured',embeddingModel:embeddingModel()})}catch{return ok({database:'not_configured',ai:configured()?'configured':'not_configured',provider:'groq',model:model(),embeddings:embeddingsConfigured()?'configured':'not_configured',embeddingModel:embeddingModel()},503)}}
