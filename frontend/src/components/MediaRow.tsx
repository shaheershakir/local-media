import { useRef, useState, useEffect, useCallback, useMemo, memo } from 'react'
import { useNavigate } from 'react-router-dom'
import type { MediaItem } from '../api/types'
import { VideoCard } from './VideoCard'
import { ImageCard } from './ImageCard'
import { SectionHeader } from './SectionHeader'

export interface MediaRowProps {
  title: string
  subtitle?: string
  moreLink?: string
  moreLabel?: string
  items: MediaItem[]
  onItemClick: (item: MediaItem) => void
  onToggleFavorite?: (e: React.MouseEvent, item: MediaItem) => void
  showProgress?: boolean
  emptyMessage?: string
}

const CARD_ESTIMATED_WIDTH = 276 // 260px width + 16px gap
const OVERSCAN = 3 // Extra cards rendered offscreen on left/right for smooth scrolling

/**
 * High-performance virtualized horizontal MediaRow component.
 * Supports polymorphic rendering of VideoCard and ImageCard with smooth
 * left/right arrow controls, horizontal windowing, and React.memo.
 */
export const MediaRow = memo(function MediaRow({
  title,
  subtitle,
  moreLink,
  moreLabel,
  items,
  onItemClick,
  onToggleFavorite,
  showProgress = false,
  emptyMessage,
}: MediaRowProps) {
  const navigate = useNavigate()
  const scrollRef = useRef<HTMLDivElement>(null)
  const [scrollLeft, setScrollLeft] = useState(0)
  const [containerWidth, setContainerWidth] = useState(1200)
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(true)

  const checkScrollState = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const sLeft = el.scrollLeft
    setScrollLeft(sLeft)
    setContainerWidth(el.clientWidth || 1200)
    setCanScrollLeft(sLeft > 10)
    setCanScrollRight(sLeft < el.scrollWidth - el.clientWidth - 10)
  }, [])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    checkScrollState()
    el.addEventListener('scroll', checkScrollState, { passive: true })
    window.addEventListener('resize', checkScrollState)
    return () => {
      el.removeEventListener('scroll', checkScrollState)
      window.removeEventListener('resize', checkScrollState)
    }
  }, [checkScrollState, items.length])

  const handleScroll = (direction: 'left' | 'right') => {
    const el = scrollRef.current
    if (!el) return
    const scrollAmount = el.clientWidth * 0.75
    el.scrollBy({
      left: direction === 'left' ? -scrollAmount : scrollAmount,
      behavior: 'smooth',
    })
  }

  // ── Horizontal Virtualization Window Calculation ──────────────────────────
  // Compute visible card index range with overscan
  const { startIndex, padLeft, padRight, visibleItems } = useMemo(() => {
    if (items.length <= 8) {
      // For short rows, render all items directly
      return {
        startIndex: 0,
        padLeft: 0,
        padRight: 0,
        visibleItems: items,
      }
    }

    const firstVisible = Math.floor(scrollLeft / CARD_ESTIMATED_WIDTH)
    const visibleCount = Math.ceil(containerWidth / CARD_ESTIMATED_WIDTH)

    const start = Math.max(0, firstVisible - OVERSCAN)
    const end = Math.min(items.length, firstVisible + visibleCount + OVERSCAN)

    const leftSpacer = start * CARD_ESTIMATED_WIDTH
    const rightSpacer = Math.max(0, (items.length - end) * CARD_ESTIMATED_WIDTH)

    return {
      startIndex: start,
      endIndex: end,
      padLeft: leftSpacer,
      padRight: rightSpacer,
      visibleItems: items.slice(start, end),
    }
  }, [items, scrollLeft, containerWidth])

  if (items.length === 0 && !emptyMessage) return null

  return (
    <section className="home-shelf-section">
      <SectionHeader
        title={title}
        subtitle={subtitle}
        moreLink={moreLink}
        moreLabel={moreLabel}
        onMoreClick={moreLink ? () => navigate(moreLink) : undefined}
      />

      <div className="home-shelf-wrapper">
        {canScrollLeft && (
          <button
            className="shelf-arrow-btn shelf-arrow-left"
            onClick={() => handleScroll('left')}
            aria-label={`Scroll ${title} left`}
            type="button"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
        )}

        <div ref={scrollRef} className="home-shelf-scroll-row">
          {/* Virtual left spacer */}
          {padLeft > 0 && (
            <div
              style={{ width: padLeft, flexShrink: 0, height: 1, pointerEvents: 'none' }}
              aria-hidden="true"
            />
          )}

          {/* Rendered window of cards */}
          {visibleItems.map((item, idx) =>
            item.media_type === 'image' ? (
              <ImageCard
                key={item.id || startIndex + idx}
                item={item}
                layout="shelf"
                onItemClick={onItemClick}
                onToggleFavorite={onToggleFavorite}
              />
            ) : (
              <VideoCard
                key={item.id || startIndex + idx}
                item={item}
                layout="shelf"
                showProgress={showProgress}
                onItemClick={onItemClick}
                onToggleFavorite={onToggleFavorite}
              />
            )
          )}

          {/* Virtual right spacer */}
          {padRight > 0 && (
            <div
              style={{ width: padRight, flexShrink: 0, height: 1, pointerEvents: 'none' }}
              aria-hidden="true"
            />
          )}
        </div>

        {canScrollRight && (
          <button
            className="shelf-arrow-btn shelf-arrow-right"
            onClick={() => handleScroll('right')}
            aria-label={`Scroll ${title} right`}
            type="button"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 18l6-6-6-6" />
            </svg>
          </button>
        )}
      </div>
    </section>
  )
})
