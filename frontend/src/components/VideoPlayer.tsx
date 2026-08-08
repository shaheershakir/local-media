import { useState, useEffect, useRef, useCallback } from 'react'
import type { MediaItem } from '../api/types'
import { streamUrl } from '../api/media'
import { formatDuration } from './VideoCard'
import { useAudioPreference } from '../hooks/useAudioPreference'
import { useMpv } from '../hooks/useMpv'

export interface VideoPlayerProps {
  item: MediaItem
  initialTime?: number
  onEnded?: () => void
  className?: string
}

/**
 * Reusable Main Theater VideoPlayer component with custom cinema controls,
 * scrubber, volume slider, time counter, fullscreen, and native MPV support.
 */
export function VideoPlayer({ item, initialTime = 0, onEnded, className = '' }: VideoPlayerProps) {
  const theaterRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)

  const [isPlaying, setIsPlaying] = useState(true)
  const [currentTime, setCurrentTime] = useState(initialTime)
  const [duration, setDuration] = useState(item.duration_seconds || 0)
  const [isFullscreen, setIsFullscreen] = useState(false)

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

  // 1. Playback initialization
  useEffect(() => {
    let cancelled = false
    const startPlayback = async () => {
      const startTime = initialTime > 0 ? initialTime : item.duration_watched_seconds || 0

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
  }, [item.id, item.browser_native, isMpvAvailable, playMpv, initialTime])

  // 2. Sync volume and muted with AudioPreferenceProvider
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.volume = volume / 100
      videoRef.current.muted = muted
    }
  }, [volume, muted])

  // 3. Sync MPV state if active
  useEffect(() => {
    if (isPoweredByMpv) {
      if (mpvState.duration > 0) setDuration(mpvState.duration)
      setCurrentTime(mpvState.currentTime)
      setIsPlaying(!mpvState.paused)
    }
  }, [isPoweredByMpv, mpvState.currentTime, mpvState.duration, mpvState.paused])

  // 4. Fullscreen listener
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

  // Keyboard Shortcuts (Space: Play/Pause, ArrowLeft/Right: Seek 5s, F: Fullscreen, M: Mute)
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
  }, [togglePlay, handleSeek, toggleFullscreen, toggleMuted])

  return (
    <div ref={theaterRef} className={`player-theater-wrapper ${className}`}>
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
        onEnded={onEnded}
        onClick={togglePlay}
      />

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
            {/* Play/Pause */}
            <button
              className="player-ctrl-btn"
              onClick={togglePlay}
              type="button"
              aria-label={isPlaying ? 'Pause video' : 'Play video'}
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
