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

  const fetchBatch = useCallback(async () => {
    if (loading) return
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
      setLoading(false)
    }
  }, [loading, mediaType])

  const onCardVisible = useCallback(
    (index: number) => {
      if (!loading && items.length - index <= PREFETCH_THRESHOLD) {
        fetchBatch()
      }
    },
    [items.length, loading, fetchBatch]
  )

  return { items, loading, error, fetchBatch, onCardVisible }
}
