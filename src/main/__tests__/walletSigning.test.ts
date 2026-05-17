import { describe, it, expect, vi } from 'vitest'
import { createWalletSigner, SigningError } from '../services/walletSigning'

describe('createWalletSigner', () => {
  describe('mock mode', () => {
    it('produces a deterministic mock signature', async () => {
      const signer = createWalletSigner({ mode: 'mock' })
      const result = await signer.requestSignature({ message: 'test message' })

      expect(result.signature).toContain('mock-signature-placeholder')
      expect(result.message).toBe('test message')
      expect(result.timestamp).toBeTruthy()
    })

    it('isMockMode returns true', () => {
      const signer = createWalletSigner({ mode: 'mock' })
      expect(signer.isMockMode()).toBe(true)
    })

    it('does not require confirmation callback', async () => {
      const signer = createWalletSigner({ mode: 'mock' })
      const result = await signer.requestSignature({
        message: 'PlotLink: Upload plot images\nTimestamp: 2026-01-01T00:00:00.000Z',
        requireConfirmation: false
      })
      expect(result.signature).toBeTruthy()
    })

    it('produces different signatures for different messages', async () => {
      const signer = createWalletSigner({ mode: 'mock' })
      const r1 = await signer.requestSignature({ message: 'message-a' })
      const r2 = await signer.requestSignature({ message: 'message-b' })
      expect(r1.signature).not.toBe(r2.signature)
    })
  })

  describe('live mode', () => {
    it('throws if no sign function provided', () => {
      expect(() => createWalletSigner({ mode: 'live' })).toThrow('requires a sign function')
    })

    it('calls the provided sign function', async () => {
      const sign = vi.fn().mockResolvedValue('real-sig-abc')
      const signer = createWalletSigner({ mode: 'live', sign })

      const result = await signer.requestSignature({ message: 'upload msg' })

      expect(sign).toHaveBeenCalledWith('upload msg')
      expect(result.signature).toBe('real-sig-abc')
    })

    it('isMockMode returns false', () => {
      const sign = vi.fn().mockResolvedValue('sig')
      const signer = createWalletSigner({ mode: 'live', sign })
      expect(signer.isMockMode()).toBe(false)
    })

    it('requests user confirmation when requireConfirmation is true', async () => {
      const sign = vi.fn().mockResolvedValue('sig')
      const onConfirmation = vi.fn().mockResolvedValue(true)
      const signer = createWalletSigner({ mode: 'live', sign, onConfirmation })

      await signer.requestSignature({ message: 'msg', requireConfirmation: true })

      expect(onConfirmation).toHaveBeenCalledWith('msg')
      expect(sign).toHaveBeenCalled()
    })

    it('throws SigningError when user rejects confirmation', async () => {
      const sign = vi.fn().mockResolvedValue('sig')
      const onConfirmation = vi.fn().mockResolvedValue(false)
      const signer = createWalletSigner({ mode: 'live', sign, onConfirmation })

      await expect(
        signer.requestSignature({ message: 'msg', requireConfirmation: true })
      ).rejects.toThrow(SigningError)

      expect(sign).not.toHaveBeenCalled()
    })

    it('skips confirmation when requireConfirmation is false', async () => {
      const sign = vi.fn().mockResolvedValue('sig')
      const onConfirmation = vi.fn().mockResolvedValue(true)
      const signer = createWalletSigner({ mode: 'live', sign, onConfirmation })

      await signer.requestSignature({ message: 'msg', requireConfirmation: false })

      expect(onConfirmation).not.toHaveBeenCalled()
      expect(sign).toHaveBeenCalled()
    })
  })
})

describe('wallet signing boundary', () => {
  it('sign function is encapsulated — not exposed on the signer object', () => {
    const sign = vi.fn().mockResolvedValue('sig')
    const signer = createWalletSigner({ mode: 'live', sign })

    expect((signer as Record<string, unknown>).sign).toBeUndefined()
    expect((signer as Record<string, unknown>).config).toBeUndefined()
    expect(Object.keys(signer)).toEqual(['requestSignature', 'isMockMode'])
  })

  it('signature result never contains the signing key or function', async () => {
    const sign = vi.fn().mockResolvedValue('sig-value')
    const signer = createWalletSigner({ mode: 'live', sign })

    const result = await signer.requestSignature({ message: 'test' })
    const serialized = JSON.stringify(result)

    expect(serialized).not.toContain('privateKey')
    expect(serialized).not.toContain('mnemonic')
    expect(serialized).not.toContain('seed')
    expect(serialized).not.toContain('secret')
  })
})
