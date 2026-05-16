import fs from 'node:fs/promises'
import path from 'node:path'
import { createEmptyCutsFile, writeCutsFile, resolveCutsPath } from './cutsSchema'
import type { CutsFile, Cut } from './cutsSchema'
import { generatePlotText } from './plotTextGenerator'

export interface CreatePlotOptions {
  projectRoot: string
  plotTitle: string
  synopsis?: string
  sample?: boolean
}

export interface CreatedPlot {
  slug: string
  plotDir: string
  cutsPath: string
  dirs: string[]
}

const PLOT_SUBDIRS = ['assets', 'exports']

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

function makeSampleCut(id: string, order: number): Cut {
  return {
    id,
    order,
    dialogue: order === 0 ? 'It all started here...' : '',
    direction:
      order === 0
        ? 'Wide establishing shot of the city skyline at dawn'
        : 'Close-up on the protagonist looking determined',
    imageState: {
      status: 'pending',
      path: null,
      prompt: null,
      seed: null
    },
    overlays: []
  }
}

function buildCutsFile(plotTitle: string, synopsis: string, sample: boolean): CutsFile {
  if (!sample) {
    return createEmptyCutsFile(plotTitle, synopsis)
  }
  const base = createEmptyCutsFile(plotTitle, synopsis)
  return {
    ...base,
    cuts: [makeSampleCut('cut-001', 0), makeSampleCut('cut-002', 1)]
  }
}

export async function createPlot(options: CreatePlotOptions): Promise<CreatedPlot> {
  const { projectRoot, plotTitle, synopsis = '', sample = false } = options

  const trimmed = plotTitle.trim()
  if (trimmed.length === 0) {
    throw new Error('Plot title must be a non-empty string')
  }

  const slug = slugify(trimmed)
  if (slug.length === 0) {
    throw new Error('Plot title must contain at least one alphanumeric character')
  }

  const plotDir = path.join(projectRoot, 'plots', slug)

  try {
    await fs.access(plotDir)
    throw new Error(`Plot folder already exists: plots/${slug}`)
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
  }

  await fs.mkdir(plotDir, { recursive: true })

  const createdDirs: string[] = [path.join('plots', slug)]
  for (const sub of PLOT_SUBDIRS) {
    const subDir = path.join(plotDir, sub)
    await fs.mkdir(subDir, { recursive: true })
    createdDirs.push(path.join('plots', slug, sub))
  }

  const cutsPath = resolveCutsPath(projectRoot, slug)
  const cutsFile = buildCutsFile(trimmed, synopsis, sample)
  await writeCutsFile(cutsPath, cutsFile)

  const plotTextPath = path.join(plotDir, 'plot-text.md')
  const plotText = generatePlotText(cutsFile)
  await fs.writeFile(plotTextPath, plotText, 'utf-8')

  return {
    slug,
    plotDir,
    cutsPath,
    dirs: createdDirs
  }
}
