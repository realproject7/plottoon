import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import {
  createPublishStatus,
  validatePublishStatus,
  readPublishStatus,
  writePublishStatus,
  markCutUploaded,
  markCutFailed,
  markPlotPublished,
  markPlotFailed,
  setPlotState,
  protectCut,
  isProtected,
  PublishStatusError
} from '../services/publishStatus'
import type { PublishStatusFile } from '../services/publishStatus'

let tmpDir: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'plottoon-pubstatus-'))
})

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

function fixture(): PublishStatusFile {
  return createPublishStatus(['cut-001', 'cut-002', 'cut-003'])
}

describe('createPublishStatus', () => {
  it('creates a valid draft status with pending cuts', () => {
    const status = fixture()
    expect(status.version).toBe(1)
    expect(status.plotState).toBe('draft')
    expect(status.error).toBeNull()
    expect(status.publishedAt).toBeNull()
    expect(status.cuts).toHaveLength(3)
    for (const cut of status.cuts) {
      expect(cut.state).toBe('pending')
      expect(cut.cid).toBeNull()
      expect(cut.url).toBeNull()
      expect(cut.fileHash).toBeNull()
      expect(cut.protected).toBe(false)
    }
  })

  it('passes validation', () => {
    const status = fixture()
    expect(() => validatePublishStatus(status, 'test')).not.toThrow()
  })
})

describe('validatePublishStatus', () => {
  it('rejects non-object', () => {
    expect(() => validatePublishStatus(null, 'f')).toThrow('must be a JSON object')
  })

  it('rejects invalid version', () => {
    const data = { ...fixture(), version: 0 }
    expect(() => validatePublishStatus(data, 'f')).toThrow('"version" must be a positive integer')
  })

  it('rejects invalid plotState', () => {
    const data = { ...fixture(), plotState: 'unknown' }
    expect(() => validatePublishStatus(data, 'f')).toThrow('"plotState" must be one of')
  })

  it('rejects duplicate cutIds', () => {
    const data = fixture()
    data.cuts[1].cutId = 'cut-001'
    expect(() => validatePublishStatus(data, 'f')).toThrow('duplicate cutId "cut-001"')
  })

  it('rejects invalid cut state', () => {
    const data = fixture()
    ;(data.cuts[0] as Record<string, unknown>).state = 'bad'
    expect(() => validatePublishStatus(data, 'f')).toThrow('state must be one of')
  })

  it('rejects non-boolean protected', () => {
    const data = fixture()
    ;(data.cuts[0] as Record<string, unknown>).protected = 'yes'
    expect(() => validatePublishStatus(data, 'f')).toThrow('protected must be a boolean')
  })

  it('includes filePath in error', () => {
    try {
      validatePublishStatus(null, '/my/path.json')
      expect.unreachable()
    } catch (e) {
      expect(e).toBeInstanceOf(PublishStatusError)
      expect((e as PublishStatusError).filePath).toBe('/my/path.json')
    }
  })
})

describe('readPublishStatus / writePublishStatus', () => {
  it('round-trips correctly', async () => {
    const status = fixture()
    await writePublishStatus(tmpDir, status)
    const read = await readPublishStatus(tmpDir)
    expect(read).toEqual(status)
  })

  it('throws for missing file', async () => {
    await expect(readPublishStatus(tmpDir)).rejects.toThrow('not found')
  })

  it('throws for invalid JSON', async () => {
    await fs.writeFile(path.join(tmpDir, '.publish-status.json'), '{bad', 'utf-8')
    await expect(readPublishStatus(tmpDir)).rejects.toThrow('invalid JSON')
  })

  it('rejects invalid data on write', async () => {
    const bad = { ...fixture(), plotState: 'bogus' } as PublishStatusFile
    await expect(writePublishStatus(tmpDir, bad)).rejects.toThrow(PublishStatusError)
  })
})

