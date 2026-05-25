import { ipcMain } from 'electron'
import {
  readEnvBridgeConfig,
  writeEnvBridgeConfig,
  getEnvBridgeStatus,
  type EnvBridgeConfig,
  type EnvBridgeStatus
} from '../services/agentEnvBridge'

/**
 * IPC handlers for the agent env bridge (#276).
 *
 * The renderer surface is intentionally narrow:
 *   - `agentEnvBridge:getStatus` returns `EnvBridgeStatus` — non-secret;
 *     boolean enabled/configured per bridge-able env key only.
 *   - `agentEnvBridge:setConfig` accepts a known-shape `EnvBridgeConfig`
 *     and writes it to `<userData>/config/agent-env-bridge.json`,
 *     then returns the refreshed status. The value of any env var is
 *     never read or returned through these handlers — that path stays
 *     in the spawner via `buildBridgedEnv` (#272).
 */
export function registerAgentEnvBridgeHandlers(): void {
  ipcMain.handle('agentEnvBridge:getStatus', async (): Promise<EnvBridgeStatus> => {
    const config = await readEnvBridgeConfig()
    return getEnvBridgeStatus(config)
  })

  ipcMain.handle(
    'agentEnvBridge:setConfig',
    async (_event, next: Partial<EnvBridgeConfig>): Promise<EnvBridgeStatus> => {
      // Sanitize on input — only accept the documented boolean shape;
      // never persist arbitrary fields the renderer might try to slip
      // in. Missing keys default to `false`.
      const sanitized: EnvBridgeConfig = {
        atlascloud: next?.atlascloud === true
      }
      await writeEnvBridgeConfig(sanitized)
      return getEnvBridgeStatus(sanitized)
    }
  )
}
