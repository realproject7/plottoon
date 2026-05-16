import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { registerProject, clearRegistry } from '../services/projectRegistry'
import {
  importCleanImage,
  detectCleanImages,
  registerAgentFile
} from '../services/cleanImageImport'

let tmpDir: string
let projectId: string

beforeEach(async () => {
  clearRegistry()
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'plottoon-import-'))
  // Create minimal project structure
  await fs.mkdir(path.join(tmpDir, 'plots', 'episode-1', 'assets', 'cut-001'), { recursive: true })
  projectId = registerProject(tmpDir)
})

afterEach(async () => {
  clearRegistry()
  await fs.rm(tmpDir, { recursive: true, force: true })
})

describe('importCleanImage', () => {
  it('copies a PNG file with versioned filename', async () => {
    const srcFile = path.join(tmpDir, 'external.png')
    await fs.writeFile(srcFile, 'fake-png-data')

    const result = await importCleanImage(projectId, 'episode-1', 'cut-001', srcFile)

    expect(result.filename).toBe('clean-v001.png')
    expect(result.relativePath).toBe(
      path.join('plots', 'episode-1', 'assets', 'cut-001', 'clean-v001.png')
    )
    const copied = await fs.readFile(result.absolutePath, 'utf-8')
    expect(copied).toBe('fake-png-data')
  })

  it('copies a WebP file with versioned filename', async () => {
    const srcFile = path.join(tmpDir, 'external.webp')
    await fs.writeFile(srcFile, 'fake-webp-data')

    const result = await importCleanImage(projectId, 'episode-1', 'cut-001', srcFile)

    expect(result.filename).toBe('clean-v001.webp')
    const copied = await fs.readFile(result.absolutePath, 'utf-8')
    expect(copied).toBe('fake-webp-data')
  })

  it('copies a JPEG file with versioned filename', async () => {
    const srcFile = path.join(tmpDir, 'photo.jpeg')
    await fs.writeFile(srcFile, 'fake-jpeg-data')

    const result = await importCleanImage(projectId, 'episode-1', 'cut-001', srcFile)
    expect(result.filename).toBe('clean-v001.jpeg')
  })

  it('copies a JPG file with versioned filename', async () => {
    const srcFile = path.join(tmpDir, 'photo.jpg')
    await fs.writeFile(srcFile, 'fake-jpg-data')

    const result = await importCleanImage(projectId, 'episode-1', 'cut-001', srcFile)
    expect(result.filename).toBe('clean-v001.jpg')
  })

  it('rejects unsupported file extensions', async () => {
    const srcFile = path.join(tmpDir, 'file.bmp')
    await fs.writeFile(srcFile, 'bmp-data')

    await expect(importCleanImage(projectId, 'episode-1', 'cut-001', srcFile)).rejects.toThrow(
      'Unsupported image format'
    )
  })

  it('creates the asset directory if it does not exist', async () => {
    const srcFile = path.join(tmpDir, 'external.png')
    await fs.writeFile(srcFile, 'data')

    const result = await importCleanImage(projectId, 'episode-1', 'cut-new', srcFile)

    expect(result.filename).toBe('clean-v001.png')
    const exists = await fs
      .access(result.absolutePath)
      .then(() => true)
      .catch(() => false)
    expect(exists).toBe(true)
  })

  it('updates the image state path correctly for cuts.json', async () => {
    const srcFile = path.join(tmpDir, 'external.webp')
    await fs.writeFile(srcFile, 'webp-data')

    const result = await importCleanImage(projectId, 'episode-1', 'cut-001', srcFile)

    expect(result.relativePath).toContain('assets')
    expect(result.relativePath).toContain('cut-001')
    expect(result.relativePath).toMatch(/\.webp$/)
  })

  it('increments version on repeated imports without overwriting', async () => {
    const srcFile = path.join(tmpDir, 'external.webp')
    await fs.writeFile(srcFile, 'first-version')

    const r1 = await importCleanImage(projectId, 'episode-1', 'cut-001', srcFile)
    expect(r1.filename).toBe('clean-v001.webp')

    await fs.writeFile(srcFile, 'second-version')
    const r2 = await importCleanImage(projectId, 'episode-1', 'cut-001', srcFile)
    expect(r2.filename).toBe('clean-v002.webp')

    await fs.writeFile(srcFile, 'third-version')
    const r3 = await importCleanImage(projectId, 'episode-1', 'cut-001', srcFile)
    expect(r3.filename).toBe('clean-v003.webp')

    // All three versions preserved
    const v1 = await fs.readFile(r1.absolutePath, 'utf-8')
    const v2 = await fs.readFile(r2.absolutePath, 'utf-8')
    const v3 = await fs.readFile(r3.absolutePath, 'utf-8')
    expect(v1).toBe('first-version')
    expect(v2).toBe('second-version')
    expect(v3).toBe('third-version')
  })

  it('detects version from existing files regardless of extension', async () => {
    const assetDir = path.join(tmpDir, 'plots', 'episode-1', 'assets', 'cut-001')
    await fs.writeFile(path.join(assetDir, 'clean-v001.png'), 'old')
    await fs.writeFile(path.join(assetDir, 'clean-v002.webp'), 'older')

    const srcFile = path.join(tmpDir, 'new.webp')
    await fs.writeFile(srcFile, 'new-data')

    const result = await importCleanImage(projectId, 'episode-1', 'cut-001', srcFile)
    expect(result.filename).toBe('clean-v003.webp')
  })
})

