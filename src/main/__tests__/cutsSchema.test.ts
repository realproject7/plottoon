import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import {
  validateCutsFile,
  readCutsFile,
  writeCutsFile,
  createEmptyCutsFile,
  resolveCutsPath,
  CutsValidationError,
  CUTS_JSON_SCHEMA
} from '../services/cutsSchema'
import type { CutsFile } from '../services/cutsSchema'

let tmpDir: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'plottoon-cuts-'))
})

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

function validFixture(): CutsFile {
  return {
    version: 1,
    plotTitle: 'Episode 1',
    synopsis: 'The hero wakes up.',
    cuts: [
      {
        id: 'cut-001',
        order: 0,
        dialogue: 'Where am I?',
        direction: 'Close-up on face, eyes opening slowly',
        imageState: {
          status: 'done',
          path: 'assets/cut-001.png',
          prompt: 'anime close-up face eyes opening',
          seed: 42
        },
        overlays: [
          {
            id: 'ovl-1',
            type: 'text',
            content: 'Where am I?',
            x: 100,
            y: 50,
            width: 200,
            height: 40
          }
        ]
      },
      {
        id: 'cut-002',
        order: 1,
        dialogue: '',
        direction: 'Wide shot of ruined city',
        imageState: {
          status: 'pending',
          path: null,
          prompt: null,
          seed: null
        },
        overlays: [],
        canvasOverrides: {
          width: 800,
          height: 1200,
          backgroundColor: '#111111'
        }
      }
    ],
    publishState: {
      published: false,
      exportedAt: null,
      format: null
    }
  }
}

