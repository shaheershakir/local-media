import { useEffect, useRef, useCallback } from 'react'

/**
 * useIntersectionAutoplay
 *
 * Attaches an IntersectionObserver to a video element.
 * The video plays when it's >= threshold visible in the viewport, pauses otherwise.
 * Returns a ref to attach to the video element.
 */
export function useIntersectionAutoplay(
  isActive: boolean,
  threshold = 0.8
) {
  const videoRef = useRef<HTMLVideoElement>(null)

  const handleIntersection = useCallback(
    (entries: IntersectionObserverEntry[]) => {
      const entry = entries[0]
      const video = videoRef.current
      if (!video || !isActive) return

      if (entry.isIntersecting && entry.intersectionRatio >= threshold) {
        video.play().catch(() => {
          // Autoplay blocked — keep muted and retry
          video.muted = true
          video.play().catch(() => {})
        })
      } else {
        video.pause()
      }
    },
    [isActive, threshold]
  )

  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    const observer = new IntersectionObserver(handleIntersection, {
      threshold: [0, threshold],
    })
    observer.observe(video)

    return () => {
      observer.disconnect()
      // Reset video when unmounted / inactive
      if (!video.paused) video.pause()
      video.currentTime = 0
    }
  }, [handleIntersection, threshold])

  return videoRef
}
