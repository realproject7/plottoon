import { describe, it, expect } from 'vitest'
import {
  generateReport,
  isEditingAvailable,
  isPublishEnabled,
  evaluatePublishReadiness
} from '../services/capabilityReport'
import type { CapabilityCheck, GenerateReportOptions } from '../services/capabilityReport'
import type { PublishConfig } from '../services/plotlinkPublish'

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

const FAKE_WALLET = {
  address: '0xaaaa000000000000000000000000000000000001',
  source: 'plottoon-writer'
}

const PUBLISH_CONFIG_VALID: PublishConfig = {
  rpcUrl: 'https://example-rpc.invalid',
  plotlinkBaseUrl: 'https://example-plotlink.invalid',
  storyFactoryAddress: '0xdead000000000000000000000000000000000001',
  mcv2BondAddress: '0xdead000000000000000000000000000000000002',
  indexRetries: 10,
  indexRetryDelayMs: 30000,
  indexInitialDelayMs: 8000
}

const PUBLISH_CONFIG_MISSING: PublishConfig = {
  // Zero address for both contracts triggers `validatePublishConfig` errors.
  rpcUrl: '',
  plotlinkBaseUrl: '',
  storyFactoryAddress: '0x0000000000000000000000000000000000000000',
  mcv2BondAddress: '0x0000000000000000000000000000000000000000',
  indexRetries: 10,
  indexRetryDelayMs: 30000,
  indexInitialDelayMs: 8000
}

function opts(overrides: Partial<GenerateReportOptions> = {}): GenerateReportOptions {
  return {
    cliChecks: [CLAUDE_FAIL, CODEX_FAIL],
    writeAccessCheck: WRITE_PASS,
    activeWallet: FAKE_WALLET,
    publishConfig: PUBLISH_CONFIG_VALID,
    signerMode: 'live',
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

  it('defaults write-access to fail (with CTA pointing to Projects) when not provided', () => {
    const report = generateReport({ cliChecks: [] })
    const writeCheck = report.sections
      .flatMap((s) => s.checks)
      .find((c) => c.id === 'write-access')!
    expect(writeCheck.status).toBe('fail')
    expect(writeCheck.detail).toContain('No projects directory configured')
    // #253: the detail must include a clear CTA so the user knows how to
    // recover instead of being stuck on a fail with no instructions.
    expect(writeCheck.detail).toMatch(/Projects screen/i)
  })
})

describe('#253 PlotLink endpoint check', () => {
  it('passes when live mode and publishConfig is valid', () => {
    const report = generateReport(opts())
    const plotLink = report.sections
      .flatMap((s) => s.checks)
      .find((c) => c.id === 'plotlink-endpoint')!
    expect(plotLink.status).toBe('pass')
    expect(plotLink.detail).toContain('https://example-plotlink.invalid')
    // No placeholder text from the old static check.
    expect(plotLink.detail).not.toMatch(/placeholder/i)
  })

  it('fails when live mode and publishConfig is missing required fields', () => {
    const report = generateReport(opts({ publishConfig: PUBLISH_CONFIG_MISSING }))
    const plotLink = report.sections
      .flatMap((s) => s.checks)
      .find((c) => c.id === 'plotlink-endpoint')!
    expect(plotLink.status).toBe('fail')
    // Lists the underlying validatePublishConfig errors so the user can fix.
    expect(plotLink.detail).toMatch(/PLOTLINK_STORY_FACTORY_ADDRESS/)
    expect(plotLink.detail).toMatch(/BASE_RPC_URL/)
  })

  it('passes in mock signer mode regardless of PlotLink config', () => {
    const report = generateReport(opts({ signerMode: 'mock', publishConfig: null }))
    const plotLink = report.sections
      .flatMap((s) => s.checks)
      .find((c) => c.id === 'plotlink-endpoint')!
    expect(plotLink.status).toBe('pass')
    expect(plotLink.detail).toMatch(/mock signer mode/i)
  })

  it('fails when no publishConfig is provided in live mode', () => {
    const report = generateReport(opts({ publishConfig: null }))
    const plotLink = report.sections
      .flatMap((s) => s.checks)
      .find((c) => c.id === 'plotlink-endpoint')!
    expect(plotLink.status).toBe('fail')
    expect(plotLink.detail).toMatch(/PlotLink publish config is not available/i)
  })
})

