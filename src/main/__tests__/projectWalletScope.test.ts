import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {
  readProjectMeta,
  writeProjectMeta,
  createProjectMeta,
  validateMeta,
  ProjectMetaError,
  type ProjectMeta
} from '../services/projectMeta'
import {
  discoverProjects,
  partitionProjectsByWallet,
  type DiscoveredProject
} from '../services/projectDiscovery'
import { normalizeWalletAddress } from '../../shared/walletIdentity'

// All fixture wallets are fake — never use real addresses in tests.
const WALLET_A = '0xAAAA000000000000000000000000000000000001'
const WALLET_B = '0xBbBb000000000000000000000000000000000002'
const WALLET_A_LOWER = normalizeWalletAddress(WALLET_A)
const WALLET_B_LOWER = normalizeWalletAddress(WALLET_B)

function makeProjectDir(parent: string, name: string, meta: Record<string, unknown>): string {
  const projectPath = path.join(parent, name)
  mkdirSync(projectPath, { recursive: true })
  writeFileSync(path.join(projectPath, 'project.json'), JSON.stringify(meta), 'utf-8')
  return projectPath
}

describe('projectMeta wallet ownership', () => {
  const projectPath = '/tmp/fake-project'

  it('createProjectMeta returns a project with normalized wallet metadata when supplied', () => {
    const meta = createProjectMeta('My Webtoon', 'A test', {
      address: WALLET_A,
      source: 'plottoon-writer'
    })
    expect(meta.wallet).toEqual({
      address: WALLET_A_LOWER,
      source: 'plottoon-writer'
    })
  })

  it('createProjectMeta omits wallet when not supplied (legacy / no active wallet path)', () => {
    const meta = createProjectMeta('My Webtoon', 'A test')
    expect(meta.wallet).toBeUndefined()
  })

  it('validateMeta accepts a meta with wallet ownership', () => {
    const meta = validateMeta(
      {
        name: 'A',
        version: 1,
        createdAt: '2026-05-22T00:00:00.000Z',
        updatedAt: '2026-05-22T00:00:00.000Z',
        wallet: { address: WALLET_A, source: 'plotlink-writer' }
      },
      projectPath
    )
    expect(meta.wallet?.address).toBe(WALLET_A_LOWER)
    expect(meta.wallet?.source).toBe('plotlink-writer')
  })

  it('validateMeta rejects wallet with banned private-material field names', () => {
    const cases = ['privateKey', 'mnemonic', 'seed', 'passphrase', 'secret', 'vaultPath', 'owsName']
    for (const banned of cases) {
      expect(() =>
        validateMeta(
          {
            name: 'A',
            version: 1,
            createdAt: '2026-05-22T00:00:00.000Z',
            updatedAt: '2026-05-22T00:00:00.000Z',
            wallet: { address: WALLET_A, source: 'plottoon-writer', [banned]: 'x' }
          },
          projectPath
        )
      ).toThrow(ProjectMetaError)
    }
  })

  it('validateMeta rejects wallet with missing or wrong-shape fields', () => {
    expect(() =>
      validateMeta(
        {
          name: 'A',
          version: 1,
          createdAt: '2026-05-22T00:00:00.000Z',
          updatedAt: '2026-05-22T00:00:00.000Z',
          wallet: { address: '', source: 'plottoon-writer' }
        },
        projectPath
      )
    ).toThrow(ProjectMetaError)
    expect(() =>
      validateMeta(
        {
          name: 'A',
          version: 1,
          createdAt: '2026-05-22T00:00:00.000Z',
          updatedAt: '2026-05-22T00:00:00.000Z',
          wallet: { address: WALLET_A, source: 'random-source' }
        },
        projectPath
      )
    ).toThrow(ProjectMetaError)
  })

  it('writes and reads back wallet ownership round-trip', async () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), 'plottoon-walletscope-'))
    try {
      const meta: ProjectMeta = createProjectMeta('Round Trip', undefined, {
        address: WALLET_A,
        source: 'plottoon-writer'
      })
      await writeProjectMeta(tmp, meta)
      const json = readFileSync(path.join(tmp, 'project.json'), 'utf-8')
      // Persisted JSON must not contain any private-material key.
      expect(json).not.toMatch(/privateKey|mnemonic|passphrase|vaultPath|owsName/i)
      const round = await readProjectMeta(tmp)
      expect(round.wallet?.address).toBe(WALLET_A_LOWER)
      expect(round.wallet?.source).toBe('plottoon-writer')
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })
})

