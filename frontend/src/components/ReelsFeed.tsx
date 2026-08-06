import { useEffect } from 'react'
import { useInfiniteFeed } from '../hooks/useInfiniteFeed'
import { MediaCard } from './MediaCard'

/**
 * ReelsFeed — full-screen vertical scroll-snap feed.
 * Mixes videos and images in random order.
 * Auto-loads more when user nears the end.
 */
export function ReelsFeed() {
  const { items, loading, error, fetchBatch, onCardVisible } = useInfiniteFeed()

  // Initial load
  useEffect(() => {
    if (items.length === 0) {
      fetchBatch()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  if (items.length === 0 && loading) {
    return (
      <div
        style={{
          height: '100dvh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'column',
          gap: 16,
        }}
      >
        <div className="skeleton" style={{ width: 48, height: 48, borderRadius: '50%' }} />
        <div className="text-muted t-label">Loading feed…</div>
      </div>
    )
  }

  if (items.length === 0 && error) {
    return (
      <div className="empty-state">
        <svg className="empty-state-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
          <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
        <div className="empty-state-title">Could not load feed</div>
        <div className="empty-state-body">{error}</div>
        <button className="btn-primary" onClick={fetchBatch}>Retry</button>
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <div className="empty-state">
        <svg className="empty-state-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
        </svg>
        <div className="empty-state-title">No media found</div>
        <div className="empty-state-body">
          Configure your media roots in <code style={{ color: 'var(--c-amber)' }}>.env</code> and trigger a scan.
        </div>
      </div>
    )
  }

  return (
    <div className="reels-container">
      {items.map((item, index) => (
        <MediaCard
          key={`${item.id}-${index}`}
          item={item}
          index={index}
          isActive={true}
          onCardVisible={onCardVisible}
        />
      ))}
      {/* Loading sentinel */}
      {loading && (
        <div className="reel-card" style={{ background: 'var(--c-deep)' }}>
          <div className="text-muted t-label">Loading more…</div>
        </div>
      )}
    </div>
  )
}
