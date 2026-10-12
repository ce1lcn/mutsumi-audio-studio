import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type {
  AppInfo, DeepPartial, EngineSettings, GptSovitsStatus, Job, PageId, Preferences, RealtimeStatus,
  RvcCatalog, StudioSettings, VoiceProfile,
} from '../../shared/contracts'
import { studio } from '../api'

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function mergeDeep<T>(base: T, patch: DeepPartial<T> | Record<string, unknown>): T {
  if (!isPlainObject(base) || !isPlainObject(patch)) return (patch as T) ?? base
  const result: Record<string, unknown> = { ...base }
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue
    result[key] = isPlainObject(value) && isPlainObject(result[key]) ? mergeDeep(result[key], value) : value
  }
  return result as T
}

export function errorText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  // ipcRenderer.invoke 会在错误前加上通道前缀
  return message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

const LEGACY_KEYS = [
  'tts_characters', 'tts_character', 'tts_lang', 'tts_save_path', 'smartchat-rvc-workbench',
  'ncm_batch_source', 'ncm_batch_output', 'mutsumi-audio-studio',
]

// ---------------------------------------------------------------------------
// 提示
// ---------------------------------------------------------------------------

export type ToastTone = 'ok' | 'error' | 'info'
export interface Toast { id: number; tone: ToastTone; message: string }

// ---------------------------------------------------------------------------
// 主上下文
// ---------------------------------------------------------------------------

interface StudioContextValue {
  info: AppInfo
  engines: EngineSettings
  prefs: Preferences
  updatePrefs(patch: DeepPartial<Preferences>): void
  updateEngines(patch: DeepPartial<EngineSettings>): Promise<void>
  voices: VoiceProfile[]
  setVoices(voices: VoiceProfile[]): void
  catalog: RvcCatalog | null
  rescanCatalog(): Promise<RvcCatalog | null>
  service: GptSovitsStatus
  page: PageId
  goto(page: PageId): void
  coverSource: { path: string; nonce: number }
  sendToCover(path: string): void
  toasts: Toast[]
  notify(message: string, tone?: ToastTone): void
  dismissToast(id: number): void
}

const StudioContext = createContext<StudioContextValue | null>(null)
const JobsContext = createContext<Job[]>([])
const LiveContext = createContext<RealtimeStatus>({ sessionId: null, state: 'stopped', overflowCount: 0, inputLevel: 0, outputLevel: 0 })

export function useStudio(): StudioContextValue {
  const value = useContext(StudioContext)
  if (!value) throw new Error('useStudio 必须在 StudioProvider 内使用')
  return value
}

export const useJobs = () => useContext(JobsContext)
export const useLive = () => useContext(LiveContext)

interface Boot {
  info: AppInfo
  settings: StudioSettings
  voices: VoiceProfile[]
  jobs: Job[]
  service: GptSovitsStatus
  live: RealtimeStatus
}

async function boot(): Promise<Boot> {
  // 一次性迁移 2.x 界面保存在 localStorage 中的偏好
  const legacy: Record<string, string | null> = {}
  try { for (const key of LEGACY_KEYS) legacy[key] = localStorage.getItem(key) } catch { /* 忽略 */ }
  await studio.settings.importLegacy(legacy).catch(() => undefined)
  const [info, settings, voices, jobs, live] = await Promise.all([
    studio.app.info(), studio.settings.get(), studio.voices.list(), studio.jobs.list(), studio.realtime.status(),
  ])
  const service = await studio.service.status().catch(() => ({ state: 'unknown', managed: false, detail: '', logPath: '' } as GptSovitsStatus))
  return { info, settings, voices, jobs, service, live }
}

export function StudioProvider({ children, fallback }: { children: ReactNode; fallback: ReactNode }) {
  const [state, setState] = useState<Boot | null>(null)
  const [failure, setFailure] = useState('')
  useEffect(() => {
    boot().then(setState).catch((error) => setFailure(errorText(error)))
  }, [])
  if (failure) return <div className="boot-failure">启动失败：{failure}</div>
  if (!state) return <>{fallback}</>
  return <LoadedProvider boot={state}>{children}</LoadedProvider>
}

