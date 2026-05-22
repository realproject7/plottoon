import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { registerProject, clearRegistry } from '../services/projectRegistry'
import { writeProjectMeta, createProjectMeta } from '../services/projectMeta'
import { writeCutsFile, createEmptyCutsFile } from '../services/cutsSchema'
import {
  writePublishStatus,
  createPublishStatus,
  markPlotPublished,
  markPublishedNotIndexed,
  markPlotFailed
} from '../services/publishStatus'
import type { PublishResultRecord } from '../services/publishStatus'
import { buildDashboardData, type DashboardDeps } from '../services/dashboardData'

let tmpDir: string

function mockResult(overrides?: Partial<PublishResultRecord>): PublishResultRecord {
  return {
    txHash: '0xtx',
    storylineId: '42',
    plotIndex: 0,
    contentCid: 'bafytest',
    contentHash: '0x' + 'bb'.repeat(32),
    authorAddress: '0xauthor',
    gasCostWei: '21000000000000',
    plotlinkUrl: 'https://plotlink.xyz/story/42',
    walletAddress: '0xwallet',
    walletSource: 'plottoon-writer',
    indexed: true,
    indexError: null,
    ...overrides
  }
}

/**
 * Default test wallet used by the dashboard suite. Real wallets never appear
 * in any of these fixtures. `createProject` stamps every test project with
 * this wallet so the wallet-scoped dashboard from #222 includes them.
 */
const DEFAULT_TEST_WALLET = '0xaaaa000000000000000000000000000000000001'

async function createProject(
  name: string,
  walletAddress: string = DEFAULT_TEST_WALLET
): Promise<{ id: string; root: string }> {
  const root = path.join(tmpDir, name)
  await fs.mkdir(root, { recursive: true })
  await writeProjectMeta(
    root,
    createProjectMeta(name, undefined, { address: walletAddress, source: 'plottoon-writer' })
  )
  const id = registerProject(root)
  return { id, root }
}

async function createPlot(
  projectRoot: string,
  plotSlug: string,
  title: string,
  cutCount: number
): Promise<string> {
  const plotDir = path.join(projectRoot, 'plots', plotSlug)
  await fs.mkdir(plotDir, { recursive: true })
  const cutsFile = createEmptyCutsFile(title)
  for (let i = 0; i < cutCount; i++) {
    cutsFile.cuts.push({
      id: `cut-${i}`,
      status: 'draft',
      order: i,
      dialogue: `Line ${i}`,
      direction: 'Panel',
      overlays: [],
      imageState: {
        status: 'pending',
        path: null,
        prompt: null,
        seed: null
      }
    })
  }
  await writeCutsFile(path.join(plotDir, 'cuts.json'), cutsFile)
  return plotDir
}

function baseDeps(overrides?: Partial<DashboardDeps>): DashboardDeps {
  // Default to the test wallet so projects created via `createProject` are
  // visible on the dashboard. Tests that need a no-wallet or different-wallet
  // path override `getWallet` explicitly.
  return {
    getWallet: () => ({
      address: DEFAULT_TEST_WALLET,
      source: 'plottoon-writer',
      name: 'plottoon-writer-test',
      createdAt: '2026-05-22T00:00:00.000Z'
    }),
    ...overrides
  }
}

beforeEach(async () => {
  clearRegistry()
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'plottoon-dashboard-'))
})

afterEach(async () => {
  clearRegistry()
  await fs.rm(tmpDir, { recursive: true, force: true })
})

describe('buildDashboardData — counts', () => {
  it('returns zero counts with no projects', async () => {
    const data = await buildDashboardData(baseDeps())

    expect(data.counts.totalProjects).toBe(0)
    expect(data.counts.totalPlots).toBe(0)
    expect(data.counts.publishedPlots).toBe(0)
    expect(data.counts.pendingPlots).toBe(0)
  })

  it('counts draft plots as pending', async () => {
    const proj = await createProject('my-comic')
    await createPlot(proj.root, 'episode-1', 'Episode 1', 3)

    const data = await buildDashboardData(baseDeps())

    expect(data.counts.totalProjects).toBe(1)
    expect(data.counts.totalPlots).toBe(1)
    expect(data.counts.pendingPlots).toBe(1)
    expect(data.counts.publishedPlots).toBe(0)
  })

  it('counts published and not-indexed plots separately', async () => {
    const proj = await createProject('my-comic')

    const plotDir1 = await createPlot(proj.root, 'ep-1', 'Episode 1', 2)
    let status1 = createPublishStatus(['cut-0', 'cut-1'])
    status1 = markPlotPublished(status1, mockResult())
    await writePublishStatus(plotDir1, status1)

    const plotDir2 = await createPlot(proj.root, 'ep-2', 'Episode 2', 2)
    let status2 = createPublishStatus(['cut-0', 'cut-1'])
    status2 = markPublishedNotIndexed(status2, {
      ...mockResult(),
      indexed: false,
      indexError: 'fail'
    })
    await writePublishStatus(plotDir2, status2)

    const plotDir3 = await createPlot(proj.root, 'ep-3', 'Episode 3', 1)
    let status3 = createPublishStatus(['cut-0'])
    status3 = markPlotFailed(status3, 'tx reverted')
    await writePublishStatus(plotDir3, status3)

    const data = await buildDashboardData(baseDeps())

    expect(data.counts.totalPlots).toBe(3)
    expect(data.counts.publishedPlots).toBe(1)
    expect(data.counts.notIndexedPlots).toBe(1)
    expect(data.counts.failedPlots).toBe(1)
  })
})

