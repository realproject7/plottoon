import { describe, it, expect } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '..', '..', '..')

async function readSource(relativePath: string): Promise<string> {
  return fs.readFile(path.join(ROOT, relativePath), 'utf-8')
}

describe('Security boundary — structural verification (issue #56)', () => {
  describe('Cloud/backend disclosure content', () => {
    it('AtlasCloudGuide contains required disclosures', async () => {
      const source = await readSource('src/renderer/AtlasCloudGuide.tsx')

      expect(source).toContain('does not store API keys')
      expect(source).toContain('Never paste your API key')
      expect(source).toContain('incur costs')
      expect(source).toContain('confirm before')
      expect(source).toContain('Read the API key from the environment')
    })
  })

  describe('OWS-only wallet: no browser wallet, no key export', () => {
    it('preload does not expose signing or wallet secret material', async () => {
      const source = await readSource('src/preload/index.ts')

      expect(source).not.toContain('walletSigning')
      expect(source).not.toContain('privateKey')
      expect(source).not.toContain('mnemonic')
      expect(source).not.toContain('signMessage')
      expect(source).not.toContain('exportKey')
      expect(source).not.toContain('importKey')
      expect(source).not.toContain('seedPhrase')
    })

    it('preload wallet API is limited to connect/disconnect/options', async () => {
      const source = await readSource('src/preload/index.ts')

      expect(source).toContain('wallet:getOptions')
      expect(source).toContain('wallet:connect')
      expect(source).toContain('wallet:getConnected')
      expect(source).toContain('wallet:disconnect')
      expect(source).toContain('wallet:getSignerMode')
      expect(source).not.toContain('wallet:sign')
      expect(source).not.toContain('wallet:export')
      expect(source).not.toContain('wallet:import')
    })

    it('Electron context isolation is enforced', async () => {
      const source = await readSource('src/main/index.ts')

      expect(source).toContain('contextIsolation: true')
      expect(source).toContain('nodeIntegration: false')
    })
  })

  describe('Publish/royalty IPC requires confirmation flag', () => {
    it('publish:execute IPC passes confirmed flag', async () => {
      const source = await readSource('src/preload/index.ts')
      expect(source).toContain('publish:execute')
      expect(source).toMatch(/execute.*confirmed/)
    })

    it('royalty:claim IPC passes confirmed flag', async () => {
      const source = await readSource('src/preload/index.ts')
      expect(source).toContain('royalty:claim')
      expect(source).toMatch(/claim.*confirmed/)
    })

    it('publish handler rejects without confirmed flag', async () => {
      const source = await readSource('src/main/ipc/publishHandlers.ts')
      expect(source).toContain('confirmed')
    })

    it('royalty handler rejects without confirmed flag', async () => {
      const source = await readSource('src/main/ipc/royaltyHandlers.ts')
      expect(source).toContain('confirmed')
    })
  })
})
