import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { AudioPreferenceContext } from './audioPreference'

const MUTED_STORAGE_KEY = 'localfeed:media-muted'
const VOLUME_STORAGE_KEY = 'localfeed:media-volume'

function readInitialMutedPreference(): boolean {
  try {
    const val = localStorage.getItem(MUTED_STORAGE_KEY) ?? sessionStorage.getItem(MUTED_STORAGE_KEY)
    return val === 'true'
  } catch {
    return false
  }
}

function readInitialVolumePreference(): number {
  try {
    const val = localStorage.getItem(VOLUME_STORAGE_KEY)
    if (val !== null) {
      const parsed = Number(val)
      if (!isNaN(parsed) && parsed >= 0 && parsed <= 100) return parsed
    }
    return 100
  } catch {
    return 100
  }
}

export function AudioPreferenceProvider({ children }: { children: ReactNode }) {
  const [muted, setMutedState] = useState(readInitialMutedPreference)
  const [volume, setVolumeState] = useState(readInitialVolumePreference)

  const setMuted = (newMuted: boolean) => {
    setMutedState(newMuted)
    try {
      localStorage.setItem(MUTED_STORAGE_KEY, String(newMuted))
      sessionStorage.setItem(MUTED_STORAGE_KEY, String(newMuted))
    } catch {}
  }

  const setVolume = (newVol: number) => {
    const clamped = Math.max(0, Math.min(100, newVol))
    setVolumeState(clamped)
    try {
      localStorage.setItem(VOLUME_STORAGE_KEY, String(clamped))
    } catch {}
  }

  const toggleMuted = () => {
    setMuted(!muted)
  }

  const value = useMemo(
    () => ({
      muted,
      setMuted,
      toggleMuted,
      volume,
      setVolume,
    }),
    [muted, volume],
  )

  return <AudioPreferenceContext.Provider value={value}>{children}</AudioPreferenceContext.Provider>
}
