export {}

export interface MpvStatusData {
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

export interface MpvPlaybackOptions {
  id?: number
  title?: string
  startTime?: number
  volume?: number
}

declare global {
  interface Window {
    localfeed?: {
      apiBaseUrl: string
      platform: string
      selectFiles: () => Promise<string[]>
      selectFolder: () => Promise<string | undefined>
      notify: (title: string, body: string) => Promise<void>
      revealPath: (path: string) => Promise<void>
      mpv?: {
        isAvailable: () => Promise<boolean>
        getStatus: () => Promise<MpvStatusData>
        play: (filePath: string, meta?: MpvPlaybackOptions) => Promise<{ success: boolean; message?: string }>
        pause: () => Promise<boolean>
        resume: () => Promise<boolean>
        togglePause: () => Promise<boolean>
        stop: () => Promise<boolean>
        seek: (seconds: number) => Promise<boolean>
        goToPosition: (seconds: number) => Promise<boolean>
        setVolume: (volume: number) => Promise<boolean>
        toggleMute: () => Promise<boolean>
        onStatus: (callback: (status: MpvStatusData) => void) => () => void
        onTimePosition: (callback: (timeData: { currentTime: number }) => void) => () => void
      }
    }
  }
}

