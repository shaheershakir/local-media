import { useState, useCallback, useRef } from 'react'
import { getRandomFeed } from '../api/media'
import type { MediaItem } from '../api/types'

const BATCH_SIZE = 10
const PREFETCH_THRESHOLD = 3 // load more when N cards from end
const MAX_EXCLUDE_WINDOW = 25 // sliding window to keep query strings bounded

/**
 * useInfiniteFeed
 *
 * Manages an infinite, non-repeating feed of random media items.
 * Uses a sliding-window exclusion list to prevent URL parameter explosion.
 * Protects against infinite re-fetch loops and socket congestion.
 */
export function useInfiniteFeed(mediaType?: 'video' | 'image' | null) {
  const [items, setItems] = useState<MediaItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  
  // Sliding window of recent IDs (capped to MAX_EXCLUDE_WINDOW)
  const recentIds = useRef<number[]>([])
  const totalAvailable = useRef(0)
  const loadingRef = useRef(false)
  const lastFetchTime = useRef(0)

  const fetchBatch = useCallback(async () => {
    // Guard against simultaneous overlapping fetches
    if (loadingRef.current) return
    const now = Date.now()
    if (now - lastFetchTime.current < 250) return // 250ms cooldown

    loadingRef.current = true
    lastFetchTime.current = now
    setLoading(true)
    setError(null)

    try {
      const data = await getRandomFeed({
        limit: BATCH_SIZE,
        exclude_ids: recentIds.current.slice(-MAX_EXCLUDE_WINDOW),
        media_type: mediaType ?? null,
      })

      totalAvailable.current = data.total_available
      const batch = data.items || []

      if (batch.length === 0) {
        if (recentIds.current.length > 0) {
          // Reset exclusion window and fetch a fresh batch
          recentIds.current = []
          const fresh = await getRandomFeed({
            limit: BATCH_SIZE,
            media_type: mediaType ?? null,
          })
          if (fresh.items?.length) {
            fresh.items.forEach((item) => {
              recentIds.current.push(item.id)
            })
            if (recentIds.current.length > MAX_EXCLUDE_WINDOW) {
              recentIds.current = recentIds.current.slice(-MAX_EXCLUDE_WINDOW)
            }
            setItems((prev) => [...prev, ...fresh.items])
          }
        }
      } else {
        // Track recent IDs with sliding window cap
        batch.forEach((item) => {
          recentIds.current.push(item.id)
        })
        if (recentIds.current.length > MAX_EXCLUDE_WINDOW) {
          recentIds.current = recentIds.current.slice(-MAX_EXCLUDE_WINDOW)
        }

        setItems((prev) => [...prev, ...batch])
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load feed')
    } finally {
      loadingRef.current = false
      setLoading(false)
    }
  }, [mediaType])

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
