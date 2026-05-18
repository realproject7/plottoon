import fs from 'node:fs/promises'
import path from 'node:path'

export type PlotState =
  | 'draft'
  | 'ready'
  | 'publishing'
  | 'published'
  | 'published-not-indexed'
  | 'failed'
export type CutState = 'pending' | 'uploaded' | 'failed'

export interface CutPublishEntry {
  cutId: string
  state: CutState
  cid: string | null
  url: string | null
  fileHash: string | null
  mimeType: string | null
  sizeBytes: number | null
  error: string | null
  protected: boolean
  updatedAt: string
}

export interface PublishResultRecord {
  txHash: string | null
  storylineId: string | null
  plotIndex: number | null
  contentCid: string | null
  contentHash: string | null
  authorAddress: string | null
  gasCostWei: string | null
  plotlinkUrl: string | null
  walletAddress: string | null
  walletSource: string | null
  indexed: boolean
  indexError: string | null
}

export interface PublishStatusFile {
  version: number
  plotState: PlotState
  error: string | null
  publishedAt: string | null
  updatedAt: string
  cuts: CutPublishEntry[]
  publishResult: PublishResultRecord | null
}

export class PublishStatusError extends Error {
  constructor(
    message: string,
    public readonly filePath: string
  ) {
    super(message)
    this.name = 'PublishStatusError'
  }
}

const CURRENT_VERSION = 1
const FILENAME = '.publish-status.json'

function fail(msg: string, filePath: string): never {
  throw new PublishStatusError(msg, filePath)
}

function nowIso(): string {
  return new Date().toISOString()
}

const VALID_PLOT_STATES: PlotState[] = [
  'draft',
  'ready',
  'publishing',
  'published',
  'published-not-indexed',
  'failed'
]
const VALID_CUT_STATES: CutState[] = ['pending', 'uploaded', 'failed']

function validateCutEntry(data: unknown, index: number, filePath: string): CutPublishEntry {
  if (typeof data !== 'object' || data === null) {
    fail(`cuts[${index}] must be an object`, filePath)
  }
  const c = data as Record<string, unknown>

  if (typeof c.cutId !== 'string' || c.cutId.length === 0) {
    fail(`cuts[${index}]: "cutId" must be a non-empty string`, filePath)
  }
  if (typeof c.state !== 'string' || !VALID_CUT_STATES.includes(c.state as CutState)) {
    fail(`cut "${c.cutId}": state must be one of ${VALID_CUT_STATES.join(', ')}`, filePath)
  }
  if (c.cid !== null && typeof c.cid !== 'string') {
    fail(`cut "${c.cutId}": cid must be a string or null`, filePath)
  }
  if (c.url !== null && typeof c.url !== 'string') {
    fail(`cut "${c.cutId}": url must be a string or null`, filePath)
  }
  if (c.fileHash !== null && typeof c.fileHash !== 'string') {
    fail(`cut "${c.cutId}": fileHash must be a string or null`, filePath)
  }
  if (c.mimeType !== null && c.mimeType !== undefined && typeof c.mimeType !== 'string') {
    fail(`cut "${c.cutId}": mimeType must be a string or null`, filePath)
  }
  if (
    c.sizeBytes !== null &&
    c.sizeBytes !== undefined &&
    (typeof c.sizeBytes !== 'number' || c.sizeBytes < 0)
  ) {
    fail(`cut "${c.cutId}": sizeBytes must be a non-negative number or null`, filePath)
  }
  if (c.error !== null && typeof c.error !== 'string') {
    fail(`cut "${c.cutId}": error must be a string or null`, filePath)
  }
  if (typeof c.protected !== 'boolean') {
    fail(`cut "${c.cutId}": protected must be a boolean`, filePath)
  }
  if (typeof c.updatedAt !== 'string') {
    fail(`cut "${c.cutId}": updatedAt must be a string`, filePath)
  }

  return {
    cutId: c.cutId as string,
    state: c.state as CutState,
    cid: (c.cid as string) ?? null,
    url: (c.url as string) ?? null,
    fileHash: (c.fileHash as string) ?? null,
    mimeType: (c.mimeType as string) ?? null,
    sizeBytes: (c.sizeBytes as number) ?? null,
    error: (c.error as string) ?? null,
    protected: c.protected as boolean,
    updatedAt: c.updatedAt as string
  }
}

