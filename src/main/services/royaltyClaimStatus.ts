import fs from 'node:fs/promises'
import path from 'node:path'
import { app } from 'electron'

export interface RoyaltyClaimRecord {
  txHash: string
  walletAddress: string
  reserveToken: string
  gasCostWei: string | null
  status: 'confirmed' | 'failed'
  error: string | null
  claimedAt: string
}

export interface RoyaltyClaimStatusFile {
  claims: RoyaltyClaimRecord[]
}

function getStatusFilePath(): string {
  return path.join(app.getPath('userData'), 'royalty-claims.json')
}

export async function readClaimHistory(): Promise<RoyaltyClaimStatusFile> {
  try {
    const raw = await fs.readFile(getStatusFilePath(), 'utf-8')
    return JSON.parse(raw) as RoyaltyClaimStatusFile
  } catch {
    return { claims: [] }
  }
}

export async function appendClaimRecord(record: RoyaltyClaimRecord): Promise<void> {
  const status = await readClaimHistory()
  status.claims.push(record)
  await fs.writeFile(getStatusFilePath(), JSON.stringify(status, null, 2), 'utf-8')
}
