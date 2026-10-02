import { findings, mission } from '../../../lib/mission'

// Server-side integration point. Set LAUNCHREADY_AI_CHAT_URL to your team's AI API.
export async function POST(request: Request) {
  const endpoint = process.env.LAUNCHREADY_AI_CHAT_URL
  if (!endpoint) return Response.json({ error: 'AI backend is not configured. Use Demo templates, or set LAUNCHREADY_AI_CHAT_URL on the server.' }, { status: 503 })
  try {
    const text = await request.text()
    if (text.length > 6000) return Response.json({ error: 'Request is too large.' }, { status: 413 })
    let body
    try { body = JSON.parse(text) } catch { return Response.json({ error: 'Invalid JSON request.' }, { status: 400 }) }
    if (!body || typeof body.question !== 'string' || !body.question.trim() || body.question.length > 1500 || body.missionId !== mission.id || (body.findingId != null && !findings.some(f => f.id === body.findingId))) return Response.json({ error: 'Invalid mission, finding, or question.' }, { status: 400 })
    const upstream = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(process.env.LAUNCHREADY_AI_API_TOKEN ? { Authorization: `Bearer ${process.env.LAUNCHREADY_AI_API_TOKEN}` } : {}) }, body: JSON.stringify({ question: body.question, missionId: mission.id, findingId: body.findingId ?? null, findings }), signal: AbortSignal.timeout(20000), cache: 'no-store' })
    if (!upstream.ok) return Response.json({ error: 'AI backend unavailable. Retry or use Demo templates.' }, { status: 502 })
    const result = await upstream.json()
    if (typeof result.answer !== 'string' || !result.answer.trim() || result.answer.length > 12000 || !Array.isArray(result.citations) || result.citations.length > 20 || result.citations.some((id: unknown) => typeof id !== 'string' || !findings.some(f => f.id === id))) return Response.json({ error: 'AI response contained unsupported content or citations.' }, { status: 502 })
    return Response.json({ answer: result.answer, citations: [...new Set(result.citations)] })
  } catch { return Response.json({ error: 'AI request failed or timed out. Retry or use Demo templates.' }, { status: 502 }) }
}
