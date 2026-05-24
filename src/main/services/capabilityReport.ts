import type { PublishConfig } from './plotlinkPublish'
import { validatePublishConfig } from './plotlinkPublish'
import {
  evaluatePublishReadiness,
  type CapabilityCheck,
  type CheckStatus
} from '../../shared/publishReadiness'

export { evaluatePublishReadiness }
export type { CapabilityCheck, CheckStatus }

export interface CapabilitySection {
  title: string
  checks: CapabilityCheck[]
}

export interface FirstRunReport {
  generatedAt: string
  sections: CapabilitySection[]
}

/**
 * Renderer-safe view of the active wallet — only the non-signing metadata
 * the Status page needs. Keeping this narrow avoids passing OWS internal
 * names across IPC for a display-only surface (#234 boundary).
 */
export interface ActiveWalletView {
  address: string
  source: string
}

function checkImageImport(): CapabilityCheck {
  return {
    id: 'image-import',
    label: 'Manual image import',
    status: 'pass',
    detail: 'Manual clean image import is always available'
  }
}

function checkAtlasCloudGuidance(guidanceEnabled: boolean): CapabilityCheck {
  if (guidanceEnabled) {
    return {
      id: 'atlascloud-guidance',
      label: 'AtlasCloud guidance',
      status: 'info',
      detail:
        'AtlasCloud backend guidance is enabled. PlotToon does not store API keys — your Claude/Codex environment owns API key configuration.'
    }
  }
  return {
    id: 'atlascloud-guidance',
    label: 'AtlasCloud guidance',
    status: 'info',
    detail:
      'AtlasCloud backend guidance is not configured. PlotToon does not store API keys — enable it in your Claude/Codex environment.'
  }
}

interface PlotLinkCheckInput {
  publishConfig?: PublishConfig | null
  signerMode?: 'live' | 'mock'
}

function checkPlotLink(input: PlotLinkCheckInput): CapabilityCheck {
  const signerMode = input.signerMode ?? 'live'
  const config = input.publishConfig ?? null
  if (signerMode === 'mock') {
    return {
      id: 'plotlink-endpoint',
      label: 'PlotLink endpoint',
      status: 'pass',
      detail: 'Mock signer mode — PlotLink endpoint not required for local-only publish'
    }
  }
  if (!config) {
    return {
      id: 'plotlink-endpoint',
      label: 'PlotLink endpoint',
      status: 'fail',
      detail: 'PlotLink publish config is not available'
    }
  }
  const errors = validatePublishConfig(config)
  if (errors.length === 0) {
    return {
      id: 'plotlink-endpoint',
      label: 'PlotLink endpoint',
      status: 'pass',
      detail: `PlotLink configured: ${config.plotlinkBaseUrl}`
    }
  }
  return {
    id: 'plotlink-endpoint',
    label: 'PlotLink endpoint',
    status: 'fail',
    detail: errors.join('; ')
  }
}

interface WalletCheckInput {
  activeWallet: ActiveWalletView | null
  /**
   * #253 RE1: when the active identity exists, the Status report must
   * verify it would still pass the live signing freshness guard (#235 /
   * #240). Otherwise a restored identity whose vault entry was removed,
   * renamed, or carries a mismatched EVM address would let `Wallet` and
   * `Publish features` show pass while live publish/claim/agent flows
   * fail at `checkActiveWalletInVault` before signing.
   *
   * In live mode the caller passes the result of running the helper
   * against the *internal* identity (`{ name: owsName, address }`); the
   * report only sees the generic `{ ok, error? }` outcome and the
   * non-secret error string — never `owsName` or vault paths.
   *
   * Pass `null` to opt out (mock signer mode, tests without OWS).
   */
  freshness: { ok: boolean; error?: string } | null
}

function checkWallet(input: WalletCheckInput): CapabilityCheck {
  const { activeWallet, freshness } = input
  if (!activeWallet) {
    return {
      id: 'wallet',
      label: 'Wallet',
      status: 'fail',
      detail: 'No active wallet. Connect or pick a wallet in the sidebar to publish.'
    }
  }
  const short = `${activeWallet.address.slice(0, 6)}…${activeWallet.address.slice(-4)}`
  if (freshness && !freshness.ok) {
    // The vault freshness guard returned a generic non-secret message; we
    // forward it verbatim so the Status page wording stays aligned with
    // the publish/claim/agent paths that already surface the same string.
    return {
      id: 'wallet',
      label: 'Wallet',
      status: 'fail',
      detail: freshness.error ?? 'Active wallet is no longer available in the OWS vault.'
    }
  }
  return {
    id: 'wallet',
    label: 'Wallet',
    status: 'pass',
    detail: `Active wallet ${short} (${activeWallet.source})`
  }
}

