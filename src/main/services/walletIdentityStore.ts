/**
 * Persistent registry of known local wallet identities + the currently
 * active selection. Source of truth for which wallet PlotToon signs with.
 *
 * Persistence is plain JSON at <userData>/wallet-identities.json. The file
 * path is injectable so unit tests can use a temp directory.
 */

import fs from 'node:fs/promises'
import {
  type WalletIdentity,
  type WalletIdentitySource,
  isWalletIdentityShape,
  normalizeWalletAddress
} from '../../shared/walletIdentity'

const REGISTRY_VERSION = 1

interface RegistryFile {
  version: number
  identities: WalletIdentity[]
  activeAddress: string | null
}

export interface RegisterIdentityInput {
  address: string
  source: WalletIdentitySource
  owsName: string
  label?: string
  registeredAt?: string
}

export interface WalletIdentityStore {
  /** Lists every known identity, in registration order. */
  list(): Promise<WalletIdentity[]>
  /** Returns the active identity, or null when none is selected. */
  getActive(): Promise<WalletIdentity | null>
  /**
   * Marks the identity with the given address as active. Returns the active
   * identity after the change, or null if the address is unknown.
   */
  setActive(address: string): Promise<WalletIdentity | null>
  /** Clears the active selection without touching the registry. */
  clearActive(): Promise<void>
  /**
   * Inserts or updates an identity. The address is normalized; if an
   * identity with the same normalized address already exists, source/owsName
   * /label are merged onto it and `registeredAt` is preserved. The returned
   * value is the canonical record.
   */
  register(input: RegisterIdentityInput): Promise<WalletIdentity>
  /** Removes an identity from the registry. Clears `activeAddress` if it matched. */
  remove(address: string): Promise<void>
}

export interface CreateWalletIdentityStoreOptions {
  filePath: string
  /** For testability — defaults to () => new Date().toISOString(). */
  now?: () => string
}

function emptyRegistry(): RegistryFile {
  return { version: REGISTRY_VERSION, identities: [], activeAddress: null }
}

function isRegistryFile(value: unknown): value is RegistryFile {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  if (typeof v.version !== 'number') return false
  if (!Array.isArray(v.identities)) return false
  if (v.activeAddress !== null && typeof v.activeAddress !== 'string') return false
  return v.identities.every(isWalletIdentityShape)
}

export function createWalletIdentityStore(
  options: CreateWalletIdentityStoreOptions
): WalletIdentityStore {
  const { filePath } = options
  const now = options.now ?? (() => new Date().toISOString())

  async function read(): Promise<RegistryFile> {
    let raw: string
    try {
      raw = await fs.readFile(filePath, 'utf-8')
    } catch {
      return emptyRegistry()
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      return emptyRegistry()
    }
    if (!isRegistryFile(parsed)) return emptyRegistry()
    // Defensive: re-normalize on load in case an older format slipped in.
    return {
      version: REGISTRY_VERSION,
      identities: parsed.identities.map((i) => ({
        ...i,
        address: normalizeWalletAddress(i.address)
      })),
      activeAddress: parsed.activeAddress ? normalizeWalletAddress(parsed.activeAddress) : null
    }
  }

  async function write(file: RegistryFile): Promise<void> {
    await fs.writeFile(filePath, JSON.stringify(file, null, 2), 'utf-8')
  }

  function findIdentity(file: RegistryFile, address: string): WalletIdentity | null {
    const key = normalizeWalletAddress(address)
    return file.identities.find((i) => i.address === key) ?? null
  }

  return {
    async list() {
      const file = await read()
      return file.identities.slice()
    },
    async getActive() {
      const file = await read()
      if (!file.activeAddress) return null
      return findIdentity(file, file.activeAddress)
    },
    async setActive(address) {
      const file = await read()
      const match = findIdentity(file, address)
      if (!match) return null
      file.activeAddress = match.address
      await write(file)
      return match
    },
    async clearActive() {
      const file = await read()
      if (file.activeAddress === null) return
      file.activeAddress = null
      await write(file)
    },
    async register(input) {
      const file = await read()
      const address = normalizeWalletAddress(input.address)
      const existing = file.identities.find((i) => i.address === address)
      const next: WalletIdentity = {
        address,
        source: input.source,
        owsName: input.owsName,
        label: input.label,
        registeredAt: existing?.registeredAt ?? input.registeredAt ?? now()
      }
      if (existing) {
        const idx = file.identities.indexOf(existing)
        file.identities[idx] = next
      } else {
        file.identities.push(next)
      }
      await write(file)
      return next
    },
    async remove(address) {
      const file = await read()
      const key = normalizeWalletAddress(address)
      const idx = file.identities.findIndex((i) => i.address === key)
      if (idx === -1) return
      file.identities.splice(idx, 1)
      if (file.activeAddress === key) {
        file.activeAddress = null
      }
      await write(file)
    }
  }
}
