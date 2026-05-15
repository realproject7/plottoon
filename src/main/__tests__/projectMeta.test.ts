import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import {
  readProjectMeta,
  writeProjectMeta,
  createProjectMeta,
  ProjectMetaError
} from '../services/projectMeta'

let tmpDir: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'plottoon-test-'))
})

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

describe('createProjectMeta', () => {
  it('creates meta with name and timestamps', () => {
    const before = new Date().toISOString()
    const meta = createProjectMeta('My Webtoon')
    const after = new Date().toISOString()

    expect(meta.name).toBe('My Webtoon')
    expect(meta.version).toBe(1)
    expect(meta.createdAt >= before).toBe(true)
    expect(meta.createdAt <= after).toBe(true)
    expect(meta.updatedAt).toBe(meta.createdAt)
    expect(meta.description).toBeUndefined()
  })

  it('accepts optional description', () => {
    const meta = createProjectMeta('Test', 'A test project')
    expect(meta.description).toBe('A test project')
  })
})

describe('writeProjectMeta + readProjectMeta', () => {
  it('round-trips valid metadata', async () => {
    const meta = createProjectMeta('Round Trip', 'desc')
    await writeProjectMeta(tmpDir, meta)
    const read = await readProjectMeta(tmpDir)
    expect(read).toEqual(meta)
  })

  it('writes formatted JSON with trailing newline', async () => {
    await writeProjectMeta(tmpDir, createProjectMeta('Formatted'))
    const raw = await fs.readFile(path.join(tmpDir, 'project.json'), 'utf-8')
    expect(raw.endsWith('\n')).toBe(true)
    expect(raw).toContain('  "name"')
  })
})

describe('readProjectMeta validation', () => {
  async function writeRaw(data: string): Promise<void> {
    await fs.writeFile(path.join(tmpDir, 'project.json'), data, 'utf-8')
  }

  it('throws when project.json is missing', async () => {
    await expect(readProjectMeta(tmpDir)).rejects.toThrow(ProjectMetaError)
    await expect(readProjectMeta(tmpDir)).rejects.toThrow('not found')
  })

  it('throws on invalid JSON', async () => {
    await writeRaw('not json{')
    await expect(readProjectMeta(tmpDir)).rejects.toThrow('invalid JSON')
  })

  it('throws when root is not an object', async () => {
    await writeRaw('"just a string"')
    await expect(readProjectMeta(tmpDir)).rejects.toThrow('must be a JSON object')
  })

  it('throws when name is missing', async () => {
    await writeRaw(JSON.stringify({ version: 1, createdAt: 'x', updatedAt: 'x' }))
    await expect(readProjectMeta(tmpDir)).rejects.toThrow('"name"')
  })

  it('throws when name is empty', async () => {
    await writeRaw(JSON.stringify({ name: '  ', version: 1, createdAt: 'x', updatedAt: 'x' }))
    await expect(readProjectMeta(tmpDir)).rejects.toThrow('"name"')
  })

  it('throws when version is not a positive integer', async () => {
    await writeRaw(JSON.stringify({ name: 'a', version: 0, createdAt: 'x', updatedAt: 'x' }))
    await expect(readProjectMeta(tmpDir)).rejects.toThrow('"version"')
  })

  it('throws when version is a float', async () => {
    await writeRaw(JSON.stringify({ name: 'a', version: 1.5, createdAt: 'x', updatedAt: 'x' }))
    await expect(readProjectMeta(tmpDir)).rejects.toThrow('"version"')
  })

  it('throws when createdAt is missing', async () => {
    await writeRaw(JSON.stringify({ name: 'a', version: 1, updatedAt: 'x' }))
    await expect(readProjectMeta(tmpDir)).rejects.toThrow('"createdAt"')
  })

  it('throws when updatedAt is missing', async () => {
    await writeRaw(JSON.stringify({ name: 'a', version: 1, createdAt: 'x' }))
    await expect(readProjectMeta(tmpDir)).rejects.toThrow('"updatedAt"')
  })

  it('throws when description is wrong type', async () => {
    await writeRaw(
      JSON.stringify({ name: 'a', version: 1, createdAt: 'x', updatedAt: 'x', description: 42 })
    )
    await expect(readProjectMeta(tmpDir)).rejects.toThrow('"description"')
  })

  it('accepts valid meta without description', async () => {
    await writeRaw(JSON.stringify({ name: 'Valid', version: 1, createdAt: 'x', updatedAt: 'x' }))
    const meta = await readProjectMeta(tmpDir)
    expect(meta.name).toBe('Valid')
  })

  it('includes projectPath in error', async () => {
    try {
      await readProjectMeta(tmpDir)
    } catch (err) {
      expect(err).toBeInstanceOf(ProjectMetaError)
      expect((err as ProjectMetaError).projectPath).toBe(tmpDir)
    }
  })
})
