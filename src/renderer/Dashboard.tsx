import { useState, useEffect, useCallback } from 'react'
import { WALLET_ACTIVE_CHANGED_EVENT } from '../shared/walletIdentity'

type LoadState = 'loading' | 'loaded' | 'error'

function formatWei(wei: string): string {
  const n = BigInt(wei)
  const eth = Number(n) / 1e18
  if (eth === 0) return '0 ETH'
  if (eth < 0.0001) return '<0.0001 ETH'
  return `${eth.toFixed(4)} ETH`
}

function formatGasWei(wei: string): string {
  const n = BigInt(wei)
  if (n === BigInt(0)) return '0'
  const gwei = Number(n) / 1e9
  if (gwei < 1) return '<1 gwei'
  return `${gwei.toFixed(0)} gwei`
}

function truncateAddress(addr: string): string {
  if (addr.length <= 12) return addr
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

function StatCard({
  label,
  value,
  accent
}: {
  label: string
  value: string | number
  accent?: boolean
}) {
  return (
    <div className="dash-card">
      <div className="dash-card__label">{label}</div>
      <div className={`dash-card__value${accent ? ' dash-card__value--accent' : ''}`}>{value}</div>
    </div>
  )
}

function PlotStateBadge({ state }: { state: string }) {
  return <span className={`plot-state plot-state--${state}`}>{state}</span>
}

function PlotRow({ plot }: { plot: DashboardPlotEntry }) {
  return (
    <div className="plot-row">
      <span className="plot-row__title" title={plot.plotTitle}>
        {plot.plotTitle}
      </span>
      <span className="plot-row__count">{plot.cutCount} cuts</span>
      <PlotStateBadge state={plot.plotState} />
      {plot.publishResult?.txHash && (
        <a
          href={`https://basescan.org/tx/${plot.publishResult.txHash}`}
          target="_blank"
          rel="noopener noreferrer"
          className="plot-row__link"
        >
          Tx
        </a>
      )}
      {plot.publishResult?.plotlinkUrl && (
        <a
          href={plot.publishResult.plotlinkUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="plot-row__link plot-row__link--accent"
        >
          View →
        </a>
      )}
    </div>
  )
}

function StorylineCard({ group }: { group: DashboardStorylineGroup }) {
  return (
    <div className="dash-card dash-card--group">
      <div className="dash-card__group-header">
        <div style={{ minWidth: 0 }}>
          <div className="dash-card__group-title" title={group.projectName}>
            {group.projectName}
          </div>
          <div className="dash-card__group-id" title={group.storylineId}>
            {truncateAddress(group.storylineId)}
          </div>
        </div>
        <div className="dash-card__group-meta">
          <div>
            {group.publishedCount} published
            {group.notIndexedCount > 0 && (
              <span style={{ color: 'var(--color-warning)' }}>
                {' '}
                · {group.notIndexedCount} not indexed
              </span>
            )}
          </div>
          <div className="dash-card__group-meta-muted">
            Cost: {formatGasWei(group.totalPublishCostWei)}
          </div>
        </div>
      </div>
      {group.plots.map((plot) => (
        <PlotRow key={plot.plotSlug} plot={plot} />
      ))}
    </div>
  )
}

function LocalGroupCard({ group }: { group: DashboardLocalGroup }) {
  return (
    <div className="dash-card dash-card--group">
      <div className="dash-card__group-title" title={group.projectName}>
        {group.projectName}
      </div>
      {group.plots.map((plot) => (
        <PlotRow key={plot.plotSlug} plot={plot} />
      ))}
    </div>
  )
}

function WalletCard({ wallet }: { wallet: DashboardWalletSummary }) {
  if (!wallet.connected) {
    return (
      <div className="dash-card">
        <div className="dash-card__label">Wallet</div>
        <div className="dash-card__sub">Not connected</div>
      </div>
    )
  }
  return (
    <div className="dash-card">
      <div className="dash-card__label">Wallet</div>
      <div className="dash-card__mono" title={wallet.address ?? undefined}>
        {truncateAddress(wallet.address!)}
      </div>
      <div className="dash-card__sub">{wallet.source}</div>
      {wallet.balanceWei && <div className="dash-card__value">{formatWei(wallet.balanceWei)}</div>}
      {wallet.balanceError && <div className="dash-card__danger">{wallet.balanceError}</div>}
    </div>
  )
}

function RoyaltyClaimCard({
  walletConnected,
  walletAddress,
  dashboardRoyalty
}: {
  walletConnected: boolean
  walletAddress: string | null
  dashboardRoyalty: DashboardRoyaltySummary
}) {
  const [royaltyInfo, setRoyaltyInfo] = useState<RoyaltyInfoResult | null>(null)
  const [claiming, setClaiming] = useState(false)
  const [claimResult, setClaimResult] = useState<RoyaltyClaimResult | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [claimHistory, setClaimHistory] = useState<RoyaltyClaimRecord[]>([])

  useEffect(() => {
    if (!walletConnected) return
    let cancelled = false
    window.plottoon.royalty.getInfo().then(
      (result) => {
        if (!cancelled) setRoyaltyInfo(result)
      },
      () => {}
    )
    window.plottoon.royalty.getClaimHistory().then(
      (result) => {
        if (!cancelled) setClaimHistory(result.claims)
      },
      () => {}
    )
    return () => {
      cancelled = true
    }
  }, [walletConnected])

  const info = royaltyInfo?.info
  const hasUnclaimed = info && BigInt(info.unclaimedWei) > BigInt(0)

  const handleClaim = async () => {
    setClaiming(true)
    setClaimResult(null)
    setConfirmOpen(false)
    try {
      const result = await window.plottoon.royalty.claim(true)
      setClaimResult(result)
      if (result.success && walletConnected) {
        window.plottoon.royalty
          .getInfo()
          .then((r) => setRoyaltyInfo(r))
          .catch(() => {})
        window.plottoon.royalty
          .getClaimHistory()
          .then((r) => setClaimHistory(r.claims))
          .catch(() => {})
      }
    } catch (err) {
      setClaimResult({
        success: false,
        error: err instanceof Error ? err.message : 'Claim failed'
      })
    }
    setClaiming(false)
  }

  if (!walletConnected) return null

  if (dashboardRoyalty.error && !info) {
    return (
      <div className="dash-card">
        <div className="dash-card__label">Royalties</div>
        <div className="dash-card__danger">{dashboardRoyalty.error}</div>
      </div>
    )
  }

  const earned = info?.earnedWei ?? dashboardRoyalty.earnedWei
  const unclaimed = info?.unclaimedWei ?? dashboardRoyalty.unclaimedWei

  if (!earned && !dashboardRoyalty.earnedWei) return null

  return (
    <div className="dash-card">
      <div className="dash-card__label">Royalties</div>
      {earned && (
        <div className="dash-card__sub">
          <span style={{ fontWeight: 500, color: 'var(--fg)' }}>Earned:</span> {formatWei(earned)}
        </div>
      )}
      {unclaimed && unclaimed !== '0' && (
        <div className="dash-card__sub" style={{ color: 'var(--accent)' }}>
          <span style={{ fontWeight: 500 }}>Unclaimed:</span> {formatWei(unclaimed)}
        </div>
      )}
      {hasUnclaimed && !confirmOpen && !claiming && (
        <button
          type="button"
          className="btn-primary"
          style={{ marginTop: 'var(--space-2)', fontSize: 12 }}
          onClick={() => setConfirmOpen(true)}
        >
          Claim Royalties
        </button>
      )}
      {confirmOpen && !claiming && (
        <div style={{ marginTop: 'var(--space-2)', fontSize: 12 }} data-testid="royalty-confirm">
          <div>Claim {formatWei(info!.unclaimedWei)} to your wallet?</div>
          {walletAddress && (
            <div
              style={{ color: 'var(--muted)', fontFamily: 'var(--font-mono)', marginTop: 2 }}
              data-testid="royalty-confirm-wallet"
            >
              as {truncateAddress(walletAddress)}
            </div>
          )}
          <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-1)' }}>
            <button type="button" className="btn-primary" onClick={handleClaim}>
              Confirm Claim
            </button>
            <button type="button" className="text-btn" onClick={() => setConfirmOpen(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {claiming && (
        <div
          style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 'var(--space-2)' }}
        >
          Claiming…
        </div>
      )}
      {claimResult && (
        <div
          style={{
            fontSize: 12,
            marginTop: 'var(--space-2)',
            color: claimResult.success ? 'var(--color-success)' : 'var(--color-error)'
          }}
        >
          {claimResult.success
            ? `Claimed! Tx: ${claimResult.txHash?.slice(0, 10)}…`
            : claimResult.error}
        </div>
      )}
      {claimHistory.length > 0 && (
        <div
          style={{
            marginTop: 'var(--space-3)',
            borderTop: '1px solid var(--color-border)',
            paddingTop: 'var(--space-2)'
          }}
        >
          <div
            style={{
              fontSize: 11,
              color: 'var(--color-text-muted)',
              fontWeight: 500,
              marginBottom: 'var(--space-1)'
            }}
          >
            Claim History
          </div>
          {claimHistory
            .slice(-3)
            .reverse()
            .map((claim) => (
              <div
                key={claim.txHash + claim.claimedAt}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--space-2)',
                  fontSize: 11,
                  color: 'var(--color-text-secondary)',
                  padding: '2px 0'
                }}
              >
                <span
                  style={{
                    color:
                      claim.status === 'confirmed' ? 'var(--color-success)' : 'var(--color-error)'
                  }}
                >
                  {claim.status === 'confirmed' ? '✓' : '✗'}
                </span>
                {claim.txHash && (
                  <a
                    href={`https://basescan.org/tx/${claim.txHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      color: 'var(--muted)',
                      textDecoration: 'none',
                      fontFamily: 'var(--font-mono)'
                    }}
                  >
                    {claim.txHash.slice(0, 10)}…
                  </a>
                )}
                <span>{formatDate(claim.claimedAt)}</span>
                {claim.error && <span style={{ color: 'var(--color-error)' }}>{claim.error}</span>}
              </div>
            ))}
        </div>
      )}
    </div>
  )
}

export function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoadState('loading')
    setErrorMsg(null)
    try {
      const result = await window.plottoon.dashboard.getData()
      setData(result)
      setLoadState('loaded')
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to load dashboard data')
      setLoadState('error')
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    window.plottoon.dashboard.getData().then(
      (result) => {
        if (!cancelled) {
          setData(result)
          setLoadState('loaded')
        }
      },
      (err) => {
        if (!cancelled) {
          setErrorMsg(err instanceof Error ? err.message : 'Failed to load dashboard data')
          setLoadState('error')
        }
      }
    )
    return () => {
      cancelled = true
    }
  }, [])

  // Wallet-scope (#222): a wallet switch must redraw the dashboard so
  // wallet A's projects, balance, and royalty disappear immediately.
  useEffect(() => {
    function onActiveChanged(): void {
      void load()
    }
    window.addEventListener(WALLET_ACTIVE_CHANGED_EVENT, onActiveChanged)
    return () => window.removeEventListener(WALLET_ACTIVE_CHANGED_EVENT, onActiveChanged)
  }, [load])

  if (loadState === 'loading') {
    return <div className="loading-state">Loading dashboard…</div>
  }

  if (loadState === 'error' || !data) {
    return (
      <div className="error-panel">
        <div className="error-panel__title">Couldn't load dashboard</div>
        <p className="error-panel__message">{errorMsg ?? 'Failed to load dashboard'}</p>
        <button type="button" className="btn-primary" onClick={load}>
          Retry
        </button>
      </div>
    )
  }

  const hasStorylines = data.storylines.length > 0
  const hasLocalGroups = data.localGroups.length > 0
  const isEmpty = !hasStorylines && !hasLocalGroups

  return (
    <div className="screen">
      <div className="screen__header">
        <div>
          <h1 className="screen__title">Dashboard</h1>
          <p className="screen__subtitle">Counts, wallet, and recent publish activity.</p>
        </div>
        <button type="button" className="text-btn" onClick={load}>
          Refresh
        </button>
      </div>

      <div className="stat-grid">
        <StatCard label="Projects" value={data.counts.totalProjects} />
        <StatCard label="Plots" value={data.counts.totalPlots} />
        <StatCard label="Published" value={data.counts.publishedPlots} accent />
        <StatCard label="Pending" value={data.counts.pendingPlots} />
        {data.counts.failedPlots > 0 && <StatCard label="Failed" value={data.counts.failedPlots} />}
        {data.counts.notIndexedPlots > 0 && (
          <StatCard label="Not Indexed" value={data.counts.notIndexedPlots} />
        )}
      </div>

      <div className="dash-grid">
        <WalletCard wallet={data.wallet} />
        {data.tokenPrice.ethUsd && (
          <div className="dash-card">
            <div className="dash-card__label">ETH Price</div>
            <div className="dash-card__value">
              ${data.tokenPrice.ethUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })}
            </div>
          </div>
        )}
        <RoyaltyClaimCard
          walletConnected={data.wallet.connected}
          walletAddress={data.wallet.address}
          dashboardRoyalty={data.royalty}
        />
      </div>

      {isEmpty && (
        <div className="dash-empty">
          No plots yet. Create a project and add some plots to get started.
        </div>
      )}

      {hasStorylines && (
        <section className="screen__section">
          <div className="screen__section-label">Storylines</div>
          {data.storylines.map((g) => (
            <StorylineCard key={g.storylineId} group={g} />
          ))}
        </section>
      )}

      {hasLocalGroups && (
        <section className="screen__section">
          <div className="screen__section-label">Local Projects</div>
          {data.localGroups.map((g) => (
            <LocalGroupCard key={g.groupKey} group={g} />
          ))}
        </section>
      )}

      <div className="screen__meta">Updated {formatDate(data.generatedAt)}</div>
    </div>
  )
}
