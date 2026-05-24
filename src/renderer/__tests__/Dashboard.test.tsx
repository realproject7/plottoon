// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { Dashboard } from '../Dashboard'
import { WALLET_ACTIVE_CHANGED_EVENT as WALLET_ACTIVE_CHANGED_EVENT_FOR_TESTS } from '../../shared/walletIdentity'

function emptyDashboard(): DashboardData {
  return {
    counts: {
      totalProjects: 0,
      totalPlots: 0,
      publishedPlots: 0,
      pendingPlots: 0,
      notIndexedPlots: 0,
      failedPlots: 0,
      totalPublishCostWei: '0'
    },
    storylines: [],
    localGroups: [],
    wallet: {
      address: null,
      source: null,
      connected: false,
      balanceWei: null,
      balanceError: null,
      usdcBalanceWei: null,
      usdcBalanceError: null,
      plotBalanceWei: null,
      plotBalanceError: null
    },
    tokenPrice: { ethUsd: null, plotUsd: null, error: null },
    royalty: { earnedWei: null, claimedWei: null, unclaimedWei: null, error: null },
    pnl: { totalGasUsd: null, totalRoyaltyUsd: null, netUsd: null },
    generatedAt: '2026-05-18T12:00:00Z'
  }
}

const mockGetData = vi.fn<() => Promise<DashboardData>>()
const mockGetInfo = vi.fn<() => Promise<RoyaltyInfoResult>>()
const mockClaim = vi.fn<(confirmed: boolean) => Promise<RoyaltyClaimResult>>()

beforeEach(() => {
  mockGetData.mockResolvedValue(emptyDashboard())
  mockGetInfo.mockResolvedValue({ info: null, error: null })
  mockClaim.mockResolvedValue({ success: false, error: 'Not configured' })
  window.plottoon = {
    dashboard: { getData: mockGetData },
    royalty: {
      getInfo: mockGetInfo,
      claim: mockClaim,
      getClaimHistory: vi.fn().mockResolvedValue({ claims: [] }),
      onProgress: vi.fn().mockReturnValue(() => {})
    }
  } as unknown as typeof window.plottoon
})

afterEach(cleanup)