export function validatePublishStatus(data: unknown, filePath: string): PublishStatusFile {
  if (typeof data !== 'object' || data === null) {
    fail('publish status must be a JSON object', filePath)
  }
  const obj = data as Record<string, unknown>

  if (typeof obj.version !== 'number' || !Number.isInteger(obj.version) || obj.version < 1) {
    fail('"version" must be a positive integer', filePath)
  }
  if (
    typeof obj.plotState !== 'string' ||
    !VALID_PLOT_STATES.includes(obj.plotState as PlotState)
  ) {
    fail(`"plotState" must be one of ${VALID_PLOT_STATES.join(', ')}`, filePath)
  }
  if (obj.error !== null && typeof obj.error !== 'string') {
    fail('"error" must be a string or null', filePath)
  }
  if (obj.publishedAt !== null && typeof obj.publishedAt !== 'string') {
    fail('"publishedAt" must be a string or null', filePath)
  }
  if (typeof obj.updatedAt !== 'string') {
    fail('"updatedAt" must be a string', filePath)
  }
  if (!Array.isArray(obj.cuts)) {
    fail('"cuts" must be an array', filePath)
  }

  const cuts = (obj.cuts as unknown[]).map((c, i) => validateCutEntry(c, i, filePath))

  const ids = new Set<string>()
  for (const cut of cuts) {
    if (ids.has(cut.cutId)) {
      fail(`duplicate cutId "${cut.cutId}"`, filePath)
    }
    ids.add(cut.cutId)
  }

  let publishResult: PublishResultRecord | null = null
  if (obj.publishResult !== null && obj.publishResult !== undefined) {
    if (typeof obj.publishResult !== 'object') {
      fail('"publishResult" must be an object or null', filePath)
    }
    const pr = obj.publishResult as Record<string, unknown>
    publishResult = {
      txHash: (pr.txHash as string) ?? null,
      storylineId: (pr.storylineId as string) ?? null,
      plotIndex: typeof pr.plotIndex === 'number' ? pr.plotIndex : null,
      contentCid: (pr.contentCid as string) ?? null,
      contentHash: (pr.contentHash as string) ?? null,
      authorAddress: (pr.authorAddress as string) ?? null,
      gasCostWei: (pr.gasCostWei as string) ?? null,
      plotlinkUrl: (pr.plotlinkUrl as string) ?? null,
      walletAddress: (pr.walletAddress as string) ?? null,
      walletSource: (pr.walletSource as string) ?? null,
      indexed: typeof pr.indexed === 'boolean' ? pr.indexed : false,
      indexError: (pr.indexError as string) ?? null
    }
  }

  return {
    version: obj.version as number,
    plotState: obj.plotState as PlotState,
    error: (obj.error as string) ?? null,
    publishedAt: (obj.publishedAt as string) ?? null,
    updatedAt: obj.updatedAt as string,
    cuts,
    publishResult
  }
}

export function resolvePublishStatusPath(plotDir: string): string {
  return path.join(plotDir, FILENAME)
}

export async function readPublishStatus(plotDir: string): Promise<PublishStatusFile> {
  const filePath = resolvePublishStatusPath(plotDir)
  let raw: string
  try {
    raw = await fs.readFile(filePath, 'utf-8')
  } catch {
    throw new PublishStatusError(`${FILENAME} not found`, filePath)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new PublishStatusError(`${FILENAME} contains invalid JSON`, filePath)
  }

  return validatePublishStatus(parsed, filePath)
}

export async function writePublishStatus(
  plotDir: string,
  status: PublishStatusFile
): Promise<void> {
  const filePath = resolvePublishStatusPath(plotDir)
  validatePublishStatus(status, filePath)
  await fs.writeFile(filePath, JSON.stringify(status, null, 2) + '\n', 'utf-8')
}

