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
      getProjectsDir: vi.fn()
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
})
