import { owner, failure, ok } from '@/lib/server/http'
import { rateLimit } from '@/lib/server/db'
import { previewFiles, readUploadForm } from '@/lib/server/file-intake'
import { HttpError } from '@/lib/server/http'
export const runtime = 'nodejs'
export const maxDuration = 60
export async function POST(request: Request) {
  try {
    const key = await owner()
    await rateLimit(key, 'intake', 20)
    await rateLimit('GLOBAL', 'intake', 100)
    const form = await readUploadForm(request)
    for (const field of form.keys()) if (field !== 'files') throw new HttpError(400, `Unknown upload field: ${field}`)
    const files = form.getAll('files')
    if (files.some(file => !(file instanceof File))) throw new HttpError(422, 'Upload files rather than text fields.')
    return ok(await previewFiles(files as File[]))
  } catch (error) { return failure(error) }
}
