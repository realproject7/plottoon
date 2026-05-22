import fs from 'node:fs/promises'
import path from 'node:path'
import { type WalletIdentitySource, normalizeWalletAddress } from '../../shared/walletIdentity'

/**
 * Wallet ownership recorded in `project.json`. Address is the normalized
 * (lowercased) EVM address; source is the writer bucket so future filtering
 * can render a per-source label without crossing back to the identity store.
 *
 * No OWS internal name, no vault path, no passphrase, no secret material —
 * publish/signing flows look the active OWS name up from the identity
 * registry at runtime using `address` as the lookup key.
 */
export interface ProjectWalletOwnership {
  address: string
  source: WalletIdentitySource
}

export interface ProjectMeta {
  name: string
  version: number
  createdAt: string
  updatedAt: string
  description?: string
  /** Wallet that owns this project. Absent on legacy / pre-#220 projects. */
  wallet?: ProjectWalletOwnership
}

export class ProjectMetaError extends Error {
  constructor(
    message: string,
    public readonly projectPath: string
  ) {
    super(message)
    this.name = 'ProjectMetaError'
  }
}

const CURRENT_VERSION = 1

export function validateMeta(data: unknown, projectPath: string): ProjectMeta {
  if (typeof data !== 'object' || data === null) {
    throw new ProjectMetaError('project.json must be a JSON object', projectPath)
  }

  const obj = data as Record<string, unknown>

  if (typeof obj.name !== 'string' || obj.name.trim().length === 0) {
    throw new ProjectMetaError('project.json: "name" must be a non-empty string', projectPath)
  }

  if (typeof obj.version !== 'number' || !Number.isInteger(obj.version) || obj.version < 1) {
    throw new ProjectMetaError('project.json: "version" must be a positive integer', projectPath)
  }

  if (typeof obj.createdAt !== 'string') {
    throw new ProjectMetaError('project.json: "createdAt" must be a string', projectPath)
  }

  if (typeof obj.updatedAt !== 'string') {
    throw new ProjectMetaError('project.json: "updatedAt" must be a string', projectPath)
  }

  if (obj.description !== undefined && typeof obj.description !== 'string') {
    throw new ProjectMetaError(
      'project.json: "description" must be a string if present',
      projectPath
    )
  }

  const wallet =
    obj.wallet === undefined ? undefined : validateWalletOwnership(obj.wallet, projectPath)

  return {
    name: obj.name,
    version: obj.version,
    createdAt: obj.createdAt,
    updatedAt: obj.updatedAt,
    description: obj.description as string | undefined,
    wallet
  }
}

function validateWalletOwnership(value: unknown, projectPath: string): ProjectWalletOwnership {
  if (!value || typeof value !== 'object') {
    throw new ProjectMetaError('project.json: "wallet" must be an object', projectPath)
  }
  const w = value as Record<string, unknown>
  if (typeof w.address !== 'string' || w.address.length === 0) {
    throw new ProjectMetaError(
      'project.json: "wallet.address" must be a non-empty string',
      projectPath
    )
  }
  if (w.source !== 'plottoon-writer' && w.source !== 'plotlink-writer') {
    throw new ProjectMetaError(
      'project.json: "wallet.source" must be "plottoon-writer" or "plotlink-writer"',
      projectPath
    )
  }
  // Reject any obvious private-material field smuggled into wallet ownership.
  // Project files must never hold a private key / mnemonic / passphrase /
  // vault path / OWS internal name — those are runtime-only main-process
  // state, looked up against the identity registry by address.
  const banned = ['owsName', 'privateKey', 'mnemonic', 'seed', 'passphrase', 'secret', 'vaultPath']
  for (const key of banned) {
    if (key in w) {
      throw new ProjectMetaError(`project.json: "wallet" must not contain "${key}"`, projectPath)
    }
  }
  return {
    address: normalizeWalletAddress(w.address),
    source: w.source
  }
}

export async function readProjectMeta(projectRoot: string): Promise<ProjectMeta> {
  const metaPath = path.join(projectRoot, 'project.json')
  let raw: string
  try {
    raw = await fs.readFile(metaPath, 'utf-8')
  } catch {
    throw new ProjectMetaError('project.json not found', projectRoot)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new ProjectMetaError('project.json contains invalid JSON', projectRoot)
  }

  return validateMeta(parsed, projectRoot)
}

export async function writeProjectMeta(projectRoot: string, meta: ProjectMeta): Promise<void> {
  const metaPath = path.join(projectRoot, 'project.json')
  await fs.writeFile(metaPath, JSON.stringify(meta, null, 2) + '\n', 'utf-8')
}

export function createProjectMeta(
  name: string,
  description?: string,
  wallet?: ProjectWalletOwnership
): ProjectMeta {
  const now = new Date().toISOString()
  const normalized = wallet
    ? { address: normalizeWalletAddress(wallet.address), source: wallet.source }
    : undefined
  return {
    name,
    version: CURRENT_VERSION,
    createdAt: now,
    updatedAt: now,
    description,
    wallet: normalized
  }
}
