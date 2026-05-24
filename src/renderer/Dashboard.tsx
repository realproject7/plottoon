import { useState, useEffect, useCallback } from 'react'
import { WALLET_ACTIVE_CHANGED_EVENT } from '../shared/walletIdentity'

type LoadState = 'loading' | 'loaded' | 'error'

function formatGasWei(wei: string): string {
  const n = BigInt(wei)
  if (n === BigInt(0)) return '0'
  const gwei = Number(n) / 1e9
  if (gwei < 1) return '<1 gwei'
  return `${gwei.toFixed(0)} gwei`
}

/**
 * Generic token formatter — used for PLOT (18 decimals, suffix 'PLOT') and
 * USDC (6 decimals, suffix 'USDC'). Kept separate from `formatEth` so the
 * symbol next to the value can't drift if a token's decimals ever change.
 */
function formatToken(wei: string, decimals: number, suffix: string, sig = 4): string {
  try {
    const n = BigInt(wei)
    const amount = Number(n) / Math.pow(10, decimals)
    if (amount === 0) return `0 ${suffix}`
    const threshold = Math.pow(10, -sig)
    if (amount < threshold) return `<${threshold} ${suffix}`
    return `${amount.toFixed(sig)} ${suffix}`
  } catch {
    return `— ${suffix}`
  }
}

