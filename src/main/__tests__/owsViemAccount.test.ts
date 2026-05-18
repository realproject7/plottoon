import { describe, it, expect, vi } from 'vitest'
import { parseTransaction, type Hex } from 'viem'
import {
  createOwsViemAccount,
  parseOwsSignature,
  type OwsAccountParams
} from '../services/owsViemAccount'
import type { OWSCoreModule } from '../services/owsAdapter'

const FIXTURE_ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'

const FIXTURE_R = 'ab'.repeat(32)
const FIXTURE_S = 'cd'.repeat(32)
const FIXTURE_SIG = FIXTURE_R + FIXTURE_S
const FIXTURE_RECOVERY_ID = 1

function mockOws(overrides?: Partial<OWSCoreModule>): OWSCoreModule {
  return {
    listWallets: vi.fn().mockReturnValue([]),
    createWallet: vi.fn(),
    signMessage: vi.fn().mockReturnValue({ signature: '0x' + FIXTURE_SIG }),
    signTransaction: vi.fn().mockReturnValue({
      signature: '0x' + FIXTURE_SIG,
      recoveryId: FIXTURE_RECOVERY_ID
    }),
    ...overrides
  }
}

function defaultParams(overrides?: Partial<OwsAccountParams>): OwsAccountParams {
  return {
    ows: mockOws(),
    walletName: 'test-wallet',
    walletAddress: FIXTURE_ADDRESS,
    chain: 'eip155:8453',
    ...overrides
  }
}

describe('createOwsViemAccount', () => {
  it('returns a LocalAccount with the given address', () => {
    const account = createOwsViemAccount(defaultParams())
    expect(account.address).toBe(FIXTURE_ADDRESS)
  })

  it('signMessage delegates to OWS signMessage', async () => {
    const ows = mockOws()
    const account = createOwsViemAccount(defaultParams({ ows }))

    const result = await account.signMessage({ message: 'hello' })

    expect(ows.signMessage).toHaveBeenCalledWith('test-wallet', 'eip155:8453', 'hello', null)
    expect(result).toBe('0x' + FIXTURE_SIG)
  })

  it('signMessage passes passphrase when provided', async () => {
    const ows = mockOws()
    const account = createOwsViemAccount(defaultParams({ ows, passphrase: 'secret' }))

    await account.signMessage({ message: 'hello' })

    expect(ows.signMessage).toHaveBeenCalledWith('test-wallet', 'eip155:8453', 'hello', 'secret')
  })

  it('signTransaction strips 0x prefix before calling OWS', async () => {
    const ows = mockOws()
    const account = createOwsViemAccount(defaultParams({ ows }))

    const tx = {
      to: '0x0000000000000000000000000000000000000001' as Hex,
      value: BigInt(0),
      chainId: 8453,
      nonce: 0,
      maxFeePerGas: BigInt(1000000000),
      maxPriorityFeePerGas: BigInt(1000000),
      gas: BigInt(21000),
      type: 'eip1559' as const
    }

    await account.signTransaction(tx)

    const signTxCall = (ows.signTransaction as ReturnType<typeof vi.fn>).mock.calls[0]
    const txHexArg = signTxCall[2] as string
    expect(txHexArg).not.toMatch(/^0x/)
  })

  it('signTransaction returns signed serialized transaction, not raw signature', async () => {
    const ows = mockOws()
    const account = createOwsViemAccount(defaultParams({ ows }))

    const tx = {
      to: '0x0000000000000000000000000000000000000001' as Hex,
      value: BigInt(0),
      chainId: 8453,
      nonce: 0,
      maxFeePerGas: BigInt(1000000000),
      maxPriorityFeePerGas: BigInt(1000000),
      gas: BigInt(21000),
      type: 'eip1559' as const
    }

    const result = await account.signTransaction(tx)

    expect(result).not.toBe('0x' + FIXTURE_SIG)
    expect(result).toMatch(/^0x02/)

    const parsed = parseTransaction(result as Hex)
    expect(parsed.r).toBe(('0x' + FIXTURE_R) as Hex)
    expect(parsed.s).toBe(('0x' + FIXTURE_S) as Hex)
  })

  it('signTransaction parses recoveryId into v', async () => {
    const ows = mockOws({
      signTransaction: vi.fn().mockReturnValue({
        signature: '0x' + FIXTURE_SIG,
        recoveryId: 0
      })
    })
    const account = createOwsViemAccount(defaultParams({ ows }))

    const tx = {
      to: '0x0000000000000000000000000000000000000001' as Hex,
      value: BigInt(0),
      chainId: 8453,
      nonce: 0,
      maxFeePerGas: BigInt(1000000000),
      maxPriorityFeePerGas: BigInt(1000000),
      gas: BigInt(21000),
      type: 'eip1559' as const
    }

    const result = await account.signTransaction(tx)
    const parsed = parseTransaction(result as Hex)

    expect(parsed.v).toBe(27n)
  })

  it('signTransaction reads v from 65-byte signature when recoveryId is missing', async () => {
    const sigWithV = FIXTURE_R + FIXTURE_S + '1c'
    const ows = mockOws({
      signTransaction: vi.fn().mockReturnValue({
        signature: '0x' + sigWithV
      })
    })
    const account = createOwsViemAccount(defaultParams({ ows }))

    const tx = {
      to: '0x0000000000000000000000000000000000000001' as Hex,
      value: BigInt(0),
      chainId: 8453,
      nonce: 0,
      maxFeePerGas: BigInt(1000000000),
      maxPriorityFeePerGas: BigInt(1000000),
      gas: BigInt(21000),
      type: 'eip1559' as const
    }

    const result = await account.signTransaction(tx)
    const parsed = parseTransaction(result as Hex)

    expect(parsed.v).toBe(28n)
  })

  it('signTypedData throws', async () => {
    const account = createOwsViemAccount(defaultParams())

    await expect(
      account.signTypedData({
        domain: {},
        types: {},
        primaryType: 'Test',
        message: {}
      })
    ).rejects.toThrow('signTypedData not supported')
  })
})

