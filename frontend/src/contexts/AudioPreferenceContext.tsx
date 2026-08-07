import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'

const SESSION_KEY = 'localfeed:media-muted'

interface AudioPreferenceContextValue {
  muted: boolean
  setMuted: (muted: boolean) => void
  toggleMuted: () => void
}

const AudioPreferenceContext = createContext<AudioPreferenceContextValue | null>(null)

function readInitialMutedPreference(): boolean {
  try {
    return sessionStorage.getItem(SESSION_KEY) !== 'false'
  } catch {
    return true
  }
}

export function AudioPreferenceProvider({ children }: { children: ReactNode }) {
  const [muted, setMuted] = useState(readInitialMutedPreference)

  useEffect(() => {
    try {
      sessionStorage.setItem(SESSION_KEY, String(muted))
    } catch {
      // Private browsing or restricted storage should not prevent playback.
    }
  }, [muted])

  const value = useMemo(
    () => ({
      muted,
      setMuted,
      toggleMuted: () => setMuted((current) => !current),
    }),
    [muted],
  )

  return <AudioPreferenceContext.Provider value={value}>{children}</AudioPreferenceContext.Provider>
}

export function useAudioPreference(): AudioPreferenceContextValue {
  const context = useContext(AudioPreferenceContext)
  if (!context) {
    throw new Error('useAudioPreference must be used within AudioPreferenceProvider')
  }
  return context
}