describe('detectCleanImages', () => {
  it('returns an empty array for non-existent directory', async () => {
    const result = await detectCleanImages(projectId, 'episode-1', 'nonexistent')
    expect(result).toEqual([])
  })

  it('returns image files in sorted order', async () => {
    const assetDir = path.join(tmpDir, 'plots', 'episode-1', 'assets', 'cut-001')
    await fs.writeFile(path.join(assetDir, 'clean-v002.webp'), 'data')
    await fs.writeFile(path.join(assetDir, 'clean-v001.png'), 'data')
    await fs.writeFile(path.join(assetDir, 'notes.txt'), 'not an image')

    const result = await detectCleanImages(projectId, 'episode-1', 'cut-001')

    expect(result).toHaveLength(2)
    expect(result[0].filename).toBe('clean-v001.png')
    expect(result[1].filename).toBe('clean-v002.webp')
  })

  it('ignores non-image files', async () => {
    const assetDir = path.join(tmpDir, 'plots', 'episode-1', 'assets', 'cut-001')
    await fs.writeFile(path.join(assetDir, 'readme.md'), 'docs')
    await fs.writeFile(path.join(assetDir, 'data.json'), '{}')

    const result = await detectCleanImages(projectId, 'episode-1', 'cut-001')
    expect(result).toEqual([])
  })
})

describe('registerAgentFile', () => {
  it('registers an existing agent-generated file', async () => {
    const assetDir = path.join(tmpDir, 'plots', 'episode-1', 'assets', 'cut-001')
    await fs.writeFile(path.join(assetDir, 'clean-v001.webp'), 'agent-generated-data')

    const result = await registerAgentFile(projectId, 'episode-1', 'cut-001', 'clean-v001.webp')

    expect(result.filename).toBe('clean-v001.webp')
    expect(result.relativePath).toBe(
      path.join('plots', 'episode-1', 'assets', 'cut-001', 'clean-v001.webp')
    )
    expect(result.absolutePath).toBe(path.join(assetDir, 'clean-v001.webp'))
  })

  it('throws when the file does not exist', async () => {
    await expect(
      registerAgentFile(projectId, 'episode-1', 'cut-001', 'missing.webp')
    ).rejects.toThrow('File not found')
  })

  it('rejects unsupported file extensions', async () => {
    const assetDir = path.join(tmpDir, 'plots', 'episode-1', 'assets', 'cut-001')
    await fs.writeFile(path.join(assetDir, 'file.bmp'), 'data')

    await expect(registerAgentFile(projectId, 'episode-1', 'cut-001', 'file.bmp')).rejects.toThrow(
      'Unsupported image format'
    )
  })

  it('rejects filenames with path separators', async () => {
    await expect(
      registerAgentFile(projectId, 'episode-1', 'cut-001', '../other-cut/clean.webp')
    ).rejects.toThrow('Filename must not contain path separators')

    await expect(
      registerAgentFile(projectId, 'episode-1', 'cut-001', 'sub/clean.webp')
    ).rejects.toThrow('Filename must not contain path separators')

    await expect(
      registerAgentFile(projectId, 'episode-1', 'cut-001', 'sub\\clean.webp')
    ).rejects.toThrow('Filename must not contain path separators')
  })
})
