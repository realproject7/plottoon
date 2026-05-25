// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { AgentImageSyncBadge } from '../AgentImageSyncBadge'

afterEach(cleanup)

describe('#278 AgentImageSyncBadge', () => {
  it('renders nothing when both adopted and rejected lists are empty', () => {
    const { container } = render(
      <AgentImageSyncBadge
        snapshot={{ adopted: [], rejected: [] }}
        onRetry={() => {}}
        onDismiss={() => {}}
      />
    )
    expect(container.firstChild).toBeNull()
  })

  it('surfaces an adopted revision with cut id + zero-padded version', () => {
    render(
      <AgentImageSyncBadge
        snapshot={{
          adopted: [
            {
              cutId: 'cut-001',
              version: 2,
              filename: 'clean-v002.webp',
              relativePath: 'plots/p/assets/cut-001/clean-v002.webp',
              createdAt: '2026-05-25T00:00:00.000Z',
              sizeBytes: 1024
            }
          ],
          rejected: []
        }}
        onRetry={() => {}}
        onDismiss={() => {}}
      />
    )
    const adopted = screen.getByTestId('agent-image-sync-adopted')
    expect(adopted.textContent).toMatch(/Synced 1 agent image:/)
    expect(adopted.textContent).toMatch(/cut-001 v002/)
    expect(screen.queryByTestId('agent-image-sync-rejected')).toBeNull()
  })

  it('surfaces a rejected file with a safe reason (no absolute paths in test fixture)', () => {
    render(
      <AgentImageSyncBadge
        snapshot={{
          adopted: [],
          rejected: [
            {
              cutId: 'cut-001',
              filename: 'clean-v001.bmp',
              reason: 'Filename does not match clean-vNNN.<webp|png|jpg|jpeg>'
            }
          ]
        }}
        onRetry={() => {}}
        onDismiss={() => {}}
      />
    )
    const rejected = screen.getByTestId('agent-image-sync-rejected')
    expect(rejected.textContent).toMatch(/Rejected 1 file/)
    expect(rejected.textContent).toContain('clean-v001.bmp')
    expect(rejected.textContent).toMatch(/clean-vNNN/)
  })

  it('renders Retry + Dismiss actions and fires the provided handlers', () => {
    const onRetry = vi.fn()
    const onDismiss = vi.fn()
    render(
      <AgentImageSyncBadge
        snapshot={{
          adopted: [
            {
              cutId: 'cut-001',
              version: 1,
              filename: 'clean-v001.webp',
              relativePath: 'cut-001/clean-v001.webp',
              createdAt: 't',
              sizeBytes: 1
            }
          ],
          rejected: []
        }}
        onRetry={onRetry}
        onDismiss={onDismiss}
      />
    )
    fireEvent.click(screen.getByTestId('agent-image-sync-retry'))
    fireEvent.click(screen.getByTestId('agent-image-sync-dismiss'))
    expect(onRetry).toHaveBeenCalledTimes(1)
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('renders both adopted and rejected sections together when the run produced a mix', () => {
    render(
      <AgentImageSyncBadge
        snapshot={{
          adopted: [
            {
              cutId: 'cut-001',
              version: 1,
              filename: 'clean-v001.webp',
              relativePath: 'cut-001/clean-v001.webp',
              createdAt: 't',
              sizeBytes: 1
            }
          ],
          rejected: [
            {
              cutId: 'cut-002',
              filename: 'clean-v001.bmp',
              reason: 'Filename does not match clean-vNNN.<webp|png|jpg|jpeg>'
            }
          ]
        }}
        onRetry={() => {}}
        onDismiss={() => {}}
      />
    )
    expect(screen.getByTestId('agent-image-sync-adopted')).toBeDefined()
    expect(screen.getByTestId('agent-image-sync-rejected')).toBeDefined()
  })
})
