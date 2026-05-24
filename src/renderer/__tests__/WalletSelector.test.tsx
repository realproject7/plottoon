// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { WalletSelector } from '../WalletSelector'
import type { WalletIdentityView } from '../../shared/walletIdentity'

type WalletApi = Window['plottoon']['wallet']

function installWalletApi(overrides: Partial<WalletApi> = {}): WalletApi {
  const defaults: WalletApi = {
    getOptions: vi.fn().mockResolvedValue({ options: [] }),
    connect: vi.fn().mockResolvedValue({ success: true }),
    getConnected: vi.fn().mockResolvedValue({ connected: false }),
    disconnect: vi.fn().mockResolvedValue({ success: true }),
    getSignerMode: vi.fn().mockResolvedValue({ mode: 'mock' }),
    listIdentities: vi.fn().mockResolvedValue({ identities: [] }),
    getActiveIdentity: vi.fn().mockResolvedValue({ identity: null }),
    setActiveIdentity: vi.fn().mockResolvedValue({ identity: null })
  }
  const api = { ...defaults, ...overrides }
  ;(window as unknown as { plottoon: { wallet: WalletApi } }).plottoon = { wallet: api }
  return api
}

// Fake test wallets only. Never real addresses, never any private material.
const FAKE_A: WalletIdentityView = {
  address: '0xaaaa000000000000000000000000000000000001',
  source: 'plottoon-writer'
}
const FAKE_B: WalletIdentityView = {
  address: '0xbbbb000000000000000000000000000000000002',
  source: 'plotlink-writer',
  label: 'Secondary'
}

beforeEach(() => {
  installWalletApi()
})

afterEach(cleanup)

describe('WalletSelector — empty state', () => {
  it('renders the Connect wallet trigger when no identity is active', async () => {
    render(<WalletSelector />)
    const trigger = await screen.findByTestId('wallet-switcher-trigger')
    expect(trigger.textContent).toContain('Connect wallet')
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
  })

  it('opens the popover when the trigger is clicked', async () => {
    installWalletApi({
      getOptions: vi
        .fn()
        .mockResolvedValue({ options: [{ type: 'create-new', source: 'plottoon-writer' }] })
    })
    render(<WalletSelector />)
    const trigger = await screen.findByTestId('wallet-switcher-trigger')
    fireEvent.click(trigger)
    await waitFor(() => {
      expect(screen.getByTestId('wallet-switcher-popover')).toBeDefined()
    })
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText('Create new PlotToon wallet')).toBeDefined()
  })
})

