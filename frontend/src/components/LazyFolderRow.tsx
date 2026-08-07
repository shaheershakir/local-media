import { useState, useEffect, useRef, useCallback, memo } from 'react'
import type { Folder, MediaItem } from '../api/types'
import { getFolder } from '../api/folders'
import { MediaRow } from './MediaRow'

export interface LazyFolderRowProps {
  folder: Folder
  onItemClick: (item: MediaItem) => void
  onToggleFavorite?: (e: React.MouseEvent, item: MediaItem) => void
}

/**
 * High-performance LazyFolderRow component.
 * Uses IntersectionObserver to defer fetching folder items until the section
 * scrolls near the viewport. Avoids unnecessary parallel API queries on load.
 */
export const LazyFolderRow = memo(function LazyFolderRow({
  folder,
  onItemClick,
  onToggleFavorite,
}: LazyFolderRowProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [items, setItems] = useState<MediaItem[]>([])
  const [total, setTotal] = useState<number>(folder.item_count || 0)
  const [hasLoaded, setHasLoaded] = useState(false)
  const [isIntersecting, setIsIntersecting] = useState(false)

  // 1. Observe when this row approaches viewport (with 400px overscan margin)
  useEffect(() => {
    const el = containerRef.current
    if (!el || hasLoaded) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setIsIntersecting(true)
          observer.disconnect()
        }
      },
      { root: null, rootMargin: '400px 0px', threshold: 0.01 }
    )

    observer.observe(el)
    return () => observer.disconnect()
  }, [hasLoaded])

  // 2. Fetch folder items only when intersecting
  const loadFolderItems = useCallback(async () => {
    if (hasLoaded) return
    try {
      const res = await getFolder(folder.id, { page_size: 20, sort: 'newest' })
      setItems(res.media.items || [])
      setTotal(res.media.total || folder.item_count || 0)
      setHasLoaded(true)
    } catch (err) {
      console.error(`Failed to lazy load folder ${folder.name}:`, err)
      setHasLoaded(true)
    }
  }, [folder.id, folder.name, folder.item_count, hasLoaded])

  useEffect(() => {
    if (isIntersecting && !hasLoaded) {
      loadFolderItems()
    }
  }, [isIntersecting, hasLoaded, loadFolderItems])

  const folderTitle = folder.display_name || folder.name
  const totalCount = total || folder.item_count || 0

  return (
    <div ref={containerRef} className="lazy-folder-row-wrap">
      {hasLoaded && items.length > 0 ? (
        <MediaRow
          title={folderTitle}
          subtitle={`${totalCount.toLocaleString()} item${totalCount === 1 ? '' : 's'}`}
          moreLink={`/folders/${folder.id}`}
          moreLabel={`Explore ${folderTitle} (${totalCount}) →`}
          items={items}
          onItemClick={onItemClick}
          onToggleFavorite={onToggleFavorite}
        />
      ) : !hasLoaded ? (
        <div className="home-shelf-section home-shelf-skeleton-section">
          <div className="home-shelf-header">
            <div className="home-shelf-title-group">
              <h2 className="home-shelf-title">{folderTitle}</h2>
              <span className="home-shelf-subtitle">
                {totalCount > 0 ? `${totalCount} items` : 'Loading…'}
              </span>
            </div>
          </div>
          <div className="home-shelf-scroll-row">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={`skel-${i}`} className="skeleton shelf-media-card" style={{ height: 180 }} />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
})
