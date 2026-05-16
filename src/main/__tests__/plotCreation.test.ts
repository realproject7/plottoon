import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createPlot } from '../services/plotCreation'
import { readCutsFile, validateCutsFile, writeCutsFile } from '../services/cutsSchema'
import { regeneratePlotText } from '../services/fsService'
import { registerProject, clearRegistry } from '../services/projectRegistry'

let tmpDir: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'plottoon-plot-'))
  await fs.mkdir(path.join(tmpDir, 'plots'), { recursive: true })
})

afterEach(async () => {
  clearRegistry()
  await fs.rm(tmpDir, { recursive: true, force: true })
})

describe('createPlot', () => {
  it('creates plot folder with expected subdirectories', async () => {
    const result = await createPlot({ projectRoot: tmpDir, plotTitle: 'Episode One' })

    expect(result.slug).toBe('episode-one')
    const stat = await fs.stat(result.plotDir)
    expect(stat.isDirectory()).toBe(true)

    for (const sub of ['assets', 'exports']) {
      const subStat = await fs.stat(path.join(result.plotDir, sub))
      expect(subStat.isDirectory()).toBe(true)
    }
  })

  it('creates a valid empty cuts.json by default', async () => {
    const result = await createPlot({
      projectRoot: tmpDir,
      plotTitle: 'Empty Plot',
      synopsis: 'A blank slate'
    })

    const cutsFile = await readCutsFile(result.cutsPath)
    expect(cutsFile.plotTitle).toBe('Empty Plot')
    expect(cutsFile.synopsis).toBe('A blank slate')
    expect(cutsFile.cuts).toHaveLength(0)
    expect(cutsFile.publishState.published).toBe(false)
  })

  it('creates sample cuts when sample option is true', async () => {
    const result = await createPlot({
      projectRoot: tmpDir,
      plotTitle: 'Sample Plot',
      sample: true
    })

    const cutsFile = await readCutsFile(result.cutsPath)
    expect(cutsFile.cuts).toHaveLength(2)
    expect(cutsFile.cuts[0].id).toBe('cut-001')
    expect(cutsFile.cuts[1].id).toBe('cut-002')
    expect(cutsFile.cuts[0].order).toBe(0)
    expect(cutsFile.cuts[1].order).toBe(1)
  })

  it('sample cuts.json passes schema validation', async () => {
    const result = await createPlot({
      projectRoot: tmpDir,
      plotTitle: 'Validated Sample',
      sample: true
    })

    const raw = await fs.readFile(result.cutsPath, 'utf-8')
    const parsed = JSON.parse(raw)
    const validated = validateCutsFile(parsed, result.cutsPath)
    expect(validated.cuts).toHaveLength(2)
    expect(validated.plotTitle).toBe('Validated Sample')
  })

  it('sample cut IDs follow cut-NNN convention', async () => {
    const result = await createPlot({
      projectRoot: tmpDir,
      plotTitle: 'ID Convention',
      sample: true
    })

    const cutsFile = await readCutsFile(result.cutsPath)
    for (const cut of cutsFile.cuts) {
      expect(cut.id).toMatch(/^cut-\d{3}$/)
    }
  })

  it('sample cuts have pending image state', async () => {
    const result = await createPlot({
      projectRoot: tmpDir,
      plotTitle: 'Pending Images',
      sample: true
    })

    const cutsFile = await readCutsFile(result.cutsPath)
    for (const cut of cutsFile.cuts) {
      expect(cut.imageState.status).toBe('pending')
      expect(cut.imageState.path).toBeNull()
    }
  })

  it('creates plot-text.md with title and synopsis from cuts.json', async () => {
    const result = await createPlot({
      projectRoot: tmpDir,
      plotTitle: 'My Story',
      synopsis: 'An epic tale'
    })

    const plotText = await fs.readFile(path.join(result.plotDir, 'plot-text.md'), 'utf-8')
    expect(plotText).toContain('# My Story')
    expect(plotText).toContain('An epic tale')
    expect(plotText).toContain('Publish Status')
  })

  it('creates plot-text.md with cut details when sample is true', async () => {
    const result = await createPlot({
      projectRoot: tmpDir,
      plotTitle: 'Sample Story',
      sample: true
    })

    const plotText = await fs.readFile(path.join(result.plotDir, 'plot-text.md'), 'utf-8')
    expect(plotText).toContain('# Sample Story')
    expect(plotText).toContain('cut-001')
    expect(plotText).toContain('cut-002')
    expect(plotText).toContain('Wide establishing shot')
    expect(plotText).toContain('It all started here...')
  })

  it('does not create plot.md', async () => {
    const result = await createPlot({
      projectRoot: tmpDir,
      plotTitle: 'No Old File'
    })

    const exists = await fs
      .access(path.join(result.plotDir, 'plot.md'))
      .then(() => true)
      .catch(() => false)
    expect(exists).toBe(false)
  })

  it('slugifies title correctly', async () => {
    const result = await createPlot({
      projectRoot: tmpDir,
      plotTitle: '  My GREAT Episode!! #1  '
    })
    expect(result.slug).toBe('my-great-episode-1')
  })

  it('returns relative directory paths in dirs array', async () => {
    const result = await createPlot({ projectRoot: tmpDir, plotTitle: 'Dir Check' })
    expect(result.dirs).toContain(path.join('plots', 'dir-check'))
    expect(result.dirs).toContain(path.join('plots', 'dir-check', 'assets'))
    expect(result.dirs).toContain(path.join('plots', 'dir-check', 'exports'))
  })

  it('throws if plot folder already exists', async () => {
    await createPlot({ projectRoot: tmpDir, plotTitle: 'Duplicate' })
    await expect(createPlot({ projectRoot: tmpDir, plotTitle: 'Duplicate' })).rejects.toThrow(
      'Plot folder already exists'
    )
  })

  it('throws for empty title', async () => {
    await expect(createPlot({ projectRoot: tmpDir, plotTitle: '   ' })).rejects.toThrow(
      'Plot title must be a non-empty string'
    )
  })

  it('throws for title with no alphanumeric characters', async () => {
    await expect(createPlot({ projectRoot: tmpDir, plotTitle: '---!!!' })).rejects.toThrow(
      'Plot title must contain at least one alphanumeric character'
    )
  })
})