describe('validateCutsFile', () => {
  it('accepts a valid cuts file', () => {
    const result = validateCutsFile(validFixture(), 'test.json')
    expect(result.plotTitle).toBe('Episode 1')
    expect(result.cuts).toHaveLength(2)
  })

  it('accepts a file with zero cuts', () => {
    const data = { ...validFixture(), cuts: [] }
    const result = validateCutsFile(data, 'test.json')
    expect(result.cuts).toHaveLength(0)
  })

  it('accepts overlays with optional style', () => {
    const data = validFixture()
    data.cuts[0].overlays[0].style = { fontWeight: 'bold', color: '#fff' }
    const result = validateCutsFile(data, 'test.json')
    expect(result.cuts[0].overlays[0].style).toEqual({ fontWeight: 'bold', color: '#fff' })
  })

  it('accepts imageState with errorMessage on failed status', () => {
    const data = validFixture()
    data.cuts[0].imageState = {
      status: 'failed',
      path: null,
      prompt: 'test prompt',
      seed: null,
      errorMessage: 'GPU out of memory'
    }
    const result = validateCutsFile(data, 'test.json')
    expect(result.cuts[0].imageState.errorMessage).toBe('GPU out of memory')
  })

  it('accepts imageState with generation metadata fields', () => {
    const data = validFixture()
    data.cuts[0].imageState = {
      ...data.cuts[0].imageState,
      generationBackend: 'manual',
      model: 'sdxl-turbo',
      attempts: 3,
      revisionNotes: 'Adjusted lighting in v3'
    }
    const result = validateCutsFile(data, 'test.json')
    expect(result.cuts[0].imageState.generationBackend).toBe('manual')
    expect(result.cuts[0].imageState.model).toBe('sdxl-turbo')
    expect(result.cuts[0].imageState.attempts).toBe(3)
    expect(result.cuts[0].imageState.revisionNotes).toBe('Adjusted lighting in v3')
  })

  it('accepts imageState with revisions array', () => {
    const data = validFixture()
    ;(data.cuts[0].imageState as Record<string, unknown>).revisions = [
      {
        version: 1,
        path: 'assets/cut-001/clean-v001.png',
        createdAt: '2026-05-01T10:00:00.000Z',
        revisionNotes: 'First draft'
      },
      {
        version: 2,
        path: 'assets/cut-001/clean-v002.webp',
        createdAt: '2026-05-02T14:00:00.000Z'
      }
    ]
    const result = validateCutsFile(data, 'test.json')
    expect(result.cuts[0].imageState.revisions).toHaveLength(2)
    expect(result.cuts[0].imageState.revisions![0].version).toBe(1)
    expect(result.cuts[0].imageState.revisions![0].revisionNotes).toBe('First draft')
    expect(result.cuts[0].imageState.revisions![1].revisionNotes).toBeUndefined()
  })

  it('rejects non-array revisions', () => {
    const data = validFixture()
    ;(data.cuts[0].imageState as Record<string, unknown>).revisions = 'not-array'
    expect(() => validateCutsFile(data, 'f')).toThrow(
      'imageState.revisions must be an array if present'
    )
  })

  it('rejects revision with missing version', () => {
    const data = validFixture()
    ;(data.cuts[0].imageState as Record<string, unknown>).revisions = [
      { path: 'assets/cut.png', createdAt: '2026-05-01T10:00:00.000Z' }
    ]
    expect(() => validateCutsFile(data, 'f')).toThrow(
      'revisions[0].version must be a positive integer'
    )
  })

  it('rejects revision with zero version', () => {
    const data = validFixture()
    ;(data.cuts[0].imageState as Record<string, unknown>).revisions = [
      { version: 0, path: 'assets/cut.png', createdAt: '2026-05-01T10:00:00.000Z' }
    ]
    expect(() => validateCutsFile(data, 'f')).toThrow(
      'revisions[0].version must be a positive integer'
    )
  })

  it('rejects revision with empty path', () => {
    const data = validFixture()
    ;(data.cuts[0].imageState as Record<string, unknown>).revisions = [
      { version: 1, path: '', createdAt: '2026-05-01T10:00:00.000Z' }
    ]
    expect(() => validateCutsFile(data, 'f')).toThrow(
      'revisions[0].path must be a non-empty string'
    )
  })

  it('rejects revision with non-string revisionNotes', () => {
    const data = validFixture()
    ;(data.cuts[0].imageState as Record<string, unknown>).revisions = [
      {
        version: 1,
        path: 'assets/cut.png',
        createdAt: '2026-05-01T10:00:00.000Z',
        revisionNotes: 42
      }
    ]
    expect(() => validateCutsFile(data, 'f')).toThrow(
      'revisions[0].revisionNotes must be a string if present'
    )
  })

  it('rejects non-string generationBackend', () => {
    const data = validFixture()
    ;(data.cuts[0].imageState as Record<string, unknown>).generationBackend = 42
    expect(() => validateCutsFile(data, 'f')).toThrow(
      'imageState.generationBackend must be a string if present'
    )
  })

  it('rejects non-string model', () => {
    const data = validFixture()
    ;(data.cuts[0].imageState as Record<string, unknown>).model = true
    expect(() => validateCutsFile(data, 'f')).toThrow(
      'imageState.model must be a string if present'
    )
  })

  it('rejects negative attempts', () => {
    const data = validFixture()
    ;(data.cuts[0].imageState as Record<string, unknown>).attempts = -1
    expect(() => validateCutsFile(data, 'f')).toThrow(
      'imageState.attempts must be a non-negative integer if present'
    )
  })

  it('rejects non-integer attempts', () => {
    const data = validFixture()
    ;(data.cuts[0].imageState as Record<string, unknown>).attempts = 1.5
    expect(() => validateCutsFile(data, 'f')).toThrow(
      'imageState.attempts must be a non-negative integer if present'
    )
  })

  it('rejects non-string revisionNotes', () => {
    const data = validFixture()
    ;(data.cuts[0].imageState as Record<string, unknown>).revisionNotes = 123
    expect(() => validateCutsFile(data, 'f')).toThrow(
      'imageState.revisionNotes must be a string if present'
    )
  })

  it('rejects non-object input', () => {
    expect(() => validateCutsFile('string', 'f')).toThrow(CutsValidationError)
    expect(() => validateCutsFile(null, 'f')).toThrow('must be a JSON object')
  })

  it('rejects missing version', () => {
    const data = validFixture() as Record<string, unknown>
    delete data.version
    expect(() => validateCutsFile(data, 'f')).toThrow('"version" must be a positive integer')
  })

  it('rejects empty plotTitle', () => {
    const data = { ...validFixture(), plotTitle: '   ' }
    expect(() => validateCutsFile(data, 'f')).toThrow('"plotTitle" must be a non-empty string')
  })

  it('rejects non-array cuts', () => {
    const data = { ...validFixture(), cuts: 'not-array' }
    expect(() => validateCutsFile(data, 'f')).toThrow('"cuts" must be an array')
  })

  it('rejects duplicate cut IDs', () => {
    const data = validFixture()
    data.cuts[1].id = 'cut-001'
    expect(() => validateCutsFile(data, 'f')).toThrow('duplicate cut id "cut-001"')
  })

  it('rejects cut with missing id', () => {
    const data = validFixture()
    delete (data.cuts[0] as Record<string, unknown>).id
    expect(() => validateCutsFile(data, 'f')).toThrow('"id" must be a non-empty string')
  })

  it('rejects cut with negative order', () => {
    const data = validFixture()
    data.cuts[0].order = -1
    expect(() => validateCutsFile(data, 'f')).toThrow('"order" must be a non-negative integer')
  })

  it('accepts optional narration and continuityNotes', () => {
    const data = validFixture()
    data.cuts[0].narration = 'The hero reflects.'
    data.cuts[0].continuityNotes = 'Same outfit as cut-002'
    const result = validateCutsFile(data, 'test.json')
    expect(result.cuts[0].narration).toBe('The hero reflects.')
    expect(result.cuts[0].continuityNotes).toBe('Same outfit as cut-002')
  })

  it('rejects non-string narration', () => {
    const data = validFixture()
    ;(data.cuts[0] as Record<string, unknown>).narration = 42
    expect(() => validateCutsFile(data, 'f')).toThrow('"narration" must be a string if present')
  })

  it('rejects non-string continuityNotes', () => {
    const data = validFixture()
    ;(data.cuts[0] as Record<string, unknown>).continuityNotes = true
    expect(() => validateCutsFile(data, 'f')).toThrow(
      '"continuityNotes" must be a string if present'
    )
  })

  it('rejects invalid imageState status', () => {
    const data = validFixture()
    ;(data.cuts[0].imageState as Record<string, unknown>).status = 'unknown'
    expect(() => validateCutsFile(data, 'f')).toThrow('imageState.status must be one of')
  })

  it('rejects non-string imageState.path', () => {
    const data = validFixture()
    ;(data.cuts[0].imageState as Record<string, unknown>).path = 123
    expect(() => validateCutsFile(data, 'f')).toThrow('imageState.path must be a string or null')
  })

  it('rejects non-finite imageState.seed', () => {
    const data = validFixture()
    ;(data.cuts[0].imageState as Record<string, unknown>).seed = Infinity
    expect(() => validateCutsFile(data, 'f')).toThrow('imageState.seed must be a finite number')
  })

  it('rejects overlay with invalid type', () => {
    const data = validFixture()
    ;(data.cuts[0].overlays[0] as Record<string, unknown>).type = 'image'
    expect(() => validateCutsFile(data, 'f')).toThrow('"type" must be "text" or "sfx"')
  })

  it('rejects overlay with non-finite coordinate', () => {
    const data = validFixture()
    ;(data.cuts[0].overlays[0] as Record<string, unknown>).x = NaN
    expect(() => validateCutsFile(data, 'f')).toThrow('"x" must be a finite number')
  })

  it('rejects overlay style with non-string value', () => {
    const data = validFixture()
    data.cuts[0].overlays[0].style = { fontWeight: 42 as unknown as string }
    expect(() => validateCutsFile(data, 'f')).toThrow('style["fontWeight"] must be a string')
  })

  it('rejects canvasOverrides with zero width', () => {
    const data = validFixture()
    data.cuts[1].canvasOverrides = { width: 0 }
    expect(() => validateCutsFile(data, 'f')).toThrow(
      'canvasOverrides.width must be a positive number'
    )
  })

  it('rejects missing publishState', () => {
    const data = validFixture() as Record<string, unknown>
    delete data.publishState
    expect(() => validateCutsFile(data, 'f')).toThrow('"publishState" must be an object')
  })

  it('rejects publishState.published as non-boolean', () => {
    const data = validFixture()
    ;(data.publishState as Record<string, unknown>).published = 'yes'
    expect(() => validateCutsFile(data, 'f')).toThrow('publishState.published must be a boolean')
  })

  it('includes filePath in error', () => {
    try {
      validateCutsFile(null, '/my/cuts.json')
      expect.unreachable()
    } catch (e) {
      expect(e).toBeInstanceOf(CutsValidationError)
      expect((e as CutsValidationError).filePath).toBe('/my/cuts.json')
    }
  })
})

