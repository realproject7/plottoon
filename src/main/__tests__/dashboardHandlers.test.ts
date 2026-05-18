import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ipcMain } from 'electron'
import { registerDashboardHandlers } from '../ipc/dashboardHandlers'
import type { DashboardDeps, DashboardData } from '../services/dashboardData'

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn()
  }
}))

vi.mock('../services/dashboardData', () => ({
  buildDashboardData: vi.fn()
}))

type IpcHandler = (...args: unknown[]) => unknown

function getHandler(channel: string): IpcHandler {
  const calls = (ipcMain.handle as ReturnType<typeof vi.fn>).mock.calls
  const match = calls.find((c: unknown[]) => c[0] === channel)
  if (!match) throw new Error(`No handler registered for ${channel}`)
  return match[1] as IpcHandler
}

describe('dashboard:getData', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('registers the dashboard:getData handler', () => {
    registerDashboardHandlers({
      getDashboardDeps: () => ({ getWallet: () => null })
    })
    const calls = (ipcMain.handle as ReturnType<typeof vi.fn>).mock.calls
    expect(calls.some((c: unknown[]) => c[0] === 'dashboard:getData')).toBe(true)
  })

  it('calls buildDashboardData with deps from getDashboardDeps', async () => {
    const { buildDashboardData } = await import('../services/dashboardData')
    const mockData: DashboardData = {
      counts: {
        totalProjects: 1,
        totalPlots: 2,
        publishedPlots: 1,
        pendingPlots: 1,
        notIndexedPlots: 0,
        failedPlots: 0
      },
      storylines: [],
      localGroups: [],
      wallet: {
        address: null,
        source: null,
        connected: false,
        balanceWei: null,
        balanceError: null
      },
      tokenPrice: { ethUsd: null, error: null },
      royalty: { earnedWei: null, claimedWei: null, unclaimedWei: null, error: null },
      generatedAt: '2026-05-18T00:00:00Z'
    }
    ;(buildDashboardData as ReturnType<typeof vi.fn>).mockResolvedValue(mockData)

    const mockDeps: DashboardDeps = { getWallet: () => null }
    registerDashboardHandlers({ getDashboardDeps: () => mockDeps })

    const handler = getHandler('dashboard:getData')
    const result = await handler()

    expect(buildDashboardData).toHaveBeenCalledWith(mockDeps)
    expect(result).toBe(mockData)
  })
})
