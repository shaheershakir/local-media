import { existsSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { BrowserWindow, type Rectangle } from 'electron'

// node-mpv CommonJS module
// eslint-disable-next-line @typescript-eslint/no-require-imports
const NodeMpv = require('node-mpv')

export interface MpvPlaybackMetadata {
  id?: number
  title?: string
  startTime?: number
  volume?: number
}

export interface MpvStatus {
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

export class MPVController {
  private mpvInstance: any | null = null
  private mainWindow: BrowserWindow | null = null
  private playerChildWindow: BrowserWindow | null = null
  private isMpvAvailable: boolean | null = null
  private resolvedBinaryPath: string | null = null
  private currentStatus: MpvStatus = {
    available: false,
    running: false,
    currentTime: 0,
    duration: 0,
    paused: false,
    volume: 100,
    muted: false,
  }

  constructor() {
    this.detectMpvBinary()
  }

  public setMainWindow(win: BrowserWindow | null): void {
    this.mainWindow = win
  }

  /**
   * Returns the native Win32 HWND / X11 Window ID string.
   */
  private getWindowHandle(win: BrowserWindow): string | null {
    try {
      const handle = win.getNativeWindowHandle()
      if (process.platform === 'win32') {
        if (handle.length === 8) {
          return handle.readBigUInt64LE(0).toString()
        } else if (handle.length === 4) {
          return handle.readUInt32LE(0).toString()
        }
      } else if (process.platform === 'linux') {
        return handle.readUInt32LE(0).toString()
      }
    } catch (e) {
      console.warn('[mpv] Could not get native window handle:', e)
    }
    return null
  }

  /**
   * Search for mpv binary across PATH, Chocolatey, Scoop, and custom environment variables.
   */
  public detectMpvBinary(): string | null {
    if (this.resolvedBinaryPath && existsSync(this.resolvedBinaryPath)) {
      return this.resolvedBinaryPath
    }

    if (process.env.MPV_PATH && existsSync(process.env.MPV_PATH)) {
      this.resolvedBinaryPath = process.env.MPV_PATH
      this.isMpvAvailable = true
      this.currentStatus.available = true
      return this.resolvedBinaryPath
    }

    const candidatePaths: string[] = []

    if (process.platform === 'win32') {
      const programData = process.env.ProgramData || 'C:\\ProgramData'
      const userProfile = process.env.USERPROFILE || ''
      const localAppData = process.env.LOCALAPPDATA || ''

      candidatePaths.push(
        join(programData, 'chocolatey', 'bin', 'mpv.exe'),
        join(programData, 'chocolatey', 'bin', 'mpv.com'),
        join(programData, 'chocolatey', 'lib', 'mpvio.install', 'tools', 'mpv.exe'),
        join(programData, 'chocolatey', 'lib', 'mpv', 'tools', 'mpv.exe'),
        join(userProfile, 'scoop', 'apps', 'mpv', 'current', 'mpv.exe'),
        join(localAppData, 'Programs', 'mpv', 'mpv.exe'),
        'C:\\mpv\\mpv.exe',
        'C:\\Program Files\\mpv\\mpv.exe',
        'C:\\Program Files (x86)\\mpv\\mpv.exe'
      )
    } else if (process.platform === 'darwin') {
      candidatePaths.push('/opt/homebrew/bin/mpv', '/usr/local/bin/mpv', '/usr/bin/mpv')
    } else {
      candidatePaths.push('/usr/bin/mpv', '/usr/local/bin/mpv', '/usr/bin/mpv.bin')
    }

    for (const candidate of candidatePaths) {
      if (existsSync(candidate)) {
        this.resolvedBinaryPath = candidate
        this.isMpvAvailable = true
        this.currentStatus.available = true
        console.log(`[mpv] Found MPV binary at ${candidate}`)
        return candidate
      }
    }

    // Check system PATH
    const pathDirs = (process.env.PATH || '').split(delimiter)
    const execNames = process.platform === 'win32' ? ['mpv.exe', 'mpv.com'] : ['mpv']

    for (const dir of pathDirs) {
      for (const name of execNames) {
        const full = join(dir, name)
        if (existsSync(full)) {
          this.resolvedBinaryPath = full
          this.isMpvAvailable = true
          this.currentStatus.available = true
          console.log(`[mpv] Found MPV binary on PATH at ${full}`)
          return full
        }
      }
    }

    // Quick shell probe fallback
    try {
      const probeCmd = process.platform === 'win32' ? 'where' : 'which'
      const output = execFileSync(probeCmd, ['mpv'], { encoding: 'utf8', windowsHide: true }).trim()
      const firstLine = output.split(/\r?\n/)[0]
      if (firstLine && existsSync(firstLine)) {
        this.resolvedBinaryPath = firstLine
        this.isMpvAvailable = true
        this.currentStatus.available = true
        console.log(`[mpv] Resolved MPV binary via ${probeCmd}: ${firstLine}`)
        return firstLine
      }
    } catch {
      // Not found via where/which
    }

    this.isMpvAvailable = false
    this.currentStatus.available = false
    return null
  }

  public async checkAvailability(): Promise<boolean> {
    const bin = this.detectMpvBinary()
    return Boolean(bin)
  }

  /**
   * Initializes node-mpv instance with proper window handle embedding (--wid).
   */
  private async ensureMpvInstance(): Promise<any> {
    if (this.mpvInstance && this.currentStatus.running) {
      return this.mpvInstance
    }

    const binary = this.detectMpvBinary()
    if (!binary) {
      throw new Error(
        'MPV player is not detected on your system. Please install mpv (e.g. `choco install mpv` or add mpv to PATH).'
      )
    }

    const socketPath =
      process.platform === 'win32'
        ? `\\\\.\\pipe\\localfeed_mpv_${Date.now()}`
        : `/tmp/localfeed_mpv_${Date.now()}.sock`

    const mpvArgs = [
      '--keep-open=yes',
      '--idle=yes',
      '--no-border',
      '--no-window-dragging',
      '--no-osc', // Disable default MPV OSD so custom React UI controls everything
      '--no-osd-bar',
      '--hwdec=auto-safe',
      '--cursor-autohide=500',
    ]

    // Embed directly into the window handle (--wid) so NO separate OS window is spawned
    if (this.mainWindow) {
      const hwnd = this.getWindowHandle(this.mainWindow)
      if (hwnd) {
        mpvArgs.push(`--wid=${hwnd}`)
      }
    }

    const mpvOptions = {
      binary,
      socket: socketPath,
      auto_restart: true,
      time_update: 0.2,
      verbose: false,
      debug: false,
    }

    try {
      const mpv = new NodeMpv(mpvOptions, mpvArgs)

      this.bindMpvEvents(mpv)

      await mpv.start()

      // Explicitly observe duration and length for accurate timeline calculation
      try {
        mpv.socket.command('observe_property', [1, 'duration'])
        mpv.socket.command('observe_property', [2, 'length'])
      } catch {}

      this.mpvInstance = mpv
      this.currentStatus.running = true
      this.currentStatus.available = true
      this.broadcastStatus()
      return mpv
    } catch (error) {
      this.currentStatus.running = false
      this.currentStatus.error = error instanceof Error ? error.message : String(error)
      this.broadcastStatus()
      throw error
    }
  }

  private bindMpvEvents(mpv: any): void {
    mpv.on('statuschange', (status: any) => {
      if (status['time-pos'] !== undefined && status['time-pos'] !== null) {
        this.currentStatus.currentTime = Number(status['time-pos']) || 0
      }
      if (status.duration !== undefined && status.duration !== null && Number(status.duration) > 0) {
        this.currentStatus.duration = Number(status.duration)
      } else if (status.length !== undefined && status.length !== null && Number(status.length) > 0) {
        this.currentStatus.duration = Number(status.length)
      }
      if (status.pause !== undefined) this.currentStatus.paused = Boolean(status.pause)
      if (status.volume !== undefined) this.currentStatus.volume = Number(status.volume) || 100
      if (status.mute !== undefined) this.currentStatus.muted = Boolean(status.mute)
      this.broadcastStatus()
    })

    mpv.on('timeposition', (seconds: number) => {
      this.currentStatus.currentTime = Number(seconds) || 0
      this.broadcastEvent('mpv:timeposition', {
        currentTime: this.currentStatus.currentTime,
        duration: this.currentStatus.duration,
      })
    })

    mpv.on('paused', () => {
      this.currentStatus.paused = true
      this.broadcastStatus()
    })

    mpv.on('resumed', () => {
      this.currentStatus.paused = false
      this.broadcastStatus()
    })

    mpv.on('stopped', () => {
      this.currentStatus.running = false
      this.currentStatus.activePath = undefined
      this.currentStatus.title = undefined
      this.currentStatus.mediaItemId = undefined
      this.currentStatus.currentTime = 0
      this.broadcastStatus()
    })

    mpv.on('crashed', () => {
      console.warn('[mpv] MPV process exited or closed.')
      this.currentStatus.running = false
      this.currentStatus.activePath = undefined
      this.broadcastStatus()
    })
  }

  private broadcastStatus(): void {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return
    this.mainWindow.webContents.send('mpv:status', { ...this.currentStatus })
  }

  private broadcastEvent(channel: string, payload: any): void {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return
    this.mainWindow.webContents.send(channel, payload)
  }

  public getStatus(): MpvStatus {
    return { ...this.currentStatus }
  }

  public async play(filePath: string, meta?: MpvPlaybackMetadata): Promise<{ success: boolean; message?: string }> {
    if (!existsSync(filePath)) {
      throw new Error(`Media file does not exist on disk: ${filePath}`)
    }

    const mpv = await this.ensureMpvInstance()

    this.currentStatus.activePath = filePath
    this.currentStatus.title = meta?.title || filePath.split(/[/\\]/).pop() || 'Video'
    this.currentStatus.mediaItemId = meta?.id
    this.currentStatus.running = true
    this.currentStatus.paused = false

    try {
      await mpv.load(filePath, 'replace')

      try {
        await mpv.resume()
      } catch {
        // Resume if paused
      }

      if (meta?.startTime && meta.startTime > 0) {
        try {
          await mpv.goToPosition(meta.startTime)
        } catch {
          // Seeking right at start
        }
      }

      if (meta?.volume !== undefined) {
        try {
          await mpv.volume(Math.max(0, Math.min(100, meta.volume)))
        } catch {
          // Volume set ignore
        }
      }

      this.broadcastStatus()
      return { success: true }
    } catch (error) {
      this.currentStatus.error = error instanceof Error ? error.message : String(error)
      this.broadcastStatus()
      throw error
    }
  }

  public async pause(): Promise<void> {
    if (this.mpvInstance && this.currentStatus.running) {
      try {
        await this.mpvInstance.pause()
      } catch {}
      this.currentStatus.paused = true
      this.broadcastStatus()
    }
  }

  public async resume(): Promise<void> {
    if (this.mpvInstance && this.currentStatus.running) {
      try {
        await this.mpvInstance.resume()
      } catch {}
      this.currentStatus.paused = false
      this.broadcastStatus()
    }
  }

  public async togglePause(): Promise<void> {
    if (this.mpvInstance && this.currentStatus.running) {
      try {
        await this.mpvInstance.togglePause()
      } catch {}
      this.currentStatus.paused = !this.currentStatus.paused
      this.broadcastStatus()
    }
  }

  public async stop(): Promise<void> {
    if (this.mpvInstance && this.currentStatus.running) {
      try {
        await this.mpvInstance.stop()
      } catch {
        // Ignore stop error if already stopped
      }
      this.currentStatus.running = false
      this.currentStatus.activePath = undefined
      this.currentStatus.title = undefined
      this.currentStatus.mediaItemId = undefined
      this.broadcastStatus()
    }
  }

  public async seek(seconds: number): Promise<void> {
    if (this.mpvInstance && this.currentStatus.running) {
      try {
        await this.mpvInstance.seek(seconds)
      } catch {}
    }
  }

  public async goToPosition(seconds: number, exact = true): Promise<void> {
    if (this.mpvInstance && this.currentStatus.running) {
      try {
        const clamped = Math.max(0, seconds)
        if (exact) {
          await this.mpvInstance.socket.command('seek', [clamped, 'absolute', 'exact'])
        } else {
          await this.mpvInstance.socket.command('seek', [clamped, 'absolute', 'keyframes'])
        }
        this.currentStatus.currentTime = clamped
      } catch {
        try {
          await this.mpvInstance.goToPosition(seconds)
        } catch {}
      }
    }
  }

  public async setVolume(volume: number): Promise<void> {
    if (this.mpvInstance && this.currentStatus.running) {
      const clamped = Math.max(0, Math.min(100, volume))
      try {
        await this.mpvInstance.volume(clamped)
      } catch {}
      this.currentStatus.volume = clamped
      this.broadcastStatus()
    }
  }

  public async toggleMute(): Promise<void> {
    if (this.mpvInstance && this.currentStatus.running) {
      try {
        await this.mpvInstance.toggleMute()
      } catch {}
      this.currentStatus.muted = !this.currentStatus.muted
      this.broadcastStatus()
    }
  }

  public destroy(): void {
    if (this.playerChildWindow && !this.playerChildWindow.isDestroyed()) {
      this.playerChildWindow.destroy()
      this.playerChildWindow = null
    }
    if (this.mpvInstance) {
      try {
        this.mpvInstance.quit()
      } catch {
        // Ignore on quit
      }
      this.mpvInstance = null
    }
  }
}

export const mpvController = new MPVController()
