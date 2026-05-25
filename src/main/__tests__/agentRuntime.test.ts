import { describe, it, expect } from 'vitest'
import {
  detectAgentRuntimes,
  selectDefaultAgent,
  buildLaunchCommand,
  codexResumeLimitations,
  AgentLaunchError,
  type AgentRuntimeReport
} from '../services/agentRuntime'
import type { CapabilityReport } from '../services/cliDetection'

function cliReport(
  opts: { claudeInstalled?: boolean; codexInstalled?: boolean } = {}
): CapabilityReport {
  return {
    detectedAt: '2026-05-25T00:00:00.000Z',
    clis: [
      {
        name: 'Claude CLI',
        command: 'claude',
        installed: opts.claudeInstalled ?? false,
        version: opts.claudeInstalled ? 'claude 1.2.3' : null
      },
      {
        name: 'Codex CLI',
        command: 'codex',
        installed: opts.codexInstalled ?? false,
        version: opts.codexInstalled ? 'codex 0.5' : null
      }
    ]
  }
}

describe('#271 detectAgentRuntimes', () => {
  it('reports both runtimes with installed=false when neither CLI is on PATH', async () => {
    const report = await detectAgentRuntimes(cliReport())
    expect(report.runtimes).toHaveLength(2)
    expect(report.runtimes.every((r) => r.installed === false)).toBe(true)
    expect(report.defaultAgent).toBeNull()
  })

  it('picks Claude as default when only Claude is installed', async () => {
    const report = await detectAgentRuntimes(cliReport({ claudeInstalled: true }))
    expect(report.defaultAgent).toBe('claude')
    const claude = report.runtimes.find((r) => r.kind === 'claude')!
    expect(claude.installed).toBe(true)
    expect(claude.version).toBe('claude 1.2.3')
  })

  it('picks Codex as default when only Codex is installed', async () => {
    const report = await detectAgentRuntimes(cliReport({ codexInstalled: true }))
    expect(report.defaultAgent).toBe('codex')
  })

  it('prefers Claude when both are installed (per RUNTIME_DEFS order)', async () => {
    const report = await detectAgentRuntimes(
      cliReport({ claudeInstalled: true, codexInstalled: true })
    )
    expect(report.defaultAgent).toBe('claude')
    // Both runtimes are surfaced with metadata so the renderer can let
    // the user override the default later.
    expect(report.runtimes.find((r) => r.kind === 'codex')?.installed).toBe(true)
  })

  it('selectDefaultAgent returns the same value as report.defaultAgent', async () => {
    const report = await detectAgentRuntimes(cliReport({ claudeInstalled: true }))
    expect(selectDefaultAgent(report)).toBe(report.defaultAgent)
  })

  it('preserves the CLI detectedAt timestamp', async () => {
    const report = await detectAgentRuntimes(cliReport())
    expect(report.detectedAt).toBe('2026-05-25T00:00:00.000Z')
  })
})

describe('#271 buildLaunchCommand — Claude', () => {
  const projectRoot = '/tmp/fake-project'
  const sessionId = '00000000-0000-4000-8000-000000000001'

  it('builds a fresh Claude launch with --session-id when sessionId is provided', () => {
    const cmd = buildLaunchCommand({
      kind: 'claude',
      mode: 'fresh',
      projectRoot,
      sessionId
    })
    expect(cmd).toEqual({
      command: 'claude',
      args: ['--session-id', sessionId],
      cwd: projectRoot
    })
  })

  it('builds a fresh Claude launch with no flag when sessionId is omitted (CLI mints its own id)', () => {
    const cmd = buildLaunchCommand({
      kind: 'claude',
      mode: 'fresh',
      projectRoot
    })
    expect(cmd).toEqual({
      command: 'claude',
      args: [],
      cwd: projectRoot
    })
  })

  it('builds a Claude resume launch with --resume <sessionId>', () => {
    const cmd = buildLaunchCommand({
      kind: 'claude',
      mode: 'resume',
      projectRoot,
      sessionId
    })
    expect(cmd).toEqual({
      command: 'claude',
      args: ['--resume', sessionId],
      cwd: projectRoot
    })
  })

  it('throws AgentLaunchError when resume is requested without a sessionId', () => {
    expect(() =>
      buildLaunchCommand({
        kind: 'claude',
        mode: 'resume',
        projectRoot
      })
    ).toThrow(AgentLaunchError)
  })
})

