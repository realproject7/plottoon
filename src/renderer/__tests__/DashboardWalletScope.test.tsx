// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { Dashboard } from '../Dashboard'
import { WALLET_ACTIVE_CHANGED_EVENT } from '../../shared/walletIdentity'

const WALLET_A = '0xaaaa000000000000000000000000000000000001'
const WALLET_B = '0xbbbb000000000000000000000000000000000002'

interface DashboardSnapshotInput {
  walletAddress?: string | null
  storylineProjects?: string[]
  unclaimedWei?: string
  earnedWei?: string
}

function makeDashboardData(input: DashboardSnapshotInput = {}): DashboardData {
  const address = input.walletAddress ?? null
  return {
    counts: {
      totalProjects: input.storylineProjects?.length ?? 0,
      totalPlots: input.storylineProjects?.length ?? 0,
      publishedPlots: 0,
      pendingPlots: 0,
      notIndexedPlots: 0,
      failedPlots: 0,
      totalPublishCostWei: '0'
    },
    storylines: [],
    localGroups: (input.storylineProjects ?? []).map((name) => ({
      groupKey: name,
      projectId: name,
      projectName: name,
      plots: []
    })),
    wallet: {
      address,
      source: address ? 'plottoon-writer' : null,
      connected: address !== null,
      balanceWei: address ? '1000000000000000000' : null,
      balanceError: null,
      usdcBalanceWei: null,
      usdcBalanceError: null,
      plotBalanceWei: null,
      plotBalanceError: null
    },
    tokenPrice: { ethUsd: null, plotUsd: null, error: null },
    royalty: {
      earnedWei: input.earnedWei ?? null,
      claimedWei: '0',
      unclaimedWei: input.unclaimedWei ?? null,
      error: null
    },
    pnl: { totalGasUsd: null, totalRoyaltyUsd: null, netUsd: null },
    generatedAt: '2026-05-22T01:00:00.000Z'
  }
}

let getDataMock: ReturnType<typeof vi.fn>
let royaltyInfoMock: ReturnType<typeof vi.fn>
let royaltyClaimMock: ReturnType<typeof vi.fn>
let royaltyHistoryMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  getDataMock = vi.fn()
  royaltyInfoMock = vi.fn().mockResolvedValue({ info: null, error: null })
  royaltyClaimMock = vi.fn().mockResolvedValue({ success: false })
  royaltyHistoryMock = vi.fn().mockResolvedValue({ claims: [] })
  ;(window as unknown as { plottoon: Record<string, unknown> }).plottoon = {
    dashboard: { getData: getDataMock },
    royalty: {
      getInfo: royaltyInfoMock,
      claim: royaltyClaimMock,
      getClaimHistory: royaltyHistoryMock,
      onProgress: vi.fn().mockReturnValue(() => {})
    }
  }
})

afterEach(cleanup)

