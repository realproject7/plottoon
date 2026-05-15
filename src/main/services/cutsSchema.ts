import fs from 'node:fs/promises'
import path from 'node:path'
import cutsJsonSchema from '../schemas/cuts.schema.json'

export { cutsJsonSchema as CUTS_JSON_SCHEMA }

export class CutsValidationError extends Error {
  constructor(
    message: string,
    public readonly filePath: string
  ) {
    super(message)
    this.name = 'CutsValidationError'
  }
}

export interface TailAnchor {
  x: number
  y: number
}

export interface Overlay {
  id: string
  type: 'text' | 'sfx'
  content: string
  x: number
  y: number
  width: number
  height: number
  style?: Record<string, string>
  tailAnchor?: TailAnchor
}

export interface ImageRevision {
  version: number
  path: string
  createdAt: string
  revisionNotes?: string
}

export interface ImageState {
  status: 'pending' | 'generating' | 'done' | 'failed'
  path: string | null
  prompt: string | null
  seed: number | null
  errorMessage?: string
  generationBackend?: string
  model?: string
  attempts?: number
  revisionNotes?: string
  revisions?: ImageRevision[]
}

export interface CanvasOverrides {
  width?: number
  height?: number
  backgroundColor?: string
}

export interface Cut {
  id: string
  order: number
  dialogue: string
  direction: string
  narration?: string
  continuityNotes?: string
  imageState: ImageState
  overlays: Overlay[]
  canvasOverrides?: CanvasOverrides
}

export interface PlotPublishState {
  published: boolean
  exportedAt: string | null
  format: string | null
}

export interface CutsFile {
  version: number
  plotTitle: string
  synopsis: string
  cuts: Cut[]
  publishState: PlotPublishState
}

const CURRENT_VERSION = 1

function fail(msg: string, filePath: string): never {
  throw new CutsValidationError(msg, filePath)
}

function validateOverlay(data: unknown, index: number, cutId: string, filePath: string): Overlay {
  if (typeof data !== 'object' || data === null) {
    fail(`cut "${cutId}" overlay[${index}] must be an object`, filePath)
  }
  const o = data as Record<string, unknown>

  if (typeof o.id !== 'string' || o.id.length === 0) {
    fail(`cut "${cutId}" overlay[${index}]: "id" must be a non-empty string`, filePath)
  }
  if (o.type !== 'text' && o.type !== 'sfx') {
    fail(`cut "${cutId}" overlay[${index}]: "type" must be "text" or "sfx"`, filePath)
  }
  if (typeof o.content !== 'string') {
    fail(`cut "${cutId}" overlay[${index}]: "content" must be a string`, filePath)
  }
  for (const coord of ['x', 'y', 'width', 'height'] as const) {
    if (typeof o[coord] !== 'number' || !Number.isFinite(o[coord] as number)) {
      fail(`cut "${cutId}" overlay[${index}]: "${coord}" must be a finite number`, filePath)
    }
  }
  if (o.style !== undefined) {
    if (typeof o.style !== 'object' || o.style === null || Array.isArray(o.style)) {
      fail(`cut "${cutId}" overlay[${index}]: "style" must be an object if present`, filePath)
    }
    for (const [k, v] of Object.entries(o.style as Record<string, unknown>)) {
      if (typeof v !== 'string') {
        fail(`cut "${cutId}" overlay[${index}]: style["${k}"] must be a string`, filePath)
      }
    }
  }

  let tailAnchor: TailAnchor | undefined
  if (o.tailAnchor !== undefined) {
    if (typeof o.tailAnchor !== 'object' || o.tailAnchor === null || Array.isArray(o.tailAnchor)) {
      fail(`cut "${cutId}" overlay[${index}]: "tailAnchor" must be an object if present`, filePath)
    }
    const ta = o.tailAnchor as Record<string, unknown>
    if (typeof ta.x !== 'number' || !Number.isFinite(ta.x)) {
      fail(`cut "${cutId}" overlay[${index}]: tailAnchor.x must be a finite number`, filePath)
    }
    if (typeof ta.y !== 'number' || !Number.isFinite(ta.y)) {
      fail(`cut "${cutId}" overlay[${index}]: tailAnchor.y must be a finite number`, filePath)
    }
    tailAnchor = { x: ta.x as number, y: ta.y as number }
  }

  return {
    id: o.id as string,
    type: o.type as 'text' | 'sfx',
    content: o.content as string,
    x: o.x as number,
    y: o.y as number,
    width: o.width as number,
    height: o.height as number,
    style: o.style as Record<string, string> | undefined,
    tailAnchor
  }
}

