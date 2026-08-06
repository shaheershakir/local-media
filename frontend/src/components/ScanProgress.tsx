import { useScanStatus } from '../hooks/useScanStatus'

export function ScanProgress() {
  const { status, triggerScan } = useScanStatus()

  if (!status) return null

  const percent =
    status.files_total > 0
      ? Math.round((status.files_scanned / status.files_total) * 100)
      : 0

  const formatEta = (secs: number | null): string => {
    if (!secs) return ''
    if (secs < 60) return `~${secs}s remaining`
    return `~${Math.round(secs / 60)}m remaining`
  }

  if (!status.running && status.files_total === 0) {
    // No scan has ever run — show a prompt
    return (
      <div
        style={{
          padding: '10px 16px',
          background: 'rgba(200,144,42,0.06)',
          borderBottom: '1px solid rgba(200,144,42,0.15)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
        }}
      >
        <span className="text-muted t-label">Library not scanned yet</span>
        <button className="btn-primary" onClick={triggerScan} style={{ padding: '6px 14px', fontSize: 11 }}>
          Scan now
        </button>
      </div>
    )
  }

  if (!status.running) return null

  return (
    <div className="scan-banner">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--c-amber)" strokeWidth="1.5" style={{ flexShrink: 0 }}>
        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
      </svg>
      <div style={{ flex: 1 }}>
        <div className="scan-progress-bar-track">
          <div
            className="scan-progress-bar-fill"
            style={{ width: `${percent}%` }}
          />
        </div>
      </div>
      <div className="scan-stats">
        {status.files_scanned.toLocaleString()} / {status.files_total.toLocaleString()} files
        {' · '}{percent}%
        {status.estimated_seconds_remaining != null && (
          <> · {formatEta(status.estimated_seconds_remaining)}</>
        )}
        {status.errors > 0 && (
          <span style={{ color: '#e05050', marginLeft: 8 }}>{status.errors} errors</span>
        )}
      </div>
    </div>
  )
}
