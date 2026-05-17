import { describe, it, expect } from 'vitest'
import {
  resolveContentRating,
  isMature,
  validateContentRating,
  defaultContentRating,
  contentRatingToMatureFlag,
  matureFlagToContentRating
} from '../contentRating'

describe('resolveContentRating', () => {
  it('resolves all-ages with matureFlag false', () => {
    const meta = resolveContentRating('all-ages')
    expect(meta.rating).toBe('all-ages')
    expect(meta.matureFlag).toBe(false)
  })

  it('resolves teen with matureFlag false', () => {
    const meta = resolveContentRating('teen')
    expect(meta.rating).toBe('teen')
    expect(meta.matureFlag).toBe(false)
  })

  it('resolves mature with matureFlag true', () => {
    const meta = resolveContentRating('mature')
    expect(meta.rating).toBe('mature')
    expect(meta.matureFlag).toBe(true)
  })
})

describe('isMature', () => {
  it('returns true only for mature rating', () => {
    expect(isMature('mature')).toBe(true)
    expect(isMature('teen')).toBe(false)
    expect(isMature('all-ages')).toBe(false)
  })
})

describe('validateContentRating', () => {
  it('accepts valid ratings', () => {
    expect(validateContentRating('all-ages')).toBe('all-ages')
    expect(validateContentRating('teen')).toBe('teen')
    expect(validateContentRating('mature')).toBe('mature')
  })

  it('rejects invalid values', () => {
    expect(validateContentRating('nsfw')).toBeNull()
    expect(validateContentRating('')).toBeNull()
    expect(validateContentRating(42)).toBeNull()
    expect(validateContentRating(null)).toBeNull()
    expect(validateContentRating(undefined)).toBeNull()
  })
})

describe('defaultContentRating', () => {
  it('defaults to all-ages', () => {
    expect(defaultContentRating()).toBe('all-ages')
  })
})

describe('contentRatingToMatureFlag', () => {
  it('maps mature to true', () => {
    expect(contentRatingToMatureFlag('mature')).toBe(true)
  })

  it('maps non-mature to false', () => {
    expect(contentRatingToMatureFlag('all-ages')).toBe(false)
    expect(contentRatingToMatureFlag('teen')).toBe(false)
  })
})

describe('matureFlagToContentRating', () => {
  it('maps true to mature', () => {
    expect(matureFlagToContentRating(true)).toBe('mature')
  })

  it('maps false to all-ages', () => {
    expect(matureFlagToContentRating(false)).toBe('all-ages')
  })
})
