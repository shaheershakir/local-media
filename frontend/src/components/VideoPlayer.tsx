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
  const [isScrubbing, setIsScrubbing] = useState(false)
  const [scrubTime, setScrubTime] = useState(initialTime)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [showControls, setShowControls] = useState(true)
  const [hudToast, setHudToast] = useState<{ text: string; direction: 'next' | 'prev' | 'info' } | null>(null)

  const hudTimer = useRef<number | null>(null)
  const hideControlsTimer = useRef<number | null>(null)
  const wheelLockRef = useRef<number>(0)
  const wheelAccumRef = useRef<number>(0)
  const wheelTimerRef = useRef<number | null>(null)
  const touchStartY = useRef<number | null>(null)
  const isScrubbingRef = useRef<boolean>(false)
  const scrubRafRef = useRef<number | null>(null)
  const lastSeekTimeRef = useRef<number>(0)

  // Auto-hide controls timer during playback
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
    showHud(`Next: ${nextVideo.filename || nextVideo.title}`, 'next')
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
    showHud(`Previous: ${prevVideo.filename || prevVideo.title}`, 'prev')
    if (onNavigateItem) {
      onNavigateItem(prevVideo)
    } else {
      navigate(`/watch/${prevVideo.id}`, { replace: true })
    }
  }, [hasPrev, prevVideo, onNavigateItem, navigate, showHud])

  const [videoError, setVideoError] = useState<string | null>(null)
  const [retryCount, setRetryCount] = useState<number>(0)

  // 2. Playback initialization when item changes
  useEffect(() => {
    let cancelled = false
    setVideoError(null)
    setRetryCount(0)
    setIsScrubbing(false)
    isScrubbingRef.current = false

    const startPlayback = async () => {
      const startTime = initialTime > 0 ? initialTime : item.duration_watched_seconds || 0
      setCurrentTime(startTime)
      setScrubTime(startTime)
      setDuration(item.duration_seconds || 0)

      // Direct interface with MPV in Electron app with zero transcoding for all videos!
      if (isMpvAvailable || Boolean(window.localfeed?.mpv)) {
        try {
          const res = await playMpv(item, startTime)
          if (res?.success && !cancelled) {
            showHud(`MPV Native Playback`, 'info')
            return
          }
        } catch {
          // fallback to HTML5 video
        }
      }

      if (item.browser_native === 0) {
        showHud(`Streaming ${item.codec ? item.codec.toUpperCase() : 'legacy format'} on-the-fly`, 'info')
      }

      // In-browser HTML5 video stream (for web browser environment)
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
      if (scrubRafRef.current) cancelAnimationFrame(scrubRafRef.current)
    }
  }, [item.id, item.browser_native, isMpvAvailable, playMpv, initialTime, volume, muted, showHud])

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
      if (!isScrubbingRef.current) {
        setCurrentTime(mpvState.currentTime)
      }
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
      const targetTime = Math.max(0, Math.min(video.duration || duration, (isScrubbingRef.current ? scrubTime : video.currentTime) + secondsDelta))
      video.currentTime = targetTime
      setCurrentTime(targetTime)
    },
    [isPoweredByMpv, seekMpv, duration, scrubTime]
  )

  // Fluid, lag-free scrubbing handlers with requestAnimationFrame throttling
  const handleScrubStart = useCallback(() => {
    isScrubbingRef.current = true
    setIsScrubbing(true)
  }, [])

  const handleScrubChange = useCallback(
    (targetTime: number) => {
      setScrubTime(targetTime)
      if (scrubRafRef.current) cancelAnimationFrame(scrubRafRef.current)

      scrubRafRef.current = requestAnimationFrame(() => {
        const now = Date.now()
        // Throttle video pipeline seeks during drag to avoid network/decoder choking
        if (now - lastSeekTimeRef.current > 50) {
          lastSeekTimeRef.current = now
          if (isPoweredByMpv) {
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
    [isPoweredByMpv, goToPositionMpv]
  )

  const handleScrubCommit = useCallback(
    (targetTime: number) => {
      isScrubbingRef.current = false
      setIsScrubbing(false)
      if (scrubRafRef.current) cancelAnimationFrame(scrubRafRef.current)

      if (isPoweredByMpv) {
        goToPositionMpv(targetTime)
      } else if (videoRef.current) {
        videoRef.current.currentTime = targetTime
      }
      setCurrentTime(targetTime)
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
      // Video navigation scroll ONLY works in fullscreen mode
      if (!inFullscreen) return

      e.preventDefault()

      const now = Date.now()
      if (now - wheelLockRef.current < 600) {
        return
      }

      wheelAccumRef.current += e.deltaY

      if (wheelTimerRef.current) clearTimeout(wheelTimerRef.current)
      wheelTimerRef.current = window.setTimeout(() => {
        wheelAccumRef.current = 0
      }, 250)

      if (wheelAccumRef.current >= 35) {
        wheelLockRef.current = now
        wheelAccumRef.current = 0
        handleNext()
      } else if (wheelAccumRef.current <= -35) {
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
  }, [isFullscreen, handleNext, handlePrev])

  // 7. Touch swipe vertical navigation
  const handleTouchStart = (e: React.TouchEvent) => {
    resetHideTimer()
    if (e.touches.length === 1) {
      touchStartY.current = e.touches[0].clientY
    }
  }

  const handleTouchEnd = (e: React.TouchEvent) => {
    resetHideTimer()
    if (touchStartY.current === null) return
    const touchEndY = e.changedTouches[0].clientY
    const deltaY = touchStartY.current - touchEndY
    touchStartY.current = null

    const inFullscreen = Boolean(document.fullscreenElement) || isFullscreen
    if (!inFullscreen) return

    if (deltaY > 45) {
      handleNext()
    } else if (deltaY < -45) {
      handlePrev()
    }
  }

  // 8. Keyboard Shortcuts
  // - Space: Play/Pause
  // - ArrowLeft / ArrowRight: Seek -5s / +5s
  // - Fullscreen ONLY: ArrowDown / PageDown / N / J / ] (Next Sibling Video)
  // - Fullscreen ONLY: ArrowUp / PageUp / P / K / [ (Previous Sibling Video)
  // - F: Fullscreen
  // - M: Mute
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      resetHideTimer()

      const inFullscreen = Boolean(document.fullscreenElement) || isFullscreen

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
        if (inFullscreen) {
          e.preventDefault()
          handleNext()
        }
      } else if (
        e.key === 'ArrowUp' ||
        e.key === 'PageUp' ||
        e.key === 'p' ||
        e.key === 'P' ||
        e.key === 'k' ||
        e.key === 'K' ||
        e.key === '['
      ) {
        if (inFullscreen) {
          e.preventDefault()
          handlePrev()
        }
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
  }, [togglePlay, handleSeek, handleNext, handlePrev, toggleFullscreen, toggleMuted, isFullscreen, resetHideTimer])

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
      className={`player-theater-wrapper ${className}${isFullscreen ? ' is-fullscreen' : ''}${showControls ? ' show-controls' : ' hide-controls'}`}
      onMouseMove={resetHideTimer}
      onMouseEnter={resetHideTimer}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      <video
        ref={videoRef}
        className="player-video-element"
        src={!isPoweredByMpv ? `${streamUrl(item.id)}${retryCount > 0 ? `?retry=${retryCount}` : ''}` : undefined}
        playsInline
        onTimeUpdate={() => {
          if (videoRef.current) {
            setCurrentTime(videoRef.current.currentTime)
          }
        }}
        onLoadedMetadata={() => {
          if (videoRef.current) {
            setDuration(videoRef.current.duration || item.duration_seconds || 0)
            setVideoError(null)
          }
        }}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={handleVideoEnded}
        onError={() => {
          if (retryCount < 2) {
            // Attempt auto-retry with cache-busting
            setRetryCount((prev) => prev + 1)
          } else {
            setVideoError('Video playback error. Please ensure FFmpeg is transcoding or launch in MPV.')
            setIsPlaying(false)
          }
        }}
        onClick={togglePlay}
      />

      {/* Video Error Fallback Overlay */}
      {videoError && (
        <div className="player-error-overlay">
          <div className="player-error-box">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#f87171" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <div className="player-error-title">Playback Issue</div>
            <div className="player-error-desc">{videoError}</div>
            <div className="player-error-actions">
              <button
                className="btn-primary"
                onClick={() => {
                  setVideoError(null)
                  setRetryCount((prev) => prev + 1)
                  if (videoRef.current) {
                    videoRef.current.load()
                    videoRef.current.play().catch(() => {})
                  }
                }}
                type="button"
              >
                Retry Stream
              </button>
              {isMpvAvailable && (
                <button
                  className="btn-secondary"
                  onClick={() => playMpv(item, currentTime)}
                  type="button"
                >
                  Play in MPV
                </button>
              )}
            </div>
          </div>
        </div>
      )}

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
            value={isScrubbing ? scrubTime : currentTime}
            onPointerDown={handleScrubStart}
            onMouseDown={handleScrubStart}
            onTouchStart={handleScrubStart}
            onInput={(e) => handleScrubChange(parseFloat(e.currentTarget.value))}
            onChange={(e) => handleScrubCommit(parseFloat(e.target.value))}
            onPointerUp={(e) => handleScrubCommit(parseFloat(e.currentTarget.value))}
            onMouseUp={(e) => handleScrubCommit(parseFloat(e.currentTarget.value))}
            onTouchEnd={(e) => handleScrubCommit(parseFloat(e.currentTarget.value))}
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
              title={hasPrev ? `Previous: ${prevVideo?.filename || prevVideo?.title} (ArrowUp / P / Scroll Up)` : 'First video in folder'}
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
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                  <rect x="6" y="4" width="4" height="16" rx="1" />
                  <rect x="14" y="4" width="4" height="16" rx="1" />
                </svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
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
              title={hasNext ? `Next: ${nextVideo?.filename || nextVideo?.title} (ArrowDown / N / Scroll Down)` : 'End of folder'}
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

