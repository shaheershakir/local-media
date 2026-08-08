import { useCallback, useEffect, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { getMediaItem } from '../api/media'
import { getFolder } from '../api/folders'
import type { MediaItem } from '../api/types'
import { CustomCinemaPlayer } from './CustomCinemaPlayer'
import { ImageViewer } from './ImageViewer'
import { useNavigationStack } from '../hooks/useNavigationStack'

interface ViewerLocationState {
  from?: string
}

export function MediaViewer() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const { goBack, canGoBack } = useNavigationStack()
  const [item, setItem] = useState<MediaItem | null>(null)
  const [folderItems, setFolderItems] = useState<MediaItem[]>([])
  const [error, setError] = useState<string | null>(null)

  const locationState = location.state as ViewerLocationState | null

  const closeViewer = useCallback(() => {
    if (canGoBack) {
      goBack()
    } else {
      navigate(locationState?.from || '/explore', { replace: true })
    }
  }, [canGoBack, goBack, locationState?.from, navigate])

  useEffect(() => {
    if (!id) return
    let cancelled = false
    setItem(null)
    setError(null)
    getMediaItem(Number(id))
      .then((media) => {
        if (!cancelled) {
          setItem(media)
          if (media.folder_id) {
            getFolder(media.folder_id, { page_size: 100, sort: 'name' })
              .then((fRes) => {
                if (!cancelled) {
                  setFolderItems(fRes.media.items || [])
                }
              })
              .catch(() => {})
          }
        }
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
        folderItems={folderItems}
        onNavigateItem={(newItem) => navigate(`/media/${newItem.id}`, { replace: true })}
        onClose={closeViewer}
        initialTime={item.duration_watched_seconds || 0}
      />
    )
  }

  // If media is an image, render rich ImageViewer with on-screen next/prev arrows & keyboard navigation
  return (
    <div className="media-viewer" role="dialog" aria-modal="true" aria-label="Photo viewer">
      <ImageViewer
        item={item}
        folderItems={folderItems}
        onClose={closeViewer}
      />
    </div>
  )
}