describe('regeneratePlotText', () => {
  it('regenerates plot-text.md after cuts.json is modified', async () => {
    const result = await createPlot({
      projectRoot: tmpDir,
      plotTitle: 'Regen Test',
      synopsis: 'A story',
      sample: true
    })

    const projectId = registerProject(tmpDir)
    const cutsFile = await readCutsFile(result.cutsPath)

    // Modify a cut's dialogue
    cutsFile.cuts[0].dialogue = 'New dialogue after edit'
    await writeCutsFile(result.cutsPath, cutsFile)

    // Regenerate
    await regeneratePlotText(projectId, 'regen-test')

    const plotText = await fs.readFile(path.join(result.plotDir, 'plot-text.md'), 'utf-8')
    expect(plotText).toContain('New dialogue after edit')
    expect(plotText).toContain('# Regen Test')
  })

  it('handles renderer-shaped cuts with missing schema fields', async () => {
    const result = await createPlot({
      projectRoot: tmpDir,
      plotTitle: 'Renderer Test'
    })

    const projectId = registerProject(tmpDir)

    // Simulate a renderer save with minimal cut shape (like addCut produces)
    const rendererSave = JSON.stringify(
      {
        version: 1,
        plotTitle: 'Renderer Test',
        synopsis: '',
        cuts: [{ id: 'cut-001', status: 'planned' }],
        publishState: { published: false, exportedAt: null, format: null }
      },
      null,
      2
    )
    await fs.writeFile(result.cutsPath, rendererSave, 'utf-8')

    // regeneratePlotText should not throw
    await regeneratePlotText(projectId, 'renderer-test')

    const plotText = await fs.readFile(path.join(result.plotDir, 'plot-text.md'), 'utf-8')
    expect(plotText).toContain('# Renderer Test')
    expect(plotText).toContain('cut-001')
  })

  it('reflects added cuts in regenerated plot-text.md', async () => {
    const result = await createPlot({
      projectRoot: tmpDir,
      plotTitle: 'Add Cut Test'
    })

    const projectId = registerProject(tmpDir)
    const cutsFile = await readCutsFile(result.cutsPath)

    // Initially empty
    const initialText = await fs.readFile(path.join(result.plotDir, 'plot-text.md'), 'utf-8')
    expect(initialText).toContain('No cuts defined yet')

    // Add a cut and regenerate
    cutsFile.cuts.push({
      id: 'cut-001',
      order: 0,
      dialogue: 'Hello world',
      direction: 'Establishing shot',
      imageState: { status: 'pending', path: null, prompt: null, seed: null },
      overlays: []
    })
    await writeCutsFile(result.cutsPath, cutsFile)
    await regeneratePlotText(projectId, 'add-cut-test')

    const updatedText = await fs.readFile(path.join(result.plotDir, 'plot-text.md'), 'utf-8')
    expect(updatedText).toContain('cut-001')
    expect(updatedText).toContain('Hello world')
    expect(updatedText).toContain('Establishing shot')
    expect(updatedText).not.toContain('No cuts defined yet')
  })
})
