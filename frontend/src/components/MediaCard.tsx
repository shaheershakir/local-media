import { useRef, useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import type { MediaItem } from '../api/types'
import { thumbnailUrl, streamUrl, fullImageUrl, updateMediaItem } from '../api/media'
import { logEvent } from '../api/scan'
import { useAudioPreference } from '../hooks/useAudioPreference'
import { useMpv } from '../hooks/useMpv'

// ── Config constants ──────────────────────────────────────────
const KEN_BURNS_ENABLED = true

interface MediaCardProps {
  item: MediaItem
  index: number
  isActive: boolean
  onCardVisible: (index: number) => void
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

function getFormatExtension(filename: string): string {
  const match = filename.match(/\.([0-9a-z]+)(?:[?#]|$)/i)
  return match ? match[1].toUpperCase() : ''
}

export function MediaCard({ item, index, isActive, onCardVisible }: MediaCardProps) {
  const navigate = useNavigate()
  const cardRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const { muted, setMuted, toggleMuted } = useAudioPreference()
  const { play: playMpv, isPlayingItem } = useMpv()
  const [progress, setProgress] = useState(0)
  const [isFav, setIsFav] = useState(Boolean(item.is_favorite))
  const viewStartTime = useRef<number>(0)
  const hasLoggedStart = useRef(false)

  const isLegacyFormat = item.media_type === 'video' && item.browser_native === 0
  const ext = getFormatExtension(item.filename)
  const isPlayingInMpv = isPlayingItem(item.id)

  // Track which card is in view for infinite scroll prefetch
  useEffect(() => {
    const card = cardRef.current
    if (!card) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          onCardVisible(index)
        }
      },
      { threshold: 0.5 }
    )
    observer.observe(card)
    return () => observer.disconnect()
  }, [index, onCardVisible])

  // Video autoplay via IntersectionObserver
  useEffect(() => {
    if (item.media_type !== 'video') return
    const video = videoRef.current
    if (!video) return

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0]
        if (entry.isIntersecting && entry.intersectionRatio >= 0.8) {
          video.play().catch(() => {
            setMuted(true)
            video.play().catch(() => {})
          })
          // Log view_start
          if (!hasLoggedStart.current) {
            hasLoggedStart.current = true
            viewStartTime.current = Date.now()
            logEvent({ media_item_id: item.id, event_type: 'view_start' })
          }
        } else {
          if (!video.paused) {
            logEvent({
              media_item_id: item.id,
              event_type: 'skip',
              watched_seconds: video.currentTime,
            })
            hasLoggedStart.current = false
          }
          video.pause()
          if (!isActive) {
            video.currentTime = 0
          }
        }
      },
      { threshold: [0, 0.8] }
    )
    observer.observe(video)
    return () => {
      observer.disconnect()
      if (!video.paused) {
        logEvent({
          media_item_id: item.id,
          event_type: 'view_end',
          watched_seconds: video.currentTime,
        })
      }
      video.pause()
      video.currentTime = 0
    }
  }, [item.id, item.media_type, isActive, setMuted])

  // Image view tracking
  useEffect(() => {
    if (item.media_type !== 'image' || !isActive) return
    viewStartTime.current = Date.now()
    logEvent({ media_item_id: item.id, event_type: 'view_start' })
    return () => {
      if (viewStartTime.current > 0) {
        const elapsed = (Date.now() - viewStartTime.current) / 1000
        logEvent({ media_item_id: item.id, event_type: 'view_end', watched_seconds: elapsed })
      }
    }
  }, [item.id, item.media_type, isActive])

  const handleVideoTimeUpdate = () => {
    const video = videoRef.current
    if (!video || !video.duration) return
    setProgress((video.currentTime / video.duration) * 100)
  }

  const handleFavorite = async (e: React.MouseEvent) => {
    e.stopPropagation()
    const newFav = !isFav
    setIsFav(newFav)
    await updateMediaItem(item.id, { is_favorite: newFav })
    if (newFav) logEvent({ media_item_id: item.id, event_type: 'favorite' })
  }

  const handleFullscreen = async (e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      await cardRef.current?.requestFullscreen()
    } catch {
      // Browser declined fullscreen
    }
  }

  const handlePlayWithMpv = async (e?: React.MouseEvent) => {
    if (e) e.stopPropagation()
    // Pause inline video before launching MPV
    if (videoRef.current && !videoRef.current.paused) {
      videoRef.current.pause()
    }
    const currentPos = videoRef.current?.currentTime || 0
    await playMpv(item, currentPos)
  }

  const handleCardClick = () => {
    if (item.media_type === 'video') {
      if (isLegacyFormat) {
        // Automatically launch MPV for non-browser native video formats
        handlePlayWithMpv()
      } else {
        // Toggle inline play/pause
        const video = videoRef.current
        if (video) {
          if (video.paused) {
            video.play().catch(() => {})
          } else {
            video.pause()
          }
        }
      }
    } else {
      // Photo — navigate to viewer
      navigate(`/media/${item.id}`, { state: { from: '/' } })
    }
  }

  const orientation = item.orientation || 'landscape'

  return (
    <div ref={cardRef} className={`reel-card ${orientation}`} onClick={handleCardClick}>
      {/* Media element */}
      {item.media_type === 'video' ? (
        <video
          ref={videoRef}
          className="reel-media-video"
          src={streamUrl(item.id)}
          muted={muted}
          loop
          playsInline
          preload="metadata"
          onTimeUpdate={handleVideoTimeUpdate}
          onEnded={() => {
            logEvent({ media_item_id: item.id, event_type: 'view_end', watched_seconds: item.duration_seconds ?? 0 })
          }}
        />
      ) : (
        <img
          className={`reel-media-image${KEN_BURNS_ENABLED && isActive ? ' ken-burns' : ''}`}
          src={isActive ? fullImageUrl(item.id) : thumbnailUrl(item.id)}
          alt={item.title}
          loading="lazy"
        />
      )}

      {/* Gradient overlay */}
      <div className="reel-overlay" />

      {/* Legacy Format / MPV Active Indicator */}
      {item.media_type === 'video' && (
        <div className="media-format-badges">
          {isPlayingInMpv && (
            <div className="badge-mpv-active">
              <span className="mpv-hud-dot" />
              MPV PLAYING
            </div>
          )}
          {isLegacyFormat && (
            <div className="badge-legacy-format" title="Legacy video format — supported via MPV Player">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
              {ext || 'LEGACY'}
            </div>
          )}
        </div>
      )}

      {/* Media type badge for images */}
      {item.media_type === 'image' && (
        <div className="media-type-badge">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" style={{ display: 'inline', marginRight: 4 }}>
            <path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/>
          </svg>
          photo
        </div>
      )}

      {/* Bottom info */}
      <div className="reel-info" onClick={(e) => e.stopPropagation()}>
        <button
          className="reel-folder-tag"
          onClick={() => navigate(`/folders/${item.folder_id}`)}
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
            <path d="M20 6h-8l-2-2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2z"/>
          </svg>
          {item.folder_label}
        </button>
        <div className="reel-title">{item.title}</div>
        {item.media_type === 'video' && item.duration_seconds && (
          <div className="reel-duration">{formatDuration(item.duration_seconds)}</div>
        )}
      </div>

      {/* Right action rail */}
      <div className="reel-actions" onClick={(e) => e.stopPropagation()}>
        {/* Favorite */}
        <button className={`reel-action-btn${isFav ? ' active' : ''}`} onClick={handleFavorite} aria-label="Favorite">
          <svg width="20" height="20" viewBox="0 0 24 24" fill={isFav ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.5">
            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
          </svg>
        </button>

        {/* MPV Cinema Player Trigger for Videos */}
        {item.media_type === 'video' && (
          <button
            className={`reel-action-btn btn-mpv-action${isPlayingInMpv ? ' active' : ''}`}
            onClick={handlePlayWithMpv}
            title="Play in MPV Cinema (Full Quality & Universal Formats)"
            aria-label="Play in MPV Cinema"
          >
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <polygon points="5 3 19 12 5 21 5 3" fill={isPlayingInMpv ? 'currentColor' : 'none'} />
            </svg>
          </button>
        )}

        {/* Mute toggle (video only) */}
        {item.media_type === 'video' && (
          <button
            className={`reel-action-btn${!muted ? ' active' : ''}`}
            onClick={toggleMuted}
            aria-label={muted ? 'Turn sound on' : 'Mute video'}
          >
            {muted ? (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
                <line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/>
              </svg>
            ) : (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
                <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>
              </svg>
            )}
          </button>
        )}

        <button className="reel-action-btn" type="button" onClick={handleFullscreen} aria-label="Open fullscreen">
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
            <path d="M3 8V3h5m8 0h5v5M3 16v5h5m8 0h5v-5" />
          </svg>
        </button>

        {/* Open in full viewer */}
        <button
          className="reel-action-btn"
          type="button"
          onClick={() => navigate(`/media/${item.id}`, { state: { from: '/' } })}
          aria-label="Open detail viewer"
          title="Open detail viewer"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
          </svg>
        </button>

        {/* Go to grid */}
        <button className="reel-action-btn" onClick={() => navigate(`/explore?folder_id=${item.folder_id}`)} aria-label="Folder items">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
            <rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>
          </svg>
        </button>
      </div>

      {/* Video progress bar */}
      {item.media_type === 'video' && (
        <div className="reel-progress">
          <div className="reel-progress-fill" style={{ width: `${progress}%` }} />
        </div>
      )}
    </div>
  )
}
