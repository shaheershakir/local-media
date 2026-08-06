import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { fullImageUrl, getMediaItem, streamUrl } from '../api/media'
import type { MediaItem } from '../api/types'
import { useAudioPreference } from '../hooks/useAudioPreference'

interface ViewerLocationState {
  from?: string
}

export function MediaViewer() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const viewerRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const { muted, setMuted, toggleMuted } = useAudioPreference()
  const [item, setItem] = useState<MediaItem | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)

  const locationState = location.state as ViewerLocationState | null

  const closeViewer = useCallback(() => {
    navigate(locationState?.from || '/explore', { replace: true })
  }, [locationState?.from, navigate])

  useEffect(() => {
    if (!id) return
    let cancelled = false
    setItem(null)
    setError(null)
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

  return (
    <div ref={viewerRef} className="media-viewer" role="dialog" aria-modal="true" aria-label="Media viewer">
      <div className="media-viewer-toolbar">
        <button className="media-viewer-button" type="button" onClick={closeViewer} aria-label="Close media viewer">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
        <div className="media-viewer-title">{item?.title || 'Opening media…'}</div>
        <div className="media-viewer-toolbar-actions">
          {item?.media_type === 'video' && (
            <button className={`media-viewer-button${!muted ? ' active' : ''}`} type="button" onClick={toggleMuted} aria-label={muted ? 'Turn sound on' : 'Mute video'}>
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
          <video
            ref={videoRef}
            className="media-viewer-media"
            src={streamUrl(item.id)}
            controls
            autoPlay
            muted={muted}
            playsInline
            onVolumeChange={handleVolumeChange}
          />
        ) : (
          <img className="media-viewer-media" src={fullImageUrl(item.id)} alt={item.title} />
        )}
      </div>
    </div>
  )
}
