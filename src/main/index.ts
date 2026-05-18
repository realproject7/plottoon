import { app, BrowserWindow } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { registerFsHandlers } from './ipc/fsHandlers'
import { registerProjectHandlers } from './ipc/projectHandlers'
import { registerTerminalHandlers } from './ipc/terminalHandlers'
import { registerSigningHandlers } from './ipc/signingHandlers'
import {
  registerWalletConnectionHandlers,
  createSelectedWalletState
} from './ipc/walletConnectionHandlers'
import { registerPublishHandlers } from './ipc/publishHandlers'
import { destroyAllSessions } from './services/terminalSession'
import { createWalletSigner } from './services/walletSigning'
import { createOWSConfig, createOWSFromCore, type OWSVaultConfig } from './services/owsAdapter'
import { getDefaultPublishConfig } from './services/plotlinkPublish'
import { keccak256, toBytes } from 'viem'

const currentDir = path.dirname(fileURLToPath(import.meta.url))

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      preload: path.join(currentDir, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(path.join(currentDir, '../renderer/index.html'))
  }
}

app.whenReady().then(async () => {
  registerFsHandlers()
  registerProjectHandlers()
  registerTerminalHandlers()

  const signer = createWalletSigner({ mode: 'mock' })
  registerSigningHandlers(signer)

  const owsModule = await createOWSFromCore()
  const vaultConfig: OWSVaultConfig = {
    vaultPath: process.env.OWS_VAULT_PATH,
    passphrase: process.env.OWS_PASSPHRASE,
    chain: process.env.OWS_DEFAULT_CHAIN || 'eip155:8453'
  }
  const walletConfig = createOWSConfig(owsModule, vaultConfig)
  const walletState = createSelectedWalletState()
  registerWalletConnectionHandlers(walletConfig, walletState, signer)

  const publishConfig = getDefaultPublishConfig()
  registerPublishHandlers({
    walletState,
    signer,
    owsModule,
    vaultConfig,
    config: publishConfig,
    ipfs: {
      async upload(content: string) {
        const response = await fetch(publishConfig.ipfsUploadUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pinataContent: content })
        })
        const json = (await response.json()) as { IpfsHash: string }
        return { cid: json.IpfsHash }
      }
    },
    keccak: (content: string) => keccak256(toBytes(content)),
    fetchFn: fetch as unknown as (url: string, init: RequestInit) => Promise<Response>,
    getWindow: () => BrowserWindow.getAllWindows()[0] ?? null
  })

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('will-quit', () => {
  destroyAllSessions()
})
