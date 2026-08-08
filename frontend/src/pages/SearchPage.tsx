import { useState, useCallback, useEffect } from 'react'
import { GridFeed } from '../components/GridFeed'
import { useNavigationStack } from '../hooks/useNavigationStack'

export function SearchPage() {
  const { getPageState, savePageState } = useNavigationStack()
  const cachedSearch = getPageState<{ query: string; submittedQuery: string }>('search-page-state')

  const [query, setQuery] = useState(cachedSearch?.query || '')
  const [submittedQuery, setSubmittedQuery] = useState(cachedSearch?.submittedQuery || '')

  useEffect(() => {
    savePageState('search-page-state', { query, submittedQuery })
  }, [query, submittedQuery, savePageState])

  const handleSearch = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault()
      const trimmed = query.trim()
      setSubmittedQuery(trimmed)
      savePageState('search-page-state', { query, submittedQuery: trimmed })
    },
    [query, savePageState]
  )

  return (
    <div className="page-enter">
      <div className="section-header">
        <h1 className="section-title">Search</h1>
      </div>

      <form onSubmit={handleSearch}>
        <div className="search-bar">
          <svg className="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            id="search-input"
            type="search"
            className="search-input"
            placeholder="Search titles, folders, filenames…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus={!submittedQuery}
          />
        </div>
      </form>

      {submittedQuery ? (
        <>
          <div className="section-header" style={{ paddingTop: 8 }}>
            <span className="t-label text-muted">Results for</span>
            <span style={{ fontFamily: 'var(--font-display)', fontSize: 16, color: 'var(--c-amber)' }}>
              &ldquo;{submittedQuery}&rdquo;
            </span>
          </div>
          <GridFeed searchQuery={submittedQuery} />
        </>
      ) : (
        <div className="empty-state" style={{ minHeight: '50dvh' }}>
          <svg className="empty-state-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <div className="empty-state-title">What are you looking for?</div>
          <div className="empty-state-body">Search by title, filename, or folder name.</div>
        </div>
      )}
    </div>
  )
}
