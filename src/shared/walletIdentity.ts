/**
 * Local wallet identity model.
 *
 * Two shapes live here:
 *
 * - `WalletIdentity` is the **internal** record persisted by the main-process
 *   registry. It carries the OWS-internal wallet name needed for signing.
 *   This type MUST stay inside the main process — do NOT return it directly
 *   from any IPC handler.
 *
 * - `WalletIdentityView` is the **renderer-facing** projection. Per #218
 *   constraint, the renderer sees only `address / source / label?` — never
 *   `owsName`, `registeredAt`, or any private material (private keys,
 *   mnemonics, passphrases, vault paths). Use `toWalletIdentityView` to
 *   project an internal record before it crosses the IPC boundary.
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
   * OWS-internal wallet name — required for the signing flow to locate the
   * correct key inside the OWS vault. Stays inside the main process; the
   * renderer never receives this field.
   *
   * NOT a private key; just a string identifier (e.g. `plottoon-writer-1716`).
   */
  owsName: string
  /** Optional human-friendly label/alias. Free-form. */
  label?: string
  /** ISO timestamp of first registration in the local registry. Main-only. */
  registeredAt: string
}

/**
 * The shape the renderer is allowed to see for a wallet identity. The
 * renderer identifies wallets by `address`; when it wants to switch active,
 * it sends the address back across IPC and the main process resolves
 * `owsName` from the internal registry for signing.
 */
export interface WalletIdentityView {
  address: string
  source: WalletIdentitySource
  label?: string
}

export function toWalletIdentityView(identity: WalletIdentity): WalletIdentityView {
  const view: WalletIdentityView = {
    address: identity.address,
    source: identity.source
  }
  if (identity.label !== undefined) view.label = identity.label
  return view
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

/**
 * DOM custom event dispatched by the wallet switcher after a successful
 * active-wallet change (switch / connect / disconnect). Renderer-local
 * convention so wallet-scoped surfaces (e.g. ProjectList) can refresh
 * reactively without prop drilling through the app shell.
 */
export const WALLET_ACTIVE_CHANGED_EVENT = 'plottoon:wallet:active-changed'
