import { useState, useEffect, useCallback } from 'react'

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

const cardStyle: React.CSSProperties = {
  background: 'var(--color-surface)',
  borderRadius: 'var(--radius-md)',
  border: '1px solid var(--color-border)',
  padding: 'var(--space-4)'
}

const statLabelStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--color-text-muted)',
  fontWeight: 500,
  textTransform: 'uppercase' as const,
  letterSpacing: '0.04em'
}

const statValueStyle: React.CSSProperties = {
  fontSize: 24,
  fontFamily: 'var(--font-display)',
  fontWeight: 600,
  color: 'var(--color-text)',
  lineHeight: 1.2
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
    <div style={cardStyle}>
      <div style={statLabelStyle}>{label}</div>
      <div
        style={{
          ...statValueStyle,
          color: accent ? 'var(--color-accent)' : 'var(--color-text)'
        }}
      >
        {value}
      </div>
    </div>
  )
}

function PlotStateBadge({ state }: { state: string }) {
  const colors: Record<string, { bg: string; text: string }> = {
    published: { bg: '#dcfce7', text: '#166534' },
    'published-not-indexed': { bg: '#fef9c3', text: '#854d0e' },
    failed: { bg: '#fee2e2', text: '#991b1b' },
    draft: { bg: '#f4f4f5', text: '#71717a' },
    ready: { bg: '#e0f2fe', text: '#075985' },
    publishing: { bg: '#fef3c7', text: '#92400e' }
  }
  const c = colors[state] ?? colors.draft
  return (
    <span
      style={{
        display: 'inline-block',
        fontSize: 11,
        fontWeight: 500,
        padding: '1px 6px',
        borderRadius: 'var(--radius-sm)',
        background: c.bg,
        color: c.text
      }}
    >
      {state}
    </span>
  )
}

function PlotRow({ plot }: { plot: DashboardPlotEntry }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-3)',
        padding: 'var(--space-2) 0',
        borderBottom: '1px solid var(--color-border)',
        fontSize: 13
      }}
    >
      <span style={{ fontWeight: 500, flex: 1 }}>{plot.plotTitle}</span>
      <span style={{ color: 'var(--color-text-muted)' }}>{plot.cutCount} cuts</span>
      <PlotStateBadge state={plot.plotState} />
      {plot.publishResult?.txHash && (
        <a
          href={`https://basescan.org/tx/${plot.publishResult.txHash}`}
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: 'var(--color-text-muted)', fontSize: 12, textDecoration: 'none' }}
        >
          Tx
        </a>
      )}
      {plot.publishResult?.plotlinkUrl && (
        <a
          href={plot.publishResult.plotlinkUrl}
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: 'var(--color-accent)', fontSize: 12, textDecoration: 'none' }}
        >
          View →
        </a>
      )}
    </div>
  )
}

function StorylineCard({ group }: { group: DashboardStorylineGroup }) {
  return (
    <div style={{ ...cardStyle, marginBottom: 'var(--space-3)' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 'var(--space-2)'
        }}
      >
        <div>
          <div style={{ fontWeight: 600, fontSize: 14 }}>{group.projectName}</div>
          <div style={{ fontSize: 11, color: 'var(--color-text-muted)', fontFamily: 'monospace' }}>
            {truncateAddress(group.storylineId)}
          </div>
        </div>
        <div style={{ textAlign: 'right', fontSize: 12 }}>
          <div>
            {group.publishedCount} published
            {group.notIndexedCount > 0 && (
              <span style={{ color: 'var(--color-warning)' }}>
                {' '}
                · {group.notIndexedCount} not indexed
              </span>
            )}
          </div>
          <div style={{ color: 'var(--color-text-muted)' }}>
            Gas: {formatGasWei(group.totalGasCostWei)}
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
    <div style={{ ...cardStyle, marginBottom: 'var(--space-3)' }}>
      <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 'var(--space-2)' }}>
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
      <div style={cardStyle}>
        <div style={statLabelStyle}>Wallet</div>
        <div
          style={{ fontSize: 13, color: 'var(--color-text-muted)', marginTop: 'var(--space-1)' }}
        >
          Not connected
        </div>
      </div>
    )
  }
  return (
    <div style={cardStyle}>
      <div style={statLabelStyle}>Wallet</div>
      <div
        style={{
          fontFamily: 'monospace',
          fontSize: 13,
          marginTop: 'var(--space-1)'
        }}
      >
        {truncateAddress(wallet.address!)}
      </div>
      <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{wallet.source}</div>
      {wallet.balanceWei && (
        <div style={{ fontSize: 13, fontWeight: 500, marginTop: 'var(--space-1)' }}>
          {formatWei(wallet.balanceWei)}
        </div>
      )}
      {wallet.balanceError && (
        <div style={{ fontSize: 12, color: 'var(--color-error)' }}>{wallet.balanceError}</div>
      )}
    </div>
  )
}