describe('state transitions', () => {
  it('markCutUploaded sets state, cid, url, fileHash', () => {
    const status = fixture()
    const updated = markCutUploaded(
      status,
      'cut-001',
      'QmABC123',
      'https://example.com/cut-001.png',
      'sha256:abc'
    )
    const cut = updated.cuts.find((c) => c.cutId === 'cut-001')!
    expect(cut.state).toBe('uploaded')
    expect(cut.cid).toBe('QmABC123')
    expect(cut.url).toBe('https://example.com/cut-001.png')
    expect(cut.fileHash).toBe('sha256:abc')
    expect(cut.error).toBeNull()
  })

  it('markCutUploaded does not affect other cuts', () => {
    const status = fixture()
    const updated = markCutUploaded(status, 'cut-001', 'cid', 'url', 'hash')
    expect(updated.cuts.find((c) => c.cutId === 'cut-002')!.state).toBe('pending')
  })

  it('markCutFailed sets error on the target cut', () => {
    const status = fixture()
    const updated = markCutFailed(status, 'cut-002', 'upload timeout')
    const cut = updated.cuts.find((c) => c.cutId === 'cut-002')!
    expect(cut.state).toBe('failed')
    expect(cut.error).toBe('upload timeout')
  })

  it('markPlotPublished sets plotState and publishedAt', () => {
    const status = fixture()
    const updated = markPlotPublished(status)
    expect(updated.plotState).toBe('published')
    expect(updated.publishedAt).toBeTruthy()
    expect(updated.error).toBeNull()
  })

  it('markPlotFailed sets error and plotState', () => {
    const status = fixture()
    const updated = markPlotFailed(status, 'network error')
    expect(updated.plotState).toBe('failed')
    expect(updated.error).toBe('network error')
  })

  it('setPlotState transitions to any valid state', () => {
    let status = fixture()
    status = setPlotState(status, 'ready')
    expect(status.plotState).toBe('ready')
    status = setPlotState(status, 'publishing')
    expect(status.plotState).toBe('publishing')
  })
})

describe('idempotency', () => {
  it('markCutUploaded is idempotent', () => {
    const status = fixture()
    const first = markCutUploaded(status, 'cut-001', 'cid', 'url', 'hash')
    const second = markCutUploaded(first, 'cut-001', 'cid', 'url', 'hash')
    expect(second.cuts.find((c) => c.cutId === 'cut-001')!.state).toBe('uploaded')
    expect(second.cuts.find((c) => c.cutId === 'cut-001')!.cid).toBe('cid')
  })

  it('markPlotPublished is idempotent', () => {
    const status = fixture()
    const first = markPlotPublished(status)
    const second = markPlotPublished(first)
    expect(second.plotState).toBe('published')
  })

  it('protectCut is idempotent', () => {
    const status = fixture()
    const first = protectCut(status, 'cut-001')
    const second = protectCut(first, 'cut-001')
    expect(isProtected(second, 'cut-001')).toBe(true)
  })
})

describe('protection', () => {
  it('protectCut marks a cut as protected', () => {
    const status = fixture()
    expect(isProtected(status, 'cut-001')).toBe(false)
    const updated = protectCut(status, 'cut-001')
    expect(isProtected(updated, 'cut-001')).toBe(true)
  })

  it('protectCut does not affect other cuts', () => {
    const status = fixture()
    const updated = protectCut(status, 'cut-001')
    expect(isProtected(updated, 'cut-002')).toBe(false)
  })

  it('isProtected returns false for unknown cutId', () => {
    const status = fixture()
    expect(isProtected(status, 'nonexistent')).toBe(false)
  })

  it('protected status survives round-trip', async () => {
    const status = protectCut(fixture(), 'cut-002')
    await writePublishStatus(tmpDir, status)
    const read = await readPublishStatus(tmpDir)
    expect(isProtected(read, 'cut-002')).toBe(true)
  })
})
