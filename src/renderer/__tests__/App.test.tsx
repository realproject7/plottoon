// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import App from '../App'

const mockDiscover = vi.fn<() => Promise<DiscoveredProject[]>>()

beforeEach(() => {
  mockDiscover.mockResolvedValue([])
  window.plottoon = {
    version: '42.0.0',
    terminal: {
      create: vi.fn(),
      getSession: vi.fn(),
      findByProject: vi.fn().mockResolvedValue(null),
      connect: vi.fn(),
      write: vi.fn(),
      disconnect: vi.fn(),
      restart: vi.fn(),
      destroy: vi.fn(),
      onData: vi.fn().mockReturnValue(() => {}),
      onExit: vi.fn().mockReturnValue(() => {})
    } as unknown as PlottoonTerminal,
    fs: {
      openProject: vi.fn(),
      listProjects: vi.fn().mockResolvedValue([]),
      readProjectFile: vi.fn().mockResolvedValue(''),
      writeProjectFile: vi.fn().mockResolvedValue(undefined),
      writeProjectFileBinary: vi.fn(),
      regeneratePlotText: vi.fn().mockResolvedValue(undefined),
      listProjectDir: vi.fn().mockResolvedValue([]),
      projectFileExists: vi.fn().mockResolvedValue(false),
      resolveProjectFilePath: vi.fn().mockResolvedValue('/mock/path'),
      readAppConfig: vi.fn(),
      writeAppConfig: vi.fn()
    },
    project: {
      // `mockDiscover` keeps its historical flat-array shape so existing
      // test assertions don't change; the wrapper partitions into the
      // shape the post-#220 ProjectList expects (everything owned by the
      // single fake active wallet).
      discover: async () => {
        const projects = await mockDiscover()
        return {
          owned: projects.filter((p) => !p.error),
          legacy: [],
          otherWallets: [],
          errors: projects.filter((p) => p.error),
          activeAddress: '0xaaaa000000000000000000000000000000000001'
        }
      },
      readMeta: vi.fn(),
      writeMeta: vi.fn(),
      create: vi.fn(),
      assignToActiveWallet: vi.fn(),
      setProjectsDir: vi.fn(),
      getProjectsDir: vi.fn(),
      detectClis: vi.fn()
    },
    capability: {
      getReport: vi.fn<() => Promise<FirstRunReport>>().mockResolvedValue({
        generatedAt: '2026-01-01T00:00:00Z',
        sections: [
          {
            title: 'CLI Tools',
            checks: [
              { id: 'cli-claude', label: 'Claude CLI', status: 'pass', detail: 'Detected: v1.0' },
              {
                id: 'cli-codex',
                label: 'Codex CLI',
                status: 'fail',
                detail: 'codex not found in PATH'
              }
            ]
          },
          {
            title: 'Local Capabilities',
            checks: [
              {
                id: 'write-access',
                label: 'Project write access',
                status: 'pass',
                detail: 'Filesystem is writable'
              },
              {
                id: 'image-import',
                label: 'Manual image import',
                status: 'pass',
                detail: 'Manual clean image import is always available'
              },
              {
                id: 'export',
                label: 'Export support',
                status: 'pass',
                detail: 'Local export is available'
              }
            ]
          },
          {
            title: 'Advanced Backends',
            checks: [
              {
                id: 'atlascloud-guidance',
                label: 'AtlasCloud guidance',
                status: 'info',
                detail:
                  'AtlasCloud backend guidance is not configured. PlotToon does not store API keys — enable it in your Claude/Codex environment.'
              }
            ]
          },
          {
            title: 'Integrations',
            checks: [
              {
                id: 'plotlink-endpoint',
                label: 'PlotLink endpoint',
                status: 'info',
                detail: 'PlotLink endpoint is a placeholder'
              },
              {
                id: 'wallet',
                label: 'Wallet',
                status: 'info',
                detail: 'Wallet integration is a placeholder'
              }
            ]
          },
          {
            title: 'Publishing',
            checks: [
              {
                id: 'publish-ready',
                label: 'Publish features',
                status: 'fail',
                detail: 'Publish is disabled until required checks pass'
              }
            ]
          }
        ]
      })
    },
    actionLog: {
      log: vi.fn(),
      get: vi.fn().mockResolvedValue([])
    },
    wallet: {
      getOptions: vi.fn().mockResolvedValue({ options: [] }),
      connect: vi.fn().mockResolvedValue({ success: true }),
      getConnected: vi.fn().mockResolvedValue({ connected: false }),
      disconnect: vi.fn().mockResolvedValue({ success: true }),
      getSignerMode: vi.fn().mockResolvedValue({ mode: 'mock' }),
      listIdentities: vi.fn().mockResolvedValue({ identities: [] }),
      getActiveIdentity: vi.fn().mockResolvedValue({ identity: null }),
      setActiveIdentity: vi.fn().mockResolvedValue({ identity: null })
    },
    dashboard: {
      getData: vi.fn().mockResolvedValue({
        counts: {
          totalProjects: 0,
          totalPlots: 0,
          publishedPlots: 0,
          pendingPlots: 0,
          notIndexedPlots: 0,
          failedPlots: 0
        },
        storylines: [],
        localGroups: [],
        wallet: {
          address: null,
          source: null,
          connected: false,
          balanceWei: null,
          balanceError: null
        },
        tokenPrice: { ethUsd: null, error: null },
        royalty: { earnedWei: null, claimedWei: null, unclaimedWei: null, error: null },
        generatedAt: '2026-05-18T00:00:00Z'
      })
    },
    royalty: {
      getInfo: vi.fn().mockResolvedValue({ info: null, error: null }),
      claim: vi.fn().mockResolvedValue({ success: false, error: 'Not configured' }),
      getClaimHistory: vi.fn().mockResolvedValue({ claims: [] }),
      onProgress: vi.fn().mockReturnValue(() => {})
    }
  }
})

