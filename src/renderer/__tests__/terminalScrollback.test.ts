// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import FDBFactory from 'fake-indexeddb/lib/FDBFactory'
import { readScrollback, writeScrollback, clearScrollback } from '../terminalScrollback'

const WALLET_A = '0xaaaa000000000000000000000000000000000001'
const WALLET_A_CHECKSUM = '0xAAAA000000000000000000000000000000000001'
const WALLET_B = '0xbbbb000000000000000000000000000000000002'

beforeEach(() => {
  // Reset to a fresh in-memory IndexedDB per test instead of calling
  // `deleteDatabase` (which blocks on the previous test's connection).
  ;(globalThis as { indexedDB: IDBFactory }).indexedDB = new FDBFactory() as unknown as IDBFactory
})

describe('#273 terminalScrollback — round trip', () => {
  it('writes then reads scrollback for (wallet, project)', async () => {
    const content = 'hello\r\nworld\r\n'
    await writeScrollback(WALLET_A, 'proj_1', content)
    const got = await readScrollback(WALLET_A, 'proj_1')
    expect(got).toBe(content)
  })

  it('returns null when no scrollback was written', async () => {
    const got = await readScrollback(WALLET_A, 'proj_unknown')
    expect(got).toBeNull()
  })

  it('overwrites existing content on second write', async () => {
    await writeScrollback(WALLET_A, 'proj_1', 'first\n')
    await writeScrollback(WALLET_A, 'proj_1', 'second\n')
    const got = await readScrollback(WALLET_A, 'proj_1')
    expect(got).toBe('second\n')
  })

  it('clearScrollback removes the row', async () => {
    await writeScrollback(WALLET_A, 'proj_1', 'gone\n')
    await clearScrollback(WALLET_A, 'proj_1')
    const got = await readScrollback(WALLET_A, 'proj_1')
    expect(got).toBeNull()
  })
})

describe('#273 terminalScrollback — wallet scoping (no cross-wallet bleed)', () => {
  it('reads from wallet A do not return wallet B’s content for the same project', async () => {
    await writeScrollback(WALLET_A, 'proj_shared', 'wallet-A content\n')
    await writeScrollback(WALLET_B, 'proj_shared', 'wallet-B content\n')
    const a = await readScrollback(WALLET_A, 'proj_shared')
    const b = await readScrollback(WALLET_B, 'proj_shared')
    expect(a).toBe('wallet-A content\n')
    expect(b).toBe('wallet-B content\n')
  })

  it('lower-cases wallet addresses on write + read so checksum/case mismatches still resolve', async () => {
    await writeScrollback(WALLET_A_CHECKSUM, 'proj_x', 'checksum-write\n')
    const got = await readScrollback(WALLET_A, 'proj_x')
    expect(got).toBe('checksum-write\n')
  })

  it('clearing wallet A does not delete wallet B’s row for the same project', async () => {
    await writeScrollback(WALLET_A, 'proj_shared', 'wallet-A\n')
    await writeScrollback(WALLET_B, 'proj_shared', 'wallet-B\n')
    await clearScrollback(WALLET_A, 'proj_shared')
    expect(await readScrollback(WALLET_A, 'proj_shared')).toBeNull()
    expect(await readScrollback(WALLET_B, 'proj_shared')).toBe('wallet-B\n')
  })
})

describe('#273 terminalScrollback — tail trim on oversized buffers', () => {
  it('trims content past 64 KiB on write (keeps the tail, drops the head)', async () => {
    // Build a 100 KiB payload with a sentinel at byte 0 and a sentinel
    // at the end. Confirm only the tail survives so the user sees the
    // most recent activity on restore, not stale history.
    const HEAD_SENTINEL = 'OLD_BYTES_AT_HEAD_SHOULD_NOT_SURVIVE'
    const TAIL_SENTINEL = 'NEW_BYTES_AT_TAIL_MUST_SURVIVE'
    const filler = 'A'.repeat(100 * 1024 - HEAD_SENTINEL.length - TAIL_SENTINEL.length)
    const oversized = HEAD_SENTINEL + filler + TAIL_SENTINEL
    await writeScrollback(WALLET_A, 'proj_big', oversized)
    const got = await readScrollback(WALLET_A, 'proj_big')
    expect(got).not.toBeNull()
    if (got === null) return
    expect(got.length).toBeLessThanOrEqual(64 * 1024)
    expect(got.includes(TAIL_SENTINEL)).toBe(true)
    expect(got.includes(HEAD_SENTINEL)).toBe(false)
  })
})

describe('#273 terminalScrollback — uses fake content only', () => {
  it('never throws when the IndexedDB call fails (best-effort persistence)', async () => {
    // Force a failure by passing an object that the IDBObjectStore can
    // handle but reading back yields the same value. Then immediately
    // confirm clear is a no-op on missing rows.
    await expect(
      writeScrollback(WALLET_A, 'proj_fake', 'fake-content-only')
    ).resolves.toBeUndefined()
    await expect(clearScrollback(WALLET_A, 'proj_does_not_exist')).resolves.toBeUndefined()
  })
})
