import { useState } from 'react'
import type { MediaItem } from '../api/types'
import { thumbnailUrl, updateMediaItem } from '../api/media'
import { formatDuration, cleanResolution } from './VideoCard'

export interface HeroBannerProps {
  item: MediaItem
  onPlay: (item: MediaItem) => void
  onViewFolder: (folderId: number) => void
  onToggleFavorite?: (e: React.MouseEvent, item: MediaItem) => void
}

/**
 * Reusable HeroBanner component for featured media showcase.
 */
export function HeroBanner({
  item,
  onPlay,
  onViewFolder,
  onToggleFavorite,
}: HeroBannerProps) {
  const [isFavorite, setIsFavorite] = useState(Boolean(item.is_favorite))
  const resTag = cleanResolution(item.resolution)

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
      console.error('Failed to toggle favorite on hero banner:', err)
      setIsFavorite(Boolean(item.is_favorite))
    }
  }

  return (
    <section className="home-hero-showcase">
      {/* Backdrop Image & Cinematic Gradients */}
      <div className="hero-backdrop-wrap">
        <img
          src={thumbnailUrl(item.id)}
          alt={item.title || item.filename}
          className="hero-backdrop-img"
        />
        <div className="hero-gradient-overlay" />
        <div className="hero-side-gradient" />
      </div>

      {/* Content Overlay */}
      <div className="hero-content-panel">
        <div className="hero-badge-row">
          <span className="hero-badge-tag">
            {item.media_type === 'video' ? 'Featured Video' : 'Featured Media'}
          </span>
          {resTag && <span className="hero-meta-badge">{resTag}</span>}
          {item.duration_seconds && (
            <span className="hero-meta-badge">
              {formatDuration(item.duration_seconds)}
            </span>
          )}
          {item.codec && (
            <span className="hero-meta-badge">{item.codec.toUpperCase()}</span>
          )}
        </div>

        <h1 className="hero-title" title={item.title || item.filename}>
          {item.title || item.filename}
        </h1>

        {(item.folder_label || item.folder_name) && (
          <div className="hero-folder-tag">
            📁 {item.folder_label || item.folder_name}
          </div>
        )}

        <div className="hero-actions-row">
          <button
            className="hero-btn-play"
            onClick={() => onPlay(item)}
            type="button"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
              <polygon points="5 3 19 12 5 21 5 3" />
            </svg>
            <span>Play Now</span>
          </button>

          {item.folder_id && (
            <button
              className="hero-btn-details"
              onClick={() => onViewFolder(item.folder_id)}
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
          )}

          <button
            className={`hero-btn-fav${isFavorite ? ' active' : ''}`}
            onClick={handleFavoriteClick}
            type="button"
            aria-label="Toggle favorite"
            title={isFavorite ? 'Remove from Saved' : 'Save to Favorites'}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill={isFavorite ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2">
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
            </svg>
          </button>
        </div>
      </div>
    </section>
  )
}
