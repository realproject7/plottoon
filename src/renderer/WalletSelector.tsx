import { useState, useEffect, useCallback } from 'react'

interface WalletOption {
  type: 'create-new' | 'reuse-existing'
  source: string
  address?: string
  name?: string
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

export function WalletSelector() {
  const [options, setOptions] = useState<WalletOption[]>([])
  const [connected, setConnected] = useState<ConnectedWallet>({ connected: false })
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    const [optionsResult, connectedResult] = await Promise.all([
      window.plottoon.wallet.getOptions(),
      window.plottoon.wallet.getConnected()
    ])
    setOptions(optionsResult.options)
    setConnected(connectedResult)
  }, [])

  useEffect(() => {
    let cancelled = false
    Promise.all([window.plottoon.wallet.getOptions(), window.plottoon.wallet.getConnected()]).then(
      ([optionsResult, connectedResult]) => {
        if (!cancelled) {
          setOptions(optionsResult.options)
          setConnected(connectedResult)
        }
      }
    )
    return () => {
      cancelled = true
    }
  }, [])

  const handleConnect = async (option: WalletOption) => {
    setLoading(true)
    setError(null)
    const result = await window.plottoon.wallet.connect(option)
    if (result.success) {
      await refresh()
    } else {
      setError(result.error ?? 'Connection failed')
    }
    setLoading(false)
  }

  const handleDisconnect = async () => {
    await window.plottoon.wallet.disconnect()
    await refresh()
  }

  if (connected.connected) {
    return (
      <div className="wallet-connected">
        <div className="wallet-info">
          <span className="wallet-address">{connected.address}</span>
          <span className="wallet-source">{connected.source}</span>
        </div>
        <button onClick={handleDisconnect} type="button">
          Disconnect
        </button>
      </div>
    )
  }

  return (
    <div className="wallet-selector">
      <h3>Connect Wallet</h3>
      {error && <div className="wallet-error">{error}</div>}
      <ul className="wallet-options">
        {options.map((option, i) => (
          <li key={i}>
            <button onClick={() => handleConnect(option)} disabled={loading} type="button">
              {option.type === 'create-new'
                ? 'Create new PlotToon wallet'
                : `Reuse ${option.name} (${option.address})`}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
