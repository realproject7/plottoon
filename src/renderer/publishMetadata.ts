export type PublishContentType = 'cartoon'
export type PublishIntentKind = 'cartoon' | 'prose'

export interface PublishIntent {
  contentType: PublishContentType | null
  storylineLevel: boolean
}

export interface ProjectPublishMeta {
  publishIntent: PublishIntentKind | undefined
}

const CARTOON_INTENT: PublishIntent = {
  contentType: 'cartoon',
  storylineLevel: true
}

const PROSE_INTENT: PublishIntent = {
  contentType: null,
  storylineLevel: false
}

export function resolvePublishIntent(meta: ProjectPublishMeta): PublishIntent {
  if (meta.publishIntent === 'cartoon') {
    return CARTOON_INTENT
  }
  if (meta.publishIntent === 'prose') {
    return PROSE_INTENT
  }
  return PROSE_INTENT
}

export function isCartoonProject(meta: ProjectPublishMeta): boolean {
  return resolvePublishIntent(meta).contentType === 'cartoon'
}

export function getContentTypeForNewStoryline(meta: ProjectPublishMeta): PublishContentType | null {
  return resolvePublishIntent(meta).contentType
}

export function shouldIncludeContentType(
  meta: ProjectPublishMeta,
  storylineType: 'new' | 'existing'
): boolean {
  if (storylineType !== 'new') return false
  const intent = resolvePublishIntent(meta)
  return intent.storylineLevel && intent.contentType !== null
}

export function migrateProjectPublishMeta(raw: Record<string, unknown>): ProjectPublishMeta {
  const intent = raw.publishIntent
  if (intent === 'cartoon') {
    return { publishIntent: 'cartoon' }
  }
  if (intent === 'prose') {
    return { publishIntent: 'prose' }
  }
  return { publishIntent: undefined }
}

export function defaultPublishMeta(): ProjectPublishMeta {
  return { publishIntent: 'cartoon' }
}
