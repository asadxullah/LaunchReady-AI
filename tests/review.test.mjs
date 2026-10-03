import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
function load(path, imports = {}) {
 const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
 const exports = {}; const module = { exports }
 new Function('require', 'exports', 'module', code)(id => { if (!(id in imports)) throw Error(`Unexpected import ${id}`); return imports[id] }, exports, module)
 return module.exports
}
const mission = load('../lib/mission.ts')
test('summary reflects every finding without hardcoded counters', () => {
 assert.deepEqual(mission.summarize(), { total: 7, passed: 2, review: 3, gaps: 2, reviewed: 0 })
 for (const name of mission.subsystems) assert.ok(mission.findings.some(f => f.subsystem === name))
 assert.equal(new Set(mission.findings.map(f => f.id)).size, 7)
})
test('missing evidence never becomes zero observations or a stable trend', () => {
 for (const f of mission.findings.filter(f => f.gap)) { assert.equal(f.current, null); assert.equal(f.series.length, 0); assert.equal(f.trend, 'INSUFFICIENT_DATA') }
 for (const f of mission.findings.filter(f => f.series.length)) { assert.equal(f.series.length, 7); assert.equal(f.series.at(-1).value, f.current) }
})
test('review dispositions do not alter configured check results', () => {
 const notes = { 'BATTERY-THERMAL': { state: 'DISMISSED_WITH_NOTE', note: 'Retest requested', savedAt: '2026-10-02T15:00:00Z' } }
 const stats = mission.summarize(mission.findings, notes); assert.equal(stats.review, 3); assert.equal(stats.reviewed, 1)
 const report = mission.markdownReport(notes); assert.ok(report.includes('Retest requested')); assert.ok(report.includes('Supporting passage missing')); assert.ok(report.includes('does not approve or certify launches'))
 for (const f of mission.findings) assert.ok(report.includes(f.id))
})
test('demo answers cite known findings and preserve current violations', () => {
 const answer = mission.demoAnswer('Why does improving wind still need review?')
 assert.ok(answer.answer.includes('still above')); assert.ok(answer.citations.includes('SURFACE-WIND'))
 for (const q of ['Summarize this review', 'Which evidence is missing?', 'Which source supports this?', 'What is the next action?']) {
  const r = mission.demoAnswer(q, 'BATTERY-THERMAL'); assert.ok(r.citations.every(id => mission.findings.some(f => f.id === id)))
 }
 assert.equal(mission.demoAnswer('Is it safe to launch?').citations.length, 0)
 assert.ok(mission.demoAnswer('Which document supports this?', 'BATTERY-THERMAL').answer.includes('§4.2.1'))
})
