import { describe, it, expect } from 'vitest'
import { generateReport, isEditingAvailable, isPublishEnabled } from '../services/capabilityReport'
import type { GenerateReportOptions } from '../services/capabilityReport'

function mockLookup(available: Record<string, string>) {
  return async (cmd: string) => {
    if (cmd in available) {
      return { installed: true, version: available[cmd] }
    }
    return { installed: false, version: null }
  }
}

function opts(overrides: Partial<GenerateReportOptions> = {}): GenerateReportOptions {
  return {
    cliLookup: mockLookup({}),
    ...overrides
  }
}

describe('generateReport', () => {
  it('returns all five sections', async () => {
    const report = await generateReport(opts())
    expect(report.sections).toHaveLength(5)
    expect(report.sections.map((s) => s.title)).toEqual([
      'CLI Tools',
      'Local Capabilities',
      'Advanced Backends',
      'Integrations',
      'Publishing'
    ])
  })

  it('includes generatedAt timestamp', async () => {
    const report = await generateReport(opts())
    expect(new Date(report.generatedAt).getTime()).not.toBeNaN()
  })

  it('reports CLI tools as pass when available', async () => {
    const report = await generateReport(
      opts({ cliLookup: mockLookup({ claude: 'v1.0', codex: 'v2.0' }) })
    )
    const cliSection = report.sections.find((s) => s.title === 'CLI Tools')!
    for (const check of cliSection.checks) {
      expect(check.status).toBe('pass')
    }
  })

  it('reports CLI tools as fail when missing', async () => {
    const report = await generateReport(opts())
    const cliSection = report.sections.find((s) => s.title === 'CLI Tools')!
    for (const check of cliSection.checks) {
      expect(check.status).toBe('fail')
    }
  })

  it('includes CLI version in detail when installed', async () => {
    const report = await generateReport(opts({ cliLookup: mockLookup({ claude: 'claude 1.2.3' }) }))
    const claude = report.sections.flatMap((s) => s.checks).find((c) => c.id === 'cli-claude')!
    expect(claude.detail).toContain('claude 1.2.3')
  })

  it('manual image import is always pass', async () => {
    const report = await generateReport(opts())
    const imageCheck = report.sections
      .flatMap((s) => s.checks)
      .find((c) => c.id === 'image-import')!
    expect(imageCheck.status).toBe('pass')
  })

  it('export support is always pass', async () => {
    const report = await generateReport(opts())
    const exportCheck = report.sections.flatMap((s) => s.checks).find((c) => c.id === 'export')!
    expect(exportCheck.status).toBe('pass')
  })

  it('PlotLink endpoint is info placeholder', async () => {
    const report = await generateReport(opts())
    const plotLink = report.sections
      .flatMap((s) => s.checks)
      .find((c) => c.id === 'plotlink-endpoint')!
    expect(plotLink.status).toBe('info')
    expect(plotLink.detail).toContain('placeholder')
  })

  it('wallet is info placeholder', async () => {
    const report = await generateReport(opts())
    const wallet = report.sections.flatMap((s) => s.checks).find((c) => c.id === 'wallet')!
    expect(wallet.status).toBe('info')
    expect(wallet.detail).toContain('placeholder')
  })
})

describe('AtlasCloud guidance', () => {
  it('shows enabled state without storing keys', async () => {
    const report = await generateReport(opts({ atlasCloudGuidanceEnabled: true }))
    const atlas = report.sections
      .flatMap((s) => s.checks)
      .find((c) => c.id === 'atlascloud-guidance')!
    expect(atlas.status).toBe('info')
    expect(atlas.detail).toContain('does not store API keys')
    expect(atlas.detail).toContain('enabled')
  })

  it('shows disabled state', async () => {
    const report = await generateReport(opts({ atlasCloudGuidanceEnabled: false }))
    const atlas = report.sections
      .flatMap((s) => s.checks)
      .find((c) => c.id === 'atlascloud-guidance')!
    expect(atlas.status).toBe('info')
    expect(atlas.detail).toContain('not configured')
  })

  it('does not expose API key storage in report JSON', async () => {
    const report = await generateReport(opts({ atlasCloudGuidanceEnabled: true }))
    const json = JSON.stringify(report)
    expect(json).not.toContain('apiKey')
    expect(json).not.toContain('secret')
    expect(json).not.toContain('token')
  })
})

describe('publish readiness', () => {
  it('publish is disabled when CLIs are missing', async () => {
    const report = await generateReport(opts())
    const publish = report.sections.flatMap((s) => s.checks).find((c) => c.id === 'publish-ready')!
    expect(publish.status).toBe('fail')
    expect(publish.detail).toContain('disabled')
  })

  it('publish is disabled even with CLIs when PlotLink is placeholder', async () => {
    const report = await generateReport(
      opts({ cliLookup: mockLookup({ claude: 'v1', codex: 'v2' }) })
    )
    const publish = report.sections.flatMap((s) => s.checks).find((c) => c.id === 'publish-ready')!
    expect(publish.status).toBe('fail')
  })
})

describe('isEditingAvailable', () => {
  it('returns true when write access and image import pass', async () => {
    const report = await generateReport(opts())
    expect(isEditingAvailable(report)).toBe(true)
  })

  it('editing is always available regardless of CLI status', async () => {
    const report = await generateReport(opts())
    expect(isEditingAvailable(report)).toBe(true)
  })
})

describe('isPublishEnabled', () => {
  it('returns false when publish check fails', async () => {
    const report = await generateReport(opts())
    expect(isPublishEnabled(report)).toBe(false)
  })
})
