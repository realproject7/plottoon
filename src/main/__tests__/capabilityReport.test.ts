import { describe, it, expect } from 'vitest'
import { generateReport, isEditingAvailable, isPublishEnabled } from '../services/capabilityReport'
import type { CapabilityCheck, GenerateReportOptions } from '../services/capabilityReport'

const CLAUDE_PASS: CapabilityCheck = {
  id: 'cli-claude',
  label: 'Claude CLI',
  status: 'pass',
  detail: 'Detected: claude 1.2.3'
}
const CODEX_PASS: CapabilityCheck = {
  id: 'cli-codex',
  label: 'Codex CLI',
  status: 'pass',
  detail: 'Detected: codex 2.0'
}
const CLAUDE_FAIL: CapabilityCheck = {
  id: 'cli-claude',
  label: 'Claude CLI',
  status: 'fail',
  detail: 'claude not found in PATH'
}
const CODEX_FAIL: CapabilityCheck = {
  id: 'cli-codex',
  label: 'Codex CLI',
  status: 'fail',
  detail: 'codex not found in PATH'
}
const WRITE_PASS: CapabilityCheck = {
  id: 'write-access',
  label: 'Project write access',
  status: 'pass',
  detail: 'Filesystem is writable'
}
const WRITE_FAIL: CapabilityCheck = {
  id: 'write-access',
  label: 'Project write access',
  status: 'fail',
  detail: 'No projects directory configured'
}

function opts(overrides: Partial<GenerateReportOptions> = {}): GenerateReportOptions {
  return {
    cliChecks: [CLAUDE_FAIL, CODEX_FAIL],
    writeAccessCheck: WRITE_PASS,
    ...overrides
  }
}

describe('generateReport', () => {
  it('returns all five sections', () => {
    const report = generateReport(opts())
    expect(report.sections).toHaveLength(5)
    expect(report.sections.map((s) => s.title)).toEqual([
      'CLI Tools',
      'Local Capabilities',
      'Advanced Backends',
      'Integrations',
      'Publishing'
    ])
  })

  it('includes generatedAt timestamp', () => {
    const report = generateReport(opts())
    expect(new Date(report.generatedAt).getTime()).not.toBeNaN()
  })

  it('reports CLI tools as pass when provided', () => {
    const report = generateReport(opts({ cliChecks: [CLAUDE_PASS, CODEX_PASS] }))
    const cliSection = report.sections.find((s) => s.title === 'CLI Tools')!
    for (const check of cliSection.checks) {
      expect(check.status).toBe('pass')
    }
  })

  it('reports CLI tools as fail when provided', () => {
    const report = generateReport(opts())
    const cliSection = report.sections.find((s) => s.title === 'CLI Tools')!
    for (const check of cliSection.checks) {
      expect(check.status).toBe('fail')
    }
  })

  it('includes CLI version in detail', () => {
    const report = generateReport(opts({ cliChecks: [CLAUDE_PASS] }))
    const claude = report.sections.flatMap((s) => s.checks).find((c) => c.id === 'cli-claude')!
    expect(claude.detail).toContain('claude 1.2.3')
  })

  it('manual image import is always pass', () => {
    const report = generateReport(opts())
    const imageCheck = report.sections
      .flatMap((s) => s.checks)
      .find((c) => c.id === 'image-import')!
    expect(imageCheck.status).toBe('pass')
  })

  it('export support is always pass', () => {
    const report = generateReport(opts())
    const exportCheck = report.sections.flatMap((s) => s.checks).find((c) => c.id === 'export')!
    expect(exportCheck.status).toBe('pass')
  })

  it('PlotLink endpoint is info placeholder', () => {
    const report = generateReport(opts())
    const plotLink = report.sections
      .flatMap((s) => s.checks)
      .find((c) => c.id === 'plotlink-endpoint')!
    expect(plotLink.status).toBe('info')
    expect(plotLink.detail).toContain('placeholder')
  })

  it('wallet is info placeholder', () => {
    const report = generateReport(opts())
    const wallet = report.sections.flatMap((s) => s.checks).find((c) => c.id === 'wallet')!
    expect(wallet.status).toBe('info')
    expect(wallet.detail).toContain('placeholder')
  })

  it('defaults write-access to fail when not provided', () => {
    const report = generateReport({ cliChecks: [] })
    const writeCheck = report.sections
      .flatMap((s) => s.checks)
      .find((c) => c.id === 'write-access')!
    expect(writeCheck.status).toBe('fail')
    expect(writeCheck.detail).toContain('No projects directory configured')
  })
})

describe('AtlasCloud guidance', () => {
  it('shows enabled state without storing keys', () => {
    const report = generateReport(opts({ atlasCloudGuidanceEnabled: true }))
    const atlas = report.sections
      .flatMap((s) => s.checks)
      .find((c) => c.id === 'atlascloud-guidance')!
    expect(atlas.status).toBe('info')
    expect(atlas.detail).toContain('does not store API keys')
    expect(atlas.detail).toContain('enabled')
  })

  it('shows disabled state with no-key-storage policy', () => {
    const report = generateReport(opts({ atlasCloudGuidanceEnabled: false }))
    const atlas = report.sections
      .flatMap((s) => s.checks)
      .find((c) => c.id === 'atlascloud-guidance')!
    expect(atlas.status).toBe('info')
    expect(atlas.detail).toContain('not configured')
    expect(atlas.detail).toContain('does not store API keys')
  })

  it('does not expose API key storage in report JSON', () => {
    const report = generateReport(opts({ atlasCloudGuidanceEnabled: true }))
    const json = JSON.stringify(report)
    expect(json).not.toContain('apiKey')
    expect(json).not.toContain('secret')
    expect(json).not.toContain('token')
  })
})

describe('publish readiness', () => {
  it('publish is disabled when CLIs are missing', () => {
    const report = generateReport(opts())
    const publish = report.sections.flatMap((s) => s.checks).find((c) => c.id === 'publish-ready')!
    expect(publish.status).toBe('fail')
    expect(publish.detail).toContain('disabled')
  })

  it('publish is disabled even with CLIs when PlotLink is placeholder', () => {
    const report = generateReport(opts({ cliChecks: [CLAUDE_PASS, CODEX_PASS] }))
    const publish = report.sections.flatMap((s) => s.checks).find((c) => c.id === 'publish-ready')!
    expect(publish.status).toBe('fail')
  })
})

describe('isEditingAvailable', () => {
  it('returns true when write access passes', () => {
    const report = generateReport(opts({ writeAccessCheck: WRITE_PASS }))
    expect(isEditingAvailable(report)).toBe(true)
  })

  it('returns false when write access fails', () => {
    const report = generateReport(opts({ writeAccessCheck: WRITE_FAIL }))
    expect(isEditingAvailable(report)).toBe(false)
  })

  it('editing depends on write access not CLI status', () => {
    const report = generateReport(opts({ cliChecks: [], writeAccessCheck: WRITE_PASS }))
    expect(isEditingAvailable(report)).toBe(true)
  })
})

describe('isPublishEnabled', () => {
  it('returns false when publish check fails', () => {
    const report = generateReport(opts())
    expect(isPublishEnabled(report)).toBe(false)
  })
})
