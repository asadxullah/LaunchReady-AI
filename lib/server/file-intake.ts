import { parse } from 'csv-parse/sync'
import { intakeLimits, type IntakeTable, type IntakeDocument, type IntakePreview } from '../intake'
import { HttpError, sameOrigin } from './http'

export async function readUploadForm(request: Request) {
  sameOrigin(request)
  const type = request.headers.get('content-type') ?? ''
  if (!type.includes('multipart/form-data')) throw new HttpError(415, 'Choose files to upload.')
  const reader = request.body?.getReader()
  if (!reader) throw new HttpError(400, 'Empty upload.')
  let bytes = 0
  const chunks: Uint8Array[] = []
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    bytes += value.length
    if (bytes > intakeLimits.bytes) { await reader.cancel(); throw new HttpError(413, 'Combined upload exceeds 3 MB. Use a shorter log or smaller documents.') }
    chunks.push(value)
  }
  try { return await new Response(Buffer.concat(chunks), { headers: { 'Content-Type': type } }).formData() }
  catch { throw new HttpError(400, 'The file upload could not be read. Choose the files again.') }
}

function tableFromRows(rows: string[][], filename: string, sheet: string, id: string): IntakeTable {
  if (rows.length < 2) throw new HttpError(422, `${filename}: include a header row and at least one data row.`)
  const columns = rows[0].map(c => c.trim())
  if (columns.length > intakeLimits.columns) throw new HttpError(422, `${filename}: select an export with at most 64 columns.`)
  if (columns.some(c => !c) || new Set(columns).size !== columns.length) throw new HttpError(422, `${filename}: each column needs a unique, non-empty header.`)
  if (columns.some(c => c.length > 120)) throw new HttpError(422, `${filename}: column names must be at most 120 characters.`)
  const data = rows.slice(1).filter(row => row.some(c => c.trim()))
  if (data.length > intakeLimits.rows) throw new HttpError(422, `${filename}: at most 2,000 data rows are supported. Export a shorter time window; rows are never silently discarded.`)
  if (!data.length || data.some(row => row.length !== columns.length)) throw new HttpError(422, `${filename}: every data row must match the header columns.`)
  if (data.some(row => row.some(c => c.length > 256))) throw new HttpError(422, `${filename}: use a measurement sheet with short values, not long document text.`)
  return { id, filename, sheet, columns, rows: data }
}

export function parseCsv(text: string, filename: string, id = 'TABLE-1'): IntakeTable {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/)
  const firstData = lines.findIndex(line => line.trim() && !line.trimStart().startsWith('#'))
  if (firstData < 0) throw new HttpError(422, `${filename}: no data rows were found.`)
  const comments = lines.slice(0, firstData).filter(line => line.trimStart().startsWith('#'))
  // OpenRocket / AltosUI can prefix their actual header with '#'. Keep that
  // header while excluding configuration comments and flight-event footers.
  const commentedHeader = comments.filter(line => /\b(time|timestamp|tick)\b/i.test(line) && /[,;\t]/.test(line)).at(-1)
  const body = lines.filter(line => !line.trimStart().startsWith('#')).join('\n')
  const first = lines[firstData]
  const beginsWithNumericData = /^[\s+-]*(?:\d|\.\d)/.test(first)
  const content = commentedHeader && beginsWithNumericData ? `${commentedHeader.replace(/^\s*#\s*/, '')}\n${body}` : body
  let parsed: string[][] | undefined
  for (const delimiter of [',', ';', '\t']) {
    try {
      const candidate = parse(content, { delimiter, bom: true, skip_empty_lines: true, trim: true, max_record_size: 20000 }) as string[][]
      if (!parsed || candidate[0]?.length > (parsed[0]?.length ?? 0)) parsed = candidate
    } catch { /* Try the next common spreadsheet separator. */ }
  }
  if (!parsed || (parsed[0]?.length ?? 0) < 2) throw new HttpError(422, `${filename}: use a comma, semicolon, or tab-separated table with a header row.`)
  return tableFromRows(parsed, filename, 'CSV', id)
}

