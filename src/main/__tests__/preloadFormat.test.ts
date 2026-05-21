import { describe, it, expect } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '..', '..', '..')

async function readSource(relativePath: string): Promise<string> {
  return fs.readFile(path.join(ROOT, relativePath), 'utf-8')
}

describe('Preload format — regression (issue #192)', () => {
  it('electron-vite config emits preload as CJS', async () => {
    const config = await readSource('electron.vite.config.ts')

    expect(config).toContain("formats: ['cjs']")
    expect(config).toContain("entryFileNames: '[name].cjs'")
  })

  it('main process loads preload with .cjs extension', async () => {
    const main = await readSource('src/main/index.ts')

    expect(main).toContain("preload/index.cjs'")
    expect(main).not.toContain("preload/index.mjs'")
  })

  it('preload exposes window.plottoon via contextBridge', async () => {
    const preload = await readSource('src/preload/index.ts')

    expect(preload).toContain('contextBridge.exposeInMainWorld')
    expect(preload).toContain("'plottoon'")
  })

  it('main process keeps contextIsolation enabled and nodeIntegration disabled', async () => {
    const main = await readSource('src/main/index.ts')

    expect(main).toContain('contextIsolation: true')
    expect(main).toContain('nodeIntegration: false')
  })

  it('built preload artifact exists as .cjs after build', async () => {
    const artifact = path.join(ROOT, 'dist/preload/index.cjs')
    const stat = await fs.stat(artifact)
    expect(stat.isFile()).toBe(true)
  })

  it('built preload artifact uses CommonJS module pattern', async () => {
    const content = await fs.readFile(path.join(ROOT, 'dist/preload/index.cjs'), 'utf-8')

    // CJS preload should not use import statements
    expect(content).not.toMatch(/^import\s/m)
    // Should contain require or exports (CJS markers)
    expect(content).toMatch(/require\(|exports\./)
  })
})
