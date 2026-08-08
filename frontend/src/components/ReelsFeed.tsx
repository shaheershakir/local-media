import { useEffect, useRef, useState, useCallback } from 'react'
import { useInfiniteFeed } from '../hooks/useInfiniteFeed'
import { MediaCard } from './MediaCard'

const TYPE_OPTIONS: { value: 'video' | 'image' | ''; label: string; icon: string }[] = [
  { value: '', label: 'All', icon: 'all' },
  { value: 'video', label: 'Videos', icon: 'video' },
  { value: 'image', label: 'Photos', icon: 'photo' },
]

/**
 * ReelsFeed — full-screen vertical scroll-snap feed.
 * TikTok-style instant autoplay on scroll, active card tracking,
 * proximity-based socket connection management, keyboard navigation,
 * and media type filtering (All / Videos / Photos).
 */
export function ReelsFeed() {
  const containerRef = useRef<HTMLDivElement>(null)
  const [mediaType, setMediaType] = useState<'video' | 'image' | ''>('')
  const { items, loading, error, fetchBatch, onCardVisible } = useInfiniteFeed(mediaType || null)
  const [activeIndex, setActiveIndex] = useState(0)

  // Handle filter change with smooth scroll to top
  const handleTypeChange = (type: 'video' | 'image' | '') => {
    if (type === mediaType) return
    setMediaType(type)
    setActiveIndex(0)
    if (containerRef.current) {
      containerRef.current.scrollTo({ top: 0, behavior: 'instant' })
    }
  }

  // Initial load
  useEffect(() => {
    if (items.length === 0) {
      fetchBatch()
    }
  }, [fetchBatch, items.length])

  // Scroll listener to calculate and track which card is active/centered
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    let animFrame: number | null = null

    const handleScroll = () => {
      if (animFrame) cancelAnimationFrame(animFrame)
      animFrame = requestAnimationFrame(() => {
        const children = Array.from(container.querySelectorAll('.reel-card')) as HTMLElement[]
        if (children.length === 0) return

        const containerCenter = container.scrollTop + container.clientHeight / 2
        let closestIndex = 0
        let minDistance = Infinity

        children.forEach((child, idx) => {
          const cardCenter = child.offsetTop + child.clientHeight / 2
          const dist = Math.abs(containerCenter - cardCenter)
          if (dist < minDistance) {
            minDistance = dist
            closestIndex = idx
          }
        })

        setActiveIndex((prev) => (prev !== closestIndex ? closestIndex : prev))
      })
    }

    container.addEventListener('scroll', handleScroll, { passive: true })
    handleScroll()

    return () => {
      container.removeEventListener('scroll', handleScroll)
      if (animFrame) cancelAnimationFrame(animFrame)
    }
  }, [items.length])

  // Keyboard navigation for feed scroll (ArrowDown / ArrowUp / PageDown / PageUp)
  const scrollToCard = useCallback((targetIndex: number) => {
    const container = containerRef.current
    if (!container) return
    const children = Array.from(container.querySelectorAll('.reel-card')) as HTMLElement[]
    const targetEl = children[targetIndex]
    if (targetEl) {
      targetEl.scrollIntoView({ behavior: 'smooth', block: 'start' })
      setActiveIndex(targetIndex)
    }
  }, [])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return

      if (e.key === 'ArrowDown' || e.key === 'PageDown') {
        if (activeIndex < items.length - 1) {
          e.preventDefault()
          scrollToCard(activeIndex + 1)
        }
      } else if (e.key === 'ArrowUp' || e.key === 'PageUp') {
        if (activeIndex > 0) {
          e.preventDefault()
          scrollToCard(activeIndex - 1)
        }
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [activeIndex, items.length, scrollToCard])

  return (
    <div className="reels-wrapper">
      {/* Floating Filter Bar */}
      <div className="reels-filter-bar" role="tablist" aria-label="Media filter">
        {TYPE_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={mediaType === opt.value}
            className={`reels-filter-pill${mediaType === opt.value ? ' active' : ''}`}
            onClick={() => handleTypeChange(opt.value)}
            title={`Filter by ${opt.label}`}
          >
            {opt.value === '' && (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
            )}
            {opt.value === 'video' && (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                <polygon points="6 4 20 12 6 20 6 4" />
              </svg>
            )}
            {opt.value === 'image' && (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <polyline points="21 15 16 10 5 21" />
              </svg>
            )}
            <span>{opt.label}</span>
          </button>
        ))}
      </div>

      {/* Main Feed Container */}
      {items.length === 0 && loading ? (
        <div
          style={{
            height: 'calc(100dvh - var(--nav-height))',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexDirection: 'column',
            gap: 16,
          }}
        >
          <div className="skeleton" style={{ width: 48, height: 48, borderRadius: '50%' }} />
          <div className="text-muted t-label">Loading feed…</div>
        </div>
      ) : items.length === 0 && error ? (
        <div className="empty-state" style={{ height: 'calc(100dvh - var(--nav-height))' }}>
          <svg className="empty-state-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <div className="empty-state-title">Could not load feed</div>
          <div className="empty-state-body">{error}</div>
          <button className="btn-primary" onClick={fetchBatch}>
            Retry
          </button>
        </div>
      ) : items.length === 0 ? (
        <div className="empty-state" style={{ height: 'calc(100dvh - var(--nav-height))' }}>
          <svg className="empty-state-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <polyline points="21 15 16 10 5 21" />
          </svg>
          <div className="empty-state-title">
            {mediaType === 'image' ? 'No photos found' : mediaType === 'video' ? 'No videos found' : 'No media found'}
          </div>
          <div className="empty-state-body">
            {mediaType
              ? `No ${mediaType === 'image' ? 'photos' : 'videos'} match your current filter.`
              : 'Configure your media roots in Settings and trigger a scan.'}
          </div>
          {mediaType && (
            <button className="btn-primary" style={{ marginTop: 12 }} onClick={() => handleTypeChange('')}>
              Show All Media
            </button>
          )}
        </div>
      ) : (
        <div ref={containerRef} className="reels-container" tabIndex={0} aria-label="Media Reels Feed">
          {items.map((item, index) => (
            <MediaCard
              key={`${item.id}-${index}`}
              item={item}
              index={index}
              activeIndex={activeIndex}
              isActive={index === activeIndex}
              onCardVisible={onCardVisible}
            />
          ))}
          {/* Loading sentinel */}
          {loading && items.length > 0 && (
            <div className="reel-card" style={{ background: 'var(--c-deep)' }}>
              <div className="text-muted t-label">Loading more…</div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
