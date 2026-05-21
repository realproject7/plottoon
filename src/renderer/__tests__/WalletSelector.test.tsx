// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { WalletSelector } from '../WalletSelector'

type WalletApi = Window['plottoon']['wallet']

function installWalletApi(overrides: Partial<WalletApi> = {}): WalletApi {
  const defaults: WalletApi = {
    getOptions: vi.fn().mockResolvedValue({ options: [] }),
    connect: vi.fn().mockResolvedValue({ success: true }),
    getConnected: vi.fn().mockResolvedValue({ connected: false }),
    disconnect: vi.fn().mockResolvedValue({ success: true }),
    getSignerMode: vi.fn().mockResolvedValue({ mode: 'mock' })
  }
  const api = { ...defaults, ...overrides }
  ;(window as unknown as { plottoon: { wallet: WalletApi } }).plottoon = { wallet: api }
  return api
}

beforeEach(() => {
  installWalletApi()
})

afterEach(cleanup)

describe('WalletSelector', () => {
  it('renders create-new option as enabled when available', async () => {
    installWalletApi({
      getOptions: vi
        .fn()
        .mockResolvedValue({ options: [{ type: 'create-new', source: 'plottoon-writer' }] })
    })
    render(<WalletSelector />)
    const button = await screen.findByRole('button', { name: 'Create new PlotToon wallet' })
    expect((button as HTMLButtonElement).disabled).toBe(false)
  })

  it('renders create-new option as disabled with reason when OWS unavailable', async () => {
    installWalletApi({
      getOptions: vi.fn().mockResolvedValue({
        options: [
          {
            type: 'create-new',
            source: 'plottoon-writer',
            available: false,
            unavailableReason: 'OWS native module is not available'
          }
        ]
      })
    })
    render(<WalletSelector />)
    const button = await screen.findByRole('button', {
      name: 'Create new PlotToon wallet (unavailable)'
    })
    expect((button as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText('OWS native module is not available')).toBeDefined()
  })

  it('shows inline error when wallet.connect resolves with success:false', async () => {
    installWalletApi({
      getOptions: vi
        .fn()
        .mockResolvedValue({ options: [{ type: 'create-new', source: 'plottoon-writer' }] }),
      connect: vi
        .fn()
        .mockResolvedValue({ success: false, error: 'OWS native module is not available' })
    })
    render(<WalletSelector />)
    const button = await screen.findByRole('button', { name: 'Create new PlotToon wallet' })
    fireEvent.click(button)
    await waitFor(() => {
      expect(screen.getByText('OWS native module is not available')).toBeDefined()
    })
  })

  it('shows inline error when wallet.connect IPC call rejects', async () => {
    installWalletApi({
      getOptions: vi
        .fn()
        .mockResolvedValue({ options: [{ type: 'create-new', source: 'plottoon-writer' }] }),
      connect: vi.fn().mockRejectedValue(new Error('ipc bridge unavailable'))
    })
    render(<WalletSelector />)
    const button = await screen.findByRole('button', { name: 'Create new PlotToon wallet' })
    fireEvent.click(button)
    await waitFor(() => {
      expect(screen.getByText('ipc bridge unavailable')).toBeDefined()
    })
    expect((button as HTMLButtonElement).disabled).toBe(false)
  })

  it('clicking a disabled option surfaces the unavailable reason without invoking connect', async () => {
    const connect = vi.fn().mockResolvedValue({ success: true })
    installWalletApi({
      getOptions: vi.fn().mockResolvedValue({
        options: [
          {
            type: 'create-new',
            source: 'plottoon-writer',
            available: false,
            unavailableReason: 'OWS native module is not available'
          }
        ]
      }),
      connect
    })
    render(<WalletSelector />)
    const button = await screen.findByRole('button', {
      name: 'Create new PlotToon wallet (unavailable)'
    })
    fireEvent.click(button)
    await waitFor(() => {
      const matches = screen.getAllByText('OWS native module is not available')
      expect(matches.length).toBeGreaterThan(0)
    })
    expect(connect).not.toHaveBeenCalled()
  })
})
