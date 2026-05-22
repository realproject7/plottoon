import { useState, useEffect, useRef, useCallback } from 'react'
import type { WalletIdentityView } from '../shared/walletIdentity'

interface WalletOption {
  type: 'create-new' | 'reuse-existing'
  source: string
  address?: string
  name?: string
  available?: boolean
  unavailableReason?: string
}

declare global {
  interface Window {
    plottoon: {
      wallet: {
        getOptions: () => Promise<{ options: WalletOption[] }>
        connect: (option: WalletOption) => Promise<{
          success: boolean
          wallet?: { address: string; source: string; name: string }
          error?: string
        }>
        getConnected: () => Promise<{ connected: boolean; address?: string; source?: string }>
        disconnect: () => Promise<{ success: boolean }>
        getSignerMode: () => Promise<{ mode: string }>
        listIdentities: () => Promise<{ identities: WalletIdentityView[] }>
        getActiveIdentity: () => Promise<{ identity: WalletIdentityView | null }>
        setActiveIdentity: (
          address: string
        ) => Promise<{ identity: WalletIdentityView | null; error?: string }>
      }
    }
  }
}

function truncateAddress(address: string): string {
  if (address.length <= 12) return address
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}

function sourceLabel(source: string): string {
  if (source === 'plotlink-writer') return 'plotlink'
  return 'plottoon'
}

interface State {
  identities: WalletIdentityView[]
  active: WalletIdentityView | null
  options: WalletOption[]
  error: string | null
  loading: boolean
  open: boolean
}

const INITIAL_STATE: State = {
  identities: [],
  active: null,
  options: [],
  error: null,
  loading: false,
  open: false
}

