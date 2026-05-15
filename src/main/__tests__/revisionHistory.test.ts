import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { ImageState } from '../services/cutsSchema'
import {
  addRevision,
  setCurrentRevision,
  getRevisions,
  getCurrentVersion
} from '../services/revisionHistory'

function baseImageState(): ImageState {
  return {
    status: 'pending',
    path: null,
    prompt: null,
    seed: null
  }
}

function imageStateWithRevisions(): ImageState {
  return {
    status: 'done',
    path: 'plots/ep1/assets/cut-001/clean-v002.webp',
    prompt: null,
    seed: null,
    revisions: [
      {
        version: 1,
        path: 'plots/ep1/assets/cut-001/clean-v001.png',
        createdAt: '2026-05-01T10:00:00.000Z',
        revisionNotes: 'Initial draft'
      },
      {
        version: 2,
        path: 'plots/ep1/assets/cut-001/clean-v002.webp',
        createdAt: '2026-05-02T14:00:00.000Z',
        revisionNotes: 'Adjusted lighting'
      }
    ]
  }
}

describe('addRevision', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-16T12:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('adds first revision to empty imageState', () => {
    const state = baseImageState()
    const result = addRevision(state, { path: 'assets/cut-001/clean.png' })

    expect(result.status).toBe('done')
    expect(result.path).toBe('assets/cut-001/clean.png')
    expect(result.revisions).toHaveLength(1)
    expect(result.revisions![0]).toEqual({
      version: 1,
      path: 'assets/cut-001/clean.png',
      createdAt: '2026-05-16T12:00:00.000Z',
      revisionNotes: undefined
    })
  })

  it('adds revision with notes', () => {
    const state = baseImageState()
    const result = addRevision(state, {
      path: 'assets/cut-001/clean.webp',
      revisionNotes: 'Better color grading'
    })

    expect(result.revisions![0].revisionNotes).toBe('Better color grading')
  })

  it('increments version number from existing revisions', () => {
    const state = imageStateWithRevisions()
    const result = addRevision(state, { path: 'assets/cut-001/clean-v003.webp' })

    expect(result.revisions).toHaveLength(3)
    expect(result.revisions![2].version).toBe(3)
    expect(result.path).toBe('assets/cut-001/clean-v003.webp')
  })

  it('preserves existing revisions', () => {
    const state = imageStateWithRevisions()
    const result = addRevision(state, { path: 'assets/new.png' })

    expect(result.revisions![0].version).toBe(1)
    expect(result.revisions![1].version).toBe(2)
    expect(result.revisions![2].version).toBe(3)
  })

  it('does not mutate the original state', () => {
    const state = imageStateWithRevisions()
    const originalRevCount = state.revisions!.length
    addRevision(state, { path: 'assets/new.png' })

    expect(state.revisions).toHaveLength(originalRevCount)
    expect(state.status).toBe('done')
  })
})

describe('setCurrentRevision', () => {
  it('sets current path to the target revision', () => {
    const state = imageStateWithRevisions()
    const result = setCurrentRevision(state, 1)

    expect(result.path).toBe('plots/ep1/assets/cut-001/clean-v001.png')
    expect(result.status).toBe('done')
  })

  it('keeps revisions unchanged', () => {
    const state = imageStateWithRevisions()
    const result = setCurrentRevision(state, 1)

    expect(result.revisions).toEqual(state.revisions)
  })

  it('throws for non-existent version', () => {
    const state = imageStateWithRevisions()
    expect(() => setCurrentRevision(state, 99)).toThrow('Revision version 99 not found')
  })

  it('does not mutate the original state', () => {
    const state = imageStateWithRevisions()
    const originalPath = state.path
    setCurrentRevision(state, 1)

    expect(state.path).toBe(originalPath)
  })
})

describe('getRevisions', () => {
  it('returns empty array when no revisions', () => {
    expect(getRevisions(baseImageState())).toEqual([])
  })

  it('returns revisions array', () => {
    const state = imageStateWithRevisions()
    expect(getRevisions(state)).toHaveLength(2)
  })
})

describe('getCurrentVersion', () => {
  it('returns null when no path', () => {
    expect(getCurrentVersion(baseImageState())).toBeNull()
  })

  it('returns null when no revisions', () => {
    const state = { ...baseImageState(), path: 'some/path.png' }
    expect(getCurrentVersion(state)).toBeNull()
  })

  it('returns matching version number', () => {
    const state = imageStateWithRevisions()
    expect(getCurrentVersion(state)).toBe(2)
  })

  it('returns null when path does not match any revision', () => {
    const state = {
      ...imageStateWithRevisions(),
      path: 'assets/untracked.png'
    }
    expect(getCurrentVersion(state)).toBeNull()
  })
})
