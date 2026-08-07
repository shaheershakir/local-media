import type { Folder, MediaItem } from '../api/types'
import { VideoCard } from './VideoCard'
import { SectionHeader } from './SectionHeader'

export interface FolderRowProps {
  folder?: Folder | null
  items: MediaItem[]
  onItemClick: (item: MediaItem) => void
  onExploreFolder?: () => void
}

/**
 * Reusable FolderRow component for displaying sibling items from the same folder.
 */
export function FolderRow({
  folder,
  items,
  onItemClick,
  onExploreFolder,
}: FolderRowProps) {
  if (items.length === 0) return null

  const folderTitle = folder?.display_name || folder?.name || 'this folder'
  const countLabel = `${items.length} related item${items.length === 1 ? '' : 's'}`

  return (
    <section className="player-same-folder-section">
      <SectionHeader
        title={`Other videos in ${folderTitle}`}
        subtitle={countLabel}
        moreLabel="View All Folder Media →"
        onMoreClick={onExploreFolder}
      />

      <div className="player-folder-grid">
        {items.map((video) => (
          <VideoCard
            key={video.id}
            item={video}
            layout="grid"
            showFolderTag={false}
            onItemClick={onItemClick}
          />
        ))}
      </div>
    </section>
  )
}
