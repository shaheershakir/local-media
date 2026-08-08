import { useState, useEffect, useRef, useCallback } from 'react'
import type { MediaItem } from '../api/types'
import { getRecommendationsPage, type RecTabType } from '../api/recommendations'
import { VideoCard } from './VideoCard'
import { ImageCard } from './ImageCard'

export interface RecommendationSidebarProps {
  currentMediaId?: number
  folderId?: number
  onItemClick: (item: MediaItem) => void
}

/**
 * Reusable RecommendationSidebar component with category tabs,
 * polymorphic rendering of VideoCard and ImageCard (compact layout),
 * lazy-loaded infinite scrolling, and sentinel observation.
 */
export function RecommendationSidebar({
  currentMediaId,
  folderId,
  onItemClick,
}: RecommendationSidebarProps) {
  const sentinelRef = useRef<HTMLDivElement>(null)

  const [tab, setTab] = useState<RecTabType>('all')
  const [items, setItems] = useState<MediaItem[]>([])
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(true)
  const [loadingInitial, setLoadingInitial] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)

  // 1. Initial batch load on tab change or currentMediaId change
  const loadInitial = useCallback(
    async (selectedTab: RecTabType, mediaId?: number) => {
      if (!mediaId) return
      setLoadingInitial(true)
      setPage(1)
      try {
        const res = await getRecommendationsPage({
          tab: selectedTab,
          page: 1,
          pageSize: 10,
          currentId: mediaId,
          folderId,
        })
        setItems(res.items)
        setHasMore(res.hasMore)
      } catch (err) {
        console.error('Failed to load initial recommendations:', err)
        setItems([])
        setHasMore(false)
      } finally {
        setLoadingInitial(false)
      }
    },
    [folderId]
  )

  useEffect(() => {
    loadInitial(tab, currentMediaId)
  }, [tab, currentMediaId, loadInitial])

  // 2. Fetch subsequent pages on scroll
  const loadMore = useCallback(async () => {
    if (loadingMore || loadingInitial || !hasMore || !currentMediaId) return

    setLoadingMore(true)
    const nextPage = page + 1
    try {
      const res = await getRecommendationsPage({
        tab,
        page: nextPage,
        pageSize: 10,
        currentId: currentMediaId,
        folderId,
      })

      setItems((prev) => {
        const seen = new Set(prev.map((i) => i.id))
        const newOnes = res.items.filter((i) => !seen.has(i.id))
        return [...prev, ...newOnes]
      })
      setPage(nextPage)
      setHasMore(res.hasMore)
    } catch (err) {
      console.error('Failed to load more recommendations:', err)
      setItems([])
      setHasMore(false)
    } finally {
      setLoadingMore(false)
    }
  }, [loadingMore, loadingInitial, hasMore, currentMediaId, page, tab, folderId])

  // 3. Sentinel IntersectionObserver
  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loadingMore && !loadingInitial) {
          loadMore()
        }
      },
      { root: null, rootMargin: '300px 0px', threshold: 0.1 }
    )

    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [loadMore, hasMore, loadingMore, loadingInitial])

  return (
    <aside className="player-rec-sidebar" aria-label="Recommendations Sidebar">
      <div className="player-rec-header">
        <h2 className="player-rec-title">Recommendations</h2>
        <div className="player-rec-tabs">
          <button
            className={`player-rec-tab-btn${tab === 'all' ? ' active' : ''}`}
            onClick={() => setTab('all')}
            type="button"
          >
            All
          </button>
          <button
            className={`player-rec-tab-btn${tab === 'recent' ? ' active' : ''}`}
            onClick={() => setTab('recent')}
            type="button"
          >
            Recent
          </button>
          <button
            className={`player-rec-tab-btn${tab === 'random' ? ' active' : ''}`}
            onClick={() => setTab('random')}
            type="button"
          >
            Random
          </button>
          <button
            className={`player-rec-tab-btn${tab === 'watched' ? ' active' : ''}`}
            onClick={() => setTab('watched')}
            type="button"
          >
            Watched
          </button>
        </div>
      </div>

      <div className="player-rec-list">
        {loadingInitial && items.length === 0 ? (
          Array.from({ length: 6 }).map((_, i) => (
            <div key={`rec-skel-${i}`} className="skeleton video-card-compact-skeleton" />
          ))
        ) : items.length === 0 ? (
          <div className="player-rec-empty">No recommendations found.</div>
        ) : (
          items.map((recItem) =>
            recItem.media_type === 'image' ? (
              <ImageCard
                key={`${tab}-${recItem.id}`}
                item={recItem}
                layout="compact"
                onItemClick={onItemClick}
              />
            ) : (
              <VideoCard
                key={`${tab}-${recItem.id}`}
                item={recItem}
                layout="compact"
                onItemClick={onItemClick}
              />
            )
          )
        )}

        {/* Loading dots */}
        {loadingMore && (
          <div className="rec-loading-more-row">
            <span className="rec-loading-dot" />
            <span className="rec-loading-dot" />
            <span className="rec-loading-dot" />
            <span className="text-muted" style={{ fontSize: 11, marginLeft: 6 }}>
              Loading more…
            </span>
          </div>
        )}

        {/* Fallback button */}
        {hasMore && !loadingInitial && (
          <button
            className="player-rec-loadmore-btn"
            onClick={loadMore}
            disabled={loadingMore}
            type="button"
          >
            {loadingMore ? 'Loading more…' : 'Load more recommendations ↓'}
          </button>
        )}

        {/* Sentinel for lazy loading */}
        <div ref={sentinelRef} className="rec-sentinel" />
      </div>
    </aside>
  )
}
