import fs from 'node:fs/promises'
import path from 'node:path'
import { app } from 'electron'
import type { AgentCacheEntry } from '../../shared/agentRegistration'

export interface AgentCacheFile {
  agents: AgentCacheEntry[]
}

function getCacheFilePath(): string {
  return path.join(app.getPath('userData'), 'agent-registrations.json')
}

export async function readAgentCache(): Promise<AgentCacheFile> {
  try {
    const raw = await fs.readFile(getCacheFilePath(), 'utf-8')
    return JSON.parse(raw) as AgentCacheFile
  } catch {
    return { agents: [] }
  }
}

export async function findCachedAgent(walletAddress: string): Promise<AgentCacheEntry | null> {
  const cache = await readAgentCache()
  return cache.agents.find((a) => a.walletAddress === walletAddress) ?? null
}

export async function upsertAgentCache(entry: AgentCacheEntry): Promise<void> {
  const cache = await readAgentCache()
  const idx = cache.agents.findIndex((a) => a.walletAddress === entry.walletAddress)
  if (idx >= 0) {
    cache.agents[idx] = entry
  } else {
    cache.agents.push(entry)
  }
  await fs.writeFile(getCacheFilePath(), JSON.stringify(cache, null, 2), 'utf-8')
}
