import { useState, useEffect, useRef } from 'react'
import { getScanStatus, startScan } from '../api/scan'
import type { ScanStatus } from '../api/types'

/**
 * useScanStatus
 *
 * Polls /api/scan/status every 2s while a scan is running.
 * Stops polling when the scan finishes.
 */
export function useScanStatus() {
  const [status, setStatus] = useState<ScanStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const poll = async () => {
    try {
      const s = await getScanStatus()
      setStatus(s)
      if (!s.running && intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to get scan status')
    }
  }

  const triggerScan = async () => {
    try {
      await startScan()
      await poll()
      if (!intervalRef.current) {
        intervalRef.current = setInterval(poll, 2000)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to start scan')
    }
  }

  useEffect(() => {
    // Check initial status
    poll()
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [])

  // Start polling if initially running
  useEffect(() => {
    if (status?.running && !intervalRef.current) {
      intervalRef.current = setInterval(poll, 2000)
    }
  }, [status?.running])

  return { status, error, triggerScan }
}