function formatUsd(value: number): string {
  const sign = value < 0 ? '-' : ''
  const abs = Math.abs(value)
  if (abs >= 1000) {
    return `${sign}$${abs.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
  }
  if (abs < 0.01 && value !== 0) {
    return `${sign}<$0.01`
  }
  return `${sign}$${abs.toFixed(2)}`
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

function sourceLabel(source: string): string {
  return source === 'plotlink-writer' ? 'plotlink' : 'plottoon'
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

function PlotRow({
  plot,
  onRetryIndex
}: {
  plot: DashboardPlotEntry
  onRetryIndex?: (
    projectId: string,
    plotSlug: string
  ) => Promise<{ success: boolean; error?: string }>
}) {
  const [retrying, setRetrying] = useState(false)
  const [retryError, setRetryError] = useState<string | null>(null)

  // #251: surface a Retry index affordance for `published-not-indexed`
  // plots so the user can rescue an indexed-fail state without leaving
  // the Dashboard. Uses the existing publish:retryIndex IPC (#129) —
  // no new IPC introduced. Live + mock both honour the wallet-scoped
  // ownership check (#223 RE1) inside the handler, so cross-wallet
  // clicks are rejected before any state mutation.
  const isNotIndexed = plot.plotState === 'published-not-indexed'

  const handleRetry = async (): Promise<void> => {
    if (!onRetryIndex || retrying) return
    setRetryError(null)
    setRetrying(true)
    try {
      const result = await onRetryIndex(plot.projectId, plot.plotSlug)
      if (!result.success) {
        setRetryError(result.error ?? 'Retry failed')
      }
    } catch (err) {
      setRetryError(err instanceof Error ? err.message : 'Retry failed')
    } finally {
      setRetrying(false)
    }
  }

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
      {isNotIndexed && onRetryIndex && (
        <button
          type="button"
          className="text-btn"
          onClick={handleRetry}
          disabled={retrying}
          data-testid={`retry-index-${plot.projectId}-${plot.plotSlug}`}
        >
          {retrying ? 'Retrying…' : 'Retry index'}
        </button>
      )}
      {retryError && (
        <span
          className="dash-card__danger"
          data-testid={`retry-index-error-${plot.projectId}-${plot.plotSlug}`}
        >
          {retryError}
        </span>
      )}
    </div>
  )
}

function StorylineCard({
  group,
  onOpenWorkspace,
  onRetryIndex
}: {
  group: DashboardStorylineGroup
  onOpenWorkspace?: (projectId: string) => void
  onRetryIndex?: (
    projectId: string,
    plotSlug: string
  ) => Promise<{ success: boolean; error?: string }>
}) {
  return (
    <div className="dash-card dash-card--group" data-testid={`storyline-${group.storylineId}`}>
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
            Gas: {formatGasWei(group.totalPublishCostWei)}
          </div>
          {group.latestPublishedAt && (
            <div className="dash-card__group-meta-muted">
              Latest: {formatDate(group.latestPublishedAt)}
            </div>
          )}
        </div>
      </div>
      {group.plots.map((plot) => (
        <PlotRow key={plot.plotSlug} plot={plot} onRetryIndex={onRetryIndex} />
      ))}
      {onOpenWorkspace && (
        <div className="dash-card__group-actions">
          <button
            type="button"
            className="text-btn"
            onClick={() => onOpenWorkspace(group.projectId)}
            data-testid={`open-workspace-${group.storylineId}`}
          >
            Open in workspace →
          </button>
        </div>
      )}
    </div>
  )
}

function LocalGroupCard({
  group,
  onOpenWorkspace,
  onRetryIndex
}: {
  group: DashboardLocalGroup
  onOpenWorkspace?: (projectId: string) => void
  onRetryIndex?: (
    projectId: string,
    plotSlug: string
  ) => Promise<{ success: boolean; error?: string }>
}) {
  return (
    <div className="dash-card dash-card--group" data-testid={`local-group-${group.groupKey}`}>
      <div className="dash-card__group-header">
        <div className="dash-card__group-title" title={group.projectName}>
          {group.projectName}
        </div>
      </div>
      {group.plots.map((plot) => (
        <PlotRow key={plot.plotSlug} plot={plot} onRetryIndex={onRetryIndex} />
      ))}
      {onOpenWorkspace && (
        <div className="dash-card__group-actions">
          <button
            type="button"
            className="text-btn"
            onClick={() => onOpenWorkspace(group.projectId)}
            data-testid={`open-workspace-local-${group.groupKey}`}
          >
            Open in workspace →
          </button>
        </div>
      )}
    </div>
  )
}

function WalletCard({ wallet }: { wallet: DashboardWalletSummary }) {
  const [copied, setCopied] = useState(false)

  if (!wallet.connected || !wallet.address) {
    return (
      <div className="dash-card dash-card--wallet" data-testid="dash-wallet-card">
        <div className="dash-card__label">Wallet</div>
        <div className="dash-card__sub">Not connected</div>
      </div>
    )
  }

  const handleCopy = (): void => {
    if (!wallet.address) return
    navigator.clipboard?.writeText(wallet.address)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="dash-card dash-card--wallet" data-testid="dash-wallet-card">
      <div className="dash-card__label">
        Wallet
        <span className="dash-chip dash-chip--network" data-testid="wallet-network-chip">
          Base
        </span>
      </div>
      <div className="dash-wallet__address-row">
        <span className="dash-card__mono" title={wallet.address}>
          {truncateAddress(wallet.address)}
        </span>
        <div className="dash-wallet__address-actions">
          <button
            type="button"
            className="text-btn"
            onClick={handleCopy}
            data-testid="wallet-copy-address"
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
          <a
            href={`https://basescan.org/address/${wallet.address}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-btn"
            data-testid="wallet-open-explorer"
          >
            Explorer ↗
          </a>
        </div>
      </div>
      <div className="dash-card__sub">{wallet.source ? sourceLabel(wallet.source) : ''}</div>
      <div className="dash-wallet__balances" data-testid="wallet-balances">
        <WalletBalanceRow
          label="ETH"
          wei={wallet.balanceWei}
          error={wallet.balanceError}
          decimals={18}
          suffix="ETH"
        />
        <WalletBalanceRow
          label="USDC"
          wei={wallet.usdcBalanceWei}
          error={wallet.usdcBalanceError}
          decimals={6}
          suffix="USDC"
          sig={2}
        />
        <WalletBalanceRow
          label="PLOT"
          wei={wallet.plotBalanceWei}
          error={wallet.plotBalanceError}
          decimals={18}
          suffix="PLOT"
        />
      </div>
    </div>
  )
}

function WalletBalanceRow({
  label,
  wei,
  error,
  decimals,
  suffix,
  sig = 4
}: {
  label: string
  wei: string | null
  error: string | null
  decimals: number
  suffix: string
  sig?: number
}) {
  if (error) {
    return (
      <div className="dash-wallet__balance-row" data-testid={`wallet-balance-${label}`}>
        <span className="dash-wallet__balance-label">{label}</span>
        <span className="dash-card__danger">{error}</span>
      </div>
    )
  }
  if (!wei) {
    return (
      <div className="dash-wallet__balance-row" data-testid={`wallet-balance-${label}`}>
        <span className="dash-wallet__balance-label">{label}</span>
        <span className="dash-card__sub">—</span>
      </div>
    )
  }
  return (
    <div className="dash-wallet__balance-row" data-testid={`wallet-balance-${label}`}>
      <span className="dash-wallet__balance-label">{label}</span>
      <span className="dash-card__mono">{formatToken(wei, decimals, suffix, sig)}</span>
    </div>
  )
}

