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
  balanceWei: string | null
  balanceError: string | null
}

export interface TokenPrice {
  ethUsd: number | null
  error: string | null
}

export interface RoyaltySummary {
  earnedWei: string | null
  claimedWei: string | null
  unclaimedWei: string | null
  error: string | null
}

export interface LocalGroup {
  groupKey: string
  projectId: string
  projectName: string
  plots: PlotDashboardEntry[]
}

export interface DashboardData {
  counts: DashboardCounts
  storylines: StorylineGroup[]
  localGroups: LocalGroup[]
  wallet: WalletSummary
  tokenPrice: TokenPrice
  royalty: RoyaltySummary
  generatedAt: string
}

export type RoyaltyFetchFn = (
  walletAddress: string
) => Promise<{ earnedWei: string; claimedWei: string; unclaimedWei: string }>

export type BalanceFetchFn = (walletAddress: string) => Promise<string>

export type PriceFetchFn = () => Promise<number>

export interface DashboardDeps {
  getWallet: () => WalletMetadata | null
  fetchRoyalty?: RoyaltyFetchFn
  fetchBalance?: BalanceFetchFn
  fetchEthPrice?: PriceFetchFn
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
  localGroups: LocalGroup[]
} {
  const grouped = new Map<string, PlotDashboardEntry[]>()
  const localMap = new Map<string, PlotDashboardEntry[]>()

  for (const entry of entries) {
    const storylineId = entry.publishResult?.storylineId
    if (storylineId) {
      const list = grouped.get(storylineId) ?? []
      list.push(entry)
      grouped.set(storylineId, list)
    } else {
      const key = `${entry.projectId}:${entry.projectName}`
      const list = localMap.get(key) ?? []
      list.push(entry)
      localMap.set(key, list)
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

  const localGroups: LocalGroup[] = []
  for (const [key, plots] of localMap) {
    localGroups.push({
      groupKey: key,
      projectId: plots[0].projectId,
      projectName: plots[0].projectName,
      plots
    })
  }

  return { storylines, localGroups }
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

  const { storylines, localGroups } = groupByStoryline(allEntries)
  const counts = computeCounts(allEntries, projects.length)

  const wallet = deps.getWallet()
  const walletSummary: WalletSummary = {
    address: wallet?.address ?? null,
    source: wallet?.source ?? null,
    connected: wallet !== null,
    balanceWei: null,
    balanceError: null
  }

  if (wallet && deps.fetchBalance) {
    try {
      walletSummary.balanceWei = await deps.fetchBalance(wallet.address)
    } catch (err) {
      walletSummary.balanceError = err instanceof Error ? err.message : 'Failed to fetch balance'
    }
  }

  const tokenPrice: TokenPrice = { ethUsd: null, error: null }
  if (deps.fetchEthPrice) {
    try {
      tokenPrice.ethUsd = await deps.fetchEthPrice()
    } catch (err) {
      tokenPrice.error = err instanceof Error ? err.message : 'Failed to fetch price'
    }
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
    localGroups,
    wallet: walletSummary,
    tokenPrice,
    royalty,
    generatedAt: new Date().toISOString()
  }
}
