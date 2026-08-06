import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { AudioPreferenceContext } from './audioPreference'

const SESSION_KEY = 'localfeed:media-muted'

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
