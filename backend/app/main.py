"""
LocalFeed FastAPI application entrypoint.

Startup sequence:
1. Check ffmpeg is available
2. Create SQLite schema (idempotent)
3. Mount all routers
"""
from __future__ import annotations

import logging
import shutil
import sys
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import HOST, PORT
from app.db import create_schema

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("localfeed")


def _check_ffmpeg() -> None:
    if not shutil.which("ffmpeg") or not shutil.which("ffprobe"):
        logger.error(
            "\n"
            "═══════════════════════════════════════════════════\n"
            "  ffmpeg / ffprobe not found on PATH!\n"
            "  LocalFeed requires ffmpeg for video thumbnails\n"
            "  and transcoding.\n\n"
            "  Install: https://ffmpeg.org/download.html\n"
            "  Then add the bin/ directory to your PATH.\n"
            "═══════════════════════════════════════════════════"
        )
        # Don't hard-exit — image-only libraries can still work
        logger.warning("Continuing without ffmpeg — video features will be degraded.")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    _check_ffmpeg()
    create_schema()
    logger.info("LocalFeed ready — database schema initialized")
    yield
    # Shutdown (nothing to clean up)


app = FastAPI(
    title="LocalFeed API",
    description="Private local media browser — Instagram/Reels-style",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS — allow the Vite dev server and any localhost origin
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Range", "Content-Length", "Accept-Ranges"],
)

# Mount routers
from app.routers import scan, media, feed, folders, events

app.include_router(scan.router)
app.include_router(media.router)
app.include_router(feed.router)
app.include_router(folders.router)
app.include_router(events.router)


@app.get("/api/health")
def health():
    return {"status": "ok", "app": "LocalFeed"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host=HOST, port=PORT, reload=True)