function PnlCard({
  pnl,
  tokenPrice,
  totalGasWei,
  royalty
}: {
  pnl: DashboardPnlSummary
  tokenPrice: DashboardTokenPrice
  totalGasWei: string
  royalty: DashboardRoyaltySummary
}) {
  // Always render the card so users see WHY a value isn't available (price
  // missing, royalty missing) instead of the row simply disappearing.

  // #250 RE1: surface earned + unclaimed PLOT amounts directly on the P&L
  // card. The Royalty claim card carries the same numbers + the claim
  // action; the P&L card is the financial summary surface so it needs the
  // token-denominated values too, not just the USD aggregate.
  const earnedPlot = royalty.earnedWei ? formatToken(royalty.earnedWei, 18, 'PLOT') : '—'
  const unclaimedPlot = royalty.unclaimedWei ? formatToken(royalty.unclaimedWei, 18, 'PLOT') : '—'
  const unclaimedUsd =
    royalty.unclaimedWei && tokenPrice.plotUsd !== null
      ? (Number(BigInt(royalty.unclaimedWei)) / 1e18) * tokenPrice.plotUsd
      : null

  return (
    <div className="dash-card dash-card--pnl" data-testid="dash-pnl-card">
      <div className="dash-card__label">P&L</div>
      <div className="dash-pnl__row" data-testid="pnl-gas-row">
        <span className="dash-pnl__row-label">Gas (lifetime)</span>
        <span className="dash-card__mono">{formatGasWei(totalGasWei)}</span>
        <span className="dash-pnl__row-aux">
          {pnl.totalGasUsd !== null ? formatUsd(pnl.totalGasUsd) : '—'}
        </span>
      </div>
      <div className="dash-pnl__row" data-testid="pnl-royalty-row">
        <span className="dash-pnl__row-label">Royalty (earned)</span>
        <span className="dash-card__mono">{earnedPlot}</span>
        <span className="dash-pnl__row-aux">
          {pnl.totalRoyaltyUsd !== null ? formatUsd(pnl.totalRoyaltyUsd) : '—'}
        </span>
      </div>
      <div className="dash-pnl__row" data-testid="pnl-unclaimed-row">
        <span className="dash-pnl__row-label">Royalty (unclaimed)</span>
        <span className="dash-card__mono">{unclaimedPlot}</span>
        <span className="dash-pnl__row-aux">
          {unclaimedUsd !== null ? formatUsd(unclaimedUsd) : '—'}
        </span>
      </div>
      <div className="dash-pnl__row dash-pnl__row--net" data-testid="pnl-net-row">
        <span className="dash-pnl__row-label">Net</span>
        <span className="dash-card__mono">—</span>
        <span
          className={`dash-pnl__row-aux${
            pnl.netUsd !== null && pnl.netUsd < 0 ? ' dash-pnl__row-aux--negative' : ''
          }`}
        >
          {pnl.netUsd !== null ? formatUsd(pnl.netUsd) : '—'}
        </span>
      </div>
      <div className="dash-pnl__fallbacks">
        <span data-testid="pnl-eth-fallback">
          ETH/USD:{' '}
          {tokenPrice.ethUsd !== null
            ? `$${tokenPrice.ethUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
            : 'unavailable'}
        </span>
        <span data-testid="pnl-plot-fallback">
          PLOT/USD:{' '}
          {tokenPrice.plotUsd !== null ? `$${tokenPrice.plotUsd.toFixed(4)}` : 'unavailable'}
        </span>
      </div>
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
    if (!walletConnected || !walletAddress) return
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
  }, [walletConnected, walletAddress])

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
      <div className="dash-card" data-testid="royalty-card">
        <div className="dash-card__label">Royalties</div>
        <div className="dash-card__danger">{dashboardRoyalty.error}</div>
      </div>
    )
  }

  const earned = info?.earnedWei ?? dashboardRoyalty.earnedWei
  const unclaimed = info?.unclaimedWei ?? dashboardRoyalty.unclaimedWei
  const claimed = info?.claimedWei ?? dashboardRoyalty.claimedWei

  if (!earned && !dashboardRoyalty.earnedWei) return null

  return (
    <div className="dash-card" data-testid="royalty-card">
      <div className="dash-card__label">Royalties</div>
      {earned && (
        <div className="dash-card__sub">
          <span style={{ fontWeight: 500, color: 'var(--fg)' }}>Earned:</span>{' '}
          {formatToken(earned, 18, 'PLOT')}
        </div>
      )}
      {claimed && (
        <div className="dash-card__sub">
          <span style={{ fontWeight: 500, color: 'var(--fg)' }}>Claimed:</span>{' '}
          {formatToken(claimed, 18, 'PLOT')}
        </div>
      )}
      {unclaimed && unclaimed !== '0' && (
        <div className="dash-card__sub" style={{ color: 'var(--accent)' }}>
          <span style={{ fontWeight: 500 }}>Unclaimed:</span> {formatToken(unclaimed, 18, 'PLOT')}
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
          <div>Claim {formatToken(info!.unclaimedWei, 18, 'PLOT')} to your wallet?</div>
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

/**
 * #251: rolled-up activity entry — drawn from local sources only. A
 * publish entry comes from `dashboardData` (plot's `publishedAt` +
 * `publishResult`); a claim entry comes from `royalty:claimHistory`
 * (already wallet-scoped per #233). No new IPC, no fake records, no
 * external PlotLink-only data.
 */
type ActivityEntry =
  | {
      kind: 'publish'
      iso: string
      title: string
      detail: string
      txHash: string | null
      plotlinkUrl: string | null
    }
  | {
      kind: 'claim'
      iso: string
      title: string
      detail: string
      txHash: string | null
      success: boolean
    }

function buildActivity(
  data: DashboardData,
  claims: RoyaltyClaimRecord[],
  limit = 8
): ActivityEntry[] {
  const entries: ActivityEntry[] = []

  // Active-wallet publishes already in the dashboard payload (storylines +
  // localGroups are both wallet-scoped at the data layer per #222).
  const allPlots: DashboardPlotEntry[] = [
    ...data.storylines.flatMap((s) => s.plots),
    ...data.localGroups.flatMap((g) => g.plots)
  ]
  for (const plot of allPlots) {
    if (!plot.publishedAt || !plot.publishResult) continue
    entries.push({
      kind: 'publish',
      iso: plot.publishedAt,
      title: plot.plotTitle,
      detail: plot.projectName,
      txHash: plot.publishResult.txHash || null,
      plotlinkUrl: plot.publishResult.plotlinkUrl || null
    })
  }

  // Active-wallet royalty claims from local history (#233 scoping).
  for (const claim of claims) {
    entries.push({
      kind: 'claim',
      iso: claim.claimedAt,
      title: claim.status === 'confirmed' ? 'Royalty claimed' : 'Royalty claim failed',
      detail: claim.error ?? (claim.status === 'confirmed' ? 'Confirmed on chain' : 'Unknown'),
      txHash: claim.txHash || null,
      success: claim.status === 'confirmed'
    })
  }

  entries.sort((a, b) => (a.iso < b.iso ? 1 : a.iso > b.iso ? -1 : 0))
  return entries.slice(0, limit)
}

function ActivityFeed({ entries }: { entries: ActivityEntry[] }): JSX.Element {
  if (entries.length === 0) {
    return (
      <div className="dash-empty" data-testid="activity-empty">
        No local activity yet. Published plots and royalty claims will appear here.
      </div>
    )
  }
  return (
    <div className="dash-activity" data-testid="activity-list">
      {entries.map((e, i) => (
        <div
          key={`${e.kind}-${e.iso}-${i}`}
          className={`dash-activity__row dash-activity__row--${e.kind}`}
          data-testid={`activity-${e.kind}-${i}`}
        >
          <span className="dash-activity__kind">{e.kind === 'publish' ? '⤴' : '◎'}</span>
          <span className="dash-activity__when">{formatDate(e.iso)}</span>
          <span className="dash-activity__body">
            <span className="dash-activity__title">{e.title}</span>
            <span className="dash-activity__detail">{e.detail}</span>
          </span>
          {e.txHash && (
            <a
              href={`https://basescan.org/tx/${e.txHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="dash-activity__link"
            >
              Tx
            </a>
          )}
          {e.kind === 'publish' && e.plotlinkUrl && (
            <a
              href={e.plotlinkUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="dash-activity__link dash-activity__link--accent"
            >
              View
            </a>
          )}
        </div>
      ))}
    </div>
  )
}

