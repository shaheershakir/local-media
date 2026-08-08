import { useState, useEffect, useRef, useCallback } from 'react'
import { getScanStatus, startScan } from '../api/scan'
import type { ScanStatus } from '../api/types'

/**
 * useScanStatus
 *
 * Polls /api/scan/status every 1.5s while a scan is running.
 * Fires onScanComplete when the scan finishes — including scans that
 * were started externally (e.g. auto-triggered by add_source).
 */
export function useScanStatus(
  onScanComplete?: () => void,
  onScanProgress?: (status: ScanStatus) => void
) {
  const [status, setStatus] = useState<ScanStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  // null = unknown (first poll hasn't happened), true/false after first poll
  const prevRunningRef = useRef<boolean | null>(null)
  const onCompleteRef = useRef(onScanComplete)
  onCompleteRef.current = onScanComplete
  const onProgressRef = useRef(onScanProgress)
  onProgressRef.current = onScanProgress

  const startPolling = useCallback((poll: () => Promise<void>) => {
    if (!intervalRef.current) {
      intervalRef.current = setInterval(poll, 1500)
    }
  }, [])

  const stopPolling = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
  }, [])

  const poll = useCallback(async () => {
    try {
      const s = await getScanStatus()
      setStatus(s)
      onProgressRef.current?.(s)

      const wasRunning = prevRunningRef.current
      const isRunning = s.running

      // Fire onScanComplete whenever we see running→done transition.
      if (wasRunning === true && !isRunning) {
        onCompleteRef.current?.()
      }

      prevRunningRef.current = isRunning

      if (!isRunning) {
        stopPolling()
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to get scan status')
    }
  }, [stopPolling])

  const triggerScan = useCallback(async () => {
    try {
      setError(null)
      await startScan()
      prevRunningRef.current = true
      await poll()
      startPolling(poll)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to start scan')
    }
  }, [poll, startPolling])

  // On mount: do one immediate poll; if running, start the interval
  useEffect(() => {
    let mounted = true

    const initialPoll = async () => {
      try {
        const s = await getScanStatus()
        if (!mounted) return
        setStatus(s)
        onProgressRef.current?.(s)
        prevRunningRef.current = s.running
        if (s.running) {
          startPolling(poll)
        }
      } catch (e) {
        if (mounted) {
          setError(e instanceof Error ? e.message : 'Failed to get scan status')
        }
      }
    }

    initialPoll()
    return () => {
      mounted = false
      stopPolling()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return { status, error, triggerScan }
}
