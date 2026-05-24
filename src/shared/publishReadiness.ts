/**
 * Pure publish-readiness logic shared between the main process (which
 * builds the initial capability report) and the renderer (which augments
 * the report with browser-only export checks and re-derives the
 * `publish-ready` row from the combined set).
 *
 * Kept dependency-free on purpose: importing this from the renderer must
 * NOT drag viem / electron / fs into the renderer bundle.
 */

export type CheckStatus = 'pass' | 'fail' | 'info'

export interface CapabilityCheck {
  id: string
  label: string
  status: CheckStatus
  detail: string
}

/**
 * Required check IDs for `Publish features` to pass. Each ID, when present
 * in `checks`, must be `pass`. IDs that are absent are skipped — that way
 * the main-process call (which doesn't see renderer-only export rows)
 * doesn't force them, while the renderer's post-augment call enforces
 * them once they're added.
 */
export const PUBLISH_REQUIRED_IDS: ReadonlyArray<string> = [
  'write-access',
  'wallet',
  'plotlink-endpoint',
  'export-webp',
  'export-jpeg',
  'font-render'
]

/**
 * "At least one of these must pass" — the product allows Claude CLI OR
 * Codex CLI; we don't require both. If neither check is present, the
 * group is treated as satisfied (no CLI checks attempted).
 */
export const PUBLISH_CLI_GROUP: ReadonlyArray<string> = ['cli-claude', 'cli-codex']

export function evaluatePublishReadiness(checks: CapabilityCheck[]): CapabilityCheck {
  const failingRequired = PUBLISH_REQUIRED_IDS.filter((id) => {
    const found = checks.find((c) => c.id === id)
    if (!found) return false
    return found.status !== 'pass'
  })
  const cliPresent = checks.filter((c) => PUBLISH_CLI_GROUP.includes(c.id))
  const cliGroupOk = cliPresent.length === 0 || cliPresent.some((c) => c.status === 'pass')
  const allPassed = failingRequired.length === 0 && cliGroupOk
  let detail: string
  if (allPassed) {
    detail = 'All publish requirements met'
  } else {
    const reasons: string[] = []
    if (failingRequired.length > 0) {
      reasons.push(`Failing: ${failingRequired.join(', ')}`)
    }
    if (!cliGroupOk) {
      reasons.push('Install Claude CLI or Codex CLI to enable agent-driven generation')
    }
    detail = `Publish is disabled until required checks pass. ${reasons.join('. ')}`.trim()
  }
  return {
    id: 'publish-ready',
    label: 'Publish features',
    status: allPassed ? 'pass' : 'fail',
    detail
  }
}
