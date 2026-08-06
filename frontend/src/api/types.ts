// Shared TypeScript types for media items, folders, etc.

export type MediaType = 'video' | 'image'
export type Orientation = 'landscape' | 'portrait' | 'square'

export interface MediaItem {
  id: number
  folder_id: number
  media_type: MediaType
  filename: string
  path: string
  title: string
  duration_seconds: number | null
  codec: string | null
  browser_native: number // 0 | 1
  resolution: string | null
  orientation: Orientation | null
  file_size_bytes: number | null
  thumbnail_path: string | null
  created_at: string
  file_modified_at: string | null
  captured_at: string | null
  last_watched_at: string | null
  watch_count: number
  is_favorite: number // 0 | 1
  duration_watched_seconds: number
  is_active: number
  folder_name: string
  folder_display_name: string | null
  folder_label: string
}

export interface Folder {
  id: number
  name: string
  display_name: string | null
  path: string
  parent_folder_id: number | null
  item_count: number
  cover_thumbnail_path: string | null
  created_at: string
}

export interface PaginatedResponse<T> {
  items: T[]
  total: number
  page: number
  page_size: number
  pages: number
}

export interface FeedResponse {
  items: MediaItem[]
  total_available: number
}

export interface ScanStatus {
  running: boolean
  files_total: number
  files_scanned: number
  files_new: number
  files_updated: number
  files_skipped: number
  errors: number
  started_at: string | null
  finished_at: string | null
  elapsed_seconds: number
  estimated_seconds_remaining: number | null
  recent_errors: string[]
}
