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
    fs: {} as PlottoonFs,
    project: {
      discover: mockDiscover,
      readMeta: vi.fn(),
      writeMeta: vi.fn(),
      create: vi.fn(),
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
                  'AtlasCloud backend guidance is not configured. Enable it in your Claude/Codex environment.'
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
    }
  }
})

afterEach(cleanup)

describe('App', () => {
  it('renders the PlotToon shell with sidebar branding', async () => {
    render(<App />)
    await waitFor(() => expect(screen.getByText('PlotToon')).toBeDefined())
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
    expect(screen.getByText('Open a project to start editing.')).toBeDefined()
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
      expect(screen.getByText(/Enable it in your Claude\/Codex environment/)).toBeDefined()
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
})
