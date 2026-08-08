import { app, dialog, ipcMain, Menu, nativeImage, Notification, shell, Tray } from 'electron'
import { createMainWindow } from './window'
import { startPythonBackend, stopPythonBackend } from './python'
import { mpvController, type MpvPlaybackMetadata } from './mpv'

// Configure Chromium media engine for unrestricted instant autoplay and platform decoding
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')
app.commandLine.appendSwitch('enable-features', 'PlatformHEVCDecoderSupport,VaapiVideoDecoder,VaapiVideoEncoder')

let mainWindow: Awaited<ReturnType<typeof createMainWindow>> | undefined
let tray: Tray | undefined

function createFutureTray(): void {
  // Kept isolated for the later “close to tray” UX. Add branded artwork before enabling it.
  const icon = nativeImage.createEmpty()
  tray = new Tray(icon)
  tray.setToolTip('LocalFeed')
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show LocalFeed', click: () => mainWindow?.show() },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]))
}

function registerNativeApis(): void {
  ipcMain.handle('dialog:select-files', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, { properties: ['openFile', 'multiSelections'] })
    return result.canceled ? [] : result.filePaths
  })
  ipcMain.handle('dialog:select-folder', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, { properties: ['openDirectory'] })
    return result.canceled ? undefined : result.filePaths[0]
  })
  ipcMain.handle('notification:show', (_event, payload: { title: string; body: string }) => {
    new Notification({ title: String(payload.title), body: String(payload.body) }).show()
  })
  ipcMain.handle('shell:reveal-path', (_event, path: string) => shell.showItemInFolder(String(path)))

  // ── MPV Player IPC Handlers ─────────────────────────────────────
  ipcMain.handle('mpv:is-available', async () => {
    return await mpvController.checkAvailability()
  })
  ipcMain.handle('mpv:get-status', () => {
    return mpvController.getStatus()
  })
  ipcMain.handle('mpv:play', async (_event, payload: { filePath: string; meta?: MpvPlaybackMetadata }) => {
    return await mpvController.play(payload.filePath, payload.meta)
  })
  ipcMain.handle('mpv:pause', async () => {
    await mpvController.pause()
    return true
  })
  ipcMain.handle('mpv:resume', async () => {
    await mpvController.resume()
    return true
  })
  ipcMain.handle('mpv:toggle-pause', async () => {
    await mpvController.togglePause()
    return true
  })
  ipcMain.handle('mpv:stop', async () => {
    await mpvController.stop()
    return true
  })
  ipcMain.handle('mpv:seek', async (_event, seconds: number) => {
    await mpvController.seek(seconds)
    return true
  })
  ipcMain.handle('mpv:go-to-position', async (_event, payload: number | { seconds: number; exact?: boolean }) => {
    if (typeof payload === 'number') {
      await mpvController.goToPosition(payload, true)
    } else if (payload && typeof payload.seconds === 'number') {
      await mpvController.goToPosition(payload.seconds, payload.exact ?? true)
    }
    return true
  })
  ipcMain.handle('mpv:set-volume', async (_event, volume: number) => {
    await mpvController.setVolume(volume)
    return true
  })
  ipcMain.handle('mpv:toggle-mute', async () => {
    await mpvController.toggleMute()
    return true
  })
}

app.whenReady().then(async () => {
  registerNativeApis()
  await startPythonBackend()
  mainWindow = await createMainWindow()
  mpvController.setMainWindow(mainWindow)
  // createFutureTray() is ready for a branded app icon and close-to-tray behavior.
  void createFutureTray
  app.on('activate', async () => {
    if (mainWindow) {
      mainWindow.show()
    } else {
      mainWindow = await createMainWindow()
      mpvController.setMainWindow(mainWindow)
    }
  })
}).catch((error: unknown) => {
  dialog.showErrorBox('LocalFeed failed to start', error instanceof Error ? error.message : String(error))
  app.quit()
})

app.on('before-quit', () => {
  mpvController.destroy()
  stopPythonBackend()
  tray?.destroy()
})

