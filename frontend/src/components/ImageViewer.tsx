import { useState, useEffect, useRef, useCallback, memo } from 'react'
import { useNavigate } from 'react-router-dom'
import type { MediaItem } from '../api/types'
import { fullImageUrl, thumbnailUrl, updateMediaItem } from '../api/media'
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

export interface ImageViewerProps {
  item: MediaItem
  folderItems?: MediaItem[]
  onNavigateItem?: (item: MediaItem) => void
  onClose?: () => void
  className?: string
}

/**
 * High-performance Photo App Viewer / Lightbox.
 * Features:
 * - Full-height immersive display: Image expands to the full available screen height.
 * - Auto-hiding bottom filmstrip: Hidden by default, only visible when mouse moves to lower part of the screen.
 * - Floating Left and Right on-screen navigation arrow buttons.
 * - Full keyboard navigation (ArrowLeft, ArrowRight, Escape, F, S, Zoom +/-).
 * - Sibling photo awareness for the active folder with position counter (e.g. Photo 70 of 100).
 * - Proactive adjacent image memory preloading for zero-latency instant transitions.
 * - Zoom & Pan / Fit to screen toggle.
 * - Fullscreen mode support & optimistic favorite toggling.
 */
export const ImageViewer = memo(function ImageViewer({
  item,
  folderItems = [],
  onNavigateItem,
  onClose,
  className = '',
}: ImageViewerProps) {
  const navigate = useNavigate()
  const stageRef = useRef<HTMLDivElement>(null)
  const filmstripRef = useRef<HTMLDivElement>(null)
  const hoverHideTimer = useRef<number | null>(null)

  const [isFullscreen, setIsFullscreen] = useState(false)
  const [isZoomed, setIsZoomed] = useState(false)
  const [zoomScale, setZoomScale] = useState(1)
  const [isFavorite, setIsFavorite] = useState(Boolean(item.is_favorite))
  const [imageLoaded, setImageLoaded] = useState(false)
  const [activeImageId, setActiveImageId] = useState(item.id)
  const [isMouseAtBottom, setIsMouseAtBottom] = useState(false)

  // Filter only images from folder items for sibling navigation
  const siblingPhotos = folderItems.length > 0
    ? folderItems.filter((i) => i.media_type === 'image')
    : [item]

  // Find current index in sibling images
  const currentIndex = siblingPhotos.findIndex((i) => i.id === item.id)
  const effectiveIndex = currentIndex >= 0 ? currentIndex : 0
  const hasPrev = effectiveIndex > 0
  const hasNext = effectiveIndex < siblingPhotos.length - 1
  const totalPhotos = Math.max(1, siblingPhotos.length)

  // Reset zoom & mark active item when item changes
  useEffect(() => {
    setActiveImageId(item.id)
    setIsFavorite(Boolean(item.is_favorite))
    setImageLoaded(false)
    setIsZoomed(false)
    setZoomScale(1)
  }, [item.id, item.is_favorite])

  // 1. Proactive Memory Preloading of Adjacent Images
  useEffect(() => {
    if (siblingPhotos.length <= 1) return

    // Preload next photo
    if (hasNext) {
      const nextItem = siblingPhotos[effectiveIndex + 1]
      const nextImg = new Image()
      nextImg.src = fullImageUrl(nextItem.id)
    }

    // Preload previous photo
    if (hasPrev) {
      const prevItem = siblingPhotos[effectiveIndex - 1]
      const prevImg = new Image()
      prevImg.src = fullImageUrl(prevItem.id)
    }

    // Preload 2nd next photo
    if (effectiveIndex + 2 < siblingPhotos.length) {
      const next2 = siblingPhotos[effectiveIndex + 2]
      const img2 = new Image()
      img2.src = fullImageUrl(next2.id)
    }
  }, [effectiveIndex, siblingPhotos, hasNext, hasPrev])

  // 2. Auto-scroll active thumbnail in filmstrip into view when filmstrip is visible
  useEffect(() => {
    if (!isMouseAtBottom) return
    const strip = filmstripRef.current
    if (!strip) return
    const activeThumb = strip.querySelector('.image-viewer-filmstrip-thumb.active') as HTMLElement | null
    if (activeThumb) {
      activeThumb.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' })
    }
  }, [item.id, isMouseAtBottom])

  // 3. Mouse Movement Tracking for Lower Screen Hover Zone
  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const el = stageRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const yFromTop = e.clientY - rect.top
    const containerHeight = rect.height

    // If mouse is within the bottom 150px of the viewer or lower 22% of screen
    if (containerHeight - yFromTop <= 160 || (containerHeight > 0 && yFromTop / containerHeight >= 0.78)) {
      if (hoverHideTimer.current) {
        clearTimeout(hoverHideTimer.current)
        hoverHideTimer.current = null
      }
      setIsMouseAtBottom(true)
    } else {
      if (!hoverHideTimer.current) {
        hoverHideTimer.current = window.setTimeout(() => {
          setIsMouseAtBottom(false)
          hoverHideTimer.current = null
        }, 350)
      }
    }
  }, [])

  const handleMouseLeave = useCallback(() => {
    if (hoverHideTimer.current) clearTimeout(hoverHideTimer.current)
    setIsMouseAtBottom(false)
  }, [])

  // Navigation Handlers
  const handlePrev = useCallback(() => {
    if (!hasPrev) return
    const prevItem = siblingPhotos[effectiveIndex - 1]
    if (onNavigateItem) {
      onNavigateItem(prevItem)
    } else {
      navigate(`/watch/${prevItem.id}`, { replace: true })
    }
  }, [hasPrev, siblingPhotos, effectiveIndex, onNavigateItem, navigate])

  const handleNext = useCallback(() => {
    if (!hasNext) return
    const nextItem = siblingPhotos[effectiveIndex + 1]
    if (onNavigateItem) {
      onNavigateItem(nextItem)
    } else {
      navigate(`/watch/${nextItem.id}`, { replace: true })
    }
  }, [hasNext, siblingPhotos, effectiveIndex, onNavigateItem, navigate])

  const handleSelectThumbnail = useCallback((selectedItem: MediaItem) => {
    if (selectedItem.id === item.id) return
    if (onNavigateItem) {
      onNavigateItem(selectedItem)
    } else {
      navigate(`/watch/${selectedItem.id}`, { replace: true })
    }
  }, [item.id, onNavigateItem, navigate])

  // Toggle Favorite
  const handleToggleFavorite = async () => {
    const nextFav = isFavorite ? 0 : 1
    setIsFavorite(Boolean(nextFav))
    try {
      await updateMediaItem(item.id, { is_favorite: Boolean(nextFav) })
    } catch (err) {
      console.error('Failed to update favorite status:', err)
      setIsFavorite(Boolean(item.is_favorite))
    }
  }

  // Toggle Fullscreen
  const toggleFullscreen = useCallback(async () => {
    const el = stageRef.current
    if (!el) return
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen()
      } else {
        await el.requestFullscreen()
      }
    } catch {
      // Browser declined fullscreen silently
    }
  }, [])

  useEffect(() => {
    const onFullscreenChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement))
    }
    document.addEventListener('fullscreenchange', onFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange)
  }, [])

  // Zoom Controls
  const toggleZoom = useCallback(() => {
    setIsZoomed((prev) => {
      const next = !prev
      setZoomScale(next ? 2 : 1)
      return next
    })
  }, [])

  const handleZoomIn = useCallback(() => {
    setIsZoomed(true)
    setZoomScale((prev) => Math.min(4, Math.round((prev + 0.5) * 10) / 10))
  }, [])

  const handleZoomOut = useCallback(() => {
    setZoomScale((prev) => {
      const next = Math.max(1, Math.round((prev - 0.5) * 10) / 10)
      if (next === 1) setIsZoomed(false)
      return next
    })
  }, [])

  const handleResetZoom = useCallback(() => {
    setIsZoomed(false)
    setZoomScale(1)
  }, [])

  // 4. Keyboard Navigation (ArrowLeft, ArrowRight, Escape, F, S, Zoom +/-)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return

      if (e.key === 'ArrowRight' || e.code === 'Space' || e.key === 'PageDown') {
        e.preventDefault()
        handleNext()
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault()
        handlePrev()
      } else if (e.key === 'Escape') {
        if (isZoomed) {
          e.preventDefault()
          handleResetZoom()
        } else if (onClose) {
          e.preventDefault()
          onClose()
        }
      } else if (e.key === 'f' || e.key === 'F') {
        e.preventDefault()
        toggleFullscreen()
      } else if (e.key === 's' || e.key === 'S') {
        e.preventDefault()
        handleToggleFavorite()
      } else if (e.key === '+' || e.key === '=') {
        e.preventDefault()
        handleZoomIn()
      } else if (e.key === '-' || e.key === '_') {
        e.preventDefault()
        handleZoomOut()
      } else if (e.key === '0') {
        e.preventDefault()
        handleResetZoom()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [handleNext, handlePrev, onClose, isZoomed, handleResetZoom, toggleFullscreen, handleZoomIn, handleZoomOut])

  const resTag = cleanResolution(item.resolution)
  const ext = getImageExtension(item.filename)

  return (
    <div
      ref={stageRef}
      className={`image-viewer-container ${className}${isFullscreen ? ' fullscreen' : ''}`}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      {/* ── Top Floating Toolbar Overlay ─────────────────────────────────────── */}
      <div className="image-viewer-toolbar">
        <div className="image-viewer-toolbar-left">
          {/* Position counter badge */}
          <div className="image-viewer-counter-badge" title={`${effectiveIndex + 1} of ${totalPhotos} photos in this folder`}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <polyline points="21 15 16 10 5 21" />
            </svg>
            <span>{effectiveIndex + 1} / {totalPhotos}</span>
          </div>

          {/* Folder Tag */}
          {item.folder_name && (
            <button
              className="image-viewer-folder-btn"
              type="button"
              onClick={() => navigate(`/folders/${item.folder_id}`)}
              title="Open folder in library"
            >
              📁 {item.folder_display_name || item.folder_name}
            </button>
          )}

          {/* Format & Resolution Badges */}
          <span className="image-viewer-pill">{ext}</span>
          {resTag && <span className="image-viewer-pill">{resTag}</span>}
          {item.file_size_bytes && <span className="image-viewer-pill">{formatBytes(item.file_size_bytes)}</span>}
        </div>

        <div className="image-viewer-toolbar-right">
          {/* Zoom controls */}
          <div className="image-viewer-zoom-group">
            <button
              className="image-viewer-ctrl-btn"
              type="button"
              onClick={handleZoomOut}
              disabled={zoomScale <= 1}
              title="Zoom out (-)"
              aria-label="Zoom out"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
                <line x1="8" y1="11" x2="14" y2="11" />
              </svg>
            </button>

            <button
              className={`image-viewer-ctrl-btn${isZoomed ? ' active' : ''}`}
              type="button"
              onClick={toggleZoom}
              title="Toggle Fit / 100% (0)"
              aria-label="Toggle zoom"
            >
              <span style={{ fontSize: 11, fontWeight: 600 }}>{Math.round(zoomScale * 100)}%</span>
            </button>

            <button
              className="image-viewer-ctrl-btn"
              type="button"
              onClick={handleZoomIn}
              disabled={zoomScale >= 4}
              title="Zoom in (+)"
              aria-label="Zoom in"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
                <line x1="11" y1="8" x2="11" y2="14" />
                <line x1="8" y1="11" x2="14" y2="11" />
              </svg>
            </button>
          </div>

          {/* Reveal in explorer */}
          {item.path && window.localfeed?.revealPath && (
            <button
              className="image-viewer-ctrl-btn"
              type="button"
              onClick={() => window.localfeed?.revealPath(item.path)}
              title="Reveal in Windows Explorer"
              aria-label="Reveal in Explorer"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                <polyline points="15 3 21 3 21 9" />
                <line x1="10" y1="14" x2="21" y2="3" />
              </svg>
            </button>
          )}

          {/* Save / Favorite toggle */}
          <button
            className={`image-viewer-ctrl-btn${isFavorite ? ' active' : ''}`}
            type="button"
            onClick={handleToggleFavorite}
            title={isFavorite ? 'Remove from Saved (S)' : 'Save to Favorites (S)'}
            aria-label="Toggle favorite"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill={isFavorite ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2">
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
            </svg>
          </button>

          {/* Fullscreen toggle */}
          <button
            className="image-viewer-ctrl-btn"
            type="button"
            onClick={toggleFullscreen}
            title={isFullscreen ? 'Exit fullscreen (F)' : 'Fullscreen (F)'}
            aria-label="Fullscreen"
          >
            {isFullscreen ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M8 3v5H3m13-5v5h5M8 21v-5H3m18 0h-5v5" />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M3 8V3h5m8 0h5v5M3 16v5h5m8 0h5v-5" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {/* ── Main Photo Theater Display Stage ───────────────────────────────── */}
      <div
        className={`image-viewer-stage${isZoomed ? ' zoomed' : ''}`}
        onClick={toggleZoom}
        title={isZoomed ? 'Click to fit screen' : 'Click to zoom in'}
      >
        {/* Placeholder thumbnail for instant visual feedback */}
        {!imageLoaded && (
          <img
            src={thumbnailUrl(item.id)}
            alt=""
            aria-hidden="true"
            className="image-viewer-stage-placeholder"
          />
        )}

        {/* Full-resolution photo taking up the full screen height/width */}
        <img
          key={activeImageId}
          src={fullImageUrl(item.id)}
          alt={item.title || item.filename}
          loading="eager"
          decoding="async"
          onLoad={() => setImageLoaded(true)}
          style={{
            transform: `scale(${zoomScale})`,
            transition: isZoomed ? 'transform 0.2s cubic-bezier(0.2, 0, 0, 1)' : 'none',
          }}
          className={`image-viewer-stage-media${imageLoaded ? ' loaded' : ''}`}
        />

        {/* ── Floating Left On-Screen Arrow Button ─────────────────────────── */}
        <button
          className={`image-viewer-arrow-btn image-viewer-arrow-left${!hasPrev ? ' disabled' : ''}`}
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            handlePrev()
          }}
          disabled={!hasPrev}
          aria-label="Previous photo in folder (Left Arrow)"
          title="Previous photo (← Left Arrow)"
        >
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>

        {/* ── Floating Right On-Screen Arrow Button ────────────────────────── */}
        <button
          className={`image-viewer-arrow-btn image-viewer-arrow-right${!hasNext ? ' disabled' : ''}`}
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            handleNext()
          }}
          disabled={!hasNext}
          aria-label="Next photo in folder (Right Arrow)"
          title="Next photo (→ Right Arrow)"
        >
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
            <path d="M9 18l6-6-6-6" />
          </svg>
        </button>
      </div>

      {/* ── Auto-Hiding Bottom Filmstrip Thumbnail Carousel ─────────────────── */}
      {siblingPhotos.length > 1 && (
        <div
          className={`image-viewer-filmstrip-drawer${isMouseAtBottom ? ' visible' : ''}`}
          onMouseEnter={() => {
            if (hoverHideTimer.current) clearTimeout(hoverHideTimer.current)
            setIsMouseAtBottom(true)
          }}
        >
          <div ref={filmstripRef} className="image-viewer-filmstrip">
            {siblingPhotos.map((photo, idx) => {
              const isActive = photo.id === item.id
              return (
                <button
                  key={photo.id}
                  type="button"
                  onClick={() => handleSelectThumbnail(photo)}
                  className={`image-viewer-filmstrip-thumb${isActive ? ' active' : ''}`}
                  title={`${idx + 1}. ${photo.title || photo.filename}`}
                  aria-label={`Jump to photo ${idx + 1}`}
                >
                  <img
                    src={thumbnailUrl(photo.id)}
                    alt=""
                    loading="lazy"
                    decoding="async"
                  />
                  {isActive && <div className="image-viewer-filmstrip-indicator" />}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* ── Bottom Hover Peek Indicator when Filmstrip is Hidden ───────────── */}
      {siblingPhotos.length > 1 && !isMouseAtBottom && (
        <div className="image-viewer-bottom-peek">
          <div className="image-viewer-peek-pill">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M18 15l-6-6-6 6" />
            </svg>
            <span>Thumbnails ({totalPhotos})</span>
          </div>
        </div>
      )}
    </div>
  )
})
