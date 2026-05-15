import { execFile } from 'node:child_process'

export interface CliStatus {
  name: string
  command: string
  installed: boolean
  version: string | null
}

export interface CapabilityReport {
  detectedAt: string
  clis: CliStatus[]
}

const CLI_DEFS = [
  { name: 'Claude CLI', command: 'claude' },
  { name: 'Codex CLI', command: 'codex' }
] as const

function checkCommand(command: string): Promise<{ installed: boolean; version: string | null }> {
  return new Promise((resolve) => {
    execFile(command, ['--version'], { timeout: 5000 }, (error, stdout) => {
      if (error) {
        resolve({ installed: false, version: null })
        return
      }
      const version = stdout.trim().split('\n')[0] || null
      resolve({ installed: true, version })
    })
  })
}

export async function detectClis(
  lookup: (cmd: string) => Promise<{ installed: boolean; version: string | null }> = checkCommand
): Promise<CapabilityReport> {
  const clis: CliStatus[] = await Promise.all(
    CLI_DEFS.map(async (def) => {
      const result = await lookup(def.command)
      return {
        name: def.name,
        command: def.command,
        installed: result.installed,
        version: result.version
      }
    })
  )

  return {
    detectedAt: new Date().toISOString(),
    clis
  }
}

export function isCliAvailable(report: CapabilityReport, command: string): boolean {
  const entry = report.clis.find((c) => c.command === command)
  return entry?.installed ?? false
}
