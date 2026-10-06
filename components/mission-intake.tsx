'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ArrowRight, Check, CloudUpload, FileText, Plus, Trash2 } from 'lucide-react'
import { buildMissionPackage, intakeLimits, makeCheck, type IntakePreview, type ReviewCheck, type ReviewSetup } from '../lib/intake'
import { guessUnit, measurementUnits } from '../lib/units'
import type { MissionPackage } from '../lib/server/schema'
import type { ReviewRecord } from '../lib/contracts'

const emptyPreview: IntakePreview = { tables: [], documents: [], warnings: [] }
function localNow() { const now = new Date(); return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16) }
function initialSetup(): ReviewSetup {
  return { name: '', configuration: 'v1', condition: 'flight-test', startedAt: localNow(), simulated: false, dataKind: 'MEASURED', tableId: '', timeColumn: '', timeFormat: 'SECONDS', checks: [makeCheck()], confirmed: false }
}
async function readApi<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, signal: init?.signal ?? AbortSignal.timeout(55000) })
  const body = await response.json()
  if (!response.ok) throw new Error([body.error || 'Could not read the files.', ...(body.issues || [])].join('\n'))
  return body
}
export function MissionIntake({ busy, onRun, history }: { busy: boolean; onRun: (mission: MissionPackage) => Promise<void>; history: { id: string; name: string; status: string; createdAt: string }[] }) {
  const [files, setFiles] = useState<File[]>([])
  const [preview, setPreview] = useState<IntakePreview>(emptyPreview)
  const [setup, setSetup] = useState<ReviewSetup>(initialSetup)
  const [step, setStep] = useState<'files' | 'checks'>('files')
  const [reading, setReading] = useState(false)
  const [error, setError] = useState('')
  const [baseline, setBaseline] = useState('')
  const abort = useRef<AbortController | null>(null)
  const sequence = useRef(1)
  const formRef = useRef<HTMLFormElement>(null)
  const disabled = busy || reading
  const table = preview.tables.find(t => t.id === setup.tableId)
  const numericChecks = setup.checks.filter(c => c.kind === 'MEASUREMENT' && !!c.column).length
  const count = (table?.rows.length ?? 0) * numericChecks + setup.checks.filter(c => c.kind === 'MEASUREMENT' && !c.column && c.manualValue.trim()).length
  useEffect(() => () => abort.current?.abort(), [])
  function change<K extends keyof ReviewSetup>(key: K, value: ReviewSetup[K]) { setSetup(s => ({ ...s, [key]: value, confirmed: key === 'confirmed' ? value as boolean : false })) }
  function updateCheck(key: string, patch: Partial<ReviewCheck>) { setSetup(s => ({ ...s, confirmed: false, checks: s.checks.map(c => c.key === key ? { ...c, ...patch } : c) })) }
  function choose(selected: FileList | null) {
    if (!selected || disabled) return
    setError('')
    const added = Array.from(selected)
    const next = [...files.filter(f => !added.some(a => a.name === f.name)), ...added]
    if (next.some(f => !/\.(csv|xlsx|pdf|md|txt)$/i.test(f.name))) { setError('Choose CSV, XLSX, PDF, Markdown, or TXT files. For a JSON package, use Advanced upload below.'); return }
    if (next.filter(f => /\.(csv|xlsx)$/i.test(f.name)).length > 1) { setError('Choose one data file per review. Remove the current CSV/XLSX before choosing another.'); return }
    if (next.length > 12 || next.reduce((sum, file) => sum + file.size, 0) > intakeLimits.bytes - 8192) { setError('Choose at most 12 files and keep the total below 3 MB.'); return }
    setFiles(next)
  }
  async function prepare(withFiles: boolean) {
    if (disabled) return
    setReading(true); setError('')
    abort.current = new AbortController()
    try {
      let parsed = emptyPreview
      if (withFiles) {
        const form = new FormData(); files.forEach(file => form.append('files', file))
        parsed = await readApi<IntakePreview>('/api/intake', { method: 'POST', body: form, signal: AbortSignal.any([abort.current.signal, AbortSignal.timeout(55000)]) })
      }
      setPreview(parsed)
      const first = parsed.tables[0]
      setSetup(s => ({ ...s, tableId: first?.id ?? '', timeColumn: first?.columns.find(c => /\b(time|timestamp|tick|t)\b/i.test(c)) ?? '', confirmed: false, checks: s.checks.map(c => ({ ...c, column: '', evidenceIds: [] })) }))
      setStep('checks')
      window.setTimeout(() => formRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 0)
    } catch (e) { if (!abort.current.signal.aborted) setError(e instanceof Error ? e.message : 'Could not read these files.') }
    finally { setReading(false) }
  }
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (disabled) return
    setError(''); setReading(true)
    try {
      const previous = baseline ? await readApi<ReviewRecord>(`/api/reviews/${baseline}`) : null
      const mission = buildMissionPackage(setup, preview, previous)
      await onRun(mission)
    } catch (e) { setError(e instanceof Error ? e.message : 'Check the review details and try again.') }
    finally { setReading(false) }
  }
  return <div className="mission-intake">
    <ol className="intake-steps" aria-label="Upload progress"><li className={step === 'files' ? 'active' : ''}>1. Add files</li><li className={step === 'checks' ? 'active' : ''}>2. Confirm checks</li></ol>
    {step === 'files' ? <>
      <div className="drop-zone intake-drop" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); choose(e.dataTransfer.files) }}>
        <CloudUpload size={32} /><h2>Add your test files</h2><p>CSV or Excel measurements, with PDF reports and inspection records. Up to 3 MB total.</p>
        <label className="upload-label">Choose files<input disabled={disabled} className="sr-only" aria-label="Test data and supporting documents" type="file" multiple accept=".csv,.xlsx,.pdf,.md,.txt" onChange={e => { choose(e.target.files); e.target.value = '' }} /></label>
      </div>
      {!!files.length && <ul className="intake-files">{files.map(file => <li key={file.name}><span><FileText size={16} />{file.name}<small>{(file.size / 1024).toFixed(1)} KB</small></span><button type="button" className="text-button" aria-label={`Remove ${file.name}`} disabled={disabled} onClick={() => setFiles(files.filter(f => f.name !== file.name))}><Trash2 size={16} /></button></li>)}</ul>}
      <p className="help-text">Use one data file per review. PDFs need selectable text; scanned pages require OCR first.</p>
      <div className="intake-actions"><button className="primary-small" type="button" disabled={disabled || !files.length} onClick={() => prepare(true)}>{reading ? 'Reading files…' : 'Preview files'} <ArrowRight size={16} /></button><button className="text-button" type="button" disabled={disabled} onClick={() => prepare(false)}>Enter checks without files</button></div>
    </> : <form ref={formRef} onSubmit={submit}>
      <div className="intake-section-head"><h2>Set up your review</h2><button type="button" className="text-button" disabled={disabled} onClick={() => { setStep('files'); change('confirmed', false) }}>Change files</button></div>
      <fieldset disabled={disabled} className="intake-fieldset"><legend className="sr-only">Review details</legend><div className="intake-grid">
        <label>Test or mission name<input value={setup.name} required maxLength={120} placeholder="Flight test 02" onChange={e => change('name', e.target.value)} /></label>
        <label>Test start (your local time)<input type="datetime-local" required value={setup.startedAt} onChange={e => change('startedAt', e.target.value)} /></label>
        <label>Rocket configuration<input value={setup.configuration} required maxLength={48} placeholder="v1" onChange={e => change('configuration', e.target.value)} /></label>
        <label>Test condition<input value={setup.condition} required maxLength={120} placeholder="flight-test" onChange={e => change('condition', e.target.value)} /></label>
        <label>Data type<select aria-label="Data type" value={setup.dataKind} onChange={e => { const kind = e.target.value as ReviewSetup['dataKind']; setSetup(s => ({ ...s, dataKind: kind, simulated: kind === 'SIMULATION' ? true : s.simulated, confirmed: false })) }}><option value="MEASURED">Measured test data</option><option value="SIMULATION">Simulation output</option></select></label>
        <label>Compare with an earlier review<select aria-label="Compare with an earlier review" value={baseline} onChange={e => { setBaseline(e.target.value); change('confirmed', false) }}><option value="">No previous review</option>{history.filter(r => r.status === 'COMPLETE').map(r => <option value={r.id} key={r.id}>{r.name} · {new Date(r.createdAt).toLocaleDateString()}</option>)}</select></label>
      </div><label className="intake-checkbox"><input type="checkbox" checked={setup.simulated} disabled={setup.dataKind === 'SIMULATION'} onChange={e => change('simulated', e.target.checked)} />This is sample or simulated data</label></fieldset>
      {preview.tables.length > 0 && <section className="intake-section"><h3>Match the data columns</h3><fieldset disabled={disabled} className="intake-fieldset"><div className="intake-grid">
        <label>Data sheet<select aria-label="Data sheet" value={setup.tableId} onChange={e => { const t = preview.tables.find(t => t.id === e.target.value); setSetup(s => ({ ...s, tableId: e.target.value, timeColumn: t?.columns.find(c => /\b(time|timestamp|tick|t)\b/i.test(c)) ?? '', checks: s.checks.map(c => ({ ...c, column: '' })), confirmed: false })) }}>{preview.tables.map(t => <option value={t.id} key={t.id}>{t.filename} · {t.sheet}</option>)}</select></label>
        <label>Time column<select aria-label="Time column" value={setup.timeColumn} onChange={e => change('timeColumn', e.target.value)}><option value="">Choose a column</option>{table?.columns.map(c => <option value={c} key={c}>{c}</option>)}</select></label>
        <label>Time format<select aria-label="Time format" value={setup.timeFormat} onChange={e => change('timeFormat', e.target.value as ReviewSetup['timeFormat'])}><option value="SECONDS">Seconds from test start</option><option value="MILLISECONDS">Milliseconds from test start</option><option value="ISO">ISO date/time with timezone</option></select></label>
      </div></fieldset><p className="help-text">{table?.rows.length ?? 0} data rows. Match only the measurements you want to check. ISO times must include Z or a timezone offset.</p>
      {table && <div className="intake-table-scroll"><table className="intake-preview-table"><caption>First five rows of {table.sheet}</caption><thead><tr>{table.columns.map(c => <th key={c}>{c}</th>)}</tr></thead><tbody>{table.rows.slice(0, 5).map((row, i) => <tr key={i}>{row.map((cell, j) => <td key={j}>{cell || 'Empty'}</td>)}</tr>)}</tbody></table></div>}</section>}
      {!!preview.documents.length && <section className="intake-section"><h3>Supporting documents</h3><p className="help-text">Check the extracted text before linking it to a requirement.</p>{preview.documents.map(doc => <details className="intake-document" key={doc.id}><summary><FileText size={16} />{doc.filename}{doc.pages.length > 0 && <small>{doc.pages.length} pages</small>}</summary>{doc.pages.length ? doc.pages.map(page => <div key={page.number}><h4>Page {page.number}</h4><pre>{page.text || 'No selectable text on this page.'}</pre></div>) : <pre>{doc.content}</pre>}</details>)}</section>}
      {!!preview.warnings.length && <div className="fallback-notice" role="status"><b>Check these files</b><ul>{preview.warnings.map(w => <li key={w}>{w}</li>)}</ul></div>}
      <section className="intake-section"><div className="intake-section-head"><h3>What do you want to check?</h3><span>{setup.checks.length}/40</span></div><p className="help-text">Enter your team’s confirmed limits. Add inspection checks for items that need a completion record.</p>
        {setup.checks.map((check, index) => <fieldset disabled={disabled} className="intake-check" key={check.key}><legend>Check {index + 1}</legend><div className="intake-grid">
          <label>Check name<input required maxLength={200} value={check.title} placeholder="Battery voltage" onChange={e => updateCheck(check.key, { title: e.target.value })} /></label>
          <label>Check type<select aria-label="Check type" value={check.kind} onChange={e => updateCheck(check.key, { kind: e.target.value as ReviewCheck['kind'] })}><option value="MEASUREMENT">Measurement</option><option value="CHECKLIST">Inspection / checklist</option></select></label>
          <label>Subsystem<select aria-label="Subsystem" value={check.subsystem} onChange={e => updateCheck(check.key, { subsystem: e.target.value as ReviewCheck['subsystem'] })}>{['PROPULSION','AVIONICS','STRUCTURE','RECOVERY','ENVIRONMENT'].map(s => <option key={s} value={s}>{s.charAt(0) + s.slice(1).toLowerCase()}</option>)}</select></label>
          <label>Priority<select aria-label="Priority" value={check.priority} onChange={e => updateCheck(check.key, { priority: e.target.value as ReviewCheck['priority'] })}><option value="HIGH">High</option><option value="MEDIUM">Medium</option><option value="LOW">Low</option></select></label>
          {check.kind === 'MEASUREMENT' ? <>
            <label>Measurement source<select aria-label="Measurement source" value={check.column} onChange={e => { const col = e.target.value; updateCheck(check.key, { column: col, ...(col ? { unit: guessUnit(col), title: check.title || col } : {}) }) }}><option value="">Enter a reading / no reading available</option>{table?.columns.filter(c => c !== setup.timeColumn).map(c => <option value={c} key={c}>{c}</option>)}</select></label>
            {!check.column && <label>Reading (optional)<input value={check.manualValue} inputMode="decimal" placeholder="Leave empty if evidence is missing" onChange={e => updateCheck(check.key, { manualValue: e.target.value })} /></label>}
            <label>Unit<select aria-label="Unit" value={check.unit} onChange={e => updateCheck(check.key, { unit: e.target.value as ReviewCheck['unit'] })}>{measurementUnits.filter(u => u !== 'boolean').map(u => <option value={u} key={u}>{u || 'Unitless'}</option>)}</select></label>
            <label>Requirement<select aria-label="Requirement" value={check.operator} onChange={e => updateCheck(check.key, { operator: e.target.value as ReviewCheck['operator'] })}><option value="LTE">At most</option><option value="GTE">At least</option><option value="RANGE">Within a range</option></select></label>
            {check.operator !== 'LTE' && <label>Lower limit<input required value={check.lower} inputMode="decimal" onChange={e => updateCheck(check.key, { lower: e.target.value })} /></label>}
            {check.operator !== 'GTE' && <label>Upper limit<input required value={check.upper} inputMode="decimal" onChange={e => updateCheck(check.key, { upper: e.target.value })} /></label>}
            {!!check.column && <label>Evaluate<select aria-label="Evaluate" value={check.basis} onChange={e => updateCheck(check.key, { basis: e.target.value as ReviewCheck['basis'] })}><option value="ALL">Every imported sample</option><option value="LATEST">Latest sample only</option><option value="MAXIMUM">Maximum reading</option><option value="MINIMUM">Minimum reading</option></select></label>}
          </> : <label>Inspection state<select aria-label="Inspection state" value={check.state} onChange={e => updateCheck(check.key, { state: e.target.value as ReviewCheck['state'] })}><option value="INCOMPLETE">Not completed</option><option value="COMPLETE">Completed</option></select></label>}
        </div>
        {!!preview.documents.length && <div className="intake-evidence"><span>Required supporting documents</span>{preview.documents.map(doc => <label className="intake-checkbox" key={doc.id}><input type="checkbox" checked={check.evidenceIds.includes(doc.id)} onChange={e => updateCheck(check.key, { evidenceIds: e.target.checked ? [...check.evidenceIds, doc.id] : check.evidenceIds.filter(id => id !== doc.id) })} />{doc.filename}</label>)}</div>}
        <div className="intake-grid"><label>Required document not attached (optional)<input maxLength={200} value={check.missingEvidence} placeholder="e.g. Recovery inspection record" onChange={e => updateCheck(check.key, { missingEvidence: e.target.value })} /></label><label>Follow-up action<input maxLength={800} value={check.action} onChange={e => updateCheck(check.key, { action: e.target.value })} /></label></div>
        {setup.checks.length > 1 && <button className="text-button intake-remove" type="button" onClick={() => change('checks', setup.checks.filter(c => c.key !== check.key))}><Trash2 size={15} /> Remove check</button>}</fieldset>)}
        <button className="secondary-cta" type="button" disabled={disabled || setup.checks.length >= 40} onClick={() => change('checks', [...setup.checks, makeCheck(++sequence.current)])}><Plus size={16} /> Add check</button>
      </section>
      <div className="intake-confirm"><p><b>{setup.checks.length} checks</b> · {count} measurements · {preview.documents.length} supporting documents</p>{count > intakeLimits.rows && <p className="error-text">More than 2,000 measurements are mapped. Use fewer columns or a shorter exported time window.</p>}<label className="intake-checkbox"><input type="checkbox" checked={setup.confirmed} disabled={disabled} onChange={e => change('confirmed', e.target.checked)} />I have checked the data type, times, units, limits, and linked documents.</label><p className="help-text">A linked document is available evidence; its presence alone does not prove an inspection or requirement was satisfied.</p><button type="submit" className="run-button" disabled={disabled || !setup.confirmed || count > intakeLimits.rows}>{disabled ? 'Preparing review…' : 'Run review'} <Check size={16} /></button></div>
    </form>}
    {error && <p className="error-text validation-errors" role="alert">{error}</p>}
  </div>
}