describe('#253 Wallet check', () => {
  it('passes when an active wallet is provided', () => {
    const report = generateReport(opts())
    const wallet = report.sections.flatMap((s) => s.checks).find((c) => c.id === 'wallet')!
    expect(wallet.status).toBe('pass')
    expect(wallet.detail).toContain('0xaaaa')
    expect(wallet.detail).toContain('plottoon-writer')
    // No placeholder leakage.
    expect(wallet.detail).not.toMatch(/placeholder/i)
  })

  it('fails with a CTA when no active wallet is selected', () => {
    const report = generateReport(opts({ activeWallet: null }))
    const wallet = report.sections.flatMap((s) => s.checks).find((c) => c.id === 'wallet')!
    expect(wallet.status).toBe('fail')
    expect(wallet.detail).toMatch(/no active wallet/i)
    expect(wallet.detail).toMatch(/sidebar/i)
  })

  it('truncates the address — does not leak full key material lookalikes', () => {
    const report = generateReport(opts())
    const wallet = report.sections.flatMap((s) => s.checks).find((c) => c.id === 'wallet')!
    // The shown address is the truncated form (`0xaaaa…0001`), not the
    // full 42-character string.
    expect(wallet.detail).not.toContain('0xaaaa000000000000000000000000000000000001')
    expect(wallet.detail).toContain('0xaaaa')
    expect(wallet.detail).toContain('0001')
  })
})

describe('#253 Signer mode check', () => {
  it('shows live mode info when signerMode is live', () => {
    const report = generateReport(opts({ signerMode: 'live' }))
    const signer = report.sections.flatMap((s) => s.checks).find((c) => c.id === 'signer-mode')!
    expect(signer.status).toBe('info')
    expect(signer.detail).toMatch(/Live/i)
  })

  it('shows mock mode info when signerMode is mock', () => {
    const report = generateReport(opts({ signerMode: 'mock' }))
    const signer = report.sections.flatMap((s) => s.checks).find((c) => c.id === 'signer-mode')!
    expect(signer.status).toBe('info')
    expect(signer.detail).toMatch(/Mock/i)
  })
})

describe('AtlasCloud guidance — informational only, never blocks publish', () => {
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

  it('AtlasCloud disabled does NOT block publish-ready', () => {
    // All real prereqs pass; AtlasCloud is off. publish-ready must still pass.
    const report = generateReport(
      opts({
        cliChecks: [CLAUDE_PASS],
        atlasCloudGuidanceEnabled: false
      })
    )
    const publish = report.sections.flatMap((s) => s.checks).find((c) => c.id === 'publish-ready')!
    expect(publish.status).toBe('pass')
  })
})

