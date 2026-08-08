import { useState, useEffect, useCallback } from 'react'
import type { MediaItem } from '../api/types'

export interface MpvState {
  available: boolean
  running: boolean
  activePath?: string
  title?: string
  mediaItemId?: number
  currentTime: number
  duration: number
  paused: boolean
  volume: number
  muted: boolean
  error?: string
}

export function useMpv() {
  const [mpvState, setMpvState] = useState<MpvState>({
    available: Boolean(window.localfeed?.mpv),
    running: false,
    currentTime: 0,
    duration: 0,
    paused: false,
    volume: 100,
    muted: false,
  })

  // Check availability and register status listener
  useEffect(() => {
    const mpv = window.localfeed?.mpv
    if (!mpv) return

    mpv.isAvailable().then((avail) => {
      setMpvState((prev) => ({ ...prev, available: avail }))
    }).catch(() => {})

    mpv.getStatus().then((status) => {
      if (status) setMpvState(status)
    }).catch(() => {})

    const unbindStatus = mpv.onStatus((status) => {
      setMpvState((prev) => ({ ...prev, ...status }))
    })

    const unbindTime = mpv.onTimePosition((data) => {
      setMpvState((prev) => ({ ...prev, currentTime: data.currentTime }))
    })

    return () => {
      unbindStatus()
      unbindTime()
    }
  }, [])

  const play = useCallback(async (item: MediaItem, startTime?: number) => {
    const mpv = window.localfeed?.mpv
    if (!mpv) {
      console.warn('MPV is not available in this environment.')
      return { success: false, message: 'MPV not available' }
    }

    try {
      return await mpv.play(item.path, {
        id: item.id,
        title: item.title || item.filename,
        startTime: startTime ?? (item.duration_watched_seconds > 0 ? item.duration_watched_seconds : 0),
        duration: item.duration_seconds || 0,
      })
    } catch (err) {
      console.error('Failed to launch MPV:', err)
      return { success: false, message: err instanceof Error ? err.message : String(err) }
    }
  }, [])

  const pause = useCallback(async () => {
    await window.localfeed?.mpv?.pause()
  }, [])

  const resume = useCallback(async () => {
    await window.localfeed?.mpv?.resume()
  }, [])

  const togglePause = useCallback(async () => {
    await window.localfeed?.mpv?.togglePause()
  }, [])

  const stop = useCallback(async () => {
    await window.localfeed?.mpv?.stop()
  }, [])

  const seek = useCallback(async (seconds: number) => {
    await window.localfeed?.mpv?.seek(seconds)
  }, [])

  const goToPosition = useCallback(async (seconds: number, exact = true) => {
    await window.localfeed?.mpv?.goToPosition(seconds, exact)
  }, [])

  const setVolume = useCallback(async (volume: number) => {
    await window.localfeed?.mpv?.setVolume(volume)
  }, [])

  const toggleMute = useCallback(async () => {
    await window.localfeed?.mpv?.toggleMute()
  }, [])

  const isPlayingItem = useCallback(
    (itemId: number) => {
      return mpvState.running && mpvState.mediaItemId === itemId
    },
    [mpvState.running, mpvState.mediaItemId]
  )

  return {
    mpvState,
    isAvailable: mpvState.available,
    isPlaying: mpvState.running && !mpvState.paused,
    play,
    pause,
    resume,
    togglePause,
    stop,
    seek,
    goToPosition,
    setVolume,
    toggleMute,
    isPlayingItem,
  }
}
