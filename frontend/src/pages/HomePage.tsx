import { useState, useEffect, useCallback, memo } from 'react'
import { useNavigate } from 'react-router-dom'
import { listMedia, updateMediaItem } from '../api/media'
import { listFolders } from '../api/folders'
import type { MediaItem, Folder } from '../api/types'
import { HeroBanner } from '../components/HeroBanner'
import { MediaRow } from '../components/MediaRow'
import { LazyFolderRow } from '../components/LazyFolderRow'

/**
 * Ultra-responsive, high-performance Home Page.
 * Features:
 * - Lazy image decoding & loading
 * - Horizontal row virtualization
 * - Viewport-deferred LazyFolderRow API fetching
 * - Memoized components to avoid unnecessary re-renders
 * - Memory efficient for massive libraries (10,000+ items)
 */
export const HomePage = memo(function HomePage() {
  const navigate = useNavigate()

  const [heroItem, setHeroItem] = useState<MediaItem | null>(null)
  const [continueWatching, setContinueWatching] = useState<MediaItem[]>([])
  const [recentlyAdded, setRecentlyAdded] = useState<MediaItem[]>([])
  const [randomPicks, setRandomPicks] = useState<MediaItem[]>([])
  const [topFolders, setTopFolders] = useState<Folder[]>([])
  const [loading, setLoading] = useState(true)

  // 1. Fetch initial Home Page payload (only top shelves + folders metadata)
  const loadHomeContent = useCallback(async () => {
    setLoading(true)
    try {
      const [recentRes, randomRes, foldersRes] = await Promise.all([
        listMedia({
          sort: 'newest',
          media_type: 'video',
          page: 1,
          page_size: 20,
        }),
        listMedia({
          sort: 'random',
          media_type: 'video',
          page: 1,
          page_size: 20,
        }),
        listFolders({
          page: 1,
          page_size: 50,
        }),
      ])

      const recentItems = recentRes.items || []
      setRecentlyAdded(recentItems)
      setRandomPicks(randomRes.items || [])
      setTopFolders(foldersRes.items || [])

      // Choose Hero Featured Item (random from top 6 recent videos)
      if (recentItems.length > 0) {
        const pool = recentItems.slice(0, Math.min(6, recentItems.length))
        const picked = pool[Math.floor(Math.random() * pool.length)]
        setHeroItem(picked)
      } else {
        const fallback = await listMedia({ sort: 'newest', page: 1, page_size: 1 })
        if (fallback.items.length > 0) {
          setHeroItem(fallback.items[0])
        }
      }

      // Continue Watching (videos with duration_watched_seconds > 0)
      const watched = recentItems.filter((it) => it.duration_watched_seconds > 0)
      setContinueWatching(watched)
    } catch (e) {
      console.error('Failed to load Home page data:', e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadHomeContent()
  }, [loadHomeContent])

  // Stable navigation handler
  const handleOpenMedia = useCallback(
    (item: MediaItem) => {
      navigate(`/watch/${item.id}`, { state: { from: '/' } })
    },
    [navigate]
  )

  const handleViewFolder = useCallback(
    (folderId: number) => {
      navigate(`/explore?folder_id=${folderId}`)
    },
    [navigate]
  )

  // Stable favorite toggle handler
  const handleToggleFavorite = useCallback(
    async (e: React.MouseEvent, item: MediaItem) => {
      e.stopPropagation()
      const nextFav = item.is_favorite ? 0 : 1
      try {
        await updateMediaItem(item.id, { is_favorite: Boolean(nextFav) })

        const updater = (list: MediaItem[]) =>
          list.map((it) => (it.id === item.id ? { ...it, is_favorite: nextFav } : it))

        setRecentlyAdded(updater)
        setRandomPicks(updater)
        setContinueWatching(updater)
        setHeroItem((prev) => (prev && prev.id === item.id ? { ...prev, is_favorite: nextFav } : prev))
      } catch (err) {
        console.error('Failed to toggle favorite:', err)
      }
    },
    []
  )

  return (
    <div className="page-enter home-cinema-view">
      {/* ── HERO SECTION: Featured Media Showcase Banner ───────────────────── */}
      {heroItem && (
        <HeroBanner
          item={heroItem}
          onPlay={handleOpenMedia}
          onViewFolder={handleViewFolder}
          onToggleFavorite={handleToggleFavorite}
        />
      )}

      {/* ── CONTINUE WATCHING (Virtual horizontal shelf) ───────────────────── */}
      {continueWatching.length > 0 && (
        <MediaRow
          title="Continue Watching"
          subtitle="Resume playback where you left off"
          items={continueWatching}
          onItemClick={handleOpenMedia}
          onToggleFavorite={handleToggleFavorite}
          showProgress={true}
        />
      )}

      {/* ── RECENTLY ADDED (Virtual horizontal shelf) ───────────────────────── */}
      <MediaRow
        title="Recently Added"
        subtitle="Latest additions to your library"
        moreLink="/explore"
        moreLabel="View All →"
        items={recentlyAdded}
        onItemClick={handleOpenMedia}
        onToggleFavorite={handleToggleFavorite}
      />

      {/* ── RANDOM PICKS (Virtual horizontal shelf) ─────────────────────────── */}
      <MediaRow
        title="Random Picks"
        subtitle="Surprise picks & hidden gems from your library"
        items={randomPicks}
        onItemClick={handleOpenMedia}
        onToggleFavorite={handleToggleFavorite}
      />

      {/* ── DYNAMIC FOLDER SECTIONS (Deferred Lazy Loading per folder) ─────── */}
      {topFolders.map((folder) => (
        <LazyFolderRow
          key={folder.id}
          folder={folder}
          onItemClick={handleOpenMedia}
          onToggleFavorite={handleToggleFavorite}
        />
      ))}

      {/* Empty State fallback if library has no items */}
      {!loading && recentlyAdded.length === 0 && (
        <div className="empty-state" style={{ minHeight: '50dvh' }}>
          <svg className="empty-state-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <polyline points="21 15 16 10 5 21" />
          </svg>
          <div className="empty-state-title">Your Media Library is Empty</div>
          <div className="empty-state-body">
            Configure your media roots in Settings and trigger a library scan to populate the Home page.
          </div>
          <button className="btn-primary" onClick={() => navigate('/settings')}>
            Go to Settings
          </button>
        </div>
      )}
    </div>
  )
})
