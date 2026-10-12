import appIcon from './assets/app-icon.png'
import { CoverPage } from './pages/CoverPage'
import { JobsPage } from './pages/JobsPage'
import { LibraryPage } from './pages/LibraryPage'
import { LivePage } from './pages/LivePage'
import { SettingsPage } from './pages/SettingsPage'
import { SpeakPage } from './pages/SpeakPage'
import { ToolsPage } from './pages/ToolsPage'
import { Shell } from './shell/Shell'
import { PlayerProvider } from './state/player'
import { StudioProvider } from './state/studio'

const pages = {
  speak: <SpeakPage />,
  cover: <CoverPage />,
  live: <LivePage />,
  tools: <ToolsPage />,
  library: <LibraryPage />,
  jobs: <JobsPage />,
  settings: <SettingsPage />,
}

export default function App() {
  return (
    <StudioProvider fallback={<div className="boot-screen"><img src={appIcon} alt="睦音工坊" /></div>}>
      <PlayerProvider>
        <Shell pages={pages} />
      </PlayerProvider>
    </StudioProvider>
  )
}
