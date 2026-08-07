import { useRef, useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import type { MediaItem } from '../api/types'
import { VideoCard } from './VideoCard'
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

/**
 * Reusable MediaRow component for horizontal video shelves with scroll controls.
 */
export function MediaRow({
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
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(true)

  const checkScrollButtons = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    setCanScrollLeft(el.scrollLeft > 10)
    setCanScrollRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 10)
  }, [])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    checkScrollButtons()
    el.addEventListener('scroll', checkScrollButtons, { passive: true })
    window.addEventListener('resize', checkScrollButtons)
    return () => {
      el.removeEventListener('scroll', checkScrollButtons)
      window.removeEventListener('resize', checkScrollButtons)
    }
  }, [checkScrollButtons, items.length])

  const handleScroll = (direction: 'left' | 'right') => {
    const el = scrollRef.current
    if (!el) return
    const scrollAmount = el.clientWidth * 0.75
    el.scrollBy({
      left: direction === 'left' ? -scrollAmount : scrollAmount,
      behavior: 'smooth',
    })
  }

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
          {items.map((item) => (
            <VideoCard
              key={item.id}
              item={item}
              layout="shelf"
              showProgress={showProgress}
              onItemClick={onItemClick}
              onToggleFavorite={onToggleFavorite}
            />
          ))}
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
}
