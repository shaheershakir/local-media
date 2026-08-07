import { useEffect, useRef, useState, useCallback } from 'react'
import { useInfiniteFeed } from '../hooks/useInfiniteFeed'
import { MediaCard } from './MediaCard'

/**
 * ReelsFeed — full-screen vertical scroll-snap feed.
 * TikTok-style instant autoplay on scroll, active card tracking,
 * proximity-based socket connection management, and keyboard navigation.
 */
export function ReelsFeed() {
  const containerRef = useRef<HTMLDivElement>(null)
  const { items, loading, error, fetchBatch, onCardVisible } = useInfiniteFeed()
  const [activeIndex, setActiveIndex] = useState(0)

  // Initial load
  useEffect(() => {
    if (items.length === 0) {
      fetchBatch()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

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

  if (items.length === 0 && loading) {
    return (
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
    )
  }

  if (items.length === 0 && error) {
    return (
      <div className="empty-state">
        <svg className="empty-state-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
          <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
        <div className="empty-state-title">Could not load feed</div>
        <div className="empty-state-body">{error}</div>
        <button className="btn-primary" onClick={fetchBatch}>Retry</button>
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <div className="empty-state">
        <svg className="empty-state-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
        <div className="empty-state-title">No media found</div>
        <div className="empty-state-body">
          Configure your media roots in <code style={{ color: 'var(--c-amber)' }}>.env</code> and trigger a scan.
        </div>
      </div>
    )
  }

  return (
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
  )
}