interface DashboardProps {
  /**
   * #250: opens the local project in the workspace view. When omitted (e.g.
   * older callers, isolated renderer tests), the "Open in workspace" action
   * doesn't render — published story groups still appear, just without the
   * navigation affordance.
   */
  onSelectProject?: (projectId: string) => void
}

export function Dashboard({ onSelectProject }: DashboardProps = {}) {
  const [data, setData] = useState<DashboardData | null>(null)
  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  // #251: lifted activity-feed history fetch — separate from the Royalty
  // claim card's own state so a click on Claim doesn't have to re-render
  // the activity feed via prop drilling. Activity refreshes on the next
  // dashboard load or wallet switch (re-uses the wallet-scoped IPC).
  const [activityClaims, setActivityClaims] = useState<RoyaltyClaimRecord[]>([])

  const load = useCallback(async () => {
    setLoadState('loading')
    setErrorMsg(null)
    // #251 RE1: clear the activity-feed claim history BEFORE the new
    // dashboard payload renders. Otherwise wallet B's dashboard data can
    // surface (via setData/setLoadState below) while the claim-history
    // IPC is still inflight, briefly showing wallet A's stale claims in
    // the activity list. Activity is required to be active-wallet
    // scoped and to clear stale data on switch — pinning the empty
    // state first guarantees no cross-wallet bleed.
    setActivityClaims([])
    try {
      const result = await window.plottoon.dashboard.getData()
      setData(result)
      setLoadState('loaded')
      // Refresh wallet-scoped activity claims on the same load tick.
      // Errors here are intentionally swallowed — activity is a secondary
      // surface; a fetch failure must not break the rest of the dashboard.
      try {
        const history = await window.plottoon.royalty.getClaimHistory()
        setActivityClaims(history.claims)
      } catch {
        setActivityClaims([])
      }
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
    // #251: parallel claim-history fetch for the activity feed.
    window.plottoon.royalty.getClaimHistory().then(
      (result) => {
        if (!cancelled) setActivityClaims(result.claims)
      },
      () => {
        if (!cancelled) setActivityClaims([])
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

  // #251: bind the existing publish:retryIndex IPC so PlotRow can offer
  // a Retry-index action on `published-not-indexed` plots. Defined here
  // (above the conditional early returns) to satisfy the Rules of Hooks.
  // Refreshes the dashboard data on success so the badge transitions
  // from "not indexed" to "published" immediately.
  const handleRetryIndex = useCallback(
    async (projectId: string, plotSlug: string) => {
      const result = await window.plottoon.publish.retryIndex({ projectId, plotSlug })
      if (result.success) {
        void load()
      }
      return result
    },
    [load]
  )

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
          <p className="screen__subtitle">
            {data.wallet.connected && data.wallet.address ? (
              <>
                Active wallet:{' '}
                <span className="dash-card__mono" data-testid="active-wallet-context">
                  {truncateAddress(data.wallet.address)}
                </span>
                {data.wallet.source && (
                  <span style={{ color: 'var(--muted)' }}>
                    {' '}
                    · {sourceLabel(data.wallet.source)}
                  </span>
                )}
              </>
            ) : (
              'No wallet connected — pick one in the sidebar to see your stats.'
            )}
          </p>
        </div>
        <button type="button" className="text-btn" onClick={load} data-testid="dashboard-refresh">
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
        <PnlCard
          pnl={data.pnl}
          tokenPrice={data.tokenPrice}
          totalGasWei={data.counts.totalPublishCostWei}
          royalty={data.royalty}
        />
        {/*
         * key={data.wallet.address ?? '-'} forces React to unmount and
         * remount RoyaltyClaimCard whenever the active wallet changes. That
         * resets every piece of per-wallet local state (royaltyInfo,
         * claimHistory, confirmOpen, claimResult) without a manual setState
         * inside an effect — closes the #222 RE1 stale-state finding.
         */}
        <RoyaltyClaimCard
          key={data.wallet.address ?? '-'}
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
          <div className="screen__section-label">Published storylines</div>
          {data.storylines.map((g) => (
            <StorylineCard
              key={g.storylineId}
              group={g}
              onOpenWorkspace={onSelectProject}
              onRetryIndex={handleRetryIndex}
            />
          ))}
        </section>
      )}

      {hasLocalGroups && (
        <section className="screen__section">
          <div className="screen__section-label">Local production</div>
          <p className="screen__section-sub">
            Drafts, ready, failed, and not-indexed plots grouped by local project.
          </p>
          {data.localGroups.map((g) => (
            <LocalGroupCard
              key={g.groupKey}
              group={g}
              onOpenWorkspace={onSelectProject}
              onRetryIndex={handleRetryIndex}
            />
          ))}
        </section>
      )}

      {/*
        #251: activity feed surfaces local publishes (from dashboardData)
        and royalty claims (from royalty:claimHistory, wallet-scoped per
        #233) in a single time-ordered list. No external PlotLink-only
        records and no fake entries — empty state when no local activity
        exists.
      */}
      <section className="screen__section" data-testid="activity-section">
        <div className="screen__section-label">Activity</div>
        <ActivityFeed entries={buildActivity(data, activityClaims)} />
      </section>

      <div className="screen__meta">Updated {formatDate(data.generatedAt)}</div>
    </div>
  )
}
