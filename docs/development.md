# LocalFeed Development Guide

This document describes the environment setup, prerequisites, development workflows, and configuration options for working on LocalFeed.

---

## 1. Prerequisites

Ensure the following tools are installed and accessible on your system:

| Tool | Version | Purpose |
|---|---|---|
| **Node.js** | `>= 22.0.0` | Electron runtime, frontend build tools, Vite server |
| **npm** | `>= 10.0.0` | Package management |
| **Python** | `>= 3.10` | FastAPI backend, SQLite indexing, metadata extraction |
| **FFmpeg & FFprobe** | Latest stable | Video thumbnail generation, metadata probing, live/cached transcoding |
| **MPV** *(Optional)* | `>= 0.35.0` | Optional native hardware-accelerated playback engine |

### Verifying System Tools

```bash
node -v
npm -v
python --version
ffmpeg -version
ffprobe -version
mpv --version # optional
```

---

## 2. Initial Setup

### Step A: Clone & Install Node Dependencies

The root `package.json` includes a `postinstall` script that automatically installs dependencies for `frontend/`:

```bash
# Install root and frontend node modules
npm install
```

### Step B: Setup Python Virtual Environment

```bash
# Create and activate virtual environment (Windows PowerShell)
python -m venv .venv
.venv\Scripts\Activate.ps1

# Install backend dependencies
pip install -r backend/requirements.txt
```

### Step C: Environment Configuration

Copy the example environment file in `backend/`:

```bash
cp backend/.env.example backend/.env
```

Default `.env` configuration:

```ini
HOST=127.0.0.1
PORT=8000
MEDIA_ROOTS="D:/Videos,D:/Photos"
DB_PATH="~/.localfeed/localfeed.db"
THUMBNAIL_DIR="~/.localfeed/thumbnails"
TRANSCODED_DIR="~/.localfeed/transcoded"
MAX_PAGE_SIZE=50
THUMBNAIL_WIDTH=400
THUMBNAIL_WORKERS=2
SCAN_METADATA_WORKERS=8
SCAN_DB_BATCH_SIZE=1000
```

---

## 3. Running the Application in Development

### Unified Development Workflow (Recommended)

To start the full stack (Vite dev server + Electron main process + Python backend):

```bash
npm run dev
```

**What happens behind the scenes**:
1. `npm --prefix frontend run dev` starts the Vite dev server on `http://127.0.0.1:5173`.
2. `wait-on` polls until port `5173` is listening.
3. `tsx electron/main.ts` launches the Electron main process.
4. Electron invokes [electron/python.ts](file:///f:/local-media/electron/python.ts), which starts Python Uvicorn on `127.0.0.1:8000`.
5. Electron verifies `http://127.0.0.1:8000/api/health`.
6. Electron opens the desktop `BrowserWindow` pointing to Vite.

---

### Running Subsystems Individually

#### 1. Frontend Development Only (Browser Mode)

```bash
npm --prefix frontend run dev
```
Open `http://localhost:5173` in your browser. API calls proxy to `http://127.0.0.1:8000`.

#### 2. Backend Development Only (FastAPI with Auto-Reload)

```bash
cd backend
python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```
Swagger UI documentation is available at `http://127.0.0.1:8000/docs`.

#### 3. Electron Layer Only

If Vite and the backend are already running manually:

```bash
npx cross-env VITE_DEV_SERVER_URL=http://127.0.0.1:5173 tsx electron/main.ts
```

---

## 4. Development Scripts Summary

| Command | Working Directory | Description |
|---|---|---|
| `npm run dev` | Root | Starts frontend, Electron, and backend concurrently |
| `npm --prefix frontend run dev` | Root | Starts only the Vite frontend dev server |
| `npm --prefix frontend run lint`| Root | Runs Oxlint across frontend TypeScript files |
| `npm --prefix frontend run build`| Root | Type-checks and builds frontend bundle |
| `npm run build:electron` | Root | Bundles Electron main and preload scripts with esbuild |
| `npm run build:backend` | Root | Packages backend into binary with PyInstaller |
| `npm run build` | Root | Runs full build (renderer + electron + backend) |
| `npm run dist:win` | Root | Builds Windows NSIS installer and portable executable |
| `python test_seeking.py` | `backend/` | Runs seeking and streaming regression suite |
