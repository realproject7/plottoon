// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { EditorCanvas } from '../EditorCanvas'
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
      resolveProjectFilePath: vi.fn().mockResolvedValue('/mock/path'),
      readAppConfig: vi.fn(),
      writeAppConfig: vi.fn(),
      importCleanImage: vi.fn(),
      detectCleanImages: vi.fn(),
      registerAgentFile: vi.fn()
    },
    project: {} as never,
    capability: {} as never,
    actionLog: {} as never
  }
})

afterEach(cleanup)

describe('EditorCanvas', () => {
  it('shows empty state when no cut is selected', () => {
    const onSelect = vi.fn()
    const { getByTestId } = render(
      <EditorCanvas
        cut={null}
        projectId="proj_1"
        selectedOverlayId={null}
        onSelectOverlay={onSelect}
      />
    )
    expect(getByTestId('editor-empty')).toBeTruthy()
    // #279: updated empty-state copy points the user at the cut list
    // and explains where agent-generated images land.
    expect(getByTestId('editor-empty').textContent).toMatch(/Select a cut from the list/)
  })

  it('renders canvas with default dimensions when no canvasOverrides', () => {
    const cut: Cut = { id: 'cut-001' }
    const onSelect = vi.fn()
    const { getByTestId } = render(
      <EditorCanvas
        cut={cut}
        projectId="proj_1"
        selectedOverlayId={null}
        onSelectOverlay={onSelect}
      />
    )
    const canvas = getByTestId('editor-canvas')
    expect(canvas.getAttribute('data-canvas-width')).toBe('320')
    expect(canvas.getAttribute('data-canvas-height')).toBe('480')
  })

  it('renders canvas with custom dimensions from canvasOverrides', () => {
    const cut: Cut = {
      id: 'cut-001',
      canvasOverrides: { width: 800, height: 1200 }
    }
    const onSelect = vi.fn()
    const { getByTestId } = render(
      <EditorCanvas
        cut={cut}
        projectId="proj_1"
        selectedOverlayId={null}
        onSelectOverlay={onSelect}
      />
    )
    const canvas = getByTestId('editor-canvas')
    expect(canvas.getAttribute('data-canvas-width')).toBe('800')
    expect(canvas.getAttribute('data-canvas-height')).toBe('1200')
  })

  it('renders overlays at their canvas-relative coordinates', () => {
    const cut: Cut = {
      id: 'cut-001',
      overlays: [
        { id: 'ovl-1', type: 'text', content: 'Hello!', x: 50, y: 100, width: 200, height: 40 },
        { id: 'ovl-2', type: 'sfx', content: 'BOOM', x: 10, y: 300, width: 150, height: 30 }
      ]
    }
    const onSelect = vi.fn()
    const { getByTestId } = render(
      <EditorCanvas
        cut={cut}
        projectId="proj_1"
        selectedOverlayId={null}
        onSelectOverlay={onSelect}
      />
    )
    const ovl1 = getByTestId('overlay-ovl-1')
    expect(ovl1.style.left).toBe('50px')
    expect(ovl1.style.top).toBe('100px')
    expect(ovl1.style.width).toBe('200px')
    expect(ovl1.style.height).toBe('40px')
    expect(ovl1.textContent).toContain('Hello!')

    const ovl2 = getByTestId('overlay-ovl-2')
    expect(ovl2.style.left).toBe('10px')
    expect(ovl2.style.top).toBe('300px')
  })

  it('selects overlay on click', () => {
    const cut: Cut = {
      id: 'cut-001',
      overlays: [
        { id: 'ovl-1', type: 'text', content: 'Hello!', x: 50, y: 100, width: 200, height: 40 }
      ]
    }
    const onSelect = vi.fn()
    const { getByTestId } = render(
      <EditorCanvas
        cut={cut}
        projectId="proj_1"
        selectedOverlayId={null}
        onSelectOverlay={onSelect}
      />
    )
    fireEvent.click(getByTestId('overlay-ovl-1'))
    expect(onSelect).toHaveBeenCalledWith('ovl-1')
  })

  it('deselects overlay on canvas background click', () => {
    const cut: Cut = {
      id: 'cut-001',
      overlays: [
        { id: 'ovl-1', type: 'text', content: 'Hello!', x: 50, y: 100, width: 200, height: 40 }
      ]
    }
    const onSelect = vi.fn()
    const { getByTestId } = render(
      <EditorCanvas
        cut={cut}
        projectId="proj_1"
        selectedOverlayId="ovl-1"
        onSelectOverlay={onSelect}
      />
    )
    fireEvent.click(getByTestId('editor-canvas'))
    expect(onSelect).toHaveBeenCalledWith(null)
  })

  it('marks selected overlay with data-selected attribute', () => {
    const cut: Cut = {
      id: 'cut-001',
      overlays: [
        { id: 'ovl-1', type: 'text', content: 'A', x: 0, y: 0, width: 100, height: 30 },
        { id: 'ovl-2', type: 'text', content: 'B', x: 0, y: 50, width: 100, height: 30 }
      ]
    }
    const onSelect = vi.fn()
    const { getByTestId } = render(
      <EditorCanvas
        cut={cut}
        projectId="proj_1"
        selectedOverlayId="ovl-1"
        onSelectOverlay={onSelect}
      />
    )
    expect(getByTestId('overlay-ovl-1').getAttribute('data-selected')).toBe('true')
    expect(getByTestId('overlay-ovl-2').getAttribute('data-selected')).toBe('false')
  })

  it('shows blank indicator when no image is set', () => {
    const cut: Cut = { id: 'cut-001' }
    const onSelect = vi.fn()
    const { getByTestId } = render(
      <EditorCanvas
        cut={cut}
        projectId="proj_1"
        selectedOverlayId={null}
        onSelectOverlay={onSelect}
      />
    )
    expect(getByTestId('editor-blank')).toBeTruthy()
    // #279: copy updated from "No image" to "Clean image pending" so
    // the empty state matches the workflow-guide step name.
    expect(getByTestId('editor-blank').textContent).toMatch(/Clean image pending/)
    expect(getByTestId('editor-blank').textContent).toContain('320 x 480')
  })

  it('loads background image when cut has done imageState', async () => {
    ;(window.plottoon.fs.projectFileExists as ReturnType<typeof vi.fn>).mockResolvedValue(true)
    ;(window.plottoon.fs.resolveProjectFilePath as ReturnType<typeof vi.fn>).mockResolvedValue(
      '/home/user/project/assets/cut-001/clean.webp'
    )
    const cut: Cut = {
      id: 'cut-001',
      imageState: { status: 'done', path: 'assets/cut-001/clean.webp' }
    }
    const onSelect = vi.fn()
    const { getByTestId } = render(
      <EditorCanvas
        cut={cut}
        projectId="proj_1"
        selectedOverlayId={null}
        onSelectOverlay={onSelect}
      />
    )
    await waitFor(() => {
      expect(getByTestId('editor-bg-image')).toBeTruthy()
      const img = getByTestId('editor-bg-image') as HTMLImageElement
      expect(img.src).toContain('file://')
    })
  })

  it('coordinates persist relative to canvas across re-renders', () => {
    const cut: Cut = {
      id: 'cut-001',
      canvasOverrides: { width: 600, height: 900 },
      overlays: [
        { id: 'ovl-1', type: 'text', content: 'Test', x: 150, y: 250, width: 180, height: 35 }
      ]
    }
    const onSelect = vi.fn()
    const { getByTestId, rerender } = render(
      <EditorCanvas
        cut={cut}
        projectId="proj_1"
        selectedOverlayId={null}
        onSelectOverlay={onSelect}
      />
    )

    // Verify initial coordinates
    let ovl = getByTestId('overlay-ovl-1')
    expect(ovl.style.left).toBe('150px')
    expect(ovl.style.top).toBe('250px')

    // Re-render with same cut — coordinates should persist
    rerender(
      <EditorCanvas
        cut={cut}
        projectId="proj_1"
        selectedOverlayId="ovl-1"
        onSelectOverlay={onSelect}
      />
    )
    ovl = getByTestId('overlay-ovl-1')
    expect(ovl.style.left).toBe('150px')
    expect(ovl.style.top).toBe('250px')
    expect(ovl.getAttribute('data-selected')).toBe('true')
  })

  it('applies overlay preset styles to rendered overlays', () => {
    const cut: Cut = {
      id: 'cut-001',
      overlays: [
        {
          id: 'ovl-narr',
          type: 'text',
          content: 'Narration',
          x: 10,
          y: 10,
          width: 200,
          height: 50,
          style: { background: '#fffde6', fontWeight: 'bold' }
        },
        {
          id: 'ovl-sfx',
          type: 'sfx',
          content: 'BOOM',
          x: 50,
          y: 200,
          width: 120,
          height: 45,
          style: { color: '#e53e3e', fontSize: '18px' }
        }
      ]
    }
    const onSelect = vi.fn()
    const { getByTestId } = render(
      <EditorCanvas
        cut={cut}
        projectId="proj_1"
        selectedOverlayId={null}
        onSelectOverlay={onSelect}
      />
    )
    const narr = getByTestId('overlay-ovl-narr')
    expect(narr.style.background).toContain('255, 253, 230')
    expect(narr.style.fontWeight).toBe('bold')

    const sfx = getByTestId('overlay-ovl-sfx')
    expect(sfx.style.color).toContain('229, 62, 62')
    expect(sfx.style.fontSize).toBe('18px')
  })

  it('shows selection outline without overriding preset styles', () => {
    const cut: Cut = {
      id: 'cut-001',
      overlays: [
        {
          id: 'ovl-1',
          type: 'text',
          content: 'Hi',
          x: 0,
          y: 0,
          width: 100,
          height: 40,
          style: { background: '#ffffff', border: '2px solid #222222' }
        }
      ]
    }
    const onSelect = vi.fn()
    const { getByTestId } = render(
      <EditorCanvas
        cut={cut}
        projectId="proj_1"
        selectedOverlayId="ovl-1"
        onSelectOverlay={onSelect}
      />
    )
    const ovl = getByTestId('overlay-ovl-1')
    // Preset border should be applied
    expect(ovl.style.border).toContain('2px solid')
    // Selection uses outline instead of border
    expect(ovl.style.outline).toContain('2px solid')
  })
})