function checkSignerMode(mode: 'live' | 'mock'): CapabilityCheck {
  if (mode === 'live') {
    return {
      id: 'signer-mode',
      label: 'Signer mode',
      status: 'info',
      detail: 'Live — publishes sign with the active wallet and submit to PlotLink.'
    }
  }
  return {
    id: 'signer-mode',
    label: 'Signer mode',
    status: 'info',
    detail: 'Mock — publishes stay local; no signatures and no PlotLink calls.'
  }
}

function checkExport(): CapabilityCheck {
  return {
    id: 'export',
    label: 'Export support',
    status: 'pass',
    detail: 'Local export is available'
  }
}

export interface GenerateReportOptions {
  cliChecks?: CapabilityCheck[]
  writeAccessCheck?: CapabilityCheck
  atlasCloudGuidanceEnabled?: boolean
  /**
   * Active wallet from the identity store. `null` is the explicit "no
   * active wallet selected" state — distinct from `undefined`, which is
   * "caller did not provide a wallet view" (treated as no wallet).
   */
  activeWallet?: ActiveWalletView | null
  /**
   * Publish config (`getDefaultPublishConfig()` result). Used to validate
   * PlotLink readiness in live mode.
   */
  publishConfig?: PublishConfig | null
  /**
   * Signer mode resolved at app startup from `PLOTLINK_SIGNER_MODE`.
   * Defaults to `live` to keep the historically-strict behavior when
   * callers don't set it.
   */
  signerMode?: 'live' | 'mock'
  /**
   * #253 RE1: outcome of the vault freshness check for the active
   * identity (`checkActiveWalletInVault`), produced by the caller. The
   * report only sees `{ ok, error? }` so the helper's OWS-name input
   * stays inside the IPC handler. `null` (default) means the freshness
   * check did not run — the wallet check then only validates presence,
   * which is the right behavior for mock mode or tests that don't wire
   * an OWS module.
   */
  walletFreshness?: { ok: boolean; error?: string } | null
}

export function generateReport(options: GenerateReportOptions = {}): FirstRunReport {
  const { atlasCloudGuidanceEnabled = false, signerMode = 'live' } = options

  const cliChecks = options.cliChecks ?? []
  const writeCheck = options.writeAccessCheck ?? {
    id: 'write-access',
    label: 'Project write access',
    status: 'fail' as CheckStatus,
    detail:
      'No projects directory configured. Choose a projects folder via "New Project" on the Projects screen to enable editing and publishing.'
  }
  const imageCheck = checkImageImport()
  const atlasCheck = checkAtlasCloudGuidance(atlasCloudGuidanceEnabled)
  const plotLinkCheck = checkPlotLink({
    publishConfig: options.publishConfig ?? null,
    signerMode
  })
  const walletCheck = checkWallet({
    activeWallet: options.activeWallet ?? null,
    freshness: options.walletFreshness ?? null
  })
  const signerModeCheck = checkSignerMode(signerMode)
  const exportCheck = checkExport()

  const allChecks = [
    ...cliChecks,
    writeCheck,
    imageCheck,
    atlasCheck,
    plotLinkCheck,
    walletCheck,
    signerModeCheck,
    exportCheck
  ]
  const publishCheck = evaluatePublishReadiness(allChecks)

  return {
    generatedAt: new Date().toISOString(),
    sections: [
      { title: 'CLI Tools', checks: cliChecks },
      { title: 'Local Capabilities', checks: [writeCheck, imageCheck, exportCheck] },
      { title: 'Advanced Backends', checks: [atlasCheck] },
      { title: 'Integrations', checks: [plotLinkCheck, walletCheck, signerModeCheck] },
      { title: 'Publishing', checks: [publishCheck] }
    ]
  }
}

export function isEditingAvailable(report: FirstRunReport): boolean {
  const writeCheck = report.sections.flatMap((s) => s.checks).find((c) => c.id === 'write-access')
  const imageCheck = report.sections.flatMap((s) => s.checks).find((c) => c.id === 'image-import')
  return writeCheck?.status === 'pass' && imageCheck?.status === 'pass'
}

export function isPublishEnabled(report: FirstRunReport): boolean {
  const publishCheck = report.sections
    .flatMap((s) => s.checks)
    .find((c) => c.id === 'publish-ready')
  return publishCheck?.status === 'pass'
}