describe('readCutsFile', () => {
  it('reads and validates a valid cuts.json', async () => {
    const cutsPath = path.join(tmpDir, 'cuts.json')
    await fs.writeFile(cutsPath, JSON.stringify(validFixture()), 'utf-8')
    const result = await readCutsFile(cutsPath)
    expect(result.plotTitle).toBe('Episode 1')
    expect(result.cuts).toHaveLength(2)
  })

  it('throws for missing file', async () => {
    await expect(readCutsFile(path.join(tmpDir, 'nope.json'))).rejects.toThrow('not found')
  })

  it('throws for invalid JSON', async () => {
    const cutsPath = path.join(tmpDir, 'cuts.json')
    await fs.writeFile(cutsPath, '{broken', 'utf-8')
    await expect(readCutsFile(cutsPath)).rejects.toThrow('invalid JSON')
  })

  it('throws for structurally invalid data', async () => {
    const cutsPath = path.join(tmpDir, 'cuts.json')
    await fs.writeFile(cutsPath, JSON.stringify({ version: 'bad' }), 'utf-8')
    await expect(readCutsFile(cutsPath)).rejects.toThrow(CutsValidationError)
  })
})

describe('writeCutsFile', () => {
  it('writes valid data and can round-trip', async () => {
    const cutsPath = path.join(tmpDir, 'cuts.json')
    const data = validFixture()
    await writeCutsFile(cutsPath, data)
    const result = await readCutsFile(cutsPath)
    expect(result).toEqual(data)
  })

  it('rejects invalid data on write', async () => {
    const cutsPath = path.join(tmpDir, 'cuts.json')
    const bad = { ...validFixture(), version: -1 } as CutsFile
    await expect(writeCutsFile(cutsPath, bad)).rejects.toThrow(CutsValidationError)
  })
})

