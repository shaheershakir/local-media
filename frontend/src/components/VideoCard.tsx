import { useState, memo } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import type { MediaItem } from '../api/types'
import { thumbnailUrl, updateMediaItem } from '../api/media'

export function formatDuration(seconds?: number | null): string {
  if (!seconds || isNaN(seconds) || seconds < 0) return '0:00'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

export function cleanResolution(resolution?: string | null): string | null {
  if (!resolution) return null
  if (resolution.includes('3840') || resolution.includes('2160')) return '4K UHD'
  if (resolution.includes('1920') || resolution.includes('1080')) return '1080p HD'
  if (resolution.includes('1280') || resolution.includes('720')) return '720p HD'
  return resolution
}

export interface VideoCardProps {
  item: MediaItem
  layout?: 'grid' | 'compact' | 'shelf'
  showProgress?: boolean
  showFolderTag?: boolean
  onItemClick?: (item: MediaItem) => void
  onToggleFavorite?: (e: React.MouseEvent, item: MediaItem) => void
}

/**
 * Highly optimized, memoized YouTube / Plex-style VideoCard component.
 * Features asynchronous lazy image loading, duration badges, resolution pills,
 * playback progress tracks, and smooth hover micro-animations.
 */
export const VideoCard = memo(function VideoCard({
  item,
  layout = 'grid',
  showProgress = true,
  showFolderTag = true,
  onItemClick,
  onToggleFavorite,
}: VideoCardProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const [isFavorite, setIsFavorite] = useState(Boolean(item.is_favorite))
  const [imageLoaded, setImageLoaded] = useState(false)

  const progressPct =
    item.duration_seconds && item.duration_watched_seconds
      ? Math.min(100, Math.round((item.duration_watched_seconds / item.duration_seconds) * 100))
      : 0

  const resTag = cleanResolution(item.resolution)

  const handleClick = () => {
    if (onItemClick) {
      onItemClick(item)
    } else {
      navigate(`/watch/${item.id}`, {
        state: { from: `${location.pathname}${location.search}` },
      })
    }
  }

  const handleFavoriteClick = async (e: React.MouseEvent) => {
    e.stopPropagation()
    const nextFav = isFavorite ? 0 : 1
    setIsFavorite(Boolean(nextFav))
    try {
      await updateMediaItem(item.id, { is_favorite: Boolean(nextFav) })
      if (onToggleFavorite) {
        onToggleFavorite(e, { ...item, is_favorite: nextFav })
      }
    } catch (err) {
      console.error('Failed to toggle favorite:', err)
      setIsFavorite(Boolean(item.is_favorite))
    }
  }

  return (
    <div
      className={`video-card video-card-${layout}`}
      onClick={handleClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && handleClick()}
      aria-label={`Play ${item.title || item.filename}`}
    >
      {/* Thumbnail Container */}
      <div className="video-card-thumb-wrap">
        <img
          src={thumbnailUrl(item.id)}
          alt={item.title || item.filename}
          loading="lazy"
          decoding="async"
          onLoad={() => setImageLoaded(true)}
          className={`video-card-thumb-img${imageLoaded ? ' loaded' : ''}`}
        />

        {/* Hover Play Overlay */}
        <div className="video-card-play-overlay">
          <div className="video-card-play-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <polygon points="5 3 19 12 5 21 5 3" />
            </svg>
          </div>
        </div>

        {/* Duration Badge (Bottom-Right) */}
        {item.duration_seconds && item.media_type === 'video' && (
          <span className="video-card-badge video-card-duration">
            {formatDuration(item.duration_seconds)}
          </span>
        )}

        {/* Resolution Badge (Top-Left) */}
        {resTag && item.media_type === 'video' && (
          <span className="video-card-badge video-card-res">
            {resTag}
          </span>
        )}

        {/* Photo Badge (if photo) */}
        {item.media_type === 'image' && (
          <span className="video-card-badge video-card-photo-badge">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
              <path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z" />
            </svg>
          </span>
        )}

        {/* Favorite Button on Hover */}
        <button
          className={`video-card-fav-btn${isFavorite ? ' active' : ''}`}
          onClick={handleFavoriteClick}
          type="button"
          aria-label="Toggle favorite"
          title={isFavorite ? 'Remove from Saved' : 'Save to Favorites'}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill={isFavorite ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2">
            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
          </svg>
        </button>

        {/* Playback Progress Bar */}
        {showProgress && progressPct > 0 && (
          <div className="video-card-progress-track">
            <div className="video-card-progress-fill" style={{ width: `${progressPct}%` }} />
          </div>
        )}
      </div>

      {/* Card Info Details */}
      <div className="video-card-info">
        <h3 className="video-card-title" title={item.title || item.filename}>
          {item.title || item.filename}
        </h3>

        <div className="video-card-meta">
          {showFolderTag && (item.folder_label || item.folder_name) && (
            <span className="video-card-folder">
              {item.folder_label || item.folder_name}
            </span>
          )}

          {progressPct > 0 && showProgress ? (
            <span className="video-card-progress-text">
              • {progressPct}% watched
            </span>
          ) : (
            item.codec && (
              <span className="video-card-codec">
                • {item.codec.toUpperCase()}
              </span>
            )
          )}
        </div>
      </div>
    </div>
  )
})