export function createPublishStatus(cutIds: string[]): PublishStatusFile {
  const now = nowIso()
  return {
    version: CURRENT_VERSION,
    plotState: 'draft',
    error: null,
    publishedAt: null,
    updatedAt: now,
    publishResult: null,
    cuts: cutIds.map((cutId) => ({
      cutId,
      state: 'pending' as CutState,
      cid: null,
      url: null,
      fileHash: null,
      mimeType: null,
      sizeBytes: null,
      error: null,
      protected: false,
      updatedAt: now
    }))
  }
}

export function markCutUploaded(
  status: PublishStatusFile,
  cutId: string,
  cid: string,
  url: string,
  fileHash: string,
  mimeType: string,
  sizeBytes: number
): PublishStatusFile {
  const entry = status.cuts.find((c) => c.cutId === cutId)
  if (
    entry &&
    entry.state === 'uploaded' &&
    entry.cid === cid &&
    entry.url === url &&
    entry.fileHash === fileHash &&
    entry.mimeType === mimeType &&
    entry.sizeBytes === sizeBytes &&
    entry.error === null
  ) {
    return status
  }
  const now = nowIso()
  const cuts = status.cuts.map((c) =>
    c.cutId === cutId
      ? {
          ...c,
          state: 'uploaded' as CutState,
          cid,
          url,
          fileHash,
          mimeType,
          sizeBytes,
          error: null,
          updatedAt: now
        }
      : c
  )
  return { ...status, cuts, updatedAt: now }
}

export function markCutFailed(
  status: PublishStatusFile,
  cutId: string,
  error: string
): PublishStatusFile {
  const entry = status.cuts.find((c) => c.cutId === cutId)
  if (entry && entry.state === 'failed' && entry.error === error) {
    return status
  }
  const now = nowIso()
  const cuts = status.cuts.map((c) =>
    c.cutId === cutId ? { ...c, state: 'failed' as CutState, error, updatedAt: now } : c
  )
  return { ...status, cuts, updatedAt: now }
}

export function markPlotPublished(
  status: PublishStatusFile,
  result?: PublishResultRecord
): PublishStatusFile {
  if (status.plotState === 'published' && status.error === null && !result) {
    return status
  }
  const now = nowIso()
  return {
    ...status,
    plotState: 'published',
    publishedAt: now,
    error: null,
    publishResult: result ?? status.publishResult,
    updatedAt: now
  }
}

export function markPublishedNotIndexed(
  status: PublishStatusFile,
  result: PublishResultRecord
): PublishStatusFile {
  const now = nowIso()
  return {
    ...status,
    plotState: 'published-not-indexed',
    publishedAt: now,
    publishResult: result,
    error: result.indexError ?? 'Indexing failed',
    updatedAt: now
  }
}

export function markPlotFailed(status: PublishStatusFile, error: string): PublishStatusFile {
  if (status.plotState === 'failed' && status.error === error) {
    return status
  }
  const now = nowIso()
  return { ...status, plotState: 'failed', error, updatedAt: now }
}

export function setPlotState(status: PublishStatusFile, state: PlotState): PublishStatusFile {
  if (status.plotState === state) {
    return status
  }
  const now = nowIso()
  return { ...status, plotState: state, updatedAt: now }
}

export function protectCut(status: PublishStatusFile, cutId: string): PublishStatusFile {
  const entry = status.cuts.find((c) => c.cutId === cutId)
  if (entry && entry.protected) {
    return status
  }
  const now = nowIso()
  const cuts = status.cuts.map((c) =>
    c.cutId === cutId ? { ...c, protected: true, updatedAt: now } : c
  )
  return { ...status, cuts, updatedAt: now }
}

export function isProtected(status: PublishStatusFile, cutId: string): boolean {
  const entry = status.cuts.find((c) => c.cutId === cutId)
  return entry?.protected ?? false
}
