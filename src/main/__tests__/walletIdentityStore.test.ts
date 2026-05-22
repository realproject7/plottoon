import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {
  createWalletIdentityStore,
  type WalletIdentityStore
} from '../services/walletIdentityStore'
import {
  normalizeWalletAddress,
  isWalletIdentityShape,
  type WalletIdentity
} from '../../shared/walletIdentity'

// All fake test wallets. NEVER include real wallet addresses, private keys,
// mnemonics, or vault paths in this fixture file. See #218 constraints.
const FAKE_WALLET_A = {
  address: '0xAAAA000000000000000000000000000000000001',
  source: 'plottoon-writer' as const,
  owsName: 'plottoon-writer-fake-a'
}
const FAKE_WALLET_B = {
  address: '0xBbBb000000000000000000000000000000000002',
  source: 'plotlink-writer' as const,
  owsName: 'plotlink-writer-fake-b'
}

describe('walletIdentityStore', () => {
  let tmpDir: string
  let filePath: string
  let store: WalletIdentityStore

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), 'plottoon-walletid-'))
    filePath = path.join(tmpDir, 'wallet-identities.json')
    store = createWalletIdentityStore({
      filePath,
      now: () => '2026-05-22T00:00:00.000Z'
    })
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('starts empty and returns no active identity', async () => {
    expect(await store.list()).toEqual([])
    expect(await store.getActive()).toBeNull()
    expect(existsSync(filePath)).toBe(false)
  })

  it('registers two fake wallets and lists them in registration order', async () => {
    await store.register(FAKE_WALLET_A)
    await store.register(FAKE_WALLET_B)
    const identities = await store.list()
    expect(identities).toHaveLength(2)
    expect(identities[0].owsName).toBe(FAKE_WALLET_A.owsName)
    expect(identities[1].owsName).toBe(FAKE_WALLET_B.owsName)
    // Address must be normalized to lowercase before persisting.
    expect(identities[0].address).toBe(normalizeWalletAddress(FAKE_WALLET_A.address))
    expect(identities[1].address).toBe(normalizeWalletAddress(FAKE_WALLET_B.address))
  })

  it('setActive switches the active identity between two registered wallets', async () => {
    await store.register(FAKE_WALLET_A)
    await store.register(FAKE_WALLET_B)

    const first = await store.setActive(FAKE_WALLET_A.address)
    expect(first?.address).toBe(normalizeWalletAddress(FAKE_WALLET_A.address))
    expect((await store.getActive())?.owsName).toBe(FAKE_WALLET_A.owsName)

    const second = await store.setActive(FAKE_WALLET_B.address)
    expect(second?.address).toBe(normalizeWalletAddress(FAKE_WALLET_B.address))
    expect((await store.getActive())?.owsName).toBe(FAKE_WALLET_B.owsName)
  })

  it('setActive accepts checksummed addresses by normalizing on read', async () => {
    await store.register(FAKE_WALLET_A)
    // The persisted address is normalized; the caller may pass mixed-case.
    const identity = await store.setActive(FAKE_WALLET_A.address.toUpperCase())
    expect(identity?.address).toBe(normalizeWalletAddress(FAKE_WALLET_A.address))
  })

  it('setActive returns null for unknown addresses without mutating state', async () => {
    await store.register(FAKE_WALLET_A)
    await store.setActive(FAKE_WALLET_A.address)

    const result = await store.setActive('0xc0ffee0000000000000000000000000000000000')
    expect(result).toBeNull()
    // Active selection must not be cleared by a failed lookup.
    expect((await store.getActive())?.owsName).toBe(FAKE_WALLET_A.owsName)
  })

  it('clearActive drops the active selection but keeps the registry', async () => {
    await store.register(FAKE_WALLET_A)
    await store.setActive(FAKE_WALLET_A.address)
    await store.clearActive()
    expect(await store.getActive()).toBeNull()
    const identities = await store.list()
    expect(identities).toHaveLength(1)
  })

  it('active selection survives a restart (new store instance reading same file)', async () => {
    await store.register(FAKE_WALLET_A)
    await store.register(FAKE_WALLET_B)
    await store.setActive(FAKE_WALLET_B.address)

    // Simulate restart by creating a fresh store pointed at the same file.
    const restored = createWalletIdentityStore({ filePath })
    const active = await restored.getActive()
    expect(active?.address).toBe(normalizeWalletAddress(FAKE_WALLET_B.address))
    expect(active?.owsName).toBe(FAKE_WALLET_B.owsName)
    const identities = await restored.list()
    expect(identities).toHaveLength(2)
  })

  it('register is idempotent — re-registering the same address preserves registeredAt', async () => {
    const first = await store.register(FAKE_WALLET_A)
    const second = await store.register({
      ...FAKE_WALLET_A,
      label: 'My main wallet'
    })
    expect(second.registeredAt).toBe(first.registeredAt)
    expect(second.label).toBe('My main wallet')
    expect(await store.list()).toHaveLength(1)
  })

  it('register honors a caller-supplied registeredAt the first time only', async () => {
    const first = await store.register({
      ...FAKE_WALLET_A,
      registeredAt: '2025-01-01T00:00:00.000Z'
    })
    expect(first.registeredAt).toBe('2025-01-01T00:00:00.000Z')
    const second = await store.register({
      ...FAKE_WALLET_A,
      registeredAt: '2030-01-01T00:00:00.000Z'
    })
    expect(second.registeredAt).toBe('2025-01-01T00:00:00.000Z')
  })

  it('remove deletes the identity and clears active when it matched', async () => {
    await store.register(FAKE_WALLET_A)
    await store.register(FAKE_WALLET_B)
    await store.setActive(FAKE_WALLET_B.address)

    await store.remove(FAKE_WALLET_B.address)
    expect(await store.getActive()).toBeNull()
    const identities = await store.list()
    expect(identities).toHaveLength(1)
    expect(identities[0].owsName).toBe(FAKE_WALLET_A.owsName)
  })

  it('remove on an unrelated address leaves the active selection intact', async () => {
    await store.register(FAKE_WALLET_A)
    await store.register(FAKE_WALLET_B)
    await store.setActive(FAKE_WALLET_A.address)
    await store.remove(FAKE_WALLET_B.address)
    expect((await store.getActive())?.owsName).toBe(FAKE_WALLET_A.owsName)
  })

  it('falls back to an empty registry when the file is corrupted', async () => {
    writeFileSync(filePath, '{not json', 'utf-8')
    expect(await store.list()).toEqual([])
    expect(await store.getActive()).toBeNull()
  })

  it('falls back to an empty registry when the file shape is wrong', async () => {
    writeFileSync(filePath, JSON.stringify({ version: 1, identities: [{ wrong: true }] }), 'utf-8')
    expect(await store.list()).toEqual([])
  })

  it('persisted JSON contains only the safe identity fields — no private material keys', async () => {
    await store.register({
      ...FAKE_WALLET_A,
      label: 'Main',
      // Caller cannot smuggle private fields through register; the typed
      // interface forbids it. Cast to test runtime defenses.
      ...({ privateKey: 'should-be-rejected' } as Record<string, unknown>)
    } as Parameters<typeof store.register>[0])
    const raw = readFileSync(filePath, 'utf-8')
    expect(raw).not.toMatch(/privateKey/i)
    expect(raw).not.toMatch(/mnemonic/i)
    expect(raw).not.toMatch(/passphrase/i)
    expect(raw).not.toMatch(/vaultPath/i)
  })
})

