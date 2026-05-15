export type CheckStatus = 'pass' | 'fail' | 'info'

export interface CapabilityCheck {
  id: string
  label: string
  status: CheckStatus
  detail: string
}

export interface CapabilitySection {
  title: string
  checks: CapabilityCheck[]
}

export interface FirstRunReport {
  generatedAt: string
  sections: CapabilitySection[]
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

function checkPlotLink(): CapabilityCheck {
  return {
    id: 'plotlink-endpoint',
    label: 'PlotLink endpoint',
    status: 'info',
    detail: 'PlotLink endpoint is a placeholder — not yet available'
  }
}

function checkWallet(): CapabilityCheck {
  return {
    id: 'wallet',
    label: 'Wallet',
    status: 'info',
    detail: 'Wallet integration is a placeholder — not yet available'
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

function canPublish(checks: CapabilityCheck[]): CapabilityCheck {
  const required = ['cli-claude', 'cli-codex', 'plotlink-endpoint']
  const allPassed = required.every((id) => {
    const check = checks.find((c) => c.id === id)
    return check && check.status === 'pass'
  })
  return {
    id: 'publish-ready',
    label: 'Publish features',
    status: allPassed ? 'pass' : 'fail',
    detail: allPassed
      ? 'All publish requirements met'
      : 'Publish is disabled until required checks pass'
  }
}

export interface GenerateReportOptions {
  cliChecks?: CapabilityCheck[]
  writeAccessCheck?: CapabilityCheck
  atlasCloudGuidanceEnabled?: boolean
}

export function generateReport(options: GenerateReportOptions = {}): FirstRunReport {
  const { atlasCloudGuidanceEnabled = false } = options

  const cliChecks = options.cliChecks ?? []
  const writeCheck = options.writeAccessCheck ?? {
    id: 'write-access',
    label: 'Project write access',
    status: 'fail' as CheckStatus,
    detail: 'No projects directory configured'
  }
  const imageCheck = checkImageImport()
  const atlasCheck = checkAtlasCloudGuidance(atlasCloudGuidanceEnabled)
  const plotLinkCheck = checkPlotLink()
  const walletCheck = checkWallet()
  const exportCheck = checkExport()

  const allChecks = [
    ...cliChecks,
    writeCheck,
    imageCheck,
    atlasCheck,
    plotLinkCheck,
    walletCheck,
    exportCheck
  ]
  const publishCheck = canPublish(allChecks)

  return {
    generatedAt: new Date().toISOString(),
    sections: [
      { title: 'CLI Tools', checks: cliChecks },
      { title: 'Local Capabilities', checks: [writeCheck, imageCheck, exportCheck] },
      { title: 'Advanced Backends', checks: [atlasCheck] },
      { title: 'Integrations', checks: [plotLinkCheck, walletCheck] },
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
