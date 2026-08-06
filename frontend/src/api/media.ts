import { request } from './client'
import type { MediaItem, PaginatedResponse, FeedResponse } from './types'

export type SortOption = 'newest' | 'oldest' | 'duration' | 'favorites' | 'random' | 'name'

export async function listMedia(params: {
  sort?: SortOption
  media_type?: 'video' | 'image' | null
  folder_id?: number | null
  q?: string
  favorites_only?: boolean
  page?: number
  page_size?: number
}): Promise<PaginatedResponse<MediaItem>> {
  const qs = new URLSearchParams()
  if (params.sort) qs.set('sort', params.sort)
  if (params.media_type) qs.set('media_type', params.media_type)
  if (params.folder_id != null) qs.set('folder_id', String(params.folder_id))
  if (params.q) qs.set('q', params.q)
  if (params.favorites_only) qs.set('favorites_only', 'true')
  if (params.page != null) qs.set('page', String(params.page))
  if (params.page_size != null) qs.set('page_size', String(params.page_size))
  return request<PaginatedResponse<MediaItem>>(`/media?${qs}`)
}

export async function getMediaItem(id: number): Promise<MediaItem> {
  return request<MediaItem>(`/media/${id}`)
}

export async function updateMediaItem(id: number, patch: { is_favorite?: boolean; title?: string }) {
  return request(`/media/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
}

export function thumbnailUrl(id: number): string {
  return `/api/media/${id}/thumbnail`
}

export function streamUrl(id: number): string {
  return `/api/media/${id}/stream`
}

export function fullImageUrl(id: number): string {
  return `/api/media/${id}/full`
}

export async function getRandomFeed(params: {
  limit?: number
  exclude_ids?: number[]
  media_type?: 'video' | 'image' | null
}): Promise<FeedResponse> {
  const qs = new URLSearchParams()
  if (params.limit != null) qs.set('limit', String(params.limit))
  if (params.exclude_ids?.length) qs.set('exclude_ids', params.exclude_ids.join(','))
  if (params.media_type) qs.set('media_type', params.media_type)
  return request<FeedResponse>(`/feed/random?${qs}`)
}
