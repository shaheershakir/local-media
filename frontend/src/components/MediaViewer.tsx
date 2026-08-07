import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { fullImageUrl, getMediaItem } from '../api/media'
import type { MediaItem } from '../api/types'
import { CustomCinemaPlayer } from './CustomCinemaPlayer'

interface ViewerLocationState {
  from?: string
}

export function MediaViewer() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const viewerRef = useRef<HTMLDivElement>(null)
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

  if (error) {
    return (
      <div className="media-viewer">
        <div className="media-viewer-toolbar">
          <button className="media-viewer-button" type="button" onClick={closeViewer} aria-label="Close">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="media-viewer-stage">
          <div className="media-viewer-message">{error}</div>
        </div>
      </div>
    )
  }

  if (!item) {
    return (
      <div className="media-viewer">
        <div className="media-viewer-stage">
          <div className="media-viewer-message">Loading media…</div>
        </div>
      </div>
    )
  }

  // If media is a video, render the full custom cinema player directly inside the same window!
  if (item.media_type === 'video') {
    return (
      <CustomCinemaPlayer
        item={item}
        onClose={closeViewer}
        initialTime={item.duration_watched_seconds || 0}
      />
    )
  }

  // If media is an image, render image viewer
  return (
    <div ref={viewerRef} className="media-viewer" role="dialog" aria-modal="true" aria-label="Photo viewer">
      <div className="media-viewer-toolbar">
        <button className="media-viewer-button" type="button" onClick={closeViewer} aria-label="Close photo viewer">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
        <div className="media-viewer-title-group">
          <span className="media-viewer-title">{item.title || 'Photo'}</span>
        </div>
        <div className="media-viewer-toolbar-actions">
          {item.path && window.localfeed?.revealPath && (
            <button
              className="media-viewer-button"
              type="button"
              onClick={() => window.localfeed?.revealPath(item.path)}
              title="Reveal in folder"
            >
              <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
              </svg>
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
        <img className="media-viewer-media" src={fullImageUrl(item.id)} alt={item.title} />
      </div>
    </div>
  )
}
