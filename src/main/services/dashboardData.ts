import { listProjects } from './projectRegistry'
import { listProjectDir, projectFileExists, resolveProjectFilePath } from './fsService'
import { readProjectMeta, type ProjectMeta } from './projectMeta'
import {
  readPublishStatus,
  type PublishStatusFile,
  type PublishResultRecord
} from './publishStatus'
import { readCutsFile } from './cutsSchema'
import type { WalletMetadata } from './walletConnection'

export interface PlotDashboardEntry {
  projectId: string
  projectName: string
  plotSlug: string
  plotTitle: string
  cutCount: number
  plotState: string
  publishedAt: string | null
  publishResult: PublishResultRecord | null
}

export interface StorylineGroup {
  storylineId: string
  projectId: string
  projectName: string
  plots: PlotDashboardEntry[]
  publishedCount: number
  notIndexedCount: number
  latestPublishedAt: string | null
  totalGasCostWei: string
}

export interface DashboardCounts {
  totalProjects: number
  totalPlots: number
  publishedPlots: number
  pendingPlots: number
  notIndexedPlots: number
  failedPlots: number
}

export interface WalletSummary {
  address: string | null
  source: string | null
  connected: boolean
}

export interface RoyaltySummary {
  earnedWei: string | null
  claimedWei: string | null
  unclaimedWei: string | null
  error: string | null
}

export interface DashboardData {
  counts: DashboardCounts
  storylines: StorylineGroup[]
  ungrouped: PlotDashboardEntry[]
  wallet: WalletSummary
  royalty: RoyaltySummary
  generatedAt: string
}

export type RoyaltyFetchFn = (
  walletAddress: string
) => Promise<{ earnedWei: string; claimedWei: string; unclaimedWei: string }>

export interface DashboardDeps {
  getWallet: () => WalletMetadata | null
  fetchRoyalty?: RoyaltyFetchFn
}

async function loadPlotEntry(
  projectId: string,
  projectName: string,
  plotSlug: string
): Promise<PlotDashboardEntry> {
  let plotTitle = plotSlug
  let cutCount = 0
  try {
    const cutsPath = resolveProjectFilePath(projectId, 'plots', plotSlug, 'cuts.json')
    const cutsFile = await readCutsFile(cutsPath)
    plotTitle = cutsFile.plotTitle || plotSlug
    cutCount = cutsFile.cuts.length
  } catch {
    // cuts.json may not exist for empty plots
  }

  let plotState = 'draft'
  let publishedAt: string | null = null
  let publishResult: PublishResultRecord | null = null
  try {
    const plotDir = resolveProjectFilePath(projectId, 'plots', plotSlug)
    const status: PublishStatusFile = await readPublishStatus(plotDir)
    plotState = status.plotState
    publishedAt = status.publishedAt
    publishResult = status.publishResult
  } catch {
    // no publish status — treat as draft
  }

  return {
    projectId,
    projectName,
    plotSlug,
    plotTitle,
    cutCount,
    plotState,
    publishedAt,
    publishResult
  }
}

function addGasCost(totalWei: bigint, gasCostWei: string | null): bigint {
  if (!gasCostWei) return totalWei
  try {
    return totalWei + BigInt(gasCostWei)
  } catch {
    return totalWei
  }
}

function groupByStoryline(entries: PlotDashboardEntry[]): {
  storylines: StorylineGroup[]
  ungrouped: PlotDashboardEntry[]
} {
  const grouped = new Map<string, PlotDashboardEntry[]>()
  const ungrouped: PlotDashboardEntry[] = []

  for (const entry of entries) {
    const storylineId = entry.publishResult?.storylineId
    if (storylineId) {
      const list = grouped.get(storylineId) ?? []
      list.push(entry)
      grouped.set(storylineId, list)
    } else {
      ungrouped.push(entry)
    }
  }

  const storylines: StorylineGroup[] = []
  for (const [storylineId, plots] of grouped) {
    let publishedCount = 0
    let notIndexedCount = 0
    let latestPublishedAt: string | null = null
    let totalGas = BigInt(0)

    for (const p of plots) {
      if (p.plotState === 'published') publishedCount++
      if (p.plotState === 'published-not-indexed') notIndexedCount++
      if (p.publishedAt) {
        if (!latestPublishedAt || p.publishedAt > latestPublishedAt) {
          latestPublishedAt = p.publishedAt
        }
      }
      totalGas = addGasCost(totalGas, p.publishResult?.gasCostWei ?? null)
    }

    plots.sort((a, b) => (a.publishResult?.plotIndex ?? 0) - (b.publishResult?.plotIndex ?? 0))

    storylines.push({
      storylineId,
      projectId: plots[0].projectId,
      projectName: plots[0].projectName,
      plots,
      publishedCount,
      notIndexedCount,
      latestPublishedAt,
      totalGasCostWei: totalGas.toString()
    })
  }

  return { storylines, ungrouped }
}

function computeCounts(entries: PlotDashboardEntry[], projectCount: number): DashboardCounts {
  let publishedPlots = 0
  let pendingPlots = 0
  let notIndexedPlots = 0
  let failedPlots = 0

  for (const e of entries) {
    switch (e.plotState) {
      case 'published':
        publishedPlots++
        break
      case 'published-not-indexed':
        notIndexedPlots++
        break
      case 'failed':
        failedPlots++
        break
      case 'draft':
      case 'ready':
      case 'publishing':
        pendingPlots++
        break
    }
  }

  return {
    totalProjects: projectCount,
    totalPlots: entries.length,
    publishedPlots,
    pendingPlots,
    notIndexedPlots,
    failedPlots
  }
}

export async function buildDashboardData(deps: DashboardDeps): Promise<DashboardData> {
  const projects = listProjects()
  const allEntries: PlotDashboardEntry[] = []

  for (const project of projects) {
    let projectName = project.id
    try {
      const meta: ProjectMeta = await readProjectMeta(project.root)
      projectName = meta.name
    } catch {
      // use project id as fallback name
    }

    let plotSlugs: string[] = []
    try {
      const hasPlots = await projectFileExists(project.id, 'plots')
      if (hasPlots) {
        plotSlugs = await listProjectDir(project.id, 'plots')
      }
    } catch {
      // no plots directory
    }

    for (const slug of plotSlugs) {
      const hasCuts = await projectFileExists(project.id, 'plots', slug, 'cuts.json')
      if (!hasCuts) continue
      const entry = await loadPlotEntry(project.id, projectName, slug)
      allEntries.push(entry)
    }
  }

  const { storylines, ungrouped } = groupByStoryline(allEntries)
  const counts = computeCounts(allEntries, projects.length)

  const wallet = deps.getWallet()
  const walletSummary: WalletSummary = {
    address: wallet?.address ?? null,
    source: wallet?.source ?? null,
    connected: wallet !== null
  }

  let royalty: RoyaltySummary = {
    earnedWei: null,
    claimedWei: null,
    unclaimedWei: null,
    error: null
  }

  if (wallet && deps.fetchRoyalty) {
    try {
      const r = await deps.fetchRoyalty(wallet.address)
      royalty = {
        earnedWei: r.earnedWei,
        claimedWei: r.claimedWei,
        unclaimedWei: r.unclaimedWei,
        error: null
      }
    } catch (err) {
      royalty.error = err instanceof Error ? err.message : 'Failed to fetch royalty data'
    }
  }

  return {
    counts,
    storylines,
    ungrouped,
    wallet: walletSummary,
    royalty,
    generatedAt: new Date().toISOString()
  }
}
