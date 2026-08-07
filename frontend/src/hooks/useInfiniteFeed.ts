import { useState, useCallback, useRef } from 'react'
import { getRandomFeed } from '../api/media'
import type { MediaItem } from '../api/types'

const BATCH_SIZE = 10
const PREFETCH_THRESHOLD = 3 // load more when N cards from end

/**
 * useInfiniteFeed
 *
 * Manages an infinite, non-repeating feed of random media items.
 * Maintains a set of shown IDs to avoid immediate repeats.
 * Fetches the next batch when the user nears the end.
 */
export function useInfiniteFeed(mediaType?: 'video' | 'image' | null) {
  const [items, setItems] = useState<MediaItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const shownIds = useRef<Set<number>>(new Set())
  const totalAvailable = useRef(0)
  // useRef guard — avoids stale closure when `loading` is used as a dep
  const loadingRef = useRef(false)

  const fetchBatch = useCallback(async () => {
    if (loadingRef.current) return
    loadingRef.current = true
    setLoading(true)
    setError(null)
    try {
      const data = await getRandomFeed({
        limit: BATCH_SIZE,
        exclude_ids: Array.from(shownIds.current),
        media_type: mediaType ?? null,
      })
      totalAvailable.current = data.total_available
      const newItems = data.items.filter((item) => !shownIds.current.has(item.id))
      newItems.forEach((item) => shownIds.current.add(item.id))

      if (newItems.length === 0 && shownIds.current.size > 0) {
        // Exhausted all items — reset and refetch
        shownIds.current.clear()
        const fresh = await getRandomFeed({
          limit: BATCH_SIZE,
          media_type: mediaType ?? null,
        })
        fresh.items.forEach((item) => shownIds.current.add(item.id))
        setItems((prev) => [...prev, ...fresh.items])
      } else {
        setItems((prev) => [...prev, ...newItems])
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load feed')
    } finally {
      loadingRef.current = false
      setLoading(false)
    }
  }, [mediaType]) // ← removed `loading` from deps

  const onCardVisible = useCallback(
    (index: number) => {
      if (!loadingRef.current && items.length - index <= PREFETCH_THRESHOLD) {
        fetchBatch()
      }
    },
    [items.length, fetchBatch]
  )

  return { items, loading, error, fetchBatch, onCardVisible }
}