describe('Dashboard', () => {
  it('shows loading state initially', () => {
    mockGetData.mockReturnValue(new Promise(() => {}))
    render(<Dashboard />)
    expect(screen.getByText(/Loading dashboard/)).toBeDefined()
  })

  it('renders empty state when no plots', async () => {
    render(<Dashboard />)
    await waitFor(() => {
      expect(screen.getByText(/No plots yet/)).toBeDefined()
    })
  })

  it('renders stat cards with counts', async () => {
    mockGetData.mockResolvedValue({
      ...emptyDashboard(),
      counts: {
        totalProjects: 3,
        totalPlots: 12,
        publishedPlots: 5,
        pendingPlots: 4,
        notIndexedPlots: 2,
        failedPlots: 1,
        totalPublishCostWei: '0'
      }
    })
    render(<Dashboard />)
    await waitFor(() => {
      expect(screen.getByText('3')).toBeDefined()
      expect(screen.getByText('12')).toBeDefined()
      expect(screen.getByText('5')).toBeDefined()
      expect(screen.getByText('4')).toBeDefined()
      expect(screen.getByText('2')).toBeDefined()
      expect(screen.getByText('1')).toBeDefined()
    })
  })

  it('renders storyline groups with plot rows', async () => {
    const slId = '0x' + 'aa'.repeat(32)
    mockGetData.mockResolvedValue({
      ...emptyDashboard(),
      counts: {
        totalProjects: 1,
        totalPlots: 2,
        publishedPlots: 2,
        pendingPlots: 0,
        notIndexedPlots: 0,
        failedPlots: 0,
        totalPublishCostWei: '0'
      },
      storylines: [
        {
          storylineId: slId,
          projectId: 'proj-1',
          projectName: 'My Comic',
          plots: [
            {
              projectId: 'proj-1',
              projectName: 'My Comic',
              plotSlug: 'ep-1',
              plotTitle: 'Episode 1',
              cutCount: 3,
              plotState: 'published',
              publishedAt: '2026-05-17T10:00:00Z',
              publishResult: {
                txHash: '0xtx1',
                storylineId: slId,
                plotIndex: 0,
                contentCid: 'bafytest',
                contentHash: '0xhash',
                authorAddress: '0xauthor',
                gasCostWei: '21000000000000',
                plotlinkUrl: 'https://plotlink.xyz/story/' + slId,
                walletAddress: '0xwallet',
                walletSource: 'plottoon-writer',
                indexed: true,
                indexError: null
              }
            },
            {
              projectId: 'proj-1',
              projectName: 'My Comic',
              plotSlug: 'ep-2',
              plotTitle: 'Episode 2',
              cutCount: 2,
              plotState: 'published',
              publishedAt: '2026-05-18T10:00:00Z',
              publishResult: {
                txHash: '0xtx2',
                storylineId: slId,
                plotIndex: 1,
                contentCid: 'bafytest2',
                contentHash: '0xhash2',
                authorAddress: '0xauthor',
                gasCostWei: '10000000000000',
                plotlinkUrl: 'https://plotlink.xyz/story/' + slId + '/1',
                walletAddress: '0xwallet',
                walletSource: 'plottoon-writer',
                indexed: true,
                indexError: null
              }
            }
          ],
          publishedCount: 2,
          notIndexedCount: 0,
          latestPublishedAt: '2026-05-18T10:00:00Z',
          totalPublishCostWei: '31000000000000'
        }
      ]
    })
    render(<Dashboard />)
    await waitFor(() => {
      expect(screen.getByText('Published storylines')).toBeDefined()
      // After #251 the project name + plot titles also surface inside the
      // Activity feed for the same publishes — assert at-least-one
      // occurrence so the storyline section AND the activity feed both
      // count as valid renders.
      expect(screen.getAllByText('My Comic').length).toBeGreaterThanOrEqual(1)
      expect(screen.getAllByText('Episode 1').length).toBeGreaterThanOrEqual(1)
      expect(screen.getAllByText('Episode 2').length).toBeGreaterThanOrEqual(1)
      expect(screen.getByText('3 cuts')).toBeDefined()
      expect(screen.getByText('2 cuts')).toBeDefined()
      // Storyline row Tx links remain; activity feed also has Tx links so
      // assert at least 2 (the storyline ones we care about).
      const txLinks = screen.getAllByText('Tx')
      expect(txLinks.length).toBeGreaterThanOrEqual(2)
      const storyTxs = txLinks.filter((a) =>
        (a.closest('a') as HTMLAnchorElement | null)?.href.includes('basescan.org/tx/0xtx1')
      )
      expect(storyTxs.length).toBeGreaterThanOrEqual(1)
    })
  })

  it('renders local groups for unpublished plots', async () => {
    mockGetData.mockResolvedValue({
      ...emptyDashboard(),
      counts: {
        totalProjects: 1,
        totalPlots: 1,
        publishedPlots: 0,
        pendingPlots: 1,
        notIndexedPlots: 0,
        failedPlots: 0,
        totalPublishCostWei: '0'
      },
      localGroups: [
        {
          groupKey: 'proj-1:Draft Comic',
          projectId: 'proj-1',
          projectName: 'Draft Comic',
          plots: [
            {
              projectId: 'proj-1',
              projectName: 'Draft Comic',
              plotSlug: 'ch-1',
              plotTitle: 'Chapter 1',
              cutCount: 5,
              plotState: 'draft',
              publishedAt: null,
              publishResult: null
            }
          ]
        }
      ]
    })
    render(<Dashboard />)
    await waitFor(() => {
      expect(screen.getByText('Local production')).toBeDefined()
      expect(screen.getByText('Draft Comic')).toBeDefined()
      expect(screen.getByText('Chapter 1')).toBeDefined()
      expect(screen.getByText('5 cuts')).toBeDefined()
    })
  })

  it('shows wallet info when connected', async () => {
    mockGetData.mockResolvedValue({
      ...emptyDashboard(),
      wallet: {
        address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
        source: 'plottoon-writer',
        connected: true,
        balanceWei: '1000000000000000000',
        balanceError: null,
        usdcBalanceWei: null,
        usdcBalanceError: null,
        plotBalanceWei: null,
        plotBalanceError: null
      }
    })
    render(<Dashboard />)
    await waitFor(() => {
      // Source label is `plottoon` (short form rendered by sourceLabel()).
      expect(screen.getAllByText(/plottoon/i).length).toBeGreaterThan(0)
      expect(screen.getByText('1.0000 ETH')).toBeDefined()
    })
  })

  it('shows wallet disconnected state', async () => {
    render(<Dashboard />)
    await waitFor(() => {
      expect(screen.getByText('Not connected')).toBeDefined()
    })
  })

  it('shows error state and retry button', async () => {
    mockGetData.mockRejectedValue(new Error('IPC failed'))
    render(<Dashboard />)
    await waitFor(() => {
      expect(screen.getByText('IPC failed')).toBeDefined()
      expect(screen.getByRole('button', { name: 'Retry' })).toBeDefined()
    })
  })

  it('retries on button click', async () => {
    mockGetData.mockRejectedValue(new Error('IPC failed'))
    render(<Dashboard />)
    await waitFor(() => screen.getByRole('button', { name: 'Retry' }))

    mockGetData.mockResolvedValue(emptyDashboard())
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => {
      expect(screen.getByText(/No plots yet/)).toBeDefined()
    })
  })

  it('shows ETH price in the P&L card fallback row when available', async () => {
    mockGetData.mockResolvedValue({
      ...emptyDashboard(),
      tokenPrice: { ethUsd: 3500.42, plotUsd: null, error: null }
    })
    render(<Dashboard />)
    await waitFor(() => {
      // ETH/USD fallback line lives inside the P&L card.
      expect(screen.getByTestId('pnl-eth-fallback').textContent).toContain('$3,500.42')
    })
  })

  it('shows royalty info when earned', async () => {
    mockGetData.mockResolvedValue({
      ...emptyDashboard(),
      wallet: {
        address: '0xabc',
        source: 'plottoon-writer',
        connected: true,
        balanceWei: null,
        balanceError: null,
        usdcBalanceWei: null,
        usdcBalanceError: null,
        plotBalanceWei: null,
        plotBalanceError: null
      },
      royalty: {
        earnedWei: '500000000000000000',
        claimedWei: '100000000000000000',
        unclaimedWei: '400000000000000000',
        error: null
      }
    })
    render(<Dashboard />)
    await waitFor(() => {
      expect(screen.getByText('Royalties')).toBeDefined()
      // Royalties are denominated in PLOT (18 decimals); same numeric value
      // as before but the unit label reads PLOT, not ETH. After #250 RE1
      // the earned + unclaimed values also surface on the P&L card, so
      // there are now two DOM occurrences each — both surfaces must show
      // the right number.
      expect(screen.getAllByText(/0.5000 PLOT/).length).toBeGreaterThanOrEqual(1)
      expect(screen.getAllByText(/0.4000 PLOT/).length).toBeGreaterThanOrEqual(1)
    })
  })

  it('hides failed and not-indexed cards when counts are zero', async () => {
    mockGetData.mockResolvedValue({
      ...emptyDashboard(),
      counts: {
        totalProjects: 1,
        totalPlots: 2,
        publishedPlots: 2,
        pendingPlots: 0,
        notIndexedPlots: 0,
        failedPlots: 0,
        totalPublishCostWei: '0'
      }
    })
    render(<Dashboard />)
    await waitFor(() => {
      expect(screen.queryByText('Failed')).toBeNull()
      expect(screen.queryByText('Not Indexed')).toBeNull()
    })
  })

  it('renders plot state badges', async () => {
    mockGetData.mockResolvedValue({
      ...emptyDashboard(),
      counts: {
        totalProjects: 1,
        totalPlots: 1,
        publishedPlots: 0,
        pendingPlots: 0,
        notIndexedPlots: 0,
        failedPlots: 1,
        totalPublishCostWei: '0'
      },
      localGroups: [
        {
          groupKey: 'proj-1:Comic',
          projectId: 'proj-1',
          projectName: 'Comic',
          plots: [
            {
              projectId: 'proj-1',
              projectName: 'Comic',
              plotSlug: 'ep-1',
              plotTitle: 'Episode 1',
              cutCount: 1,
              plotState: 'failed',
              publishedAt: null,
              publishResult: null
            }
          ]
        }
      ]
    })
    render(<Dashboard />)
    await waitFor(() => {
      expect(screen.getByText('failed')).toBeDefined()
    })
  })

  it('renders refresh button and calls getData again', async () => {
    render(<Dashboard />)
    await waitFor(() => screen.getByText('Refresh'))
    mockGetData.mockResolvedValue({
      ...emptyDashboard(),
      counts: {
        totalProjects: 5,
        totalPlots: 0,
        publishedPlots: 0,
        pendingPlots: 0,
        notIndexedPlots: 0,
        failedPlots: 0,
        totalPublishCostWei: '0'
      }
    })
    fireEvent.click(screen.getByText('Refresh'))
    await waitFor(() => {
      expect(screen.getByText('5')).toBeDefined()
    })
  })

  it('shows claim button when unclaimed royalties exist', async () => {
    mockGetData.mockResolvedValue({
      ...emptyDashboard(),
      wallet: {
        address: '0xabc',
        source: 'plottoon-writer',
        connected: true,
        balanceWei: null,
        balanceError: null,
        usdcBalanceWei: null,
        usdcBalanceError: null,
        plotBalanceWei: null,
        plotBalanceError: null
      },
      royalty: {
        earnedWei: '500000000000000000',
        claimedWei: '100000000000000000',
        unclaimedWei: '400000000000000000',
        error: null
      }
    })
    mockGetInfo.mockResolvedValue({
      info: {
        earnedWei: '500000000000000000',
        claimedWei: '100000000000000000',
        unclaimedWei: '400000000000000000',
        reserveToken: '0xtoken'
      },
      error: null
    })
    render(<Dashboard />)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Claim Royalties' })).toBeDefined()
    })
  })

  it('shows confirmation dialog when claim button clicked', async () => {
    mockGetData.mockResolvedValue({
      ...emptyDashboard(),
      wallet: {
        address: '0xabc',
        source: 'plottoon-writer',
        connected: true,
        balanceWei: null,
        balanceError: null,
        usdcBalanceWei: null,
        usdcBalanceError: null,
        plotBalanceWei: null,
        plotBalanceError: null
      },
      royalty: {
        earnedWei: '500000000000000000',
        claimedWei: '100000000000000000',
        unclaimedWei: '400000000000000000',
        error: null
      }
    })
    mockGetInfo.mockResolvedValue({
      info: {
        earnedWei: '500000000000000000',
        claimedWei: '100000000000000000',
        unclaimedWei: '400000000000000000',
        reserveToken: '0xtoken'
      },
      error: null
    })
    render(<Dashboard />)
    await waitFor(() => screen.getByRole('button', { name: 'Claim Royalties' }))
    fireEvent.click(screen.getByRole('button', { name: 'Claim Royalties' }))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Confirm Claim' })).toBeDefined()
      expect(screen.getByText('Cancel')).toBeDefined()
    })
  })

  it('cancels claim when cancel clicked', async () => {
    mockGetData.mockResolvedValue({
      ...emptyDashboard(),
      wallet: {
        address: '0xabc',
        source: 'plottoon-writer',
        connected: true,
        balanceWei: null,
        balanceError: null,
        usdcBalanceWei: null,
        usdcBalanceError: null,
        plotBalanceWei: null,
        plotBalanceError: null
      },
      royalty: {
        earnedWei: '500000000000000000',
        claimedWei: '100000000000000000',
        unclaimedWei: '400000000000000000',
        error: null
      }
    })
    mockGetInfo.mockResolvedValue({
      info: {
        earnedWei: '500000000000000000',
        claimedWei: '100000000000000000',
        unclaimedWei: '400000000000000000',
        reserveToken: '0xtoken'
      },
      error: null
    })
    render(<Dashboard />)
    await waitFor(() => screen.getByRole('button', { name: 'Claim Royalties' }))
    fireEvent.click(screen.getByRole('button', { name: 'Claim Royalties' }))
    await waitFor(() => screen.getByText('Cancel'))
    fireEvent.click(screen.getByText('Cancel'))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Claim Royalties' })).toBeDefined()
      expect(screen.queryByText('Confirm Claim')).toBeNull()
    })
  })

  it('executes claim and shows success', async () => {
    mockGetData.mockResolvedValue({
      ...emptyDashboard(),
      wallet: {
        address: '0xabc',
        source: 'plottoon-writer',
        connected: true,
        balanceWei: null,
        balanceError: null,
        usdcBalanceWei: null,
        usdcBalanceError: null,
        plotBalanceWei: null,
        plotBalanceError: null
      },
      royalty: {
        earnedWei: '500000000000000000',
        claimedWei: '100000000000000000',
        unclaimedWei: '400000000000000000',
        error: null
      }
    })
    mockGetInfo.mockResolvedValue({
      info: {
        earnedWei: '500000000000000000',
        claimedWei: '100000000000000000',
        unclaimedWei: '400000000000000000',
        reserveToken: '0xtoken'
      },
      error: null
    })
    mockClaim.mockResolvedValue({ success: true, txHash: '0xclaimtx123456', gasCostWei: '21000' })
    render(<Dashboard />)
    await waitFor(() => screen.getByRole('button', { name: 'Claim Royalties' }))
    fireEvent.click(screen.getByRole('button', { name: 'Claim Royalties' }))
    await waitFor(() => screen.getByRole('button', { name: 'Confirm Claim' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Claim' }))
    await waitFor(() => {
      expect(screen.getByText(/Claimed!/)).toBeDefined()
    })
    expect(mockClaim).toHaveBeenCalledWith(true)
  })

  it('shows error when claim fails', async () => {
    mockGetData.mockResolvedValue({
      ...emptyDashboard(),
      wallet: {
        address: '0xabc',
        source: 'plottoon-writer',
        connected: true,
        balanceWei: null,
        balanceError: null,
        usdcBalanceWei: null,
        usdcBalanceError: null,
        plotBalanceWei: null,
        plotBalanceError: null
      },
      royalty: {
        earnedWei: '500000000000000000',
        claimedWei: '100000000000000000',
        unclaimedWei: '400000000000000000',
        error: null
      }
    })
    mockGetInfo.mockResolvedValue({
      info: {
        earnedWei: '500000000000000000',
        claimedWei: '100000000000000000',
        unclaimedWei: '400000000000000000',
        reserveToken: '0xtoken'
      },
      error: null
    })
    mockClaim.mockResolvedValue({ success: false, error: 'Transaction reverted' })
    render(<Dashboard />)
    await waitFor(() => screen.getByRole('button', { name: 'Claim Royalties' }))
    fireEvent.click(screen.getByRole('button', { name: 'Claim Royalties' }))
    await waitFor(() => screen.getByRole('button', { name: 'Confirm Claim' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Claim' }))
    await waitFor(() => {
      expect(screen.getByText('Transaction reverted')).toBeDefined()
    })
  })

  it('does not show claim button when no unclaimed royalties', async () => {
    mockGetData.mockResolvedValue({
      ...emptyDashboard(),
      wallet: {
        address: '0xabc',
        source: 'plottoon-writer',
        connected: true,
        balanceWei: null,
        balanceError: null,
        usdcBalanceWei: null,
        usdcBalanceError: null,
        plotBalanceWei: null,
        plotBalanceError: null
      },
      royalty: {
        earnedWei: '500000000000000000',
        claimedWei: '500000000000000000',
        unclaimedWei: '0',
        error: null
      }
    })
    mockGetInfo.mockResolvedValue({
      info: {
        earnedWei: '500000000000000000',
        claimedWei: '500000000000000000',
        unclaimedWei: '0',
        reserveToken: '0xtoken'
      },
      error: null
    })
    render(<Dashboard />)
    await waitFor(() => {
      expect(screen.getByText('Royalties')).toBeDefined()
    })
    expect(screen.queryByRole('button', { name: 'Claim Royalties' })).toBeNull()
  })

  it('displays claim history from persisted records', async () => {
    ;(window.plottoon.royalty.getClaimHistory as ReturnType<typeof vi.fn>).mockResolvedValue({
      claims: [
        {
          txHash: '0xhistorytx1234567890',
          walletAddress: '0xabc',
          reserveToken: '0xtoken',
          gasCostWei: '21000',
          status: 'confirmed',
          error: null,
          claimedAt: '2026-05-17T10:00:00Z'
        },
        {
          txHash: '0xfailedtx987654321',
          walletAddress: '0xabc',
          reserveToken: '0xtoken',
          gasCostWei: null,
          status: 'failed',
          error: 'Reverted',
          claimedAt: '2026-05-18T10:00:00Z'
        }
      ]
    })
    mockGetData.mockResolvedValue({
      ...emptyDashboard(),
      wallet: {
        address: '0xabc',
        source: 'plottoon-writer',
        connected: true,
        balanceWei: null,
        balanceError: null,
        usdcBalanceWei: null,
        usdcBalanceError: null,
        plotBalanceWei: null,
        plotBalanceError: null
      },
      royalty: {
        earnedWei: '500000000000000000',
        claimedWei: '100000000000000000',
        unclaimedWei: '400000000000000000',
        error: null
      }
    })
    mockGetInfo.mockResolvedValue({
      info: {
        earnedWei: '500000000000000000',
        claimedWei: '100000000000000000',
        unclaimedWei: '400000000000000000',
        reserveToken: '0xtoken'
      },
      error: null
    })
    render(<Dashboard />)
    await waitFor(() => {
      expect(screen.getByText('Claim History')).toBeDefined()
      expect(screen.getByText('0xhistoryt…')).toBeDefined()
      // "Reverted" appears in both the royalty card's claim history AND
      // the activity feed's failed-claim entry — both are valid surfaces.
      expect(screen.getAllByText('Reverted').length).toBeGreaterThanOrEqual(1)
    })
  })
})

const FAKE_WALLET_A = '0xaaaa000000000000000000000000000000000001'

function connectedWallet(extra: Partial<DashboardWalletSummary> = {}): DashboardWalletSummary {
  return {
    address: FAKE_WALLET_A,
    source: 'plottoon-writer',
    connected: true,
    balanceWei: null,
    balanceError: null,
    usdcBalanceWei: null,
    usdcBalanceError: null,
    plotBalanceWei: null,
    plotBalanceError: null,
    ...extra
  }
}

describe('#250 Dashboard — header + active wallet context', () => {
  it('renders the active wallet address and source in the header subtitle when connected', async () => {
    mockGetData.mockResolvedValue({
      ...emptyDashboard(),
      wallet: connectedWallet()
    })
    render(<Dashboard />)
    await waitFor(() => {
      // Truncated active address surfaces next to the page heading.
      expect(screen.getByTestId('active-wallet-context').textContent).toMatch(/0xaaaa/)
    })
  })

  it('renders the no-wallet hint when disconnected', async () => {
    render(<Dashboard />)
    await waitFor(() => {
      expect(screen.getByText(/No wallet connected/)).toBeDefined()
    })
    expect(screen.queryByTestId('active-wallet-context')).toBeNull()
  })
})

describe('#250 Wallet card — ETH + USDC + PLOT + Base + copy/explorer', () => {
  it('renders the Base network chip, copy button, and explorer link for a connected wallet', async () => {
    mockGetData.mockResolvedValue({
      ...emptyDashboard(),
      wallet: connectedWallet()
    })
    render(<Dashboard />)
    await waitFor(() => {
      expect(screen.getByTestId('wallet-network-chip').textContent).toBe('Base')
      expect(screen.getByTestId('wallet-copy-address')).toBeDefined()
      const explorer = screen.getByTestId('wallet-open-explorer') as HTMLAnchorElement
      expect(explorer.href).toContain(`basescan.org/address/${FAKE_WALLET_A}`)
    })
  })

  it('renders ETH + USDC + PLOT balance rows formatted per-token', async () => {
    mockGetData.mockResolvedValue({
      ...emptyDashboard(),
      wallet: connectedWallet({
        balanceWei: '2500000000000000000', // 2.5 ETH
        usdcBalanceWei: '12345670', // 12.34 USDC (6 decimals)
        plotBalanceWei: '50000000000000000000' // 50 PLOT (18 decimals)
      })
    })
    render(<Dashboard />)
    await waitFor(() => {
      expect(screen.getByTestId('wallet-balance-ETH').textContent).toContain('2.5000 ETH')
      expect(screen.getByTestId('wallet-balance-USDC').textContent).toContain('12.35 USDC')
      expect(screen.getByTestId('wallet-balance-PLOT').textContent).toContain('50.0000 PLOT')
    })
  })

  it('surfaces a per-token error on the failing row without hiding the others', async () => {
    mockGetData.mockResolvedValue({
      ...emptyDashboard(),
      wallet: connectedWallet({
        balanceWei: '1000000000000000000',
        usdcBalanceWei: null,
        usdcBalanceError: 'USDC RPC failed',
        plotBalanceWei: '100000000000000000'
      })
    })
    render(<Dashboard />)
    await waitFor(() => {
      expect(screen.getByTestId('wallet-balance-ETH').textContent).toContain('1.0000 ETH')
      expect(screen.getByTestId('wallet-balance-USDC').textContent).toContain('USDC RPC failed')
      expect(screen.getByTestId('wallet-balance-PLOT').textContent).toContain('0.1000 PLOT')
    })
  })

  it('shows "—" placeholder rows when balance fetchers are not wired', async () => {
    mockGetData.mockResolvedValue({
      ...emptyDashboard(),
      wallet: connectedWallet()
    })
    render(<Dashboard />)
    await waitFor(() => {
      expect(screen.getByTestId('wallet-balance-ETH').textContent).toContain('—')
      expect(screen.getByTestId('wallet-balance-USDC').textContent).toContain('—')
      expect(screen.getByTestId('wallet-balance-PLOT').textContent).toContain('—')
    })
  })
})

describe('#250 P&L card', () => {
  it('renders gas/royalty/net rows and ETH/USD + PLOT/USD fallback states when prices are unavailable', async () => {
    mockGetData.mockResolvedValue({
      ...emptyDashboard(),
      counts: {
        totalProjects: 0,
        totalPlots: 0,
        publishedPlots: 0,
        pendingPlots: 0,
        notIndexedPlots: 0,
        failedPlots: 0,
        totalPublishCostWei: '0'
      }
    })
    render(<Dashboard />)
    await waitFor(() => {
      expect(screen.getByTestId('dash-pnl-card')).toBeDefined()
      expect(screen.getByTestId('pnl-eth-fallback').textContent).toContain('unavailable')
      expect(screen.getByTestId('pnl-plot-fallback').textContent).toContain('unavailable')
    })
  })

  it('renders USD-converted gas, royalty, and net rows when all inputs are present', async () => {
    mockGetData.mockResolvedValue({
      ...emptyDashboard(),
      counts: {
        totalProjects: 1,
        totalPlots: 1,
        publishedPlots: 1,
        pendingPlots: 0,
        notIndexedPlots: 0,
        failedPlots: 0,
        totalPublishCostWei: '1000000000000000' // 0.001 ETH gas
      },
      wallet: connectedWallet(),
      tokenPrice: { ethUsd: 4000, plotUsd: 0.5, error: null },
      royalty: {
        earnedWei: '10000000000000000000', // 10 PLOT earned
        claimedWei: '0',
        unclaimedWei: '10000000000000000000',
        error: null
      },
      pnl: {
        totalGasUsd: 4, // 0.001 × $4000
        totalRoyaltyUsd: 5, // 10 × $0.5
        netUsd: 1
      }
    })
    render(<Dashboard />)
    await waitFor(() => {
      expect(screen.getByTestId('pnl-gas-row').textContent).toContain('$4.00')
      expect(screen.getByTestId('pnl-royalty-row').textContent).toContain('$5.00')
      expect(screen.getByTestId('pnl-net-row').textContent).toContain('$1.00')
      expect(screen.getByTestId('pnl-eth-fallback').textContent).toContain('$4,000')
      expect(screen.getByTestId('pnl-plot-fallback').textContent).toContain('$0.5000')
    })
  })

  // #250 RE1: the P&L card surface must expose both earned and unclaimed
  // royalty values directly, not only the USD aggregate. The royalty
  // claim card carries the same numbers + the claim action; this card is
  // the financial summary so it needs the PLOT amounts too.
  it('exposes earned AND unclaimed royalty values on the P&L card when present', async () => {
    mockGetData.mockResolvedValue({
      ...emptyDashboard(),
      wallet: connectedWallet(),
      tokenPrice: { ethUsd: null, plotUsd: 0.5, error: null },
      royalty: {
        earnedWei: '10000000000000000000', // 10 PLOT earned
        claimedWei: '4000000000000000000', // 4 PLOT claimed
        unclaimedWei: '6000000000000000000', // 6 PLOT still claimable
        error: null
      },
      pnl: {
        totalGasUsd: null,
        totalRoyaltyUsd: 5, // 10 PLOT × $0.5
        netUsd: null
      }
    })
    render(<Dashboard />)
    await waitFor(() => {
      // Earned row carries the PLOT amount.
      const earnedRow = screen.getByTestId('pnl-royalty-row')
      expect(earnedRow.textContent).toContain('10.0000 PLOT')
      // New unclaimed row carries the PLOT amount and the USD estimate.
      const unclaimedRow = screen.getByTestId('pnl-unclaimed-row')
      expect(unclaimedRow.textContent).toContain('6.0000 PLOT')
      expect(unclaimedRow.textContent).toContain('$3.00') // 6 × $0.5
    })
  })

  it('shows "—" placeholders on earned + unclaimed rows when royalty is absent', async () => {
    mockGetData.mockResolvedValue({
      ...emptyDashboard(),
      wallet: connectedWallet()
    })
    render(<Dashboard />)
    await waitFor(() => {
      expect(screen.getByTestId('pnl-royalty-row').textContent).toContain('—')
      expect(screen.getByTestId('pnl-unclaimed-row').textContent).toContain('—')
    })
  })

  it('renders the net row with a negative-class colour when net P&L is below zero', async () => {
    mockGetData.mockResolvedValue({
      ...emptyDashboard(),
      counts: {
        totalProjects: 1,
        totalPlots: 1,
        publishedPlots: 1,
        pendingPlots: 0,
        notIndexedPlots: 0,
        failedPlots: 0,
        totalPublishCostWei: '10000000000000000'
      },
      wallet: connectedWallet(),
      tokenPrice: { ethUsd: 4000, plotUsd: 0.5, error: null },
      pnl: {
        totalGasUsd: 40,
        totalRoyaltyUsd: 5,
        netUsd: -35
      }
    })
    render(<Dashboard />)
    await waitFor(() => {
      const netRow = screen.getByTestId('pnl-net-row')
      const aux = netRow.querySelector('.dash-pnl__row-aux')
      expect(aux?.className).toContain('dash-pnl__row-aux--negative')
      expect(aux?.textContent).toContain('-$35')
    })
  })
})

describe('#250 Published storylines — Open in workspace action', () => {
  function storylineFixture(): DashboardData {
    return {
      ...emptyDashboard(),
      counts: {
        totalProjects: 1,
        totalPlots: 1,
        publishedPlots: 1,
        pendingPlots: 0,
        notIndexedPlots: 0,
        failedPlots: 0,
        totalPublishCostWei: '21000000000000'
      },
      wallet: connectedWallet(),
      storylines: [
        {
          storylineId: 'sl-managed-1',
          projectId: 'proj-managed',
          projectName: 'Managed Comic',
          plots: [
            {
              projectId: 'proj-managed',
              projectName: 'Managed Comic',
              plotSlug: 'ep-1',
              plotTitle: 'Episode 1',
              cutCount: 2,
              plotState: 'published',
              publishedAt: '2026-05-22T10:00:00Z',
              publishResult: {
                txHash: '0xtx1',
                storylineId: 'sl-managed-1',
                plotIndex: 0,
                contentCid: 'bafytest',
                contentHash: '0xhash',
                authorAddress: '0xauthor',
                gasCostWei: '21000000000000',
                plotlinkUrl: 'https://plotlink.xyz/story/managed',
                walletAddress: FAKE_WALLET_A,
                walletSource: 'plottoon-writer',
                indexed: true,
                indexError: null
              }
            }
          ],
          publishedCount: 1,
          notIndexedCount: 0,
          latestPublishedAt: '2026-05-22T10:00:00Z',
          totalPublishCostWei: '21000000000000'
        }
      ]
    }
  }

  it('renders Open in workspace when onSelectProject is provided and calls it with the local projectId', async () => {
    mockGetData.mockResolvedValue(storylineFixture())
    const onSelectProject = vi.fn()
    render(<Dashboard onSelectProject={onSelectProject} />)
    const openBtn = await screen.findByTestId('open-workspace-sl-managed-1')
    fireEvent.click(openBtn)
    expect(onSelectProject).toHaveBeenCalledWith('proj-managed')
  })

  it('does not render the Open in workspace action when onSelectProject is omitted', async () => {
    mockGetData.mockResolvedValue(storylineFixture())
    render(<Dashboard />)
    await screen.findByTestId('storyline-sl-managed-1')
    expect(screen.queryByTestId('open-workspace-sl-managed-1')).toBeNull()
  })
})

describe('#250 Wallet switch — Dashboard reloads on WALLET_ACTIVE_CHANGED_EVENT', () => {
  it('refetches getData when the active-changed event fires', async () => {
    mockGetData.mockClear()
    mockGetData.mockResolvedValue(emptyDashboard())
    render(<Dashboard />)
    await waitFor(() => expect(mockGetData).toHaveBeenCalledTimes(1))
    window.dispatchEvent(new CustomEvent(WALLET_ACTIVE_CHANGED_EVENT_FOR_TESTS))
    await waitFor(() => expect(mockGetData).toHaveBeenCalledTimes(2))
  })
})

describe('#251 Local production — retry index on not-indexed plots', () => {
  function notIndexedFixture(): DashboardData {
    return {
      ...emptyDashboard(),
      counts: {
        totalProjects: 1,
        totalPlots: 1,
        publishedPlots: 0,
        pendingPlots: 0,
        notIndexedPlots: 1,
        failedPlots: 0,
        totalPublishCostWei: '21000000000000'
      },
      wallet: connectedWallet(),
      storylines: [
        {
          storylineId: 'sl-not-indexed',
          projectId: 'proj-ni',
          projectName: 'Recovery Story',
          plots: [
            {
              projectId: 'proj-ni',
              projectName: 'Recovery Story',
              plotSlug: 'ep-1',
              plotTitle: 'Episode 1',
              cutCount: 2,
              plotState: 'published-not-indexed',
              publishedAt: '2026-05-22T10:00:00Z',
              publishResult: {
                txHash: '0xtx-ni',
                storylineId: 'sl-not-indexed',
                plotIndex: 0,
                contentCid: 'bafytest',
                contentHash: '0xhash',
                authorAddress: '0xauthor',
                gasCostWei: '21000000000000',
                plotlinkUrl: null,
                walletAddress: FAKE_WALLET_A,
                walletSource: 'plottoon-writer',
                indexed: false,
                indexError: 'PlotLink index POST returned 503'
              }
            }
          ],
          publishedCount: 0,
          notIndexedCount: 1,
          latestPublishedAt: '2026-05-22T10:00:00Z',
          totalPublishCostWei: '21000000000000'
        }
      ]
    }
  }

  it('renders a Retry index button for published-not-indexed plots and calls publish.retryIndex with the projectId+slug', async () => {
    mockGetData.mockResolvedValue(notIndexedFixture())
    const retryIndex = vi.fn().mockResolvedValue({ success: true })
    ;(window.plottoon as unknown as { publish: { retryIndex: typeof retryIndex } }).publish = {
      retryIndex
    } as unknown as typeof window.plottoon.publish

    render(<Dashboard />)
    const retryBtn = await screen.findByTestId('retry-index-proj-ni-ep-1')
    fireEvent.click(retryBtn)
    await waitFor(() => {
      expect(retryIndex).toHaveBeenCalledWith({ projectId: 'proj-ni', plotSlug: 'ep-1' })
    })
  })

  it('shows the retry error inline when publish.retryIndex returns success:false (no dashboard reload)', async () => {
    mockGetData.mockResolvedValue(notIndexedFixture())
    const retryIndex = vi
      .fn()
      .mockResolvedValue({ success: false, error: 'Index POST returned 503' })
    ;(window.plottoon as unknown as { publish: { retryIndex: typeof retryIndex } }).publish = {
      retryIndex
    } as unknown as typeof window.plottoon.publish

    mockGetData.mockClear()
    mockGetData.mockResolvedValue(notIndexedFixture())
    render(<Dashboard />)
    await waitFor(() => expect(mockGetData).toHaveBeenCalledTimes(1))

    fireEvent.click(await screen.findByTestId('retry-index-proj-ni-ep-1'))
    await waitFor(() => {
      expect(screen.getByTestId('retry-index-error-proj-ni-ep-1').textContent).toContain(
        'Index POST returned 503'
      )
    })
    // Dashboard data was NOT reloaded because retry failed.
    expect(mockGetData).toHaveBeenCalledTimes(1)
  })

  it('does not render the Retry index button for plots that are not in the not-indexed state', async () => {
    mockGetData.mockResolvedValue({
      ...emptyDashboard(),
      wallet: connectedWallet(),
      localGroups: [
        {
          groupKey: 'proj-draft:Draft',
          projectId: 'proj-draft',
          projectName: 'Draft',
          plots: [
            {
              projectId: 'proj-draft',
              projectName: 'Draft',
              plotSlug: 'ep-1',
              plotTitle: 'Episode 1',
              cutCount: 1,
              plotState: 'draft',
              publishedAt: null,
              publishResult: null
            }
          ]
        }
      ]
    })
    render(<Dashboard />)
    await screen.findByTestId('local-group-proj-draft:Draft')
    expect(screen.queryByTestId('retry-index-proj-draft-ep-1')).toBeNull()
  })
})

describe('#251 Activity feed — local publishes + royalty claims, time-sorted', () => {
  it('renders the empty state when there are no published plots or claim records', async () => {
    mockGetData.mockResolvedValue(emptyDashboard())
    render(<Dashboard />)
    await waitFor(() => {
      expect(screen.getByTestId('activity-empty')).toBeDefined()
    })
  })

  it('renders a publish entry per published plot with BaseScan + PlotLink links', async () => {
    mockGetData.mockResolvedValue({
      ...emptyDashboard(),
      wallet: connectedWallet(),
      storylines: [
        {
          storylineId: 'sl-pub',
          projectId: 'proj-pub',
          projectName: 'Pub Comic',
          plots: [
            {
              projectId: 'proj-pub',
              projectName: 'Pub Comic',
              plotSlug: 'ep-1',
              plotTitle: 'Episode 1',
              cutCount: 1,
              plotState: 'published',
              publishedAt: '2026-05-24T01:00:00Z',
              publishResult: {
                txHash: '0xact-tx',
                storylineId: 'sl-pub',
                plotIndex: 0,
                contentCid: 'bafy',
                contentHash: '0xh',
                authorAddress: '0xauth',
                gasCostWei: '1',
                plotlinkUrl: 'https://plotlink.xyz/story/pub',
                walletAddress: FAKE_WALLET_A,
                walletSource: 'plottoon-writer',
                indexed: true,
                indexError: null
              }
            }
          ],
          publishedCount: 1,
          notIndexedCount: 0,
          latestPublishedAt: '2026-05-24T01:00:00Z',
          totalPublishCostWei: '1'
        }
      ]
    })
    render(<Dashboard />)
    const list = await screen.findByTestId('activity-list')
    const firstEntry = await screen.findByTestId('activity-publish-0')
    expect(firstEntry.textContent).toContain('Episode 1')
    expect(firstEntry.textContent).toContain('Pub Comic')
    // Both Tx and PlotLink links present on a publish entry.
    expect(list.innerHTML).toContain('basescan.org/tx/0xact-tx')
    expect(list.innerHTML).toContain('plotlink.xyz/story/pub')
  })

  it('merges royalty claims into the activity list and sorts both kinds by descending time', async () => {
    ;(window.plottoon.royalty.getClaimHistory as ReturnType<typeof vi.fn>).mockResolvedValue({
      claims: [
        {
          txHash: '0xclaim-tx-1',
          walletAddress: FAKE_WALLET_A,
          reserveToken: '0x0',
          gasCostWei: '1',
          status: 'confirmed' as const,
          error: null,
          // Newer than the publish below — should appear first.
          claimedAt: '2026-05-24T02:00:00Z'
        }
      ]
    })
    mockGetData.mockResolvedValue({
      ...emptyDashboard(),
      wallet: connectedWallet(),
      storylines: [
        {
          storylineId: 'sl-mix',
          projectId: 'proj-mix',
          projectName: 'Mix Comic',
          plots: [
            {
              projectId: 'proj-mix',
              projectName: 'Mix Comic',
              plotSlug: 'ep-1',
              plotTitle: 'Older Episode',
              cutCount: 1,
              plotState: 'published',
              publishedAt: '2026-05-24T01:00:00Z',
              publishResult: {
                txHash: '0xolder-pub-tx',
                storylineId: 'sl-mix',
                plotIndex: 0,
                contentCid: 'bafy',
                contentHash: '0xh',
                authorAddress: '0xauth',
                gasCostWei: '1',
                plotlinkUrl: null,
                walletAddress: FAKE_WALLET_A,
                walletSource: 'plottoon-writer',
                indexed: true,
                indexError: null
              }
            }
          ],
          publishedCount: 1,
          notIndexedCount: 0,
          latestPublishedAt: '2026-05-24T01:00:00Z',
          totalPublishCostWei: '1'
        }
      ]
    })
    render(<Dashboard />)
    // First entry (index 0) is the newer claim; second (index 1) is the older publish.
    const claimEntry = await screen.findByTestId('activity-claim-0')
    const publishEntry = await screen.findByTestId('activity-publish-1')
    expect(claimEntry.textContent).toContain('Royalty claimed')
    expect(publishEntry.textContent).toContain('Older Episode')
  })

  it('surfaces a failed royalty claim as a distinct activity entry with the error text', async () => {
    ;(window.plottoon.royalty.getClaimHistory as ReturnType<typeof vi.fn>).mockResolvedValue({
      claims: [
        {
          txHash: '',
          walletAddress: FAKE_WALLET_A,
          reserveToken: '0x0',
          gasCostWei: null,
          status: 'failed' as const,
          error: 'Reverted on chain',
          claimedAt: '2026-05-24T03:00:00Z'
        }
      ]
    })
    mockGetData.mockResolvedValue({
      ...emptyDashboard(),
      wallet: connectedWallet()
    })
    render(<Dashboard />)
    const entry = await screen.findByTestId('activity-claim-0')
    expect(entry.textContent).toContain('Royalty claim failed')
    expect(entry.textContent).toContain('Reverted on chain')
  })
})
