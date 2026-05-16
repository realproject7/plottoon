import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { registerProject, clearRegistry } from '../services/projectRegistry'
import { writeProjectFileBinary } from '../services/fsService'

let tmpDir: string
let projectId: string

// Minimal valid WebP (RIFF header + WEBP signature)
const WEBP_BYTES = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x4c,
  0x17, 0x00, 0x00, 0x00, 0x2f, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00
])

// Minimal JPEG (SOI marker + EOI marker with padding)
const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46])

beforeEach(async () => {
  clearRegistry()
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'plottoon-binary-'))
  projectId = registerProject(tmpDir)
})

afterEach(async () => {
  clearRegistry()
  await fs.rm(tmpDir, { recursive: true, force: true })
})

describe('writeProjectFileBinary', () => {
  it('writes WebP bytes with correct RIFF magic', async () => {
    const base64 = Buffer.from(WEBP_BYTES).toString('base64')
    await writeProjectFileBinary(projectId, ['exports', 'cut-001.webp'], base64)

    const written = await fs.readFile(path.join(tmpDir, 'exports', 'cut-001.webp'))
    expect(written[0]).toBe(0x52) // R
    expect(written[1]).toBe(0x49) // I
    expect(written[2]).toBe(0x46) // F
    expect(written[3]).toBe(0x46) // F
    expect(written.subarray(8, 12).toString('ascii')).toBe('WEBP')
    expect(written.length).toBe(WEBP_BYTES.length)
  })

  it('writes JPEG bytes with correct SOI magic', async () => {
    const base64 = Buffer.from(JPEG_BYTES).toString('base64')
    await writeProjectFileBinary(projectId, ['exports', 'cut-001.jpg'], base64)

    const written = await fs.readFile(path.join(tmpDir, 'exports', 'cut-001.jpg'))
    expect(written[0]).toBe(0xff)
    expect(written[1]).toBe(0xd8)
    expect(written[2]).toBe(0xff)
    expect(written.length).toBe(JPEG_BYTES.length)
  })

  it('creates parent directories automatically', async () => {
    const base64 = Buffer.from(WEBP_BYTES).toString('base64')
    await writeProjectFileBinary(projectId, ['plots', 'ep1', 'exports', 'cut-001.webp'], base64)

    const written = await fs.readFile(path.join(tmpDir, 'plots', 'ep1', 'exports', 'cut-001.webp'))
    expect(written.length).toBe(WEBP_BYTES.length)
  })

  it('output byte count matches original binary length', async () => {
    const base64 = Buffer.from(WEBP_BYTES).toString('base64')
    await writeProjectFileBinary(projectId, ['test.webp'], base64)

    const written = await fs.readFile(path.join(tmpDir, 'test.webp'))
    expect(written.length).toBe(WEBP_BYTES.length)
  })

  it('does not write UTF-8 text encoding of binary data', async () => {
    const base64 = Buffer.from(WEBP_BYTES).toString('base64')
    await writeProjectFileBinary(projectId, ['test.webp'], base64)

    const raw = await fs.readFile(path.join(tmpDir, 'test.webp'))
    const asText = await fs.readFile(path.join(tmpDir, 'test.webp'), 'utf-8')
    // If written as binary, raw bytes should NOT be valid base64 text
    expect(raw.toString('base64')).not.toBe(asText)
  })
})
