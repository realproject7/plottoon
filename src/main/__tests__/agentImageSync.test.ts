import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { registerProject, clearRegistry } from '../services/projectRegistry'
import { syncAgentImagesForCut, syncAgentImagesForPlot } from '../services/agentImageSync'

let tmpDir: string
let projectId: string

beforeEach(async () => {
  clearRegistry()
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'plottoon-agent-image-sync-'))
  // Standard plot layout: plots/episode-1/assets/<cut>/
  await fs.mkdir(path.join(tmpDir, 'plots', 'episode-1', 'assets', 'cut-001'), { recursive: true })
  await fs.mkdir(path.join(tmpDir, 'plots', 'episode-1', 'assets', 'cut-002'), { recursive: true })
  projectId = registerProject(tmpDir)
})

afterEach(async () => {
  clearRegistry()
  await fs.rm(tmpDir, { recursive: true, force: true })
})

describe('#278 syncAgentImagesForCut — discovery', () => {
  it('returns empty result when the cut has no asset folder yet', async () => {
    const result = await syncAgentImagesForCut(projectId, 'episode-1', {
      cutId: 'cut-fresh',
      knownVersions: []
    })
    expect(result.adopted).toEqual([])
    expect(result.rejected).toEqual([])
  })

  it('adopts a new clean-v001.webp file the agent wrote', async () => {
    const assetDir = path.join(tmpDir, 'plots', 'episode-1', 'assets', 'cut-001')
    await fs.writeFile(path.join(assetDir, 'clean-v001.webp'), 'fake-webp-bytes')

    const result = await syncAgentImagesForCut(projectId, 'episode-1', {
      cutId: 'cut-001',
      knownVersions: []
    })
    expect(result.adopted).toHaveLength(1)
    const r = result.adopted[0]
    expect(r.cutId).toBe('cut-001')
    expect(r.version).toBe(1)
    expect(r.filename).toBe('clean-v001.webp')
    expect(r.relativePath).toBe(
      path.join('plots', 'episode-1', 'assets', 'cut-001', 'clean-v001.webp')
    )
    expect(r.sizeBytes).toBeGreaterThan(0)
    // ISO timestamp shape, not an absolute path / private mtime epoch.
    expect(r.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(result.rejected).toEqual([])
  })

  it('discovers multiple revisions in version-sorted order', async () => {
    const assetDir = path.join(tmpDir, 'plots', 'episode-1', 'assets', 'cut-001')
    await fs.writeFile(path.join(assetDir, 'clean-v003.webp'), 'v3')
    await fs.writeFile(path.join(assetDir, 'clean-v001.png'), 'v1')
    await fs.writeFile(path.join(assetDir, 'clean-v002.jpg'), 'v2')

    const result = await syncAgentImagesForCut(projectId, 'episode-1', {
      cutId: 'cut-001',
      knownVersions: []
    })
    expect(result.adopted.map((a) => a.version)).toEqual([1, 2, 3])
    expect(result.adopted.map((a) => a.filename)).toEqual([
      'clean-v001.png',
      'clean-v002.jpg',
      'clean-v003.webp'
    ])
  })
})

describe('#278 syncAgentImagesForCut — no overwrite of existing revisions', () => {
  it('skips versions already in knownVersions (never re-adopts)', async () => {
    const assetDir = path.join(tmpDir, 'plots', 'episode-1', 'assets', 'cut-001')
    await fs.writeFile(path.join(assetDir, 'clean-v001.webp'), 'known')
    await fs.writeFile(path.join(assetDir, 'clean-v002.webp'), 'known')
    await fs.writeFile(path.join(assetDir, 'clean-v003.webp'), 'new')

    const result = await syncAgentImagesForCut(projectId, 'episode-1', {
      cutId: 'cut-001',
      knownVersions: [1, 2]
    })
    expect(result.adopted).toHaveLength(1)
    expect(result.adopted[0].version).toBe(3)
  })

  it('returns empty adopted when every on-disk version is known', async () => {
    const assetDir = path.join(tmpDir, 'plots', 'episode-1', 'assets', 'cut-001')
    await fs.writeFile(path.join(assetDir, 'clean-v001.webp'), 'data')
    await fs.writeFile(path.join(assetDir, 'clean-v002.webp'), 'data')
    const result = await syncAgentImagesForCut(projectId, 'episode-1', {
      cutId: 'cut-001',
      knownVersions: [1, 2]
    })
    expect(result.adopted).toEqual([])
  })

  it('NEVER mutates the file on disk (read-only adoption)', async () => {
    const assetDir = path.join(tmpDir, 'plots', 'episode-1', 'assets', 'cut-001')
    const filePath = path.join(assetDir, 'clean-v001.webp')
    await fs.writeFile(filePath, 'original-bytes-must-not-change')
    await syncAgentImagesForCut(projectId, 'episode-1', {
      cutId: 'cut-001',
      knownVersions: []
    })
    const after = await fs.readFile(filePath, 'utf-8')
    expect(after).toBe('original-bytes-must-not-change')
  })
})

describe('#278 syncAgentImagesForCut — validation failures', () => {
  it('rejects clean-v*.bmp (unsupported extension)', async () => {
    const assetDir = path.join(tmpDir, 'plots', 'episode-1', 'assets', 'cut-001')
    await fs.writeFile(path.join(assetDir, 'clean-v001.bmp'), 'bmp')
    const result = await syncAgentImagesForCut(projectId, 'episode-1', {
      cutId: 'cut-001',
      knownVersions: []
    })
    expect(result.adopted).toEqual([])
    expect(result.rejected).toHaveLength(1)
    expect(result.rejected[0].filename).toBe('clean-v001.bmp')
    expect(result.rejected[0].reason).toMatch(/Filename does not match/i)
  })

  it('rejects clean-vN.webp (single digit — version pattern requires 3 digits)', async () => {
    const assetDir = path.join(tmpDir, 'plots', 'episode-1', 'assets', 'cut-001')
    await fs.writeFile(path.join(assetDir, 'clean-v1.webp'), 'short')
    const result = await syncAgentImagesForCut(projectId, 'episode-1', {
      cutId: 'cut-001',
      knownVersions: []
    })
    expect(result.adopted).toEqual([])
    expect(result.rejected[0].filename).toBe('clean-v1.webp')
  })

  it('ignores unrelated files (notes.txt, plot-text.md, .DS_Store)', async () => {
    const assetDir = path.join(tmpDir, 'plots', 'episode-1', 'assets', 'cut-001')
    await fs.writeFile(path.join(assetDir, 'notes.txt'), 'notes')
    await fs.writeFile(path.join(assetDir, 'plot-text.md'), 'md')
    await fs.writeFile(path.join(assetDir, '.DS_Store'), 'mac')
    const result = await syncAgentImagesForCut(projectId, 'episode-1', {
      cutId: 'cut-001',
      knownVersions: []
    })
    expect(result.adopted).toEqual([])
    expect(result.rejected).toEqual([])
  })

  it('rejects empty files', async () => {
    const assetDir = path.join(tmpDir, 'plots', 'episode-1', 'assets', 'cut-001')
    await fs.writeFile(path.join(assetDir, 'clean-v001.webp'), '')
    const result = await syncAgentImagesForCut(projectId, 'episode-1', {
      cutId: 'cut-001',
      knownVersions: []
    })
    expect(result.adopted).toEqual([])
    expect(result.rejected[0].reason).toMatch(/empty/i)
  })

  it('rejects oversized files (over the 50 MiB cap)', async () => {
    const assetDir = path.join(tmpDir, 'plots', 'episode-1', 'assets', 'cut-001')
    const filePath = path.join(assetDir, 'clean-v001.webp')
    // Allocate just past the cap; use a buffer to avoid an expensive string.
    const huge = Buffer.alloc(50 * 1024 * 1024 + 1, 0)
    await fs.writeFile(filePath, huge)
    const result = await syncAgentImagesForCut(projectId, 'episode-1', {
      cutId: 'cut-001',
      knownVersions: []
    })
    expect(result.adopted).toEqual([])
    expect(result.rejected[0].reason).toMatch(/MiB limit/i)
  })

  it('does NOT adopt a regular file dropped into the wrong shape (e.g. clean.webp without version)', async () => {
    const assetDir = path.join(tmpDir, 'plots', 'episode-1', 'assets', 'cut-001')
    await fs.writeFile(path.join(assetDir, 'clean.webp'), 'no-version')
    const result = await syncAgentImagesForCut(projectId, 'episode-1', {
      cutId: 'cut-001',
      knownVersions: []
    })
    expect(result.adopted).toEqual([])
    // `clean.webp` doesn't match `clean-v*` so it's silently ignored,
    // not rejected. (Rejection is reserved for files that *look* like
    // attempts at the pattern.)
    expect(result.rejected).toEqual([])
  })
})

describe('#278 syncAgentImagesForCut — versioning correctness', () => {
  it('preserves explicit version numbers (does NOT renumber)', async () => {
    const assetDir = path.join(tmpDir, 'plots', 'episode-1', 'assets', 'cut-001')
    // Gap: v1 + v3. The agent occasionally skips numbers; we adopt
    // them as-is rather than renumber.
    await fs.writeFile(path.join(assetDir, 'clean-v001.webp'), 'v1')
    await fs.writeFile(path.join(assetDir, 'clean-v003.webp'), 'v3')
    const result = await syncAgentImagesForCut(projectId, 'episode-1', {
      cutId: 'cut-001',
      knownVersions: []
    })
    expect(result.adopted.map((a) => a.version)).toEqual([1, 3])
  })

  it('mixed knownVersions + new files: only new adopt, in ascending order', async () => {
    const assetDir = path.join(tmpDir, 'plots', 'episode-1', 'assets', 'cut-001')
    await fs.writeFile(path.join(assetDir, 'clean-v002.webp'), 'old-known')
    await fs.writeFile(path.join(assetDir, 'clean-v005.webp'), 'new')
    await fs.writeFile(path.join(assetDir, 'clean-v003.webp'), 'new')
    const result = await syncAgentImagesForCut(projectId, 'episode-1', {
      cutId: 'cut-001',
      knownVersions: [2]
    })
    expect(result.adopted.map((a) => a.version)).toEqual([3, 5])
  })
})

describe('#278 syncAgentImagesForCut — project isolation + path safety', () => {
  it('cutId with .. segments is rejected (path escape)', async () => {
    // Drop a real file outside the cut folder; if path resolution
    // weren't safe, the agent could surface it by passing
    // `cutId='../../../etc/secrets'`.
    await fs.writeFile(path.join(tmpDir, 'clean-v001.webp'), 'fake-outside-payload')
    await expect(
      syncAgentImagesForCut(projectId, 'episode-1', {
        cutId: '..',
        knownVersions: []
      })
    ).rejects.toThrow(/path escape|path separators/i)
  })

  it('cutId with embedded separators is rejected (path escape)', async () => {
    await expect(
      syncAgentImagesForCut(projectId, 'episode-1', {
        cutId: 'cut-001/../other',
        knownVersions: []
      })
    ).rejects.toThrow(/path separators|path escape/i)
  })

  it('plotSlug with .. segments is rejected (path escape)', async () => {
    await expect(
      syncAgentImagesForCut(projectId, '..', {
        cutId: 'cut-001',
        knownVersions: []
      })
    ).rejects.toThrow(/path escape|path separators/i)
  })

  it('only surfaces files inside the given (plot, cut) — sibling cuts are not bled in', async () => {
    const otherDir = path.join(tmpDir, 'plots', 'episode-1', 'assets', 'cut-002')
    await fs.writeFile(path.join(otherDir, 'clean-v001.webp'), 'other-cut-bytes')
    const result = await syncAgentImagesForCut(projectId, 'episode-1', {
      cutId: 'cut-001',
      knownVersions: []
    })
    expect(result.adopted).toEqual([])
    // The other cut's file isn't surfaced when asking about cut-001.
    expect(result.rejected.every((r) => !r.filename.includes('cut-002'))).toBe(true)
  })

  it('does not surface files from a different project (registry isolation)', async () => {
    // Second project; the syncer should never reach across projects
    // because the projectId resolves through projectRegistry.
    const otherProjectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'plottoon-agent-sync-other-'))
    try {
      await fs.mkdir(path.join(otherProjectDir, 'plots', 'episode-1', 'assets', 'cut-001'), {
        recursive: true
      })
      await fs.writeFile(
        path.join(otherProjectDir, 'plots', 'episode-1', 'assets', 'cut-001', 'clean-v001.webp'),
        'other-project-content'
      )
      registerProject(otherProjectDir)
      // Asking about projectId (the original) must not see the file
      // sitting in the other project's tree.
      const result = await syncAgentImagesForCut(projectId, 'episode-1', {
        cutId: 'cut-001',
        knownVersions: []
      })
      expect(result.adopted).toEqual([])
    } finally {
      await fs.rm(otherProjectDir, { recursive: true, force: true })
    }
  })
})

