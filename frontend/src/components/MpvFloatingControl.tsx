import { useMpv } from '../hooks/useMpv'

function formatSeconds(seconds: number): string {
  if (!seconds || isNaN(seconds) || seconds < 0) return '0:00'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

export function MpvFloatingControl() {
  const { mpvState, togglePause, stop, seek, goToPosition } = useMpv()

  if (!mpvState.running) return null

  const progress = mpvState.duration > 0 ? (mpvState.currentTime / mpvState.duration) * 100 : 0

  const handleSeekChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const pct = parseFloat(e.target.value)
    if (mpvState.duration > 0) {
      const targetTime = (pct / 100) * mpvState.duration
      goToPosition(targetTime)
    }
  }

  return (
    <aside className="mpv-floating-hud" role="region" aria-label="MPV Playback Controller">
      <div className="mpv-hud-header">
        <div className="mpv-hud-badge">
          <span className="mpv-hud-dot" />
          MPV CINEMA
        </div>
        <button
          className="mpv-hud-btn-close"
          type="button"
          onClick={stop}
          aria-label="Stop playback"
          title="Stop & Close MPV"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="mpv-hud-body">
        <div className="mpv-hud-title" title={mpvState.title || 'Video'}>
          {mpvState.title || 'Playing video…'}
        </div>
        <div className="mpv-hud-time">
          <span>{formatSeconds(mpvState.currentTime)}</span>
          <span className="mpv-hud-time-divider">/</span>
          <span>{formatSeconds(mpvState.duration)}</span>
        </div>
      </div>

      {/* Scrub bar */}
      <div className="mpv-hud-progress-wrapper">
        <input
          type="range"
          min="0"
          max="100"
          step="0.1"
          value={isNaN(progress) ? 0 : progress}
          onChange={handleSeekChange}
          className="mpv-hud-scrubber"
          aria-label="Seek video position"
        />
        <div className="mpv-hud-progress-fill" style={{ width: `${progress}%` }} />
      </div>

      {/* Control Buttons */}
      <div className="mpv-hud-controls">
        <button
          className="mpv-hud-action-btn"
          type="button"
          onClick={() => seek(-10)}
          title="Rewind 10 seconds"
          aria-label="Rewind 10 seconds"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M11 17l-5-5 5-5M18 17l-5-5 5-5" />
          </svg>
          <span className="mpv-btn-sub">10s</span>
        </button>

        <button
          className={`mpv-hud-action-btn mpv-btn-play${!mpvState.paused ? ' active' : ''}`}
          type="button"
          onClick={togglePause}
          title={mpvState.paused ? 'Resume' : 'Pause'}
          aria-label={mpvState.paused ? 'Resume video' : 'Pause video'}
        >
          {mpvState.paused ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <polygon points="6 4 20 12 6 20 6 4" />
            </svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <rect x="6" y="4" width="4" height="16" rx="1" />
              <rect x="14" y="4" width="4" height="16" rx="1" />
            </svg>
          )}
        </button>

        <button
          className="mpv-hud-action-btn"
          type="button"
          onClick={() => seek(10)}
          title="Forward 10 seconds"
          aria-label="Forward 10 seconds"
        >
          <span className="mpv-btn-sub">10s</span>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M13 17l5-5-5-5M6 17l5-5-5-5" />
          </svg>
        </button>

        <button
          className="mpv-hud-action-btn"
          type="button"
          onClick={stop}
          title="Stop playback"
          aria-label="Stop playback"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <rect x="5" y="5" width="14" height="14" rx="2" />
          </svg>
        </button>
      </div>
    </aside>
  )
}
