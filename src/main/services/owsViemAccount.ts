import { serializeTransaction, type Hex } from 'viem'
import { toAccount, type LocalAccount } from 'viem/accounts'
import type { OWSCoreModule } from './owsAdapter'

export interface OwsAccountParams {
  ows: OWSCoreModule
  walletName: string
  walletAddress: string
  chain: string
  passphrase?: string
}

export function parseOwsSignature(
  signature: string,
  recoveryId?: number | null
): { r: Hex; s: Hex; v: bigint } {
  const raw = signature.startsWith('0x') ? signature.slice(2) : signature
  const byteLength = raw.length / 2

  if (byteLength < 64) {
    throw new Error(`OWS signature too short: expected at least 64 bytes, got ${byteLength}`)
  }

  const r = ('0x' + raw.slice(0, 64)) as Hex
  const s = ('0x' + raw.slice(64, 128)) as Hex

  let v: bigint
  if (recoveryId != null) {
    v = BigInt(recoveryId + 27)
  } else if (byteLength >= 65) {
    v = BigInt(parseInt(raw.slice(128, 130), 16))
  } else {
    throw new Error('OWS signature missing recoveryId and too short to contain v byte')
  }

  return { r, s, v }
}

function stripHexPrefix(hex: string): string {
  return hex.startsWith('0x') ? hex.slice(2) : hex
}

export function createOwsViemAccount(params: OwsAccountParams): LocalAccount {
  const { ows, walletName, walletAddress, chain, passphrase } = params

  return toAccount({
    address: walletAddress as Hex,

    async signMessage({ message }) {
      const raw = typeof message === 'string' ? message : String(message.raw)
      const result = ows.signMessage(walletName, chain, raw, passphrase ?? null)
      return result.signature as Hex
    },

    async signTransaction(tx) {
      const serialized = serializeTransaction(tx)
      const txHex = stripHexPrefix(serialized)
      const result = ows.signTransaction(walletName, chain, txHex, passphrase ?? null)
      const sig = parseOwsSignature(result.signature, result.recoveryId)
      return serializeTransaction(tx, sig)
    },

    async signTypedData() {
      throw new Error('signTypedData not supported by OWS signer')
    }
  })
}
