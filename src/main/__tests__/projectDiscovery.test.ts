import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { discoverProjects } from '../services/projectDiscovery'
import { writeProjectMeta, createProjectMeta } from '../services/projectMeta'

let tmpDir: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'plottoon-discover-'))
})

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

describe('discoverProjects', () => {
  it('returns empty array for empty directory', async () => {
    expect(await discoverProjects(tmpDir)).toEqual([])
  })

  it('returns empty array for non-existent directory', async () => {
    expect(await discoverProjects('/nonexistent/path')).toEqual([])
  })

  it('discovers valid projects', async () => {
    const projDir = path.join(tmpDir, 'my-webtoon')
    await fs.mkdir(projDir)
    await writeProjectMeta(projDir, createProjectMeta('My Webtoon', 'A test'))

    const results = await discoverProjects(tmpDir)
    expect(results).toHaveLength(1)
    expect(results[0].meta?.name).toBe('My Webtoon')
    expect(results[0].error).toBeNull()
  })

  it('skips directories without project.json', async () => {
    await fs.mkdir(path.join(tmpDir, 'no-meta'))
    const results = await discoverProjects(tmpDir)
    expect(results).toHaveLength(0)
  })

  it('skips files (non-directories)', async () => {
    await fs.writeFile(path.join(tmpDir, 'file.txt'), 'hello')
    const results = await discoverProjects(tmpDir)
    expect(results).toHaveLength(0)
  })

  it('surfaces errors for invalid project.json', async () => {
    const projDir = path.join(tmpDir, 'bad-project')
    await fs.mkdir(projDir)
    await fs.writeFile(path.join(projDir, 'project.json'), 'not json', 'utf-8')

    const results = await discoverProjects(tmpDir)
    expect(results).toHaveLength(1)
    expect(results[0].meta).toBeNull()
    expect(results[0].error).toContain('invalid JSON')
  })

  it('discovers multiple projects', async () => {
    for (const name of ['alpha', 'beta', 'gamma']) {
      const dir = path.join(tmpDir, name)
      await fs.mkdir(dir)
      await writeProjectMeta(dir, createProjectMeta(name))
    }

    const results = await discoverProjects(tmpDir)
    expect(results).toHaveLength(3)
    const names = results.map((r) => r.meta?.name).sort()
    expect(names).toEqual(['alpha', 'beta', 'gamma'])
  })
})
