import { describe, it, expect } from 'vitest'
import { detectClis, isCliAvailable } from '../services/cliDetection'
import type { CapabilityReport } from '../services/cliDetection'

function mockLookup(available: Record<string, string>) {
  return async (cmd: string) => {
    if (cmd in available) {
      return { installed: true, version: available[cmd] }
    }
    return { installed: false, version: null }
  }
}

describe('detectClis', () => {
  it('reports both CLIs as installed when available', async () => {
    const report = await detectClis(mockLookup({ claude: 'claude 1.0.0', codex: 'codex 2.0.0' }))
    expect(report.clis).toHaveLength(2)

    const claude = report.clis.find((c) => c.command === 'claude')!
    expect(claude.installed).toBe(true)
    expect(claude.version).toBe('claude 1.0.0')
    expect(claude.name).toBe('Claude CLI')

    const codex = report.clis.find((c) => c.command === 'codex')!
    expect(codex.installed).toBe(true)
    expect(codex.version).toBe('codex 2.0.0')
    expect(codex.name).toBe('Codex CLI')
  })

  it('reports CLIs as missing when not available', async () => {
    const report = await detectClis(mockLookup({}))
    for (const cli of report.clis) {
      expect(cli.installed).toBe(false)
      expect(cli.version).toBeNull()
    }
  })

  it('handles mixed availability', async () => {
    const report = await detectClis(mockLookup({ claude: 'v1.2.3' }))
    expect(report.clis.find((c) => c.command === 'claude')!.installed).toBe(true)
    expect(report.clis.find((c) => c.command === 'codex')!.installed).toBe(false)
  })

  it('includes detectedAt timestamp', async () => {
    const report = await detectClis(mockLookup({}))
    expect(report.detectedAt).toBeTruthy()
    expect(new Date(report.detectedAt).getTime()).not.toBeNaN()
  })

  it('does not expose local paths or environment data', async () => {
    const report = await detectClis(mockLookup({ claude: 'v1.0' }))
    const json = JSON.stringify(report)
    expect(json).not.toContain(process.env.HOME || '/Users')
    expect(json).not.toContain('PATH')
  })
})

describe('isCliAvailable', () => {
  let report: CapabilityReport

  it('returns true for installed CLI', async () => {
    report = await detectClis(mockLookup({ claude: 'v1' }))
    expect(isCliAvailable(report, 'claude')).toBe(true)
  })

  it('returns false for missing CLI', async () => {
    report = await detectClis(mockLookup({}))
    expect(isCliAvailable(report, 'claude')).toBe(false)
  })

  it('returns false for unknown command', async () => {
    report = await detectClis(mockLookup({}))
    expect(isCliAvailable(report, 'nonexistent')).toBe(false)
  })
})

describe('missing CLI does not block editing', () => {
  it('report is always returned regardless of availability', async () => {
    const report = await detectClis(mockLookup({}))
    expect(report).toBeDefined()
    expect(report.clis).toHaveLength(2)
    expect(report.detectedAt).toBeTruthy()
  })
})
