// Shared TypeScript types for media items, folders, recommendations, and future extensibility

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
  source_id?: number | null
  tags?: string[]
  genres?: string[]
  ai_embedding_id?: string | null
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
  source_id?: number | null
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

// ════════════════════════════════════════════════════════════════════════════════
// Future Extensibility Schemas & Extension Points
// ════════════════════════════════════════════════════════════════════════════════

/**
 * 1. Multiple Media Sources Architecture
 * Allows aggregating multiple disks, NAS drives, or external directories.
 */
export interface MediaSource {
  id: number
  name: string
  root_path: string
  is_enabled: boolean
  last_scanned_at: string | null
  total_items?: number
  created_at: string
}

/**
 * 2. Tags & Genres Taxonomy
 * Supports manual and AI-assisted classification.
 */
export interface MediaTag {
  id: number
  name: string
  color?: string
  is_system?: boolean
  item_count?: number
}

export interface MediaGenre {
  id: number
  name: string
  slug: string
  description?: string
  item_count?: number
}

/**
 * 3. Watch History Architecture
 * Chronological watch sessions with timestamp tracking and completion rates.
 */
export interface WatchHistorySession {
  id: number
  media_id: number
  started_at: string
  stopped_at?: string
  position_seconds: number
  duration_seconds: number
  completion_rate: number // 0.0 to 1.0
  device_label?: string
}

/**
 * 4. Collections & Smart Playlists Architecture
 * Supports static curated playlists and query-based dynamic smart collections.
 */
export interface SmartFilterCriteria {
  resolution?: '4K' | '1080p' | '720p' | 'any'
  codecs?: string[]
  tags?: string[]
  genres?: string[]
  folderIds?: number[]
  sourceIds?: number[]
  unwatchedOnly?: boolean
  favoritesOnly?: boolean
  minDurationSeconds?: number
  maxDurationSeconds?: number
  createdAfter?: string
  searchQuery?: string
  sortBy?: 'newest' | 'oldest' | 'duration' | 'watch_count' | 'random' | 'rating'
}

export interface MediaCollection {
  id: number
  title: string
  description?: string
  is_smart: boolean
  filter_criteria?: SmartFilterCriteria
  item_ids?: number[]
  cover_media_id?: number
  created_at: string
  updated_at: string
}

/**
 * 5. Similarity & AI Recommendations Engine Interface
 * Pluggable provider architecture for vector embeddings and local metadata graphs.
 */
export interface SimilarVideosQuery {
  targetId: number
  metric?: 'cosine_embedding' | 'folder_proximity' | 'shared_tags' | 'visual_similarity'
  limit?: number
  excludeIds?: number[]
}

export interface RecommendationProvider {
  name: string
  version: string
  getRecommendations: (params: {
    currentId?: number
    folderId?: number
    limit?: number
    userContext?: { recentWatchIds?: number[]; favoriteTags?: string[] }
  }) => Promise<MediaItem[]>
  getSimilarVideos?: (query: SimilarVideosQuery) => Promise<MediaItem[]>
}

/**
 * 6. Dynamic Search & Discovery Sections
 * Reusable facet sections for exploratory browsing.
 */
export interface SearchFacetSection {
  id: string
  title: string
  facetType: 'tag' | 'genre' | 'resolution' | 'folder' | 'source' | 'ai_topic'
  filter: SmartFilterCriteria
}
