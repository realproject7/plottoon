import { useState, useEffect, useCallback } from 'react'

interface WalletOption {
  type: 'create-new' | 'reuse-existing'
  source: string
  address?: string
  name?: string
  available?: boolean
  unavailableReason?: string
}

interface ConnectedWallet {
  connected: boolean
  address?: string
  source?: string
  name?: string
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
        getConnected: () => Promise<ConnectedWallet>
        disconnect: () => Promise<{ success: boolean }>
        getSignerMode: () => Promise<{ mode: string }>
      }
    }
  }
}

function truncateAddress(address: string): string {
  if (address.length <= 12) return address
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}

function optionLabel(option: WalletOption): string {
  if (option.type === 'create-new') {
    return option.available === false ? 'Create wallet (unavailable)' : 'Create new wallet'
  }
  if (option.address && option.name) {
    return `Reuse ${truncateAddress(option.address)}`
  }
  return 'Reuse wallet'
}

export function WalletSelector(): JSX.Element {
  const [options, setOptions] = useState<WalletOption[]>([])
  const [connected, setConnected] = useState<ConnectedWallet>({ connected: false })
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const [optionsResult, connectedResult] = await Promise.all([
        window.plottoon.wallet.getOptions(),
        window.plottoon.wallet.getConnected()
      ])
      setOptions(optionsResult.options)
      setConnected(connectedResult)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load wallet options')
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    Promise.all([window.plottoon.wallet.getOptions(), window.plottoon.wallet.getConnected()])
      .then(([optionsResult, connectedResult]) => {
        if (!cancelled) {
          setOptions(optionsResult.options)
          setConnected(connectedResult)
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load wallet options')
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  const handleConnect = async (option: WalletOption): Promise<void> => {
    if (option.available === false) {
      setError(option.unavailableReason ?? 'Wallet option is not available')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const result = await window.plottoon.wallet.connect(option)
      if (result.success) {
        await refresh()
      } else {
        setError(result.error ?? 'Connection failed')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Wallet connection failed')
    } finally {
      setLoading(false)
    }
  }

  const handleDisconnect = async (): Promise<void> => {
    await window.plottoon.wallet.disconnect()
    await refresh()
  }

  if (connected.connected && connected.address) {
    return (
      <div className="wallet-selector">
        <div className="wallet-selector__label">Wallet</div>
        <div className="wallet-connected">
          <span
            className="wallet-pill"
            role="status"
            aria-label={`Connected wallet ${connected.address}`}
            title={connected.address}
          >
            <span className="wallet-pill__address">{truncateAddress(connected.address)}</span>
          </span>
          <button
            type="button"
            className="wallet-disconnect"
            onClick={handleDisconnect}
            aria-label="Disconnect wallet"
          >
            disconnect
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="wallet-selector">
      <div className="wallet-selector__label">Wallet</div>
      {error && <div className="wallet-error">{error}</div>}
      <ul className="wallet-selector__options">
        {options.map((option, i) => {
          const isUnavailable = option.available === false
          const label = optionLabel(option)
          const fullAddress = option.address
          return (
            <li key={i} className="wallet-selector__option">
              <button
                type="button"
                className="wallet-pill"
                onClick={() => handleConnect(option)}
                disabled={loading || isUnavailable}
                title={isUnavailable ? option.unavailableReason : fullAddress}
              >
                <span className="wallet-pill__label">{label}</span>
              </button>
              {isUnavailable && option.unavailableReason && (
                <span className="wallet-option-reason">{option.unavailableReason}</span>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