// Reject oversized ZIP expansion before ExcelJS allocates worksheet objects.
function checkWorkbookArchive(bytes: Buffer) {
  if (bytes.length < 22 || bytes.readUInt32LE(0) !== 0x04034b50) throw new HttpError(422, 'This is not an Excel XLSX workbook. Save old XLS files as XLSX or CSV.')
  let end = -1
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) if (bytes.readUInt32LE(i) === 0x06054b50) { end = i; break }
  if (end < 0) throw new HttpError(422, 'The Excel workbook is incomplete or unsupported.')
  const count = bytes.readUInt16LE(end + 10), offset = bytes.readUInt32LE(end + 16)
  if (count > 500 || count === 0xffff) throw new HttpError(422, 'The Excel workbook is too complex. Export a measurement sheet as CSV.')
  let cursor = offset, expanded = 0
  for (let i = 0; i < count; i++) {
    if (cursor + 46 > end || bytes.readUInt32LE(cursor) !== 0x02014b50) throw new HttpError(422, 'The Excel workbook archive is invalid.')
    expanded += bytes.readUInt32LE(cursor + 24)
    if (expanded > 20 * 1024 * 1024) throw new HttpError(422, 'The expanded Excel workbook exceeds 20 MB. Export a shorter CSV.')
    if (bytes.readUInt16LE(cursor + 8) & 1) throw new HttpError(422, 'Password-protected workbooks are not supported.')
    cursor += 46 + bytes.readUInt16LE(cursor + 28) + bytes.readUInt16LE(cursor + 30) + bytes.readUInt16LE(cursor + 32)
  }
}

export async function parseWorkbook(bytes: Buffer, filename: string): Promise<{ tables: IntakeTable[]; warnings: string[] }> {
  checkWorkbookArchive(bytes)
  const ExcelJS = (await import('exceljs')).default
  const workbook = new ExcelJS.Workbook()
  try { await workbook.xlsx.load(new Uint8Array(bytes).buffer, { ignoreNodes: ['drawing', 'extLst', 'conditionalFormatting', 'dataValidations'] }) }
  catch { throw new HttpError(422, `${filename}: the XLSX file could not be read. Try exporting its measurements as CSV.`) }
  const sheets = workbook.worksheets.filter(w => w.actualRowCount)
  if (!sheets.length || sheets.length > 8) throw new HttpError(422, 'Choose a workbook with one to eight non-empty sheets.')
  const warnings: string[] = [], tables: IntakeTable[] = []
  for (const [index, worksheet] of sheets.entries()) {
    if (worksheet.rowCount > intakeLimits.rows + 1 || worksheet.columnCount > intakeLimits.columns) throw new HttpError(422, `${worksheet.name}: keep the sheet to 2,000 data rows and 64 columns, with the header in the first row.`)
    let formulas = false
    const rows: string[][] = []
    worksheet.eachRow({ includeEmpty: true }, row => {
      const cells = Array.from({ length: worksheet.columnCount }, (_, i) => {
        const value = row.getCell(i + 1).value
        if (value === null || value === undefined) return ''
        if (value instanceof Date) return value.toISOString()
        if (typeof value === 'object' && ('formula' in value || 'sharedFormula' in value)) { formulas = true; return '' }
        if (typeof value === 'object' && 'richText' in value) return value.richText.map(t => t.text).join('')
        if (typeof value === 'object' && 'text' in value) return String(value.text)
        if (typeof value === 'object') return ''
        return String(value)
      })
      rows.push(cells)
    })
    if (formulas) warnings.push(`${worksheet.name}: formula cells were left empty. Paste their verified values into the workbook before mapping those columns.`)
    tables.push(tableFromRows(rows, filename, worksheet.name, `TABLE-${index + 1}`))
  }
  return { tables, warnings }
}