describe('#278 syncAgentImagesForCut — error messages never leak secrets or absolute paths', () => {
  it('rejection reason contains no absolute path or env value', async () => {
    const SECRET = 'fake-test-distinctive-secret-uvwx-9988'
    const ORIGINAL = process.env.ATLASCLOUD_API_KEY
    process.env.ATLASCLOUD_API_KEY = SECRET
    try {
      const assetDir = path.join(tmpDir, 'plots', 'episode-1', 'assets', 'cut-001')
      await fs.writeFile(path.join(assetDir, 'clean-v001.bmp'), 'bmp')
      const result = await syncAgentImagesForCut(projectId, 'episode-1', {
        cutId: 'cut-001',
        knownVersions: []
      })
      for (const r of result.rejected) {
        expect(r.reason).not.toContain(SECRET)
        // Absolute paths begin with `/` on POSIX / `C:` on Windows;
        // assert the temp dir's absolute path never lands in the reason.
        expect(r.reason).not.toContain(tmpDir)
        expect(r.reason).not.toContain('ATLASCLOUD_API_KEY')
        expect(r.reason).not.toContain('ANTHROPIC_API_KEY')
      }
    } finally {
      if (ORIGINAL === undefined) delete process.env.ATLASCLOUD_API_KEY
      else process.env.ATLASCLOUD_API_KEY = ORIGINAL
    }
  })

  it('adopted record uses project-relative paths, never absolute', async () => {
    const assetDir = path.join(tmpDir, 'plots', 'episode-1', 'assets', 'cut-001')
    await fs.writeFile(path.join(assetDir, 'clean-v001.webp'), 'data')
    const result = await syncAgentImagesForCut(projectId, 'episode-1', {
      cutId: 'cut-001',
      knownVersions: []
    })
    expect(result.adopted[0].relativePath).not.toContain(tmpDir)
    expect(result.adopted[0].relativePath.startsWith('plots')).toBe(true)
  })
})