function LoadedProvider({ boot: initial, children }: { boot: Boot; children: ReactNode }) {
  const [engines, setEngines] = useState(initial.settings.engines)
  const [prefs, setPrefs] = useState(initial.settings.prefs)
  const [voices, setVoices] = useState(initial.voices)
  const [jobs, setJobs] = useState(initial.jobs)
  const [service, setService] = useState(initial.service)
  const [live, setLive] = useState(initial.live)
  const [catalog, setCatalog] = useState<RvcCatalog | null>(null)
  const [page, setPage] = useState<PageId>(initial.settings.prefs.lastPage)
  const [coverSource, setCoverSource] = useState({ path: '', nonce: 0 })
  const [toasts, setToasts] = useState<Toast[]>([])
  const pendingPrefs = useRef<Record<string, unknown>>({})
  const prefsTimer = useRef<number | null>(null)
  const toastId = useRef(0)

  const notify = useCallback((message: string, tone: ToastTone = 'info') => {
    const id = ++toastId.current
    setToasts((list) => [...list.slice(-3), { id, tone, message }])
    window.setTimeout(() => setToasts((list) => list.filter((toast) => toast.id !== id)), tone === 'error' ? 7000 : 4200)
  }, [])
  const dismissToast = useCallback((id: number) => setToasts((list) => list.filter((toast) => toast.id !== id)), [])

  const updatePrefs = useCallback((patch: DeepPartial<Preferences>) => {
    setPrefs((current) => mergeDeep(current, patch))
    pendingPrefs.current = mergeDeep(pendingPrefs.current, patch as Record<string, unknown>)
    if (prefsTimer.current) window.clearTimeout(prefsTimer.current)
    prefsTimer.current = window.setTimeout(() => {
      const payload = pendingPrefs.current
      pendingPrefs.current = {}
      prefsTimer.current = null
      studio.settings.updatePrefs(payload as DeepPartial<Preferences>).catch((error) => notify(errorText(error), 'error'))
    }, 300)
  }, [notify])

  const rescanCatalog = useCallback(async () => {
    try {
      const next = await studio.catalog.scanRvc()
      setCatalog(next)
      return next
    } catch (error) {
      notify(errorText(error), 'error')
      return null
    }
  }, [notify])

  const updateEngines = useCallback(async (patch: DeepPartial<EngineSettings>) => {
    const next = await studio.settings.updateEngines(patch)
    setEngines(next.engines)
    void rescanCatalog()
  }, [rescanCatalog])

  const goto = useCallback((next: PageId) => {
    setPage(next)
    updatePrefs({ lastPage: next })
  }, [updatePrefs])

  const sendToCover = useCallback((path: string) => {
    setCoverSource((current) => ({ path, nonce: current.nonce + 1 }))
    goto('cover')
  }, [goto])

  useEffect(() => {
    void rescanCatalog()
    const offs = [
      studio.jobs.onUpdated((job) => setJobs((list) => {
        const index = list.findIndex((item) => item.id === job.id)
        if (index < 0) return [job, ...list]
        const next = list.slice()
        next[index] = job
        return next
      })),
      studio.jobs.onRemoved((ids) => setJobs((list) => list.filter((job) => !ids.includes(job.id)))),
      studio.service.onStatus(setService),
      studio.realtime.onStatus(setLive),
      studio.settings.onChanged((settings) => setEngines(settings.engines)),
    ]
    return () => offs.forEach((off) => off())
  }, [rescanCatalog])

  useEffect(() => {
    document.documentElement.dataset.theme = prefs.theme
    try { localStorage.setItem('mutsumi-theme', prefs.theme) } catch { /* 忽略 */ }
  }, [prefs.theme])

  const value = useMemo<StudioContextValue>(() => ({
    info: initial.info, engines, prefs, updatePrefs, updateEngines, voices, setVoices, catalog, rescanCatalog,
    service, page, goto, coverSource, sendToCover, toasts, notify, dismissToast,
  }), [initial.info, engines, prefs, updatePrefs, updateEngines, voices, catalog, rescanCatalog, service, page, goto, coverSource, sendToCover, toasts, notify, dismissToast])

  return (
    <StudioContext.Provider value={value}>
      <JobsContext.Provider value={jobs}>
        <LiveContext.Provider value={live}>{children}</LiveContext.Provider>
      </JobsContext.Provider>
    </StudioContext.Provider>
  )
}
