import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { fullImageUrl, getMediaItem, streamUrl } from '../api/media'
import type { MediaItem } from '../api/types'
import { useAudioPreference } from '../hooks/useAudioPreference'
import { useMpv } from '../hooks/useMpv'

interface ViewerLocationState {
  from?: string
}

function formatBytes(bytes?: number | null): string {
  if (!bytes) return ''
  const mb = bytes / (1024 * 1024)
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`
  return `${mb.toFixed(1)} MB`
}

function formatSeconds(seconds: number): string {
  if (!seconds || isNaN(seconds) || seconds < 0) return '0:00'
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

export function MediaViewer() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const viewerRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const { muted, setMuted, toggleMuted } = useAudioPreference()
  const { play: playMpv, isPlayingItem } = useMpv()
  const [item, setItem] = useState<MediaItem | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [videoPlaybackFailed, setVideoPlaybackFailed] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)

  const locationState = location.state as ViewerLocationState | null
  const isPlayingInMpv = item ? isPlayingItem(item.id) : false
  const ext = item ? getFormatExtension(item.filename) : ''

  const closeViewer = useCallback(() => {
    navigate(locationState?.from || '/explore', { replace: true })
  }, [locationState?.from, navigate])

  useEffect(() => {
    if (!id) return
    let cancelled = false
    setItem(null)
    setError(null)
    setVideoPlaybackFailed(false)
    getMediaItem(Number(id))
      .then((media) => {
        if (!cancelled) setItem(media)
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : 'Unable to open this media')
        }
      })
    return () => {
      cancelled = true
    }
  }, [id])

  useEffect(() => {
    const syncFullscreen = () => setIsFullscreen(document.fullscreenElement === viewerRef.current)
    document.addEventListener('fullscreenchange', syncFullscreen)
    return () => document.removeEventListener('fullscreenchange', syncFullscreen)
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !document.fullscreenElement) closeViewer()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [closeViewer])

  const toggleFullscreen = useCallback(async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen()
      } else {
        await viewerRef.current?.requestFullscreen()
      }
    } catch {
      // Browsers can decline fullscreen without a user-meaningful error.
    }
  }, [])

  const handleVolumeChange = useCallback(() => {
    const video = videoRef.current
    if (video) setMuted(video.muted)
  }, [setMuted])

  const handlePlayWithMpv = useCallback(async () => {
    if (!item) return
    if (videoRef.current && !videoRef.current.paused) {
      videoRef.current.pause()
    }
    const currentPos = videoRef.current?.currentTime || 0
    await playMpv(item, currentPos)
  }, [item, playMpv])

  const handleRevealInFolder = async () => {
    if (item?.path && window.localfeed?.revealPath) {
      await window.localfeed.revealPath(item.path)
    }
  }

  return (
    <div ref={viewerRef} className="media-viewer" role="dialog" aria-modal="true" aria-label="Media viewer">
      <div className="media-viewer-toolbar">
        <button className="media-viewer-button" type="button" onClick={closeViewer} aria-label="Close media viewer">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
        <div className="media-viewer-title-group">
          <span className="media-viewer-title">{item?.title || 'Opening media…'}</span>
          {ext && <span className="media-viewer-format-pill">{ext}</span>}
          {item?.duration_seconds && (
            <span className="media-viewer-format-pill">{formatSeconds(item.duration_seconds)}</span>
          )}
        </div>
        <div className="media-viewer-toolbar-actions">
          {item?.media_type === 'video' && (
            <>
              {/* Play with MPV button */}
              <button
                className={`media-viewer-button btn-mpv-toolbar${isPlayingInMpv ? ' active' : ''}`}
                type="button"
                onClick={handlePlayWithMpv}
                title="Play in MPV Cinema"
                aria-label="Play in MPV"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
                  <polygon points="5 3 19 12 5 21 5 3" fill={isPlayingInMpv ? 'currentColor' : 'none'} />
                </svg>
                <span className="btn-mpv-label">{isPlayingInMpv ? 'MPV Active' : 'MPV Cinema'}</span>
              </button>

              {/* Reveal in Explorer */}
              {item.path && (
                <button
                  className="media-viewer-button"
                  type="button"
                  onClick={handleRevealInFolder}
                  title="Reveal file in local folder"
                  aria-label="Reveal file in local folder"
                >
                  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                  </svg>
                </button>
              )}

              <button
                className={`media-viewer-button${!muted ? ' active' : ''}`}
                type="button"
                onClick={toggleMuted}
                aria-label={muted ? 'Turn sound on' : 'Mute video'}
              >
                {muted ? (
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
                    <path d="M11 5 6 9H2v6h4l5 4V5Z" /><path d="m23 9-6 6m0-6 6 6" />
                  </svg>
                ) : (
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
                    <path d="M11 5 6 9H2v6h4l5 4V5Z" /><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14" />
                  </svg>
                )}
              </button>
            </>
          )}

          <button className="media-viewer-button" type="button" onClick={toggleFullscreen} aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}>
            <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
              {isFullscreen ? <path d="M8 3v5H3m13-5v5h5M8 21v-5H3m18 0h-5v5" /> : <path d="M3 8V3h5m8 0h5v5M3 16v5h5m8 0h5v-5" />}
            </svg>
          </button>
        </div>
      </div>

      <div className="media-viewer-stage">
        {error ? (
          <div className="media-viewer-message">{error}</div>
        ) : !item ? (
          <div className="media-viewer-message">Loading media…</div>
        ) : item.media_type === 'video' ? (
          videoPlaybackFailed ? (
            /* Fallback screen if video format is completely unsupported by browser */
            <div className="legacy-format-card">
              <div className="legacy-icon-wrapper">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--c-amber)" strokeWidth="1.5">
                  <polygon points="5 3 19 12 5 21 5 3" />
                </svg>
              </div>

              <div className="legacy-card-title">
                {ext} Video Format
              </div>

              <div className="legacy-card-desc">
                This codec ({ext}{item.codec ? ` / ${item.codec}` : ''}) requires hardware acceleration. Play in full quality via MPV.
              </div>

              <div className="legacy-meta-row">
                {item.resolution && <span className="meta-pill">{item.resolution}</span>}
                {item.codec && <span className="meta-pill">{item.codec}</span>}
                {item.duration_seconds && <span className="meta-pill">{formatSeconds(item.duration_seconds)}</span>}
                {item.file_size_bytes && <span className="meta-pill">{formatBytes(item.file_size_bytes)}</span>}
              </div>

              <button className="btn-primary btn-play-mpv-hero" type="button" onClick={handlePlayWithMpv}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                  <polygon points="5 3 19 12 5 21 5 3" />
                </svg>
                <span>Play in MPV Cinema</span>
              </button>
            </div>
          ) : (
            /* Embedded full-duration video player inside the same window */
            <video
              ref={videoRef}
              className="media-viewer-media"
              src={streamUrl(item.id)}
              controls
              autoPlay
              muted={muted}
              playsInline
              onVolumeChange={handleVolumeChange}
              onError={() => setVideoPlaybackFailed(true)}
            />
          )
        ) : (
          <img className="media-viewer-media" src={fullImageUrl(item.id)} alt={item.title} />
        )}
      </div>
    </div>
  )
}
