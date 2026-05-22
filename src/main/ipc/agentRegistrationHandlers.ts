import { ipcMain } from 'electron'
import type { SelectedWalletState } from './walletConnectionHandlers'
import type { OWSCoreModule, OWSVaultConfig } from '../services/owsAdapter'
import {
  readAgentStatus,
  executeAgentRegistration,
  buildAgentURI,
  signOwnerBinding,
  validateAgentRegistrationConfig,
  type AgentRegistrationConfig
} from '../services/agentRegistration'
import { findCachedAgent, upsertAgentCache } from '../services/agentRegistrationCache'
import { detectClis } from '../services/cliDetection'
import { checkActiveWalletInVault } from '../services/walletVaultCheck'
import type {
  AgentRegistrationStatus,
  AgentRegistrationResult,
  OwnerBindingProof,
  AgentCacheEntry
} from '../../shared/agentRegistration'

export interface AgentRegistrationHandlerDeps {
  walletState: SelectedWalletState
  owsModule: OWSCoreModule
  vaultConfig: OWSVaultConfig
  registrationConfig: AgentRegistrationConfig
  signerMode: 'live' | 'mock'
}

async function detectModelLabel(): Promise<string> {
  try {
    const report = await detectClis()
    const claude = report.clis.find((c) => c.command === 'claude' && c.installed)
    if (claude) return `Claude CLI${claude.version ? ' ' + claude.version : ''}`
    const codex = report.clis.find((c) => c.command === 'codex' && c.installed)
    if (codex) return `Codex CLI${codex.version ? ' ' + codex.version : ''}`
  } catch {
    // fall through
  }
  return 'PlotToon AI Writer'
}

export function registerAgentRegistrationHandlers(deps: AgentRegistrationHandlerDeps): void {
  ipcMain.handle(
    'agent:status',
    async (): Promise<{
      status: AgentRegistrationStatus | null
      cached: AgentCacheEntry | null
      error: string | null
    }> => {
      const wallet = deps.walletState.wallet
      if (!wallet) return { status: null, cached: null, error: null }

      const cached = await findCachedAgent(wallet.address)

      if (deps.signerMode === 'mock') {
        if (cached) {
          return {
            status: {
              registered: true,
              agentId: cached.agentId,
              agentURI: cached.agentURI
            },
            cached,
            error: null
          }
        }
        return {
          status: { registered: false, agentId: null, agentURI: null },
          cached: null,
          error: null
        }
      }

      const configErrors = validateAgentRegistrationConfig(deps.registrationConfig)
      if (configErrors.length > 0) {
        return {
          status: cached
            ? {
                registered: true,
                agentId: cached.agentId,
                agentURI: cached.agentURI
              }
            : null,
          cached,
          error: configErrors.join('; ')
        }
      }

      try {
        const status = await readAgentStatus(wallet.address, { config: deps.registrationConfig })
        return { status, cached, error: null }
      } catch (err) {
        return {
          status: cached
            ? {
                registered: true,
                agentId: cached.agentId,
                agentURI: cached.agentURI
              }
            : null,
          cached,
          error: err instanceof Error ? err.message : 'Failed to read agent status'
        }
      }
    }
  )

  ipcMain.handle(
    'agent:register',
    async (
      _event,
      params: { agentName: string; genre?: string; description?: string }
    ): Promise<AgentRegistrationResult> => {
      const wallet = deps.walletState.wallet
      if (!wallet) {
        return { success: false, error: 'No wallet connected' }
      }

      const modelLabel = await detectModelLabel()
      const agentURI = buildAgentURI({
        agentName: params.agentName,
        modelLabel,
        genre: params.genre,
        description: params.description
      })

      if (deps.signerMode === 'mock') {
        const mockAgentId = `mock-agent-${Date.now()}`

        await upsertAgentCache({
          agentId: mockAgentId,
          agentName: params.agentName,
          genre: params.genre || '',
          modelLabel,
          agentURI,
          registeredAt: new Date().toISOString(),
          registeredBy: 'plottoon',
          walletAddress: wallet.address
        })

        return { success: true, agentId: mockAgentId }
      }

      const configErrors = validateAgentRegistrationConfig(deps.registrationConfig)
      if (configErrors.length > 0) {
        return { success: false, error: configErrors.join('; ') }
      }

      // #235 stale-wallet guard before live agent registration signing.
      const fresh = checkActiveWalletInVault(deps.owsModule, deps.vaultConfig, wallet)
      if (!fresh.ok) {
        return { success: false, error: fresh.error ?? 'Active wallet is unavailable' }
      }

      try {
        const result = await executeAgentRegistration(agentURI, {
          config: deps.registrationConfig,
          ows: deps.owsModule,
          walletName: wallet.name,
          walletAddress: wallet.address,
          chain: deps.vaultConfig.chain,
          passphrase: deps.vaultConfig.passphrase
        })

        if (result.success && result.agentId) {
          await upsertAgentCache({
            agentId: result.agentId,
            agentName: params.agentName,
            genre: params.genre || '',
            modelLabel,
            agentURI,
            registeredAt: new Date().toISOString(),
            registeredBy: 'plottoon',
            walletAddress: wallet.address
          })
        }

        return result
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : 'Registration failed'
        }
      }
    }
  )

  ipcMain.handle(
    'agent:bindingProof',
    async (_event, humanWallet: string): Promise<OwnerBindingProof | { error: string }> => {
      const wallet = deps.walletState.wallet
      if (!wallet) {
        return { error: 'No wallet connected' }
      }

      if (!humanWallet || !/^0x[0-9a-fA-F]{40}$/.test(humanWallet)) {
        return { error: 'Invalid human wallet address' }
      }

      // #235 stale-wallet guard before signing the owner-binding proof.
      // signOwnerBinding goes straight to `owsModule.signMessage` with
      // `wallet.name`; if the wallet was deleted/renamed in the vault,
      // we surface the user-actionable error rather than the underlying
      // OWS failure.
      const fresh = checkActiveWalletInVault(deps.owsModule, deps.vaultConfig, wallet)
      if (!fresh.ok) {
        return { error: fresh.error ?? 'Active wallet is unavailable' }
      }

      try {
        const { message, signature } = signOwnerBinding(
          humanWallet,
          wallet.address,
          deps.owsModule,
          wallet.name,
          deps.vaultConfig.chain,
          deps.vaultConfig.passphrase
        )

        const cached = await findCachedAgent(wallet.address)

        return {
          message,
          signature,
          owsWalletAddress: wallet.address,
          cachedAgent: cached
        }
      } catch (err) {
        return {
          error: err instanceof Error ? err.message : 'Failed to sign binding proof'
        }
      }
    }
  )
}
