import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

export interface StackEntry {
  id: string
  path: string
  search: string
  hash: string
  fullUrl: string
  title: string
  scrollX: number
  scrollY: number
  pageState?: Record<string, any>
  timestamp: number
}

interface NavigationStackContextType {
  stack: StackEntry[]
  currentIndex: number
  currentEntry: StackEntry | null
  canGoBack: boolean
  canGoForward: boolean
  goBack: () => void
  goForward: () => void
  goToIndex: (index: number) => void
  savePageState: (stateKey: string, state: any) => void
  getPageState: <T = any>(stateKey: string) => T | undefined
  saveCurrentScroll: () => void
  restoreScrollForPath: (pathWithQuery: string) => void
}

const NavigationStackContext = createContext<NavigationStackContextType | null>(null)

function getTitleForPath(pathname: string, search: string): string {
  if (pathname === '/') return 'Home'
  if (pathname === '/feed') return 'Feed'
  if (pathname === '/explore') {
    const params = new URLSearchParams(search)
    const folderId = params.get('folder_id')
    return folderId ? `Folder #${folderId}` : 'Explore'
  }
  if (pathname === '/folders') return 'Library'
  if (pathname.startsWith('/folders/')) {
    const id = pathname.replace('/folders/', '')
    return `Folder #${id}`
  }
  if (pathname === '/favorites') return 'Saved'
  if (pathname === '/search') {
    return 'Search'
  }
  if (pathname === '/settings') return 'Settings'
  if (pathname.startsWith('/watch/') || pathname.startsWith('/media/')) {
    const id = pathname.split('/').pop()
    return `Media #${id}`
  }
  return pathname
}

function getScrollPosition(): { x: number; y: number } {
  const pageContent = document.querySelector('.page-content')
  if (pageContent) {
    return {
      x: pageContent.scrollLeft,
      y: pageContent.scrollTop,
    }
  }
  return {
    x: window.scrollX || document.documentElement.scrollLeft,
    y: window.scrollY || document.documentElement.scrollTop,
  }
}

function applyScrollPosition(x: number, y: number) {
  const pageContent = document.querySelector('.page-content')
  if (pageContent) {
    pageContent.scrollTo({ left: x, top: y, behavior: 'instant' })
  }
  window.scrollTo({ left: x, top: y, behavior: 'instant' })
}

