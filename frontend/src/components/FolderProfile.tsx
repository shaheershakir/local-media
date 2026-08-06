import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { getFolder } from '../api/folders'
import { thumbnailUrl } from '../api/media'
import { GridFeed } from './GridFeed'
import type { FolderDetail } from '../api/folders'

export function FolderProfile() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [detail, setDetail] = useState<FolderDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!id) return
    setLoading(true)
    getFolder(Number(id))
      .then(setDetail)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [id])

  if (loading) {
    return (
      <div className="folder-profile">
        <div className="folder-hero">
          <div className="skeleton" style={{ width: '100%', height: '100%' }} />
        </div>
      </div>
    )
  }

  if (error || !detail) {
    return (
      <div className="empty-state">
        <div className="empty-state-title">Folder not found</div>
        <button className="btn-secondary" onClick={() => navigate(-1)}>Go back</button>
      </div>
    )
  }

  const { folder, subfolders, media } = detail
  const displayName = folder.display_name || folder.name

  return (
    <div className="folder-profile page-enter">
      {/* Hero header */}
      <div className="folder-hero">
        {folder.cover_thumbnail_path && (
          <img
            className="folder-hero-bg"
            src={thumbnailUrl(folder.id)}
            alt=""
            aria-hidden
          />
        )}
        <div className="folder-hero-gradient" />

        {/* Back button */}
        <button
          onClick={() => navigate(-1)}
          style={{
            position: 'absolute',
            top: 16,
            left: 16,
            width: 36,
            height: 36,
            borderRadius: '50%',
            background: 'rgba(8,8,9,0.6)',
            backdropFilter: 'blur(8px)',
            border: '1px solid var(--c-border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--c-text)',
            zIndex: 10,
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
        </button>

        <div className="folder-hero-info">
          <div className="folder-name">{displayName}</div>
          <div className="folder-meta">
            <span>{media.total.toLocaleString()} items</span>
            {subfolders.length > 0 && (
              <>
                <div className="folder-meta-dot" />
                <span>{subfolders.length} subfolders</span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Subfolders */}
      {subfolders.length > 0 && (
        <>
          <div className="section-header" style={{ paddingBottom: 4 }}>
            <div className="t-label text-muted">Subfolders</div>
          </div>
          <div className="subfolders-row">
            {subfolders.map((sf) => (
              <button
                key={sf.id}
                className="subfolder-chip"
                onClick={() => navigate(`/folders/${sf.id}`)}
              >
                {sf.display_name || sf.name}
                <span style={{ color: 'var(--c-muted)', marginLeft: 6, fontSize: 9 }}>
                  {sf.item_count}
                </span>
              </button>
            ))}
          </div>
          <div className="divider" />
        </>
      )}

      {/* Media grid */}
      <GridFeed folderId={Number(id)} />
    </div>
  )
}
