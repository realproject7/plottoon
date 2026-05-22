/**
 * IPC handlers for the wallet identity registry. Surface area is intentionally
 * minimal: list known identities, read the active one, switch active.
 *
 * Each handler narrows what crosses the IPC boundary to plain `WalletIdentity`
 * records (address / source / owsName / label / registeredAt) — never any
 * vault path, passphrase, or private key.
 */

import { ipcMain } from 'electron'
import type { WalletIdentity } from '../../shared/walletIdentity'
import type { WalletIdentityStore } from '../services/walletIdentityStore'
import type { SelectedWalletState } from './walletConnectionHandlers'

export interface RegisterWalletIdentityHandlersOptions {
  store: WalletIdentityStore
  /**
   * The shared in-memory `state.wallet` used by publish / royalty / signing
   * flows. We mirror the active identity into this object so existing code
   * paths see the updated wallet immediately on setActive.
   */
  walletState: SelectedWalletState
}

function identityToWalletMetadata(identity: WalletIdentity): {
  address: string
  source: WalletIdentity['source']
  name: string
  createdAt: string
} {
  return {
    address: identity.address,
    source: identity.source,
    name: identity.owsName,
    createdAt: identity.registeredAt
  }
}

export function registerWalletIdentityHandlers(
  options: RegisterWalletIdentityHandlersOptions
): void {
  const { store, walletState } = options

  ipcMain.handle('wallet:identity:list', async () => {
    const identities = await store.list()
    return { identities }
  })

  ipcMain.handle('wallet:identity:getActive', async () => {
    const identity = await store.getActive()
    return { identity }
  })

  ipcMain.handle('wallet:identity:setActive', async (_event, payload: unknown) => {
    if (!payload || typeof payload !== 'object') {
      return { identity: null, error: 'setActive requires an { address } payload' }
    }
    const { address } = payload as { address?: unknown }
    if (typeof address !== 'string' || address.length === 0) {
      return { identity: null, error: 'setActive requires a string address' }
    }
    const identity = await store.setActive(address)
    if (!identity) {
      return { identity: null, error: 'Unknown wallet address' }
    }
    // Mirror into the in-memory state used by publish/royalty/signing.
    walletState.wallet = identityToWalletMetadata(identity)
    return { identity }
  })
}

/**
 * Restore the in-memory `walletState.wallet` from the persisted active
 * identity. Called from main startup so existing single-wallet behaviour
 * survives a restart without any renderer-side reconnect step.
 */
export async function restoreActiveWalletFromStore(
  store: WalletIdentityStore,
  walletState: SelectedWalletState
): Promise<void> {
  const identity = await store.getActive()
  if (identity) {
    walletState.wallet = identityToWalletMetadata(identity)
  }
}
