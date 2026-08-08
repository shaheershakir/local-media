import { useState, memo } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import type { MediaItem } from '../api/types'
import { thumbnailUrl, updateMediaItem } from '../api/media'
import { cleanResolution } from './VideoCard'

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

export interface ImageCardProps {
  item: MediaItem
  layout?: 'grid' | 'compact' | 'shelf'
  showFolderTag?: boolean
  onItemClick?: (item: MediaItem) => void
  onToggleFavorite?: (e: React.MouseEvent, item: MediaItem) => void
}

/**
 * Dedicated, highly optimized, memoized ImageCard component.
 * Features asynchronous lazy image decoding, format tags (JPEG, PNG, HEIC, etc.),
 * resolution pills, hover zoom preview overlays, optimistic favorite toggle,
 * and seamless keyboard accessibility.
 */
export const ImageCard = memo(function ImageCard({
  item,
  layout = 'grid',
  showFolderTag = true,
  onItemClick,
  onToggleFavorite,
}: ImageCardProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const [isFavorite, setIsFavorite] = useState(Boolean(item.is_favorite))
  const [imageLoaded, setImageLoaded] = useState(false)

  const resTag = cleanResolution(item.resolution)
  const ext = getImageExtension(item.filename)

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
      className={`image-card image-card-${layout}`}
      onClick={handleClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && handleClick()}
      aria-label={`View photo ${item.title || item.filename}`}
    >
      {/* Thumbnail Container */}
      <div className={`image-card-thumb-wrap ${item.orientation || 'landscape'}`}>
        {item.orientation === 'portrait' && (
          <img
            src={thumbnailUrl(item.id)}
            alt=""
            className="image-card-thumb-blur"
            aria-hidden="true"
          />
        )}
        <img
          src={thumbnailUrl(item.id)}
          alt={item.title || item.filename}
          loading="lazy"
          decoding="async"
          onLoad={() => setImageLoaded(true)}
          className={`image-card-thumb-img${imageLoaded ? ' loaded' : ''}`}
        />

        {/* Hover View Overlay */}
        <div className="image-card-view-overlay">
          <div className="image-card-view-icon" title="Open Photo">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
            </svg>
          </div>
        </div>

        {/* Format / Extension Badge (Top-Left) */}
        <span className="image-card-badge image-card-format">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" style={{ marginRight: 3 }}>
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" fill="none" stroke="currentColor" strokeWidth="2"/>
            <circle cx="8.5" cy="8.5" r="1.5"/>
            <polyline points="21 15 16 10 5 21"/>
          </svg>
          {ext}
        </span>

        {/* Resolution Badge (Top-Right / Beside Format) */}
        {resTag && (
          <span className="image-card-badge image-card-res">
            {resTag}
          </span>
        )}

        {/* Favorite Button on Hover */}
        <button
          className={`image-card-fav-btn${isFavorite ? ' active' : ''}`}
          onClick={handleFavoriteClick}
          type="button"
          aria-label="Toggle favorite"
          title={isFavorite ? 'Remove from Saved' : 'Save to Favorites'}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill={isFavorite ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2">
            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
          </svg>
        </button>

        {/* Bottom File Size Badge */}
        {item.file_size_bytes && (
          <span className="image-card-badge image-card-size">
            {formatBytes(item.file_size_bytes)}
          </span>
        )}
      </div>

      {/* Card Info Details */}
      <div className="image-card-info">
        <h3 className="image-card-title" title={item.title || item.filename}>
          {item.title || item.filename}
        </h3>

        <div className="image-card-meta">
          {showFolderTag && (item.folder_label || item.folder_name) && (
            <span className="image-card-folder">
              📁 {item.folder_label || item.folder_name}
            </span>
          )}

          {item.resolution && (
            <span className="image-card-dim">
              • {item.resolution}
            </span>
          )}
        </div>
      </div>
    </div>
  )
})
