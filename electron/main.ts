import { app, dialog, ipcMain, Menu, nativeImage, Notification, shell, Tray } from 'electron'
import { createMainWindow } from './window'
import { startPythonBackend, stopPythonBackend } from './python'

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
}

app.whenReady().then(async () => {
  registerNativeApis()
  await startPythonBackend()
  mainWindow = await createMainWindow()
  // createFutureTray() is ready for a branded app icon and close-to-tray behavior.
  void createFutureTray
  app.on('activate', async () => {
    if (mainWindow) mainWindow.show()
    else mainWindow = await createMainWindow()
  })
}).catch((error: unknown) => {
  dialog.showErrorBox('LocalFeed failed to start', error instanceof Error ? error.message : String(error))
  app.quit()
})

app.on('before-quit', () => {
  stopPythonBackend()
  tray?.destroy()
})