afterEach(cleanup)

describe('App', () => {
  it('renders the PlotToon shell with sidebar branding', async () => {
    render(<App />)
    await waitFor(() => {
      // The wordmark splits "Plot" and "Toon" across spans so the accent half
      // can render in `--accent`; match by the joined textContent of the
      // brand element rather than a single text node.
      const brand = document.querySelector('.app-shell__brand')
      expect(brand?.textContent).toBe('PlotToon')
    })
  })

  it('renders the project list heading and nav', async () => {
    render(<App />)
    await waitFor(() => {
      const matches = screen.getAllByText('Projects')
      expect(matches.length).toBe(2)
    })
  })

  it('shows empty state when no projects discovered', async () => {
    render(<App />)
    await waitFor(() => {
      expect(screen.getByText('No projects yet')).toBeDefined()
      expect(screen.getByRole('button', { name: 'New Project' })).toBeDefined()
    })
  })

  it('shows project cards when projects are discovered', async () => {
    mockDiscover.mockResolvedValue([
      {
        id: 'proj_1',
        path: '/home/user/my-webtoon',
        meta: {
          name: 'My Webtoon',
          version: 1,
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
          description: 'A cool story'
        },
        error: null
      }
    ])
    render(<App />)
    await waitFor(() => {
      expect(screen.getByText('My Webtoon')).toBeDefined()
      expect(screen.getByText('A cool story')).toBeDefined()
    })
  })

  it('navigates to workspace with layout panels when clicking a project card', async () => {
    mockDiscover.mockResolvedValue([
      {
        id: 'proj_1',
        path: '/home/user/my-webtoon',
        meta: {
          name: 'My Webtoon',
          version: 1,
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
          description: 'A cool story'
        },
        error: null
      }
    ])
    render(<App />)
    await waitFor(() => screen.getByText('My Webtoon'))
    fireEvent.click(screen.getByText('My Webtoon'))
    await waitFor(() => {
      expect(screen.queryByText('No projects yet')).toBeNull()
      expect(document.querySelector('[data-testid="cut-list-panel"]')).toBeTruthy()
      expect(document.querySelector('[data-testid="preview-panel"]')).toBeTruthy()
      expect(document.querySelector('[data-testid="inspector-panel"]')).toBeTruthy()
      expect(document.querySelector('[data-testid="terminal-region"]')).toBeTruthy()
    })
  })

  it('clears the open workspace project and returns to Projects when the active wallet changes (#220)', async () => {
    mockDiscover.mockResolvedValue([
      {
        id: 'proj_1',
        path: '/home/user/my-webtoon',
        meta: {
          name: 'My Webtoon',
          version: 1,
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
          description: 'A cool story'
        },
        error: null
      }
    ])
    render(<App />)
    await waitFor(() => screen.getByText('My Webtoon'))
    fireEvent.click(screen.getByText('My Webtoon'))
    await waitFor(() => {
      expect(document.querySelector('[data-testid="cut-list-panel"]')).toBeTruthy()
    })

    // Wallet switch fires the active-changed event. App must drop the open
    // project and navigate back to Projects so the user can't keep editing
    // a project that may belong to the previously-active wallet.
    window.dispatchEvent(new CustomEvent('plottoon:wallet:active-changed'))

    await waitFor(() => {
      // The workspace's cut-list-panel testid disappears once Workspace is
      // remounted without a projectId (it now renders the empty-state copy).
      expect(document.querySelector('[data-testid="cut-list-panel"]')).toBeNull()
      // We landed back on the Projects view.
      expect(screen.getByText(/Connect a wallet|webtoon projects/i)).toBeDefined()
    })
  })

  it('shows cwd in workspace when terminal session exists', async () => {
    ;(window.plottoon.terminal.findByProject as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'sess_1',
      projectId: 'proj_1',
      cwd: '/home/user/my-webtoon',
      state: 'connected',
      createdAt: '2026-01-01T00:00:00Z',
      exitCode: null
    })
    mockDiscover.mockResolvedValue([
      {
        id: 'proj_1',
        path: '/home/user/my-webtoon',
        meta: {
          name: 'My Webtoon',
          version: 1,
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
          description: 'A cool story'
        },
        error: null
      }
    ])
    render(<App />)
    await waitFor(() => screen.getByText('My Webtoon'))
    fireEvent.click(screen.getByText('My Webtoon'))
    await waitFor(() => {
      expect(screen.getByText(/cwd:/)).toBeDefined()
    })
  })

  it('renders cut list and inspector from mocked cuts.json', async () => {
    ;(window.plottoon.fs.listProjectDir as ReturnType<typeof vi.fn>).mockResolvedValue([
      'chapter-1'
    ])
    ;(window.plottoon.fs.projectFileExists as ReturnType<typeof vi.fn>).mockResolvedValue(true)
    ;(window.plottoon.fs.readProjectFile as ReturnType<typeof vi.fn>).mockResolvedValue(
      JSON.stringify({
        cuts: [
          {
            id: 'cut-001',
            direction: 'Wide shot of the city skyline',
            dialogue: 'Welcome home.',
            imageState: { status: 'done', path: 'plots/chapter-1/assets/cut-001/clean-v001.webp' }
          },
          {
            id: 'cut-002',
            direction: 'Close-up on protagonist',
            narration: 'It had been years.'
          }
        ]
      })
    )
    mockDiscover.mockResolvedValue([
      {
        id: 'proj_1',
        path: '/home/user/my-webtoon',
        meta: {
          name: 'My Webtoon',
          version: 1,
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
          description: 'A cool story'
        },
        error: null
      }
    ])
    render(<App />)
    await waitFor(() => screen.getByText('My Webtoon'))
    fireEvent.click(screen.getByText('My Webtoon'))
    await waitFor(() => {
      expect(screen.getAllByText('chapter-1').length).toBeGreaterThan(0)
      expect(screen.getAllByText('cut-001').length).toBeGreaterThan(0)
      expect(screen.getAllByText('cut-002').length).toBeGreaterThan(0)
    })
    await waitFor(() => {
      expect(screen.getAllByText('Wide shot of the city skyline').length).toBeGreaterThan(0)
      expect(screen.getByText('Welcome home.')).toBeDefined()
    })
  })

  it('changes cut status via inspector status buttons', async () => {
    ;(window.plottoon.fs.listProjectDir as ReturnType<typeof vi.fn>).mockResolvedValue([
      'chapter-1'
    ])
    ;(window.plottoon.fs.projectFileExists as ReturnType<typeof vi.fn>).mockResolvedValue(true)
    ;(window.plottoon.fs.readProjectFile as ReturnType<typeof vi.fn>).mockResolvedValue(
      JSON.stringify({
        cuts: [
          {
            id: 'cut-001',
            status: 'planned',
            direction: 'Wide shot'
          }
        ]
      })
    )
    mockDiscover.mockResolvedValue([
      {
        id: 'proj_1',
        path: '/home/user/my-webtoon',
        meta: {
          name: 'My Webtoon',
          version: 1,
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
          description: 'A cool story'
        },
        error: null
      }
    ])
    render(<App />)
    await waitFor(() => screen.getByText('My Webtoon'))
    fireEvent.click(screen.getByText('My Webtoon'))
    // Wait for cut to load and be selected
    await waitFor(() => {
      expect(screen.getAllByText('cut-001').length).toBeGreaterThan(0)
    })
    // Status should show planned initially; click draft to transition
    const draftBtn = document.querySelector('[data-testid="status-btn-draft"]') as HTMLButtonElement
    expect(draftBtn).toBeTruthy()
    expect(draftBtn.disabled).toBe(false)
    fireEvent.click(draftBtn)
    // writeProjectFile should have been called with updated status
    await waitFor(() => {
      const writeMock = window.plottoon.fs.writeProjectFile as ReturnType<typeof vi.fn>
      expect(writeMock).toHaveBeenCalled()
      const lastCall = writeMock.mock.calls[writeMock.mock.calls.length - 1]
      const written = JSON.parse(lastCall[2])
      expect(written.cuts[0].status).toBe('draft')
    })
  })

  it('clears preview and inspector when switching to a plot with no cuts', async () => {
    let callCount = 0
    ;(window.plottoon.fs.listProjectDir as ReturnType<typeof vi.fn>).mockResolvedValue([
      'chapter-1',
      'chapter-2'
    ])
    ;(window.plottoon.fs.projectFileExists as ReturnType<typeof vi.fn>).mockImplementation(() => {
      callCount++
      // chapter-1 has cuts.json, chapter-2 does not
      return Promise.resolve(callCount <= 1)
    })
    ;(window.plottoon.fs.readProjectFile as ReturnType<typeof vi.fn>).mockResolvedValue(
      JSON.stringify({
        cuts: [
          {
            id: 'cut-001',
            direction: 'Wide shot of the city skyline',
            dialogue: 'Welcome home.'
          }
        ]
      })
    )
    mockDiscover.mockResolvedValue([
      {
        id: 'proj_1',
        path: '/home/user/my-webtoon',
        meta: {
          name: 'My Webtoon',
          version: 1,
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
          description: 'A cool story'
        },
        error: null
      }
    ])
    render(<App />)
    await waitFor(() => screen.getByText('My Webtoon'))
    fireEvent.click(screen.getByText('My Webtoon'))
    // chapter-1 loads with cut-001 visible in inspector
    await waitFor(() => {
      expect(screen.getByText('Welcome home.')).toBeDefined()
    })
    // Switch to chapter-2 (no cuts.json)
    fireEvent.click(screen.getByText('chapter-2'))
    await waitFor(() => {
      expect(screen.queryByText('Welcome home.')).toBeNull()
      expect(screen.getByText('Select a cut to inspect')).toBeDefined()
    })
  })

  it('shows error state for projects with invalid metadata', async () => {
    mockDiscover.mockResolvedValue([
      {
        id: null,
        path: '/home/user/broken',
        meta: null,
        error: 'project.json contains invalid JSON'
      }
    ])
    render(<App />)
    await waitFor(() => {
      expect(screen.getByText('project.json contains invalid JSON')).toBeDefined()
    })
  })

  it('renders workspace nav button', async () => {
    render(<App />)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Workspace' })).toBeDefined()
    })
  })

  it('navigates to workspace when clicking Workspace nav', async () => {
    render(<App />)
    await waitFor(() => screen.getByRole('button', { name: 'Workspace' }))
    fireEvent.click(screen.getByRole('button', { name: 'Workspace' }))
    // #274: copy updated to mention the sidebar + AI-agent context.
    expect(screen.getByText(/Open a project from the sidebar to start editing/)).toBeDefined()
  })

  it('navigates back to projects when clicking Projects nav', async () => {
    render(<App />)
    await waitFor(() => screen.getByRole('button', { name: 'Workspace' }))
    fireEvent.click(screen.getByRole('button', { name: 'Workspace' }))
    fireEvent.click(screen.getByRole('button', { name: 'Projects' }))
    await waitFor(() => expect(screen.getByText('No projects yet')).toBeDefined())
  })

  it('renders Status nav button', async () => {
    render(<App />)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Status' })).toBeDefined()
    })
  })

  it('navigates to capability report when clicking Status', async () => {
    render(<App />)
    await waitFor(() => screen.getByRole('button', { name: 'Status' }))
    fireEvent.click(screen.getByRole('button', { name: 'Status' }))
    await waitFor(() => {
      expect(screen.getByText('Capability Report')).toBeDefined()
    })
  })

  it('renders all capability report sections', async () => {
    render(<App />)
    await waitFor(() => screen.getByRole('button', { name: 'Status' }))
    fireEvent.click(screen.getByRole('button', { name: 'Status' }))
    await waitFor(() => {
      expect(screen.getByText('CLI Tools')).toBeDefined()
      expect(screen.getByText('Local Capabilities')).toBeDefined()
      expect(screen.getByText('Advanced Backends')).toBeDefined()
      expect(screen.getByText('Integrations')).toBeDefined()
      expect(screen.getByText('Publishing')).toBeDefined()
    })
  })

  it('shows AtlasCloud does not store API keys', async () => {
    render(<App />)
    await waitFor(() => screen.getByRole('button', { name: 'Status' }))
    fireEvent.click(screen.getByRole('button', { name: 'Status' }))
    await waitFor(() => {
      expect(screen.getByText(/does not store API keys/)).toBeDefined()
    })
  })

  it('shows publish disabled when checks fail', async () => {
    render(<App />)
    await waitFor(() => screen.getByRole('button', { name: 'Status' }))
    fireEvent.click(screen.getByRole('button', { name: 'Status' }))
    await waitFor(() => {
      expect(screen.getByText(/Publish is disabled/)).toBeDefined()
    })
  })

  it('renders Guides nav button', async () => {
    render(<App />)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Guides' })).toBeDefined()
    })
  })

  it('navigates to AtlasCloud guide when clicking Guides', async () => {
    render(<App />)
    await waitFor(() => screen.getByRole('button', { name: 'Guides' }))
    fireEvent.click(screen.getByRole('button', { name: 'Guides' }))
    expect(screen.getByText('AtlasCloud Backend Guide')).toBeDefined()
  })

  it('guide explains API key lives in user environment', async () => {
    render(<App />)
    await waitFor(() => screen.getByRole('button', { name: 'Guides' }))
    fireEvent.click(screen.getByRole('button', { name: 'Guides' }))
    expect(screen.getByText(/does not store API keys/)).toBeDefined()
    expect(screen.getByText(/Never paste your API key into PlotToon/)).toBeDefined()
  })

  it('guide specifies output path rules', async () => {
    render(<App />)
    await waitFor(() => screen.getByRole('button', { name: 'Guides' }))
    fireEvent.click(screen.getByRole('button', { name: 'Guides' }))
    expect(screen.getByText('plots/{plotId}/assets/{cutId}/clean-vNNN.webp')).toBeDefined()
  })

  it('guide specifies cuts.json update fields', async () => {
    render(<App />)
    await waitFor(() => screen.getByRole('button', { name: 'Guides' }))
    fireEvent.click(screen.getByRole('button', { name: 'Guides' }))
    expect(screen.getByText('imageState.backend')).toBeDefined()
    expect(screen.getByText('imageState.model')).toBeDefined()
    expect(screen.getByText('imageState.attempts')).toBeDefined()
    expect(screen.getAllByText('imageState.revisionNotes').length).toBeGreaterThan(0)
  })

  it('guide warns about batch generation costs', async () => {
    render(<App />)
    await waitFor(() => screen.getByRole('button', { name: 'Guides' }))
    fireEvent.click(screen.getByRole('button', { name: 'Guides' }))
    expect(screen.getByText(/batch or high-volume generation/)).toBeDefined()
  })

  it('guide has no API key input field', async () => {
    render(<App />)
    await waitFor(() => screen.getByRole('button', { name: 'Guides' }))
    fireEvent.click(screen.getByRole('button', { name: 'Guides' }))
    const inputs = screen.queryAllByRole('textbox')
    const keyInputs = inputs.filter(
      (el) =>
        el.getAttribute('name')?.toLowerCase().includes('key') ||
        el.getAttribute('placeholder')?.toLowerCase().includes('key')
    )
    expect(keyInputs).toHaveLength(0)
  })

  it('preserves top-level cuts.json fields on save after status change', async () => {
    ;(window.plottoon.fs.listProjectDir as ReturnType<typeof vi.fn>).mockResolvedValue([
      'chapter-1'
    ])
    ;(window.plottoon.fs.projectFileExists as ReturnType<typeof vi.fn>).mockResolvedValue(true)
    ;(window.plottoon.fs.readProjectFile as ReturnType<typeof vi.fn>).mockResolvedValue(
      JSON.stringify({
        version: 1,
        plotTitle: 'My First Plot',
        synopsis: 'A tale of two cities.',
        cuts: [
          {
            id: 'cut-001',
            status: 'planned',
            direction: 'Wide shot'
          }
        ],
        publishState: {
          published: false,
          exportedAt: '2026-05-10T00:00:00.000Z',
          format: 'webp'
        }
      })
    )
    mockDiscover.mockResolvedValue([
      {
        id: 'proj_1',
        path: '/home/user/my-webtoon',
        meta: {
          name: 'My Webtoon',
          version: 1,
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z'
        },
        error: null
      }
    ])
    render(<App />)
    await waitFor(() => screen.getByText('My Webtoon'))
    fireEvent.click(screen.getByText('My Webtoon'))
    await waitFor(() => {
      expect(screen.getAllByText('cut-001').length).toBeGreaterThan(0)
    })
    const draftBtn = document.querySelector('[data-testid="status-btn-draft"]') as HTMLButtonElement
    expect(draftBtn).toBeTruthy()
    fireEvent.click(draftBtn)
    await waitFor(() => {
      const writeMock = window.plottoon.fs.writeProjectFile as ReturnType<typeof vi.fn>
      expect(writeMock).toHaveBeenCalled()
      const lastCall = writeMock.mock.calls[writeMock.mock.calls.length - 1]
      const written = JSON.parse(lastCall[2])
      expect(written.version).toBe(1)
      expect(written.plotTitle).toBe('My First Plot')
      expect(written.synopsis).toBe('A tale of two cities.')
      expect(written.publishState).toEqual({
        published: false,
        exportedAt: '2026-05-10T00:00:00.000Z',
        format: 'webp'
      })
      expect(written.cuts[0].status).toBe('draft')
    })
  })

  it('defaults envelope when loading legacy cuts.json without top-level fields', async () => {
    ;(window.plottoon.fs.listProjectDir as ReturnType<typeof vi.fn>).mockResolvedValue([
      'chapter-1'
    ])
    ;(window.plottoon.fs.projectFileExists as ReturnType<typeof vi.fn>).mockResolvedValue(true)
    ;(window.plottoon.fs.readProjectFile as ReturnType<typeof vi.fn>).mockResolvedValue(
      JSON.stringify({
        cuts: [{ id: 'cut-001', status: 'planned', direction: 'Wide shot' }]
      })
    )
    mockDiscover.mockResolvedValue([
      {
        id: 'proj_1',
        path: '/home/user/my-webtoon',
        meta: {
          name: 'My Webtoon',
          version: 1,
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z'
        },
        error: null
      }
    ])
    render(<App />)
    await waitFor(() => screen.getByText('My Webtoon'))
    fireEvent.click(screen.getByText('My Webtoon'))
    await waitFor(() => {
      expect(screen.getAllByText('cut-001').length).toBeGreaterThan(0)
    })
    const draftBtn = document.querySelector('[data-testid="status-btn-draft"]') as HTMLButtonElement
    expect(draftBtn).toBeTruthy()
    fireEvent.click(draftBtn)
    await waitFor(() => {
      const writeMock = window.plottoon.fs.writeProjectFile as ReturnType<typeof vi.fn>
      expect(writeMock).toHaveBeenCalled()
      const lastCall = writeMock.mock.calls[writeMock.mock.calls.length - 1]
      const written = JSON.parse(lastCall[2])
      expect(written.version).toBe(1)
      expect(written.plotTitle).toBe('chapter-1')
      expect(written.synopsis).toBe('')
      expect(written.publishState).toEqual({
        published: false,
        exportedAt: null,
        format: null
      })
      expect(written.cuts[0].status).toBe('draft')
    })
  })
})
