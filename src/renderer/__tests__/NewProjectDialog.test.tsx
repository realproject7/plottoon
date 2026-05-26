// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { ProjectList } from '../ProjectList'

const WALLET_A = '0xaaaa000000000000000000000000000000000001'

function makePartition(input: {
  owned?: DiscoveredProject[]
  legacy?: DiscoveredProject[]
  otherWallets?: DiscoveredProject[]
  errors?: DiscoveredProject[]
  activeAddress?: string | null
}): PartitionedDiscovery {
  return {
    owned: input.owned ?? [],
    legacy: input.legacy ?? [],
    otherWallets: input.otherWallets ?? [],
    errors: input.errors ?? [],
    activeAddress: input.activeAddress ?? null
  }
}

function installProjectApi(
  partition: PartitionedDiscovery,
  overrides: Partial<PlottoonProject> = {}
): { create: ReturnType<typeof vi.fn>; discover: ReturnType<typeof vi.fn> } {
  const discover = vi.fn(async () => partition)
  const create = vi.fn()
  const api: PlottoonProject = {
    discover,
    readMeta: vi.fn(),
    writeMeta: vi.fn(),
    create,
    assignToActiveWallet: vi.fn(),
    setProjectsDir: vi.fn(),
    getProjectsDir: vi.fn(),
    detectClis: vi.fn(),
    ...overrides
  }
  ;(window as unknown as { plottoon: { project: PlottoonProject } }).plottoon = { project: api }
  return { create, discover }
}

afterEach(cleanup)

