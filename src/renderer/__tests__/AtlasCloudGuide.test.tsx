// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { AtlasCloudGuide } from '../AtlasCloudGuide'

const SECRET = 'fake-test-distinctive-atlascloud-key-9988'

interface MockStatus {
  entries: Array<{
    envName: string
    bridgeKey: 'atlascloud'
    enabled: boolean
    configured: boolean
  }>
}

function installApi(
  initial: MockStatus,
  onSet?: (next: { atlascloud?: boolean }) => MockStatus
): {
  getStatus: ReturnType<typeof vi.fn>
  setConfig: ReturnType<typeof vi.fn>
} {
  const getStatus = vi.fn(async () => initial)
  const setConfig = vi.fn(async (next: { atlascloud?: boolean }) => {
    const refreshed = onSet
      ? onSet(next)
      : {
          entries: initial.entries.map((e) =>
            e.bridgeKey === 'atlascloud' ? { ...e, enabled: next.atlascloud === true } : e
          )
        }
    return refreshed
  })
  ;(window as unknown as { plottoon: Record<string, unknown> }).plottoon = {
    agentEnvBridge: { getStatus, setConfig }
  }
  return { getStatus, setConfig }
}

beforeEach(() => {
  // Each test installs its own API; reset the global state between tests
  // so the DOM doesn't carry over.
  ;(window as unknown as { plottoon: unknown }).plottoon = {}
})

afterEach(cleanup)

describe('#276 AtlasCloudGuide — env bridge card', () => {
  it('renders the bridge card with non-configured + disabled state on a fresh install', async () => {
    installApi({
      entries: [
        {
          envName: 'ATLASCLOUD_API_KEY',
          bridgeKey: 'atlascloud',
          enabled: false,
          configured: false
        }
      ]
    })
    render(<AtlasCloudGuide />)
    await screen.findByTestId('atlascloud-bridge-card')
    await waitFor(() => {
      expect(screen.getByTestId('atlascloud-bridge-row')).toBeDefined()
    })
    expect(screen.getByTestId('atlascloud-bridge-configured').textContent).toMatch(
      /not set in shell/i
    )
    const toggle = screen.getByTestId('atlascloud-bridge-toggle') as HTMLButtonElement
    expect(toggle.textContent).toMatch(/Enable bridge/)
    expect(toggle.getAttribute('aria-pressed')).toBe('false')
  })

  it('shows configured chip when the shell env var is set (status carries no value)', async () => {
    installApi({
      entries: [
        { envName: 'ATLASCLOUD_API_KEY', bridgeKey: 'atlascloud', enabled: false, configured: true }
      ]
    })
    const { container } = render(<AtlasCloudGuide />)
    await screen.findByTestId('atlascloud-bridge-row')
    expect(screen.getByTestId('atlascloud-bridge-configured').textContent).toMatch(
      /configured in shell/i
    )
    // The key value never appears in the DOM (it was never sent through
    // the status payload in the first place — but pin it).
    expect(container.innerHTML).not.toContain(SECRET)
  })

  it('flips the toggle: clicking calls setConfig({atlascloud: true}) and updates the button label', async () => {
    const { setConfig } = installApi({
      entries: [
        { envName: 'ATLASCLOUD_API_KEY', bridgeKey: 'atlascloud', enabled: false, configured: true }
      ]
    })
    render(<AtlasCloudGuide />)
    const toggle = (await screen.findByTestId('atlascloud-bridge-toggle')) as HTMLButtonElement
    expect(toggle.textContent).toMatch(/Enable bridge/)
    fireEvent.click(toggle)
    await waitFor(() => {
      expect(setConfig).toHaveBeenCalledWith({ atlascloud: true })
    })
    await waitFor(() => {
      expect(screen.getByTestId('atlascloud-bridge-toggle').textContent).toMatch(/Disable bridge/)
      expect(screen.getByTestId('atlascloud-bridge-toggle').getAttribute('aria-pressed')).toBe(
        'true'
      )
    })
  })

  it('surfaces an inline error when setConfig rejects (no key leakage in error path)', async () => {
    installApi({
      entries: [
        { envName: 'ATLASCLOUD_API_KEY', bridgeKey: 'atlascloud', enabled: false, configured: true }
      ]
    })
    // Replace setConfig with a rejecting mock.
    const win = window as unknown as {
      plottoon: { agentEnvBridge: { setConfig: ReturnType<typeof vi.fn> } }
    }
    win.plottoon.agentEnvBridge.setConfig = vi.fn().mockRejectedValue(new Error('disk full'))
    render(<AtlasCloudGuide />)
    const toggle = await screen.findByTestId('atlascloud-bridge-toggle')
    fireEvent.click(toggle)
    await waitFor(() => {
      expect(screen.getByTestId('atlascloud-bridge-error').textContent).toContain('disk full')
    })
    // Error text doesn't carry any secret-looking strings (defensive
    // pin — the error message is "disk full"; we just assert no
    // ATLASCLOUD_API_KEY value would survive even if a future helper
    // started forwarding env values).
    const errorEl = screen.getByTestId('atlascloud-bridge-error')
    expect(errorEl.textContent).not.toContain(SECRET)
  })

  it('full DOM never carries any secret-shaped string even when configured + enabled', async () => {
    installApi({
      entries: [
        { envName: 'ATLASCLOUD_API_KEY', bridgeKey: 'atlascloud', enabled: true, configured: true }
      ]
    })
    const { container } = render(<AtlasCloudGuide />)
    await screen.findByTestId('atlascloud-bridge-row')
    const html = container.innerHTML
    expect(html).not.toContain(SECRET)
    // Status payload structure should not include `apiKey` / `secret` / `token` / `privateKey` keys.
    expect(html).not.toMatch(/apiKey|privateKey|mnemonic|passphrase/i)
  })
})
