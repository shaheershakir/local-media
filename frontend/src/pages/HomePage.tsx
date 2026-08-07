import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { listMedia, updateMediaItem } from '../api/media'
import { listFolders, getFolder } from '../api/folders'
import type { MediaItem, Folder } from '../api/types'
import { HeroBanner } from '../components/HeroBanner'
import { MediaRow } from '../components/MediaRow'

interface FolderSectionData {
  folder: Folder
  items: MediaItem[]
  total: number
}

/**
 * Modern Netflix / Plex inspired Home Page.
 * Uses modular HeroBanner and MediaRow components.
 */
export function HomePage() {
  const navigate = useNavigate()

  const [heroItem, setHeroItem] = useState<MediaItem | null>(null)
  const [continueWatching, setContinueWatching] = useState<MediaItem[]>([])
  const [recentlyAdded, setRecentlyAdded] = useState<MediaItem[]>([])
  const [randomPicks, setRandomPicks] = useState<MediaItem[]>([])
  const [folderSections, setFolderSections] = useState<FolderSectionData[]>([])
  const [loading, setLoading] = useState(true)

  const loadHomeContent = useCallback(async () => {
    setLoading(true)
    try {
      // 1. Fetch Recently Added Videos
      const recentRes = await listMedia({
        sort: 'newest',
        media_type: 'video',
        page: 1,
        page_size: 20,
      })
      setRecentlyAdded(recentRes.items)

      // Choose Hero Featured Item (random from top 6 recent videos or first item)
      if (recentRes.items.length > 0) {
        const heroPool = recentRes.items.slice(0, Math.min(6, recentRes.items.length))
        const pickedHero = heroPool[Math.floor(Math.random() * heroPool.length)]
        setHeroItem(pickedHero)
      } else {
        // Fallback: fetch any media item if no videos exist
        const allRes = await listMedia({ sort: 'newest', page: 1, page_size: 20 })
        if (allRes.items.length > 0) {
          setHeroItem(allRes.items[0])
          setRecentlyAdded(allRes.items)
        }
      }

      // 2. Fetch Continue Watching (videos with duration_watched_seconds > 0)
      const watched = recentRes.items.filter((it) => it.duration_watched_seconds > 0)
      setContinueWatching(watched)

      // 3. Fetch Random Picks
      const randomRes = await listMedia({
        sort: 'random',
        media_type: 'video',
        page: 1,
        page_size: 20,
      })
      setRandomPicks(randomRes.items)

      // 4. Fetch Dynamic First-Level Folders (Categories)
      const topFoldersRes = await listFolders({ page: 1, page_size: 50 })
      const topFolders = topFoldersRes.items

      // For each first-level folder, fetch its items to generate dynamic category shelves
      const sectionPromises = topFolders.map(async (folder) => {
        try {
          const detail = await getFolder(folder.id, { page_size: 15, sort: 'newest' })
          return {
            folder,
            items: detail.media.items,
            total: detail.media.total,
          }
        } catch (err) {
          console.error(`Failed to load items for folder ${folder.name}:`, err)
          return null
        }
      })

      const sections = (await Promise.all(sectionPromises)).filter(
        (sec): sec is FolderSectionData => sec !== null && sec.items.length > 0
      )
      setFolderSections(sections)
    } catch (e) {
      console.error('Failed to load Home page data:', e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadHomeContent()
  }, [loadHomeContent])

  const handleOpenMedia = (item: MediaItem) => {
    navigate(`/watch/${item.id}`, { state: { from: '/' } })
  }

  const handleToggleFavorite = async (e: React.MouseEvent, item: MediaItem) => {
    e.stopPropagation()
    const nextFav = item.is_favorite ? 0 : 1
    try {
      await updateMediaItem(item.id, { is_favorite: Boolean(nextFav) })

      // Update state in all collections
      const updater = (list: MediaItem[]) =>
        list.map((it) => (it.id === item.id ? { ...it, is_favorite: nextFav } : it))

      setRecentlyAdded(updater)
      setRandomPicks(updater)
      setContinueWatching(updater)
      setFolderSections((prev) =>
        prev.map((sec) => ({
          ...sec,
          items: updater(sec.items),
        }))
      )
      if (heroItem?.id === item.id) {
        setHeroItem((prev) => (prev ? { ...prev, is_favorite: nextFav } : null))
      }
    } catch (err) {
      console.error('Failed to toggle favorite:', err)
    }
  }

  return (
    <div className="page-enter home-cinema-view">
      {/* ── HERO SECTION: Large Featured Media Showcase Banner ──────────────── */}
      {heroItem && (
        <HeroBanner
          item={heroItem}
          onPlay={handleOpenMedia}
          onViewFolder={(folderId) => navigate(`/explore?folder_id=${folderId}`)}
          onToggleFavorite={handleToggleFavorite}
        />
      )}

      {/* ── CONTINUE WATCHING (Hidden if no watch history exists) ───────────── */}
      {continueWatching.length > 0 && (
        <MediaRow
          title="Continue Watching"
          subtitle="Resume playback where you left off"
          items={continueWatching}
          onItemClick={handleOpenMedia}
          onToggleFavorite={handleToggleFavorite}
          showProgress={true}
        />
      )}

      {/* ── RECENTLY ADDED ─────────────────────────────────────────────────── */}
      <MediaRow
        title="Recently Added"
        subtitle="Latest additions to your library"
        moreLink="/explore"
        moreLabel="View All →"
        items={recentlyAdded}
        onItemClick={handleOpenMedia}
        onToggleFavorite={handleToggleFavorite}
      />

      {/* ── RANDOM PICKS ───────────────────────────────────────────────────── */}
      <MediaRow
        title="Random Picks"
        subtitle="Surprise picks & hidden gems from your library"
        items={randomPicks}
        onItemClick={handleOpenMedia}
        onToggleFavorite={handleToggleFavorite}
      />

      {/* ── DYNAMIC FOLDER SECTIONS (Categories from 1st-level folders) ─────── */}
      {folderSections.map((sec) => (
        <MediaRow
          key={sec.folder.id}
          title={sec.folder.display_name || sec.folder.name}
          subtitle={`${sec.total.toLocaleString()} item${sec.total === 1 ? '' : 's'}`}
          moreLink={`/folders/${sec.folder.id}`}
          moreLabel={`Explore ${sec.folder.display_name || sec.folder.name} (${sec.total}) →`}
          items={sec.items}
          onItemClick={handleOpenMedia}
          onToggleFavorite={handleToggleFavorite}
        />
      ))}

      {/* Empty State fallback if entire library has no items */}
      {!loading && recentlyAdded.length === 0 && (
        <div className="empty-state" style={{ minHeight: '50dvh' }}>
          <svg className="empty-state-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <polyline points="21 15 16 10 5 21" />
          </svg>
          <div className="empty-state-title">Your Media Library is Empty</div>
          <div className="empty-state-body">
            Configure your media roots in Settings and trigger a library scan to populate the Home page.
          </div>
          <button className="btn-primary" onClick={() => navigate('/settings')}>
            Go to Settings
          </button>
        </div>
      )}
    </div>
  )
}