describe('#246 New project dialog — replaces window.prompt', () => {
  // Sanity guard: the renderer must NEVER call browser-native prompt for the
  // creation flow. The whole point of #246 is that Electron makes the
  // prompt window unreliable, so we spy on `window.prompt` and assert it
  // never fires across the entire test.
  function pinNoPromptCalls(): ReturnType<typeof vi.fn> {
    const promptSpy = vi.fn()
    window.prompt = promptSpy as unknown as typeof window.prompt
    return promptSpy
  }

  it('clicking New Project opens the in-app dialog (and does not call window.prompt)', async () => {
    const promptSpy = pinNoPromptCalls()
    installProjectApi(makePartition({ activeAddress: WALLET_A }))
    render(<ProjectList />)
    await waitFor(() => expect(screen.getByText('No projects yet')).toBeDefined())

    const newProjectBtn = screen.getByText('New Project')
    fireEvent.click(newProjectBtn)

    await waitFor(() => {
      expect(screen.getByTestId('new-project-dialog')).toBeDefined()
    })
    const dialog = screen.getByTestId('new-project-dialog')
    expect(dialog.getAttribute('role')).toBe('dialog')
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(screen.getByTestId('new-project-name-input')).toBeDefined()
    expect(screen.getByTestId('new-project-submit')).toBeDefined()
    expect(screen.getByTestId('new-project-cancel')).toBeDefined()
    expect(promptSpy).not.toHaveBeenCalled()
  })

  it('blocks an empty/whitespace-only name with a visible validation message', async () => {
    pinNoPromptCalls()
    const { create } = installProjectApi(makePartition({ activeAddress: WALLET_A }))
    render(<ProjectList />)
    await waitFor(() => expect(screen.getByText('No projects yet')).toBeDefined())
    fireEvent.click(screen.getByText('New Project'))
    await screen.findByTestId('new-project-dialog')

    // Empty submit
    fireEvent.click(screen.getByTestId('new-project-submit'))
    await waitFor(() => {
      expect(screen.getByTestId('new-project-validation')).toBeDefined()
    })
    expect(screen.getByTestId('new-project-validation').textContent).toMatch(/project name/i)
    expect(create).not.toHaveBeenCalled()
    // Dialog stays open so the user can correct the input.
    expect(screen.getByTestId('new-project-dialog')).toBeDefined()

    // Whitespace-only submit — still blocked.
    const input = screen.getByTestId('new-project-name-input') as HTMLInputElement
    fireEvent.change(input, { target: { value: '   ' } })
    fireEvent.click(screen.getByTestId('new-project-submit'))
    await waitFor(() => {
      expect(screen.getByTestId('new-project-validation')).toBeDefined()
    })
    expect(create).not.toHaveBeenCalled()
  })

  it('valid submit calls project.create(trimmedName), closes the dialog, and refreshes the list', async () => {
    pinNoPromptCalls()
    let discoverCalls = 0
    // First discover (initial mount): no projects. Second discover (after
    // create): the newly-created project appears, simulating the refresh.
    const partitionEmpty = makePartition({ activeAddress: WALLET_A })
    const partitionAfter = makePartition({
      owned: [
        {
          id: 'proj_1',
          path: '/tmp/projects/new-story',
          meta: {
            name: 'New Story',
            version: 1,
            createdAt: '2026-05-24T00:00:00.000Z',
            updatedAt: '2026-05-24T00:00:00.000Z',
            wallet: { address: WALLET_A, source: 'plottoon-writer' }
          },
          error: null
        }
      ],
      activeAddress: WALLET_A
    })
    const discover = vi.fn(async () => {
      discoverCalls += 1
      return discoverCalls === 1 ? partitionEmpty : partitionAfter
    })
    const create = vi.fn(async () => ({
      id: 'proj_1',
      path: '/tmp/projects/new-story',
      meta: {
        name: 'New Story',
        version: 1,
        createdAt: '2026-05-24T00:00:00.000Z',
        updatedAt: '2026-05-24T00:00:00.000Z'
      }
    }))
    const api: PlottoonProject = {
      discover,
      readMeta: vi.fn(),
      writeMeta: vi.fn(),
      create,
      assignToActiveWallet: vi.fn(),
      setProjectsDir: vi.fn(),
      getProjectsDir: vi.fn(),
      detectClis: vi.fn()
    }
    ;(window as unknown as { plottoon: { project: PlottoonProject } }).plottoon = { project: api }

    render(<ProjectList />)
    await waitFor(() => expect(screen.getByText('No projects yet')).toBeDefined())
    fireEvent.click(screen.getByText('New Project'))
    await screen.findByTestId('new-project-dialog')

    // Whitespace around the name is trimmed before calling create.
    const input = screen.getByTestId('new-project-name-input') as HTMLInputElement
    fireEvent.change(input, { target: { value: '  New Story  ' } })
    fireEvent.click(screen.getByTestId('new-project-submit'))

    await waitFor(() => {
      expect(create).toHaveBeenCalledWith('New Story')
    })
    // Dialog closes after a successful create.
    await waitFor(() => {
      expect(screen.queryByTestId('new-project-dialog')).toBeNull()
    })
    // List refreshes — the new project surfaces in the owned grid.
    await waitFor(() => {
      expect(screen.getByText('New Story')).toBeDefined()
    })
    expect(discover).toHaveBeenCalledTimes(2)
  })

  it('shows the create error inside the dialog when project.create throws (no list refresh)', async () => {
    pinNoPromptCalls()
    const partition = makePartition({ activeAddress: WALLET_A })
    const discover = vi.fn(async () => partition)
    const create = vi.fn(async () => {
      throw new Error('Project name must contain at least one alphanumeric character')
    })
    const api: PlottoonProject = {
      discover,
      readMeta: vi.fn(),
      writeMeta: vi.fn(),
      create,
      assignToActiveWallet: vi.fn(),
      setProjectsDir: vi.fn(),
      getProjectsDir: vi.fn(),
      detectClis: vi.fn()
    }
    ;(window as unknown as { plottoon: { project: PlottoonProject } }).plottoon = { project: api }

    render(<ProjectList />)
    await waitFor(() => expect(screen.getByText('No projects yet')).toBeDefined())
    fireEvent.click(screen.getByText('New Project'))
    await screen.findByTestId('new-project-dialog')

    const input = screen.getByTestId('new-project-name-input') as HTMLInputElement
    fireEvent.change(input, { target: { value: '!!!' } })
    fireEvent.click(screen.getByTestId('new-project-submit'))

    // Create error surfaces inside the dialog, dialog stays open so the
    // user can correct the input without losing their typed value.
    await waitFor(() => {
      expect(screen.getByTestId('new-project-submit-error')).toBeDefined()
    })
    expect(screen.getByTestId('new-project-submit-error').textContent).toMatch(
      /alphanumeric character/
    )
    expect(screen.getByTestId('new-project-dialog')).toBeDefined()
    // The list was NOT refreshed because create failed (only the initial
    // discover ran).
    expect(discover).toHaveBeenCalledTimes(1)
    // Input retains the user's value so they can fix it.
    expect((screen.getByTestId('new-project-name-input') as HTMLInputElement).value).toBe('!!!')
  })

  it('Cancel closes the dialog without calling project.create', async () => {
    pinNoPromptCalls()
    const { create } = installProjectApi(makePartition({ activeAddress: WALLET_A }))
    render(<ProjectList />)
    await waitFor(() => expect(screen.getByText('No projects yet')).toBeDefined())
    fireEvent.click(screen.getByText('New Project'))
    await screen.findByTestId('new-project-dialog')

    fireEvent.click(screen.getByTestId('new-project-cancel'))

    await waitFor(() => {
      expect(screen.queryByTestId('new-project-dialog')).toBeNull()
    })
    expect(create).not.toHaveBeenCalled()
  })

  it('does not render the dialog initially', async () => {
    installProjectApi(makePartition({ activeAddress: WALLET_A }))
    render(<ProjectList />)
    await waitFor(() => expect(screen.getByText('No projects yet')).toBeDefined())
    expect(screen.queryByTestId('new-project-dialog')).toBeNull()
  })
})

