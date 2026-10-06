import assert from 'node:assert/strict'
import test from 'node:test'
import ExcelJS from 'exceljs'
import { makePdf } from './file-fixtures.mjs'
import { parseCsv, parseWorkbook, parsePdf, previewFiles, readUploadForm } from '../lib/server/file-intake'
import { buildMissionPackage, makeCheck, type ReviewSetup, type IntakePreview } from '../lib/intake'
import { packageSchema } from '../lib/server/schema'
import { chunkDocuments, evaluate, convert } from '../lib/server/engine'
import { guessUnit } from '../lib/units'
import type { ReviewRecord } from '../lib/contracts'

function inputs() {
  const preview: IntakePreview = { tables: [parseCsv('Time (s),Battery (V)\n0,12\n1,16\n2,11\n', 'flight.csv')], documents: [], warnings: [] }
  const setup: ReviewSetup = { name: 'Flight test', configuration: 'v1', condition: 'flight-test', startedAt: '2026-10-06T12:00:00Z', simulated: false, dataKind: 'MEASURED', tableId: 'TABLE-1', timeColumn: 'Time (s)', timeFormat: 'SECONDS', confirmed: true, checks: [{ ...makeCheck(), title: 'Battery voltage', unit: 'V', upper: '14', column: 'Battery (V)' }] }
  return { preview, setup }
}
test('CSV detects spreadsheet delimiters and commented flight-log headers without dropping rows', () => {
  for (const sep of [',', ';', '\t']) assert.deepEqual(parseCsv(`Time (s)${sep}Altitude (m)\n0${sep}20\n1${sep}30`, 'flight.csv').rows, [['0','20'],['1','30']])
  assert.deepEqual(parseCsv('# Export configuration\n# Time (s),Altitude (m)\n0,20\n# Flight event\n1,30', 'simulation.csv').columns, ['Time (s)', 'Altitude (m)'])
  for (const text of ['Time,Time\n1,2', 'Time,Value\n1,2,3', 'Time,Value\n' + Array(2001).fill('1,2').join('\n')]) assert.throws(() => parseCsv(text, 'bad.csv'))
})
test('XLSX previews sheets and dates; formula caches cannot become measurements', async () => {
  const workbook = new ExcelJS.Workbook(), sheet = workbook.addWorksheet('Flight')
  sheet.addRow(['Timestamp', 'Altitude (m)', 'Computed']); sheet.addRow([new Date('2026-10-06T12:00:00Z'), 100, { formula: '1+1', result: 2 }])
  const parsed = await parseWorkbook(Buffer.from(await workbook.xlsx.writeBuffer()), 'flight.xlsx')
  assert.deepEqual(parsed.tables[0].rows, [['2026-10-06T12:00:00.000Z', '100', '']]); assert.match(parsed.warnings[0], /formula/)
  await assert.rejects(() => parseWorkbook(Buffer.from('not a ZIP'), 'old.xls'))
})
test('PDF retains page references and exact text; scans, excess pages and invalid files are rejected', async () => {
  const parsed = await parsePdf(makePdf(['Recovery inspected.', 'Signed by reviewer.']), 'inspection.pdf', 'DOC-1')
  assert.equal(parsed.document.pages.length, 2); assert.match(parsed.document.content, /## Page 2\nSigned by reviewer\./)
  const { setup, preview } = inputs(); preview.documents.push(parsed.document)
  assert.ok(chunkDocuments(buildMissionPackage(setup, preview)).some(chunk => chunk.section === 'Page 2' && chunk.text === 'Signed by reviewer.'))
  await assert.rejects(() => parsePdf(makePdf(['']), 'scan.pdf', 'DOC-2'), /OCR/)
  await assert.rejects(() => parsePdf(makePdf(Array(41).fill('Page text')), 'long.pdf', 'DOC-2'), /40 PDF pages/)
  await assert.rejects(() => parsePdf(Buffer.from('bad'), 'invalid.pdf', 'DOC-2'), /valid PDF/)
})
test('Confirmed form uses all readings and links entered criteria separately from supplied evidence', () => {
  const { setup, preview } = inputs(); const p = packageSchema.parse(buildMissionPackage(setup, preview))
  assert.equal(p.mission.simulated, false); assert.equal(p.observations.length, 3); assert.equal(p.observations[2].timestamp, '2026-10-06T12:00:02.000Z')
  const finding = evaluate(p, chunkDocuments(p)).findings[0]
  assert.equal(finding.current, 16); assert.equal(finding.evaluation, 'REVIEW_REQUIRED'); assert.equal(finding.dataId, 'OBS-1-2'); assert.match(finding.ruleLabel!, /every imported sample/)
  assert.equal(finding.source?.title, 'Reviewer-confirmed criteria'); assert.match(finding.source!.excerpt, /flight.csv/)
  p.requirements[0].evaluation_basis = 'LATEST'; assert.equal(evaluate(p, chunkDocuments(p)).findings[0].current, 11)
  p.requirements[0].evaluation_basis = 'MINIMUM'; assert.equal(evaluate(p, chunkDocuments(p)).findings[0].current, 11)
  p.requirements[0].evaluation_basis = 'MAXIMUM'; assert.equal(evaluate(p, chunkDocuments(p)).findings[0].current, 16)
})
test('Both lower and upper excursions matter for ranges, including peaks outside the recent chart window', () => {
  const { setup, preview } = inputs(); setup.checks[0].operator = 'RANGE'; setup.checks[0].lower = '10'
  preview.tables[0].rows = Array.from({ length: 30 }, (_, i) => [String(i), String(i === 1 ? 2 : i === 2 ? 16 : 12)])
  const p = packageSchema.parse(buildMissionPackage(setup, preview)); const f = evaluate(p, chunkDocuments(p)).findings[0]
  assert.equal(f.current, 2); assert.equal(f.evaluation, 'REVIEW_REQUIRED'); assert.ok(f.series.some(point => point.value === 2))
})
test('Manual readings and checklists work without a spreadsheet; missing documents remain evidence gaps', () => {
  const { setup } = inputs(); setup.tableId = ''; setup.checks = [{ ...makeCheck(), title: 'Inspection', kind: 'CHECKLIST', state: 'COMPLETE', missingEvidence: 'Signed inspection record' }]
  const preview: IntakePreview = { tables: [], documents: [], warnings: [] }
  let p = packageSchema.parse(buildMissionPackage(setup, preview)); assert.equal(evaluate(p, chunkDocuments(p)).findings[0].evaluation, 'MISSING_EVIDENCE')
  setup.checks = [{ ...makeCheck(), title: 'Voltage', upper: '14', unit: 'V', manualValue: '12' }]
  p = packageSchema.parse(buildMissionPackage(setup, preview)); assert.equal(evaluate(p, chunkDocuments(p)).findings[0].evaluation, 'CHECK_PASSED')
})
test('Unconfirmed, ambiguous, missing and over-limit inputs fail without silently changing data', () => {
  const { setup, preview } = inputs()
  assert.throws(() => buildMissionPackage({ ...setup, confirmed: false }, preview), /Confirm/)
  assert.throws(() => buildMissionPackage({ ...setup, dataKind: 'SIMULATION' }, preview), /Simulation/)
  preview.tables[0].rows[1][1] = ''; assert.throws(() => buildMissionPackage(setup, preview), /empty measurement/)
  preview.tables[0].rows[1][1] = '16 V'; assert.throws(() => buildMissionPackage(setup, preview), /numeric/)
  preview.tables[0].rows[1][1] = '16'; setup.timeFormat = 'ISO'; assert.throws(() => buildMissionPackage(setup, preview), /timezone/)
  setup.timeFormat = 'SECONDS'; setup.checks.push({ ...setup.checks[0], key: 'other' }); assert.throws(() => buildMissionPackage(setup, preview), /different title/)
  setup.checks[1].title = 'Other voltage'; preview.tables[0].rows = Array.from({ length: 1001 }, (_, i) => [String(i), '12']); assert.throws(() => buildMissionPackage(setup, preview), /2,000 mapped/)
})
test('Changed thresholds do not compare as an unchanged requirement', () => {
  const { setup, preview } = inputs(); const first = buildMissionPackage(setup, preview)
  const previous = { id: 'previous', mission: { configuration: 'v1', timestamp: first.mission.timestamp, simulated: false }, findings: evaluate(first, chunkDocuments(first)).findings } as ReviewRecord
  setup.startedAt = '2026-10-06T13:00:00Z'; setup.checks[0].upper = '18'
  const p = packageSchema.parse(buildMissionPackage(setup, preview, previous)); const f = evaluate(p, chunkDocuments(p)).findings[0]
  assert.equal(f.status, 'NOT_COMPARABLE'); assert.equal(f.previous, null)
})
test('Additional flight units convert only within compatible dimensions', () => {
  assert.equal(convert(1000,'ft','m'), 304.8); assert.equal(convert(2,'g','m/s²'),19.6133); assert.equal(convert(12000,'mV','V'),12)
  assert.equal(convert(1,'bar','kPa'),100); assert.throws(() => convert(1,'m','m/s')); assert.equal(guessUnit('Acceleration (m/s^2)'), 'm/s²'); assert.equal(guessUnit('Voltage (V)'), 'V')
})
test('Upload validation enforces origin, body size and one data file; preview needs no AI key', async () => {
  const form = new FormData(); form.append('files', new File(['Time,Value\n0,1'], 'test.csv'))
  const parsed = await readUploadForm(new Request('http://localhost/api/intake', { method: 'POST', body: form, headers: { origin: 'http://localhost' } }))
  assert.equal(parsed.getAll('files').length,1)
  await assert.rejects(() => readUploadForm(new Request('http://localhost/api/intake', { method: 'POST', body: form, headers: { origin: 'https://other.example' } })), /origin/i)
  // Incoming HTTP bodies are byte streams, rather than undici's synthetic FormData producer.
  await assert.rejects(() => readUploadForm(new Request('http://localhost/api/intake', { method: 'POST', body: Buffer.alloc(3*1024*1024 + 1), headers: { 'content-type': 'multipart/form-data; boundary=test' } })), /3 MB/)
  await assert.rejects(() => previewFiles([new File(['Time,Value\n0,1'], 'one.csv'),new File(['Time,Value\n0,1'], 'two.csv')]), /one measurement file/)
  const original = globalThis.fetch
  try { globalThis.fetch = async () => { throw new Error('Intake must not call an AI service.') }; const p = await previewFiles([new File([makePdf()], 'inspection.pdf')]); assert.equal(p.documents.length,1) }
  finally { globalThis.fetch = original }
})
