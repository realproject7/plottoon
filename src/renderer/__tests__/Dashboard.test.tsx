// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { Dashboard } from '../Dashboard'

function emptyDashboard(): DashboardData {
  return {
    counts: {
      totalProjects: 0,
      totalPlots: 0,
      publishedPlots: 0,
      pendingPlots: 0,
      notIndexedPlots: 0,
      failedPlots: 0
    },
    storylines: [],
    localGroups: [],
    wallet: { address: null, source: null, connected: false, balanceWei: null, balanceError: null },
    tokenPrice: { ethUsd: null, error: null },
    royalty: { earnedWei: null, claimedWei: null, unclaimedWei: null, error: null },
    generatedAt: '2026-05-18T12:00:00Z'
  }
}

const mockGetData = vi.fn<() => Promise<DashboardData>>()

beforeEach(() => {
  mockGetData.mockResolvedValue(emptyDashboard())
  window.plottoon = {
    dashboard: { getData: mockGetData }
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
        failedPlots: 1
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
        failedPlots: 0
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
          totalGasCostWei: '31000000000000'
        }
      ]
    })
    render(<Dashboard />)
    await waitFor(() => {
      expect(screen.getByText('Storylines')).toBeDefined()
      expect(screen.getByText('My Comic')).toBeDefined()
      expect(screen.getByText('Episode 1')).toBeDefined()
      expect(screen.getByText('Episode 2')).toBeDefined()
      expect(screen.getByText('3 cuts')).toBeDefined()
      expect(screen.getByText('2 cuts')).toBeDefined()
      const txLinks = screen.getAllByText('Tx')
      expect(txLinks).toHaveLength(2)
      expect(txLinks[0].closest('a')?.href).toContain('basescan.org/tx/0xtx1')
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
        failedPlots: 0
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
      expect(screen.getByText('Local Projects')).toBeDefined()
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
        balanceError: null
      }
    })
    render(<Dashboard />)
    await waitFor(() => {
      expect(screen.getByText('plottoon-writer')).toBeDefined()
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

  it('shows ETH price when available', async () => {
    mockGetData.mockResolvedValue({
      ...emptyDashboard(),
      tokenPrice: { ethUsd: 3500.42, error: null }
    })
    render(<Dashboard />)
    await waitFor(() => {
      expect(screen.getByText('ETH Price')).toBeDefined()
      expect(screen.getByText('$3,500.42')).toBeDefined()
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
        balanceError: null
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
      expect(screen.getByText(/0.5000 ETH/)).toBeDefined()
      expect(screen.getByText(/0.4000 ETH/)).toBeDefined()
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
        failedPlots: 0
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
        failedPlots: 1
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
        failedPlots: 0
      }
    })
    fireEvent.click(screen.getByText('Refresh'))
    await waitFor(() => {
      expect(screen.getByText('5')).toBeDefined()
    })
  })
})
