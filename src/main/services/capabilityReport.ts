import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { detectClis } from './cliDetection'
import type { CapabilityReport as CliReport } from './cliDetection'

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

async function checkWriteAccess(dir?: string): Promise<CapabilityCheck> {
  const target = dir || path.join(os.tmpdir(), `plottoon-write-test-${Date.now()}`)
  try {
    await fs.mkdir(target, { recursive: true })
    const probe = path.join(target, '.plottoon-probe')
    await fs.writeFile(probe, '', 'utf-8')
    await fs.unlink(probe)
    if (!dir) await fs.rmdir(target)
    return {
      id: 'write-access',
      label: 'Project write access',
      status: 'pass',
      detail: 'Filesystem is writable'
    }
  } catch {
    return {
      id: 'write-access',
      label: 'Project write access',
      status: 'fail',
      detail: 'Cannot write to project directory'
    }
  }
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

function buildCliChecks(cliReport: CliReport): CapabilityCheck[] {
  return cliReport.clis.map((cli) => ({
    id: `cli-${cli.command}`,
    label: cli.name,
    status: (cli.installed ? 'pass' : 'fail') as CheckStatus,
    detail: cli.installed ? `Detected: ${cli.version}` : `${cli.command} not found in PATH`
  }))
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
  projectDir?: string
  atlasCloudGuidanceEnabled?: boolean
  cliLookup?: (cmd: string) => Promise<{ installed: boolean; version: string | null }>
}

export async function generateReport(options: GenerateReportOptions = {}): Promise<FirstRunReport> {
  const { projectDir, atlasCloudGuidanceEnabled = false, cliLookup } = options

  const cliReport = await detectClis(cliLookup)
  const cliChecks = buildCliChecks(cliReport)
  const writeCheck = await checkWriteAccess(projectDir)
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
