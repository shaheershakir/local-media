import { HashRouter, Routes, Route } from 'react-router-dom'
import { BottomNav } from './components/BottomNav'
import { ScanProgress } from './components/ScanProgress'
import { ReelsFeed } from './components/ReelsFeed'
import { GridFeed } from './components/GridFeed'
import { FolderProfile } from './components/FolderProfile'
import { FoldersPage } from './pages/FoldersPage'
import { SearchPage } from './pages/SearchPage'
import { MediaViewer } from './components/MediaViewer'
import { MpvFloatingControl } from './components/MpvFloatingControl'
import { AudioPreferenceProvider } from './contexts/AudioPreferenceProvider'
import './index.css'

// Favorites page — reuses GridFeed with favoritesOnly filter
function FavoritesPage() {
  return (
    <div className="page-enter">
      <div className="section-header">
        <h1 className="section-title">Saved</h1>
        <span className="section-count">Your favorites</span>
      </div>
      <GridFeed favoritesOnly />
    </div>
  )
}

// Explore page
function ExplorePage() {
  return (
    <div className="page-enter">
      <div className="section-header">
        <h1 className="section-title">Explore</h1>
      </div>
      <GridFeed />
    </div>
  )
}

// Feed page wrapper — the main page
function FeedPage() {
  return <ReelsFeed />
}

export default function App() {
  return (
    <HashRouter>
      <AudioPreferenceProvider>
        <div className="app-shell">
          {/* Scan progress banner (visible across all pages when scan is running) */}
          <ScanProgress />

          {/* Page content */}
          <main className="page-content">
            <Routes>
              <Route path="/" element={<FeedPage />} />
              <Route path="/explore" element={<ExplorePage />} />
              <Route path="/folders" element={<FoldersPage />} />
              <Route path="/folders/:id" element={<FolderProfile />} />
              <Route path="/favorites" element={<FavoritesPage />} />
              <Route path="/search" element={<SearchPage />} />
              <Route path="/media/:id" element={<MediaViewer />} />
            </Routes>
          </main>

          {/* Floating MPV Playback Controller */}
          <MpvFloatingControl />

          {/* Bottom navigation */}
          <BottomNav />
        </div>
      </AudioPreferenceProvider>
    </HashRouter>
  )
}
