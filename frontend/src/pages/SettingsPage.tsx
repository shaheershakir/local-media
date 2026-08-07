import { useState, useEffect, useCallback } from 'react'
import { getSources, addSource, removeSource, type Source } from '../api/sources'
import { startScan } from '../api/scan'

export function SettingsPage() {
  const [sources, setSources] = useState<Source[]>([])
  const [newPath, setNewPath] = useState('')
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [removingPath, setRemovingPath] = useState<string | null>(null)
  const [scanningPath, setScanningPath] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const fetchSources = useCallback(async () => {
    try {
      setLoading(true)
      const data = await getSources()
      setSources(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load sources')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchSources()
  }, [fetchSources])

  // Auto-dismiss success/error messages
  useEffect(() => {
    if (success) {
      const t = setTimeout(() => setSuccess(null), 3000)
      return () => clearTimeout(t)
    }
  }, [success])

  useEffect(() => {
    if (error) {
      const t = setTimeout(() => setError(null), 5000)
      return () => clearTimeout(t)
    }
  }, [error])

  const handleAdd = async () => {
    const trimmed = newPath.trim()
    if (!trimmed) return
    try {
      setAdding(true)
      setError(null)
      await addSource(trimmed)
      setNewPath('')
      setSuccess('Source added successfully')
      await fetchSources()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to add source')
    } finally {
      setAdding(false)
    }
  }

  const handleRemove = async (path: string) => {
    try {
      setRemovingPath(path)
      setError(null)
      await removeSource(path)
      setSuccess('Source removed')
      await fetchSources()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to remove source')
    } finally {
      setRemovingPath(null)
    }
  }

  const handleScan = async (path: string) => {
    try {
      setScanningPath(path)
      setError(null)
      await startScan()
      setSuccess('Scan started')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to start scan')
    } finally {
      setScanningPath(null)
    }
  }

  const handleBrowse = async () => {
    // Electron exposes a dialog API via the preload bridge
    if (window.localfeed?.selectFolder) {
      try {
        const dir = await window.localfeed.selectFolder()
        if (dir) setNewPath(dir)
      } catch {
        setError('Failed to open folder picker')
      }
    } else {
      // Fallback: hint the user to paste manually
      setError('Folder picker is only available in the desktop app. Please paste the path manually.')
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !adding) {
      handleAdd()
    }
  }

  return (
    <div className="page-enter settings-page">
      <div className="section-header">
        <h1 className="section-title">Settings</h1>
      </div>

      {/* Toast messages */}
      {success && (
        <div className="settings-toast settings-toast--success">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          {success}
        </div>
      )}
      {error && (
        <div className="settings-toast settings-toast--error">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <line x1="15" y1="9" x2="9" y2="15" />
            <line x1="9" y1="9" x2="15" y2="15" />
          </svg>
          {error}
        </div>
      )}

      {/* Media Sources Section */}
      <div className="settings-section">
        <div className="settings-section-header">
          <div className="settings-section-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
            </svg>
          </div>
          <div>
            <h2 className="settings-section-title">Media Sources</h2>
            <p className="settings-section-desc">Directories scanned for photos and videos</p>
          </div>
        </div>

        {/* Add Source Input */}
        <div className="source-add-row">
          <div className="source-input-wrapper">
            <input
              id="source-path-input"
              type="text"
              className="source-input"
              placeholder="Paste folder path, e.g. D:\Media\Videos"
              value={newPath}
              onChange={(e) => setNewPath(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={adding}
            />
            <button
              id="browse-btn"
              className="source-browse-btn"
              onClick={handleBrowse}
              title="Browse for folder"
              disabled={adding}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                <line x1="12" y1="11" x2="12" y2="17" />
                <polyline points="9 14 12 11 15 14" />
              </svg>
            </button>
          </div>
          <button
            id="add-source-btn"
            className="btn-primary source-add-btn"
            onClick={handleAdd}
            disabled={adding || !newPath.trim()}
          >
            {adding ? (
              <span className="source-spinner" />
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            )}
            Add
          </button>
        </div>

        {/* Source List */}
        <div className="source-list">
          {loading ? (
            <div className="source-empty">
              <span className="source-spinner" />
              Loading sources…
            </div>
          ) : sources.length === 0 ? (
            <div className="source-empty">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--c-muted)" strokeWidth="1">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
              </svg>
              <span>No sources configured yet</span>
              <span className="source-empty-hint">Add a folder path above to get started</span>
            </div>
          ) : (
            sources.map((source) => (
              <div
                key={source.path}
                className={`source-item${removingPath === source.path ? ' source-item--removing' : ''}`}
              >
                <div className="source-item-info">
                  <div className="source-item-path">{source.path}</div>
                  {!source.exists && (
                    <span className="source-item-warning">Path not found</span>
                  )}
                </div>
                <div className="source-item-actions">
                  <button
                    className="source-action-btn source-scan-btn"
                    onClick={() => handleScan(source.path)}
                    disabled={scanningPath === source.path}
                    title="Rescan this source"
                  >
                    <svg
                      width="15"
                      height="15"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      className={scanningPath === source.path ? 'spin' : ''}
                    >
                      <polyline points="23 4 23 10 17 10" />
                      <polyline points="1 20 1 14 7 14" />
                      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                    </svg>
                  </button>
                  <button
                    className="source-action-btn source-delete-btn"
                    onClick={() => handleRemove(source.path)}
                    disabled={removingPath === source.path}
                    title="Remove this source"
                  >
                    {removingPath === source.path ? (
                      <span className="source-spinner source-spinner--sm" />
                    ) : (
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                      </svg>
                    )}
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* App Info */}
      <div className="settings-footer">
        <span className="settings-footer-text">LocalFeed v1.0</span>
      </div>
    </div>
  )
}
