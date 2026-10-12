import { useEffect, useState, type ReactNode } from 'react'
import {
  AudioLines, CheckCircle2, CircleAlert, Info, Library, ListMusic, Mic2, Minus, Moon, Music2, Pause, Play,
  Settings2, Square, Sun, Wrench, X, type LucideIcon,
} from 'lucide-react'
import type { PageId } from '../../shared/contracts'
import { studio } from '../api'
import appIcon from '../assets/app-icon.png'
import { fileName, formatDuration } from '../lib/format'
import { THEME_ART } from '../lib/theme-assets'
import { usePlayer } from '../state/player'
import { useJobs, useLive, useStudio } from '../state/studio'
import { Dot, IconButton } from '../ui'

interface NavItem { id: PageId; label: string; note: string; icon: LucideIcon }

const MAIN_NAV: NavItem[] = [
  { id: 'speak', label: '文字配音', note: 'GPT-SoVITS', icon: AudioLines },
  { id: 'cover', label: '翻唱换声', note: '分离 · 换声 · 混音', icon: Music2 },
  { id: 'live', label: '实时变声', note: '麦克风 · RVC', icon: Mic2 },
  { id: 'tools', label: '音频工具', note: 'NCM 批量转换', icon: Wrench },
  { id: 'library', label: '声音库', note: '角色与模型', icon: Library },
]

const PAGE_TITLE: Record<PageId, string> = {
  speak: '文字配音', cover: '翻唱换声', live: '实时变声', tools: '音频工具', library: '声音库', jobs: '任务与作品', settings: '设置',
}

