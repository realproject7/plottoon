import { describe, it, expect, beforeEach, vi } from 'vitest'
import { getPlotUsdPrice, resetPlotPriceCacheForTests } from '../services/plotPrice'

const FAKE_TOKEN = '0x4f567dacbf9d15a6acbe4a47fc2ade0719fb63c4'

interface Captured {
  url: string
  headers: HeadersInit | undefined
}

function makeFetch(results: Array<{ url: RegExp | string; status: number; body?: unknown }>): {
  fetchFn: typeof fetch
  captured: Captured[]
} {
  const captured: Captured[] = []
  const fetchFn = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const urlStr = url.toString()
    captured.push({ url: urlStr, headers: init?.headers })
    const match = results.find((r) =>
      r.url instanceof RegExp ? r.url.test(urlStr) : urlStr.includes(r.url)
    )
    if (!match) {
      return new Response('not mocked', { status: 404 })
    }
    return new Response(JSON.stringify(match.body ?? {}), {
      status: match.status,
      headers: { 'Content-Type': 'application/json' }
    })
  }) as unknown as typeof fetch
  return { fetchFn, captured }
}

beforeEach(() => {
  resetPlotPriceCacheForTests()
})

describe('#264 getPlotUsdPrice — fallback chain', () => {
  it('returns the GeckoTerminal price when its response is healthy (primary source wins)', async () => {
    const { fetchFn, captured } = makeFetch([
      {
        url: 'geckoterminal',
        status: 200,
        body: { data: { attributes: { price_usd: '0.0123' } } }
      }
    ])
    const price = await getPlotUsdPrice(true, { fetchFn, tokenAddress: FAKE_TOKEN })
    expect(price).toBeCloseTo(0.0123, 6)
    // CoinGecko should NOT have been called when GeckoTerminal succeeded.
    expect(captured.some((c) => c.url.includes('coingecko.com'))).toBe(false)
    // GeckoTerminal URL targets the correct Base contract.
    expect(captured[0].url).toContain(`networks/base/tokens/${FAKE_TOKEN}`)
  })

  it('falls back to CoinGecko when GeckoTerminal returns an empty payload', async () => {
    const { fetchFn, captured } = makeFetch([
      // GeckoTerminal returns 200 but no price_usd in the body.
      { url: 'geckoterminal', status: 200, body: { data: { attributes: {} } } },
      // CoinGecko returns the token-keyed shape with usd.
      {
        url: 'coingecko',
        status: 200,
        body: { [FAKE_TOKEN]: { usd: 0.045 } }
      }
    ])
    const price = await getPlotUsdPrice(true, { fetchFn, tokenAddress: FAKE_TOKEN })
    expect(price).toBeCloseTo(0.045, 6)
    // Both sources were called; GeckoTerminal first.
    expect(captured[0].url).toContain('geckoterminal.com')
    expect(captured[1].url).toContain('coingecko.com')
  })

  it('falls back to CoinGecko when GeckoTerminal returns 500', async () => {
    const { fetchFn } = makeFetch([
      { url: 'geckoterminal', status: 500 },
      {
        url: 'coingecko',
        status: 200,
        body: { [FAKE_TOKEN]: { usd: 0.07 } }
      }
    ])
    const price = await getPlotUsdPrice(true, { fetchFn, tokenAddress: FAKE_TOKEN })
    expect(price).toBeCloseTo(0.07, 6)
  })

  it('returns null when every source fails (CoinGecko empty + GeckoTerminal empty)', async () => {
    const { fetchFn, captured } = makeFetch([
      { url: 'geckoterminal', status: 200, body: {} },
      { url: 'coingecko', status: 200, body: {} }
    ])
    const price = await getPlotUsdPrice(true, { fetchFn, tokenAddress: FAKE_TOKEN })
    expect(price).toBeNull()
    // Both sources were attempted.
    expect(captured.map((c) => c.url).filter((u) => u.includes('geckoterminal'))).toHaveLength(1)
    expect(captured.map((c) => c.url).filter((u) => u.includes('coingecko'))).toHaveLength(1)
  })

  it('returns null when fetch throws on every source', async () => {
    const throwingFetch = vi.fn(async () => {
      throw new Error('network down')
    }) as unknown as typeof fetch
    const price = await getPlotUsdPrice(true, { fetchFn: throwingFetch, tokenAddress: FAKE_TOKEN })
    expect(price).toBeNull()
    // Both sources were attempted (then both threw).
    expect(throwingFetch).toHaveBeenCalledTimes(2)
  })

  it('rejects non-positive GeckoTerminal prices and falls back', async () => {
    const { fetchFn } = makeFetch([
      // Defense-in-depth: price_usd "0" should not be treated as valid.
      { url: 'geckoterminal', status: 200, body: { data: { attributes: { price_usd: '0' } } } },
      {
        url: 'coingecko',
        status: 200,
        body: { [FAKE_TOKEN]: { usd: 0.5 } }
      }
    ])
    const price = await getPlotUsdPrice(true, { fetchFn, tokenAddress: FAKE_TOKEN })
    expect(price).toBe(0.5)
  })

  it('rejects non-positive CoinGecko prices and returns null', async () => {
    const { fetchFn } = makeFetch([
      { url: 'geckoterminal', status: 200, body: {} },
      { url: 'coingecko', status: 200, body: { [FAKE_TOKEN]: { usd: 0 } } }
    ])
    const price = await getPlotUsdPrice(true, { fetchFn, tokenAddress: FAKE_TOKEN })
    expect(price).toBeNull()
  })

  it('caches a successful price for repeated calls within the TTL', async () => {
    const { fetchFn, captured } = makeFetch([
      {
        url: 'geckoterminal',
        status: 200,
        body: { data: { attributes: { price_usd: '0.01' } } }
      }
    ])
    const fixedNow = (): number => 1_000_000
    const first = await getPlotUsdPrice(true, { fetchFn, tokenAddress: FAKE_TOKEN, now: fixedNow })
    const second = await getPlotUsdPrice(false, {
      fetchFn,
      tokenAddress: FAKE_TOKEN,
      now: fixedNow
    })
    expect(first).toBe(0.01)
    expect(second).toBe(0.01)
    // Only one network call; the second hit was served from cache.
    expect(captured).toHaveLength(1)
  })

  it('forwards COINGECKO_API_KEY to the CoinGecko request when set in env', async () => {
    const ORIGINAL_KEY = process.env.COINGECKO_API_KEY
    process.env.COINGECKO_API_KEY = 'fake-test-api-key'
    try {
      const { fetchFn, captured } = makeFetch([
        { url: 'geckoterminal', status: 200, body: {} },
        {
          url: 'coingecko',
          status: 200,
          body: { [FAKE_TOKEN]: { usd: 0.123 } }
        }
      ])
      await getPlotUsdPrice(true, { fetchFn, tokenAddress: FAKE_TOKEN })
      const cgCall = captured.find((c) => c.url.includes('coingecko.com'))
      expect(cgCall).toBeDefined()
      const headers = cgCall!.headers as Record<string, string>
      expect(headers['x-cg-demo-api-key']).toBe('fake-test-api-key')
    } finally {
      if (ORIGINAL_KEY === undefined) delete process.env.COINGECKO_API_KEY
      else process.env.COINGECKO_API_KEY = ORIGINAL_KEY
    }
  })

  it('does not send the COINGECKO_API_KEY header when env var is unset', async () => {
    const ORIGINAL_KEY = process.env.COINGECKO_API_KEY
    delete process.env.COINGECKO_API_KEY
    try {
      const { fetchFn, captured } = makeFetch([
        { url: 'geckoterminal', status: 200, body: {} },
        {
          url: 'coingecko',
          status: 200,
          body: { [FAKE_TOKEN]: { usd: 0.123 } }
        }
      ])
      await getPlotUsdPrice(true, { fetchFn, tokenAddress: FAKE_TOKEN })
      const cgCall = captured.find((c) => c.url.includes('coingecko.com'))
      const headers = cgCall!.headers as Record<string, string>
      expect(headers['x-cg-demo-api-key']).toBeUndefined()
    } finally {
      if (ORIGINAL_KEY !== undefined) process.env.COINGECKO_API_KEY = ORIGINAL_KEY
    }
  })
})
