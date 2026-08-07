import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { backendApiUrl } from './python'

export async function createMainWindow(): Promise<BrowserWindow> {
  const window = new BrowserWindow({
    width: 1280, height: 820, minWidth: 900, minHeight: 620, show: false,
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      additionalArguments: [`--localfeed-api=${backendApiUrl}`],
    },
  })
  window.once('ready-to-show', () => window.show())
  const devServerUrl = process.env.VITE_DEV_SERVER_URL
  if (devServerUrl) await window.loadURL(devServerUrl)
  else await window.loadFile(join(app.getAppPath(), 'frontend', 'dist', 'index.html'))
  return window
}
