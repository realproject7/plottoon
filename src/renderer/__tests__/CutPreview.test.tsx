// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, waitFor, cleanup } from '@testing-library/react'
import { CutPreview } from '../CutPreview'
import type { Cut } from '../CutList'
import type { PlottoonTerminal } from '../env'

beforeEach(() => {
  window.plottoon = {
    version: '1.0.0',
    terminal: {} as PlottoonTerminal,
    fs: {
      openProject: vi.fn(),
      listProjects: vi.fn().mockResolvedValue([]),
      readProjectFile: vi.fn().mockResolvedValue(''),
      writeProjectFile: vi.fn(),
      listProjectDir: vi.fn().mockResolvedValue([]),
      projectFileExists: vi.fn().mockResolvedValue(false),
      resolveProjectFilePath: vi.fn().mockResolvedValue('/mock/project/path'),
      readAppConfig: vi.fn(),
      writeAppConfig: vi.fn()
    },
    project: {} as never,
    capability: {} as never,
    actionLog: {} as never
  }
})

afterEach(cleanup)

describe('CutPreview', () => {
  it('shows empty state when no cut is selected', () => {
    const { getByTestId } = render(<CutPreview cut={null} projectId="proj_1" />)
    expect(getByTestId('preview-empty')).toBeTruthy()
    expect(getByTestId('preview-empty').textContent).toContain('Select a cut to preview')
  })

  it('shows blank preview for cut without imageState', () => {
    const cut: Cut = { id: 'cut-001', direction: 'Wide shot' }
    const { getByTestId } = render(<CutPreview cut={cut} projectId="proj_1" />)
    expect(getByTestId('preview-blank')).toBeTruthy()
    expect(getByTestId('preview-blank').textContent).toContain('No image')
    expect(getByTestId('preview-blank').textContent).toContain('320')
  })

  it('shows blank preview for cut with pending imageState', () => {
    const cut: Cut = { id: 'cut-001', imageState: { status: 'pending' } }
    const { getByTestId } = render(<CutPreview cut={cut} projectId="proj_1" />)
    expect(getByTestId('preview-blank')).toBeTruthy()
  })

  it('shows error when asset file does not exist', async () => {
    ;(window.plottoon.fs.projectFileExists as ReturnType<typeof vi.fn>).mockResolvedValue(false)
    const cut: Cut = {
      id: 'cut-001',
      imageState: { status: 'done', path: 'plots/ch1/assets/cut-001/clean.webp' }
    }
    const { getByTestId } = render(<CutPreview cut={cut} projectId="proj_1" />)
    await waitFor(() => {
      expect(getByTestId('preview-error')).toBeTruthy()
      expect(getByTestId('preview-error').textContent).toContain('Asset not found')
    })
  })

  it('loads and displays image when asset exists', async () => {
    ;(window.plottoon.fs.projectFileExists as ReturnType<typeof vi.fn>).mockResolvedValue(true)
    ;(window.plottoon.fs.resolveProjectFilePath as ReturnType<typeof vi.fn>).mockResolvedValue(
      '/home/user/project/plots/ch1/assets/cut-001/clean.webp'
    )
    const cut: Cut = {
      id: 'cut-001',
      direction: 'Wide shot',
      imageState: { status: 'done', path: 'plots/ch1/assets/cut-001/clean.webp' }
    }
    const { getByTestId } = render(<CutPreview cut={cut} projectId="proj_1" />)
    await waitFor(() => {
      expect(getByTestId('preview-image')).toBeTruthy()
      const img = getByTestId('preview-image').querySelector('img')
      expect(img).toBeTruthy()
      expect(img!.src).toContain('file://')
      expect(img!.alt).toBe('Wide shot')
    })
  })

  it('shows error when resolveProjectFilePath fails', async () => {
    ;(window.plottoon.fs.projectFileExists as ReturnType<typeof vi.fn>).mockResolvedValue(true)
    ;(window.plottoon.fs.resolveProjectFilePath as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('Path escape detected')
    )
    const cut: Cut = {
      id: 'cut-001',
      imageState: { status: 'done', path: '../../etc/passwd' }
    }
    const { getByTestId } = render(<CutPreview cut={cut} projectId="proj_1" />)
    await waitFor(() => {
      expect(getByTestId('preview-error')).toBeTruthy()
      expect(getByTestId('preview-error').textContent).toContain('Path escape detected')
    })
  })

  it('shows direction text in blank preview', () => {
    const cut: Cut = { id: 'cut-001', direction: 'Close-up on protagonist face' }
    const { getByTestId } = render(<CutPreview cut={cut} projectId="proj_1" />)
    expect(getByTestId('preview-blank').textContent).toContain('Close-up on protagonist face')
  })
})
