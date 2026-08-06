import { useContext } from 'react'
import { AudioPreferenceContext } from '../contexts/audioPreference'
import type { AudioPreferenceContextValue } from '../contexts/audioPreference'

export function useAudioPreference(): AudioPreferenceContextValue {
  const context = useContext(AudioPreferenceContext)
  if (!context) {
    throw new Error('useAudioPreference must be used within AudioPreferenceProvider')
  }
  return context
}