describe('partitionProjectsByWallet', () => {
  function fakeProject(name: string, ownerAddress?: string): DiscoveredProject {
    return {
      id: name,
      path: `/tmp/${name}`,
      meta: {
        name,
        version: 1,
        createdAt: '2026-05-22T00:00:00.000Z',
        updatedAt: '2026-05-22T00:00:00.000Z',
        wallet: ownerAddress
          ? { address: normalizeWalletAddress(ownerAddress), source: 'plottoon-writer' }
          : undefined
      },
      error: null
    }
  }

  function brokenProject(name: string): DiscoveredProject {
    return { id: null, path: `/tmp/${name}`, meta: null, error: 'project.json is bad' }
  }

  it('partitions two-wallet projects so each wallet only sees its own', () => {
    const projects = [
      fakeProject('owned-by-a', WALLET_A),
      fakeProject('owned-by-b', WALLET_B),
      fakeProject('legacy-no-owner'),
      brokenProject('broken-meta')
    ]

    const fromA = partitionProjectsByWallet(projects, WALLET_A)
    expect(fromA.owned.map((p) => p.meta?.name)).toEqual(['owned-by-a'])
    expect(fromA.otherWallets.map((p) => p.meta?.name)).toEqual(['owned-by-b'])
    expect(fromA.legacy.map((p) => p.meta?.name)).toEqual(['legacy-no-owner'])
    expect(fromA.errors.map((p) => p.path)).toEqual(['/tmp/broken-meta'])

    // Switching to wallet B re-partitions without re-reading the disk.
    const fromB = partitionProjectsByWallet(projects, WALLET_B)
    expect(fromB.owned.map((p) => p.meta?.name)).toEqual(['owned-by-b'])
    expect(fromB.otherWallets.map((p) => p.meta?.name)).toEqual(['owned-by-a'])
    expect(fromB.legacy.map((p) => p.meta?.name)).toEqual(['legacy-no-owner'])
  })

  it('treats mixed-case addresses as the same wallet (normalization)', () => {
    const projects = [fakeProject('mine', WALLET_A.toLowerCase())]
    const result = partitionProjectsByWallet(projects, WALLET_A.toUpperCase())
    expect(result.owned).toHaveLength(1)
    expect(result.otherWallets).toHaveLength(0)
  })

  it('with no active wallet, every stamped project lands in otherWallets and legacy stays legacy', () => {
    const projects = [fakeProject('owned-by-a', WALLET_A), fakeProject('legacy')]
    const result = partitionProjectsByWallet(projects, null)
    expect(result.owned).toHaveLength(0)
    expect(result.otherWallets).toHaveLength(1)
    expect(result.legacy).toHaveLength(1)
  })
})

describe('discoverProjects + partitionProjectsByWallet integration with two fake wallets', () => {
  let tmp: string

  beforeEach(() => {
    tmp = mkdtempSync(path.join(os.tmpdir(), 'plottoon-walletscope-fs-'))
  })

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true })
  })

  it('partitions a real on-disk fixture so wallet A sees only its own + legacy', async () => {
    const now = '2026-05-22T00:00:00.000Z'
    makeProjectDir(tmp, 'a-project', {
      name: 'Wallet A Story',
      version: 1,
      createdAt: now,
      updatedAt: now,
      wallet: { address: WALLET_A_LOWER, source: 'plottoon-writer' }
    })
    makeProjectDir(tmp, 'b-project', {
      name: 'Wallet B Story',
      version: 1,
      createdAt: now,
      updatedAt: now,
      wallet: { address: WALLET_B_LOWER, source: 'plotlink-writer' }
    })
    makeProjectDir(tmp, 'legacy-project', {
      name: 'Legacy Story',
      version: 1,
      createdAt: now,
      updatedAt: now
    })

    const projects = await discoverProjects(tmp)
    expect(projects).toHaveLength(3)

    const fromA = partitionProjectsByWallet(projects, WALLET_A)
    expect(fromA.owned.map((p) => p.meta?.name)).toContain('Wallet A Story')
    expect(fromA.otherWallets.map((p) => p.meta?.name)).toContain('Wallet B Story')
    expect(fromA.legacy.map((p) => p.meta?.name)).toContain('Legacy Story')

    const fromB = partitionProjectsByWallet(projects, WALLET_B)
    expect(fromB.owned.map((p) => p.meta?.name)).toContain('Wallet B Story')
    expect(fromB.otherWallets.map((p) => p.meta?.name)).toContain('Wallet A Story')
    expect(fromB.legacy.map((p) => p.meta?.name)).toContain('Legacy Story')
  })
})