describe('buildDashboardData — storyline grouping', () => {
  it('groups published plots by storylineId', async () => {
    const proj = await createProject('my-comic')
    const slId = '42'

    const plotDir1 = await createPlot(proj.root, 'ep-1', 'Episode 1', 2)
    let s1 = createPublishStatus([])
    s1 = markPlotPublished(s1, mockResult({ storylineId: slId, plotIndex: 0 }))
    await writePublishStatus(plotDir1, s1)

    const plotDir2 = await createPlot(proj.root, 'ep-2', 'Episode 2', 2)
    let s2 = createPublishStatus([])
    s2 = markPlotPublished(s2, mockResult({ storylineId: slId, plotIndex: 1 }))
    await writePublishStatus(plotDir2, s2)

    const data = await buildDashboardData(baseDeps())

    expect(data.storylines).toHaveLength(1)
    expect(data.storylines[0].storylineId).toBe(slId)
    expect(data.storylines[0].plots).toHaveLength(2)
    expect(data.storylines[0].publishedCount).toBe(2)
    expect(data.storylines[0].plots[0].publishResult!.plotIndex).toBe(0)
    expect(data.storylines[0].plots[1].publishResult!.plotIndex).toBe(1)
    expect(data.localGroups).toHaveLength(0)
  })

  it('groups plots without storylineId by project', async () => {
    const proj = await createProject('my-comic')
    await createPlot(proj.root, 'ep-1', 'Episode 1', 2)
    await createPlot(proj.root, 'ep-2', 'Episode 2', 1)

    const data = await buildDashboardData(baseDeps())

    expect(data.storylines).toHaveLength(0)
    expect(data.localGroups).toHaveLength(1)
    expect(data.localGroups[0].projectName).toBe('my-comic')
    expect(data.localGroups[0].plots).toHaveLength(2)
  })

  it('separates local groups by project', async () => {
    const proj1 = await createProject('comic-a')
    const proj2 = await createProject('comic-b')
    await createPlot(proj1.root, 'ep-1', 'Episode 1', 1)
    await createPlot(proj2.root, 'ep-1', 'Episode 1', 1)

    const data = await buildDashboardData(baseDeps())

    expect(data.localGroups).toHaveLength(2)
    const names = data.localGroups.map((g) => g.projectName).sort()
    expect(names).toEqual(['comic-a', 'comic-b'])
  })

  it('computes total gas cost per storyline', async () => {
    const proj = await createProject('my-comic')
    const slId = '99'

    const plotDir1 = await createPlot(proj.root, 'ep-1', 'Ep1', 1)
    let s1 = createPublishStatus([])
    s1 = markPlotPublished(s1, mockResult({ storylineId: slId, gasCostWei: '10000' }))
    await writePublishStatus(plotDir1, s1)

    const plotDir2 = await createPlot(proj.root, 'ep-2', 'Ep2', 1)
    let s2 = createPublishStatus([])
    s2 = markPlotPublished(s2, mockResult({ storylineId: slId, gasCostWei: '25000' }))
    await writePublishStatus(plotDir2, s2)

    const data = await buildDashboardData(baseDeps())

    expect(data.storylines[0].totalPublishCostWei).toBe('35000')
  })
})

