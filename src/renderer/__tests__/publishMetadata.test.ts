import { describe, it, expect } from 'vitest'
import {
  resolvePublishIntent,
  isCartoonProject,
  getContentTypeForNewStoryline,
  shouldIncludeContentType,
  migrateProjectPublishMeta,
  defaultPublishMeta,
  type ProjectPublishMeta
} from '../publishMetadata'

describe('resolvePublishIntent', () => {
  it('resolves cartoon intent for explicit cartoon publishIntent', () => {
    const meta: ProjectPublishMeta = { publishIntent: 'cartoon' }
    const intent = resolvePublishIntent(meta)

    expect(intent.contentType).toBe('cartoon')
    expect(intent.storylineLevel).toBe(true)
  })

  it('defaults to cartoon intent when publishIntent is undefined', () => {
    const meta: ProjectPublishMeta = { publishIntent: undefined }
    const intent = resolvePublishIntent(meta)

    expect(intent.contentType).toBe('cartoon')
    expect(intent.storylineLevel).toBe(true)
  })
})

describe('isCartoonProject', () => {
  it('returns true for cartoon publishIntent', () => {
    expect(isCartoonProject({ publishIntent: 'cartoon' })).toBe(true)
  })

  it('returns true for undefined publishIntent (defaults to cartoon)', () => {
    expect(isCartoonProject({ publishIntent: undefined })).toBe(true)
  })
})

describe('getContentTypeForNewStoryline', () => {
  it('returns cartoon for cartoon projects', () => {
    expect(getContentTypeForNewStoryline({ publishIntent: 'cartoon' })).toBe('cartoon')
  })

  it('returns cartoon for projects without explicit intent', () => {
    expect(getContentTypeForNewStoryline({ publishIntent: undefined })).toBe('cartoon')
  })
})

describe('shouldIncludeContentType', () => {
  it('returns true for new storyline in cartoon project', () => {
    const meta: ProjectPublishMeta = { publishIntent: 'cartoon' }
    expect(shouldIncludeContentType(meta, 'new')).toBe(true)
  })

  it('returns false for existing storyline even in cartoon project', () => {
    const meta: ProjectPublishMeta = { publishIntent: 'cartoon' }
    expect(shouldIncludeContentType(meta, 'existing')).toBe(false)
  })

  it('returns true for new storyline with undefined intent (defaults to cartoon)', () => {
    const meta: ProjectPublishMeta = { publishIntent: undefined }
    expect(shouldIncludeContentType(meta, 'new')).toBe(true)
  })
})

describe('migrateProjectPublishMeta', () => {
  it('preserves cartoon publishIntent from raw data', () => {
    const raw = { publishIntent: 'cartoon', name: 'Test' }
    const meta = migrateProjectPublishMeta(raw)
    expect(meta.publishIntent).toBe('cartoon')
  })

  it('returns undefined publishIntent for unknown values', () => {
    const raw = { publishIntent: 'prose' }
    const meta = migrateProjectPublishMeta(raw)
    expect(meta.publishIntent).toBeUndefined()
  })

  it('returns undefined publishIntent when field is missing', () => {
    const raw = { name: 'My Project' }
    const meta = migrateProjectPublishMeta(raw)
    expect(meta.publishIntent).toBeUndefined()
  })

  it('returns undefined publishIntent for non-string values', () => {
    const raw = { publishIntent: 42 }
    const meta = migrateProjectPublishMeta(raw)
    expect(meta.publishIntent).toBeUndefined()
  })
})

describe('defaultPublishMeta', () => {
  it('defaults to cartoon publishIntent', () => {
    const meta = defaultPublishMeta()
    expect(meta.publishIntent).toBe('cartoon')
  })
})

describe('backward compatibility', () => {
  it('older projects without publishIntent still resolve to cartoon', () => {
    const oldProjectData = { name: 'Legacy Project', version: 1 }
    const meta = migrateProjectPublishMeta(oldProjectData)
    const intent = resolvePublishIntent(meta)

    expect(intent.contentType).toBe('cartoon')
    expect(intent.storylineLevel).toBe(true)
  })

  it('shouldIncludeContentType works with migrated old data for new storyline', () => {
    const meta = migrateProjectPublishMeta({ name: 'Old' })
    expect(shouldIncludeContentType(meta, 'new')).toBe(true)
  })

  it('shouldIncludeContentType blocks contentType for existing storyline on old data', () => {
    const meta = migrateProjectPublishMeta({ name: 'Old' })
    expect(shouldIncludeContentType(meta, 'existing')).toBe(false)
  })
})