export function WalletSelector(): JSX.Element {
  const [state, setState] = useState<State>(INITIAL_STATE)
  const containerRef = useRef<HTMLDivElement>(null)

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const [identitiesResult, activeResult, optionsResult] = await Promise.all([
        window.plottoon.wallet.listIdentities(),
        window.plottoon.wallet.getActiveIdentity(),
        window.plottoon.wallet.getOptions()
      ])
      setState((s) => ({
        ...s,
        identities: identitiesResult.identities,
        active: activeResult.identity,
        options: optionsResult.options
      }))
    } catch (err) {
      setState((s) => ({
        ...s,
        error: err instanceof Error ? err.message : 'Failed to load wallet state'
      }))
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const [identitiesResult, activeResult, optionsResult] = await Promise.all([
          window.plottoon.wallet.listIdentities(),
          window.plottoon.wallet.getActiveIdentity(),
          window.plottoon.wallet.getOptions()
        ])
        if (!cancelled) {
          setState((s) => ({
            ...s,
            identities: identitiesResult.identities,
            active: activeResult.identity,
            options: optionsResult.options
          }))
        }
      } catch (err) {
        if (!cancelled) {
          setState((s) => ({
            ...s,
            error: err instanceof Error ? err.message : 'Failed to load wallet state'
          }))
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // Close the popover when the user clicks outside the switcher container.
  useEffect(() => {
    if (!state.open) return
    function handlePointer(event: MouseEvent): void {
      if (!containerRef.current) return
      if (!containerRef.current.contains(event.target as Node)) {
        setState((s) => ({ ...s, open: false }))
      }
    }
    function handleKey(event: KeyboardEvent): void {
      if (event.key === 'Escape') setState((s) => ({ ...s, open: false }))
    }
    document.addEventListener('mousedown', handlePointer)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handlePointer)
      document.removeEventListener('keydown', handleKey)
    }
  }, [state.open])

  const setOpen = (open: boolean): void =>
    setState((s) => ({ ...s, open, error: open ? null : s.error }))

  const handleSwitch = async (address: string): Promise<void> => {
    setState((s) => ({ ...s, loading: true, error: null }))
    try {
      const result = await window.plottoon.wallet.setActiveIdentity(address)
      if (!result.identity) {
        setState((s) => ({
          ...s,
          loading: false,
          error: result.error ?? 'Could not switch wallet'
        }))
        return
      }
      setState((s) => ({ ...s, active: result.identity, loading: false, open: false }))
    } catch (err) {
      setState((s) => ({
        ...s,
        loading: false,
        error: err instanceof Error ? err.message : 'Wallet switch failed'
      }))
    }
  }

  const handleConnect = async (option: WalletOption): Promise<void> => {
    if (option.available === false) {
      setState((s) => ({
        ...s,
        error: option.unavailableReason ?? 'Wallet option is not available'
      }))
      return
    }
    setState((s) => ({ ...s, loading: true, error: null }))
    try {
      const result = await window.plottoon.wallet.connect(option)
      if (!result.success) {
        setState((s) => ({
          ...s,
          loading: false,
          error: result.error ?? 'Connection failed'
        }))
        return
      }
      await refresh()
      setState((s) => ({ ...s, loading: false, open: false }))
    } catch (err) {
      setState((s) => ({
        ...s,
        loading: false,
        error: err instanceof Error ? err.message : 'Wallet connection failed'
      }))
    }
  }

  const handleDisconnect = async (): Promise<void> => {
    setState((s) => ({ ...s, loading: true, error: null }))
    try {
      await window.plottoon.wallet.disconnect()
      await refresh()
      setState((s) => ({ ...s, loading: false, open: false, active: null }))
    } catch (err) {
      setState((s) => ({
        ...s,
        loading: false,
        error: err instanceof Error ? err.message : 'Disconnect failed'
      }))
    }
  }

  const triggerLabel = state.active ? truncateAddress(state.active.address) : 'Connect wallet'

  return (
    <div className="wallet-selector" ref={containerRef}>
      <div className="wallet-selector__label">Wallet</div>
      <div className="wallet-switcher">
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={state.open}
          className={`wallet-switcher__trigger${
            state.active ? '' : ' wallet-switcher__trigger--inactive'
          }`}
          onClick={() => setOpen(!state.open)}
          title={state.active?.address ?? undefined}
          data-testid="wallet-switcher-trigger"
        >
          <span className="wallet-switcher__trigger-address">{triggerLabel}</span>
          <svg
            className="wallet-switcher__trigger-chevron"
            viewBox="0 0 12 12"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <polyline points="3 4.5 6 7.5 9 4.5" />
          </svg>
        </button>

        {state.open && (
          <div
            className="wallet-switcher__popover"
            role="menu"
            data-testid="wallet-switcher-popover"
          >
            {state.identities.length > 0 && (
              <>
                <div className="wallet-switcher__section-label">Switch wallet</div>
                {state.identities.map((identity) => {
                  const isActive = state.active?.address === identity.address
                  return (
                    <button
                      key={identity.address}
                      type="button"
                      role="menuitem"
                      className={`wallet-switcher__item${
                        isActive ? ' wallet-switcher__item--active' : ''
                      }`}
                      onClick={() => handleSwitch(identity.address)}
                      disabled={state.loading || isActive}
                      title={identity.address}
                      data-testid={`wallet-switcher-item-${identity.address}`}
                    >
                      <span className="wallet-switcher__item-address">
                        {identity.label
                          ? `${identity.label} · ${truncateAddress(identity.address)}`
                          : truncateAddress(identity.address)}
                      </span>
                      <span className="wallet-switcher__item-source">
                        {sourceLabel(identity.source)}
                      </span>
                      <span className="wallet-switcher__item-check" aria-hidden="true">
                        {isActive ? '✓' : ''}
                      </span>
                    </button>
                  )
                })}
                <div className="wallet-switcher__divider" />
              </>
            )}

            <div className="wallet-switcher__section-label">Add wallet</div>
            {state.options.length === 0 && (
              <div className="wallet-switcher__empty">No connection options available.</div>
            )}
            {state.options.map((option, i) => {
              const isUnavailable = option.available === false
              return (
                <button
                  key={`${option.type}-${option.address ?? option.name ?? i}`}
                  type="button"
                  role="menuitem"
                  className="wallet-switcher__action"
                  onClick={() => handleConnect(option)}
                  disabled={state.loading || isUnavailable}
                  title={isUnavailable ? option.unavailableReason : option.address}
                  data-testid={`wallet-switcher-action-${option.type}-${option.address ?? i}`}
                >
                  <span className="wallet-switcher__item-address">
                    {option.type === 'create-new'
                      ? isUnavailable
                        ? 'Create new wallet (unavailable)'
                        : 'Create new PlotToon wallet'
                      : option.address
                        ? `Reuse ${truncateAddress(option.address)}`
                        : 'Reuse wallet'}
                  </span>
                  <span className="wallet-switcher__item-source">{sourceLabel(option.source)}</span>
                </button>
              )
            })}
            {state.options.some((o) => o.available === false && o.unavailableReason) && (
              <div className="wallet-option-reason" role="status">
                {
                  state.options.find((o) => o.available === false && o.unavailableReason)
                    ?.unavailableReason
                }
              </div>
            )}

            {state.active && (
              <>
                <div className="wallet-switcher__divider" />
                <button
                  type="button"
                  role="menuitem"
                  className="wallet-switcher__action wallet-switcher__action--danger"
                  onClick={handleDisconnect}
                  disabled={state.loading}
                  data-testid="wallet-switcher-disconnect"
                >
                  Disconnect
                </button>
              </>
            )}
          </div>
        )}
      </div>
      {state.error && (
        <div className="wallet-error" role="alert">
          {state.error}
        </div>
      )}
    </div>
  )
}
