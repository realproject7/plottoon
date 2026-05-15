import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { scaffoldProjectTemplate, getExpectedTemplatePaths } from '../services/projectTemplate'

let tmpDir: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'plottoon-template-'))
})

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

describe('scaffoldProjectTemplate', () => {
  it('creates all expected directories', async () => {
    await scaffoldProjectTemplate(tmpDir, 'Test Project')

    const charStat = await fs.stat(path.join(tmpDir, 'characters'))
    expect(charStat.isDirectory()).toBe(true)

    const plotsStat = await fs.stat(path.join(tmpDir, 'plots'))
    expect(plotsStat.isDirectory()).toBe(true)
  })

  it('creates all expected files', async () => {
    await scaffoldProjectTemplate(tmpDir, 'Test Project')

    const expectedFiles = [
      'structure.md',
      'genesis.md',
      'style-guide.md',
      'AGENTS.md',
      '.publish-status.json'
    ]
    for (const file of expectedFiles) {
      const stat = await fs.stat(path.join(tmpDir, file))
      expect(stat.isFile()).toBe(true)
    }
  })

  it('returns list of created paths', async () => {
    const created = await scaffoldProjectTemplate(tmpDir, 'Test Project')
    const expected = getExpectedTemplatePaths()
    expect(created.sort()).toEqual(expected.sort())
  })

  it('includes project name in markdown files', async () => {
    await scaffoldProjectTemplate(tmpDir, 'My Cool Webtoon')

    const structure = await fs.readFile(path.join(tmpDir, 'structure.md'), 'utf-8')
    expect(structure).toContain('My Cool Webtoon')

    const genesis = await fs.readFile(path.join(tmpDir, 'genesis.md'), 'utf-8')
    expect(genesis).toContain('My Cool Webtoon')

    const styleGuide = await fs.readFile(path.join(tmpDir, 'style-guide.md'), 'utf-8')
    expect(styleGuide).toContain('My Cool Webtoon')

    const agents = await fs.readFile(path.join(tmpDir, 'AGENTS.md'), 'utf-8')
    expect(agents).toContain('My Cool Webtoon')
  })

  it('does not embed local paths in generated files', async () => {
    await scaffoldProjectTemplate(tmpDir, 'Path Check')

    const files = [
      'structure.md',
      'genesis.md',
      'style-guide.md',
      'AGENTS.md',
      '.publish-status.json'
    ]
    for (const file of files) {
      const content = await fs.readFile(path.join(tmpDir, file), 'utf-8')
      expect(content).not.toContain(tmpDir)
      expect(content).not.toContain(os.homedir())
    }
  })

  it('creates valid JSON for .publish-status.json', async () => {
    await scaffoldProjectTemplate(tmpDir, 'JSON Check')

    const raw = await fs.readFile(path.join(tmpDir, '.publish-status.json'), 'utf-8')
    const parsed = JSON.parse(raw)
    expect(parsed).toEqual({ published: false, lastCheck: null })
  })

  it('AGENTS.md contains useful agent instructions', async () => {
    await scaffoldProjectTemplate(tmpDir, 'Agent Test')

    const agents = await fs.readFile(path.join(tmpDir, 'AGENTS.md'), 'utf-8')
    expect(agents).toContain('cuts.json')
    expect(agents).toContain('canonical')
  })
})

describe('getExpectedTemplatePaths', () => {
  it('returns directories with trailing slash and files without', () => {
    const paths = getExpectedTemplatePaths()
    const dirs = paths.filter((p) => p.endsWith('/'))
    const files = paths.filter((p) => !p.endsWith('/'))
    expect(dirs.length).toBeGreaterThan(0)
    expect(files.length).toBeGreaterThan(0)
    expect(dirs).toContain('characters/')
    expect(dirs).toContain('plots/')
    expect(files).toContain('structure.md')
  })
})
