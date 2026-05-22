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
      failedPlots: 0
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
      balanceError: null
    },
    tokenPrice: { ethUsd: null, error: null },
    royalty: {
      earnedWei: input.earnedWei ?? null,
      claimedWei: '0',
      unclaimedWei: input.unclaimedWei ?? null,
      error: null
    },
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
    await waitFor(() => expect(screen.getByText(/0xaaaa/)).toBeDefined())

    window.dispatchEvent(new CustomEvent(WALLET_ACTIVE_CHANGED_EVENT))

    await waitFor(() => expect(screen.getByText(/0xbbbb/)).toBeDefined())
    expect(screen.queryByText(/0xaaaa/)).toBeNull()
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
