import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { listFolders } from '../api/folders'
import { thumbnailUrl } from '../api/media'
import type { Folder } from '../api/types'
import { useScanStatus } from '../hooks/useScanStatus'
import { useNavigationStack } from '../hooks/useNavigationStack'

const PAGE_SIZE = 50

interface FoldersStateCache {
  folders: Folder[]
  total: number
  page: number
  hasMore: boolean
}

export function FoldersPage() {
  const navigate = useNavigate()
  const { getPageState, savePageState } = useNavigationStack()
  const cached = getPageState<FoldersStateCache>('folders-page-state')

  const [folders, setFolders] = useState<Folder[]>(cached?.folders || [])
  const [total, setTotal] = useState(cached?.total || 0)
  const [loading, setLoading] = useState(false)
  const [page, setPage] = useState(cached?.page || 1)
  const [hasMore, setHasMore] = useState(cached?.hasMore ?? true)

  const isInitialMountRef = useRef(true)

  const syncCache = useCallback(
    (newFolders: Folder[], newTotal: number, newPage: number, newHasMore: boolean) => {
      savePageState('folders-page-state', {
        folders: newFolders,
        total: newTotal,
        page: newPage,
        hasMore: newHasMore,
      })
    },
    [savePageState]
  )

  const loadFolders = async (pageNum: number, reset = false) => {
    setLoading(true)
    try {
      const res = await listFolders({ page: pageNum, page_size: PAGE_SIZE })
      const nextTotal = res.total
      const nextHasMore = pageNum < res.pages
      setTotal(nextTotal)
      setHasMore(nextHasMore)
      if (reset) {
        setFolders(res.items)
        syncCache(res.items, nextTotal, pageNum, nextHasMore)
      } else {
        setFolders((prev) => {
          const merged = [...prev, ...res.items]
          syncCache(merged, nextTotal, pageNum, nextHasMore)
          return merged
        })
      }
    } catch (e) {
      console.error('Failed to load folders:', e)
    } finally {
      setLoading(false)
    }
  }

  // Reload folders on completion and periodically refresh while scanning
  const { status, triggerScan } = useScanStatus(
    () => {
      loadFolders(1, true)
    },
    (s) => {
      if (s.running && s.files_scanned > 0) {
        loadFolders(1, true)
      }
    }
  )

  useEffect(() => {
    if (isInitialMountRef.current && cached && cached.folders.length > 0) {
      isInitialMountRef.current = false
      return
    }
    isInitialMountRef.current = false
    loadFolders(1, true)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const isScanning = Boolean(status?.running)
  const isDiscovering = isScanning && status?.files_total === 0

  return (
    <div className="page-enter">
      <div className="section-header">
        <h1 className="section-title">Your Library</h1>
        <span className="section-count">{total} folders</span>
      </div>

      {/* Scan trigger */}
      <div style={{ padding: '0 16px 16px', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <button
          className="btn-secondary"
          onClick={triggerScan}
          disabled={isScanning}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className={isScanning ? 'spin' : ''}>
            <path d="M23 4v6h-6"/><path d="M1 20v-6h6"/>
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
          </svg>
          {isScanning ? (isDiscovering ? 'Discovering files…' : 'Scanning…') : 'Rescan Library'}
        </button>
        {isScanning && !isDiscovering && status && (
          <span className="text-muted t-label">
            {status.files_scanned.toLocaleString()} / {status.files_total.toLocaleString()} files
          </span>
        )}
      </div>

      {/* Active scanning state with skeletons if no folders yet */}
      {isScanning && folders.length === 0 ? (
        <div style={{ padding: '16px' }}>
          <div className="empty-state" style={{ marginBottom: 20 }}>
            <svg className="empty-state-icon spin" viewBox="0 0 24 24" fill="none" stroke="var(--c-accent)" strokeWidth="1.5">
              <path d="M23 4v6h-6"/><path d="M1 20v-6h6"/>
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
            </svg>
            <div className="empty-state-title">
              {isDiscovering ? 'Discovering media files…' : 'Indexing your folders…'}
            </div>
            <div className="empty-state-body">
              {isDiscovering
                ? 'Walking configured sources and analyzing directory tree.'
                : `Indexed ${status?.files_scanned.toLocaleString()} of ${status?.files_total.toLocaleString()} files. Folders will appear automatically.`}
            </div>
          </div>
          <div className="folders-grid">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} style={{ borderRadius: 8, overflow: 'hidden', border: '1px solid var(--c-border)' }}>
                <div className="skeleton" style={{ aspectRatio: '16/9' }} />
                <div style={{ padding: '8px 12px' }}>
                  <div className="skeleton" style={{ height: 14, borderRadius: 4, marginBottom: 6 }} />
                  <div className="skeleton" style={{ height: 10, width: '50%', borderRadius: 4 }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : loading && folders.length === 0 ? (
        <div className="folders-grid">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} style={{ borderRadius: 8, overflow: 'hidden', border: '1px solid var(--c-border)' }}>
              <div className="skeleton" style={{ aspectRatio: '16/9' }} />
              <div style={{ padding: '8px 12px' }}>
                <div className="skeleton" style={{ height: 14, borderRadius: 4, marginBottom: 6 }} />
                <div className="skeleton" style={{ height: 10, width: '50%', borderRadius: 4 }} />
              </div>
            </div>
          ))}
        </div>
      ) : folders.length === 0 ? (
        <div className="empty-state">
          <svg className="empty-state-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
          </svg>
          <div className="empty-state-title">No folders found</div>
          <div className="empty-state-body">
            Configure your media sources in Settings and trigger a scan above.
          </div>
          <button className="btn-primary" style={{ marginTop: 12 }} onClick={() => navigate('/settings')}>
            Go to Settings
          </button>
        </div>
      ) : (
        <>
          <div className="folders-grid">
            {folders.map((folder) => (
              <div
                key={folder.id}
                className="folder-card"
                onClick={() => navigate(`/folders/${folder.id}`)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === 'Enter' && navigate(`/folders/${folder.id}`)}
              >
                <div className="folder-card-thumb">
                  {folder.cover_thumbnail_path ? (
                    <img src={thumbnailUrl(folder.id)} alt="" />
                  ) : (
                    <div className="folder-card-thumb-placeholder">
                      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
                        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                      </svg>
                    </div>
                  )}
                </div>
                <div className="folder-card-info">
                  <div className="folder-card-name">
                    {folder.display_name || folder.name}
                  </div>
                  <div className="folder-card-count">
                    {folder.item_count.toLocaleString()} items
                  </div>
                </div>
              </div>
            ))}
          </div>

          {hasMore && (
            <div style={{ padding: 16, textAlign: 'center' }}>
              <button
                className="btn-secondary"
                onClick={() => {
                  const next = page + 1
                  setPage(next)
                  loadFolders(next)
                }}
                disabled={loading}
              >
                {loading ? 'Loading…' : 'Load more'}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
