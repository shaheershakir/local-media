import { listMedia, getRandomFeed } from './media'
import type { MediaItem } from './types'

export interface RecommendationResult {
  recentlyWatched: MediaItem[]
  recentlyAdded: MediaItem[]
  randomPicks: MediaItem[]
  all: MediaItem[]
}

/**
 * Modular Recommendation Service.
 * Fetches recently watched, recently added, and random picks.
 * Designed with a clean abstraction so it can easily be swapped
 * with an AI/vector recommendation engine in the future.
 */
export async function getRecommendations(params: {
  currentId?: number
  folderId?: number
  limit?: number
}): Promise<RecommendationResult> {
  const limit = params.limit ?? 15
  const currentId = params.currentId

  try {
    const [recentRes, randomRes] = await Promise.all([
      listMedia({
        sort: 'newest',
        media_type: 'video',
        page: 1,
        page_size: limit * 2,
      }),
      getRandomFeed({
        limit,
        exclude_ids: currentId ? [currentId] : undefined,
        media_type: 'video',
      }).catch(async () => {
        // Fallback to random sort via listMedia
        const res = await listMedia({
          sort: 'random',
          media_type: 'video',
          page: 1,
          page_size: limit,
        })
        return { items: res.items, total_available: res.total }
      }),
    ])

    const allRecent = recentRes.items.filter((it) => it.id !== currentId)
    const recentlyWatched = allRecent
      .filter((it) => it.duration_watched_seconds > 0)
      .slice(0, limit)
    const recentlyAdded = allRecent.slice(0, limit)
    const randomPicks = (randomRes.items || [])
      .filter((it) => it.id !== currentId)
      .slice(0, limit)

    // Combined unique recommendations
    const seenIds = new Set<number>()
    const all: MediaItem[] = []
    for (const item of [...recentlyWatched, ...recentlyAdded, ...randomPicks]) {
      if (!seenIds.has(item.id)) {
        seenIds.add(item.id)
        all.push(item)
      }
    }

    return {
      recentlyWatched,
      recentlyAdded,
      randomPicks,
      all: all.slice(0, limit),
    }
  } catch (err) {
    console.error('Failed to fetch recommendations:', err)
    return {
      recentlyWatched: [],
      recentlyAdded: [],
      randomPicks: [],
      all: [],
    }
  }
}