function validateImageState(data: unknown, cutId: string, filePath: string): ImageState {
  if (typeof data !== 'object' || data === null) {
    fail(`cut "${cutId}": "imageState" must be an object`, filePath)
  }
  const s = data as Record<string, unknown>

  const validStatuses = ['pending', 'generating', 'done', 'failed']
  if (typeof s.status !== 'string' || !validStatuses.includes(s.status)) {
    fail(`cut "${cutId}": imageState.status must be one of ${validStatuses.join(', ')}`, filePath)
  }
  if (s.path !== null && typeof s.path !== 'string') {
    fail(`cut "${cutId}": imageState.path must be a string or null`, filePath)
  }
  if (s.prompt !== null && typeof s.prompt !== 'string') {
    fail(`cut "${cutId}": imageState.prompt must be a string or null`, filePath)
  }
  if (s.seed !== null && (typeof s.seed !== 'number' || !Number.isFinite(s.seed as number))) {
    fail(`cut "${cutId}": imageState.seed must be a finite number or null`, filePath)
  }
  if (s.errorMessage !== undefined && typeof s.errorMessage !== 'string') {
    fail(`cut "${cutId}": imageState.errorMessage must be a string if present`, filePath)
  }
  if (s.generationBackend !== undefined && typeof s.generationBackend !== 'string') {
    fail(`cut "${cutId}": imageState.generationBackend must be a string if present`, filePath)
  }
  if (s.model !== undefined && typeof s.model !== 'string') {
    fail(`cut "${cutId}": imageState.model must be a string if present`, filePath)
  }
  if (s.attempts !== undefined) {
    if (typeof s.attempts !== 'number' || !Number.isInteger(s.attempts) || s.attempts < 0) {
      fail(
        `cut "${cutId}": imageState.attempts must be a non-negative integer if present`,
        filePath
      )
    }
  }
  if (s.revisionNotes !== undefined && typeof s.revisionNotes !== 'string') {
    fail(`cut "${cutId}": imageState.revisionNotes must be a string if present`, filePath)
  }

  let revisions: ImageRevision[] | undefined
  if (s.revisions !== undefined) {
    if (!Array.isArray(s.revisions)) {
      fail(`cut "${cutId}": imageState.revisions must be an array if present`, filePath)
    }
    revisions = (s.revisions as unknown[]).map((r, i) => {
      if (typeof r !== 'object' || r === null) {
        fail(`cut "${cutId}": imageState.revisions[${i}] must be an object`, filePath)
      }
      const rev = r as Record<string, unknown>
      if (typeof rev.version !== 'number' || !Number.isInteger(rev.version) || rev.version < 1) {
        fail(
          `cut "${cutId}": imageState.revisions[${i}].version must be a positive integer`,
          filePath
        )
      }
      if (typeof rev.path !== 'string' || rev.path.length === 0) {
        fail(`cut "${cutId}": imageState.revisions[${i}].path must be a non-empty string`, filePath)
      }
      if (typeof rev.createdAt !== 'string' || rev.createdAt.length === 0) {
        fail(
          `cut "${cutId}": imageState.revisions[${i}].createdAt must be a non-empty string`,
          filePath
        )
      }
      if (rev.revisionNotes !== undefined && typeof rev.revisionNotes !== 'string') {
        fail(
          `cut "${cutId}": imageState.revisions[${i}].revisionNotes must be a string if present`,
          filePath
        )
      }
      return {
        version: rev.version as number,
        path: rev.path as string,
        createdAt: rev.createdAt as string,
        revisionNotes: rev.revisionNotes as string | undefined
      }
    })
  }

  return {
    status: s.status as ImageState['status'],
    path: (s.path as string) ?? null,
    prompt: (s.prompt as string) ?? null,
    seed: (s.seed as number) ?? null,
    errorMessage: s.errorMessage as string | undefined,
    generationBackend: s.generationBackend as string | undefined,
    model: s.model as string | undefined,
    attempts: s.attempts as number | undefined,
    revisionNotes: s.revisionNotes as string | undefined,
    revisions
  }
}

function validateCanvasOverrides(data: unknown, cutId: string, filePath: string): CanvasOverrides {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    fail(`cut "${cutId}": "canvasOverrides" must be an object`, filePath)
  }
  const c = data as Record<string, unknown>
  const result: CanvasOverrides = {}

  if (c.width !== undefined) {
    if (typeof c.width !== 'number' || !Number.isFinite(c.width) || c.width <= 0) {
      fail(`cut "${cutId}": canvasOverrides.width must be a positive number`, filePath)
    }
    result.width = c.width
  }
  if (c.height !== undefined) {
    if (typeof c.height !== 'number' || !Number.isFinite(c.height) || c.height <= 0) {
      fail(`cut "${cutId}": canvasOverrides.height must be a positive number`, filePath)
    }
    result.height = c.height
  }
  if (c.backgroundColor !== undefined) {
    if (typeof c.backgroundColor !== 'string') {
      fail(`cut "${cutId}": canvasOverrides.backgroundColor must be a string`, filePath)
    }
    result.backgroundColor = c.backgroundColor
  }

  return result
}

