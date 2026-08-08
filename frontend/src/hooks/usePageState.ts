import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { useNavigationStack } from './useNavigationStack'

/**
 * Hook to automatically persist and restore component state across stack-based back/forward navigation.
 */
export function usePageState<T extends Record<string, any>>(
  customKey?: string,
  initialStateGetter?: () => T,
  onStateRestored?: (state: T) => void
) {
  const location = useLocation()
  const { savePageState, getPageState } = useNavigationStack()
  const key = customKey || `${location.pathname}${location.search}`
  const stateRef = useRef<T | null>(null)

  // Retrieve cached state if available
  const savedState = getPageState<T>(key)

  // Keep state updated
  const updateState = (newState: T | ((prev: T) => T)) => {
    const updated =
      typeof newState === 'function' ? (newState as any)(stateRef.current || (initialStateGetter ? initialStateGetter() : {})) : newState
    stateRef.current = updated
    savePageState(key, updated)
  }

  useEffect(() => {
    if (savedState && onStateRestored) {
      onStateRestored(savedState)
    }
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps

  return {
    savedState,
    updateState,
  }
}