function WindowControls() {
  const [maximized, setMaximized] = useState(false)
  useEffect(() => {
    void studio.window.isMaximized().then(setMaximized)
    return studio.window.onMaximized(setMaximized)
  }, [])
  return (
    <div className="window-controls app-no-drag">
      <button type="button" aria-label="最小化" onClick={() => void studio.window.minimize()}><Minus size={16} /></button>
      <button type="button" aria-label={maximized ? '还原' : '最大化'} onClick={() => void studio.window.toggleMaximize()}>
        {maximized ? <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.3"><rect x="1" y="3.5" width="8.5" height="8.5" rx="1.5" /><path d="M3.5 3.5V2.5A1.5 1.5 0 0 1 5 1h5.5A1.5 1.5 0 0 1 12 2.5V8a1.5 1.5 0 0 1-1.5 1.5h-1" /></svg>
          : <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.3"><rect x="1" y="1" width="10" height="10" rx="1.8" /></svg>}
      </button>
      <button type="button" aria-label="关闭" className="window-controls__close" onClick={() => void studio.window.close()}><X size={16} /></button>
    </div>
  )
}

function TitleBar() {
  const { page, service, goto } = useStudio()
  const live = useLive()
  const liveActive = ['starting', 'running', 'stopping'].includes(live.state)
  const serviceTone = service.state === 'ready' ? 'ok' : service.state === 'starting' ? 'warn' : service.state === 'error' ? 'danger' : undefined
  return (
    <header className="titlebar app-drag">
      <div className="titlebar__brand">
        <img src={appIcon} alt="" className="titlebar__icon" />
        <span className="titlebar__name">睦音工坊</span>
        <span className="titlebar__sep">/</span>
        <span className="titlebar__page">{PAGE_TITLE[page]}</span>
      </div>
      <div className="titlebar__status app-no-drag">
        {liveActive && (
          <button type="button" className="live-pill" onClick={() => void studio.realtime.stop()} title="停止实时变声">
            <Dot tone="danger" pulse />实时变声中<Square size={11} fill="currentColor" />
          </button>
        )}
        <button type="button" className="service-chip" onClick={() => goto('settings')} title={service.detail}>
          <Dot tone={serviceTone} pulse={service.state === 'starting'} />
          GPT-SoVITS {service.state === 'ready' ? '已就绪' : service.state === 'starting' ? '启动中' : service.state === 'error' ? '异常' : '未启动'}
        </button>
      </div>
      <WindowControls />
    </header>
  )
}

function Sidebar() {
  const { page, goto, prefs, updatePrefs } = useStudio()
  const jobs = useJobs()
  const art = THEME_ART[prefs.theme]
  const activeJobs = jobs.filter((job) => job.status === 'running' || job.status === 'queued').length
  const item = ({ id, label, note, icon: Icon }: NavItem, extra?: ReactNode) => (
    <button type="button" key={id} className={`nav-item${page === id ? ' is-current' : ''}`} aria-current={page === id ? 'page' : undefined} onClick={() => goto(id)}>
      <span className="nav-item__icon"><Icon size={18} strokeWidth={2} /></span>
      <span className="nav-item__text"><strong>{label}</strong><small>{note}</small></span>
      {extra}
    </button>
  )
  return (
    <aside className="sidebar">
      <div className="mascot">
        <img className="mascot__portrait" src={art.portrait} alt={art.name} />
        <div className="mascot__text">
          <strong>睦音工坊</strong>
          <small>{art.motto}</small>
        </div>
      </div>

      <nav className="nav" aria-label="工作台">
        <div className="nav__heading">创作</div>
        {MAIN_NAV.map((entry) => item(entry))}
        <div className="nav__heading">管理</div>
        {item({ id: 'jobs', label: '任务与作品', note: '进度与生成的音频', icon: ListMusic }, activeJobs > 0 && <span className="nav-item__count">{activeJobs}</span>)}
        {item({ id: 'settings', label: '设置', note: '引擎路径与服务', icon: Settings2 })}
      </nav>

      <div className="theme-switch" role="group" aria-label="主题">
        <button type="button" className={prefs.theme === 'light' ? 'is-active' : ''} aria-pressed={prefs.theme === 'light'} onClick={() => updatePrefs({ theme: 'light' })}><Sun size={15} />若叶睦</button>
        <button type="button" className={prefs.theme === 'dark' ? 'is-active' : ''} aria-pressed={prefs.theme === 'dark'} onClick={() => updatePrefs({ theme: 'dark' })}><Moon size={15} />Mortis</button>
      </div>
    </aside>
  )
}

function PlayerBar() {
  const player = usePlayer()
  if (!player.path) return null
  const progress = player.duration ? (player.currentTime / player.duration) * 100 : 0
  return (
    <div className="player-bar" role="region" aria-label="试听">
      <IconButton icon={player.playing ? Pause : Play} label={player.playing ? '暂停' : '播放'} tone="accent" onClick={() => player.toggle(player.path)} />
      <div className="player-bar__main">
        <div className="player-bar__name truncate" title={player.path}>{player.error || fileName(player.path)}</div>
        <div className="player-bar__track" onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect()
          if (player.duration) player.seek(((event.clientX - rect.left) / rect.width) * player.duration)
        }}>
          <div className="player-bar__fill" style={{ width: `${progress}%` }} />
        </div>
      </div>
      <span className="player-bar__time">{formatDuration(player.currentTime)} / {formatDuration(player.duration)}</span>
      <IconButton icon={X} label="关闭试听" onClick={player.stop} />
    </div>
  )
}

function Toasts() {
  const { toasts, dismissToast } = useStudio()
  const icon = { ok: CheckCircle2, error: CircleAlert, info: Info }
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((toast) => {
        const Icon = icon[toast.tone]
        return (
          <div key={toast.id} className={`toast toast--${toast.tone}`} onClick={() => dismissToast(toast.id)}>
            <Icon size={17} /><div className="toast__body">{toast.message}</div>
          </div>
        )
      })}
    </div>
  )
}

export function Shell({ pages }: { pages: Record<PageId, ReactNode> }) {
  const { page, prefs } = useStudio()
  const art = THEME_ART[prefs.theme]
  return (
    <div className="app">
      <TitleBar />
      <div className="app__body">
        <Sidebar />
        <main className="main">
          <div className="main__backdrop" style={{ backgroundImage: `var(--bg-image-veil), url(${art.background})` }} aria-hidden="true" />
          {(Object.keys(pages) as PageId[]).map((id) => (
            <div key={id} className="main__page" hidden={page !== id}>{pages[id]}</div>
          ))}
          <PlayerBar />
        </main>
      </div>
      <Toasts />
    </div>
  )
}

export function PageHeader({ title, description, actions }: { title: string; description: string; actions?: ReactNode }) {
  return (
    <header className="page-header">
      <div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {actions && <div className="page-header__actions">{actions}</div>}
    </header>
  )
}
