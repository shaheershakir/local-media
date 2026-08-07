import type { MediaCollection, MediaTag, MediaGenre, SmartFilterCriteria, MediaItem } from './types'
import { listMedia, type SortOption } from './media'

/**
 * ══════════════════════════════════════════════════════════════════════════════
 * Collections & Smart Playlists Extensibility Layer
 * ══════════════════════════════════════════════════════════════════════════════
 * Provides a unified API interface for future features:
 * - Curated user collections
 * - Smart query-based playlists (e.g. 4K HDR, Unwatched Movies, Anime series)
 * - Tags & Genres multi-filtering
 */

/**
 * Evaluates smart filter criteria against the media catalog.
 */
export async function querySmartCollection(
  criteria: SmartFilterCriteria,
  page: number = 1,
  pageSize: number = 30
): Promise<{ items: MediaItem[]; total: number }> {
  const allowedSorts: SortOption[] = ['newest', 'oldest', 'duration', 'random', 'name']
  const sort: SortOption = allowedSorts.includes(criteria.sortBy as SortOption)
    ? (criteria.sortBy as SortOption)
    : 'newest'

  return listMedia({
    q: criteria.searchQuery,
    sort,
    folder_id: criteria.folderIds?.[0],
    page,
    page_size: pageSize,
  })
}

/**
 * Stub registry for collections (ready for SQLite table backing).
 */
export async function listCollections(): Promise<MediaCollection[]> {
  return []
}

export async function getCollection(_id: number): Promise<MediaCollection | null> {
  return null
}

export async function listTags(): Promise<MediaTag[]> {
  return []
}

export async function listGenres(): Promise<MediaGenre[]> {
  return []
}
