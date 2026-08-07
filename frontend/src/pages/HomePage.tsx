import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { listMedia, thumbnailUrl, updateMediaItem } from '../api/media'
import { listFolders } from '../api/folders'
import type { MediaItem, Folder } from '../api/types'
import { useScanStatus } from '../hooks/useScanStatus'

function formatDuration(seconds: number): string {
  if (!seconds || isNaN(seconds)) return '0:00'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

export function HomePage() {
  const navigate = useNavigate()
  const { status, triggerScan } = useScanStatus()

  const [recentItems, setRecentItems] = useState<MediaItem[]>([])
  const [inProgressItems, setInProgressItems] = useState<MediaItem[]>([])
  const [folders, setFolders] = useState<Folder[]>([])
  const [favorites, setFavorites] = useState<MediaItem[]>([])
  const [spotlightItem, setSpotlightItem] = useState<MediaItem | null>(null)
  const [stats, setStats] = useState({
    totalItems: 0,
    totalVideos: 0,
    totalPhotos: 0,
    totalFolders: 0,
    totalFavorites: 0,
  })
  const [loading, setLoading] = useState(true)
  const [quickSearch, setQuickSearch] = useState('')

  const loadHomeData = useCallback(async () => {
    setLoading(true)
    try {
      // 1. Fetch recent media items
      const recentRes = await listMedia({ sort: 'newest', page: 1, page_size: 16 })
      setRecentItems(recentRes.items)
      
      // 2. Fetch video counts and photo counts for stats
      const [videosRes, photosRes, favRes, foldersRes] = await Promise.all([
        listMedia({ media_type: 'video', page: 1, page_size: 1 }),
        listMedia({ media_type: 'image', page: 1, page_size: 1 }),
        listMedia({ favorites_only: true, page: 1, page_size: 8 }),
        listFolders({ page: 1, page_size: 8 }),
      ])

      setFavorites(favRes.items)
      setFolders(foldersRes.items)
      setStats({
        totalItems: recentRes.total,
        totalVideos: videosRes.total,
        totalPhotos: photosRes.total,
        totalFolders: foldersRes.total,
        totalFavorites: favRes.total,
      })

      // 3. Extract in-progress items (videos with duration_watched_seconds > 0)
      const inProgress = recentRes.items.filter(
        (it) => it.media_type === 'video' && it.duration_watched_seconds > 0
      )
      setInProgressItems(inProgress)

      // 4. Select spotlight item (first video or first item)
      const spotlight = recentRes.items.find((it) => it.media_type === 'video') || recentRes.items[0] || null
      setSpotlightItem(spotlight)
    } catch (e) {
      console.error('Failed to load Home data:', e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadHomeData()
  }, [loadHomeData])

  const handleOpenMedia = (item: MediaItem) => {
    navigate(`/media/${item.id}`, { state: { from: '/' } })
  }

  const handleToggleFavorite = async (e: React.MouseEvent, item: MediaItem) => {
    e.stopPropagation()
    const nextFav = item.is_favorite ? 0 : 1
    try {
      await updateMediaItem(item.id, { is_favorite: Boolean(nextFav) })
      setRecentItems((prev) =>
        prev.map((it) => (it.id === item.id ? { ...it, is_favorite: nextFav } : it))
      )
      setFavorites((prev) => {
        if (nextFav) {
          return [{ ...item, is_favorite: 1 }, ...prev]
        }
        return prev.filter((it) => it.id !== item.id)
      })
      if (spotlightItem?.id === item.id) {
        setSpotlightItem((prev) => (prev ? { ...prev, is_favorite: nextFav } : null))
      }
    } catch (err) {
      console.error('Failed to toggle favorite:', err)
    }
  }

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (quickSearch.trim()) {
      navigate(`/search?q=${encodeURIComponent(quickSearch.trim())}`)
    } else {
      navigate('/search')
    }
  }

  return (
    <div className="page-enter home-page">
      {/* Home Hero Header */}
      <header className="home-hero-header">
        <div className="home-hero-content">
          <div className="home-badge">
            <span className="home-badge-dot" />
            <span>Local Media Vault</span>
          </div>
          <h1 className="home-title">Cinema Home</h1>
          <p className="home-subtitle">
            Your personal high-fidelity video &amp; photo theater with instant playback.
          </p>

          {/* Quick Search Bar */}
          <form className="home-search-form" onSubmit={handleSearchSubmit}>
            <div className="home-search-bar">
              <svg className="home-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                type="search"
                className="home-search-input"
                placeholder="Search your library titles, filenames, folders…"
                value={quickSearch}
                onChange={(e) => setQuickSearch(e.target.value)}
              />
              <button type="submit" className="home-search-submit-btn">
                Search
              </button>
            </div>
          </form>

          {/* Library Stats Badges */}
          <div className="home-stats-row">
            <div className="home-stat-pill" onClick={() => navigate('/explore')}>
              <span className="home-stat-value">{stats.totalItems.toLocaleString()}</span>
              <span className="home-stat-label">Total Media</span>
            </div>
            <div className="home-stat-pill" onClick={() => navigate('/feed')}>
              <span className="home-stat-value">{stats.totalVideos.toLocaleString()}</span>
              <span className="home-stat-label">Videos</span>
            </div>
            <div className="home-stat-pill" onClick={() => navigate('/explore')}>
              <span className="home-stat-value">{stats.totalPhotos.toLocaleString()}</span>
              <span className="home-stat-label">Photos</span>
            </div>
            <div className="home-stat-pill" onClick={() => navigate('/folders')}>
              <span className="home-stat-value">{stats.totalFolders.toLocaleString()}</span>
              <span className="home-stat-label">Folders</span>
            </div>
            {stats.totalFavorites > 0 && (
              <div className="home-stat-pill home-stat-fav" onClick={() => navigate('/favorites')}>
                <span className="home-stat-value">{stats.totalFavorites.toLocaleString()}</span>
                <span className="home-stat-label">Saved</span>
              </div>
            )}
          </div>
        </div>

        {/* Spotlight Showcase Banner */}
        {spotlightItem && (
          <div className="home-spotlight-card" onClick={() => handleOpenMedia(spotlightItem)}>
            <div className="home-spotlight-media-wrap">
              <img
                src={thumbnailUrl(spotlightItem.id)}
                alt={spotlightItem.title || spotlightItem.filename}
                className="home-spotlight-img"
              />
              <div className="home-spotlight-gradient" />
              <div className="home-spotlight-play-badge">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                  <polygon points="5 3 19 12 5 21 5 3" />
                </svg>
              </div>
            </div>
            <div className="home-spotlight-info">
              <div className="home-spotlight-tag">
                {spotlightItem.media_type === 'video' ? 'Featured Video' : 'Featured Photo'}
                {spotlightItem.duration_seconds && ` • ${formatDuration(spotlightItem.duration_seconds)}`}
              </div>
              <h2 className="home-spotlight-title">
                {spotlightItem.title || spotlightItem.filename}
              </h2>
              <div className="home-spotlight-meta">
                <span>📁 {spotlightItem.folder_label || spotlightItem.folder_name}</span>
                {spotlightItem.resolution && <span>• {spotlightItem.resolution}</span>}
              </div>
              <div className="home-spotlight-actions" onClick={(e) => e.stopPropagation()}>
                <button
                  className="btn-primary home-spotlight-cta"
                  onClick={() => handleOpenMedia(spotlightItem)}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                    <polygon points="5 3 19 12 5 21 5 3" />
                  </svg>
                  Play in Cinema
                </button>
                <button
                  className="btn-secondary"
                  onClick={() => navigate('/feed')}
                >
                  Open Reels Feed
                </button>
              </div>
            </div>
          </div>
        )}
      </header>

      {/* Quick Navigation Hub */}
      <section className="home-section">
        <div className="home-section-header">
          <h2 className="home-section-title">Quick Navigation</h2>
          <span className="home-section-subtitle">Jump to any view</span>
        </div>
        <div className="home-nav-grid">
          <div className="home-nav-card home-nav-feed" onClick={() => navigate('/feed')}>
            <div className="home-nav-icon-wrap">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                <rect x="2" y="3" width="20" height="18" rx="2" fill="none" stroke="currentColor" strokeWidth="1.5" />
                <line x1="8" y1="21" x2="8" y2="3" stroke="currentColor" strokeWidth="1.5" />
                <line x1="16" y1="21" x2="16" y2="3" stroke="currentColor" strokeWidth="1.5" />
                <line x1="2" y1="12" x2="22" y2="12" stroke="currentColor" strokeWidth="1.5" />
              </svg>
            </div>
            <div className="home-nav-text">
              <div className="home-nav-card-title">Reels Feed</div>
              <div className="home-nav-card-desc">TikTok-style full-screen immersive video playback</div>
            </div>
            <div className="home-nav-arrow">→</div>
          </div>

          <div className="home-nav-card" onClick={() => navigate('/explore')}>
            <div className="home-nav-icon-wrap">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <rect x="3" y="3" width="7" height="7" />
                <rect x="14" y="3" width="7" height="7" />
                <rect x="14" y="14" width="7" height="7" />
                <rect x="3" y="14" width="7" height="7" />
              </svg>
            </div>
            <div className="home-nav-text">
              <div className="home-nav-card-title">Explore Library</div>
              <div className="home-nav-card-desc">Filter by videos, photos, sort newest &amp; duration</div>
            </div>
            <div className="home-nav-arrow">→</div>
          </div>

          <div className="home-nav-card" onClick={() => navigate('/folders')}>
            <div className="home-nav-icon-wrap">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
              </svg>
            </div>
            <div className="home-nav-text">
              <div className="home-nav-card-title">Folders</div>
              <div className="home-nav-card-desc">Browse directory albums and categorized collections</div>
            </div>
            <div className="home-nav-arrow">→</div>
          </div>

          <div className="home-nav-card" onClick={() => navigate('/favorites')}>
            <div className="home-nav-icon-wrap">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
              </svg>
            </div>
            <div className="home-nav-text">
              <div className="home-nav-card-title">Saved Favorites</div>
              <div className="home-nav-card-desc">Quickly access all bookmarked and starred media</div>
            </div>
            <div className="home-nav-arrow">→</div>
          </div>

          <div className="home-nav-card" onClick={() => navigate('/search')}>
            <div className="home-nav-icon-wrap">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
            </div>
            <div className="home-nav-text">
              <div className="home-nav-card-title">Search</div>
              <div className="home-nav-card-desc">Find exact titles, filenames, or folders instantly</div>
            </div>
            <div className="home-nav-arrow">→</div>
          </div>

          <div className="home-nav-card" onClick={() => navigate('/settings')}>
            <div className="home-nav-icon-wrap">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
            </div>
            <div className="home-nav-text">
              <div className="home-nav-card-title">Settings &amp; Sources</div>
              <div className="home-nav-card-desc">Add directories, manage roots, and rescan</div>
            </div>
            <div className="home-nav-arrow">→</div>
          </div>
        </div>
      </section>

      {/* Continue Watching / In Progress */}
      {inProgressItems.length > 0 && (
        <section className="home-section">
          <div className="home-section-header">
            <h2 className="home-section-title">Continue Watching</h2>
            <span className="home-section-subtitle">Pick up right where you left off</span>
          </div>
          <div className="home-shelf-scroll">
            {inProgressItems.map((item) => {
              const progressPct =
                item.duration_seconds && item.duration_watched_seconds
                  ? Math.min(100, Math.round((item.duration_watched_seconds / item.duration_seconds) * 100))
                  : 0
              return (
                <div
                  key={`prog-${item.id}`}
                  className="home-media-card"
                  onClick={() => handleOpenMedia(item)}
                >
                  <div className="home-media-thumb-wrap">
                    <img src={thumbnailUrl(item.id)} alt={item.title} loading="lazy" />
                    <div className="home-media-play-overlay">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                        <polygon points="5 3 19 12 5 21 5 3" />
                      </svg>
                    </div>
                    {item.duration_seconds && (
                      <div className="home-media-duration">
                        {formatDuration(item.duration_seconds)}
                      </div>
                    )}
                    {/* Progress Bar */}
                    <div className="home-media-progress-bg">
                      <div
                        className="home-media-progress-bar"
                        style={{ width: `${progressPct}%` }}
                      />
                    </div>
                  </div>
                  <div className="home-media-info">
                    <div className="home-media-title">{item.title || item.filename}</div>
                    <div className="home-media-sub">
                      {formatDuration(item.duration_watched_seconds)} watched ({progressPct}%)
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* Top Folders Shelf */}
      {folders.length > 0 && (
        <section className="home-section">
          <div className="home-section-header">
            <h2 className="home-section-title">Folders &amp; Collections</h2>
            <button className="home-section-more-btn" onClick={() => navigate('/folders')}>
              View All ({stats.totalFolders}) →
            </button>
          </div>
          <div className="home-shelf-scroll">
            {folders.map((f) => (
              <div
                key={f.id}
                className="home-folder-card"
                onClick={() => navigate(`/folders/${f.id}`)}
              >
                <div className="home-folder-thumb">
                  {f.cover_thumbnail_path ? (
                    <img src={thumbnailUrl(f.id)} alt={f.name} loading="lazy" />
                  ) : (
                    <div className="home-folder-placeholder">
                      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2">
                        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                      </svg>
                    </div>
                  )}
                </div>
                <div className="home-folder-info">
                  <div className="home-folder-name">{f.display_name || f.name}</div>
                  <div className="home-folder-count">{f.item_count.toLocaleString()} items</div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Recently Added Media */}
      <section className="home-section">
        <div className="home-section-header">
          <h2 className="home-section-title">Recently Added</h2>
          <button className="home-section-more-btn" onClick={() => navigate('/explore')}>
            Explore All ({stats.totalItems.toLocaleString()}) →
          </button>
        </div>

        {recentItems.length === 0 && !loading ? (
          <div className="empty-state">
            <svg className="empty-state-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <polyline points="21 15 16 10 5 21" />
            </svg>
            <div className="empty-state-title">Your library is empty</div>
            <div className="empty-state-body">
              Add your media sources in Settings and click Rescan Library.
            </div>
            <button className="btn-primary" onClick={() => navigate('/settings')}>
              Configure Sources
            </button>
          </div>
        ) : (
          <div className="home-recent-grid">
            {recentItems.map((item) => (
              <div
                key={item.id}
                className="home-grid-card"
                onClick={() => handleOpenMedia(item)}
              >
                <div className="home-grid-thumb-wrap">
                  <img src={thumbnailUrl(item.id)} alt={item.title} loading="lazy" />
                  <div className="home-grid-overlay">
                    {item.media_type === 'video' && (
                      <div className="home-grid-play-icon">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                          <polygon points="5 3 19 12 5 21 5 3" />
                        </svg>
                      </div>
                    )}
                  </div>

                  {/* Badges */}
                  {item.media_type === 'video' && item.duration_seconds && (
                    <div className="home-grid-duration">{formatDuration(item.duration_seconds)}</div>
                  )}
                  {item.media_type === 'image' && (
                    <div className="home-grid-photo-badge">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z" />
                      </svg>
                    </div>
                  )}

                  {/* Favorite Toggle Button */}
                  <button
                    className={`home-grid-fav-btn${item.is_favorite ? ' active' : ''}`}
                    onClick={(e) => handleToggleFavorite(e, item)}
                    type="button"
                    aria-label="Toggle favorite"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill={item.is_favorite ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2">
                      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
                    </svg>
                  </button>
                </div>

                <div className="home-grid-info">
                  <div className="home-grid-item-title" title={item.title || item.filename}>
                    {item.title || item.filename}
                  </div>
                  <div className="home-grid-item-folder">
                    {item.folder_label || item.folder_name}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Saved Favorites Shelf if any */}
      {favorites.length > 0 && (
        <section className="home-section">
          <div className="home-section-header">
            <h2 className="home-section-title">Saved Favorites</h2>
            <button className="home-section-more-btn" onClick={() => navigate('/favorites')}>
              View All ({stats.totalFavorites}) →
            </button>
          </div>
          <div className="home-shelf-scroll">
            {favorites.map((item) => (
              <div
                key={`fav-${item.id}`}
                className="home-media-card"
                onClick={() => handleOpenMedia(item)}
              >
                <div className="home-media-thumb-wrap">
                  <img src={thumbnailUrl(item.id)} alt={item.title} loading="lazy" />
                  <div className="home-media-play-overlay">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                      <polygon points="5 3 19 12 5 21 5 3" />
                    </svg>
                  </div>
                  {item.duration_seconds && (
                    <div className="home-media-duration">
                      {formatDuration(item.duration_seconds)}
                    </div>
                  )}
                </div>
                <div className="home-media-info">
                  <div className="home-media-title">{item.title || item.filename}</div>
                  <div className="home-media-sub">{item.folder_label || item.folder_name}</div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Library Rescan Trigger Banner */}
      <section className="home-rescan-bar">
        <div className="home-rescan-info">
          <div className="home-rescan-title">Library Index Status</div>
          <div className="home-rescan-desc">
            {status?.running
              ? `Scanning files… ${status.files_scanned.toLocaleString()} / ${status.files_total.toLocaleString()}`
              : `${stats.totalItems.toLocaleString()} media items indexed across ${stats.totalFolders} folders`}
          </div>
        </div>
        <button
          className="btn-secondary"
          onClick={triggerScan}
          disabled={status?.running}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M23 4v6h-6" />
            <path d="M1 20v-6h6" />
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
          </svg>
          {status?.running ? 'Scanning…' : 'Rescan Library'}
        </button>
      </section>
    </div>
  )
}
