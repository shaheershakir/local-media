import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { getMediaItem, streamUrl, updateMediaItem } from '../api/media'
import { getFolder } from '../api/folders'
import { getRecommendationsPage, type RecTabType } from '../api/recommendations'
import type { MediaItem, Folder } from '../api/types'
import { VideoCard, formatDuration, cleanResolution } from '../components/VideoCard'
import { useAudioPreference } from '../hooks/useAudioPreference'
import { useMpv } from '../hooks/useMpv'

function formatBytes(bytes?: number | null): string {
  if (!bytes) return ''
  const mb = bytes / (1024 * 1024)
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`
  return `${mb.toFixed(1)} MB`
}

export function PlayerPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const videoRef = useRef<HTMLVideoElement>(null)
  const theaterRef = useRef<HTMLDivElement>(null)
  const recSentinelRef = useRef<HTMLDivElement>(null)

  const [item, setItem] = useState<MediaItem | null>(null)
  const [folder, setFolder] = useState<Folder | null>(null)
  const [sameFolderVideos, setSameFolderVideos] = useState<MediaItem[]>([])
  
  // Recommendation Sidebar State with Lazy-Load / Infinite-Scroll support
  const [recTab, setRecTab] = useState<RecTabType>('all')
  const [recItems, setRecItems] = useState<MediaItem[]>([])
  const [recPage, setRecPage] = useState<number>(1)
  const [recHasMore, setRecHasMore] = useState<boolean>(true)
  const [loadingRecs, setLoadingRecs] = useState<boolean>(false)
  const [loadingMoreRecs, setLoadingMoreRecs] = useState<boolean>(false)

  const [isPlaying, setIsPlaying] = useState(true)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [isFavorite, setIsFavorite] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

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

  const isPoweredByMpv = item ? isPlayingItem(item.id) : false
  const mediaId = Number(id)

  // 1. Fetch current media item & sibling videos
  useEffect(() => {
    if (!mediaId || isNaN(mediaId)) return

    let cancelled = false
    setLoading(true)
    setError(null)
    window.scrollTo({ top: 0, behavior: 'smooth' })

    const loadData = async () => {
      try {
        const media = await getMediaItem(mediaId)
        if (cancelled) return
        setItem(media)
        setIsFavorite(Boolean(media.is_favorite))
        setDuration(media.duration_seconds || 0)
        setCurrentTime(media.duration_watched_seconds || 0)

        // 2. Fetch sibling videos from the same folder
        if (media.folder_id) {
          try {
            const folderRes = await getFolder(media.folder_id, { page_size: 50, sort: 'name' })
            if (!cancelled) {
              setFolder(folderRes.folder)
              // Filter out the active item so only sibling videos are shown
              const siblings = (folderRes.media.items || []).filter((v) => v.id !== media.id)
              setSameFolderVideos(siblings)
            }
          } catch (fErr) {
            console.error('Failed to load folder siblings:', fErr)
          }
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Unable to load video')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    loadData()

    return () => {
      cancelled = true
    }
  }, [mediaId])

  // 2. Load recommendations for the selected tab (initial batch)
  const loadInitialRecommendations = useCallback(
    async (tab: RecTabType, currentMediaId: number, folderId?: number) => {
      setLoadingRecs(true)
      setRecPage(1)
      try {
        const res = await getRecommendationsPage({
          tab,
          page: 1,
          pageSize: 10,
          currentId: currentMediaId,
          folderId,
        })
        setRecItems(res.items)
        setRecHasMore(res.hasMore)
      } catch (err) {
        console.error('Failed to load initial recommendations:', err)
        setRecItems([])
        setRecHasMore(false)
      } finally {
        setLoadingRecs(false)
      }
    },
    []
  )

  // Trigger recommendation reload whenever active tab or media item changes
  useEffect(() => {
    if (mediaId) {
      loadInitialRecommendations(recTab, mediaId, item?.folder_id)
    }
  }, [mediaId, recTab, item?.folder_id, loadInitialRecommendations])

  // 3. Lazy-load / Infinite-scroll: fetch next batch of recommendations
  const loadMoreRecommendations = useCallback(async () => {
    if (loadingMoreRecs || loadingRecs || !recHasMore || !mediaId) return

    setLoadingMoreRecs(true)
    const nextPage = recPage + 1
    try {
      const res = await getRecommendationsPage({
        tab: recTab,
        page: nextPage,
        pageSize: 10,
        currentId: mediaId,
        folderId: item?.folder_id,
      })

      // Append new items while preventing duplicates
      setRecItems((prev) => {
        const seen = new Set(prev.map((i) => i.id))
        const newOnes = res.items.filter((i) => !seen.has(i.id))
        return [...prev, ...newOnes]
      })
      setRecPage(nextPage)
      setRecHasMore(res.hasMore)
    } catch (err) {
      console.error('Failed to lazy load more recommendations:', err)
      setRecHasMore(false)
    } finally {
      setLoadingMoreRecs(false)
    }
  }, [loadingMoreRecs, loadingRecs, recHasMore, mediaId, recPage, recTab, item?.folder_id])

  // 4. Sentinel IntersectionObserver for auto-triggering lazy load
  useEffect(() => {
    const sentinel = recSentinelRef.current
    if (!sentinel) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && recHasMore && !loadingMoreRecs && !loadingRecs) {
          loadMoreRecommendations()
        }
      },
      { root: null, rootMargin: '300px 0px', threshold: 0.1 }
    )

    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [loadMoreRecommendations, recHasMore, loadingMoreRecs, loadingRecs])

  // 5. Autoplay & Range stream / MPV initialization
  useEffect(() => {
    if (!item || item.media_type !== 'video') return

    let cancelled = false
    const startPlayback = async () => {
      const startTime = item.duration_watched_seconds || 0

      // If MPV is preferred/legacy format, launch MPV
      if (item.browser_native === 0 && isMpvAvailable) {
        try {
          const res = await playMpv(item, startTime)
          if (res?.success) return
        } catch {
          // fallback to HTML5
        }
      }

      // In-browser HTML5 playback
      const video = videoRef.current
      if (video && !cancelled) {
        video.volume = volume / 100
        video.muted = muted
        if (startTime > 0) {
          video.currentTime = startTime
        }
        video.play().then(() => setIsPlaying(true)).catch(() => setIsPlaying(false))
      }
    }

    startPlayback()

    return () => {
      cancelled = true
    }
  }, [item?.id, item?.browser_native, isMpvAvailable, playMpv])

  // Sync volume and muted state with AudioPreferenceProvider
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.volume = volume / 100
      videoRef.current.muted = muted
    }
  }, [volume, muted])

  // Sync duration & time with MPV if active
  useEffect(() => {
    if (isPoweredByMpv) {
      if (mpvState.duration > 0) setDuration(mpvState.duration)
      setCurrentTime(mpvState.currentTime)
      setIsPlaying(!mpvState.paused)
    }
  }, [isPoweredByMpv, mpvState.currentTime, mpvState.duration, mpvState.paused])

  // Fullscreen synchronization
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

  const handleToggleFavorite = async () => {
    if (!item) return
    const nextFav = isFavorite ? 0 : 1
    setIsFavorite(Boolean(nextFav))
    try {
      await updateMediaItem(item.id, { is_favorite: Boolean(nextFav) })
    } catch (err) {
      console.error('Failed to update favorite status:', err)
      setIsFavorite(Boolean(item.is_favorite))
    }
  }

  if (loading && !item) {
    return (
      <div className="player-loading-stage">
        <div className="skeleton player-skeleton-theater" />
        <div className="text-muted t-label">Loading player…</div>
      </div>
    )
  }

  if (error || !item) {
    return (
      <div className="page-enter empty-state" style={{ minHeight: '60dvh' }}>
        <svg className="empty-state-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
        <div className="empty-state-title">Video Unavailable</div>
        <div className="empty-state-body">{error || 'This media item could not be found.'}</div>
        <button className="btn-primary" onClick={() => navigate(-1)}>
          Go Back
        </button>
      </div>
    )
  }

  const resTag = cleanResolution(item.resolution)

  return (
    <div className="page-enter player-page-container">
      {/* ── 2-Column Responsive Layout: Main Theater (Left) + Recommendations (Right) ── */}
      <div className="player-layout-grid">
        {/* ── LEFT COLUMN: Main Video Player, Metadata Bar, Same Folder Section ── */}
        <main className="player-main-column">
          {/* Main Video Player Theater */}
          <div ref={theaterRef} className="player-theater-wrapper">
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

          {/* Video Metadata Header & Actions Bar */}
          <div className="player-meta-header">
            <div className="player-title-row">
              <h1 className="player-video-title">{item.title || item.filename}</h1>

              {/* Action Buttons */}
              <div className="player-action-buttons">
                <button
                  className={`player-action-pill${isFavorite ? ' active' : ''}`}
                  onClick={handleToggleFavorite}
                  type="button"
                  aria-label="Toggle favorite"
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill={isFavorite ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2">
                    <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
                  </svg>
                  <span>{isFavorite ? 'Saved' : 'Save'}</span>
                </button>

                {item.folder_id && (
                  <button
                    className="player-action-pill"
                    onClick={() => navigate(`/folders/${item.folder_id}`)}
                    type="button"
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                    </svg>
                    <span>Folder</span>
                  </button>
                )}

                {item.path && window.localfeed?.revealPath && (
                  <button
                    className="player-action-pill"
                    onClick={() => window.localfeed?.revealPath(item.path)}
                    type="button"
                    title="Reveal file in Windows Explorer"
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                      <polyline points="15 3 21 3 21 9" />
                      <line x1="10" y1="14" x2="21" y2="3" />
                    </svg>
                    <span>Reveal</span>
                  </button>
                )}
              </div>
            </div>

            {/* Metadata Tags Row */}
            <div className="player-meta-tags-row">
              {item.folder_name && (
                <span
                  className="player-tag-folder"
                  onClick={() => navigate(`/folders/${item.folder_id}`)}
                  role="button"
                  tabIndex={0}
                >
                  📁 {item.folder_display_name || item.folder_name}
                </span>
              )}
              {resTag && <span className="player-tag-badge">{resTag}</span>}
              {item.codec && <span className="player-tag-badge">{item.codec.toUpperCase()}</span>}
              {item.file_size_bytes && <span className="player-tag-badge">{formatBytes(item.file_size_bytes)}</span>}
              {item.duration_seconds && (
                <span className="player-tag-badge">{formatDuration(item.duration_seconds)}</span>
              )}
            </div>
          </div>

          {/* ── SAME FOLDER SECTION: Other videos from the same folder ──────── */}
          {sameFolderVideos.length > 0 && (
            <section className="player-same-folder-section">
              <div className="player-section-header">
                <div>
                  <h2 className="player-section-title">
                    Other videos in {folder?.display_name || folder?.name || 'this folder'}
                  </h2>
                  <span className="player-section-subtitle">
                    {sameFolderVideos.length} related item{sameFolderVideos.length === 1 ? '' : 's'}
                  </span>
                </div>
                {item.folder_id && (
                  <button
                    className="player-explore-all-btn"
                    onClick={() => navigate(`/folders/${item.folder_id}`)}
                    type="button"
                  >
                    View All Folder Media →
                  </button>
                )}
              </div>

              <div className="player-folder-grid">
                {sameFolderVideos.map((video) => (
                  <VideoCard
                    key={video.id}
                    item={video}
                    layout="grid"
                    showFolderTag={false}
                    onItemClick={(v) => {
                      navigate(`/watch/${v.id}`, { state: { from: location.pathname } })
                    }}
                  />
                ))}
              </div>
            </section>
          )}
        </main>

        {/* ── RIGHT COLUMN: Recommendation Sidebar with Lazy Load / Infinite Scroll ── */}
        <aside className="player-rec-sidebar" aria-label="Recommended Videos Sidebar">
          <div className="player-rec-header">
            <h2 className="player-rec-title">Recommendations</h2>
            <div className="player-rec-tabs">
              <button
                className={`player-rec-tab-btn${recTab === 'all' ? ' active' : ''}`}
                onClick={() => setRecTab('all')}
                type="button"
              >
                All
              </button>
              <button
                className={`player-rec-tab-btn${recTab === 'recent' ? ' active' : ''}`}
                onClick={() => setRecTab('recent')}
                type="button"
              >
                Recent
              </button>
              <button
                className={`player-rec-tab-btn${recTab === 'random' ? ' active' : ''}`}
                onClick={() => setRecTab('random')}
                type="button"
              >
                Random
              </button>
              <button
                className={`player-rec-tab-btn${recTab === 'watched' ? ' active' : ''}`}
                onClick={() => setRecTab('watched')}
                type="button"
              >
                Watched
              </button>
            </div>
          </div>

          {/* Compact Sidebar List with Infinite Scroll */}
          <div className="player-rec-list">
            {loadingRecs && recItems.length === 0 ? (
              Array.from({ length: 6 }).map((_, i) => (
                <div key={`rec-skel-${i}`} className="skeleton video-card-compact-skeleton" />
              ))
            ) : recItems.length === 0 ? (
              <div className="player-rec-empty">No additional recommendations found.</div>
            ) : (
              recItems.map((recItem) => (
                <VideoCard
                  key={`${recTab}-${recItem.id}`}
                  item={recItem}
                  layout="compact"
                  onItemClick={(v) => {
                    navigate(`/watch/${v.id}`, { state: { from: location.pathname } })
                  }}
                />
              ))
            )}

            {/* Loading more spinner / skeleton chips */}
            {loadingMoreRecs && (
              <div className="rec-loading-more-row">
                <span className="rec-loading-dot" />
                <span className="rec-loading-dot" />
                <span className="rec-loading-dot" />
                <span className="text-muted" style={{ fontSize: 11, marginLeft: 6 }}>
                  Loading more…
                </span>
              </div>
            )}

            {/* Fallback Load More Button if auto-scroll reaches bottom */}
            {recHasMore && !loadingRecs && (
              <button
                className="player-rec-loadmore-btn"
                onClick={loadMoreRecommendations}
                disabled={loadingMoreRecs}
                type="button"
              >
                {loadingMoreRecs ? 'Loading more…' : 'Load more recommendations ↓'}
              </button>
            )}

            {/* Invisible sentinel for lazy-loading on scroll */}
            <div ref={recSentinelRef} className="rec-sentinel" />
          </div>
        </aside>
      </div>
    </div>
  )
}
