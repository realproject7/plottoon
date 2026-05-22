// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { ProjectList } from '../ProjectList'
import { WALLET_ACTIVE_CHANGED_EVENT } from '../../shared/walletIdentity'

// Fake test wallets only.
const WALLET_A = '0xaaaa000000000000000000000000000000000001'
const WALLET_B = '0xbbbb000000000000000000000000000000000002'

function makeProject(name: string, pathStr: string, ownerAddress?: string): DiscoveredProject {
  return {
    id: pathStr,
    path: pathStr,
    meta: {
      name,
      version: 1,
      createdAt: '2026-05-22T00:00:00.000Z',
      updatedAt: '2026-05-22T00:00:00.000Z',
      description: `${name} desc`,
      wallet: ownerAddress ? { address: ownerAddress, source: 'plottoon-writer' } : undefined
    },
    error: null
  }
}

interface PartitionInput {
  owned?: DiscoveredProject[]
  legacy?: DiscoveredProject[]
  otherWallets?: DiscoveredProject[]
  errors?: DiscoveredProject[]
  activeAddress?: string | null
}

function makePartition(input: PartitionInput): PartitionedDiscovery {
  return {
    owned: input.owned ?? [],
    legacy: input.legacy ?? [],
    otherWallets: input.otherWallets ?? [],
    errors: input.errors ?? [],
    activeAddress: input.activeAddress ?? null
  }
}

function installProjectApi(
  discoverMock: () => Promise<PartitionedDiscovery>,
  overrides: Partial<PlottoonProject> = {}
): { assignToActiveWallet: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> } {
  const assignToActiveWallet = vi.fn(async (projectId: string) => ({
    ok: true,
    meta: {
      name: projectId,
      version: 1,
      createdAt: '2026-05-22T00:00:00.000Z',
      updatedAt: '2026-05-22T00:00:00.000Z'
    }
  }))
  const create = vi.fn()
  const api: PlottoonProject = {
    discover: discoverMock,
    readMeta: vi.fn(),
    writeMeta: vi.fn(),
    create,
    assignToActiveWallet,
    setProjectsDir: vi.fn(),
    getProjectsDir: vi.fn(),
    detectClis: vi.fn(),
    ...overrides
  }
  ;(window as unknown as { plottoon: { project: PlottoonProject } }).plottoon = { project: api }
  return { assignToActiveWallet, create }
}

afterEach(cleanup)

describe('ProjectList — wallet scoping', () => {
  it('shows only the owned bucket and no legacy section when all projects belong to the active wallet', async () => {
    installProjectApi(async () =>
      makePartition({
        owned: [makeProject('Wallet A Story', '/tmp/a', WALLET_A)],
        activeAddress: WALLET_A
      })
    )
    render(<ProjectList />)
    await waitFor(() => expect(screen.getByText('Wallet A Story')).toBeDefined())
    expect(screen.queryByTestId('legacy-projects-section')).toBeNull()
  })

  it('renders a legacy bucket with an Assign button for unstamped projects', async () => {
    installProjectApi(async () =>
      makePartition({
        owned: [makeProject('Owned', '/tmp/owned', WALLET_A)],
        legacy: [
          makeProject('Legacy One', '/tmp/legacy1'),
          makeProject('Legacy Two', '/tmp/legacy2')
        ],
        activeAddress: WALLET_A
      })
    )
    render(<ProjectList />)
    await waitFor(() => expect(screen.getByText('Owned')).toBeDefined())
    expect(screen.getByTestId('legacy-projects-section')).toBeDefined()
    expect(screen.getByText('Legacy One')).toBeDefined()
    expect(screen.getByText('Legacy Two')).toBeDefined()
    expect(screen.getByTestId('assign-project-/tmp/legacy1')).toBeDefined()
    expect(screen.getByTestId('assign-project-/tmp/legacy2')).toBeDefined()
  })

  it('Assign calls project.assignToActiveWallet and refreshes the list', async () => {
    let discoverCalls = 0
    const discover = vi.fn(async () => {
      discoverCalls += 1
      // After the first discover (initial render), simulate the legacy
      // project moving to the owned bucket because it was just assigned.
      if (discoverCalls === 1) {
        return makePartition({
          legacy: [makeProject('Legacy', '/tmp/legacy')],
          activeAddress: WALLET_A
        })
      }
      return makePartition({
        owned: [makeProject('Legacy', '/tmp/legacy', WALLET_A)],
        activeAddress: WALLET_A
      })
    })
    const { assignToActiveWallet } = installProjectApi(discover)
    render(<ProjectList />)

    const assignBtn = await screen.findByTestId('assign-project-/tmp/legacy')
    fireEvent.click(assignBtn)

    await waitFor(() => {
      expect(assignToActiveWallet).toHaveBeenCalledWith('/tmp/legacy')
      // discover ran a second time after the assign succeeded — that's how
      // the legacy project moves to the owned bucket without an app restart.
      expect(discover).toHaveBeenCalledTimes(2)
    })
  })

  it('re-discovers when the wallet active-changed event fires', async () => {
    let active = WALLET_A
    const discover = vi.fn(async () =>
      makePartition({
        owned:
          active === WALLET_A
            ? [makeProject('A Story', '/tmp/a', WALLET_A)]
            : [makeProject('B Story', '/tmp/b', WALLET_B)],
        activeAddress: active
      })
    )
    installProjectApi(discover)
    render(<ProjectList />)
    await waitFor(() => expect(screen.getByText('A Story')).toBeDefined())

    active = WALLET_B
    window.dispatchEvent(new CustomEvent(WALLET_ACTIVE_CHANGED_EVENT))

    await waitFor(() => expect(screen.getByText('B Story')).toBeDefined())
    // The previous wallet's project must not appear after the switch.
    expect(screen.queryByText('A Story')).toBeNull()
  })

  it('shows the no-active-wallet state when discover returns activeAddress: null', async () => {
    installProjectApi(async () => makePartition({ activeAddress: null }))
    render(<ProjectList />)
    await waitFor(() => {
      expect(screen.getByTestId('no-active-wallet-state')).toBeDefined()
    })
    expect(screen.getByText('No active wallet')).toBeDefined()
  })

  it('renders nothing related to OWS internal names anywhere in the DOM', async () => {
    const { container } = (() => {
      installProjectApi(async () =>
        makePartition({
          owned: [makeProject('Public-safe', '/tmp/safe', WALLET_A)],
          activeAddress: WALLET_A
        })
      )
      return render(<ProjectList />)
    })()
    await waitFor(() => expect(screen.getByText('Public-safe')).toBeDefined())
    const html = container.innerHTML
    expect(html).not.toMatch(/owsName|plottoon-writer-fake|plotlink-writer-fake/i)
    expect(html).not.toMatch(/privateKey|mnemonic|passphrase|vaultPath/i)
  })
})
