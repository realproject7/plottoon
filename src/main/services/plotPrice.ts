/**
 * PLOT/USD price helper for the Dashboard P&L card (#264).
 *
 * Mirrors plotlink-ows's `lib/usd-price.ts` strategy: try several public
 * sources in order, return the first plausible quote, and degrade
 * silently to `null` when every source is unavailable. PlotToon does
 * not ship the optional Mint Club SDK (an upstream dependency that adds
 * non-trivial install surface to an Electron renderer), so the fallback
 * chain starts at GeckoTerminal which is keyless + Base-aware.
 *
 * Fallback order:
 *   1. GeckoTerminal (`api.geckoterminal.com/api/v2/networks/base/tokens/<addr>`)
 *   2. CoinGecko (`api.coingecko.com/api/v3/simple/token_price/base?contract_addresses=<addr>`)
 *
 * Both endpoints are public; PlotLink hosts none of them. No API keys
 * are required — but if `COINGECKO_API_KEY` is set in the environment
 * we forward it on the CoinGecko call (matches the plotlink-ows
 * behavior; cleanly absent on a fresh install).
 *
 * The helper coalesces concurrent requests and caches the last
 * successful result for `CACHE_TTL_MS` so a Dashboard reload during the
 * window doesn't hit the network again. Cache + in-flight state are
 * module-local; the helper exposes a `resetPlotPriceCacheForTests`
 * hook the test suite uses to start from a clean slate.
 */

import { PLOT_TOKEN_BASE_MAINNET } from './royaltyClaim'

const CACHE_TTL_MS = 2 * 60 * 1000
const FETCH_TIMEOUT_MS = 3_000

interface CacheEntry {
  price: number
  fetchedAt: number
}

let cached: CacheEntry | null = null
let inflight: Promise<number | null> | null = null

export interface PlotPriceDeps {
  /** Override for tests. Defaults to the real `globalThis.fetch`. */
  fetchFn?: typeof fetch
  /** Override for tests; production wiring resolves to `Date.now()`. */
  now?: () => number
  /** Override for tests; defaults to `PLOT_TOKEN_BASE_MAINNET` lowercased. */
  tokenAddress?: string
}

function defaultDeps(): Required<PlotPriceDeps> {
  return {
    fetchFn: fetch as unknown as typeof fetch,
    now: () => Date.now(),
    tokenAddress: PLOT_TOKEN_BASE_MAINNET.toLowerCase()
  }
}

export async function getPlotUsdPrice(
  forceRefresh = false,
  depsOverride: PlotPriceDeps = {}
): Promise<number | null> {
  const deps = { ...defaultDeps(), ...depsOverride }
  if (!forceRefresh && cached && deps.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.price
  }
  if (inflight && !forceRefresh) {
    return inflight
  }
  inflight = fetchOnce(deps)
  try {
    const price = await inflight
    if (price !== null) {
      cached = { price, fetchedAt: deps.now() }
    }
    return price
  } finally {
    inflight = null
  }
}

async function fetchOnce(deps: Required<PlotPriceDeps>): Promise<number | null> {
  const gecko = await tryGeckoTerminal(deps)
  if (gecko !== null) return gecko
  const cg = await tryCoinGecko(deps)
  if (cg !== null) return cg
  return null
}

async function tryGeckoTerminal(deps: Required<PlotPriceDeps>): Promise<number | null> {
  try {
    const url = `https://api.geckoterminal.com/api/v2/networks/base/tokens/${deps.tokenAddress}`
    const response = await deps.fetchFn(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
    })
    if (!response.ok) return null
    const data = (await response.json()) as {
      data?: { attributes?: { price_usd?: string | number } }
    }
    const priceUsd = data?.data?.attributes?.price_usd
    if (priceUsd === undefined || priceUsd === null) return null
    const price = typeof priceUsd === 'number' ? priceUsd : parseFloat(priceUsd)
    if (Number.isNaN(price) || price <= 0) return null
    return price
  } catch {
    return null
  }
}

async function tryCoinGecko(deps: Required<PlotPriceDeps>): Promise<number | null> {
  try {
    const url = `https://api.coingecko.com/api/v3/simple/token_price/base?contract_addresses=${deps.tokenAddress}&vs_currencies=usd`
    const headers: Record<string, string> = { Accept: 'application/json' }
    const apiKey = process.env.COINGECKO_API_KEY
    if (apiKey) headers['x-cg-demo-api-key'] = apiKey
    const response = await deps.fetchFn(url, {
      headers,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
    })
    if (!response.ok) return null
    const data = (await response.json()) as Record<string, { usd?: number }>
    const usd = data[deps.tokenAddress]?.usd
    if (typeof usd !== 'number' || usd <= 0) return null
    return usd
  } catch {
    return null
  }
}

/**
 * Test-only hook. Clears the cache and in-flight state so each test
 * starts from a clean slate without exporting the mutable state.
 */
export function resetPlotPriceCacheForTests(): void {
  cached = null
  inflight = null
}
