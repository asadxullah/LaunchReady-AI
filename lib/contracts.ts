import type { Finding, ReviewNotes } from './mission'
export type Stage = 'VALIDATE' | 'EVALUATE' | 'RETRIEVE' | 'EVIDENCE_AGENT' | 'ANALYSIS_AGENT' | 'REPORT_AGENT' | 'COMPLETE'
export const stages: Stage[] = ['VALIDATE', 'EVALUATE', 'RETRIEVE', 'EVIDENCE_AGENT', 'ANALYSIS_AGENT', 'REPORT_AGENT', 'COMPLETE']
export const stageLabels: Record<Stage, string> = { VALIDATE: 'Validate inputs', EVALUATE: 'Evaluate rules, trends, and changes', RETRIEVE: 'Retrieve document evidence', EVIDENCE_AGENT: 'Evidence Agent', ANALYSIS_AGENT: 'Analysis Agent', REPORT_AGENT: 'Report Agent', COMPLETE: 'Review saved' }
export interface Chunk { id: string; documentId: string; version: string; title: string; section: string; text: string; vector?: number[] }
export type AIFailureCode = 'NOT_CONFIGURED' | 'AUTHENTICATION' | 'PERMISSION' | 'QUOTA' | 'MODEL_NOT_FOUND' | 'TIMEOUT' | 'NETWORK' | 'PROVIDER_UNAVAILABLE' | 'REQUEST_REJECTED' | 'INVALID_RESPONSE' | 'OUTPUT_REJECTED'
export interface AIFailure { code: AIFailureCode; reason: string; httpStatus?: number; retryAfterSeconds?: number }
export interface AgentEvent { stage: Stage; mode: 'code' | 'gemini' | 'groq' | 'fallback'; detail: string; at: string; failure?: AIFailure }
export interface Narrative { summary: string; summaryMode?: 'gemini' | 'groq' | 'code'; summaryFailure?: AIFailure; relationships: { text: string; findingIds: string[]; hypothesis: boolean }[] }
export interface ReviewRecord {
 id: string; packageId: string; mission: { id: string; name: string; configuration: string; timestamp: string; simulated: boolean; baseline: string | null };
 stage: Stage; status: 'RUNNING' | 'COMPLETE' | 'FAILED'; createdAt: string; updatedAt: string; findings: Finding[]; notes: ReviewNotes;
 chunks: Chunk[]; candidates: Record<string, string[]>; events: AgentEvent[]; narrative: Narrative; warnings: string[]; error?: string;
 agentEvidence?: { findingId: string; chunkIds: string[]; quotes: string[] }[];
 aiRetry?: { stage: Stage; nextAttemptAt: string; attempt: 1; failure: AIFailure };
 fingerprint: string; engineVersion: string; model: string; retrievalMode: 'pending' | 'vector' | 'lexical';
}
export interface PackageListItem { id: string; name: string; simulated: boolean; createdAt: string; requirements: number; observations: number; documents: number }
export interface StoredChat { id: string; role: 'user' | 'assistant'; text: string; citations: string[]; chunkIds: string[]; mode: string; at: string; failure?: AIFailure }
