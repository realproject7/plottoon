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
  CutsValidationError
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
