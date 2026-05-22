/**
 * IPC handlers for the wallet identity registry. Surface area is intentionally
 * minimal: list known identities, read the active one, switch active.
 *
 * Every value that crosses the IPC boundary is projected through
 * `toWalletIdentityView` first, so the renderer only ever sees
 * `address / source / label?`. The internal `owsName` + `registeredAt` stay
 * in the main process and are resolved against the store when needed for
 * signing.
 */

import { ipcMain } from 'electron'
import {
  type WalletIdentity,
  type WalletIdentityView,
  toWalletIdentityView
} from '../../shared/walletIdentity'
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

  ipcMain.handle(
    'wallet:identity:list',
    async (): Promise<{ identities: WalletIdentityView[] }> => {
      const identities = await store.list()
      return { identities: identities.map(toWalletIdentityView) }
    }
  )

  ipcMain.handle(
    'wallet:identity:getActive',
    async (): Promise<{ identity: WalletIdentityView | null }> => {
      const identity = await store.getActive()
      return { identity: identity ? toWalletIdentityView(identity) : null }
    }
  )

  ipcMain.handle(
    'wallet:identity:setActive',
    async (
      _event,
      payload: unknown
    ): Promise<{ identity: WalletIdentityView | null; error?: string }> => {
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
      // Mirror the internal record (including owsName) into the in-memory
      // state used by publish / royalty / signing — those flows live in the
      // main process so they're allowed to see owsName.
      walletState.wallet = identityToWalletMetadata(identity)
      return { identity: toWalletIdentityView(identity) }
    }
  )
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
