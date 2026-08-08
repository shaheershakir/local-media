import { useScanStatus } from '../hooks/useScanStatus'

export function ScanProgress() {
  const { status } = useScanStatus()

  if (!status || !status.running) return null

  const isDiscovering = status.files_total === 0
  const percent =
    status.files_total > 0
      ? Math.round((status.files_scanned / status.files_total) * 100)
      : 0

  const formatEta = (secs: number | null): string => {
    if (!secs) return ''
    if (secs < 60) return `~${secs}s remaining`
    return `~${Math.round(secs / 60)}m remaining`
  }

  return (
    <div className="scan-banner">
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="var(--c-amber)"
        strokeWidth="2"
        className="spin"
        style={{ flexShrink: 0 }}
      >
        <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
      </svg>
      <div style={{ flex: 1 }}>
        <div className="scan-progress-bar-track">
          <div
            className={`scan-progress-bar-fill ${isDiscovering ? 'scan-progress-bar-fill--indeterminate' : ''}`}
            style={{ width: isDiscovering ? '100%' : `${percent}%` }}
          />
        </div>
      </div>
      <div className="scan-stats">
        {isDiscovering ? (
          <span>Discovering files…</span>
        ) : (
          <>
            {status.files_scanned.toLocaleString()} / {status.files_total.toLocaleString()} files
            {' · '}{percent}%
            {status.estimated_seconds_remaining != null && (
              <> · {formatEta(status.estimated_seconds_remaining)}</>
            )}
          </>
        )}
        {status.errors > 0 && (
          <span style={{ color: '#e05050', marginLeft: 8 }}>{status.errors} errors</span>
        )}
      </div>
    </div>
  )
}

