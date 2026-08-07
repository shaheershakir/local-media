// Base API client with typed responses

// Vite proxies this in a browser. Electron uses the same routes on its local backend.
const BASE_URL = window.localfeed?.apiBaseUrl ?? '/api'

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, options)
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`API error ${res.status}: ${text}`)
  }
  return res.json()
}

export { request, BASE_URL }