describe('#253 publish readiness — real prereqs', () => {
  it('passes when write-access, wallet, plotlink-endpoint, and at least one CLI pass', () => {
    const report = generateReport(opts({ cliChecks: [CLAUDE_PASS] }))
    const publish = report.sections.flatMap((s) => s.checks).find((c) => c.id === 'publish-ready')!
    expect(publish.status).toBe('pass')
    expect(publish.detail).toMatch(/all publish requirements met/i)
  })

  it('passes with only Codex CLI present (does not require BOTH Claude and Codex)', () => {
    const report = generateReport(opts({ cliChecks: [CODEX_PASS] }))
    const publish = report.sections.flatMap((s) => s.checks).find((c) => c.id === 'publish-ready')!
    expect(publish.status).toBe('pass')
  })

  it('fails when both CLI checks are present but neither passes', () => {
    const report = generateReport(opts({ cliChecks: [CLAUDE_FAIL, CODEX_FAIL] }))
    const publish = report.sections.flatMap((s) => s.checks).find((c) => c.id === 'publish-ready')!
    expect(publish.status).toBe('fail')
    expect(publish.detail).toMatch(/Claude CLI or Codex CLI/i)
  })

  it('fails when write-access is failing', () => {
    const report = generateReport(
      opts({
        cliChecks: [CLAUDE_PASS],
        writeAccessCheck: WRITE_FAIL
      })
    )
    const publish = report.sections.flatMap((s) => s.checks).find((c) => c.id === 'publish-ready')!
    expect(publish.status).toBe('fail')
    expect(publish.detail).toMatch(/write-access/)
  })

  it('fails when no active wallet is selected', () => {
    const report = generateReport(opts({ cliChecks: [CLAUDE_PASS], activeWallet: null }))
    const publish = report.sections.flatMap((s) => s.checks).find((c) => c.id === 'publish-ready')!
    expect(publish.status).toBe('fail')
    expect(publish.detail).toMatch(/wallet/)
  })

  it('fails when PlotLink publish config is invalid in live mode', () => {
    const report = generateReport(
      opts({
        cliChecks: [CLAUDE_PASS],
        publishConfig: PUBLISH_CONFIG_MISSING
      })
    )
    const publish = report.sections.flatMap((s) => s.checks).find((c) => c.id === 'publish-ready')!
    expect(publish.status).toBe('fail')
    expect(publish.detail).toMatch(/plotlink-endpoint/)
  })

  it('passes in mock signer mode even when publishConfig is null', () => {
    const report = generateReport(
      opts({
        cliChecks: [CLAUDE_PASS],
        signerMode: 'mock',
        publishConfig: null
      })
    )
    const publish = report.sections.flatMap((s) => s.checks).find((c) => c.id === 'publish-ready')!
    expect(publish.status).toBe('pass')
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
    const report = generateReport(opts({ cliChecks: [], writeAccessCheck: WRITE_FAIL }))
    expect(isPublishEnabled(report)).toBe(false)
  })

  it('returns true when all real prereqs pass', () => {
    const report = generateReport(opts({ cliChecks: [CLAUDE_PASS] }))
    expect(isPublishEnabled(report)).toBe(true)
  })
})

describe('#253 evaluatePublishReadiness — pure-function shape (renderer-shared)', () => {
  // The renderer re-runs this against the augmented check list so the
  // browser-only export checks gate publish-ready. The pure function must
  // be importable without dragging viem or electron — the shared module
  // has no main-process imports.
  it('skips absent IDs (does not require export checks when they are missing)', () => {
    const subset: CapabilityCheck[] = [
      { id: 'write-access', label: 'w', status: 'pass', detail: '' },
      { id: 'wallet', label: 'w', status: 'pass', detail: '' },
      { id: 'plotlink-endpoint', label: 'p', status: 'pass', detail: '' },
      { id: 'cli-claude', label: 'c', status: 'pass', detail: '' }
    ]
    const result = evaluatePublishReadiness(subset)
    expect(result.status).toBe('pass')
  })

  it('fails when a present export check fails', () => {
    const checks: CapabilityCheck[] = [
      { id: 'write-access', label: 'w', status: 'pass', detail: '' },
      { id: 'wallet', label: 'w', status: 'pass', detail: '' },
      { id: 'plotlink-endpoint', label: 'p', status: 'pass', detail: '' },
      { id: 'cli-claude', label: 'c', status: 'pass', detail: '' },
      { id: 'export-webp', label: 'e', status: 'fail', detail: '' }
    ]
    const result = evaluatePublishReadiness(checks)
    expect(result.status).toBe('fail')
    expect(result.detail).toMatch(/export-webp/)
  })
})
