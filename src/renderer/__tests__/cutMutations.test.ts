import { describe, it, expect } from 'vitest'
import {
  addCut,
  deleteCut,
  duplicateCut,
  moveCut,
  setStatus,
  isProtected,
  canTransition
} from '../cutMutations'
import type { Cut } from '../CutList'

function makeCut(id: string, status?: string): Cut {
  return { id, status, direction: `dir-${id}` }
}

describe('cutMutations', () => {
  describe('addCut', () => {
    it('appends a new planned cut when no afterId', () => {
      const cuts = [makeCut('cut-001')]
      const result = addCut(cuts)
      expect(result).toHaveLength(2)
      expect(result[1].id).toBe('cut-002')
      expect(result[1].status).toBe('planned')
    })

    it('inserts after the specified cut', () => {
      const cuts = [makeCut('cut-001'), makeCut('cut-002')]
      const result = addCut(cuts, 'cut-001')
      expect(result).toHaveLength(3)
      expect(result[1].id).toBe('cut-003')
    })

    it('appends if afterId not found', () => {
      const cuts = [makeCut('cut-001')]
      const result = addCut(cuts, 'nonexistent')
      expect(result).toHaveLength(2)
      expect(result[1].id).toBe('cut-002')
    })

    it('generates unique ID after deletion (sparse list)', () => {
      const cuts = [makeCut('cut-001'), makeCut('cut-003')]
      const result = addCut(cuts)
      expect(result).toHaveLength(3)
      expect(result[2].id).toBe('cut-004')
    })
  })

  describe('deleteCut', () => {
    it('removes the specified cut', () => {
      const cuts = [makeCut('cut-001'), makeCut('cut-002')]
      const result = deleteCut(cuts, 'cut-001')
      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('cut-002')
    })

    it('refuses to delete a protected cut', () => {
      const cuts = [makeCut('cut-001', 'exported')]
      const result = deleteCut(cuts, 'cut-001')
      expect(result).toHaveLength(1)
    })

    it('returns same array if cutId not found', () => {
      const cuts = [makeCut('cut-001')]
      const result = deleteCut(cuts, 'nonexistent')
      expect(result).toBe(cuts)
    })
  })

  describe('duplicateCut', () => {
    it('duplicates a cut with planned status and no imageState', () => {
      const cuts = [makeCut('cut-001', 'draft')]
      cuts[0].imageState = { status: 'done', path: '/img.webp' }
      const result = duplicateCut(cuts, 'cut-001')
      expect(result).toHaveLength(2)
      expect(result[1].status).toBe('planned')
      expect(result[1].direction).toBe('dir-cut-001')
      expect(result[1].imageState).toBeUndefined()
    })

    it('generates unique ID from max suffix after deletion', () => {
      const cuts = [makeCut('cut-001'), makeCut('cut-005')]
      const result = duplicateCut(cuts, 'cut-001')
      expect(result).toHaveLength(3)
      expect(result[1].id).toBe('cut-006')
    })

    it('returns same array if cutId not found', () => {
      const cuts = [makeCut('cut-001')]
      const result = duplicateCut(cuts, 'nonexistent')
      expect(result).toBe(cuts)
    })
  })

  describe('moveCut', () => {
    it('moves a cut up', () => {
      const cuts = [makeCut('cut-001'), makeCut('cut-002')]
      const result = moveCut(cuts, 'cut-002', 'up')
      expect(result[0].id).toBe('cut-002')
      expect(result[1].id).toBe('cut-001')
    })

    it('moves a cut down', () => {
      const cuts = [makeCut('cut-001'), makeCut('cut-002')]
      const result = moveCut(cuts, 'cut-001', 'down')
      expect(result[0].id).toBe('cut-002')
      expect(result[1].id).toBe('cut-001')
    })

    it('does nothing when already at boundary', () => {
      const cuts = [makeCut('cut-001'), makeCut('cut-002')]
      const result = moveCut(cuts, 'cut-001', 'up')
      expect(result[0].id).toBe('cut-001')
    })

    it('returns same array if cutId not found', () => {
      const cuts = [makeCut('cut-001')]
      const result = moveCut(cuts, 'nonexistent', 'up')
      expect(result).toBe(cuts)
    })
  })

  describe('setStatus', () => {
    it('transitions planned → draft', () => {
      const cuts = [makeCut('cut-001', 'planned')]
      const result = setStatus(cuts, 'cut-001', 'draft')
      expect(result[0].status).toBe('draft')
    })

    it('transitions draft → approved', () => {
      const cuts = [makeCut('cut-001', 'draft')]
      const result = setStatus(cuts, 'cut-001', 'approved')
      expect(result[0].status).toBe('approved')
    })

    it('transitions draft → needs_revision', () => {
      const cuts = [makeCut('cut-001', 'draft')]
      const result = setStatus(cuts, 'cut-001', 'needs_revision')
      expect(result[0].status).toBe('needs_revision')
    })

    it('transitions needs_revision → draft', () => {
      const cuts = [makeCut('cut-001', 'needs_revision')]
      const result = setStatus(cuts, 'cut-001', 'draft')
      expect(result[0].status).toBe('draft')
    })

    it('transitions approved → needs_revision', () => {
      const cuts = [makeCut('cut-001', 'approved')]
      const result = setStatus(cuts, 'cut-001', 'needs_revision')
      expect(result[0].status).toBe('needs_revision')
    })

    it('rejects invalid transitions', () => {
      const cuts = [makeCut('cut-001', 'planned')]
      const result = setStatus(cuts, 'cut-001', 'approved')
      expect(result[0].status).toBe('planned')
    })

    it('refuses to change status of protected cuts', () => {
      const cuts = [makeCut('cut-001', 'exported')]
      const result = setStatus(cuts, 'cut-001', 'draft')
      expect(result[0].status).toBe('exported')
    })

    it('treats undefined status as planned', () => {
      const cuts = [makeCut('cut-001')]
      const result = setStatus(cuts, 'cut-001', 'draft')
      expect(result[0].status).toBe('draft')
    })
  })

  describe('isProtected', () => {
    it.each(['exported', 'uploaded', 'published'])('returns true for %s', (status) => {
      expect(isProtected(makeCut('c', status))).toBe(true)
    })

    it.each(['planned', 'draft', 'needs_revision', 'approved', undefined])(
      'returns false for %s',
      (status) => {
        expect(isProtected(makeCut('c', status))).toBe(false)
      }
    )
  })

  describe('canTransition', () => {
    it('allows planned → draft', () => expect(canTransition('planned', 'draft')).toBe(true))
    it('blocks planned → approved', () => expect(canTransition('planned', 'approved')).toBe(false))
    it('allows draft → approved', () => expect(canTransition('draft', 'approved')).toBe(true))
    it('allows draft → needs_revision', () =>
      expect(canTransition('draft', 'needs_revision')).toBe(true))
    it('blocks approved → draft', () => expect(canTransition('approved', 'draft')).toBe(false))
  })
})
