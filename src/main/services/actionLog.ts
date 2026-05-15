export interface ActionEntry {
  timestamp: string
  action: string
  projectId: string | null
  plotId: string | null
  detail: string
}

const SECRET_PATTERNS = [
  /(?:api[_-]?key|apikey)\s*[:=]\s*\S+/gi,
  /(?:secret|token|password|credential)\s*[:=]\s*\S+/gi,
  /(?:bearer|authorization)\s+\S+/gi,
  /sk-[a-zA-Z0-9]{20,}/g,
  /xox[bpas]-[a-zA-Z0-9-]+/g
]

const MAX_ENTRIES = 500

const entries: ActionEntry[] = []

export function redactSecrets(text: string): string {
  let result = text
  for (const pattern of SECRET_PATTERNS) {
    result = result.replace(pattern, '[REDACTED]')
  }
  return result
}

export function logAction(
  action: string,
  detail: string,
  projectId: string | null = null,
  plotId: string | null = null
): ActionEntry {
  const entry: ActionEntry = {
    timestamp: new Date().toISOString(),
    action: redactSecrets(action),
    projectId,
    plotId,
    detail: redactSecrets(detail)
  }
  entries.push(entry)
  if (entries.length > MAX_ENTRIES) {
    entries.splice(0, entries.length - MAX_ENTRIES)
  }
  return entry
}

export function getLog(projectId?: string): ActionEntry[] {
  if (projectId) {
    return entries.filter((e) => e.projectId === projectId)
  }
  return [...entries]
}

export function clearLog(): void {
  entries.length = 0
}
