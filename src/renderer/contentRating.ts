export type ContentRating = 'all-ages' | 'teen' | 'mature'

export interface ContentRatingMeta {
  rating: ContentRating
  matureFlag: boolean
}

export function resolveContentRating(rating: ContentRating): ContentRatingMeta {
  return {
    rating,
    matureFlag: rating === 'mature'
  }
}

export function isMature(rating: ContentRating): boolean {
  return rating === 'mature'
}

export function validateContentRating(value: unknown): ContentRating | null {
  if (value === 'all-ages' || value === 'teen' || value === 'mature') {
    return value
  }
  return null
}

export function defaultContentRating(): ContentRating {
  return 'all-ages'
}

export function contentRatingToMatureFlag(rating: ContentRating): boolean {
  return rating === 'mature'
}

export function matureFlagToContentRating(matureFlag: boolean): ContentRating {
  return matureFlag ? 'mature' : 'all-ages'
}