export function NavigationStackProvider({ children }: { children: React.ReactNode }) {
  const location = useLocation()
  const navigate = useNavigate()

  const fullUrl = `${location.pathname}${location.search}${location.hash}`
  const initialEntry: StackEntry = {
    id: `entry-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    path: location.pathname,
    search: location.search,
    hash: location.hash,
    fullUrl,
    title: getTitleForPath(location.pathname, location.search),
    scrollX: 0,
    scrollY: 0,
    timestamp: Date.now(),
  }

  const [stack, setStack] = useState<StackEntry[]>([initialEntry])
  const [currentIndex, setCurrentIndex] = useState(0)

  // Internal refs to avoid stale closures in event handlers
  const stackRef = useRef<StackEntry[]>([initialEntry])
  const indexRef = useRef(0)
  const isNavigatingInternalRef = useRef(false)
  const pageStateStoreRef = useRef<Map<string, any>>(new Map())

  stackRef.current = stack
  indexRef.current = currentIndex

  // Save current scroll position to active entry
  const saveCurrentScroll = useCallback(() => {
    const { x, y } = getScrollPosition()
    const idx = indexRef.current
    if (stackRef.current[idx]) {
      stackRef.current[idx].scrollX = x
      stackRef.current[idx].scrollY = y
    }
  }, [])

  // Restore scroll for a specific URL with multi-pass attempt for async rendering
  const restoreScrollForPath = useCallback((pathWithQuery: string) => {
    const entry = stackRef.current.find((item) => item.fullUrl === pathWithQuery)
    const targetY = entry ? entry.scrollY : 0
    const targetX = entry ? entry.scrollX : 0

    // Immediate attempt
    applyScrollPosition(targetX, targetY)

    // Delayed passes in case content is rendering asynchronously
    const timeouts = [20, 80, 200, 450]
    timeouts.forEach((delay) => {
      setTimeout(() => {
        applyScrollPosition(targetX, targetY)
      }, delay)
    })
  }, [])

  // Sync with React Router location changes
  useEffect(() => {
    const curFullUrl = `${location.pathname}${location.search}${location.hash}`
    const currentEntry = stackRef.current[indexRef.current]

    // If this navigation was triggered by our internal goBack/goForward/goToIndex
    if (isNavigatingInternalRef.current) {
      isNavigatingInternalRef.current = false
      restoreScrollForPath(curFullUrl)
      return
    }

    // If the location matches current entry (e.g. initial mount or replace), update title
    if (currentEntry && currentEntry.fullUrl === curFullUrl) {
      return
    }

    // Save scroll on departing entry
    saveCurrentScroll()

    // Check if user navigated backward or forward via browser history / popstate
    const prevIdx = indexRef.current - 1
    const nextIdx = indexRef.current + 1

    if (prevIdx >= 0 && stackRef.current[prevIdx]?.fullUrl === curFullUrl) {
      // User went back
      setCurrentIndex(prevIdx)
      indexRef.current = prevIdx
      restoreScrollForPath(curFullUrl)
      return
    }

    if (nextIdx < stackRef.current.length && stackRef.current[nextIdx]?.fullUrl === curFullUrl) {
      // User went forward
      setCurrentIndex(nextIdx)
      indexRef.current = nextIdx
      restoreScrollForPath(curFullUrl)
      return
    }

    // New navigation: Push to stack and trim any forward history
    const newEntry: StackEntry = {
      id: `entry-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      path: location.pathname,
      search: location.search,
      hash: location.hash,
      fullUrl: curFullUrl,
      title: getTitleForPath(location.pathname, location.search),
      scrollX: 0,
      scrollY: 0,
      timestamp: Date.now(),
    }

    const nextStack = [...stackRef.current.slice(0, indexRef.current + 1), newEntry]
    const nextIndex = nextStack.length - 1

    stackRef.current = nextStack
    indexRef.current = nextIndex
    setStack(nextStack)
    setCurrentIndex(nextIndex)
  }, [location.pathname, location.search, location.hash, saveCurrentScroll, restoreScrollForPath])

  // Stack navigation functions
  const goBack = useCallback(() => {
    if (indexRef.current <= 0) return

    saveCurrentScroll()
    const targetIndex = indexRef.current - 1
    const targetEntry = stackRef.current[targetIndex]
    if (!targetEntry) return

    isNavigatingInternalRef.current = true
    setCurrentIndex(targetIndex)
    indexRef.current = targetIndex

    navigate(targetEntry.fullUrl)
    restoreScrollForPath(targetEntry.fullUrl)
  }, [navigate, saveCurrentScroll, restoreScrollForPath])

  const goForward = useCallback(() => {
    if (indexRef.current >= stackRef.current.length - 1) return

    saveCurrentScroll()
    const targetIndex = indexRef.current + 1
    const targetEntry = stackRef.current[targetIndex]
    if (!targetEntry) return

    isNavigatingInternalRef.current = true
    setCurrentIndex(targetIndex)
    indexRef.current = targetIndex

    navigate(targetEntry.fullUrl)
    restoreScrollForPath(targetEntry.fullUrl)
  }, [navigate, saveCurrentScroll, restoreScrollForPath])

  const goToIndex = useCallback(
    (targetIndex: number) => {
      if (targetIndex < 0 || targetIndex >= stackRef.current.length || targetIndex === indexRef.current) {
        return
      }

      saveCurrentScroll()
      const targetEntry = stackRef.current[targetIndex]
      if (!targetEntry) return

      isNavigatingInternalRef.current = true
      setCurrentIndex(targetIndex)
      indexRef.current = targetIndex

      navigate(targetEntry.fullUrl)
      restoreScrollForPath(targetEntry.fullUrl)
    },
    [navigate, saveCurrentScroll, restoreScrollForPath]
  )

  // Page state cache
  const savePageState = useCallback((stateKey: string, state: any) => {
    pageStateStoreRef.current.set(stateKey, state)
  }, [])

  const getPageState = useCallback(<T = any,>(stateKey: string): T | undefined => {
    return pageStateStoreRef.current.get(stateKey) as T | undefined
  }, [])

  const currentEntry = stack[currentIndex] || null
  const canGoBack = currentIndex > 0
  const canGoForward = currentIndex < stack.length - 1

  const value: NavigationStackContextType = {
    stack,
    currentIndex,
    currentEntry,
    canGoBack,
    canGoForward,
    goBack,
    goForward,
    goToIndex,
    savePageState,
    getPageState,
    saveCurrentScroll,
    restoreScrollForPath,
  }

  return (
    <NavigationStackContext.Provider value={value}>
      {children}
    </NavigationStackContext.Provider>
  )
}

export function useNavigationStack(): NavigationStackContextType {
  const ctx = useContext(NavigationStackContext)
  if (!ctx) {
    throw new Error('useNavigationStack must be used within a NavigationStackProvider')
  }
  return ctx
}