describe('parseOwsSignature', () => {
  const R = 'ab'.repeat(32)
  const S = 'cd'.repeat(32)

  it('uses recoveryId 0 to compute v = 27', () => {
    const sig = parseOwsSignature(R + S, 0)
    expect(sig.r).toBe('0x' + R)
    expect(sig.s).toBe('0x' + S)
    expect(sig.v).toBe(27n)
  })

  it('uses recoveryId 1 to compute v = 28', () => {
    const sig = parseOwsSignature('0x' + R + S, 1)
    expect(sig.r).toBe('0x' + R)
    expect(sig.s).toBe('0x' + S)
    expect(sig.v).toBe(28n)
  })

  it('reads v from final byte of 65-byte signature when recoveryId is missing', () => {
    const sigWithV = R + S + '1b'
    const sig = parseOwsSignature(sigWithV, null)
    expect(sig.r).toBe('0x' + R)
    expect(sig.s).toBe('0x' + S)
    expect(sig.v).toBe(27n)
  })

  it('reads v from final byte of 65-byte signature when recoveryId is undefined', () => {
    const sigWithV = R + S + '1c'
    const sig = parseOwsSignature(sigWithV)
    expect(sig.v).toBe(28n)
  })

  it('throws on signature shorter than 64 bytes', () => {
    expect(() => parseOwsSignature('ab'.repeat(30), 0)).toThrow('too short')
  })

  it('throws when recoveryId is missing and signature is only 64 bytes', () => {
    expect(() => parseOwsSignature(R + S)).toThrow('missing recoveryId')
  })

  it('handles 0x-prefixed signatures', () => {
    const sig = parseOwsSignature('0x' + R + S + '1b')
    expect(sig.r).toBe('0x' + R)
    expect(sig.v).toBe(27n)
  })
})
