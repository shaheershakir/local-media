import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { listMedia, thumbnailUrl, updateMediaItem } from '../api/media'
import { listFolders, getFolder } from '../api/folders'
import type { MediaItem, Folder } from '../api/types'
import { VideoCard, formatDuration, cleanResolution } from '../components/VideoCard'

interface FolderSectionData {
  folder: Folder
  items: MediaItem[]
  total: number
}

// ── Horizontal Media Shelf Component with Left/Right Scroll Controls ──────────
interface MediaShelfProps {
  title: string
  subtitle?: string
  moreLink?: string
  moreLabel?: string
  items: MediaItem[]
  onItemClick: (item: MediaItem) => void
  onToggleFavorite?: (e: React.MouseEvent, item: MediaItem) => void
  showProgress?: boolean
  emptyMessage?: string
}

function MediaShelf({
  title,
  subtitle,
  moreLink,
  moreLabel,
  items,
  onItemClick,
  onToggleFavorite,
  showProgress = false,
  emptyMessage,
}: MediaShelfProps) {
  const navigate = useNavigate()
  const scrollRef = useRef<HTMLDivElement>(null)
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(true)

  const checkScrollButtons = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    setCanScrollLeft(el.scrollLeft > 10)
    setCanScrollRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 10)
  }, [])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    checkScrollButtons()
    el.addEventListener('scroll', checkScrollButtons, { passive: true })
    window.addEventListener('resize', checkScrollButtons)
    return () => {
      el.removeEventListener('scroll', checkScrollButtons)
      window.removeEventListener('resize', checkScrollButtons)
    }
  }, [checkScrollButtons, items.length])

  const handleScroll = (direction: 'left' | 'right') => {
    const el = scrollRef.current
    if (!el) return
    const scrollAmount = el.clientWidth * 0.75
    el.scrollBy({
      left: direction === 'left' ? -scrollAmount : scrollAmount,
      behavior: 'smooth',
    })
  }

  if (items.length === 0 && !emptyMessage) return null

  return (
    <section className="home-shelf-section">
      <div className="home-shelf-header">
        <div className="home-shelf-title-group">
          <h2 className="home-shelf-title">{title}</h2>
          {subtitle && <span className="home-shelf-subtitle">{subtitle}</span>}
        </div>
        {moreLink && (
          <button
            className="home-shelf-more-btn"
            type="button"
            onClick={() => navigate(moreLink)}
          >
            {moreLabel || 'Explore All →'}
          </button>
        )}
      </div>

      <div className="home-shelf-wrapper">
        {canScrollLeft && (
          <button
            className="shelf-arrow-btn shelf-arrow-left"
            onClick={() => handleScroll('left')}
            aria-label={`Scroll ${title} left`}
            type="button"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
        )}

        <div ref={scrollRef} className="home-shelf-scroll-row">
          {items.map((item) => (
            <VideoCard
              key={item.id}
              item={item}
              layout="shelf"
              showProgress={showProgress}
              onItemClick={onItemClick}
              onToggleFavorite={onToggleFavorite}
            />
          ))}
        </div>

        {canScrollRight && (
          <button
            className="shelf-arrow-btn shelf-arrow-right"
            onClick={() => handleScroll('right')}
            aria-label={`Scroll ${title} right`}
            type="button"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 18l6-6-6-6" />
            </svg>
          </button>
        )}
      </div>
    </section>
  )
}

