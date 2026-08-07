import { existsSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { type BrowserWindow } from 'electron'

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
  private isMpvAvailable: boolean | null = null
  private resolvedBinaryPath: string | null = null
  private isStarting = false
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
   * Initializes node-mpv instance with proper socket and args.
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
      '--force-window=yes',
      '--autofit=80%x80%',
      '--geometry=50%:50%',
      '--title=LocalFeed Cinema',
      '--osd-level=1',
      '--osd-font=sans-serif',
      '--osd-font-size=24',
      '--osd-color=#f2ede4',
      '--osd-border-color=#080809',
      '--osd-border-size=2',
      '--hwdec=auto-safe',
    ]

    const mpvOptions = {
      binary,
      socket: socketPath,
      auto_restart: true,
      time_update: 0.25,
      verbose: false,
      debug: false,
    }

    this.isStarting = true

    try {
      const mpv = new NodeMpv(mpvOptions, mpvArgs)

      this.bindMpvEvents(mpv)

      await mpv.start()

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
    } finally {
      this.isStarting = false
    }
  }

  private bindMpvEvents(mpv: any): void {
    mpv.on('statuschange', (status: any) => {
      if (status['time-pos'] !== undefined) this.currentStatus.currentTime = Number(status['time-pos']) || 0
      if (status.duration !== undefined) this.currentStatus.duration = Number(status.duration) || 0
      if (status.pause !== undefined) this.currentStatus.paused = Boolean(status.pause)
      if (status.volume !== undefined) this.currentStatus.volume = Number(status.volume) || 100
      if (status.mute !== undefined) this.currentStatus.muted = Boolean(status.mute)
      this.broadcastStatus()
    })

    mpv.on('timeposition', (seconds: number) => {
      this.currentStatus.currentTime = Number(seconds) || 0
      this.broadcastEvent('mpv:timeposition', { currentTime: this.currentStatus.currentTime })
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
      console.warn('[mpv] MPV process crashed or closed.')
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

      if (meta?.startTime && meta.startTime > 0) {
        try {
          await mpv.goToPosition(meta.startTime)
        } catch {
          // Seeking right at start may lag slightly on some formats
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
      await this.mpvInstance.pause()
      this.currentStatus.paused = true
      this.broadcastStatus()
    }
  }

  public async resume(): Promise<void> {
    if (this.mpvInstance && this.currentStatus.running) {
      await this.mpvInstance.resume()
      this.currentStatus.paused = false
      this.broadcastStatus()
    }
  }

  public async togglePause(): Promise<void> {
    if (this.mpvInstance && this.currentStatus.running) {
      await this.mpvInstance.togglePause()
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
      await this.mpvInstance.seek(seconds)
    }
  }

  public async goToPosition(seconds: number): Promise<void> {
    if (this.mpvInstance && this.currentStatus.running) {
      await this.mpvInstance.goToPosition(seconds)
    }
  }

  public async setVolume(volume: number): Promise<void> {
    if (this.mpvInstance && this.currentStatus.running) {
      const clamped = Math.max(0, Math.min(100, volume))
      await this.mpvInstance.volume(clamped)
      this.currentStatus.volume = clamped
      this.broadcastStatus()
    }
  }

  public async toggleMute(): Promise<void> {
    if (this.mpvInstance && this.currentStatus.running) {
      await this.mpvInstance.toggleMute()
      this.currentStatus.muted = !this.currentStatus.muted
      this.broadcastStatus()
    }
  }

  public destroy(): void {
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
