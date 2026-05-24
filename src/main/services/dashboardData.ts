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
import { normalizeWalletAddress } from '../../shared/walletIdentity'

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
  totalPublishCostWei: string
}

export interface DashboardCounts {
  totalProjects: number
  totalPlots: number
  publishedPlots: number
  pendingPlots: number
  notIndexedPlots: number
  failedPlots: number
  /** #249: aggregate gas cost across every published plot for the active wallet. */
  totalPublishCostWei: string
}

export interface WalletSummary {
  address: string | null
  source: string | null
  connected: boolean
  balanceWei: string | null
  balanceError: string | null
  /**
   * #249: USDC (6 decimals on Base) — raw `uint256` wei string.
   * `null` when no wallet is connected or the balance lookup is not
   * wired (mock environment). Renderer formats for display.
   */
  usdcBalanceWei: string | null
  usdcBalanceError: string | null
  /** #249: PLOT (18 decimals on Base) — raw `uint256` wei string. */
  plotBalanceWei: string | null
  plotBalanceError: string | null
}

export interface TokenPrice {
  ethUsd: number | null
  /** #249: best-effort PLOT/USD; null when the helper isn't configured. */
  plotUsd: number | null
  error: string | null
}

export interface RoyaltySummary {
  earnedWei: string | null
  claimedWei: string | null
  unclaimedWei: string | null
  error: string | null
}