// ── Main Home Page Component ──────────────────────────────────────────────────
export function HomePage() {
  const navigate = useNavigate()

  const [heroItem, setHeroItem] = useState<MediaItem | null>(null)
  const [continueWatching, setContinueWatching] = useState<MediaItem[]>([])
  const [recentlyAdded, setRecentlyAdded] = useState<MediaItem[]>([])
  const [randomPicks, setRandomPicks] = useState<MediaItem[]>([])
  const [folderSections, setFolderSections] = useState<FolderSectionData[]>([])
  const [loading, setLoading] = useState(true)

  const loadHomeContent = useCallback(async () => {
    setLoading(true)
    try {
      // 1. Fetch Recently Added Videos
      const recentRes = await listMedia({
        sort: 'newest',
        media_type: 'video',
        page: 1,
        page_size: 20,
      })
      setRecentlyAdded(recentRes.items)

      // Choose Hero Featured Item (random from top 6 recent videos or first item)
      if (recentRes.items.length > 0) {
        const heroPool = recentRes.items.slice(0, Math.min(6, recentRes.items.length))
        const pickedHero = heroPool[Math.floor(Math.random() * heroPool.length)]
        setHeroItem(pickedHero)
      } else {
        // Fallback: fetch any media item if no videos exist
        const allRes = await listMedia({ sort: 'newest', page: 1, page_size: 20 })
        if (allRes.items.length > 0) {
          setHeroItem(allRes.items[0])
          setRecentlyAdded(allRes.items)
        }
      }

      // 2. Fetch Continue Watching (videos with duration_watched_seconds > 0)
      const watched = recentRes.items.filter((it) => it.duration_watched_seconds > 0)
      setContinueWatching(watched)

      // 3. Fetch Random Picks
      const randomRes = await listMedia({
        sort: 'random',
        media_type: 'video',
        page: 1,
        page_size: 20,
      })
      setRandomPicks(randomRes.items)

      // 4. Fetch Dynamic First-Level Folders (Categories)
      const topFoldersRes = await listFolders({ page: 1, page_size: 50 })
      const topFolders = topFoldersRes.items

      // For each first-level folder, fetch its items to generate dynamic category shelves
      const sectionPromises = topFolders.map(async (folder) => {
        try {
          const detail = await getFolder(folder.id, { page_size: 15, sort: 'newest' })
          return {
            folder,
            items: detail.media.items,
            total: detail.media.total,
          }
        } catch (err) {
          console.error(`Failed to load items for folder ${folder.name}:`, err)
          return null
        }
      })

      const sections = (await Promise.all(sectionPromises)).filter(
        (sec): sec is FolderSectionData => sec !== null && sec.items.length > 0
      )
      setFolderSections(sections)
    } catch (e) {
      console.error('Failed to load Home page data:', e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadHomeContent()
  }, [loadHomeContent])

  const handleOpenMedia = (item: MediaItem) => {
    navigate(`/watch/${item.id}`, { state: { from: '/' } })
  }

  const handleToggleFavorite = async (e: React.MouseEvent, item: MediaItem) => {
    e.stopPropagation()
    const nextFav = item.is_favorite ? 0 : 1
    try {
      await updateMediaItem(item.id, { is_favorite: Boolean(nextFav) })

      // Update state in all collections
      const updater = (list: MediaItem[]) =>
        list.map((it) => (it.id === item.id ? { ...it, is_favorite: nextFav } : it))

      setRecentlyAdded(updater)
      setRandomPicks(updater)
      setContinueWatching(updater)
      setFolderSections((prev) =>
        prev.map((sec) => ({
          ...sec,
          items: updater(sec.items),
        }))
      )
      if (heroItem?.id === item.id) {
        setHeroItem((prev) => (prev ? { ...prev, is_favorite: nextFav } : null))
      }
    } catch (err) {
      console.error('Failed to toggle favorite:', err)
    }
  }

  return (
    <div className="page-enter home-cinema-view">
      {/* ── HERO SECTION: Large Featured Media Card ────────────────────────── */}
      {heroItem && (
        <section className="home-hero-showcase">
          <div className="hero-backdrop-wrap">
            <img
              src={thumbnailUrl(heroItem.id)}
              alt={heroItem.title || heroItem.filename}
              className="hero-backdrop-img"
            />
            <div className="hero-gradient-overlay" />
            <div className="hero-side-gradient" />
          </div>

          <div className="hero-content-panel">
            <div className="hero-badge-row">
              <span className="hero-badge-tag">
                {heroItem.media_type === 'video' ? 'Featured Video' : 'Featured Media'}
              </span>
              {heroItem.resolution && (
                <span className="hero-meta-badge">
                  {cleanResolution(heroItem.resolution) || heroItem.resolution}
                </span>
              )}
              {heroItem.duration_seconds && (
                <span className="hero-meta-badge">
                  {formatDuration(heroItem.duration_seconds)}
                </span>
              )}
              {heroItem.codec && (
                <span className="hero-meta-badge">{heroItem.codec.toUpperCase()}</span>
              )}
            </div>

            <h1 className="hero-title" title={heroItem.title || heroItem.filename}>
              {heroItem.title || heroItem.filename}
            </h1>

            <div className="hero-folder-tag">
              📁 {heroItem.folder_label || heroItem.folder_name}
            </div>

            <div className="hero-actions-row">
              <button
                className="hero-btn-play"
                onClick={() => handleOpenMedia(heroItem)}
                type="button"
              >
                <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
                  <polygon points="5 3 19 12 5 21 5 3" />
                </svg>
                <span>Play Now</span>
              </button>

              <button
                className="hero-btn-details"
                onClick={() => navigate(`/explore?folder_id=${heroItem.folder_id}`)}
                type="button"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <rect x="3" y="3" width="7" height="7" />
                  <rect x="14" y="3" width="7" height="7" />
                  <rect x="14" y="14" width="7" height="7" />
                  <rect x="3" y="14" width="7" height="7" />
                </svg>
                <span>View Folder</span>
              </button>

              <button
                className={`hero-btn-fav${heroItem.is_favorite ? ' active' : ''}`}
                onClick={(e) => handleToggleFavorite(e, heroItem)}
                type="button"
                aria-label="Toggle favorite"
                title={heroItem.is_favorite ? 'Remove from Saved' : 'Save to Favorites'}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill={heroItem.is_favorite ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2">
                  <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
                </svg>
              </button>
            </div>
          </div>
        </section>
      )}

      {/* ── CONTINUE WATCHING (Hidden if no watch history exists) ───────────── */}
      {continueWatching.length > 0 && (
        <MediaShelf
          title="Continue Watching"
          subtitle="Resume playback where you left off"
          items={continueWatching}
          onItemClick={handleOpenMedia}
          onToggleFavorite={handleToggleFavorite}
          showProgress={true}
        />
      )}

      {/* ── RECENTLY ADDED ─────────────────────────────────────────────────── */}
      <MediaShelf
        title="Recently Added"
        subtitle="Latest additions to your library"
        moreLink="/explore"
        moreLabel="View All →"
        items={recentlyAdded}
        onItemClick={handleOpenMedia}
        onToggleFavorite={handleToggleFavorite}
      />

      {/* ── RANDOM PICKS ───────────────────────────────────────────────────── */}
      <MediaShelf
        title="Random Picks"
        subtitle="Surprise picks & hidden gems from your library"
        items={randomPicks}
        onItemClick={handleOpenMedia}
        onToggleFavorite={handleToggleFavorite}
      />

      {/* ── DYNAMIC FOLDER SECTIONS (Categories from 1st-level folders) ─────── */}
      {folderSections.map((sec) => (
        <MediaShelf
          key={sec.folder.id}
          title={sec.folder.display_name || sec.folder.name}
          subtitle={`${sec.total.toLocaleString()} item${sec.total === 1 ? '' : 's'}`}
          moreLink={`/folders/${sec.folder.id}`}
          moreLabel={`Explore ${sec.folder.display_name || sec.folder.name} (${sec.total}) →`}
          items={sec.items}
          onItemClick={handleOpenMedia}
          onToggleFavorite={handleToggleFavorite}
        />
      ))}

      {/* Empty State fallback if entire library has no items */}
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
}
