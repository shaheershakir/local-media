import { app } from 'electron'
import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { delimiter, join } from 'node:path'

const BACKEND_HOST = '127.0.0.1'
const BACKEND_PORT = 8000
const HEALTH_URL = `http://${BACKEND_HOST}:${BACKEND_PORT}/api/health`
let backendProcess: ChildProcess | undefined
let stopping = false

function backendEnvironment(): NodeJS.ProcessEnv {
  const dataDirectory = app.getPath('userData')
  const ffmpegDirectory = app.isPackaged ? join(process.resourcesPath, 'ffmpeg') : process.env.FFMPEG_DIR
  return {
    ...process.env,
    HOST: BACKEND_HOST,
    PORT: String(BACKEND_PORT),
    DB_PATH: join(dataDirectory, 'localfeed.db'),
    THUMBNAIL_DIR: join(dataDirectory, 'thumbnails'),
    TRANSCODED_DIR: join(dataDirectory, 'transcoded'),
    PATH: ffmpegDirectory ? `${ffmpegDirectory}${delimiter}${process.env.PATH ?? ''}` : process.env.PATH,
  }
}

function startCommand(): { command: string; args: string[]; cwd?: string } {
  if (!app.isPackaged) {
    return {
      command: process.env.PYTHON ?? 'python',
      args: ['-m', 'uvicorn', 'app.main:app', '--host', BACKEND_HOST, '--port', String(BACKEND_PORT)],
      cwd: join(app.getAppPath(), 'backend'),
    }
  }
  const executable = join(process.resourcesPath, 'backend', process.platform === 'win32' ? 'localfeed.exe' : 'localfeed')
  if (!existsSync(executable)) throw new Error(`Packaged backend was not found: ${executable}`)
  return { command: executable, args: [] }
}

export async function startPythonBackend(): Promise<void> {
  if (backendProcess?.pid) return
  stopping = false

  // If a backend is already listening (e.g. a leaked process from a previous run), reuse it.
  try {
    const probe = await fetch(HEALTH_URL)
    if (probe.ok) {
      console.log('[python] Existing backend detected — reusing it.')
      return
    }
  } catch { /* not running yet — proceed to spawn */ }

  const { command, args, cwd } = startCommand()
  backendProcess = spawn(command, args, { cwd, env: backendEnvironment(), stdio: 'inherit', windowsHide: true })
  backendProcess.once('exit', (code, signal) => {
    backendProcess = undefined
    if (!stopping) console.error(`Python backend exited unexpectedly (code ${code}, signal ${signal}).`)
  })

  const deadline = Date.now() + 30_000
  let lastError: unknown
  while (Date.now() < deadline) {
    try {
      if ((await fetch(HEALTH_URL)).ok) return
    } catch (error) {
      lastError = error
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  stopPythonBackend()
  throw new Error(`Python backend did not become ready at ${HEALTH_URL}: ${String(lastError)}`)
}

export function stopPythonBackend(): void {
  stopping = true
  const child = backendProcess
  backendProcess = undefined
  if (!child?.pid || child.killed) return
  if (process.platform === 'win32') {
    try { execFileSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }) } catch { /* already exited */ }
  } else {
    child.kill('SIGTERM')
  }
}

export const backendApiUrl = `http://${BACKEND_HOST}:${BACKEND_PORT}/api`
