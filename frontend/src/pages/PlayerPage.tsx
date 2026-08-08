import { useState, useEffect } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { getMediaItem, updateMediaItem } from '../api/media'
import { getFolder } from '../api/folders'
import type { MediaItem, Folder } from '../api/types'
import { formatDuration, cleanResolution } from '../components/VideoCard'
import { VideoPlayer } from '../components/VideoPlayer'
import { ImageViewer } from '../components/ImageViewer'
import { FolderRow } from '../components/FolderRow'
import { RecommendationSidebar } from '../components/RecommendationSidebar'
import { useNavigationStack } from '../hooks/useNavigationStack'

function formatBytes(bytes?: number | null): string {
  if (!bytes) return ''
  const mb = bytes / (1024 * 1024)
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`
  return `${mb.toFixed(1)} MB`
}

function getImageExtension(filename: string): string {
  const match = filename.match(/\.([0-9a-z]+)(?:[?#]|$)/i)
  return match ? match[1].toUpperCase() : 'PHOTO'
}

/**
 * Dedicated Player Page with modular VideoPlayer (for videos),
 * ImageViewer with on-screen next/prev arrows and keyboard navigation (for photos),
 * FolderRow (other media from same folder), and RecommendationSidebar.
 */
export function PlayerPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const { goBack } = useNavigationStack()

  const [item, setItem] = useState<MediaItem | null>(null)
  const [folder, setFolder] = useState<Folder | null>(null)
  const [allFolderMedia, setAllFolderMedia] = useState<MediaItem[]>([])
  const [sameFolderSiblings, setSameFolderSiblings] = useState<MediaItem[]>([])
  const [isFavorite, setIsFavorite] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const mediaId = Number(id)

  // 1. Fetch current media item & folder sibling media
  useEffect(() => {
    if (!mediaId || isNaN(mediaId)) return

    let cancelled = false
    setLoading(true)
    setError(null)
    window.scrollTo({ top: 0, behavior: 'smooth' })

    const loadData = async () => {
      try {
        const media = await getMediaItem(mediaId)
        if (cancelled) return
        setItem(media)
        setIsFavorite(Boolean(media.is_favorite))

        // 2. Fetch sibling media items from the exact same folder
        if (media.folder_id) {
          try {
            const folderRes = await getFolder(media.folder_id, { page_size: 100, sort: 'name' })
            if (!cancelled) {
              setFolder(folderRes.folder)
              const rawItems = folderRes.media.items || []
              setAllFolderMedia(rawItems)
              // Filter out the active item so only sibling items are shown in the bottom shelf
              const siblings = rawItems.filter((v) => v.id !== media.id)
              setSameFolderSiblings(siblings)
            }
          } catch (fErr) {
            console.error('Failed to load folder siblings:', fErr)
          }
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Unable to load media')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    loadData()

    return () => {
      cancelled = true
    }
  }, [mediaId])

  const handleToggleFavorite = async () => {
    if (!item) return
    const nextFav = isFavorite ? 0 : 1
    setIsFavorite(Boolean(nextFav))
    try {
      await updateMediaItem(item.id, { is_favorite: Boolean(nextFav) })
    } catch (err) {
      console.error('Failed to update favorite status:', err)
      setIsFavorite(Boolean(item.is_favorite))
    }
  }

  const handleNavigateMedia = (nextItem: MediaItem) => {
    navigate(`/watch/${nextItem.id}`, { state: { from: location.pathname } })
  }

  if (loading && !item) {
    return (
      <div className="player-loading-stage">
        <div className="skeleton player-skeleton-theater" />
        <div className="text-muted t-label">Loading media…</div>
      </div>
    )
  }

  if (error || !item) {
    return (
      <div className="page-enter empty-state" style={{ minHeight: '60dvh' }}>
        <svg className="empty-state-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
        <div className="empty-state-title">Media Unavailable</div>
        <div className="empty-state-body">{error || 'This media item could not be found.'}</div>
        <button className="btn-primary" onClick={goBack}>
          Go Back
        </button>
      </div>
    )
  }

  const resTag = cleanResolution(item.resolution)
  const isImage = item.media_type === 'image'
  const ext = getImageExtension(item.filename)

  return (
    <div className="page-enter player-page-container">
      {/* ── 2-Column Responsive Layout: Main Column (Left) + Recommendation Sidebar (Right) ── */}
      <div className="player-layout-grid">
        {/* ── LEFT COLUMN: Main Theater (VideoPlayer or ImageViewer), Metadata Bar, FolderRow ── */}
        <main className="player-main-column">
          {/* Main Theater: Render ImageViewer for photos with next/prev arrows, VideoPlayer for videos */}
          {isImage ? (
            <ImageViewer
              item={item}
              folderItems={allFolderMedia}
              onNavigateItem={handleNavigateMedia}
            />
          ) : (
            <VideoPlayer item={item} />
          )}

          {/* Media Metadata Header & Actions Bar */}
          <div className="player-meta-header">
            <div className="player-title-row">
              <h1 className="player-video-title">{item.title || item.filename}</h1>

              {/* Action Buttons */}
              <div className="player-action-buttons">
                <button
                  className={`player-action-pill${isFavorite ? ' active' : ''}`}
                  onClick={handleToggleFavorite}
                  type="button"
                  aria-label="Toggle favorite"
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill={isFavorite ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2">
                    <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
                  </svg>
                  <span>{isFavorite ? 'Saved' : 'Save'}</span>
                </button>

                {item.folder_id && (
                  <button
                    className="player-action-pill"
                    onClick={() => navigate(`/folders/${item.folder_id}`)}
                    type="button"
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                    </svg>
                    <span>Folder</span>
                  </button>
                )}

                {item.path && window.localfeed?.revealPath && (
                  <button
                    className="player-action-pill"
                    onClick={() => window.localfeed?.revealPath(item.path)}
                    type="button"
                    title="Reveal file in Windows Explorer"
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                      <polyline points="15 3 21 3 21 9" />
                      <line x1="10" y1="14" x2="21" y2="3" />
                    </svg>
                    <span>Reveal</span>
                  </button>
                )}
              </div>
            </div>

            {/* Metadata Tags Row */}
            <div className="player-meta-tags-row">
              {item.folder_name && (
                <span
                  className="player-tag-folder"
                  onClick={() => navigate(`/folders/${item.folder_id}`)}
                  role="button"
                  tabIndex={0}
                >
                  📁 {item.folder_display_name || item.folder_name}
                </span>
              )}
              <span className="player-tag-badge">{ext}</span>
              {resTag && <span className="player-tag-badge">{resTag}</span>}
              {item.codec && <span className="player-tag-badge">{item.codec.toUpperCase()}</span>}
              {item.file_size_bytes && <span className="player-tag-badge">{formatBytes(item.file_size_bytes)}</span>}
              {item.duration_seconds && !isImage && (
                <span className="player-tag-badge">{formatDuration(item.duration_seconds)}</span>
              )}
            </div>
          </div>

          {/* ── SAME FOLDER SECTION: Other media from the same folder ──────── */}
          <FolderRow
            folder={folder}
            items={sameFolderSiblings}
            onItemClick={handleNavigateMedia}
            onExploreFolder={
              item.folder_id ? () => navigate(`/folders/${item.folder_id}`) : undefined
            }
          />
        </main>

        {/* ── RIGHT COLUMN: Recommendation Sidebar with Infinite Scroll ── */}
        <RecommendationSidebar
          currentMediaId={item.id}
          folderId={item.folder_id}
          onItemClick={handleNavigateMedia}
        />
      </div>
    </div>
  )
}