describe('createEmptyCutsFile', () => {
  it('creates a valid empty cuts file', () => {
    const result = createEmptyCutsFile('My Plot', 'A synopsis')
    expect(result.version).toBe(1)
    expect(result.plotTitle).toBe('My Plot')
    expect(result.synopsis).toBe('A synopsis')
    expect(result.cuts).toEqual([])
    expect(result.publishState.published).toBe(false)
    const errors: string[] = []
    try {
      validateCutsFile(result, 'test')
    } catch (e) {
      errors.push((e as Error).message)
    }
    expect(errors).toEqual([])
  })

  it('defaults synopsis to empty string', () => {
    const result = createEmptyCutsFile('Title Only')
    expect(result.synopsis).toBe('')
  })
})

describe('resolveCutsPath', () => {
  it('returns correct path', () => {
    const result = resolveCutsPath('/projects/my-webtoon', 'episode-1')
    expect(result).toBe(path.join('/projects/my-webtoon', 'plots', 'episode-1', 'cuts.json'))
  })
})

describe('CUTS_JSON_SCHEMA', () => {
  const schema = CUTS_JSON_SCHEMA as Record<string, unknown>

  it('is a valid JSON Schema draft-2020-12 object', () => {
    expect(schema.$schema).toBe('https://json-schema.org/draft/2020-12/schema')
    expect(schema.type).toBe('object')
  })

  it('requires top-level fields: version, plotTitle, synopsis, cuts, publishState', () => {
    expect(schema.required).toEqual(
      expect.arrayContaining(['version', 'plotTitle', 'synopsis', 'cuts', 'publishState'])
    )
  })

  it('defines properties for all top-level fields', () => {
    const props = schema.properties as Record<string, unknown>
    expect(props).toHaveProperty('version')
    expect(props).toHaveProperty('plotTitle')
    expect(props).toHaveProperty('synopsis')
    expect(props).toHaveProperty('cuts')
    expect(props).toHaveProperty('publishState')
  })

  it('defines $defs for cut, imageState, overlay, canvasOverrides, publishState', () => {
    const defs = schema.$defs as Record<string, unknown>
    expect(defs).toHaveProperty('cut')
    expect(defs).toHaveProperty('imageState')
    expect(defs).toHaveProperty('overlay')
    expect(defs).toHaveProperty('canvasOverrides')
    expect(defs).toHaveProperty('publishState')
  })

  it('imageState schema enumerates all valid statuses', () => {
    const defs = schema.$defs as Record<string, Record<string, unknown>>
    const imageProps = defs.imageState.properties as Record<string, Record<string, unknown>>
    expect(imageProps.status.enum).toEqual(['pending', 'generating', 'done', 'failed'])
  })

  it('overlay schema enumerates text and sfx types', () => {
    const defs = schema.$defs as Record<string, Record<string, unknown>>
    const overlayProps = defs.overlay.properties as Record<string, Record<string, unknown>>
    expect(overlayProps.type.enum).toEqual(['text', 'sfx'])
  })

  it('cut schema requires imageState and overlays', () => {
    const defs = schema.$defs as Record<string, Record<string, unknown>>
    expect(defs.cut.required).toEqual(
      expect.arrayContaining(['id', 'order', 'imageState', 'overlays'])
    )
  })

  it('cut schema allows optional status field with lifecycle enum', () => {
    const defs = schema.$defs as Record<string, { properties: Record<string, unknown> }>
    const statusProp = defs.cut.properties.status as { type: string; enum: string[] }
    expect(statusProp.type).toBe('string')
    expect(statusProp.enum).toEqual(
      expect.arrayContaining(['planned', 'draft', 'approved', 'exported', 'published'])
    )
  })
})