function RoyaltyClaimCard({
  walletConnected,
  dashboardRoyalty
}: {
  walletConnected: boolean
  dashboardRoyalty: DashboardRoyaltySummary
}) {
  const [royaltyInfo, setRoyaltyInfo] = useState<RoyaltyInfoResult | null>(null)
  const [claiming, setClaiming] = useState(false)
  const [claimResult, setClaimResult] = useState<RoyaltyClaimResult | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)

  useEffect(() => {
    if (!walletConnected) return
    let cancelled = false
    window.plottoon.royalty.getInfo().then(
      (result) => {
        if (!cancelled) setRoyaltyInfo(result)
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
      <div style={cardStyle}>
        <div style={statLabelStyle}>Royalties</div>
        <div style={{ fontSize: 12, color: 'var(--color-error)', marginTop: 'var(--space-1)' }}>
          {dashboardRoyalty.error}
        </div>
      </div>
    )
  }

  const earned = info?.earnedWei ?? dashboardRoyalty.earnedWei
  const unclaimed = info?.unclaimedWei ?? dashboardRoyalty.unclaimedWei

  if (!earned && !dashboardRoyalty.earnedWei) return null

  return (
    <div style={cardStyle}>
      <div style={statLabelStyle}>Royalties</div>
      {earned && (
        <div style={{ fontSize: 13, marginTop: 'var(--space-1)' }}>
          <span style={{ fontWeight: 500 }}>Earned:</span> {formatWei(earned)}
        </div>
      )}
      {unclaimed && unclaimed !== '0' && (
        <div style={{ fontSize: 13, color: 'var(--color-accent)' }}>
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
        <div style={{ marginTop: 'var(--space-2)', fontSize: 12 }}>
          <span>Claim {formatWei(info!.unclaimedWei)} to your wallet?</span>
          <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-1)' }}>
            <button type="button" className="btn-primary" onClick={handleClaim}>
              Confirm Claim
            </button>
            <button
              type="button"
              onClick={() => setConfirmOpen(false)}
              style={{
                all: 'unset',
                fontSize: 12,
                color: 'var(--color-text-muted)',
                cursor: 'pointer'
              }}
            >
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

  if (loadState === 'loading') {
    return <div style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>Loading dashboard…</div>
  }

  if (loadState === 'error' || !data) {
    return (
      <div>
        <div style={{ color: 'var(--color-error)', fontSize: 13, marginBottom: 'var(--space-3)' }}>
          {errorMsg ?? 'Failed to load dashboard'}
        </div>
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
    <div style={{ maxWidth: 900 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 'var(--space-6)'
        }}
      >
        <h1
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 20,
            fontWeight: 600,
            letterSpacing: '-0.01em'
          }}
        >
          Dashboard
        </h1>
        <button
          type="button"
          onClick={load}
          style={{
            all: 'unset',
            fontSize: 12,
            color: 'var(--color-text-muted)',
            cursor: 'pointer'
          }}
        >
          Refresh
        </button>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
          gap: 'var(--space-3)',
          marginBottom: 'var(--space-6)'
        }}
      >
        <StatCard label="Projects" value={data.counts.totalProjects} />
        <StatCard label="Plots" value={data.counts.totalPlots} />
        <StatCard label="Published" value={data.counts.publishedPlots} accent />
        <StatCard label="Pending" value={data.counts.pendingPlots} />
        {data.counts.failedPlots > 0 && <StatCard label="Failed" value={data.counts.failedPlots} />}
        {data.counts.notIndexedPlots > 0 && (
          <StatCard label="Not Indexed" value={data.counts.notIndexedPlots} />
        )}
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: data.wallet.connected ? '1fr 1fr' : '1fr',
          gap: 'var(--space-3)',
          marginBottom: 'var(--space-6)'
        }}
      >
        <WalletCard wallet={data.wallet} />
        {data.tokenPrice.ethUsd && (
          <div style={cardStyle}>
            <div style={statLabelStyle}>ETH Price</div>
            <div
              style={{
                fontSize: 18,
                fontFamily: 'var(--font-display)',
                fontWeight: 600,
                marginTop: 'var(--space-1)'
              }}
            >
              ${data.tokenPrice.ethUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })}
            </div>
          </div>
        )}
        <RoyaltyClaimCard walletConnected={data.wallet.connected} dashboardRoyalty={data.royalty} />
      </div>

      {isEmpty && (
        <div
          style={{
            ...cardStyle,
            textAlign: 'center',
            padding: 'var(--space-8)',
            color: 'var(--color-text-muted)',
            fontSize: 13
          }}
        >
          No plots yet. Create a project and add some plots to get started.
        </div>
      )}

      {hasStorylines && (
        <section style={{ marginBottom: 'var(--space-6)' }}>
          <h2
            style={{
              fontSize: 14,
              fontWeight: 600,
              marginBottom: 'var(--space-3)',
              color: 'var(--color-text-secondary)'
            }}
          >
            Storylines
          </h2>
          {data.storylines.map((g) => (
            <StorylineCard key={g.storylineId} group={g} />
          ))}
        </section>
      )}

      {hasLocalGroups && (
        <section style={{ marginBottom: 'var(--space-6)' }}>
          <h2
            style={{
              fontSize: 14,
              fontWeight: 600,
              marginBottom: 'var(--space-3)',
              color: 'var(--color-text-secondary)'
            }}
          >
            Local Projects
          </h2>
          {data.localGroups.map((g) => (
            <LocalGroupCard key={g.groupKey} group={g} />
          ))}
        </section>
      )}

      <div style={{ fontSize: 11, color: 'var(--color-text-muted)', textAlign: 'right' }}>
        Updated {formatDate(data.generatedAt)}
      </div>
    </div>
  )
}
