# LocalFeed Electron shell

Electron is deliberately thin: React calls the same FastAPI routes, while FastAPI keeps ownership of scanning, media delivery, SQLite, and FFmpeg.

## Development

```powershell
npm install
python -m pip install -r backend/requirements-build.txt
npm run dev
```

Electron starts the existing Python backend and waits for `GET /api/health` before opening the window. Configure `MEDIA_ROOTS` exactly as before in `backend/.env`.
Use Python 3.11–3.13 for the existing pinned Pillow and HEIF dependencies; the checked-in virtual environment is Python 3.14 and cannot build those current pins.

## Windows packaging

```powershell
npm run dist:win
```

This builds the React bundle, Electron shell, and PyInstaller backend, then packages both the backend and FFmpeg. SQLite is created on first launch in Electron's per-user data directory, keeping the database, thumbnails, and transcoded files writable outside the install directory. Build natively on macOS or Linux for those targets.