describe('Dashboard wallet scoping (#222)', () => {
  it('re-loads dashboard data when the active wallet changes', async () => {
    getDataMock
      .mockResolvedValueOnce(
        makeDashboardData({
          walletAddress: WALLET_A,
          storylineProjects: ['wallet-a-story']
        })
      )
      .mockResolvedValueOnce(
        makeDashboardData({
          walletAddress: WALLET_B,
          storylineProjects: ['wallet-b-story']
        })
      )

    render(<Dashboard />)
    await waitFor(() => expect(screen.getByText('wallet-a-story')).toBeDefined())

    // Switch wallet — Dashboard listens for the event and re-fetches.
    window.dispatchEvent(new CustomEvent(WALLET_ACTIVE_CHANGED_EVENT))

    await waitFor(() => expect(screen.getByText('wallet-b-story')).toBeDefined())
    // Previous wallet's project must not still be on the screen.
    expect(screen.queryByText('wallet-a-story')).toBeNull()
    expect(getDataMock).toHaveBeenCalledTimes(2)
  })

  it('shows wallet B address (not A) in the wallet card after switching', async () => {
    getDataMock
      .mockResolvedValueOnce(makeDashboardData({ walletAddress: WALLET_A }))
      .mockResolvedValueOnce(makeDashboardData({ walletAddress: WALLET_B }))

    render(<Dashboard />)
    // After #250 the address shows up in BOTH the header context and the
    // wallet card body — assert all renders go to wallet A first, then all
    // flip to wallet B, with no residual A anywhere.
    await waitFor(() => expect(screen.getAllByText(/0xaaaa/).length).toBeGreaterThan(0))

    window.dispatchEvent(new CustomEvent(WALLET_ACTIVE_CHANGED_EVENT))

    await waitFor(() => expect(screen.getAllByText(/0xbbbb/).length).toBeGreaterThan(0))
    expect(screen.queryAllByText(/0xaaaa/).length).toBe(0)
  })

  it('clears wallet A royalty info, confirm dialog, and claim history when switching to wallet B (#222 RE1 finding)', async () => {
    getDataMock
      .mockResolvedValueOnce(
        makeDashboardData({
          walletAddress: WALLET_A,
          earnedWei: '2000000000000000',
          unclaimedWei: '1000000000000000'
        })
      )
      .mockResolvedValueOnce(
        makeDashboardData({
          walletAddress: WALLET_B,
          earnedWei: '0',
          unclaimedWei: '0'
        })
      )
    royaltyInfoMock
      .mockResolvedValueOnce({
        info: {
          earnedWei: '2000000000000000',
          claimedWei: '0',
          unclaimedWei: '1000000000000000'
        },
        error: null
      })
      .mockResolvedValueOnce({ info: null, error: null })
    // #251 lifted the activity-feed history fetch into the Dashboard, so
    // getClaimHistory is called twice on initial mount (once for the
    // Dashboard activity feed, once for the RoyaltyClaimCard's own
    // state) and twice again after a wallet switch. Mock A→A→B→B so each
    // surface sees the right wallet's history.
    const walletAClaims = {
      claims: [
        {
          txHash: '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
          walletAddress: WALLET_A,
          reserveToken: '0x0',
          gasCostWei: '0',
          status: 'confirmed' as const,
          error: null,
          claimedAt: '2026-05-22T00:30:00.000Z'
        }
      ]
    }
    royaltyHistoryMock
      .mockResolvedValueOnce(walletAClaims)
      .mockResolvedValueOnce(walletAClaims)
      .mockResolvedValue({ claims: [] })

    render(<Dashboard />)
    // Wallet A: claim button visible because unclaimedWei > 0; history row present.
    const claimBtn = await screen.findByRole('button', { name: 'Claim Royalties' })
    expect(claimBtn).toBeDefined()
    // Open the confirmation to seed local component state.
    fireEvent.click(claimBtn)
    await screen.findByTestId('royalty-confirm')
    await waitFor(() => expect(screen.getByText(/0xdeadbe/)).toBeDefined())

    // Switch to wallet B — RE1 finding: the previous code would leave the
    // wallet A info / history / confirmation in component state because the
    // effect was keyed on `walletConnected` which stays true across switches.
    window.dispatchEvent(new CustomEvent(WALLET_ACTIVE_CHANGED_EVENT))

    await waitFor(() => {
      // Wallet A's claim button must disappear (wallet B has no unclaimed).
      expect(screen.queryByRole('button', { name: 'Claim Royalties' })).toBeNull()
      // The open confirmation must close.
      expect(screen.queryByTestId('royalty-confirm')).toBeNull()
      // Wallet A's claim history row must not be visible under wallet B.
      expect(screen.queryByText(/0xdeadbe/)).toBeNull()
    })
  })

  it('shows the active wallet address as context inside the royalty claim confirmation', async () => {
    getDataMock.mockResolvedValue(
      makeDashboardData({
        walletAddress: WALLET_A,
        earnedWei: '2000000000000000',
        unclaimedWei: '1000000000000000'
      })
    )
    royaltyInfoMock.mockResolvedValue({
      info: {
        earnedWei: '2000000000000000',
        claimedWei: '0',
        unclaimedWei: '1000000000000000'
      },
      error: null
    })

    render(<Dashboard />)
    const claimBtn = await screen.findByRole('button', { name: 'Claim Royalties' })
    fireEvent.click(claimBtn)
    const confirmWallet = await screen.findByTestId('royalty-confirm-wallet')
    // The confirmation must show the active wallet so the user can't claim
    // accidentally as the wrong wallet after a switch they didn't notice.
    expect(confirmWallet.textContent).toContain('0xaaaa')
    expect(confirmWallet.textContent?.toLowerCase()).toContain('as ')
  })

  it('never renders OWS internal names or wallet-secret terminology', async () => {
    getDataMock.mockResolvedValue(
      makeDashboardData({ walletAddress: WALLET_A, storylineProjects: ['my-story'] })
    )
    const { container } = render(<Dashboard />)
    await waitFor(() => expect(screen.getByText('my-story')).toBeDefined())
    const html = container.innerHTML
    expect(html).not.toMatch(/owsName|plottoon-writer-fake/i)
    expect(html).not.toMatch(/privateKey|mnemonic|passphrase|vaultPath/i)
  })
})
