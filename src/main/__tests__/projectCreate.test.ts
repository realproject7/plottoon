import { describe, it, expect } from 'vitest'
import { ProjectMetaError } from '../services/projectMeta'

function validateNameAndSlug(name: unknown): string {
  const trimmed = typeof name === 'string' ? (name as string).trim() : ''
  if (trimmed.length === 0) {
    throw new ProjectMetaError('Project name must be a non-empty string', '')
  }
  const slug = trimmed
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  if (slug.length === 0) {
    throw new ProjectMetaError('Project name must contain at least one alphanumeric character', '')
  }
  return slug
}

describe('project create name/slug validation', () => {
  it('accepts a normal name', () => {
    expect(validateNameAndSlug('My Webtoon')).toBe('my-webtoon')
  })

  it('trims whitespace', () => {
    expect(validateNameAndSlug('  Hello World  ')).toBe('hello-world')
  })

  it('rejects empty string', () => {
    expect(() => validateNameAndSlug('')).toThrow(ProjectMetaError)
    expect(() => validateNameAndSlug('')).toThrow('non-empty')
  })

  it('rejects whitespace-only string', () => {
    expect(() => validateNameAndSlug('   ')).toThrow(ProjectMetaError)
    expect(() => validateNameAndSlug('   ')).toThrow('non-empty')
  })

  it('rejects non-string input', () => {
    expect(() => validateNameAndSlug(undefined)).toThrow('non-empty')
    expect(() => validateNameAndSlug(null)).toThrow('non-empty')
    expect(() => validateNameAndSlug(42)).toThrow('non-empty')
  })

  it('rejects name with only special characters', () => {
    expect(() => validateNameAndSlug('!!!')).toThrow('alphanumeric')
    expect(() => validateNameAndSlug('---')).toThrow('alphanumeric')
    expect(() => validateNameAndSlug('...')).toThrow('alphanumeric')
  })

  it('handles names with mixed content', () => {
    expect(validateNameAndSlug('Test!@#123')).toBe('test-123')
  })
})
