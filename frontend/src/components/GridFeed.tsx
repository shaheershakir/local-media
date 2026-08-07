import { useState, useEffect, useCallback, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { listMedia } from '../api/media'
import type { MediaItem } from '../api/types'
import type { SortOption } from '../api/media'
import { VideoCard } from './VideoCard'

interface GridFeedProps {
  folderId?: number | null
  favoritesOnly?: boolean
  searchQuery?: string
}

const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: 'newest', label: 'Newest' },
  { value: 'oldest', label: 'Oldest' },
  { value: 'duration', label: 'Duration' },
  { value: 'random', label: 'Random' },
  { value: 'name', label: 'A–Z' },
]

const TYPE_OPTIONS = [
  { value: '', label: 'All' },
  { value: 'video', label: 'Videos' },
  { value: 'image', label: 'Photos' },
]

export function GridFeed({ folderId, favoritesOnly, searchQuery }: GridFeedProps) {
  const navigate = useNavigate()
  const location = useLocation()

  const [items, setItems] = useState<MediaItem[]>([])
  const [total, setTotal] = useState(0)
  const [_page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [sort, setSort] = useState<SortOption>('newest')
  const [mediaType, setMediaType] = useState<'video' | 'image' | ''>('')

  const PAGE_SIZE = 30
  const observerRef = useRef<IntersectionObserver | null>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)
  // useRef guard prevents stale closures — avoids duplicate calls across re-renders
  const loadingRef = useRef(false)

  const loadPage = useCallback(
    async (pageNum: number, reset = false) => {
      if (loadingRef.current) return
      loadingRef.current = true
      setLoading(true)
      try {
        const res = await listMedia({
          sort,
          media_type: mediaType || null,
          folder_id: folderId ?? null,
          q: searchQuery,
          favorites_only: favoritesOnly,
          page: pageNum,
          page_size: PAGE_SIZE,
        })
        setTotal(res.total)
        if (reset) {
          setItems(res.items)
        } else {
          setItems((prev) => [...prev, ...res.items])
        }
        setHasMore(pageNum < res.pages)
      } catch (e) {
        console.error(e)
      } finally {
        loadingRef.current = false
        setLoading(false)
      }
    },
    [sort, mediaType, folderId, favoritesOnly, searchQuery] // ← removed `loading` from deps
  )

  // Reset on filter/sort change
  useEffect(() => {
    setPage(1)
    setItems([])
    setHasMore(true)
    loadPage(1, true)
  }, [sort, mediaType, folderId, favoritesOnly, searchQuery]) // eslint-disable-line react-hooks/exhaustive-deps

  // Infinite scroll sentinel — only reconstruct observer when hasMore/page changes
  useEffect(() => {
    if (observerRef.current) observerRef.current.disconnect()
    observerRef.current = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loadingRef.current) {
          setPage((prev) => {
            const nextPage = prev + 1
            loadPage(nextPage)
            return nextPage
          })
        }
      },
      { threshold: 0.1 }
    )
    if (sentinelRef.current) {
      observerRef.current.observe(sentinelRef.current)
    }
    return () => observerRef.current?.disconnect()
  }, [hasMore, loadPage])

  const handleItemClick = (item: MediaItem) => {
    navigate(`/media/${item.id}`, {
      state: { from: `${location.pathname}${location.search}` },
    })
  }

  return (
    <div>
      {/* Controls */}
      <div className="grid-controls">
        <div style={{ display: 'flex', gap: 4 }}>
          {TYPE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              className={`grid-filter-btn${mediaType === opt.value ? ' active' : ''}`}
              onClick={() => setMediaType(opt.value as any)}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
          {SORT_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              className={`grid-filter-btn${sort === opt.value ? ' active' : ''}`}
              onClick={() => setSort(opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>
        {total > 0 && (
          <span className="text-muted t-label" style={{ marginLeft: 8, whiteSpace: 'nowrap' }}>
            {total.toLocaleString()} items
          </span>
        )}
      </div>

      {/* Grid */}
      {items.length === 0 && !loading ? (
        <div className="empty-state">
          <svg className="empty-state-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
            <circle cx="8.5" cy="8.5" r="1.5"/>
            <polyline points="21 15 16 10 5 21"/>
          </svg>
          <div className="empty-state-title">Nothing here</div>
          <div className="empty-state-body">Try a different filter or trigger a scan to index your library.</div>
        </div>
      ) : (
        <div className="media-grid">
          {items.map((item) => (
            <VideoCard
              key={item.id}
              item={item}
              layout="grid"
              onItemClick={() => handleItemClick(item)}
            />
          ))}

          {/* Loading skeletons */}
          {loading &&
            Array.from({ length: 9 }).map((_, i) => (
              <div key={`skel-${i}`} className="skeleton skeleton-grid-item" />
            ))}
        </div>
      )}

      {/* Infinite scroll sentinel */}
      <div ref={sentinelRef} style={{ height: 1 }} />
    </div>
  )
}