describe('WalletSelector — active identity', () => {
  it('shows the truncated active address in the trigger and a check mark in the popover', async () => {
    installWalletApi({
      listIdentities: vi.fn().mockResolvedValue({ identities: [FAKE_A] }),
      getActiveIdentity: vi.fn().mockResolvedValue({ identity: FAKE_A })
    })
    render(<WalletSelector />)
    const trigger = await screen.findByTestId('wallet-switcher-trigger')
    await waitFor(() => expect(trigger.textContent).toContain('0xaaaa'))
    fireEvent.click(trigger)
    const row = await screen.findByTestId(`wallet-switcher-item-${FAKE_A.address}`)
    expect(row.textContent).toContain('✓')
    expect((row as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('WalletSelector — switching between two fake identities', () => {
  it('switches the active wallet via setActiveIdentity and updates the renderer without restart', async () => {
    const setActiveIdentity = vi.fn(async (address: string) => {
      if (address === FAKE_B.address) return { identity: FAKE_B }
      return { identity: null, error: 'Unknown' }
    })
    installWalletApi({
      listIdentities: vi.fn().mockResolvedValue({ identities: [FAKE_A, FAKE_B] }),
      getActiveIdentity: vi.fn().mockResolvedValue({ identity: FAKE_A }),
      setActiveIdentity
    })
    render(<WalletSelector />)
    const trigger = await screen.findByTestId('wallet-switcher-trigger')
    await waitFor(() => expect(trigger.textContent).toContain('0xaaaa'))
    fireEvent.click(trigger)
    const targetRow = await screen.findByTestId(`wallet-switcher-item-${FAKE_B.address}`)
    fireEvent.click(targetRow)
    await waitFor(() => {
      expect(setActiveIdentity).toHaveBeenCalledWith(FAKE_B.address)
    })
    await waitFor(() => expect(trigger.textContent).toContain('0xbbbb'))
  })

  it('reports a setActiveIdentity error inline without changing the active state', async () => {
    installWalletApi({
      listIdentities: vi.fn().mockResolvedValue({ identities: [FAKE_A, FAKE_B] }),
      getActiveIdentity: vi.fn().mockResolvedValue({ identity: FAKE_A }),
      setActiveIdentity: vi
        .fn()
        .mockResolvedValue({ identity: null, error: 'Unknown wallet address' })
    })
    render(<WalletSelector />)
    const trigger = await screen.findByTestId('wallet-switcher-trigger')
    await waitFor(() => expect(trigger.textContent).toContain('0xaaaa'))
    fireEvent.click(trigger)
    const targetRow = await screen.findByTestId(`wallet-switcher-item-${FAKE_B.address}`)
    fireEvent.click(targetRow)
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('Unknown wallet address')
    })
    expect(trigger.textContent).toContain('0xaaaa')
  })
})

describe('WalletSelector — create + reuse actions', () => {
  it('renders Create new PlotToon wallet and triggers connect on click', async () => {
    const connect = vi.fn().mockResolvedValue({ success: true })
    installWalletApi({
      getOptions: vi
        .fn()
        .mockResolvedValue({ options: [{ type: 'create-new', source: 'plottoon-writer' }] }),
      connect
    })
    render(<WalletSelector />)
    fireEvent.click(await screen.findByTestId('wallet-switcher-trigger'))
    const action = await screen.findByText('Create new PlotToon wallet')
    fireEvent.click(action)
    await waitFor(() => {
      expect(connect).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'create-new', source: 'plottoon-writer' })
      )
    })
  })

  it('renders the disabled create action with its reason when OWS is unavailable', async () => {
    installWalletApi({
      getOptions: vi.fn().mockResolvedValue({
        options: [
          {
            type: 'create-new',
            source: 'plottoon-writer',
            available: false,
            unavailableReason: 'OWS wallet module is unavailable'
          }
        ]
      })
    })
    render(<WalletSelector />)
    fireEvent.click(await screen.findByTestId('wallet-switcher-trigger'))
    const action = await screen.findByText('Create new wallet (unavailable)')
    expect((action.closest('button') as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText('OWS wallet module is unavailable')).toBeDefined()
  })

  it('#245 — does not render Reuse for an address that is already listed under Switch wallet (IPC-level filter)', async () => {
    // After #245, the main-process `wallet:getOptions` handler drops
    // reuse-existing options whose address is already a known identity.
    // The renderer simply renders what it gets back — this test pins the
    // IPC contract so a regression that re-introduces the duplicate at
    // the IPC boundary would be caught at the renderer level too.
    installWalletApi({
      listIdentities: vi.fn().mockResolvedValue({ identities: [FAKE_B] }),
      getActiveIdentity: vi.fn().mockResolvedValue({ identity: FAKE_B }),
      getOptions: vi.fn().mockResolvedValue({
        options: [
          // create-new is always present
          { type: 'create-new', source: 'plottoon-writer' },
          // FAKE_B (already in identities) is filtered out by the main
          // process; a genuinely new reuse candidate still appears.
          {
            type: 'reuse-existing',
            source: 'plotlink-writer',
            address: '0xcccc000000000000000000000000000000000003'
          }
        ]
      })
    })
    render(<WalletSelector />)
    fireEvent.click(await screen.findByTestId('wallet-switcher-trigger'))
    // The already-added wallet renders under Switch wallet…
    expect(await screen.findByTestId(`wallet-switcher-item-${FAKE_B.address}`)).toBeDefined()
    // …and the genuinely-new wallet renders under Add wallet…
    expect(await screen.findByText(/Reuse 0xcccc/)).toBeDefined()
    // …but FAKE_B's address never appears as a Reuse 0xbbbb action.
    expect(screen.queryByText(/Reuse 0xbbbb/)).toBeNull()
    // Create-new must remain available.
    expect(screen.getByText('Create new PlotToon wallet')).toBeDefined()
  })

  it('shows a Reuse action for a plotlink-ows identity with a truncated address', async () => {
    const connect = vi.fn().mockResolvedValue({ success: true })
    installWalletApi({
      getOptions: vi.fn().mockResolvedValue({
        options: [
          {
            type: 'reuse-existing',
            source: 'plotlink-writer',
            address: '0xbbbb000000000000000000000000000000000002',
            name: 'plotlink-writer-fake'
          }
        ]
      }),
      connect
    })
    render(<WalletSelector />)
    fireEvent.click(await screen.findByTestId('wallet-switcher-trigger'))
    const action = await screen.findByText(/Reuse 0xbbbb/)
    fireEvent.click(action)
    await waitFor(() => {
      expect(connect).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'reuse-existing', source: 'plotlink-writer' })
      )
    })
  })
})

describe('WalletSelector — disconnect + safety', () => {
  it('shows a Disconnect action when an identity is active', async () => {
    const disconnect = vi.fn().mockResolvedValue({ success: true })
    installWalletApi({
      listIdentities: vi.fn().mockResolvedValue({ identities: [FAKE_A] }),
      getActiveIdentity: vi.fn().mockResolvedValue({ identity: FAKE_A }),
      disconnect
    })
    render(<WalletSelector />)
    fireEvent.click(await screen.findByTestId('wallet-switcher-trigger'))
    const disconnectBtn = await screen.findByTestId('wallet-switcher-disconnect')
    fireEvent.click(disconnectBtn)
    await waitFor(() => expect(disconnect).toHaveBeenCalledTimes(1))
  })

  it('never renders OWS names, vault paths, or other private-material strings', async () => {
    installWalletApi({
      listIdentities: vi.fn().mockResolvedValue({ identities: [FAKE_A, FAKE_B] }),
      getActiveIdentity: vi.fn().mockResolvedValue({ identity: FAKE_A }),
      getOptions: vi.fn().mockResolvedValue({
        options: [
          { type: 'create-new', source: 'plottoon-writer' },
          {
            type: 'reuse-existing',
            source: 'plotlink-writer',
            address: '0xcccc000000000000000000000000000000000003',
            name: 'plotlink-writer-secret-name'
          }
        ]
      })
    })
    const { container } = render(<WalletSelector />)
    fireEvent.click(await screen.findByTestId('wallet-switcher-trigger'))
    await screen.findByTestId('wallet-switcher-popover')
    const html = container.innerHTML
    // Banned strings — the renderer must never carry the OWS internal name,
    // vault paths, or wallet-secret terminology.
    expect(html).not.toMatch(/plotlink-writer-secret-name/i)
    expect(html).not.toMatch(/privateKey|mnemonic|passphrase|vaultPath/i)
  })

  it('closes the popover on Escape', async () => {
    render(<WalletSelector />)
    fireEvent.click(await screen.findByTestId('wallet-switcher-trigger'))
    await screen.findByTestId('wallet-switcher-popover')
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => {
      expect(screen.queryByTestId('wallet-switcher-popover')).toBeNull()
    })
  })
})
