export type PublishContentType = 'cartoon'

export interface PublishIntent {
  contentType: PublishContentType
  storylineLevel: boolean
}

export interface ProjectPublishMeta {
  publishIntent: PublishContentType | undefined
}

const CARTOON_INTENT: PublishIntent = {
  contentType: 'cartoon',
  storylineLevel: true
}

export function resolvePublishIntent(meta: ProjectPublishMeta): PublishIntent {
  if (meta.publishIntent === 'cartoon') {
    return CARTOON_INTENT
  }
  return CARTOON_INTENT
}

export function isCartoonProject(meta: ProjectPublishMeta): boolean {
  return resolvePublishIntent(meta).contentType === 'cartoon'
}

export function getContentTypeForNewStoryline(meta: ProjectPublishMeta): PublishContentType {
  return resolvePublishIntent(meta).contentType
}

export function shouldIncludeContentType(
  meta: ProjectPublishMeta,
  storylineType: 'new' | 'existing'
): boolean {
  if (storylineType !== 'new') return false
  return resolvePublishIntent(meta).storylineLevel
}

export function migrateProjectPublishMeta(raw: Record<string, unknown>): ProjectPublishMeta {
  const intent = raw.publishIntent
  if (intent === 'cartoon') {
    return { publishIntent: 'cartoon' }
  }
  return { publishIntent: undefined }
}

export function defaultPublishMeta(): ProjectPublishMeta {
  return { publishIntent: 'cartoon' }
}
