import { createContext } from 'react'

export interface AudioPreferenceContextValue {
  muted: boolean
  setMuted: (muted: boolean) => void
  toggleMuted: () => void
  volume: number
  setVolume: (volume: number) => void
}

export const AudioPreferenceContext = createContext<AudioPreferenceContextValue | null>(null)