export interface PnlSummary {
  /** Total publish gas across the active wallet's plots, in USD. */
  totalGasUsd: number | null
  /** Total royalties earned for the active wallet, in USD. */
  totalRoyaltyUsd: number | null
  /** royalty USD − gas USD. `null` when any input is missing. */
  netUsd: number | null
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
  pnl: PnlSummary
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
  /** Native ETH balance on Base. Already wired prior to #249. */
  fetchBalance?: BalanceFetchFn
  /** #249: USDC (6 decimals) balance on Base — same shape as ETH. */
  fetchUsdcBalance?: BalanceFetchFn
  /** #249: PLOT (18 decimals) balance on Base. */
  fetchPlotBalance?: BalanceFetchFn
  fetchEthPrice?: PriceFetchFn
  /** #249: best-effort PLOT/USD price. */
  fetchPlotPrice?: PriceFetchFn
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

function addPublishCost(
  totalWei: bigint,
  publishResult: { totalCostWei?: string | null; gasCostWei?: string | null } | null | undefined
): bigint {
  const costWei = publishResult?.totalCostWei ?? publishResult?.gasCostWei
  if (!costWei) return totalWei
  try {
    return totalWei + BigInt(costWei)
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
      totalGas = addPublishCost(totalGas, p.publishResult)
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
      totalPublishCostWei: totalGas.toString()
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

function sumPublishCost(entries: PlotDashboardEntry[]): bigint {
  let total = BigInt(0)
  for (const e of entries) total = addPublishCost(total, e.publishResult)
  return total
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
    failedPlots,
    totalPublishCostWei: sumPublishCost(entries).toString()
  }
}

export async function buildDashboardData(deps: DashboardDeps): Promise<DashboardData> {
  const wallet = deps.getWallet()
  // Dashboard is wallet-scoped (#222). With no active wallet, the renderer
  // shows a "no wallet" empty state; we still return the wallet/price/royalty
  // snapshot so the screen renders cleanly. Project / plot counts read as
  // zero because the active wallet has no owned projects.
  const activeAddress = wallet ? normalizeWalletAddress(wallet.address) : null

  const allProjects = listProjects()
  const ownedProjects: Array<{ id: string; root: string; name: string }> = []
  const allEntries: PlotDashboardEntry[] = []

  for (const project of allProjects) {
    let projectName = project.id
    let projectMeta: ProjectMeta | null = null
    try {
      projectMeta = await readProjectMeta(project.root)
      projectName = projectMeta.name
    } catch {
      // use project id as fallback name
    }

    // Wallet-scope filter: a project is visible on the dashboard only when
    // its `meta.wallet.address` matches the active wallet. Projects with no
    // wallet stamp (legacy) and projects owned by other wallets are both
    // excluded — they show up in their own buckets on the Projects screen
    // (per #220) but must not pollute the active wallet's dashboard stats.
    const projectAddress = projectMeta?.wallet?.address ?? null
    if (!activeAddress || projectAddress !== activeAddress) continue
    ownedProjects.push({ id: project.id, root: project.root, name: projectName })

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
  const counts = computeCounts(allEntries, ownedProjects.length)

  const walletSummary: WalletSummary = {
    address: wallet?.address ?? null,
    source: wallet?.source ?? null,
    connected: wallet !== null,
    balanceWei: null,
    balanceError: null,
    usdcBalanceWei: null,
    usdcBalanceError: null,
    plotBalanceWei: null,
    plotBalanceError: null
  }

  if (wallet && deps.fetchBalance) {
    try {
      walletSummary.balanceWei = await deps.fetchBalance(wallet.address)
    } catch (err) {
      walletSummary.balanceError = err instanceof Error ? err.message : 'Failed to fetch balance'
    }
  }
  if (wallet && deps.fetchUsdcBalance) {
    try {
      walletSummary.usdcBalanceWei = await deps.fetchUsdcBalance(wallet.address)
    } catch (err) {
      walletSummary.usdcBalanceError =
        err instanceof Error ? err.message : 'Failed to fetch USDC balance'
    }
  }
  if (wallet && deps.fetchPlotBalance) {
    try {
      walletSummary.plotBalanceWei = await deps.fetchPlotBalance(wallet.address)
    } catch (err) {
      walletSummary.plotBalanceError =
        err instanceof Error ? err.message : 'Failed to fetch PLOT balance'
    }
  }

  const tokenPrice: TokenPrice = { ethUsd: null, plotUsd: null, error: null }
  if (deps.fetchEthPrice) {
    try {
      tokenPrice.ethUsd = await deps.fetchEthPrice()
    } catch (err) {
      tokenPrice.error = err instanceof Error ? err.message : 'Failed to fetch price'
    }
  }
  if (deps.fetchPlotPrice) {
    try {
      tokenPrice.plotUsd = await deps.fetchPlotPrice()
    } catch (err) {
      // Don't overwrite ethUsd error — best-effort surface.
      if (!tokenPrice.error) {
        tokenPrice.error = err instanceof Error ? err.message : 'Failed to fetch PLOT price'
      }
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

  // #249: best-effort PnL summary in USD. Each leg renders only when its
  // inputs are available; the renderer hides the row when `netUsd` is
  // null. PLOT is 18 decimals (matches royalty units); ETH is 18 decimals
  // (gas costs are wei). Match plotlink-ows pattern: zero-on-failure
  // never raises; the rest of the dashboard always renders.
  const totalGasUsd =
    tokenPrice.ethUsd !== null
      ? weiToTokenAmount(counts.totalPublishCostWei, 18) * tokenPrice.ethUsd
      : null
  const totalRoyaltyUsd =
    tokenPrice.plotUsd !== null && royalty.earnedWei !== null
      ? weiToTokenAmount(royalty.earnedWei, 18) * tokenPrice.plotUsd
      : null
  const pnl: PnlSummary = {
    totalGasUsd,
    totalRoyaltyUsd,
    netUsd: totalGasUsd !== null && totalRoyaltyUsd !== null ? totalRoyaltyUsd - totalGasUsd : null
  }

  return {
    counts,
    storylines,
    localGroups,
    wallet: walletSummary,
    tokenPrice,
    royalty,
    pnl,
    generatedAt: new Date().toISOString()
  }
}

/**
 * Convert a raw uint256 wei string into a human-scale token amount as a
 * `number`. Precision loss above ~15 digits is acceptable here because
 * the result feeds USD math, not on-chain calls. The renderer never
 * displays the result of this conversion directly — it always re-derives
 * from the wei string.
 */
function weiToTokenAmount(wei: string, decimals: number): number {
  try {
    const n = BigInt(wei)
    return Number(n) / Math.pow(10, decimals)
  } catch {
    return 0
  }
}
