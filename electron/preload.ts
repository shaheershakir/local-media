import { contextBridge, ipcRenderer } from 'electron'

const apiBaseUrl = process.argv.find((argument) => argument.startsWith('--localfeed-api='))?.slice('--localfeed-api='.length)

contextBridge.exposeInMainWorld('localfeed', {
  apiBaseUrl: apiBaseUrl ?? 'http://127.0.0.1:8000/api',
  platform: process.platform,
  selectFiles: (): Promise<string[]> => ipcRenderer.invoke('dialog:select-files'),
  selectFolder: (): Promise<string | undefined> => ipcRenderer.invoke('dialog:select-folder'),
  notify: (title: string, body: string): Promise<void> => ipcRenderer.invoke('notification:show', { title, body }),
  revealPath: (path: string): Promise<void> => ipcRenderer.invoke('shell:reveal-path', path),

  mpv: {
    isAvailable: (): Promise<boolean> => ipcRenderer.invoke('mpv:is-available'),
    getStatus: (): Promise<any> => ipcRenderer.invoke('mpv:get-status'),
    play: (filePath: string, meta?: any): Promise<{ success: boolean; message?: string }> =>
      ipcRenderer.invoke('mpv:play', { filePath, meta }),
    pause: (): Promise<boolean> => ipcRenderer.invoke('mpv:pause'),
    resume: (): Promise<boolean> => ipcRenderer.invoke('mpv:resume'),
    togglePause: (): Promise<boolean> => ipcRenderer.invoke('mpv:toggle-pause'),
    stop: (): Promise<boolean> => ipcRenderer.invoke('mpv:stop'),
    seek: (seconds: number): Promise<boolean> => ipcRenderer.invoke('mpv:seek', seconds),
    goToPosition: (seconds: number, exact = true): Promise<boolean> =>
      ipcRenderer.invoke('mpv:go-to-position', { seconds, exact }),
    setVolume: (volume: number): Promise<boolean> => ipcRenderer.invoke('mpv:set-volume', volume),
    toggleMute: (): Promise<boolean> => ipcRenderer.invoke('mpv:toggle-mute'),
    onStatus: (callback: (status: any) => void): (() => void) => {
      const listener = (_event: any, status: any) => callback(status)
      ipcRenderer.on('mpv:status', listener)
      return () => ipcRenderer.removeListener('mpv:status', listener)
    },
    onTimePosition: (callback: (timeData: { currentTime: number }) => void): (() => void) => {
      const listener = (_event: any, data: any) => callback(data)
      ipcRenderer.on('mpv:timeposition', listener)
      return () => ipcRenderer.removeListener('mpv:timeposition', listener)
    },
  },
})

