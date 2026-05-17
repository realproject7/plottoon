import type { ExportMeta } from './exportMetadata'

const MAX_BATCH_SIZE = 20
const MAX_FILE_SIZE = 1_048_576 // 1 MB
const ACCEPTED_MIME_TYPES = new Set(['image/webp', 'image/jpeg'])

export interface UploadResultItem {
  index: number
  url?: string
  cid?: string
  mimeType?: string
  sizeBytes?: number
  error?: string
}

export interface UploadResponse {
  results: UploadResultItem[]
}

export interface CutUploadInput {
  cutId: string
  meta: ExportMeta
  fileBytes: Uint8Array
}

export interface CutUploadResult {
  cutId: string
  success: boolean
  url?: string
  cid?: string
  mimeType?: string
  sizeBytes?: number
  error?: string
}

export interface BatchUploadResult {
  batch: number
  results: CutUploadResult[]
}

export type SignatureProvider = (message: string) => Promise<string>

export type FetchFn = (url: string, init: RequestInit) => Promise<Response>

export interface UploadServiceConfig {
  endpoint: string
  signMessage: SignatureProvider
  fetch?: FetchFn
}

export interface ValidationError {
  cutId: string
  reason: string
}

const WEBP_MAGIC = [0x52, 0x49, 0x46, 0x46] // RIFF
const JPEG_MAGIC = [0xff, 0xd8, 0xff]

function matchesMagicBytes(bytes: Uint8Array, mimeType: string): boolean {
  if (mimeType === 'image/webp') {
    return (
      bytes.length >= 4 &&
      bytes[0] === WEBP_MAGIC[0] &&
      bytes[1] === WEBP_MAGIC[1] &&
      bytes[2] === WEBP_MAGIC[2] &&
      bytes[3] === WEBP_MAGIC[3]
    )
  }
  if (mimeType === 'image/jpeg') {
    return (
      bytes.length >= 3 &&
      bytes[0] === JPEG_MAGIC[0] &&
      bytes[1] === JPEG_MAGIC[1] &&
      bytes[2] === JPEG_MAGIC[2]
    )
  }
  return false
}

export function validateCutForUpload(input: CutUploadInput): ValidationError | null {
  if (!ACCEPTED_MIME_TYPES.has(input.meta.mimeType)) {
    return { cutId: input.cutId, reason: `Unsupported MIME type: ${input.meta.mimeType}` }
  }
  if (input.fileBytes.length > MAX_FILE_SIZE) {
    return {
      cutId: input.cutId,
      reason: `File exceeds 1MB (${Math.round(input.fileBytes.length / 1024)}KB)`
    }
  }
  if (!matchesMagicBytes(input.fileBytes, input.meta.mimeType)) {
    return {
      cutId: input.cutId,
      reason: `Magic bytes do not match declared MIME type ${input.meta.mimeType}`
    }
  }
  return null
}

export function validateAll(inputs: CutUploadInput[]): ValidationError[] {
  const errors: ValidationError[] = []
  for (const input of inputs) {
    const err = validateCutForUpload(input)
    if (err) errors.push(err)
  }
  return errors
}

export function batchInputs(inputs: CutUploadInput[]): CutUploadInput[][] {
  const batches: CutUploadInput[][] = []
  for (let i = 0; i < inputs.length; i += MAX_BATCH_SIZE) {
    batches.push(inputs.slice(i, i + MAX_BATCH_SIZE))
  }
  return batches
}

function buildSignatureMessage(): { message: string; timestamp: string } {
  const timestamp = new Date().toISOString()
  const message = `PlotLink: Upload plot images\nTimestamp: ${timestamp}`
  return { message, timestamp }
}

async function uploadBatch(
  batch: CutUploadInput[],
  batchIndex: number,
  config: UploadServiceConfig
): Promise<BatchUploadResult> {
  const { message } = buildSignatureMessage()
  const signature = await config.signMessage(message)

  const formData = new FormData()
  for (const input of batch) {
    const blob = new Blob([input.fileBytes], { type: input.meta.mimeType })
    formData.append('files', blob, `${input.cutId}.${input.meta.mimeType === 'image/webp' ? 'webp' : 'jpg'}`)
  }

  const fetchFn = config.fetch ?? globalThis.fetch
  const response = await fetchFn(config.endpoint, {
    method: 'POST',
    headers: {
      'X-Signature': signature,
      'X-Signature-Message': message
    },
    body: formData
  })

  if (response.status === 401) {
    return {
      batch: batchIndex,
      results: batch.map((input) => ({
        cutId: input.cutId,
        success: false,
        error: 'Signature invalid or expired'
      }))
    }
  }

  if (response.status === 429) {
    return {
      batch: batchIndex,
      results: batch.map((input) => ({
        cutId: input.cutId,
        success: false,
        error: 'Rate limited — retry after delay'
      }))
    }
  }

  if (!response.ok) {
    return {
      batch: batchIndex,
      results: batch.map((input) => ({
        cutId: input.cutId,
        success: false,
        error: `HTTP ${response.status}`
      }))
    }
  }

  const body = (await response.json()) as UploadResponse

  const results: CutUploadResult[] = batch.map((input, i) => {
    const item = body.results.find((r) => r.index === i)
    if (!item) {
      return { cutId: input.cutId, success: false, error: 'No response for this index' }
    }
    if (item.error) {
      return { cutId: input.cutId, success: false, error: item.error }
    }
    return {
      cutId: input.cutId,
      success: true,
      url: item.url,
      cid: item.cid,
      mimeType: item.mimeType,
      sizeBytes: item.sizeBytes
    }
  })

  return { batch: batchIndex, results }
}

export async function uploadCutImages(
  inputs: CutUploadInput[],
  config: UploadServiceConfig
): Promise<{ results: CutUploadResult[]; validationErrors: ValidationError[] }> {
  const validationErrors = validateAll(inputs)
  if (validationErrors.length > 0) {
    const failedIds = new Set(validationErrors.map((e) => e.cutId))
    const valid = inputs.filter((i) => !failedIds.has(i.cutId))
    if (valid.length === 0) {
      return { results: [], validationErrors }
    }
    inputs = valid
  }

  const batches = batchInputs(inputs)
  const allResults: CutUploadResult[] = []

  for (let i = 0; i < batches.length; i++) {
    const batchResult = await uploadBatch(batches[i], i, config)
    allResults.push(...batchResult.results)
  }

  return { results: allResults, validationErrors }
}
