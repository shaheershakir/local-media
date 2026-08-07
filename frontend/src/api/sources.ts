import { request } from './client'

export interface Source {
  path: string
  exists: boolean
  display: string
}

interface SourcesResponse {
  sources: Source[]
}

export async function getSources(): Promise<Source[]> {
  const data = await request<SourcesResponse>('/sources')
  return data.sources
}

export async function addSource(path: string): Promise<{ status: string; path: string }> {
  return request('/sources', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  })
}

export async function removeSource(path: string): Promise<{ status: string; path: string }> {
  return request('/sources', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  })
}
