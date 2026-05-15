import type { ImageState, ImageRevision } from './cutsSchema'

export interface AddRevisionOptions {
  path: string
  revisionNotes?: string
}

export function addRevision(imageState: ImageState, options: AddRevisionOptions): ImageState {
  const existing = imageState.revisions ?? []
  const nextVersion = existing.length > 0 ? Math.max(...existing.map((r) => r.version)) + 1 : 1

  const revision: ImageRevision = {
    version: nextVersion,
    path: options.path,
    createdAt: new Date().toISOString(),
    revisionNotes: options.revisionNotes
  }

  return {
    ...imageState,
    status: 'done',
    path: options.path,
    revisions: [...existing, revision]
  }
}

export function setCurrentRevision(imageState: ImageState, version: number): ImageState {
  const revisions = imageState.revisions ?? []
  const target = revisions.find((r) => r.version === version)
  if (!target) {
    throw new Error(`Revision version ${version} not found`)
  }

  return {
    ...imageState,
    status: 'done',
    path: target.path
  }
}

export function getRevisions(imageState: ImageState): ImageRevision[] {
  return imageState.revisions ?? []
}

export function getCurrentVersion(imageState: ImageState): number | null {
  if (!imageState.path || !imageState.revisions) return null
  const match = imageState.revisions.find((r) => r.path === imageState.path)
  return match?.version ?? null
}
