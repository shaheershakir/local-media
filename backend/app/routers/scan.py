"""
Scan router — trigger and monitor library scans.

POST /api/scan        — start a background scan
GET  /api/scan/status — poll progress
"""
from __future__ import annotations

import threading
from fastapi import APIRouter, HTTPException
from app import config
from app.scanner import run_scan, get_scan_state

router = APIRouter(prefix="/api/scan", tags=["scan"])


@router.post("")
def start_scan():
    """Trigger an incremental library scan in the background."""
    if not config.MEDIA_ROOTS:
        raise HTTPException(
            status_code=400,
            detail="No MEDIA_ROOTS configured. Please add a source in Settings.",
        )
    state = get_scan_state()
    if state["running"]:
        return {"status": "already_running", "message": "A scan is already in progress."}

    thread = threading.Thread(target=run_scan, daemon=True, name="localfeed-scan")
    thread.start()
    return {"status": "started", "message": "Scan started in background."}


@router.get("/status")
def scan_status():
    """Return current scan state and progress."""
    return get_scan_state()
