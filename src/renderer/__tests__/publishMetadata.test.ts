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

  it('resolves prose intent for explicit prose publishIntent', () => {
    const meta: ProjectPublishMeta = { publishIntent: 'prose' }
    const intent = resolvePublishIntent(meta)

    expect(intent.contentType).toBeNull()
    expect(intent.storylineLevel).toBe(false)
  })

  it('resolves to prose (no contentType) when publishIntent is undefined', () => {
    const meta: ProjectPublishMeta = { publishIntent: undefined }
    const intent = resolvePublishIntent(meta)

    expect(intent.contentType).toBeNull()
    expect(intent.storylineLevel).toBe(false)
  })
})

describe('isCartoonProject', () => {
  it('returns true for cartoon publishIntent', () => {
    expect(isCartoonProject({ publishIntent: 'cartoon' })).toBe(true)
  })

  it('returns false for prose publishIntent', () => {
    expect(isCartoonProject({ publishIntent: 'prose' })).toBe(false)
  })

  it('returns false for undefined publishIntent', () => {
    expect(isCartoonProject({ publishIntent: undefined })).toBe(false)
  })
})

describe('getContentTypeForNewStoryline', () => {
  it('returns cartoon for cartoon projects', () => {
    expect(getContentTypeForNewStoryline({ publishIntent: 'cartoon' })).toBe('cartoon')
  })

  it('returns null for prose projects', () => {
    expect(getContentTypeForNewStoryline({ publishIntent: 'prose' })).toBeNull()
  })

  it('returns null for projects without explicit intent', () => {
    expect(getContentTypeForNewStoryline({ publishIntent: undefined })).toBeNull()
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

  it('returns false for new storyline with prose intent', () => {
    const meta: ProjectPublishMeta = { publishIntent: 'prose' }
    expect(shouldIncludeContentType(meta, 'new')).toBe(false)
  })

  it('returns false for new storyline with undefined intent', () => {
    const meta: ProjectPublishMeta = { publishIntent: undefined }
    expect(shouldIncludeContentType(meta, 'new')).toBe(false)
  })
})

describe('migrateProjectPublishMeta', () => {
  it('preserves cartoon publishIntent from raw data', () => {
    const raw = { publishIntent: 'cartoon', name: 'Test' }
    const meta = migrateProjectPublishMeta(raw)
    expect(meta.publishIntent).toBe('cartoon')
  })

  it('preserves prose publishIntent from raw data', () => {
    const raw = { publishIntent: 'prose' }
    const meta = migrateProjectPublishMeta(raw)
    expect(meta.publishIntent).toBe('prose')
  })

  it('returns undefined publishIntent for unknown values', () => {
    const raw = { publishIntent: 'manga' }
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
  it('defaults to cartoon publishIntent for new PlotToon projects', () => {
    const meta = defaultPublishMeta()
    expect(meta.publishIntent).toBe('cartoon')
  })
})

describe('prose/fiction preservation', () => {
  it('prose projects never emit contentType for new storylines', () => {
    const meta: ProjectPublishMeta = { publishIntent: 'prose' }
    expect(shouldIncludeContentType(meta, 'new')).toBe(false)
    expect(getContentTypeForNewStoryline(meta)).toBeNull()
  })

  it('older projects without publishIntent do not emit cartoon contentType', () => {
    const oldProjectData = { name: 'Legacy Project', version: 1 }
    const meta = migrateProjectPublishMeta(oldProjectData)

    expect(shouldIncludeContentType(meta, 'new')).toBe(false)
    expect(getContentTypeForNewStoryline(meta)).toBeNull()
  })

  it('only explicit cartoon intent emits contentType', () => {
    const cartoonMeta: ProjectPublishMeta = { publishIntent: 'cartoon' }
    const proseMeta: ProjectPublishMeta = { publishIntent: 'prose' }
    const undefinedMeta: ProjectPublishMeta = { publishIntent: undefined }

    expect(shouldIncludeContentType(cartoonMeta, 'new')).toBe(true)
    expect(shouldIncludeContentType(proseMeta, 'new')).toBe(false)
    expect(shouldIncludeContentType(undefinedMeta, 'new')).toBe(false)
  })
})

describe('wiring integration', () => {
  it('cartoon project metadata drives contentType inclusion for new storyline', () => {
    const meta = defaultPublishMeta()
    expect(isCartoonProject(meta)).toBe(true)
    expect(shouldIncludeContentType(meta, 'new')).toBe(true)
    expect(getContentTypeForNewStoryline(meta)).toBe('cartoon')
  })

  it('prose project metadata blocks contentType for any storyline type', () => {
    const meta: ProjectPublishMeta = { publishIntent: 'prose' }
    expect(isCartoonProject(meta)).toBe(false)
    expect(shouldIncludeContentType(meta, 'new')).toBe(false)
    expect(shouldIncludeContentType(meta, 'existing')).toBe(false)
  })
})
