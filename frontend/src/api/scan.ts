import { request } from './client'
import type { ScanStatus } from './types'

export async function startScan(): Promise<{ status: string; message: string }> {
  return request('/scan', { method: 'POST' })
}

export async function getScanStatus(): Promise<ScanStatus> {
  return request<ScanStatus>('/scan/status')
}

export async function logEvent(payload: {
  media_item_id: number
  event_type: string
  watched_seconds?: number | null
}): Promise<void> {
  try {
    await request('/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
  } catch {
    // Event logging is fire-and-forget — never throw
  }
}
