import type { ReactNode } from 'react'

export interface SectionHeaderProps {
  title: string
  subtitle?: string | ReactNode
  moreLink?: string
  moreLabel?: string
  onMoreClick?: () => void
  action?: ReactNode
  className?: string
}

/**
 * Reusable SectionHeader component across Home, Player, Explorer, and Folder pages.
 */
export function SectionHeader({
  title,
  subtitle,
  moreLink,
  moreLabel,
  onMoreClick,
  action,
  className = '',
}: SectionHeaderProps) {
  return (
    <div className={`section-header-component ${className}`}>
      <div className="section-header-title-group">
        <h2 className="section-header-title">{title}</h2>
        {subtitle && <span className="section-header-subtitle">{subtitle}</span>}
      </div>

      <div className="section-header-actions">
        {action}
        {(moreLink || onMoreClick) && (
          <button
            className="section-header-more-btn"
            type="button"
            onClick={onMoreClick}
          >
            {moreLabel || 'View All →'}
          </button>
        )}
      </div>
    </div>
  )
}