describe('#269 first-run workspace explainer', () => {
  it('renders the workspace explainer banner when no projects dir is configured (getProjectsDir → null)', async () => {
    installProjectApi(makePartition({ activeAddress: WALLET_A }), {
      getProjectsDir: vi.fn(async () => null)
    })
    render(<ProjectList />)
    await waitFor(() => expect(screen.getByText('No projects yet')).toBeDefined())
    fireEvent.click(screen.getByText('New Project'))
    const explainer = await screen.findByTestId('new-project-workspace-explainer')
    // Copy explicitly mentions the workspace + that the project folder
    // is created INSIDE it — the contract the ticket calls out.
    expect(explainer.textContent).toMatch(/workspace folder/i)
    expect(explainer.textContent).toMatch(/inside it/i)
    expect(explainer.textContent).toMatch(/PlotToon will store all your webtoon projects/i)
  })

  it('does NOT render the explainer when a projects dir is already configured', async () => {
    installProjectApi(makePartition({ activeAddress: WALLET_A }), {
      getProjectsDir: vi.fn(async () => '/Users/fake/PlotToon')
    })
    render(<ProjectList />)
    await waitFor(() => expect(screen.getByText('No projects yet')).toBeDefined())
    fireEvent.click(screen.getByText('New Project'))
    await screen.findByTestId('new-project-dialog')
    // Give the getProjectsDir load + state update a chance to settle
    // before asserting absence.
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(screen.queryByTestId('new-project-workspace-explainer')).toBeNull()
  })

  it('treats a failed getProjectsDir read as first-run (shows the explainer as a safe default)', async () => {
    installProjectApi(makePartition({ activeAddress: WALLET_A }), {
      getProjectsDir: vi.fn(async () => {
        throw new Error('mock fs error reading projects-dir config')
      })
    })
    render(<ProjectList />)
    await waitFor(() => expect(screen.getByText('No projects yet')).toBeDefined())
    fireEvent.click(screen.getByText('New Project'))
    const explainer = await screen.findByTestId('new-project-workspace-explainer')
    expect(explainer.textContent).toMatch(/workspace folder/i)
  })

  it('cancelling project.create (user backed out of folder picker) closes the dialog without leaving it spinning', async () => {
    // Pre-#269 the dialog already handled this (project:create returns
    // null on cancel). The test pins the post-#269 surface still
    // closes cleanly when the in-app explainer is showing — so the
    // explainer banner doesn't accidentally trap focus or keep the
    // dialog open. We pass `create` as an override so the test mock
    // returns null (user cancelled the native picker) AND capture
    // the same reference so the call assertion fires.
    const cancelCreate = vi.fn(async () => null)
    installProjectApi(makePartition({ activeAddress: WALLET_A }), {
      getProjectsDir: vi.fn(async () => null),
      create: cancelCreate
    })
    render(<ProjectList />)
    await waitFor(() => expect(screen.getByText('No projects yet')).toBeDefined())
    fireEvent.click(screen.getByText('New Project'))
    await screen.findByTestId('new-project-workspace-explainer')

    const input = screen.getByTestId('new-project-name-input') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'My First Toon' } })
    fireEvent.click(screen.getByTestId('new-project-submit'))

    await waitFor(() => {
      expect(cancelCreate).toHaveBeenCalledWith('My First Toon')
    })
    // Dialog closed cleanly even though the user cancelled the picker.
    await waitFor(() => {
      expect(screen.queryByTestId('new-project-dialog')).toBeNull()
    })
  })
})
