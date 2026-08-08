import { useEffect, useRef, useState, useCallback } from 'react'
import { useLocation } from 'react-router-dom'
import { useNavigationStack } from '../hooks/useNavigationStack'

const SWIPE_THRESHOLD = 110 // px required to trigger back
const WHEEL_TIMEOUT = 180 // ms of inactivity before gesture resolves

export function NavigationGestures() {
  const { canGoBack, canGoForward, goBack, goForward } = useNavigationStack()
  const location = useLocation()

  // Visual gesture state
  const [gestureActive, setGestureActive] = useState(false)
  const [gestureProgress, setGestureProgress] = useState(0) // 0 to 1
  const [thresholdReached, setThresholdReached] = useState(false)
  const [visualX, setVisualX] = useState(-60)

  // Internal refs
  const accumulatedDeltaXRef = useRef(0)
  const wheelTimerRef = useRef<number | null>(null)
  const isGesturingRef = useRef(false)
  const touchStartRef = useRef<{ x: number; y: number; time: number } | null>(null)
  const canGoBackRef = useRef(canGoBack)
  canGoBackRef.current = canGoBack

  const resetGesture = useCallback(() => {
    isGesturingRef.current = false
    accumulatedDeltaXRef.current = 0
    setGestureActive(false)
    setGestureProgress(0)
    setThresholdReached(false)
    setVisualX(-60)
  }, [])

  // 1. Trackpad Two-Finger Swipe Gesture (Wheel Events)
  useEffect(() => {
    const handleWheel = (e: WheelEvent) => {
      // We only care about horizontal gestures moving left-to-right (deltaX < 0)
      const isHorizontal = Math.abs(e.deltaX) > Math.abs(e.deltaY) * 1.2
      const isSwipingRight = isHorizontal && e.deltaX < -2

      // Check if the element or any scrollable container under cursor is NOT at left boundary
      let target = e.target as HTMLElement | null
      let isInsideScrollable = false
      while (target && target !== document.body) {
        if (target.scrollWidth > target.clientWidth && target.scrollLeft > 2) {
          isInsideScrollable = true
          break
        }
        target = target.parentElement
      }

      // If user is scrolling inside a horizontal list/carousel, don't hijack unless at left edge
      if (isInsideScrollable) {
        if (isGesturingRef.current) {
          resetGesture()
        }
        return
      }

      if (isSwipingRight && canGoBackRef.current) {
        // Accumulate distance
        isGesturingRef.current = true
        accumulatedDeltaXRef.current += Math.abs(e.deltaX)
        const progress = Math.min(1.2, accumulatedDeltaXRef.current / SWIPE_THRESHOLD)
        const reached = progress >= 1.0

        // Rubber band offset for visual pill (from -50px offscreen to ~54px onto screen)
        const visualOffset = -50 + Math.pow(Math.min(1, progress), 0.7) * 104

        setGestureActive(true)
        setGestureProgress(Math.min(1, progress))
        setThresholdReached(reached)
        setVisualX(visualOffset)

        // Reset inactivity timer
        if (wheelTimerRef.current) clearTimeout(wheelTimerRef.current)
        wheelTimerRef.current = window.setTimeout(() => {
          if (isGesturingRef.current) {
            if (accumulatedDeltaXRef.current >= SWIPE_THRESHOLD && canGoBackRef.current) {
              // Trigger back!
              goBack()
            }
            resetGesture()
          }
        }, WHEEL_TIMEOUT)
      } else if (e.deltaX > 5 && isGesturingRef.current) {
        // User reversed swipe direction -> cancel
        if (wheelTimerRef.current) clearTimeout(wheelTimerRef.current)
        resetGesture()
      }
    }

    window.addEventListener('wheel', handleWheel, { passive: true })
    return () => {
      window.removeEventListener('wheel', handleWheel)
      if (wheelTimerRef.current) clearTimeout(wheelTimerRef.current)
    }
  }, [goBack, resetGesture])

  // 2. Touch Drag Gestures (Mobile / Touchscreen Trackpads)
  useEffect(() => {
    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return
      const touch = e.touches[0]
      // Only initiate if starting within 70px from left edge or if page is at left scroll boundary
      if (touch.clientX < 80) {
        touchStartRef.current = {
          x: touch.clientX,
          y: touch.clientY,
          time: Date.now(),
        }
      }
    }

    const handleTouchMove = (e: TouchEvent) => {
      if (!touchStartRef.current || !canGoBackRef.current) return
      const touch = e.touches[0]
      const deltaX = touch.clientX - touchStartRef.current.x
      const deltaY = touch.clientY - touchStartRef.current.y

      // Only horizontal drags
      if (Math.abs(deltaY) > Math.abs(deltaX) && !isGesturingRef.current) {
        touchStartRef.current = null
        return
      }

      if (deltaX > 10) {
        isGesturingRef.current = true
        const progress = Math.min(1.2, deltaX / SWIPE_THRESHOLD)
        const reached = progress >= 1.0
        const visualOffset = -50 + Math.pow(Math.min(1, progress), 0.7) * 104

        setGestureActive(true)
        setGestureProgress(Math.min(1, progress))
        setThresholdReached(reached)
        setVisualX(visualOffset)
      }
    }

    const handleTouchEnd = () => {
      if (isGesturingRef.current) {
        if (thresholdReached && canGoBackRef.current) {
          goBack()
        }
        resetGesture()
      }
      touchStartRef.current = null
    }

    window.addEventListener('touchstart', handleTouchStart, { passive: true })
    window.addEventListener('touchmove', handleTouchMove, { passive: true })
    window.addEventListener('touchend', handleTouchEnd, { passive: true })
    window.addEventListener('touchcancel', handleTouchEnd, { passive: true })

    return () => {
      window.removeEventListener('touchstart', handleTouchStart)
      window.removeEventListener('touchmove', handleTouchMove)
      window.removeEventListener('touchend', handleTouchEnd)
      window.removeEventListener('touchcancel', handleTouchEnd)
    }
  }, [canGoBack, thresholdReached, goBack, resetGesture])

  // 3. Mouse Navigation Buttons (Button 3 = Back, Button 4 = Forward)
  useEffect(() => {
    const handleMouseUp = (e: MouseEvent) => {
      // 3 = Browser Back, 4 = Browser Forward
      if (e.button === 3) {
        e.preventDefault()
        e.stopPropagation()
        if (canGoBackRef.current) {
          goBack()
        }
      } else if (e.button === 4) {
        e.preventDefault()
        e.stopPropagation()
        if (canGoForward) {
          goForward()
        }
      }
    }

    // Capture on window to catch all clicks
    window.addEventListener('mouseup', handleMouseUp, true)
    return () => window.removeEventListener('mouseup', handleMouseUp, true)
  }, [canGoForward, goBack, goForward])

  // 4. Keyboard Shortcuts (Alt+Left, Backspace, Alt+Right, Escape)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const isInput =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        Boolean(target?.isContentEditable)

      // Alt + LeftArrow or BrowserBack
      if ((e.altKey && e.key === 'ArrowLeft') || e.key === 'BrowserBack') {
        e.preventDefault()
        if (canGoBackRef.current) {
          goBack()
        }
        return
      }

      // Alt + RightArrow or BrowserForward
      if ((e.altKey && e.key === 'ArrowRight') || e.key === 'BrowserForward') {
        e.preventDefault()
        if (canGoForward) {
          goForward()
        }
        return
      }

      // Backspace outside of form inputs
      if (e.key === 'Backspace' && !isInput && !e.altKey && !e.ctrlKey && !e.metaKey) {
        e.preventDefault()
        if (canGoBackRef.current) {
          goBack()
        }
        return
      }

      // Escape in detail views (watch / media / folder)
      if (e.key === 'Escape' && !isInput) {
        const isDetailView =
          location.pathname.startsWith('/watch/') ||
          location.pathname.startsWith('/media/') ||
          location.pathname.startsWith('/folders/')
        if (isDetailView && canGoBackRef.current) {
          e.preventDefault()
          goBack()
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [canGoForward, goBack, goForward, location.pathname])

  if (!gestureActive && visualX <= -55) return null

  return (
    <div
      className={`swipe-back-overlay${thresholdReached ? ' ready' : ''}`}
      aria-hidden="true"
    >
      {/* Floating Chromium-style Pill Indicator */}
      <div
        className={`swipe-back-pill${thresholdReached ? ' active' : ''}`}
        style={{
          transform: `translate3d(${visualX}px, -50%, 0) scale(${0.85 + gestureProgress * 0.25})`,
          opacity: Math.max(0.1, gestureProgress),
        }}
      >
        {/* Animated Progress Ring */}
        <svg className="swipe-back-ring" viewBox="0 0 36 36">
          <circle
            className="swipe-back-ring-bg"
            cx="18"
            cy="18"
            r="15.5"
            fill="none"
            strokeWidth="2.5"
          />
          <circle
            className="swipe-back-ring-fill"
            cx="18"
            cy="18"
            r="15.5"
            fill="none"
            strokeWidth="2.5"
            strokeDasharray="97.4"
            strokeDashoffset={97.4 * (1 - gestureProgress)}
          />
        </svg>

        {/* Back Chevron Icon */}
        <svg
          className="swipe-back-icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <line x1="19" y1="12" x2="5" y2="12" />
          <polyline points="12 19 5 12 12 5" />
        </svg>
      </div>
    </div>
  )
}