function validateCut(data: unknown, index: number, filePath: string): Cut {
  if (typeof data !== 'object' || data === null) {
    fail(`cuts[${index}] must be an object`, filePath)
  }
  const c = data as Record<string, unknown>

  if (typeof c.id !== 'string' || c.id.length === 0) {
    fail(`cuts[${index}]: "id" must be a non-empty string`, filePath)
  }
  const cutId = c.id as string

  if (typeof c.order !== 'number' || !Number.isInteger(c.order) || c.order < 0) {
    fail(`cut "${cutId}": "order" must be a non-negative integer`, filePath)
  }
  if (typeof c.dialogue !== 'string') {
    fail(`cut "${cutId}": "dialogue" must be a string`, filePath)
  }
  if (typeof c.direction !== 'string') {
    fail(`cut "${cutId}": "direction" must be a string`, filePath)
  }
  if (c.narration !== undefined && typeof c.narration !== 'string') {
    fail(`cut "${cutId}": "narration" must be a string if present`, filePath)
  }
  if (c.continuityNotes !== undefined && typeof c.continuityNotes !== 'string') {
    fail(`cut "${cutId}": "continuityNotes" must be a string if present`, filePath)
  }

  const imageState = validateImageState(c.imageState, cutId, filePath)

  if (!Array.isArray(c.overlays)) {
    fail(`cut "${cutId}": "overlays" must be an array`, filePath)
  }
  const overlays = (c.overlays as unknown[]).map((o, i) => validateOverlay(o, i, cutId, filePath))

  let canvasOverrides: CanvasOverrides | undefined
  if (c.canvasOverrides !== undefined) {
    canvasOverrides = validateCanvasOverrides(c.canvasOverrides, cutId, filePath)
  }

  return {
    id: cutId,
    order: c.order as number,
    dialogue: c.dialogue as string,
    direction: c.direction as string,
    narration: c.narration as string | undefined,
    continuityNotes: c.continuityNotes as string | undefined,
    imageState,
    overlays,
    canvasOverrides
  }
}

function validatePublishState(data: unknown, filePath: string): PlotPublishState {
  if (typeof data !== 'object' || data === null) {
    fail('"publishState" must be an object', filePath)
  }
  const p = data as Record<string, unknown>

  if (typeof p.published !== 'boolean') {
    fail('publishState.published must be a boolean', filePath)
  }
  if (p.exportedAt !== null && typeof p.exportedAt !== 'string') {
    fail('publishState.exportedAt must be a string or null', filePath)
  }
  if (p.format !== null && typeof p.format !== 'string') {
    fail('publishState.format must be a string or null', filePath)
  }

  return {
    published: p.published as boolean,
    exportedAt: (p.exportedAt as string) ?? null,
    format: (p.format as string) ?? null
  }
}

export function validateCutsFile(data: unknown, filePath: string): CutsFile {
  if (typeof data !== 'object' || data === null) {
    fail('cuts.json must be a JSON object', filePath)
  }
  const obj = data as Record<string, unknown>

  if (typeof obj.version !== 'number' || !Number.isInteger(obj.version) || obj.version < 1) {
    fail('"version" must be a positive integer', filePath)
  }
  if (typeof obj.plotTitle !== 'string' || obj.plotTitle.trim().length === 0) {
    fail('"plotTitle" must be a non-empty string', filePath)
  }
  if (typeof obj.synopsis !== 'string') {
    fail('"synopsis" must be a string', filePath)
  }
  if (!Array.isArray(obj.cuts)) {
    fail('"cuts" must be an array', filePath)
  }

  const cuts = (obj.cuts as unknown[]).map((c, i) => validateCut(c, i, filePath))

  const ids = new Set<string>()
  for (const cut of cuts) {
    if (ids.has(cut.id)) {
      fail(`duplicate cut id "${cut.id}"`, filePath)
    }
    ids.add(cut.id)
  }

  const publishState = validatePublishState(obj.publishState, filePath)

  return {
    version: obj.version as number,
    plotTitle: obj.plotTitle as string,
    synopsis: obj.synopsis as string,
    cuts,
    publishState
  }
}

export async function readCutsFile(cutsJsonPath: string): Promise<CutsFile> {
  let raw: string
  try {
    raw = await fs.readFile(cutsJsonPath, 'utf-8')
  } catch {
    throw new CutsValidationError('cuts.json not found', cutsJsonPath)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new CutsValidationError('cuts.json contains invalid JSON', cutsJsonPath)
  }

  return validateCutsFile(parsed, cutsJsonPath)
}

export async function writeCutsFile(cutsJsonPath: string, data: CutsFile): Promise<void> {
  validateCutsFile(data, cutsJsonPath)
  await fs.writeFile(cutsJsonPath, JSON.stringify(data, null, 2) + '\n', 'utf-8')
}

export function createEmptyCutsFile(plotTitle: string, synopsis = ''): CutsFile {
  return {
    version: CURRENT_VERSION,
    plotTitle,
    synopsis,
    cuts: [],
    publishState: {
      published: false,
      exportedAt: null,
      format: null
    }
  }
}

export function resolveCutsPath(projectRoot: string, plotSlug: string): string {
  return path.join(projectRoot, 'plots', plotSlug, 'cuts.json')
}