export async function parsePdf(bytes: Buffer, filename: string, id: string, timeoutMs = 12000): Promise<{ document: IntakeDocument; warnings: string[] }> {
  if (!bytes.subarray(0, 1024).includes(Buffer.from('%PDF-'))) throw new HttpError(422, `${filename}: this file is not a valid PDF.`)
  const { getPath } = await import('pdf-parse/worker')
  const { PDFParse } = await import('pdf-parse')
  PDFParse.setWorker(getPath())
  const parser = new PDFParse({ data: new Uint8Array(bytes), isEvalSupported: false, stopAtErrors: true })
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const work = async () => {
      const info = await parser.getInfo()
      if (info.total > intakeLimits.pdfPages) throw new HttpError(422, `${filename}: upload at most 40 PDF pages, or split the report into smaller documents.`)
      const text = await parser.getText({ pageJoiner: '', lineEnforce: true })
      const pages = text.pages.map(page => ({ number: page.num, text: page.text.trim() }))
      if (!pages.some(page => /[\p{L}\p{N}]/u.test(page.text))) throw new HttpError(422, `${filename}: no selectable text was found. Run OCR on this scanned PDF, then upload the searchable PDF.`)
      const warnings = pages.filter(page => !page.text).map(page => `${filename}, page ${page.number}: no selectable text. Verify whether OCR is needed.`)
      const content = pages.map(page => `## Page ${page.number}\n${page.text.replace(/^#/gm, '\\#') || '[No selectable text on this page; evidence could not be extracted.]'}`).join('\n\n')
      if (content.length > intakeLimits.documentCharacters) throw new HttpError(422, `${filename}: extracted text exceeds 100,000 characters. Upload the relevant sections.`)
      return { document: { id, filename, title: filename, content, pages }, warnings }
    }
    return await Promise.race([work(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new HttpError(422, `${filename}: PDF extraction took too long. Upload a smaller searchable PDF.`)), timeoutMs) })])
  } catch (error) {
    if (error instanceof HttpError) throw error
    throw new HttpError(422, `${filename}: PDF extraction failed. Use a readable, unencrypted PDF with selectable text.`)
  } finally { if (timer) clearTimeout(timer); await parser.destroy().catch(() => {}) }
}

export async function previewFiles(files: File[]): Promise<IntakePreview> {
  if (!files.length) throw new HttpError(422, 'Choose a CSV/XLSX data file or supporting documents.')
  if (files.length > 12 || files.reduce((sum, f) => sum + f.size, 0) > intakeLimits.bytes) throw new HttpError(413, 'Choose at most 12 files and keep the combined size below 3 MB.')
  if (files.some(f => !/\.(csv|xlsx|pdf|md|txt)$/i.test(f.name))) throw new HttpError(422, 'Use CSV, Excel XLSX, PDF, Markdown, or TXT. Save old XLS files as XLSX.')
  if (files.filter(f => /\.(csv|xlsx)$/i.test(f.name)).length > 1) throw new HttpError(422, 'Choose one measurement file per review. A workbook can contain multiple sheets.')
  if (new Set(files.map(f => f.name)).size !== files.length) throw new HttpError(422, 'Use a different filename for each uploaded file.')
  const result: IntakePreview = { tables: [], documents: [], warnings: [] }
  let textSize = 0
  const deadline = Date.now() + 45000
  for (const file of files) {
    if (Date.now() >= deadline) throw new HttpError(422, 'File extraction took too long. Upload fewer or smaller documents.')
    if (/\.csv$/i.test(file.name)) result.tables.push(parseCsv(await file.text(), file.name))
    else if (/\.xlsx$/i.test(file.name)) {
      const workbook = await parseWorkbook(Buffer.from(await file.arrayBuffer()), file.name)
      result.tables.push(...workbook.tables); result.warnings.push(...workbook.warnings)
    } else {
      const id = `DOC-UPLOAD-${result.documents.length + 1}`
      if (/\.pdf$/i.test(file.name)) {
        const pdf = await parsePdf(Buffer.from(await file.arrayBuffer()), file.name, id, Math.min(12000, Math.max(1, deadline - Date.now())))
        result.documents.push(pdf.document); result.warnings.push(...pdf.warnings)
      } else {
        const content = await file.text()
        if (!content.trim() || content.length > intakeLimits.documentCharacters) throw new HttpError(422, `${file.name}: use a non-empty document with at most 100,000 characters.`)
        result.documents.push({ id, filename: file.name, title: file.name, content, pages: [] })
      }
    }
    if (/\.(pdf|md|txt)$/i.test(file.name)) textSize += result.documents.at(-1)!.content.length
    if (textSize > intakeLimits.totalCharacters) throw new HttpError(422, 'Combined extracted documents exceed 300,000 characters. Upload the relevant sections.')
  }
  if (result.documents.length > intakeLimits.documents) throw new HttpError(422, 'At most 11 supporting documents are allowed per review.')
  return result
}
