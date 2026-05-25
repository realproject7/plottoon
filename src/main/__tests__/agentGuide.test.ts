import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import {
  generatePlotToonAgentGuide,
  writeOrRefreshProjectAgentGuide,
  PLOTTOON_AGENT_GUIDE_VERSION,
  PLOTTOON_AGENT_GUIDE_FILENAME
} from '../services/agentGuide'

let tmpDir: string

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(os.tmpdir(), 'plottoon-agent-guide-'))
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

describe('#277 generatePlotToonAgentGuide — content', () => {
  it('stamps the current version on the first line', () => {
    const md = generatePlotToonAgentGuide({ projectName: 'Fake Project' })
    const firstLine = md.split('\n')[0]
    expect(firstLine).toContain(`(v${PLOTTOON_AGENT_GUIDE_VERSION})`)
    expect(firstLine).toContain('Fake Project')
  })

  it('describes the structure → publish workflow (§1)', () => {
    const md = generatePlotToonAgentGuide({ projectName: 'Fake Project' })
    expect(md).toMatch(/structure\.md/)
    expect(md).toMatch(/cuts\.json/i)
    expect(md).toMatch(/clean image generation/i)
    expect(md).toMatch(/editor/i)
    expect(md).toMatch(/export/i)
    expect(md).toMatch(/publish/i)
  })

  it('pins cuts.json as canonical (§2)', () => {
    const md = generatePlotToonAgentGuide({ projectName: 'Fake Project' })
    expect(md).toMatch(/cuts\.json/i)
    expect(md).toMatch(/single source of truth/i)
    // Cut id convention and the safe-edit rules.
    expect(md).toMatch(/cut-NNN/i)
    expect(md).toMatch(/Always read first/i)
    expect(md).toMatch(/Validate/i)
  })

  it('forbids text/bubbles in clean images and pins the output path (§3)', () => {
    const md = generatePlotToonAgentGuide({ projectName: 'Fake Project' })
    expect(md).toMatch(/No speech bubbles, no captions, no text overlays/i)
    expect(md).toMatch(/plots\/<plot-slug>\/assets\/<cut-id>\/clean-vNNN\.webp/)
    expect(md).toMatch(/WebP/i)
  })

  it('explains the AtlasCloud env bridge (§4)', () => {
    const md = generatePlotToonAgentGuide({ projectName: 'Fake Project' })
    expect(md).toMatch(/AtlasCloud/i)
    expect(md).toMatch(/env bridge/i)
    expect(md).toMatch(/ATLASCLOUD_API_KEY/)
    // Match across possible line-wrap whitespace between words.
    expect(md).toMatch(/never request it from the\s+user/i)
    expect(md).toMatch(/process\.env\.ATLASCLOUD_API_KEY/)
  })

  it('explains the manual editor handoff (§5)', () => {
    const md = generatePlotToonAgentGuide({ projectName: 'Fake Project' })
    expect(md).toMatch(/Manual editor handoff/i)
    expect(md).toMatch(/human user.*adds speech bubbles/i)
    expect(md).toMatch(/Not try to render lettering inside the generated image/i)
  })

  it('lists what the agent must never touch (§6)', () => {
    const md = generatePlotToonAgentGuide({ projectName: 'Fake Project' })
    expect(md).toMatch(/exports\//)
    expect(md).toMatch(/Wallet material/i)
    expect(md).toMatch(/Publish signatures/i)
    expect(md).toMatch(/Private env vars/i)
  })

  it('includes a sanitized file-layout tree (§7)', () => {
    const md = generatePlotToonAgentGuide({ projectName: 'Fake Project' })
    expect(md).toMatch(/Fake Project\//)
    expect(md).toMatch(/PLOTTOON_AGENT_GUIDE\.md/)
    expect(md).toMatch(/<plot-slug>/)
    expect(md).toMatch(/<cut-id>/)
  })

  it('never includes real-looking secrets, paths, or wallet material', () => {
    const md = generatePlotToonAgentGuide({ projectName: 'Fake Project' })
    // No real-looking wallet addresses (0x followed by 40 hex chars)
    expect(md).not.toMatch(/0x[0-9a-fA-F]{40}/)
    // No private-key / mnemonic / passphrase literals beyond the
    // documented identifiers (the rules MENTION the words to warn
    // against them; that's fine. Pin we don't include a value or
    // example secret).
    expect(md).not.toMatch(/sk-[A-Za-z0-9]{20,}/) // no API key prefixes
    expect(md).not.toMatch(/-----BEGIN/) // no PEM blocks
    expect(md).not.toMatch(/\/Users\/[a-z]+/) // no real macOS user paths
    expect(md).not.toMatch(/\/home\/[a-z]+/) // no real linux user paths
  })

  it('falls back to "this project" when projectName is empty', () => {
    const md = generatePlotToonAgentGuide({ projectName: '' })
    expect(md.split('\n')[0]).toContain('this project')
  })

  it('exposes a stable filename constant', () => {
    expect(PLOTTOON_AGENT_GUIDE_FILENAME).toBe('PLOTTOON_AGENT_GUIDE.md')
  })
})

describe('#277 writeOrRefreshProjectAgentGuide — write + refresh logic', () => {
  it('writes the guide file when it does not exist', async () => {
    const result = await writeOrRefreshProjectAgentGuide(tmpDir, { projectName: 'New Project' })
    expect(result.updated).toBe(true)
    expect(result.path).toBe(path.join(tmpDir, PLOTTOON_AGENT_GUIDE_FILENAME))
    const content = await fs.readFile(result.path, 'utf-8')
    expect(content.split('\n')[0]).toContain(`(v${PLOTTOON_AGENT_GUIDE_VERSION})`)
    expect(content).toContain('New Project')
  })

  it('is a no-op when the file already carries the current version stamp', async () => {
    await writeOrRefreshProjectAgentGuide(tmpDir, { projectName: 'New Project' })
    const filePath = path.join(tmpDir, PLOTTOON_AGENT_GUIDE_FILENAME)
    const firstMtime = (await fs.stat(filePath)).mtimeMs

    // Wait a hair so a real write would change mtime; then call again.
    await new Promise((r) => setTimeout(r, 10))
    const result = await writeOrRefreshProjectAgentGuide(tmpDir, { projectName: 'New Project' })
    expect(result.updated).toBe(false)
    const secondMtime = (await fs.stat(filePath)).mtimeMs
    expect(secondMtime).toBe(firstMtime)
  })

  it('refreshes the file when the existing version stamp differs', async () => {
    const filePath = path.join(tmpDir, PLOTTOON_AGENT_GUIDE_FILENAME)
    // Simulate an old PlotToon build's guide already on disk.
    await fs.writeFile(
      filePath,
      `# PlotToon — Agent Guide for Older Project (v0.0.1)\n\nstale content\n`,
      'utf-8'
    )
    const result = await writeOrRefreshProjectAgentGuide(tmpDir, { projectName: 'Refreshed' })
    expect(result.updated).toBe(true)
    const content = await fs.readFile(filePath, 'utf-8')
    expect(content.split('\n')[0]).toContain(`(v${PLOTTOON_AGENT_GUIDE_VERSION})`)
    expect(content).toContain('Refreshed')
    expect(content).not.toContain('stale content')
  })

  it('rewrites the file when the existing content is unreadable (empty / corrupt)', async () => {
    const filePath = path.join(tmpDir, PLOTTOON_AGENT_GUIDE_FILENAME)
    // A zero-byte file would have no first line containing the
    // version stamp; the refresh should rewrite.
    await fs.writeFile(filePath, '', 'utf-8')
    const result = await writeOrRefreshProjectAgentGuide(tmpDir, { projectName: 'Fixed' })
    expect(result.updated).toBe(true)
    const content = await fs.readFile(filePath, 'utf-8')
    expect(content.split('\n')[0]).toContain(`(v${PLOTTOON_AGENT_GUIDE_VERSION})`)
  })
})