describe('buildDashboardData — wallet', () => {
  it('returns disconnected wallet when none connected', async () => {
    const data = await buildDashboardData(baseDeps({ getWallet: () => null }))

    expect(data.wallet.connected).toBe(false)
    expect(data.wallet.address).toBeNull()
    expect(data.wallet.balanceWei).toBeNull()
  })

  it('returns wallet info when connected', async () => {
    const deps = baseDeps({
      getWallet: () => ({
        address: '0xmywallet',
        source: 'plottoon-writer',
        name: 'pw-1',
        createdAt: '2026-05-18T00:00:00Z'
      })
    })
    const data = await buildDashboardData(deps)

    expect(data.wallet.connected).toBe(true)
    expect(data.wallet.address).toBe('0xmywallet')
    expect(data.wallet.source).toBe('plottoon-writer')
  })

  it('fetches wallet balance when available', async () => {
    const deps = baseDeps({
      getWallet: () => ({
        address: '0xmywallet',
        source: 'plottoon-writer',
        name: 'pw-1',
        createdAt: '2026-05-18T00:00:00Z'
      }),
      fetchBalance: async () => '1000000000000000000'
    })
    const data = await buildDashboardData(deps)

    expect(data.wallet.balanceWei).toBe('1000000000000000000')
    expect(data.wallet.balanceError).toBeNull()
  })

  it('degrades gracefully when balance fetch fails', async () => {
    const deps = baseDeps({
      getWallet: () => ({
        address: '0xmywallet',
        source: 'plottoon-writer',
        name: 'pw-1',
        createdAt: '2026-05-18T00:00:00Z'
      }),
      fetchBalance: async () => {
        throw new Error('RPC timeout')
      }
    })
    const data = await buildDashboardData(deps)

    expect(data.wallet.balanceWei).toBeNull()
    expect(data.wallet.balanceError).toBe('RPC timeout')
  })
})

describe('buildDashboardData — token price', () => {
  it('returns null price when no fetcher provided', async () => {
    const data = await buildDashboardData(baseDeps())

    expect(data.tokenPrice.ethUsd).toBeNull()
    expect(data.tokenPrice.error).toBeNull()
  })

  it('fetches ETH/USD price when available', async () => {
    const deps = baseDeps({
      fetchEthPrice: async () => 3500.42
    })
    const data = await buildDashboardData(deps)

    expect(data.tokenPrice.ethUsd).toBe(3500.42)
    expect(data.tokenPrice.error).toBeNull()
  })

  it('degrades gracefully when price fetch fails', async () => {
    const deps = baseDeps({
      fetchEthPrice: async () => {
        throw new Error('API rate limited')
      }
    })
    const data = await buildDashboardData(deps)

    expect(data.tokenPrice.ethUsd).toBeNull()
    expect(data.tokenPrice.error).toBe('API rate limited')
  })
})

describe('buildDashboardData — royalty', () => {
  it('returns null royalty when no wallet', async () => {
    const data = await buildDashboardData(baseDeps())

    expect(data.royalty.earnedWei).toBeNull()
    expect(data.royalty.error).toBeNull()
  })

  it('fetches royalty when wallet is connected', async () => {
    const deps = baseDeps({
      getWallet: () => ({
        address: '0xmywallet',
        source: 'plottoon-writer',
        name: 'pw-1',
        createdAt: '2026-05-18T00:00:00Z'
      }),
      fetchRoyalty: async () => ({
        earnedWei: '500000',
        claimedWei: '100000',
        unclaimedWei: '400000'
      })
    })
    const data = await buildDashboardData(deps)

    expect(data.royalty.earnedWei).toBe('500000')
    expect(data.royalty.claimedWei).toBe('100000')
    expect(data.royalty.unclaimedWei).toBe('400000')
    expect(data.royalty.error).toBeNull()
  })

  it('degrades gracefully when royalty fetch fails', async () => {
    const deps = baseDeps({
      getWallet: () => ({
        address: '0xmywallet',
        source: 'plottoon-writer',
        name: 'pw-1',
        createdAt: '2026-05-18T00:00:00Z'
      }),
      fetchRoyalty: async () => {
        throw new Error('RPC timeout')
      }
    })
    const data = await buildDashboardData(deps)

    expect(data.royalty.earnedWei).toBeNull()
    expect(data.royalty.error).toBe('RPC timeout')
  })
})

