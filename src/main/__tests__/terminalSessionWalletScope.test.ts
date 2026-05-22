import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import {
  createSession,
  findSessionByProjectAndWallet,
  listSessions,
  clearSessionsForTesting,
  destroySession
} from '../services/terminalSession'
import { normalizeWalletAddress } from '../../shared/walletIdentity'

// Fake wallets only.
const WALLET_A = '0xAAAA000000000000000000000000000000000001'
const WALLET_B = '0xBbBb000000000000000000000000000000000002'

let tmpDir: string

beforeEach(async () => {
  clearSessionsForTesting()
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'plottoon-term-walletscope-'))
})

afterEach(async () => {
  clearSessionsForTesting()
  await fs.rm(tmpDir, { recursive: true, force: true })
})

describe('terminalSession wallet keying (#221)', () => {
  it('creates separate sessions for the same project under wallet A and wallet B', () => {
    const a = createSession('proj_1', tmpDir, WALLET_A)
    const b = createSession('proj_1', tmpDir, WALLET_B)

    expect(a.id).not.toBe(b.id)
    expect(a.walletAddress).toBe(normalizeWalletAddress(WALLET_A))
    expect(b.walletAddress).toBe(normalizeWalletAddress(WALLET_B))
    expect(listSessions()).toHaveLength(2)
  })

  it('findSessionByProjectAndWallet returns only the wallet-specific session', () => {
    const a = createSession('proj_1', tmpDir, WALLET_A)
    const b = createSession('proj_1', tmpDir, WALLET_B)

    expect(findSessionByProjectAndWallet('proj_1', WALLET_A)?.id).toBe(a.id)
    expect(findSessionByProjectAndWallet('proj_1', WALLET_B)?.id).toBe(b.id)
  })

  it('switching wallets does not return the previous wallet’s session', () => {
    const a = createSession('proj_1', tmpDir, WALLET_A)
    // Simulate "switch to wallet B": same projectId, different active wallet.
    const found = findSessionByProjectAndWallet('proj_1', WALLET_B)
    expect(found).toBeNull()

    // Creating under B yields a fresh session distinct from A's.
    const b = createSession('proj_1', tmpDir, WALLET_B)
    expect(b.id).not.toBe(a.id)
  })

  it('accepts mixed-case addresses by normalizing on lookup', () => {
    const a = createSession('proj_1', tmpDir, WALLET_A)
    const found = findSessionByProjectAndWallet('proj_1', WALLET_A.toUpperCase())
    expect(found?.id).toBe(a.id)
  })

  it('migrates an unstamped legacy session to the first wallet that asks for it', () => {
    const legacy = createSession('proj_1', tmpDir, null)
    expect(legacy.walletAddress).toBeNull()

    const claimed = findSessionByProjectAndWallet('proj_1', WALLET_A)
    expect(claimed?.id).toBe(legacy.id)
    expect(claimed?.walletAddress).toBe(normalizeWalletAddress(WALLET_A))

    // A later lookup with a *different* wallet must NOT also claim the
    // migrated session — that would re-introduce the cross-wallet bleed
    // #221 forbids.
    expect(findSessionByProjectAndWallet('proj_1', WALLET_B)).toBeNull()
  })

  it('does not silently claim a legacy session for a null-wallet caller', () => {
    createSession('proj_1', tmpDir, null)
    // The single existing legacy session matches null directly, but the
    // *exact-match* pass catches it first — we never enter the migration
    // pass. Verify the returned session keeps walletAddress: null.
    const found = findSessionByProjectAndWallet('proj_1', null)
    expect(found?.walletAddress).toBeNull()
  })

  it('a wallet that already owns a session does not steal a legacy session that exists alongside', () => {
    const ownA = createSession('proj_1', tmpDir, WALLET_A)
    const legacy = createSession('proj_1', tmpDir, null)
    // Wallet A has an exact-match session; the legacy session must stay legacy.
    const found = findSessionByProjectAndWallet('proj_1', WALLET_A)
    expect(found?.id).toBe(ownA.id)
    // The legacy is still claimable by a different wallet:
    const claimedByB = findSessionByProjectAndWallet('proj_1', WALLET_B)
    expect(claimedByB?.id).toBe(legacy.id)
    expect(claimedByB?.walletAddress).toBe(normalizeWalletAddress(WALLET_B))
  })

  it('createSession returns the existing session for the same (project, wallet) pair', () => {
    const first = createSession('proj_1', tmpDir, WALLET_A)
    const second = createSession('proj_1', tmpDir, WALLET_A)
    expect(second.id).toBe(first.id)
  })

  it('destroying wallet A’s session leaves wallet B’s untouched', () => {
    const a = createSession('proj_1', tmpDir, WALLET_A)
    const b = createSession('proj_1', tmpDir, WALLET_B)
    destroySession(a.id)
    expect(findSessionByProjectAndWallet('proj_1', WALLET_A)).toBeNull()
    expect(findSessionByProjectAndWallet('proj_1', WALLET_B)?.id).toBe(b.id)
  })
})