describe('#271 buildLaunchCommand — Codex', () => {
  const projectRoot = '/tmp/fake-project'

  it('builds a fresh Codex launch with -C <projectRoot> + cwd', () => {
    const cmd = buildLaunchCommand({
      kind: 'codex',
      mode: 'fresh',
      projectRoot
    })
    expect(cmd).toEqual({
      command: 'codex',
      args: ['-C', projectRoot],
      cwd: projectRoot
    })
  })

  it('builds a Codex resume launch as `codex resume` (interactive picker per documented limitation)', () => {
    const cmd = buildLaunchCommand({
      kind: 'codex',
      mode: 'resume',
      projectRoot,
      sessionId: 'opaque-session-token'
    })
    expect(cmd).toEqual({
      command: 'codex',
      args: ['resume'],
      cwd: projectRoot
    })
  })

  it('still requires a sessionId on resume so callers can persist intent (even though Codex ignores it today)', () => {
    expect(() =>
      buildLaunchCommand({
        kind: 'codex',
        mode: 'resume',
        projectRoot
      })
    ).toThrow(AgentLaunchError)
  })

  it('documents the deterministic-resume limitation via codexResumeLimitations', () => {
    expect(codexResumeLimitations.deterministicResume).toBe(false)
    expect(codexResumeLimitations.reason).toMatch(/interactive `codex resume` picker/)
    expect(codexResumeLimitations.reason).toMatch(/no stable session-id resume path/)
  })
})

describe('#271 buildLaunchCommand — projectRoot validation', () => {
  it('throws when projectRoot is empty', () => {
    expect(() =>
      buildLaunchCommand({
        kind: 'claude',
        mode: 'fresh',
        projectRoot: ''
      })
    ).toThrow(AgentLaunchError)
  })

  it('throws when projectRoot is missing', () => {
    expect(() =>
      buildLaunchCommand({
        kind: 'claude',
        mode: 'fresh',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        projectRoot: undefined as any
      })
    ).toThrow(AgentLaunchError)
  })
})

describe('#271 buildLaunchCommand — no env leakage', () => {
  // The builder must never read from `process.env` or inject secret-
  // looking values into the descriptor. Tests run with hostile env vars
  // present and assert they don't surface anywhere in the output.
  it('does not include any secret-looking env values in the descriptor output', () => {
    const ORIGINAL = {
      claudeKey: process.env.ANTHROPIC_API_KEY,
      openaiKey: process.env.OPENAI_API_KEY,
      walletPriv: process.env.WALLET_PRIVATE_KEY
    }
    process.env.ANTHROPIC_API_KEY = 'fake-test-anthropic-key'
    process.env.OPENAI_API_KEY = 'fake-test-openai-key'
    process.env.WALLET_PRIVATE_KEY = 'fake-test-wallet-key'
    try {
      const fresh = buildLaunchCommand({
        kind: 'claude',
        mode: 'fresh',
        projectRoot: '/tmp/x'
      })
      const resume = buildLaunchCommand({
        kind: 'claude',
        mode: 'resume',
        projectRoot: '/tmp/x',
        sessionId: '11111111-1111-4111-8111-111111111111'
      })
      const codexFresh = buildLaunchCommand({
        kind: 'codex',
        mode: 'fresh',
        projectRoot: '/tmp/x'
      })
      for (const cmd of [fresh, resume, codexFresh]) {
        const serialized = JSON.stringify(cmd)
        expect(serialized).not.toContain('fake-test-anthropic-key')
        expect(serialized).not.toContain('fake-test-openai-key')
        expect(serialized).not.toContain('fake-test-wallet-key')
      }
    } finally {
      if (ORIGINAL.claudeKey === undefined) delete process.env.ANTHROPIC_API_KEY
      else process.env.ANTHROPIC_API_KEY = ORIGINAL.claudeKey
      if (ORIGINAL.openaiKey === undefined) delete process.env.OPENAI_API_KEY
      else process.env.OPENAI_API_KEY = ORIGINAL.openaiKey
      if (ORIGINAL.walletPriv === undefined) delete process.env.WALLET_PRIVATE_KEY
      else process.env.WALLET_PRIVATE_KEY = ORIGINAL.walletPriv
    }
  })
})

describe('#271 AgentRuntimeReport shape', () => {
  it('runtimes contain only public metadata (no env / no secrets)', async () => {
    const report: AgentRuntimeReport = await detectAgentRuntimes(
      cliReport({ claudeInstalled: true })
    )
    const serialized = JSON.stringify(report)
    expect(serialized).not.toMatch(/api[_-]?key/i)
    expect(serialized).not.toMatch(/secret/i)
    expect(serialized).not.toMatch(/token/i)
    expect(serialized).not.toMatch(/private/i)
    // Each runtime exposes only the documented keys.
    for (const runtime of report.runtimes) {
      expect(Object.keys(runtime).sort()).toEqual([
        'command',
        'displayName',
        'installed',
        'kind',
        'version'
      ])
    }
  })
})