describe('isWalletIdentityShape', () => {
  const good: WalletIdentity = {
    address: '0xabc',
    source: 'plottoon-writer',
    owsName: 'plottoon-writer-test',
    registeredAt: '2026-05-22T00:00:00.000Z'
  }

  it('accepts valid identity records', () => {
    expect(isWalletIdentityShape(good)).toBe(true)
    expect(isWalletIdentityShape({ ...good, label: 'Main' })).toBe(true)
  })

  it('rejects records with private-material field names', () => {
    expect(isWalletIdentityShape({ ...good, privateKey: 'x' })).toBe(false)
    expect(isWalletIdentityShape({ ...good, mnemonic: 'x' })).toBe(false)
    expect(isWalletIdentityShape({ ...good, passphrase: 'x' })).toBe(false)
    expect(isWalletIdentityShape({ ...good, vaultPath: '/foo' })).toBe(false)
  })

  it('rejects records with missing or malformed fields', () => {
    expect(isWalletIdentityShape(null)).toBe(false)
    expect(isWalletIdentityShape({})).toBe(false)
    expect(isWalletIdentityShape({ ...good, source: 'random' })).toBe(false)
    expect(isWalletIdentityShape({ ...good, address: '' })).toBe(false)
    expect(isWalletIdentityShape({ ...good, owsName: 123 })).toBe(false)
  })
})
