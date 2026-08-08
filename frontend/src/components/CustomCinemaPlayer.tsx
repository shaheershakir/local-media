import { useCallback, useEffect, useRef, useState } from 'react'
import type { MediaItem } from '../api/types'
import { streamUrl } from '../api/media'
import { useMpv } from '../hooks/useMpv'

interface CustomCinemaPlayerProps {
  item: MediaItem
  folderItems?: MediaItem[]
  onNavigateItem?: (item: MediaItem) => void
  onClose: () => void
  initialTime?: number
}

function formatSeconds(seconds: number): string {
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

export function CustomCinemaPlayer({
  item,
  folderItems = [],
  onNavigateItem,
  onClose,
  initialTime = 0,
}: CustomCinemaPlayerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const hideControlsTimeout = useRef<number | null>(null)
  const wheelLockRef = useRef<number>(0)
  const wheelAccumRef = useRef<number>(0)
  const wheelTimerRef = useRef<number | null>(null)

  const {
    mpvState,
    isAvailable: isMpvAvailable,
    play: playMpv,
    togglePause: togglePauseMpv,
    seek: seekMpv,
    goToPosition: goToPositionMpv,
    setVolume: setVolumeMpv,
    toggleMute: toggleMuteMpv,
    isPlayingItem,
  } = useMpv()

  const [isPlaying, setIsPlaying] = useState(true)
  const [currentTime, setCurrentTime] = useState(initialTime)
  const [duration, setDuration] = useState(item.duration_seconds || 0)
  const [isScrubbing, setIsScrubbing] = useState(false)
  const [scrubPercent, setScrubPercent] = useState(0)
  const [volume, setVolumeState] = useState(100)
  const [muted, setMutedState] = useState(false)
  const [showControls, setShowControls] = useState(true)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [hoverTime, setHoverTime] = useState<number | null>(null)
  const [hoverX, setHoverX] = useState<number>(0)
  const [flashAction, setFlashAction] = useState<'play' | 'pause' | 'seek-fwd' | 'seek-bwd' | null>(null)

  const isScrubbingRef = useRef<boolean>(false)
  const scrubRafRef = useRef<number | null>(null)
  const lastSeekTimeRef = useRef<number>(0)

  const isPoweredByMpv = isPlayingItem(item.id)
  const ext = getFormatExtension(item.filename)

  // Sibling video calculation from folder items
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

  const handleNext = useCallback(() => {
    if (!hasNext || !nextVideo) return
    if (onNavigateItem) {
      onNavigateItem(nextVideo)
    }
  }, [hasNext, nextVideo, onNavigateItem])

  const handlePrev = useCallback(() => {
    if (!hasPrev || !prevVideo) return
    if (onNavigateItem) {
      onNavigateItem(prevVideo)
    }
  }, [hasPrev, prevVideo, onNavigateItem])

  const [videoError, setVideoError] = useState<string | null>(null)
  const [retryCount, setRetryCount] = useState<number>(0)

  // Start playback on mount
  useEffect(() => {
    let cancelled = false
    setVideoError(null)
    setRetryCount(0)

    const startPlayback = async () => {
      // Attempt MPV launch first
      if (isMpvAvailable) {
        try {
          const res = await playMpv(item, initialTime)
          if (res?.success && !cancelled) {
            return
          }
        } catch {
          // MPV fallback
        }
      }

      // In-window HTML5 player fallback with full Range stream
      if (videoRef.current && !cancelled) {
        if (initialTime > 0) {
          videoRef.current.currentTime = initialTime
        }
        videoRef.current.play().catch(() => {
          // Fallback to muted playback if autoplay blocked
          if (videoRef.current) {
            videoRef.current.muted = true
            setMutedState(true)
            videoRef.current.play().catch(() => {})
          }
        })
      }
    }

    startPlayback()

    return () => {
      cancelled = true
    }
  }, [item.id, isMpvAvailable, playMpv, initialTime])

  // Sync MPV state when active
  useEffect(() => {
    if (isPoweredByMpv) {
      if (mpvState.duration > 0) setDuration(mpvState.duration)
      if (mpvState.currentTime >= 0) setCurrentTime(mpvState.currentTime)
      setIsPlaying(!mpvState.paused)
      setVolumeState(mpvState.volume)
      setMutedState(mpvState.muted)
    }
  }, [isPoweredByMpv, mpvState])

  // Auto-hide controls during playback
  const resetHideTimer = useCallback(() => {
    setShowControls(true)
    if (hideControlsTimeout.current) clearTimeout(hideControlsTimeout.current)
    if (isPlaying) {
      hideControlsTimeout.current = window.setTimeout(() => {
        setShowControls(false)
      }, 2500)
    }
  }, [isPlaying])

  useEffect(() => {
    resetHideTimer()
    return () => {
      if (hideControlsTimeout.current) clearTimeout(hideControlsTimeout.current)
    }
  }, [resetHideTimer])

  // Fullscreen change listener
  useEffect(() => {
    const handleFs = () => {
      setIsFullscreen(Boolean(document.fullscreenElement))
    }
    document.addEventListener('fullscreenchange', handleFs)
    return () => document.removeEventListener('fullscreenchange', handleFs)
  }, [])

  const flash = (action: 'play' | 'pause' | 'seek-fwd' | 'seek-bwd') => {
    setFlashAction(action)
    setTimeout(() => setFlashAction(null), 500)
  }

  // Playback Control Actions
  const togglePlayPause = useCallback(() => {
    resetHideTimer()
    if (isPoweredByMpv) {
      togglePauseMpv()
      flash(mpvState.paused ? 'play' : 'pause')
    } else if (videoRef.current) {
      if (videoRef.current.paused) {
        videoRef.current.play().catch(() => {})
        setIsPlaying(true)
        flash('play')
      } else {
        videoRef.current.pause()
        setIsPlaying(false)
        flash('pause')
      }
    }
  }, [isPoweredByMpv, togglePauseMpv, mpvState.paused, resetHideTimer])

  const handleSeek = useCallback(
    (deltaSeconds: number) => {
      resetHideTimer()
      const newTime = Math.max(0, Math.min(duration, currentTime + deltaSeconds))
      if (isPoweredByMpv) {
        seekMpv(deltaSeconds)
      } else if (videoRef.current) {
        videoRef.current.currentTime = newTime
      }
      setCurrentTime(newTime)
      flash(deltaSeconds > 0 ? 'seek-fwd' : 'seek-bwd')
    },
    [isPoweredByMpv, seekMpv, duration, currentTime, resetHideTimer]
  )

  // Fluid, lag-free scrubbing handlers with requestAnimationFrame throttling
  const handleScrubStart = useCallback(() => {
    isScrubbingRef.current = true
    setIsScrubbing(true)
  }, [])

  const handleScrubChange = useCallback(
    (pct: number) => {
      setScrubPercent(pct)
      const targetTime = (pct / 100) * (duration || 0)
      if (scrubRafRef.current) cancelAnimationFrame(scrubRafRef.current)

      scrubRafRef.current = requestAnimationFrame(() => {
        const now = Date.now()
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
    [isPoweredByMpv, goToPositionMpv, duration]
  )

  const handleScrubCommit = useCallback(
    (pct: number) => {
      isScrubbingRef.current = false
      setIsScrubbing(false)
      if (scrubRafRef.current) cancelAnimationFrame(scrubRafRef.current)

      const targetTime = (pct / 100) * (duration || 0)
      if (isPoweredByMpv) {
        goToPositionMpv(targetTime)
      } else if (videoRef.current) {
        videoRef.current.currentTime = targetTime
      }
      setCurrentTime(targetTime)
    },
    [isPoweredByMpv, goToPositionMpv, duration]
  )

  // Fullscreen vertical scrolling navigation (wheel & gestures)
  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const handleWheel = (e: WheelEvent) => {
      const inFullscreen = Boolean(document.fullscreenElement) || isFullscreen
      if (!inFullscreen && totalVideos <= 1) return

      if (inFullscreen) {
        e.preventDefault()
      }

      const now = Date.now()
      if (now - wheelLockRef.current < 600) return

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
  }, [isFullscreen, totalVideos, handleNext, handlePrev])

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseInt(e.target.value, 10)
    setVolumeState(val)
    if (isPoweredByMpv) {
      setVolumeMpv(val)
    } else if (videoRef.current) {
      videoRef.current.volume = val / 100
      videoRef.current.muted = val === 0
    }
  }

  const toggleMute = () => {
    if (isPoweredByMpv) {
      toggleMuteMpv()
    } else if (videoRef.current) {
      videoRef.current.muted = !videoRef.current.muted
      setMutedState(videoRef.current.muted)
    }
  }

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen()
      } else {
        await containerRef.current?.requestFullscreen()
      }
    } catch {
      // Browser declined
    }
  }

  // Global Keyboard Shortcuts
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return

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
      } else if (
        e.key === 'ArrowDown' ||
        e.key === 'PageDown' ||
        e.key === 'n' ||
        e.key === 'N' ||
        e.key === ']'
      ) {
        e.preventDefault()
        handleNext()
      } else if (
        e.key === 'ArrowUp' ||
        e.key === 'PageUp' ||
        e.key === 'p' ||
        e.key === 'P' ||
        e.key === '['
      ) {
        e.preventDefault()
        handlePrev()
      } else if (e.key === 'm' || e.key === 'M') {
        e.preventDefault()
        toggleMute()
      } else if (e.key === 'f' || e.key === 'F') {
        e.preventDefault()
        toggleFullscreen()
      } else if (e.key === 'Escape') {
        if (!document.fullscreenElement) {
          onClose()
        }
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [togglePlayPause, handleSeek, handleNext, handlePrev, onClose])

  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0
  const displayedPercent = isScrubbing ? scrubPercent : progressPercent

  return (
    <div
      ref={containerRef}
      className={`cinema-player-container${showControls ? ' show-controls' : ' hide-controls'}`}
      onMouseMove={resetHideTimer}
      onClick={togglePlayPause}
    >
      {/* Background / In-Window Video Surface */}
      <video
        ref={videoRef}
        className="cinema-video-surface"
        src={`${streamUrl(item.id)}${retryCount > 0 ? `?retry=${retryCount}` : ''}`}
        playsInline
        onTimeUpdate={() => {
          if (!isPoweredByMpv && videoRef.current && !isScrubbingRef.current) {
            setCurrentTime(videoRef.current.currentTime)
            if (videoRef.current.duration) setDuration(videoRef.current.duration)
          }
        }}
        onError={() => {
          if (retryCount < 2) {
            setRetryCount((prev) => prev + 1)
          } else {
            setVideoError('Playback error for video. Please launch in MPV or retry.')
          }
        }}
        onEnded={() => {
          if (hasNext && nextVideo) {
            handleNext()
          } else {
            setIsPlaying(false)
          }
        }}
      />

      {/* Center Flash Action Feedback */}
      {flashAction && (
        <div className="cinema-flash-indicator" aria-hidden="true">
          {flashAction === 'play' && (
            <svg width="48" height="48" viewBox="0 0 24 24" fill="currentColor">
              <polygon points="6 4 20 12 6 20 6 4" />
            </svg>
          )}
          {flashAction === 'pause' && (
            <svg width="48" height="48" viewBox="0 0 24 24" fill="currentColor">
              <rect x="6" y="4" width="4" height="16" rx="1" />
              <rect x="14" y="4" width="4" height="16" rx="1" />
            </svg>
          )}
          {flashAction === 'seek-fwd' && (
            <div className="cinema-flash-text">+10s</div>
          )}
          {flashAction === 'seek-bwd' && (
            <div className="cinema-flash-text">-10s</div>
          )}
        </div>
      )}

      {/* Video Error Fallback Overlay */}
      {videoError && (
        <div className="player-error-overlay" onClick={(e) => e.stopPropagation()}>
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

      {/* Top Header Controls */}
      <header className="cinema-top-bar" onClick={(e) => e.stopPropagation()}>
        <button className="cinema-btn-icon" type="button" onClick={onClose} aria-label="Close player">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>

        <div className="cinema-top-meta">
          {item.folder_name && (
            <span className="cinema-folder-badge">
              📁 {item.folder_display_name || item.folder_name}
            </span>
          )}
          <h1 className="cinema-title">{item.filename || item.title}</h1>
        </div>

        <div className="cinema-top-actions">
          {totalVideos > 1 && (
            <span className="cinema-sibling-badge">
              {effectiveIndex + 1} / {totalVideos}
            </span>
          )}
          {ext && <span className="cinema-badge">{ext}</span>}
          {item.codec && <span className="cinema-badge">{item.codec.toUpperCase()}</span>}
          {item.resolution && <span className="cinema-badge">{item.resolution}</span>}
          {item.file_size_bytes && <span className="cinema-badge">{formatBytes(item.file_size_bytes)}</span>}
          {isPoweredByMpv && <span className="cinema-badge cinema-badge-mpv">⚡ MPV ACTIVE</span>}
        </div>
      </header>

      {/* Bottom Control Bar */}
      <footer className="cinema-bottom-bar" onClick={(e) => e.stopPropagation()}>
        {/* Scrubber Timeline */}
        <div className="cinema-timeline-wrapper">
          <div
            className="cinema-scrubber-track"
            onMouseMove={(e) => {
              const rect = e.currentTarget.getBoundingClientRect()
              const pos = (e.clientX - rect.left) / rect.width
              setHoverTime(Math.max(0, Math.min(duration, pos * duration)))
              setHoverX(e.clientX - rect.left)
            }}
            onMouseLeave={() => setHoverTime(null)}
          >
            <input
              type="range"
              min="0"
              max="100"
              step="0.05"
              value={isNaN(displayedPercent) ? 0 : displayedPercent}
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
            <div className="cinema-scrubber-fill" style={{ width: `${displayedPercent}%` }} />
            {hoverTime !== null && (
              <div className="cinema-scrubber-hover-tip" style={{ left: hoverX }}>
                {formatSeconds(hoverTime)}
              </div>
            )}
          </div>
        </div>

        {/* Buttons Row */}
        <div className="cinema-controls-row">
          <div className="cinema-controls-left">
            {/* Previous Sibling Button */}
            {totalVideos > 1 && (
              <button
                className={`cinema-btn-text-icon${!hasPrev ? ' disabled' : ''}`}
                type="button"
                onClick={handlePrev}
                disabled={!hasPrev}
                title={hasPrev ? `Previous: ${prevVideo?.filename || prevVideo?.title} (ArrowUp / P / Scroll Up)` : 'First video in folder'}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                  <polygon points="19 20 9 12 19 4 19 20" />
                  <line x1="5" y1="4" x2="5" y2="20" stroke="currentColor" strokeWidth="2.5" />
                </svg>
              </button>
            )}

            {/* Play / Pause */}
            <button
              className="cinema-btn-play"
              type="button"
              onClick={togglePlayPause}
              title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
            >
              {isPlaying ? (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                  <rect x="6" y="4" width="4" height="16" rx="1" />
                  <rect x="14" y="4" width="4" height="16" rx="1" />
                </svg>
              ) : (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                  <polygon points="5 3 19 12 5 21 5 3" />
                </svg>
              )}
            </button>

            {/* Next Sibling Button */}
            {totalVideos > 1 && (
              <button
                className={`cinema-btn-text-icon${!hasNext ? ' disabled' : ''}`}
                type="button"
                onClick={handleNext}
                disabled={!hasNext}
                title={hasNext ? `Next: ${nextVideo?.filename || nextVideo?.title} (ArrowDown / N / Scroll Down)` : 'End of folder'}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                  <polygon points="5 4 15 12 5 20 5 4" />
                  <line x1="19" y1="4" x2="19" y2="20" stroke="currentColor" strokeWidth="2.5" />
                </svg>
              </button>
            )}

            {/* Jump -10s / +10s */}
            <button className="cinema-btn-text-icon" type="button" onClick={() => handleSeek(-10)} title="Rewind 10s">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M11 17l-5-5 5-5M18 17l-5-5 5-5" />
              </svg>
              <span>10s</span>
            </button>

            <button className="cinema-btn-text-icon" type="button" onClick={() => handleSeek(10)} title="Forward 10s">
              <span>10s</span>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M13 17l5-5-5-5M6 17l5-5-5-5" />
              </svg>
            </button>

            {/* Time Stamp Counter */}
            <div className="cinema-time-counter">
              <span className="time-current">{formatSeconds(currentTime)}</span>
              <span className="time-sep">/</span>
              <span className="time-total">{formatSeconds(duration)}</span>
            </div>
          </div>

          <div className="cinema-controls-right">
            {/* Volume Control */}
            <div className="cinema-volume-group">
              <button className="cinema-btn-icon" type="button" onClick={toggleMute} aria-label={muted ? 'Unmute' : 'Mute'}>
                {muted || volume === 0 ? (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M11 5 6 9H2v6h4l5 4V5Z" /><path d="m23 9-6 6m0-6 6 6" />
                  </svg>
                ) : (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
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
            <button className="cinema-btn-icon" type="button" onClick={toggleFullscreen} aria-label="Fullscreen">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 8V3h5m8 0h5v5M3 16v5h5m8 0h5v-5" />
              </svg>
            </button>
          </div>
        </div>
      </footer>
    </div>
  )
}
