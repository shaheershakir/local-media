import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import type { MediaItem } from '../api/types'
import { streamUrl } from '../api/media'
import { formatDuration } from './VideoCard'
import { useAudioPreference } from '../hooks/useAudioPreference'
import { useMpv } from '../hooks/useMpv'

export interface VideoPlayerProps {
  item: MediaItem
  folderItems?: MediaItem[]
  onNavigateItem?: (item: MediaItem) => void
  initialTime?: number
  onEnded?: () => void
  className?: string
}

/**
 * Reusable Main Theater VideoPlayer component with custom cinema controls,
 * scrubber, volume slider, time counter, fullscreen, native MPV support,
 * fullscreen vertical scroll navigation, and sibling video shortcuts.
 */
export function VideoPlayer({
  item,
  folderItems = [],
  onNavigateItem,
  initialTime = 0,
  onEnded,
  className = '',
}: VideoPlayerProps) {
  const navigate = useNavigate()
  const theaterRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)

  const [isPlaying, setIsPlaying] = useState(true)
  const [currentTime, setCurrentTime] = useState(initialTime)
  const [duration, setDuration] = useState(item.duration_seconds || 0)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [hudToast, setHudToast] = useState<{ text: string; direction: 'next' | 'prev' | 'info' } | null>(null)

  const hudTimer = useRef<number | null>(null)
  const wheelLockRef = useRef<number>(0)
  const wheelAccumRef = useRef<number>(0)
  const wheelTimerRef = useRef<number | null>(null)
  const touchStartY = useRef<number | null>(null)

  const { muted, toggleMuted, volume, setVolume } = useAudioPreference()
  const {
    mpvState,
    isAvailable: isMpvAvailable,
    play: playMpv,
    togglePause: togglePauseMpv,
    seek: seekMpv,
    goToPosition: goToPositionMpv,
    isPlayingItem,
  } = useMpv()

  const isPoweredByMpv = isPlayingItem(item.id)

  // 1. Sibling video calculation from folder items
  const siblingVideos = folderItems.length > 0
    ? folderItems.filter((i) => i.media_type === 'video')
    : [item]

  const currentIndex = siblingVideos.findIndex((i) => i.id === item.id)
  const effectiveIndex = currentIndex >= 0 ? currentIndex : 0
  const hasPrev = effectiveIndex > 0
  const hasNext = effectiveIndex < siblingVideos.length - 1
  const totalVideos = Math.max(1, siblingVideos.length)
  const prevVideo = hasPrev ? siblingVideos[effectiveIndex - 1] : null
  const nextVideo = hasNext ? siblingVideos[effectiveIndex + 1] : null

  // Display HUD feedback toast
  const showHud = useCallback((text: string, direction: 'next' | 'prev' | 'info' = 'info') => {
    if (hudTimer.current) clearTimeout(hudTimer.current)
    setHudToast({ text, direction })
    hudTimer.current = window.setTimeout(() => {
      setHudToast(null)
      hudTimer.current = null
    }, 2000)
  }, [])

  // Sibling video navigation handlers
  const handleNext = useCallback(() => {
    if (!hasNext || !nextVideo) {
      showHud('End of folder (no next video)', 'info')
      return
    }
    showHud(`Next: ${nextVideo.title || nextVideo.filename}`, 'next')
    if (onNavigateItem) {
      onNavigateItem(nextVideo)
    } else {
      navigate(`/watch/${nextVideo.id}`, { replace: true })
    }
  }, [hasNext, nextVideo, onNavigateItem, navigate, showHud])

  const handlePrev = useCallback(() => {
    if (!hasPrev || !prevVideo) {
      showHud('Start of folder (no previous video)', 'info')
      return
    }
    showHud(`Previous: ${prevVideo.title || prevVideo.filename}`, 'prev')
    if (onNavigateItem) {
      onNavigateItem(prevVideo)
    } else {
      navigate(`/watch/${prevVideo.id}`, { replace: true })
    }
  }, [hasPrev, prevVideo, onNavigateItem, navigate, showHud])

  // 2. Playback initialization when item changes
  useEffect(() => {
    let cancelled = false
    const startPlayback = async () => {
      const startTime = initialTime > 0 ? initialTime : item.duration_watched_seconds || 0
      setCurrentTime(startTime)
      setDuration(item.duration_seconds || 0)

      // If MPV is preferred/legacy format, launch MPV
      if (item.browser_native === 0 && isMpvAvailable) {
        try {
          const res = await playMpv(item, startTime)
          if (res?.success) return
        } catch {
          // fallback to HTML5 video
        }
      }

      // In-browser HTML5 video stream
      const video = videoRef.current
      if (video && !cancelled) {
        video.volume = volume / 100
        video.muted = muted
        if (startTime > 0) {
          video.currentTime = startTime
        }
        video
          .play()
          .then(() => setIsPlaying(true))
          .catch(() => {
            // If browser blocked unmuted autoplay, retry with muted=true
            video.muted = true
            video
              .play()
              .then(() => setIsPlaying(true))
              .catch(() => setIsPlaying(false))
          })
      }
    }

    startPlayback()

    return () => {
      cancelled = true
    }
  }, [item.id, item.browser_native, isMpvAvailable, playMpv, initialTime, volume, muted])

  // 3. Sync volume and muted with AudioPreferenceProvider
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.volume = volume / 100
      videoRef.current.muted = muted
    }
  }, [volume, muted])

  // 4. Sync MPV state if active
  useEffect(() => {
    if (isPoweredByMpv) {
      if (mpvState.duration > 0) setDuration(mpvState.duration)
      setCurrentTime(mpvState.currentTime)
      setIsPlaying(!mpvState.paused)
    }
  }, [isPoweredByMpv, mpvState.currentTime, mpvState.duration, mpvState.paused])

  // 5. Fullscreen change listener
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement))
    }
    document.addEventListener('fullscreenchange', handleFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange)
  }, [])

  // Playback Control Handlers
  const togglePlay = useCallback(() => {
    if (isPoweredByMpv) {
      togglePauseMpv()
      return
    }
    const video = videoRef.current
    if (!video) return
    if (video.paused) {
      video.play().then(() => setIsPlaying(true)).catch(() => {})
    } else {
      video.pause()
      setIsPlaying(false)
    }
  }, [isPoweredByMpv, togglePauseMpv])

  const handleSeek = useCallback(
    (secondsDelta: number) => {
      if (isPoweredByMpv) {
        seekMpv(secondsDelta)
        return
      }
      const video = videoRef.current
      if (!video) return
      video.currentTime = Math.max(0, Math.min(video.duration || duration, video.currentTime + secondsDelta))
    },
    [isPoweredByMpv, seekMpv, duration]
  )

  const handleSeekTo = useCallback(
    (targetTime: number) => {
      if (isPoweredByMpv) {
        goToPositionMpv(targetTime)
        return
      }
      const video = videoRef.current
      if (!video) return
      video.currentTime = targetTime
    },
    [isPoweredByMpv, goToPositionMpv]
  )

  const toggleFullscreen = useCallback(async () => {
    const el = theaterRef.current
    if (!el) return
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen()
      } else {
        await el.requestFullscreen()
      }
    } catch {
      // Fullscreen can be declined silently by browser policies
    }
  }, [])

  // 6. Fullscreen vertical scrolling navigation (wheel & gestures)
  useEffect(() => {
    const el = theaterRef.current
    if (!el) return

    const handleWheel = (e: WheelEvent) => {
      const inFullscreen = Boolean(document.fullscreenElement) || isFullscreen
      // When in fullscreen (or scrolling over the theater container with multiple siblings)
      if (!inFullscreen && totalVideos <= 1) return

      // In fullscreen, intercept vertical scroll gestures
      if (inFullscreen) {
        e.preventDefault()
      }

      const now = Date.now()
      if (now - wheelLockRef.current < 600) {
        // Cooldown between video transitions
        return
      }

      wheelAccumRef.current += e.deltaY

      if (wheelTimerRef.current) clearTimeout(wheelTimerRef.current)
      wheelTimerRef.current = window.setTimeout(() => {
        wheelAccumRef.current = 0
      }, 250)

      // Scrolling down (deltaY > 0) -> Next Sibling Video
      if (wheelAccumRef.current >= 35) {
        wheelLockRef.current = now
        wheelAccumRef.current = 0
        handleNext()
      }
      // Scrolling up (deltaY < 0) -> Previous Sibling Video
      else if (wheelAccumRef.current <= -35) {
        wheelLockRef.current = now
        wheelAccumRef.current = 0
        handlePrev()
      }
    }

    el.addEventListener('wheel', handleWheel, { passive: false })
    return () => {
      el.removeEventListener('wheel', handleWheel)
      if (wheelTimerRef.current) clearTimeout(wheelTimerRef.current)
    }
  }, [isFullscreen, totalVideos, handleNext, handlePrev])

  // 7. Touch swipe vertical navigation
  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      touchStartY.current = e.touches[0].clientY
    }
  }

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartY.current === null) return
    const touchEndY = e.changedTouches[0].clientY
    const deltaY = touchStartY.current - touchEndY // swipe up = positive (next), swipe down = negative (prev)
    touchStartY.current = null

    const inFullscreen = Boolean(document.fullscreenElement) || isFullscreen
    if (!inFullscreen && totalVideos <= 1) return

    if (deltaY > 45) {
      handleNext()
    } else if (deltaY < -45) {
      handlePrev()
    }
  }

  // 8. Keyboard Shortcuts
  // - Space: Play/Pause
  // - ArrowLeft / ArrowRight: Seek -5s / +5s
  // - ArrowDown / PageDown / N / Shift+N / J / ]: Next Sibling Video
  // - ArrowUp / PageUp / P / Shift+P / K / [: Previous Sibling Video
  // - F: Fullscreen
  // - M: Mute
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return

      if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault()
        togglePlay()
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        handleSeek(-5)
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        handleSeek(5)
      } else if (
        e.key === 'ArrowDown' ||
        e.key === 'PageDown' ||
        e.key === 'n' ||
        e.key === 'N' ||
        e.key === 'j' ||
        e.key === 'J' ||
        e.key === ']'
      ) {
        e.preventDefault()
        handleNext()
      } else if (
        e.key === 'ArrowUp' ||
        e.key === 'PageUp' ||
        e.key === 'p' ||
        e.key === 'P' ||
        e.key === 'k' ||
        e.key === 'K' ||
        e.key === '['
      ) {
        e.preventDefault()
        handlePrev()
      } else if (e.key === 'f' || e.key === 'F') {
        e.preventDefault()
        toggleFullscreen()
      } else if (e.key === 'm' || e.key === 'M') {
        e.preventDefault()
        toggleMuted()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [togglePlay, handleSeek, handleNext, handlePrev, toggleFullscreen, toggleMuted])

  // Handle video playback ended
  const handleVideoEnded = () => {
    if (onEnded) {
      onEnded()
    } else if (hasNext && nextVideo) {
      handleNext()
    } else {
      setIsPlaying(false)
    }
  }

  return (
    <div
      ref={theaterRef}
      className={`player-theater-wrapper ${className}${isFullscreen ? ' is-fullscreen' : ''}`}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      <video
        ref={videoRef}
        className="player-video-element"
        src={streamUrl(item.id)}
        playsInline
        onTimeUpdate={() => {
          if (videoRef.current) {
            setCurrentTime(videoRef.current.currentTime)
          }
        }}
        onLoadedMetadata={() => {
          if (videoRef.current) {
            setDuration(videoRef.current.duration || item.duration_seconds || 0)
          }
        }}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={handleVideoEnded}
        onClick={togglePlay}
      />

      {/* Floating HUD Feedback Overlay */}
      {hudToast && (
        <div className="player-hud-toast" role="status" aria-live="polite">
          <span className="player-hud-icon">
            {hudToast.direction === 'next' ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <path d="M12 5v14M19 12l-7 7-7-7" />
              </svg>
            ) : hudToast.direction === 'prev' ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <path d="M12 19V5M5 12l7-7 7 7" />
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="16" x2="12" y2="12" />
                <line x1="12" y1="8" x2="12.01" y2="8" />
              </svg>
            )}
          </span>
          <span className="player-hud-text">{hudToast.text}</span>
          {totalVideos > 1 && (
            <span className="player-sibling-badge">
              {effectiveIndex + 1} / {totalVideos}
            </span>
          )}
        </div>
      )}

      {/* Floating On-Screen Navigation Arrows in Theater / Fullscreen */}
      {totalVideos > 1 && (
        <>
          <button
            className={`player-side-arrow-btn player-side-arrow-prev${!hasPrev ? ' disabled' : ''}`}
            onClick={(e) => {
              e.stopPropagation()
              handlePrev()
            }}
            disabled={!hasPrev}
            type="button"
            title={`Previous Video (ArrowUp / P / Scroll Up)`}
            aria-label="Previous video"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <button
            className={`player-side-arrow-btn player-side-arrow-next${!hasNext ? ' disabled' : ''}`}
            onClick={(e) => {
              e.stopPropagation()
              handleNext()
            }}
            disabled={!hasNext}
            type="button"
            title={`Next Video (ArrowDown / N / Scroll Down)`}
            aria-label="Next video"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
        </>
      )}

      {/* In-Player Scrubber & Controls Overlay */}
      <div className="player-controls-overlay">
        {/* Timeline Scrubber */}
        <div className="player-scrubber-row">
          <input
            type="range"
            className="player-scrubber-slider"
            min={0}
            max={duration || 100}
            step={0.1}
            value={currentTime}
            onChange={(e) => handleSeekTo(parseFloat(e.target.value))}
            aria-label="Video scrubber"
          />
        </div>

        {/* Controls Bar */}
        <div className="player-controls-bar">
          <div className="player-ctrls-left">
            {/* Previous Sibling Video Button */}
            <button
              className={`player-ctrl-btn${!hasPrev ? ' disabled' : ''}`}
              onClick={handlePrev}
              type="button"
              disabled={!hasPrev}
              aria-label="Previous sibling video"
              title={hasPrev ? `Previous: ${prevVideo?.title || prevVideo?.filename} (ArrowUp / P / Scroll Up)` : 'First video in folder'}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <polygon points="19 20 9 12 19 4 19 20" />
                <line x1="5" y1="4" x2="5" y2="20" stroke="currentColor" strokeWidth="2.5" />
              </svg>
            </button>

            {/* Play/Pause */}
            <button
              className="player-ctrl-btn"
              onClick={togglePlay}
              type="button"
              aria-label={isPlaying ? 'Pause video' : 'Play video'}
              title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
            >
              {isPlaying ? (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                  <rect x="6" y="4" width="4" height="16" />
                  <rect x="14" y="4" width="4" height="16" />
                </svg>
              ) : (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                  <polygon points="5 3 19 12 5 21 5 3" />
                </svg>
              )}
            </button>

            {/* Next Sibling Video Button */}
            <button
              className={`player-ctrl-btn${!hasNext ? ' disabled' : ''}`}
              onClick={handleNext}
              type="button"
              disabled={!hasNext}
              aria-label="Next sibling video"
              title={hasNext ? `Next: ${nextVideo?.title || nextVideo?.filename} (ArrowDown / N / Scroll Down)` : 'End of folder'}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <polygon points="5 4 15 12 5 20 5 4" />
                <line x1="19" y1="4" x2="19" y2="20" stroke="currentColor" strokeWidth="2.5" />
              </svg>
            </button>

            {/* Backward 5s */}
            <button
              className="player-ctrl-btn"
              onClick={() => handleSeek(-5)}
              type="button"
              aria-label="Seek backward 5 seconds"
              title="Seek -5s (Left Arrow)"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M11 17l-5-5 5-5M18 17l-5-5 5-5" />
              </svg>
            </button>

            {/* Forward 5s */}
            <button
              className="player-ctrl-btn"
              onClick={() => handleSeek(5)}
              type="button"
              aria-label="Seek forward 5 seconds"
              title="Seek +5s (Right Arrow)"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M13 17l5-5-5-5M6 17l5-5-5-5" />
              </svg>
            </button>

            {/* Volume Group */}
            <div className="player-volume-group">
              <button
                className="player-ctrl-btn"
                onClick={toggleMuted}
                type="button"
                aria-label={muted ? 'Unmute' : 'Mute'}
                title="Mute/Unmute (M)"
              >
                {muted || volume === 0 ? (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <line x1="1" y1="1" x2="23" y2="23" />
                    <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" />
                    <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0a7 7 0 0 1-.11 1.23" />
                  </svg>
                ) : (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                    <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" />
                  </svg>
                )}
              </button>
              <input
                type="range"
                className="player-volume-slider"
                min={0}
                max={100}
                value={muted ? 0 : volume}
                onChange={(e) => setVolume(parseFloat(e.target.value))}
                aria-label="Volume slider"
              />
            </div>

            {/* Time Counter */}
            <div className="player-time-display">
              <span className="player-time-current">{formatDuration(currentTime)}</span>
              <span className="player-time-divider">/</span>
              <span className="player-time-duration">{formatDuration(duration)}</span>
            </div>

            {/* Sibling Badge Counter in Bar */}
            {totalVideos > 1 && (
              <span
                className="player-sibling-badge"
                title={`Video ${effectiveIndex + 1} of ${totalVideos} from folder`}
              >
                {effectiveIndex + 1} / {totalVideos}
              </span>
            )}
          </div>

          <div className="player-ctrls-right">
            {/* MPV Launcher */}
            {isMpvAvailable && (
              <button
                className="player-ctrl-tag-btn"
                onClick={() => playMpv(item, currentTime)}
                type="button"
                title="Play with native MPV player"
              >
                <span className="mpv-hud-dot" style={{ display: 'inline-block', marginRight: 4 }} />
                MPV
              </button>
            )}

            {/* Fullscreen Button */}
            <button
              className="player-ctrl-btn"
              onClick={toggleFullscreen}
              type="button"
              aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
              title="Fullscreen (F)"
            >
              {isFullscreen ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M8 3v5H3m13-5v5h5M8 21v-5H3m18 0h-5v5" />
                </svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M3 8V3h5m8 0h5v5M3 16v5h5m8 0h5v-5" />
                </svg>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