describe('#278 syncAgentImagesForPlot — batch helper', () => {
  it('aggregates results across multiple cuts in a single round-trip', async () => {
    const dir1 = path.join(tmpDir, 'plots', 'episode-1', 'assets', 'cut-001')
    const dir2 = path.join(tmpDir, 'plots', 'episode-1', 'assets', 'cut-002')
    await fs.writeFile(path.join(dir1, 'clean-v001.webp'), 'c1')
    await fs.writeFile(path.join(dir2, 'clean-v001.png'), 'c2')
    await fs.writeFile(path.join(dir2, 'clean-v002.webp'), 'c2-v2')

    const result = await syncAgentImagesForPlot(projectId, 'episode-1', [
      { cutId: 'cut-001', knownVersions: [] },
      { cutId: 'cut-002', knownVersions: [1] }
    ])
    expect(result.adopted).toHaveLength(2)
    const byCut = new Map(result.adopted.map((a) => [a.cutId, a]))
    expect(byCut.get('cut-001')?.version).toBe(1)
    expect(byCut.get('cut-002')?.version).toBe(2)
    expect(result.rejected).toEqual([])
  })

  it('returns an empty result for a plot with no cut requests', async () => {
    const result = await syncAgentImagesForPlot(projectId, 'episode-1', [])
    expect(result.adopted).toEqual([])
    expect(result.rejected).toEqual([])
  })
})
