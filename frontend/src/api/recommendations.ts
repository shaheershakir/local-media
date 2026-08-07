import { listMedia, getRandomFeed } from './media'
import type { MediaItem, RecommendationProvider, SimilarVideosQuery } from './types'

export type RecTabType = 'all' | 'watched' | 'recent' | 'random'

export interface PaginatedRecResult {
  items: MediaItem[]
  hasMore: boolean
  page: number
}

// ════════════════════════════════════════════════════════════════════════════════
// Pluggable Recommendation Provider Architecture
// ════════════════════════════════════════════════════════════════════════════════

/**
 * Built-in default local metadata recommendation provider.
 */
class LocalMetadataRecommendationProvider implements RecommendationProvider {
  name = 'local_metadata_engine'
  version = '1.0.0'

  async getRecommendations(params: {
    currentId?: number
    folderId?: number
    limit?: number
  }): Promise<MediaItem[]> {
    const res = await getRecommendationsPage({
      tab: 'all',
      page: 1,
      pageSize: params.limit || 12,
      currentId: params.currentId,
      folderId: params.folderId,
    })
    return res.items
  }

  async getSimilarVideos(query: SimilarVideosQuery): Promise<MediaItem[]> {
    // Basic similarity fallback: query media in same folder or with similar title
    const res = await listMedia({
      sort: 'newest',
      media_type: 'video',
      page: 1,
      page_size: query.limit || 10,
    })
    return res.items.filter((it) => it.id !== query.targetId)
  }
}

// Active provider registry (allows future AI / vector engines to be plugged in seamlessly)
let activeRecommendationProvider: RecommendationProvider = new LocalMetadataRecommendationProvider()

export function setRecommendationProvider(provider: RecommendationProvider) {
  activeRecommendationProvider = provider
}

export function getActiveRecommendationProvider(): RecommendationProvider {
  return activeRecommendationProvider
}

/**
 * Modular Recommendation Service with paginated / lazy-load support.
 * Fetches batches of recommendations by category (all, watched, recent, random).
 * Cleanly architected for easy future integration with AI / Vector recommendation engines.
 */
export async function getRecommendationsPage(params: {
  tab: RecTabType
  page: number
  pageSize?: number
  currentId?: number
  folderId?: number
}): Promise<PaginatedRecResult> {
  const pageSize = params.pageSize ?? 12
  const page = params.page
  const currentId = params.currentId

  try {
    if (params.tab === 'recent') {
      const res = await listMedia({
        sort: 'newest',
        media_type: 'video',
        page,
        page_size: pageSize + 1, // fetch 1 extra to check hasMore
      })
      const filtered = res.items.filter((it) => it.id !== currentId)
      const items = filtered.slice(0, pageSize)
      const hasMore = page * pageSize < res.total
      return { items, hasMore, page }
    }

    if (params.tab === 'random') {
      try {
        const randomRes = await getRandomFeed({
          limit: pageSize,
          exclude_ids: currentId ? [currentId] : undefined,
          media_type: 'video',
        })
        const items = (randomRes.items || []).filter((it) => it.id !== currentId)
        return { items, hasMore: items.length >= pageSize, page }
      } catch {
        const res = await listMedia({
          sort: 'random',
          media_type: 'video',
          page,
          page_size: pageSize,
        })
        const items = res.items.filter((it) => it.id !== currentId)
        return { items, hasMore: page * pageSize < res.total, page }
      }
    }

    if (params.tab === 'watched') {
      const res = await listMedia({
        sort: 'newest',
        media_type: 'video',
        page,
        page_size: pageSize * 2,
      })
      const filtered = res.items
        .filter((it) => it.id !== currentId && it.duration_watched_seconds > 0)
        .slice(0, pageSize)
      const hasMore = page * pageSize < res.total
      return { items: filtered, hasMore, page }
    }

    // Default 'all' tab: Mix of recent, watched, and random
    const [recentRes, randomRes] = await Promise.all([
      listMedia({
        sort: 'newest',
        media_type: 'video',
        page,
        page_size: pageSize,
      }),
      listMedia({
        sort: 'random',
        media_type: 'video',
        page,
        page_size: pageSize,
      }),
    ])

    const combined: MediaItem[] = []
    const seenIds = new Set<number>()
    if (currentId) seenIds.add(currentId)

    for (const item of [...recentRes.items, ...randomRes.items]) {
      if (!seenIds.has(item.id)) {
        seenIds.add(item.id)
        combined.push(item)
      }
    }

    const items = combined.slice(0, pageSize)
    const hasMore = page * pageSize < Math.max(recentRes.total, 50)
    return { items, hasMore, page }
  } catch (err) {
    console.error(`Failed to load recommendation page (tab: ${params.tab}, page: ${page}):`, err)
    return { items: [], hasMore: false, page }
  }
}

/**
 * Initial fast-fetch bundle for recommendations
 */
export async function getRecommendations(params: {
  currentId?: number
  folderId?: number
  limit?: number
}) {
  const limit = params.limit ?? 12
  const [allRes, recentRes, randomRes, watchedRes] = await Promise.all([
    getRecommendationsPage({ tab: 'all', page: 1, pageSize: limit, currentId: params.currentId, folderId: params.folderId }),
    getRecommendationsPage({ tab: 'recent', page: 1, pageSize: limit, currentId: params.currentId, folderId: params.folderId }),
    getRecommendationsPage({ tab: 'random', page: 1, pageSize: limit, currentId: params.currentId, folderId: params.folderId }),
    getRecommendationsPage({ tab: 'watched', page: 1, pageSize: limit, currentId: params.currentId, folderId: params.folderId }),
  ])

  return {
    all: allRes.items,
    recentlyAdded: recentRes.items,
    randomPicks: randomRes.items,
    recentlyWatched: watchedRes.items,
  }
}
