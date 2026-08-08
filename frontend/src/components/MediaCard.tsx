import { useRef, useState, useEffect, useCallback } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
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
  activeIndex?: number
  isActive: boolean
  onCardVisible: (index: number) => void
}

function formatDuration(seconds: number): string {
  if (!seconds || isNaN(seconds) || seconds < 0) return '0:00'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

function formatBytes(bytes?: number | null): string {
  if (!bytes) return ''
  const mb = bytes / (1024 * 1024)
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`
  return `${mb.toFixed(1)} MB`
}

function getFormatExtension(filename: string): string {
  const match = filename.match(/\.([0-9a-z]+)(?:[?#]|$)/i)
  return match ? match[1].toUpperCase() : ''
}

export function MediaCard({ item, index, activeIndex, isActive, onCardVisible }: MediaCardProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const cardRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const scrubberTrackRef = useRef<HTMLDivElement>(null)
  const hideControlsTimer = useRef<number | null>(null)
  const viewStartTime = useRef<number>(0)
  const hasLoggedStart = useRef(false)

  const { muted, setMuted, toggleMuted, volume, setVolume } = useAudioPreference()
  const {
    mpvState,
    isAvailable: isMpvAvailable,
    play: playMpv,
    seek: seekMpv,
    goToPosition: goToPositionMpv,
    togglePause: togglePauseMpv,
    setVolume: setVolumeMpv,
    toggleMute: toggleMuteMpv,
    isPlayingItem,
  } = useMpv()

  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(item.duration_seconds || 0)
  const [isScrubbing, setIsScrubbing] = useState(false)
  const [scrubPercent, setScrubPercent] = useState(0)
  const [showControls, setShowControls] = useState(true)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [hoverTime, setHoverTime] = useState<number | null>(null)
  const [hoverX, setHoverX] = useState<number>(0)
  const [flashAction, setFlashAction] = useState<'play' | 'pause' | 'seek-fwd' | 'seek-bwd' | null>(null)
  const [isFav, setIsFav] = useState(Boolean(item.is_favorite))

  const isScrubbingRef = useRef<boolean>(false)
  const scrubRafRef = useRef<number | null>(null)
  const lastSeekTimeRef = useRef<number>(0)

  // Virtual proximity window: only mount video stream socket within 1 card of active card
  const isNearActive = activeIndex !== undefined ? Math.abs(index - activeIndex) <= 1 : isActive
  const isLegacyFormat = item.media_type === 'video' && item.browser_native === 0
  const ext = getFormatExtension(item.filename)
  const isPlayingInMpv = isPlayingItem(item.id)

  const flash = (action: 'play' | 'pause' | 'seek-fwd' | 'seek-bwd') => {
    setFlashAction(action)
    window.setTimeout(() => setFlashAction(null), 450)
  }

  // Auto-hide controls during active playback
  const resetHideTimer = useCallback(() => {
    setShowControls(true)
    if (hideControlsTimer.current) clearTimeout(hideControlsTimer.current)
    if (isPlaying) {
      hideControlsTimer.current = window.setTimeout(() => {
        setShowControls(false)
      }, 3000)
    }
  }, [isPlaying])

  useEffect(() => {
    resetHideTimer()
    return () => {
      if (hideControlsTimer.current) clearTimeout(hideControlsTimer.current)
    }
  }, [resetHideTimer])

  // Track fullscreen changes
  useEffect(() => {
    const handleFsChange = () => {
      const fsEl = document.fullscreenElement
      const isFs = fsEl !== null && (fsEl === cardRef.current || fsEl === cardRef.current?.closest('.reels-container'))
      setIsFullscreen(isFs)
    }
    document.addEventListener('fullscreenchange', handleFsChange)
    return () => document.removeEventListener('fullscreenchange', handleFsChange)
  }, [])

  // Infinite scroll threshold prefetch
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

  // Sync state from MPV if MPV is actively playing this card
  useEffect(() => {
    if (isPlayingInMpv) {
      if (mpvState.duration > 0) setDuration(mpvState.duration)
      if (mpvState.currentTime >= 0) setCurrentTime(mpvState.currentTime)
      setIsPlaying(!mpvState.paused)
    }
  }, [isPlayingInMpv, mpvState])

  // TikTok-style scroll autoplay / pause + socket release
  useEffect(() => {
    if (item.media_type !== 'video') return
    const video = videoRef.current

    if (isActive) {
      // If legacy non-native format (AVI, WMV, FLV, etc.) and MPV is available in Electron, launch direct MPV IPC playback
      if (item.browser_native === 0 && isMpvAvailable) {
        playMpv(item)
        return
      }

      if (video) {
        video.muted = muted
        video.volume = volume / 100
        const playPromise = video.play()
        if (playPromise !== undefined) {
          playPromise
            .then(() => {
              setIsPlaying(true)
              if (!hasLoggedStart.current) {
                hasLoggedStart.current = true
                viewStartTime.current = Date.now()
                logEvent({ media_item_id: item.id, event_type: 'view_start' })
              }
            })
            .catch(() => {
              // Fallback to muted autoplay if browser policy restricts unmuted audio
              video.muted = true
              video
                .play()
                .then(() => setIsPlaying(true))
                .catch(() => {})
            })
        }
      }
    } else {
      // Immediately pause and reset when scrolling away
      if (video && !video.paused) {
        logEvent({
          media_item_id: item.id,
          event_type: 'skip',
          watched_seconds: video.currentTime,
        })
        hasLoggedStart.current = false
        video.pause()
        video.currentTime = 0
        setIsPlaying(false)
        setCurrentTime(0)
      }
    }

    return () => {
      if (video && !video.paused) {
        logEvent({
          media_item_id: item.id,
          event_type: 'view_end',
          watched_seconds: video.currentTime,
        })
        video.pause()
        video.currentTime = 0
      }
    }
  }, [isActive, item, muted, volume, isMpvAvailable, playMpv])

  // Sync audio preferences to HTML5 video element
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.muted = muted
      videoRef.current.volume = volume / 100
    }
  }, [muted, volume])

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
    if (!video || isScrubbingRef.current) return
    setCurrentTime(video.currentTime)
    if (video.duration && !isNaN(video.duration)) {
      setDuration(video.duration)
    }
  }

  const togglePlayPause = useCallback(() => {
    resetHideTimer()
    if (isPlayingInMpv) {
      togglePauseMpv()
      flash(mpvState.paused ? 'play' : 'pause')
      return
    }

    const video = videoRef.current
    if (!video) return

    if (video.paused) {
      video.play().then(() => setIsPlaying(true)).catch(() => {})
      flash('play')
    } else {
      video.pause()
      setIsPlaying(false)
      flash('pause')
    }
  }, [isPlayingInMpv, mpvState.paused, togglePauseMpv, resetHideTimer])

  const handleSeek = useCallback(
    (deltaSeconds: number) => {
      resetHideTimer()
      const newTime = Math.max(0, Math.min(duration, currentTime + deltaSeconds))
      if (isPlayingInMpv) {
        seekMpv(deltaSeconds)
      } else if (videoRef.current) {
        videoRef.current.currentTime = newTime
      }
      setCurrentTime(newTime)
      flash(deltaSeconds > 0 ? 'seek-fwd' : 'seek-bwd')
    },
    [isPlayingInMpv, seekMpv, duration, currentTime, resetHideTimer]
  )

  // Fluid, lag-free scrubbing handlers with requestAnimationFrame throttling
  const handleScrubStart = useCallback(() => {
    isScrubbingRef.current = true
    setIsScrubbing(true)
  }, [])

  const handleScrubChange = useCallback(
    (pct: number) => {
      resetHideTimer()
      setScrubPercent(pct)
      const targetTime = (pct / 100) * (duration || 0)
      if (scrubRafRef.current) cancelAnimationFrame(scrubRafRef.current)

      scrubRafRef.current = requestAnimationFrame(() => {
        const now = Date.now()
        if (now - lastSeekTimeRef.current > 50) {
          lastSeekTimeRef.current = now
          if (isPlayingInMpv) {
            goToPositionMpv(targetTime)
          } else if (videoRef.current) {
            const v = videoRef.current as any
            if (typeof v.fastSeek === 'function') {
              v.fastSeek(targetTime)
            } else {
              v.currentTime = targetTime
            }
          }
        }
      })
    },
    [isPlayingInMpv, goToPositionMpv, duration, resetHideTimer]
  )

  const handleScrubCommit = useCallback(
    (pct: number) => {
      resetHideTimer()
      isScrubbingRef.current = false
      setIsScrubbing(false)
      if (scrubRafRef.current) cancelAnimationFrame(scrubRafRef.current)

      const targetTime = (pct / 100) * (duration || 0)
      if (isPlayingInMpv) {
        goToPositionMpv(targetTime)
      } else if (videoRef.current) {
        videoRef.current.currentTime = targetTime
      }
      setCurrentTime(targetTime)
    },
    [isPlayingInMpv, goToPositionMpv, duration, resetHideTimer]
  )

  const handleScrubberMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const track = scrubberTrackRef.current
    if (!track || !duration) return
    const rect = track.getBoundingClientRect()
    const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    setHoverTime(pos * duration)
    setHoverX(e.clientX - rect.left)
  }

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    resetHideTimer()
    const val = parseInt(e.target.value, 10)
    setVolume(val)
    if (val === 0) {
      setMuted(true)
    } else if (muted) {
      setMuted(false)
    }
    if (isPlayingInMpv) {
      setVolumeMpv(val)
    } else if (videoRef.current) {
      videoRef.current.volume = val / 100
      videoRef.current.muted = val === 0
    }
  }

  const handleToggleMute = () => {
    resetHideTimer()
    if (isPlayingInMpv) {
      toggleMuteMpv()
    } else {
      toggleMuted()
    }
  }

  const handleToggleFullscreen = async () => {
    resetHideTimer()
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen()
      } else {
        const container = cardRef.current?.closest('.reels-container') || cardRef.current
        await container?.requestFullscreen()
      }
    } catch {
      // Browser declined
    }
  }

  const handleFavorite = async (e: React.MouseEvent) => {
    e.stopPropagation()
    const newFav = !isFav
    setIsFav(newFav)
    await updateMediaItem(item.id, { is_favorite: newFav })
    if (newFav) logEvent({ media_item_id: item.id, event_type: 'favorite' })
  }

  const handlePlayWithMpv = async (e?: React.MouseEvent) => {
    if (e) e.stopPropagation()
    if (videoRef.current && !videoRef.current.paused) {
      videoRef.current.pause()
      setIsPlaying(false)
    }
    const currentPos = videoRef.current?.currentTime || currentTime || 0
    await playMpv(item, currentPos)
  }

  const handleCardClick = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('.reel-cinema-top-bar, .reel-cinema-bottom-bar, .reel-actions')) {
      return
    }

    if (item.media_type === 'video') {
      if (isLegacyFormat && !isPlayingInMpv) {
        handlePlayWithMpv()
      } else {
        togglePlayPause()
      }
    } else {
      navigate(`/media/${item.id}`, { state: { from: `${location.pathname}${location.search}` } })
    }
  }

  // Keyboard shortcut listener when this card is active
  useEffect(() => {
    if (!isActive || item.media_type !== 'video') return

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return

      if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault()
        togglePlayPause()
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        handleSeek(-5)
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        handleSeek(5)
      } else if (e.key === 'j' || e.key === 'J') {
        e.preventDefault()
        handleSeek(-10)
      } else if (e.key === 'l' || e.key === 'L') {
        e.preventDefault()
        handleSeek(10)
      } else if (e.key === 'm' || e.key === 'M') {
        e.preventDefault()
        handleToggleMute()
      } else if (e.key === 'f' || e.key === 'F') {
        e.preventDefault()
        handleToggleFullscreen()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isActive, item.media_type, togglePlayPause, handleSeek, muted, isPlayingInMpv])

  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0
  const orientation = item.orientation || 'landscape'

  return (
    <div
      ref={cardRef}
      className={`reel-card ${orientation}${showControls ? ' show-controls' : ' hide-controls'}${isFullscreen ? ' is-fullscreen' : ''}`}
      onClick={handleCardClick}
      onMouseMove={resetHideTimer}
      onMouseEnter={resetHideTimer}
    >
      {/* Media wrapper with fit aspect ratio and virtual socket protection */}
      <div className="reel-media-wrapper">
        {item.media_type === 'video' ? (
          isNearActive ? (
            <video
              ref={videoRef}
              className="reel-media-video"
              src={streamUrl(item.id)}
              muted={muted}
              autoPlay={isActive}
              loop
              playsInline
              preload={isActive ? 'auto' : 'metadata'}
              onTimeUpdate={handleVideoTimeUpdate}
              onLoadedMetadata={() => {
                if (videoRef.current?.duration) {
                  setDuration(videoRef.current.duration)
                }
              }}
              onError={() => {
                console.warn('Reel playback error for item', item.id)
              }}
              onEnded={() => {
                logEvent({
                  media_item_id: item.id,
                  event_type: 'view_end',
                  watched_seconds: item.duration_seconds ?? 0,
                })
              }}
            />
          ) : (
            <img
              className="reel-media-image"
              src={thumbnailUrl(item.id)}
              alt={item.title}
              loading="lazy"
            />
          )
        ) : (
          <img
            className={`reel-media-image${KEN_BURNS_ENABLED && isActive ? ' ken-burns' : ''}`}
            src={isActive ? fullImageUrl(item.id) : thumbnailUrl(item.id)}
            alt={item.title}
            loading="lazy"
          />
        )}
      </div>

      {/* Center Flash Action Feedback Indicator */}
      {flashAction && (
        <div className="cinema-flash-indicator" aria-hidden="true">
          {flashAction === 'play' && (
            <svg width="46" height="46" viewBox="0 0 24 24" fill="currentColor">
              <polygon points="6 4 20 12 6 20 6 4" />
            </svg>
          )}
          {flashAction === 'pause' && (
            <svg width="46" height="46" viewBox="0 0 24 24" fill="currentColor">
              <rect x="6" y="4" width="4" height="16" rx="1" />
              <rect x="14" y="4" width="4" height="16" rx="1" />
            </svg>
          )}
          {flashAction === 'seek-fwd' && <div className="cinema-flash-text">+10s</div>}
          {flashAction === 'seek-bwd' && <div className="cinema-flash-text">-10s</div>}
        </div>
      )}

      {/* Cinema Top Header */}
      <header className="reel-cinema-top-bar" onClick={(e) => e.stopPropagation()}>
        <div className="cinema-meta-info">
          <div className="reel-top-row">
            <button
              className="reel-folder-tag"
              type="button"
              onClick={() => navigate(`/folders/${item.folder_id}`)}
              title="Filter by folder"
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
                <path d="M20 6h-8l-2-2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2z" />
              </svg>
              {item.folder_label}
            </button>
            <h2 className="cinema-title">{item.filename || item.title}</h2>
          </div>
          <div className="cinema-pill-row">
            {ext && <span className="cinema-pill">{ext}</span>}
            {item.codec && <span className="cinema-pill">{item.codec}</span>}
            {item.resolution && <span className="cinema-pill">{item.resolution}</span>}
            {item.file_size_bytes && <span className="cinema-pill">{formatBytes(item.file_size_bytes)}</span>}
            {item.media_type === 'video' && (
              <span className={`cinema-pill pill-engine${isPlayingInMpv ? ' active' : ''}`}>
                <span className="cinema-engine-dot" />
                {isPlayingInMpv ? 'MPV RUNNING' : 'CINEMA PLAYER'}
              </span>
            )}
          </div>
        </div>

        <div className="cinema-top-actions">
          {item.path && window.localfeed?.revealPath && (
            <button
              className="cinema-btn-icon"
              type="button"
              onClick={() => window.localfeed?.revealPath(item.path)}
              title="Reveal in local folder"
              aria-label="Reveal in local folder"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
              </svg>
            </button>
          )}

          <button
            className="cinema-btn-icon"
            type="button"
            onClick={handleToggleFullscreen}
            title={isFullscreen ? 'Exit Fullscreen (F)' : 'Enter Fullscreen (F)'}
            aria-label="Toggle Fullscreen"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              {isFullscreen ? (
                <path d="M8 3v5H3m13-5v5h5M8 21v-5H3m18 0h-5v5" />
              ) : (
                <path d="M3 8V3h5m8 0h5v5M3 16v5h5m8 0h5v-5" />
              )}
            </svg>
          </button>
        </div>
      </header>

      {/* Right Action Rail */}
      <div className="reel-actions" onClick={(e) => e.stopPropagation()}>
        {/* Favorite */}
        <button
          className={`reel-action-btn${isFav ? ' active' : ''}`}
          type="button"
          onClick={handleFavorite}
          aria-label="Favorite"
          title="Add to Saved"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill={isFav ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.5">
            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
          </svg>
        </button>

        {/* MPV Cinema Player Trigger for Videos */}
        {item.media_type === 'video' && (
          <button
            className={`reel-action-btn btn-mpv-action${isPlayingInMpv ? ' active' : ''}`}
            type="button"
            onClick={handlePlayWithMpv}
            title="Launch in MPV Cinema Player"
            aria-label="Launch in MPV Cinema Player"
          >
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <polygon points="5 3 19 12 5 21 5 3" fill={isPlayingInMpv ? 'currentColor' : 'none'} />
            </svg>
          </button>
        )}

        {/* Mute Toggle with preserved preference */}
        {item.media_type === 'video' && (
          <button
            className={`reel-action-btn${!muted ? ' active' : ''}`}
            type="button"
            onClick={handleToggleMute}
            title={muted ? 'Unmute video (sound on) [M]' : 'Mute video [M]'}
            aria-label={muted ? 'Turn sound on' : 'Mute video'}
          >
            {muted ? (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                <line x1="23" y1="9" x2="17" y2="15" />
                <line x1="17" y1="9" x2="23" y2="15" />
              </svg>
            ) : (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
              </svg>
            )}
          </button>
        )}

        {/* Fullscreen */}
        <button className="reel-action-btn" type="button" onClick={handleToggleFullscreen} aria-label="Open fullscreen" title="Toggle Fullscreen (F)">
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M3 8V3h5m8 0h5v5M3 16v5h5m8 0h5v-5" />
          </svg>
        </button>

        {/* Open in full viewer */}
        <button
          className="reel-action-btn"
          type="button"
          onClick={() => navigate(`/media/${item.id}`, { state: { from: `${location.pathname}${location.search}` } })}
          aria-label="Open detail viewer"
          title="Open Cinema detail viewer"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
          </svg>
        </button>

        {/* Go to grid */}
        <button
          className="reel-action-btn"
          type="button"
          onClick={() => navigate(`/explore?folder_id=${item.folder_id}`)}
          aria-label="Folder items"
          title="View folder items"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="3" y="3" width="7" height="7" />
            <rect x="14" y="3" width="7" height="7" />
            <rect x="14" y="14" width="7" height="7" />
            <rect x="3" y="14" width="7" height="7" />
          </svg>
        </button>
      </div>

      {/* Reel Cinema Bottom Bar with Scrubber and Controls */}
      {item.media_type === 'video' && (
        <footer className="reel-cinema-bottom-bar" onClick={(e) => e.stopPropagation()}>
          {/* Interactive Scrubber Timeline */}
          <div className="cinema-timeline-wrapper">
            <div
              ref={scrubberTrackRef}
              className="cinema-scrubber-track"
              onMouseMove={handleScrubberMouseMove}
              onMouseLeave={() => setHoverTime(null)}
            >
              <input
                type="range"
                min="0"
                max="100"
                step="0.05"
                value={isNaN(isScrubbing ? scrubPercent : progressPercent) ? 0 : (isScrubbing ? scrubPercent : progressPercent)}
                onPointerDown={handleScrubStart}
                onMouseDown={handleScrubStart}
                onTouchStart={handleScrubStart}
                onInput={(e) => handleScrubChange(parseFloat(e.currentTarget.value))}
                onChange={(e) => handleScrubCommit(parseFloat(e.target.value))}
                onPointerUp={(e) => handleScrubCommit(parseFloat(e.currentTarget.value))}
                onMouseUp={(e) => handleScrubCommit(parseFloat(e.currentTarget.value))}
                onTouchEnd={(e) => handleScrubCommit(parseFloat(e.currentTarget.value))}
                className="cinema-scrubber-input"
                aria-label="Seek time position"
              />
              <div className="cinema-scrubber-fill" style={{ width: `${isScrubbing ? scrubPercent : progressPercent}%` }} />
              {hoverTime !== null && (
                <div className="cinema-scrubber-hover-tip" style={{ left: hoverX }}>
                  {formatDuration(hoverTime)}
                </div>
              )}
            </div>
          </div>

          {/* Controls Row */}
          <div className="cinema-controls-row">
            <div className="cinema-controls-left">
              {/* Play / Pause */}
              <button
                className="cinema-btn-play"
                type="button"
                onClick={togglePlayPause}
                aria-label={isPlaying ? 'Pause' : 'Play'}
                title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
              >
                {isPlaying ? (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                    <rect x="6" y="4" width="4" height="16" rx="1" />
                    <rect x="14" y="4" width="4" height="16" rx="1" />
                  </svg>
                ) : (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                    <polygon points="6 4 20 12 6 20 6 4" />
                  </svg>
                )}
              </button>

              {/* Jump -10s / +10s */}
              <button
                className="cinema-btn-text-icon"
                type="button"
                onClick={() => handleSeek(-10)}
                title="Rewind 10s (J or Left Arrow)"
                aria-label="Rewind 10 seconds"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M11 17l-5-5 5-5M18 17l-5-5 5-5" />
                </svg>
                <span>10s</span>
              </button>

              <button
                className="cinema-btn-text-icon"
                type="button"
                onClick={() => handleSeek(10)}
                title="Forward 10s (L or Right Arrow)"
                aria-label="Forward 10 seconds"
              >
                <span>10s</span>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M13 17l5-5-5-5M6 17l5-5-5-5" />
                </svg>
              </button>

              {/* Time Stamp Counter */}
              <div className="cinema-time-counter">
                <span className="time-current">{formatDuration(currentTime)}</span>
                <span className="time-sep">/</span>
                <span className="time-total">{formatDuration(duration || item.duration_seconds || 0)}</span>
              </div>
            </div>

            <div className="cinema-controls-right">
              {/* Volume Group */}
              <div className="cinema-volume-group">
                <button
                  className="cinema-btn-icon"
                  type="button"
                  onClick={handleToggleMute}
                  aria-label={muted ? 'Unmute' : 'Mute'}
                  title={muted ? 'Unmute (M)' : 'Mute (M)'}
                >
                  {muted || volume === 0 ? (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M11 5 6 9H2v6h4l5 4V5Z" /><path d="m23 9-6 6m0-6 6 6" />
                    </svg>
                  ) : (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M11 5 6 9H2v6h4l5 4V5Z" /><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14" />
                    </svg>
                  )}
                </button>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={muted ? 0 : volume}
                  onChange={handleVolumeChange}
                  className="cinema-volume-slider"
                  aria-label="Adjust volume"
                />
              </div>

              {/* Fullscreen */}
              <button
                className="cinema-btn-icon"
                type="button"
                onClick={handleToggleFullscreen}
                aria-label="Fullscreen"
                title="Fullscreen (F)"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M3 8V3h5m8 0h5v5M3 16v5h5m8 0h5v-5" />
                </svg>
              </button>
            </div>
          </div>
        </footer>
      )}
    </div>
  )
}
