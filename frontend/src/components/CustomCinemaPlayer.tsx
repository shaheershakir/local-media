import { useCallback, useEffect, useRef, useState } from 'react'
import type { MediaItem } from '../api/types'
import { streamUrl } from '../api/media'
import { useMpv } from '../hooks/useMpv'

interface CustomCinemaPlayerProps {
  item: MediaItem
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

export function CustomCinemaPlayer({ item, onClose, initialTime = 0 }: CustomCinemaPlayerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const hideControlsTimeout = useRef<number | null>(null)

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
  const [volume, setVolumeState] = useState(100)
  const [muted, setMutedState] = useState(false)
  const [showControls, setShowControls] = useState(true)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [hoverTime, setHoverTime] = useState<number | null>(null)
  const [hoverX, setHoverX] = useState<number>(0)
  const [flashAction, setFlashAction] = useState<'play' | 'pause' | 'seek-fwd' | 'seek-bwd' | null>(null)

  const isPoweredByMpv = isPlayingItem(item.id)
  const ext = getFormatExtension(item.filename)

  // Start playback on mount
  useEffect(() => {
    let cancelled = false

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
        videoRef.current.play().catch(() => {})
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

  const handleScrubberChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const pct = parseFloat(e.target.value)
    const target = (pct / 100) * duration
    setCurrentTime(target)
    if (isPoweredByMpv) {
      goToPositionMpv(target)
    } else if (videoRef.current) {
      videoRef.current.currentTime = target
    }
  }

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
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        const newVol = Math.min(100, volume + 5)
        setVolumeState(newVol)
        if (isPoweredByMpv) setVolumeMpv(newVol)
        else if (videoRef.current) videoRef.current.volume = newVol / 100
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        const newVol = Math.max(0, volume - 5)
        setVolumeState(newVol)
        if (isPoweredByMpv) setVolumeMpv(newVol)
        else if (videoRef.current) videoRef.current.volume = newVol / 100
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
  }, [togglePlayPause, handleSeek, volume, isPoweredByMpv, setVolumeMpv, onClose])

  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0

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
        src={streamUrl(item.id)}
        playsInline
        onTimeUpdate={() => {
          if (!isPoweredByMpv && videoRef.current) {
            setCurrentTime(videoRef.current.currentTime)
            if (videoRef.current.duration) setDuration(videoRef.current.duration)
          }
        }}
        onEnded={() => setIsPlaying(false)}
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

      {/* Top Header Controls */}
      <header className="cinema-top-bar" onClick={(e) => e.stopPropagation()}>
        <button className="cinema-btn-icon" type="button" onClick={onClose} aria-label="Close player">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>

        <div className="cinema-meta-info">
          <h1 className="cinema-title">{item.title || item.filename}</h1>
          <div className="cinema-pill-row">
            {ext && <span className="cinema-pill">{ext}</span>}
            {item.codec && <span className="cinema-pill">{item.codec}</span>}
            {item.resolution && <span className="cinema-pill">{item.resolution}</span>}
            {item.file_size_bytes && <span className="cinema-pill">{formatBytes(item.file_size_bytes)}</span>}
            <span className="cinema-pill pill-engine">
              <span className="cinema-engine-dot" />
              MPV ENGINE
            </span>
          </div>
        </div>

        <div className="cinema-top-actions">
          {item.path && window.localfeed?.revealPath && (
            <button
              className="cinema-btn-icon"
              type="button"
              onClick={() => window.localfeed?.revealPath(item.path)}
              title="Reveal in local folder"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
              </svg>
            </button>
          )}

          <button className="cinema-btn-icon" type="button" onClick={toggleFullscreen} aria-label="Toggle fullscreen">
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              {isFullscreen ? (
                <path d="M8 3v5H3m13-5v5h5M8 21v-5H3m18 0h-5v5" />
              ) : (
                <path d="M3 8V3h5m8 0h5v5M3 16v5h5m8 0h5v-5" />
              )}
            </svg>
          </button>
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
              value={isNaN(progressPercent) ? 0 : progressPercent}
              onChange={handleScrubberChange}
              className="cinema-scrubber-input"
              aria-label="Seek time position"
            />
            <div className="cinema-scrubber-fill" style={{ width: `${progressPercent}%` }} />
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
            {/* Play / Pause */}
            <button
              className="cinema-btn-play"
              type="button"
              onClick={togglePlayPause}
              aria-label={isPlaying ? 'Pause' : 'Play'}
            >
              {isPlaying ? (
                <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
                  <rect x="6" y="4" width="4" height="16" rx="1" />
                  <rect x="14" y="4" width="4" height="16" rx="1" />
                </svg>
              ) : (
                <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
                  <polygon points="6 4 20 12 6 20 6 4" />
                </svg>
              )}
            </button>

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