describe('renderer round-trip validation', () => {
  it('validates a cuts.json produced by renderer addCut + normalization', () => {
    const rendererCuts = [
      {
        id: 'cut-001',
        status: 'planned',
        order: 0,
        dialogue: '',
        direction: '',
        imageState: { status: 'pending', path: null, prompt: null, seed: null },
        overlays: []
      }
    ]
    const cutsFile = {
      version: 1,
      plotTitle: 'Test Plot',
      synopsis: '',
      cuts: rendererCuts,
      publishState: { published: false, exportedAt: null, format: null }
    }
    const validated = validateCutsFile(cutsFile, 'test.json')
    expect(validated.cuts[0].id).toBe('cut-001')
    expect(validated.cuts[0].status).toBe('planned')
  })

  it('validates renderer save with multiple cuts and status changes', () => {
    const cutsFile = {
      version: 1,
      plotTitle: 'Multi Cut',
      synopsis: 'A story',
      cuts: [
        {
          id: 'cut-001',
          status: 'approved',
          order: 0,
          dialogue: 'Hello',
          direction: 'Wide shot',
          imageState: { status: 'done', path: 'assets/clean-v001.webp', prompt: null, seed: null },
          overlays: []
        },
        {
          id: 'cut-002',
          status: 'draft',
          order: 1,
          dialogue: '',
          direction: '',
          imageState: { status: 'pending', path: null, prompt: null, seed: null },
          overlays: [
            { id: 'ovl-1', type: 'text', content: 'Hey!', x: 10, y: 20, width: 100, height: 40 }
          ]
        }
      ],
      publishState: { published: false, exportedAt: null, format: null }
    }
    const validated = validateCutsFile(cutsFile, 'test.json')
    expect(validated.cuts).toHaveLength(2)
    expect(validated.cuts[0].status).toBe('approved')
    expect(validated.cuts[1].status).toBe('draft')
  })

  it('rejects invalid status values', () => {
    const cutsFile = {
      version: 1,
      plotTitle: 'Bad Status',
      synopsis: '',
      cuts: [
        {
          id: 'cut-001',
          status: 'invalid_status',
          order: 0,
          dialogue: '',
          direction: '',
          imageState: { status: 'pending', path: null, prompt: null, seed: null },
          overlays: []
        }
      ],
      publishState: { published: false, exportedAt: null, format: null }
    }
    expect(() => validateCutsFile(cutsFile, 'test.json')).toThrow(CutsValidationError)
  })

  it('accepts cuts without status field (backward compatibility)', () => {
    const cutsFile = {
      version: 1,
      plotTitle: 'No Status',
      synopsis: '',
      cuts: [
        {
          id: 'cut-001',
          order: 0,
          dialogue: '',
          direction: '',
          imageState: { status: 'pending', path: null, prompt: null, seed: null },
          overlays: []
        }
      ],
      publishState: { published: false, exportedAt: null, format: null }
    }
    const validated = validateCutsFile(cutsFile, 'test.json')
    expect(validated.cuts[0].status).toBeUndefined()
  })
})