describe('buildDashboardData — graceful degradation', () => {
  it('handles project with no plots directory', async () => {
    await createProject('empty-project')

    const data = await buildDashboardData(baseDeps())

    expect(data.counts.totalProjects).toBe(1)
    expect(data.counts.totalPlots).toBe(0)
  })

  it('skips plot directories without cuts.json', async () => {
    const proj = await createProject('my-comic')
    await fs.mkdir(path.join(proj.root, 'plots', 'empty-plot'), { recursive: true })
    await createPlot(proj.root, 'valid-plot', 'Valid', 2)

    const data = await buildDashboardData(baseDeps())

    expect(data.counts.totalPlots).toBe(1)
    expect(data.localGroups[0].plots[0].plotSlug).toBe('valid-plot')
  })

  it('includes generatedAt timestamp', async () => {
    const data = await buildDashboardData(baseDeps())

    expect(data.generatedAt).toBeTruthy()
    expect(new Date(data.generatedAt).getTime()).toBeGreaterThan(0)
  })
})

describe('buildDashboardData — wallet scoping (#222)', () => {
  const WALLET_B = '0xbbbb000000000000000000000000000000000002'

  function depsForWallet(address: string | null): DashboardDeps {
    return baseDeps({
      getWallet:
        address === null
          ? () => null
          : () => ({
              address,
              source: 'plottoon-writer',
              name: 'plottoon-writer-fake',
              createdAt: '2026-05-22T00:00:00.000Z'
            })
    })
  }

  it('only counts and surfaces projects whose meta.wallet matches the active wallet', async () => {
    const projA = await createProject('wallet-a-story', DEFAULT_TEST_WALLET)
    await createPlot(projA.root, 'episode-1', 'A1', 2)
    const projB = await createProject('wallet-b-story', WALLET_B)
    await createPlot(projB.root, 'episode-1', 'B1', 4)

    const fromA = await buildDashboardData(depsForWallet(DEFAULT_TEST_WALLET))
    expect(fromA.counts.totalProjects).toBe(1)
    expect(fromA.counts.totalPlots).toBe(1)
    expect(fromA.localGroups.map((g) => g.projectName)).toEqual(['wallet-a-story'])

    const fromB = await buildDashboardData(depsForWallet(WALLET_B))
    expect(fromB.counts.totalProjects).toBe(1)
    expect(fromB.counts.totalPlots).toBe(1)
    expect(fromB.localGroups.map((g) => g.projectName)).toEqual(['wallet-b-story'])
  })

  it('hides legacy (unstamped) projects from the active wallet’s dashboard', async () => {
    const legacyRoot = path.join(tmpDir, 'legacy-story')
    await fs.mkdir(legacyRoot, { recursive: true })
    await writeProjectMeta(legacyRoot, createProjectMeta('Legacy Story'))
    registerProject(legacyRoot)
    await createPlot(legacyRoot, 'ep1', 'L1', 3)

    const data = await buildDashboardData(depsForWallet(DEFAULT_TEST_WALLET))
    expect(data.counts.totalProjects).toBe(0)
    expect(data.counts.totalPlots).toBe(0)
  })

  it('returns empty counts when there is no active wallet', async () => {
    const proj = await createProject('wallet-a-story', DEFAULT_TEST_WALLET)
    await createPlot(proj.root, 'episode-1', 'A1', 2)

    const data = await buildDashboardData(depsForWallet(null))
    expect(data.counts.totalProjects).toBe(0)
    expect(data.counts.totalPlots).toBe(0)
    expect(data.wallet.connected).toBe(false)
  })

  it('normalizes wallet address case when matching against stamped projects', async () => {
    await createProject('mixed-case-story', DEFAULT_TEST_WALLET.toUpperCase())
    const data = await buildDashboardData(depsForWallet(DEFAULT_TEST_WALLET))
    expect(data.counts.totalProjects).toBe(1)
  })

  it('only queries balance/royalty for the active wallet', async () => {
    const balances: string[] = []
    const royaltyAddresses: string[] = []
    const deps: DashboardDeps = baseDeps({
      getWallet: () => ({
        address: DEFAULT_TEST_WALLET,
        source: 'plottoon-writer',
        name: 'plottoon-writer-fake',
        createdAt: '2026-05-22T00:00:00.000Z'
      }),
      fetchBalance: async (addr) => {
        balances.push(addr)
        return '1000000000000000000'
      },
      fetchRoyalty: async (addr) => {
        royaltyAddresses.push(addr)
        return { earnedWei: '1', claimedWei: '0', unclaimedWei: '1' }
      }
    })
    const data = await buildDashboardData(deps)
    expect(balances).toEqual([DEFAULT_TEST_WALLET])
    expect(royaltyAddresses).toEqual([DEFAULT_TEST_WALLET])
    expect(data.wallet.balanceWei).toBe('1000000000000000000')
    expect(data.royalty.unclaimedWei).toBe('1')
  })
})
