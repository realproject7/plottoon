/**
 * Local wallet identity model — shared between the main process and the
 * renderer. The renderer must never see private material (private keys,
 * mnemonics, passphrases, vault paths); only the fields below cross the IPC
 * boundary.
 */

export type WalletIdentitySource = 'plottoon-writer' | 'plotlink-writer'

export interface WalletIdentity {
  /**
   * Lowercased EVM address — the stable identifier for an identity in the
   * registry. PlotLink/PlotToon may receive checksummed addresses upstream;
   * the store normalizes them to lowercase before persisting.
   */
  address: string
  /** PlotToon source bucket. Always one of the two writer roles. */
  source: WalletIdentitySource
  /**
   * OWS-internal wallet name. Required for the signing flow to locate the
   * correct key inside the OWS vault — must round-trip through the IPC layer
   * so the renderer can pass it back to `wallet:setActive` / `wallet:connect`.
   * NOT a private key; just a string identifier (e.g. `plottoon-writer-1716`).
   */
  owsName: string
  /** Optional human-friendly label/alias. Free-form, renderer-supplied. */
  label?: string
  /** ISO timestamp of first registration in the local registry. */
  registeredAt: string
}

/**
 * Normalize an EVM address to the lowercased form used as the registry key.
 * Used by both main-process store code and any renderer-side helpers that
 * need to compare against the active address.
 */
export function normalizeWalletAddress(address: string): string {
  return address.trim().toLowerCase()
}

/**
 * Strict shape check — used by the IPC boundary so accidental fields can't
 * sneak through into the registry. Returns true only when the value has every
 * required field with the correct type and no obviously-private extra keys.
 */
export function isWalletIdentityShape(value: unknown): value is WalletIdentity {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  if (typeof v.address !== 'string' || v.address.length === 0) return false
  if (v.source !== 'plottoon-writer' && v.source !== 'plotlink-writer') return false
  if (typeof v.owsName !== 'string' || v.owsName.length === 0) return false
  if (v.label !== undefined && typeof v.label !== 'string') return false
  if (typeof v.registeredAt !== 'string') return false
  // Reject any field that looks like private material accidentally being
  // serialized into the registry. These names must NEVER reach the renderer.
  const banned = ['privateKey', 'mnemonic', 'seed', 'passphrase', 'secret', 'vaultPath']
  for (const key of banned) {
    if (key in v) return false
  }
  return true
}
