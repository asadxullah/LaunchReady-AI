import type { MissionPackage } from './server/schema'
import type { ReviewRecord } from './contracts'
import type { MeasurementUnit } from './units'

export interface IntakeTable { id: string; filename: string; sheet: string; columns: string[]; rows: string[][] }
export interface IntakeDocument { id: string; filename: string; title: string; content: string; pages: { number: number; text: string }[] }
export interface IntakePreview { tables: IntakeTable[]; documents: IntakeDocument[]; warnings: string[] }
export interface ReviewCheck {
  key: string; title: string; subsystem: 'PROPULSION' | 'AVIONICS' | 'STRUCTURE' | 'RECOVERY' | 'ENVIRONMENT'; priority: 'HIGH' | 'MEDIUM' | 'LOW';
  kind: 'MEASUREMENT' | 'CHECKLIST'; column: string; operator: 'LTE' | 'GTE' | 'RANGE'; lower: string; upper: string; unit: MeasurementUnit;
  basis: 'ALL' | 'LATEST' | 'MAXIMUM' | 'MINIMUM'; manualValue: string; state: 'COMPLETE' | 'INCOMPLETE';
  evidenceIds: string[]; missingEvidence: string; action: string;
}
export interface ReviewSetup {
  name: string; configuration: string; condition: string; startedAt: string; simulated: boolean;
  dataKind: 'MEASURED' | 'SIMULATION'; tableId: string; timeColumn: string; timeFormat: 'ISO' | 'SECONDS' | 'MILLISECONDS';
  checks: ReviewCheck[]; confirmed: boolean;
}
export const intakeLimits = { bytes: 3 * 1024 * 1024, rows: 2000, columns: 64, documents: 11, pdfPages: 40, documentCharacters: 100000, totalCharacters: 300000 } as const
const slug = (value: string) => value.toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 70)
function versionFor(value: unknown) {
  let hash = 2166136261
  for (const c of JSON.stringify(value)) hash = Math.imul(hash ^ c.charCodeAt(0), 16777619) >>> 0
  return `confirmed-${hash.toString(16)}`
}
function numeric(value: string, label: string) {
  if (!value.trim() || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value.trim())) throw new Error(`${label}: enter a numeric value without a unit or thousands separator.`)
  const n = Number(value)
  if (!Number.isFinite(n)) throw new Error(`${label}: the number is out of range.`)
  return n
}
export function makeCheck(index = 1): ReviewCheck {
  return { key: `row-${index}`, title: '', subsystem: 'AVIONICS', priority: 'MEDIUM', kind: 'MEASUREMENT', column: '', operator: 'LTE', lower: '', upper: '', unit: '', basis: 'ALL', manualValue: '', state: 'INCOMPLETE', evidenceIds: [], missingEvidence: '', action: 'Review this finding and record the next action.' }
}
export function buildMissionPackage(setup: ReviewSetup, preview: IntakePreview, previous?: ReviewRecord | null): MissionPackage {
  if (!setup.confirmed) throw new Error('Confirm the units, requirements, and evidence before starting the review.')
  if (!setup.name.trim()) throw new Error('Enter a test or mission name.')
  if (!setup.configuration.trim() || !setup.condition.trim()) throw new Error('Enter the configuration and test condition.')
  if (!setup.checks.length || setup.checks.length > 40) throw new Error('Add between one and 40 checks.')
  if (!setup.simulated && setup.dataKind === 'SIMULATION') throw new Error('Simulation data must be labeled as a simulated review.')
  const start = Date.parse(setup.startedAt)
  if (!Number.isFinite(start)) throw new Error('Enter a valid test date and time.')
  const table = preview.tables.find(t => t.id === setup.tableId)
  if (setup.tableId && !table) throw new Error('Select an available data sheet.')
  const timeIndex = table?.columns.indexOf(setup.timeColumn) ?? -1
  const usesTable = setup.checks.some(c => c.kind === 'MEASUREMENT' && !!c.column)
  if (usesTable && (!table || timeIndex < 0)) throw new Error('Select the data sheet and time column for the mapped measurements.')
  const times = usesTable ? table!.rows.map((row, i) => {
    const text = row[timeIndex]?.trim() ?? ''
    // Explicit offsets avoid interpreting a device's local clock in the server timezone.
    const timestamp = setup.timeFormat === 'ISO' ? (/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(text) ? Date.parse(text) : NaN) : start + numeric(text, `Time in row ${i + 2}`) * (setup.timeFormat === 'SECONDS' ? 1000 : 1)
    if (!Number.isFinite(timestamp) || Math.abs(timestamp) > 8640000000000000) throw new Error(`Invalid time in row ${i + 2}. Use seconds/milliseconds from test start or ISO timestamps with a timezone.`)
    return new Date(timestamp).toISOString()
  }) : []
  const timestamp = new Date(Math.max(start, ...times.map(Date.parse))).toISOString()
  const documents: MissionPackage['documents'] = preview.documents.map(d => ({ id: d.id, title: d.title, version: '1', content: d.content, simulated: setup.simulated }))
  const docIds = new Set(documents.map(d => d.id))
  const observations: MissionPackage['observations'] = []
  const checklists: MissionPackage['checklists'] = []
  const ids = new Set<string>()
  const criteria: string[] = ['# Reviewer-confirmed criteria', 'These requirements were entered and confirmed by the reviewer. They are not independently certified limits.', `Data type: ${setup.dataKind === 'SIMULATION' ? 'simulation' : 'measured test data'}.`, '']
  const requirements = setup.checks.map((c, index) => {
    const title = c.title.trim()
    if (!title) throw new Error(`Check ${index + 1}: enter a title.`)
    const id = `CHECK-${slug(title)}`
    if (ids.has(id)) throw new Error(`Use a different title for each check: ${title}.`)
    ids.add(id)
    if (c.evidenceIds.some(d => !docIds.has(d))) throw new Error(`${title}: a linked document was removed. Choose the evidence again.`)
    if (c.evidenceIds.length + Number(!!c.missingEvidence.trim()) > 10) throw new Error(`${title}: link at most 10 required documents, including any missing record.`)
    const lower = c.kind === 'MEASUREMENT' && c.operator !== 'LTE' ? numeric(c.lower, `${title} lower limit`) : undefined
    const upper = c.kind === 'MEASUREMENT' && c.operator !== 'GTE' ? numeric(c.upper, `${title} upper limit`) : undefined
    if (lower !== undefined && upper !== undefined && lower > upper) throw new Error(`${title}: the lower limit must not exceed the upper limit.`)
    if (c.kind === 'MEASUREMENT' && c.column) {
      const columnIndex = table!.columns.indexOf(c.column)
      if (columnIndex < 0) throw new Error(`${title}: select an available measurement column.`)
      for (const [i, row] of table!.rows.entries()) {
        const text = row[columnIndex]?.trim() ?? ''
        if (!text) throw new Error(`${title}: row ${i + 2} has an empty measurement. Correct the file or select another column.`)
        observations.push({ id: `OBS-${index + 1}-${i + 1}`, item_id: id, test_id: 'UPLOADED-TEST', timestamp: times[i], value: numeric(text, `${title}, row ${i + 2}`), unit: c.unit, configuration_version: setup.configuration.trim(), test_condition: setup.condition.trim(), valid: true })
      }
    } else if (c.kind === 'MEASUREMENT' && c.manualValue.trim()) {
      observations.push({ id: `OBS-${index + 1}-MANUAL`, item_id: id, test_id: 'MANUAL-READING', timestamp, value: numeric(c.manualValue, title), unit: c.unit, configuration_version: setup.configuration.trim(), test_condition: setup.condition.trim(), valid: true })
    }
    if (c.kind === 'CHECKLIST') checklists.push({ item_id: id, state: c.state, timestamp, evidence_document_ids: c.evidenceIds })
    const missing = c.missingEvidence.trim() ? [`MISSING-${index + 1}`] : []
    const operator = c.kind === 'CHECKLIST' ? 'CHECKLIST' as const : c.operator
    const unit = c.kind === 'CHECKLIST' ? 'boolean' as const : c.unit
    criteria.push(`## ${id}`, title, `Requirement: ${operator === 'CHECKLIST' ? 'Completed check and linked evidence' : operator === 'LTE' ? `at most ${upper} ${unit}` : operator === 'GTE' ? `at least ${lower} ${unit}` : `between ${lower} and ${upper} ${unit}`}.`, `Evaluation basis: ${c.kind === 'CHECKLIST' ? 'checklist state' : c.basis === 'ALL' ? 'every imported sample' : c.basis.toLowerCase()}.`, `Measurement source: ${c.kind === 'CHECKLIST' ? 'reviewer-entered checklist' : c.column ? `${table!.filename} / ${table!.sheet} / ${c.column}` : 'reviewer-entered reading'}.`, `Required evidence: ${[...c.evidenceIds.map(d => documents.find(doc => doc.id === d)!.title), c.missingEvidence.trim()].filter(Boolean).join(', ') || 'none specified'}.`, '')
    return { id: `REQ-${index + 1}`, item_id: id, version: versionFor({ title, operator, lower, upper, unit, basis: c.basis, condition: setup.condition, dataKind: setup.dataKind }), title, subsystem: c.subsystem, parameter: (c.column || title).slice(0, 120), operator, lower, upper, unit, priority: c.priority, configuration_version: setup.configuration.trim(), test_condition: setup.condition.trim(), freshness_minutes: 525600, material_change: 0, trend_min_minutes: 0, trend_tolerance: 0.01, evaluation_basis: c.kind === 'CHECKLIST' ? 'LATEST' as const : c.basis, source: { document_id: 'DOC-REVIEW-CRITERIA', section: id, version: '1' }, required_document_ids: [...c.evidenceIds, ...missing], action: c.action.trim() || 'Review this finding and record the next action.', demo_assumption: false }
  })
  if (observations.length > intakeLimits.rows) throw new Error('This review exceeds 2,000 mapped measurements. Use a shorter exported time window or fewer measurement checks; data is never silently discarded.')
  documents.push({ id: 'DOC-REVIEW-CRITERIA', title: 'Reviewer-confirmed criteria', version: '1', content: criteria.join('\n'), simulated: setup.simulated })
  const baseline = previous && previous.mission.configuration === setup.configuration.trim() && previous.mission.simulated === setup.simulated ? { id: previous.id, timestamp: previous.mission.timestamp, configuration_version: previous.mission.configuration, findings: previous.findings.filter(f => ids.has(f.id)).map(f => ({ item_id: f.id, requirement_version: f.requirementVersion || '1', unit: f.unit as MeasurementUnit, test_condition: setup.condition.trim(), value: f.current, evaluation: f.evaluation })) } : null
  if (previous && !baseline) throw new Error('The previous review must use the same configuration and measured/simulated data type.')
  if (baseline && Date.parse(baseline.timestamp) >= Date.parse(timestamp)) throw new Error('The previous review must be earlier than this test.')
  return { schema_version: '1', mission: { id: `TEST-${slug(setup.name)}`, name: setup.name.trim(), configuration_version: setup.configuration.trim(), timestamp, simulated: setup.simulated }, requirements, observations, checklists, documents, baseline }
}
