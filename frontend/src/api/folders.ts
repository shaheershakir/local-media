import { request } from './client'
import type { Folder, PaginatedResponse, MediaItem } from './types'

export interface FolderDetail {
  folder: Folder
  subfolders: Folder[]
  media: PaginatedResponse<MediaItem>
}

export async function listFolders(params?: {
  parent_id?: number
  page?: number
  page_size?: number
}): Promise<PaginatedResponse<Folder>> {
  const qs = new URLSearchParams()
  if (params?.parent_id != null) qs.set('parent_id', String(params.parent_id))
  if (params?.page != null) qs.set('page', String(params.page))
  if (params?.page_size != null) qs.set('page_size', String(params.page_size))
  return request<PaginatedResponse<Folder>>(`/folders?${qs}`)
}

export async function getFolder(
  id: number,
  params?: { page?: number; page_size?: number; sort?: string }
): Promise<FolderDetail> {
  const qs = new URLSearchParams()
  if (params?.page != null) qs.set('page', String(params.page))
  if (params?.page_size != null) qs.set('page_size', String(params.page_size))
  if (params?.sort) qs.set('sort', params.sort)
  return request<FolderDetail>(`/folders/${id}?${qs}`)
}

export async function updateFolder(id: number, patch: { display_name?: string }) {
  return request(`/folders/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
}
