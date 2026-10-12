import type {
  AppInfo,
  DeepPartial,
  EngineSettings,
  GptSovitsStatus,
  Job,
  JobRequest,
  NcmFileInfo,
  Preferences,
  RealtimeAudioDevice,
  RealtimeStartOptions,
  RealtimeStatus,
  RvcCatalog,
  StudioSettings,
  VoiceFileCheck,
  VoiceProfile,
} from './contracts'

/** 所有 invoke 通道 */
export const IPC = {
  appInfo: 'app:info',
  windowMinimize: 'window:minimize',
  windowToggleMaximize: 'window:toggle-maximize',
  windowClose: 'window:close',
  windowIsMaximized: 'window:is-maximized',
  pickFolder: 'dialog:pick-folder',
  pickFiles: 'dialog:pick-files',
  reveal: 'shell:reveal',
  openPath: 'shell:open-path',
  settingsGet: 'settings:get',
  settingsUpdateEngines: 'settings:update-engines',
  settingsUpdatePrefs: 'settings:update-prefs',
  settingsImportLegacy: 'settings:import-legacy',
  voicesList: 'voices:list',
  voicesSave: 'voices:save',
  voicesRemove: 'voices:remove',
  voicesCheck: 'voices:check',
  catalogScan: 'catalog:scan-rvc',
  ncmScan: 'ncm:scan',
  serviceStatus: 'gpt-sovits:status',
  serviceStart: 'gpt-sovits:start',
  serviceStop: 'gpt-sovits:stop',
  jobsList: 'jobs:list',
  jobsEnqueue: 'jobs:enqueue',
  jobsCancel: 'jobs:cancel',
  jobsRemove: 'jobs:remove',
  jobsClearFinished: 'jobs:clear-finished',
  realtimeStatus: 'realtime:status',
  realtimeDevices: 'realtime:devices',
  realtimeStart: 'realtime:start',
  realtimeStop: 'realtime:stop',
  realtimeUpdate: 'realtime:update',
} as const

/** 主进程主动推送的事件通道 */
export const EVENTS = {
  windowMaximized: 'event:window-maximized',
  settingsChanged: 'event:settings-changed',
  jobUpdated: 'event:job-updated',
  jobRemoved: 'event:job-removed',
  serviceStatus: 'event:service-status',
  realtimeStatus: 'event:realtime-status',
  realtimeLog: 'event:realtime-log',
  navigate: 'event:navigate',
} as const

export type FilePickKind = 'audio' | 'ncm' | 'python' | 'ffmpeg' | 'gpt' | 'sovits'

export const MEDIA_SCHEME = 'studio-media'

/** 旧版 localStorage 中与音频相关的偏好（仅用于一次性迁移） */
export type LegacyLocalPreferences = Record<string, string | null>

type Unsubscribe = () => void

export interface StudioApi {
  app: { info(): Promise<AppInfo> }
  window: {
    minimize(): Promise<void>
    toggleMaximize(): Promise<boolean>
    close(): Promise<void>
    isMaximized(): Promise<boolean>
    onMaximized(callback: (maximized: boolean) => void): Unsubscribe
  }
  dialog: {
    pickFolder(defaultPath?: string): Promise<string | null>
    pickFiles(kind: FilePickKind, multiple?: boolean): Promise<string[]>
  }
  shell: {
    reveal(path: string): Promise<void>
    openPath(path: string): Promise<void>
  }
  settings: {
    get(): Promise<StudioSettings>
    updateEngines(patch: DeepPartial<EngineSettings>): Promise<StudioSettings>
    updatePrefs(patch: DeepPartial<Preferences>): Promise<StudioSettings>
    importLegacy(values: LegacyLocalPreferences): Promise<{ imported: boolean }>
    onChanged(callback: (settings: StudioSettings) => void): Unsubscribe
  }
  voices: {
    list(): Promise<VoiceProfile[]>
    save(voice: VoiceProfile): Promise<VoiceProfile[]>
    remove(id: string): Promise<VoiceProfile[]>
    check(): Promise<Record<string, VoiceFileCheck>>
  }
  catalog: { scanRvc(): Promise<RvcCatalog> }
  ncm: { scan(directory: string): Promise<NcmFileInfo[]> }
  service: {
    status(): Promise<GptSovitsStatus>
    start(): Promise<GptSovitsStatus>
    stop(): Promise<GptSovitsStatus>
    onStatus(callback: (status: GptSovitsStatus) => void): Unsubscribe
  }
  jobs: {
    list(): Promise<Job[]>
    enqueue(request: JobRequest): Promise<Job>
    cancel(id: string): Promise<void>
    remove(id: string): Promise<void>
    clearFinished(): Promise<void>
    onUpdated(callback: (job: Job) => void): Unsubscribe
    onRemoved(callback: (ids: string[]) => void): Unsubscribe
  }
  realtime: {
    status(): Promise<RealtimeStatus>
    devices(): Promise<RealtimeAudioDevice[]>
    start(options: RealtimeStartOptions): Promise<RealtimeStatus>
    stop(): Promise<void>
    update(controls: { pitch?: number; outputGain?: number }): Promise<void>
    onStatus(callback: (status: RealtimeStatus) => void): Unsubscribe
    onLog(callback: (line: string) => void): Unsubscribe
  }
  media: {
    url(path: string): string
    /** 拖放进来的文件对应的本地路径 */
    pathForFile(file: File): string
  }
  onNavigate(callback: (page: string) => void): Unsubscribe
}
