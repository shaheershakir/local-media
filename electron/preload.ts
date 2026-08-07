import { contextBridge, ipcRenderer } from 'electron'

const apiBaseUrl = process.argv.find((argument) => argument.startsWith('--localfeed-api='))?.slice('--localfeed-api='.length)

contextBridge.exposeInMainWorld('localfeed', {
  apiBaseUrl: apiBaseUrl ?? 'http://127.0.0.1:8000/api',
  platform: process.platform,
  selectFiles: (): Promise<string[]> => ipcRenderer.invoke('dialog:select-files'),
  selectFolder: (): Promise<string | undefined> => ipcRenderer.invoke('dialog:select-folder'),
  notify: (title: string, body: string): Promise<void> => ipcRenderer.invoke('notification:show', { title, body }),
  revealPath: (path: string): Promise<void> => ipcRenderer.invoke('shell:reveal-path', path),
})
