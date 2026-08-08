import { useState, useRef, useEffect, memo } from 'react'
import { useNavigationStack } from '../hooks/useNavigationStack'

export const TopNav = memo(function TopNav() {
  const {
    stack,
    currentIndex,
    currentEntry,
    canGoBack,
    canGoForward,
    goBack,
    goForward,
    goToIndex,
  } = useNavigationStack()

  const [isHistoryOpen, setIsHistoryOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  // Close history menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsHistoryOpen(false)
      }
    }
    if (isHistoryOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isHistoryOpen])

  const title = currentEntry?.title || 'LocalFeed'

  return (
    <header className="top-nav-bar" role="banner">
      {/* ── Left Controls: Back / Forward / History Stack Buttons ──────────── */}
      <div className="top-nav-controls" ref={menuRef}>
        {/* Visible Back Button */}
        <button
          type="button"
          className={`nav-action-btn${canGoBack ? ' active' : ' disabled'}`}
          onClick={goBack}
          disabled={!canGoBack}
          title={canGoBack ? 'Go Back (Alt+←, Backspace, or 2-finger swipe)' : 'No back history'}
          aria-label="Go Back"
        >
          <svg className="nav-btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="19" y1="12" x2="5" y2="12" />
            <polyline points="12 19 5 12 12 5" />
          </svg>
          <span className="nav-btn-label">Back</span>
        </button>

        {/* Forward Button */}
        <button
          type="button"
          className={`nav-action-btn forward-btn${canGoForward ? ' active' : ' disabled'}`}
          onClick={goForward}
          disabled={!canGoForward}
          title={canGoForward ? 'Go Forward (Alt+→)' : 'No forward history'}
          aria-label="Go Forward"
        >
          <svg className="nav-btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="5" y1="12" x2="19" y2="12" />
            <polyline points="12 5 19 12 12 19" />
          </svg>
        </button>

        {/* Stack History Quick Menu Trigger */}
        {stack.length > 1 && (
          <button
            type="button"
            className={`nav-history-trigger${isHistoryOpen ? ' open' : ''}`}
            onClick={() => setIsHistoryOpen((prev) => !prev)}
            title="View Navigation Stack History"
            aria-label="Navigation Stack History"
          >
            <span className="history-count-badge">{currentIndex + 1}/{stack.length}</span>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
        )}

        {/* History Dropdown Menu */}
        {isHistoryOpen && (
          <div className="top-nav-history-menu" role="menu">
            <div className="history-menu-header">
              <span className="history-menu-title">Navigation Stack</span>
              <span className="history-menu-subtitle">{stack.length} views</span>
            </div>
            <div className="history-menu-list">
              {stack.map((entry, idx) => {
                const isCurrent = idx === currentIndex
                const isPast = idx < currentIndex
                return (
                  <button
                    key={entry.id}
                    type="button"
                    className={`history-menu-item${isCurrent ? ' current' : isPast ? ' past' : ' future'}`}
                    onClick={() => {
                      goToIndex(idx)
                      setIsHistoryOpen(false)
                    }}
                    role="menuitem"
                  >
                    <span className="history-item-dot" />
                    <div className="history-item-content">
                      <span className="history-item-title">{entry.title}</span>
                      <span className="history-item-path">{entry.path}{entry.search}</span>
                    </div>
                    {isCurrent && <span className="history-current-pill">Current</span>}
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {/* ── Center: Current View Title & Status ──────────────────────────── */}
      <div className="top-nav-center">
        <span className="top-nav-title">{title}</span>
      </div>

      {/* ── Right: Gesture & Shortcut Hint Pill ─────────────────────────── */}
      <div className="top-nav-right">
        <div className="nav-shortcut-hint" title="Two-finger swipe right on trackpad or press Alt+Left to go back">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          <span>Swipe or Alt+←</span>
        </div>
      </div>
    </header>
  )
})
