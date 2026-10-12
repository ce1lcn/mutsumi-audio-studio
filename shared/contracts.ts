// 睦音工坊 3.x 主进程与界面共享的数据契约。
// 所有跨进程数据都在这里定义，主进程负责校验，界面只做展示与收集输入。

export type ThemeMode = 'light' | 'dark'
export type PageId = 'speak' | 'cover' | 'live' | 'tools' | 'library' | 'jobs' | 'settings'
export type Lang = 'zh' | 'ja' | 'en'
export type SplitMethod = 'cut0' | 'cut1' | 'cut2' | 'cut3' | 'cut4' | 'cut5'
export type F0Method = 'rmvpe' | 'pm' | 'harvest' | 'crepe'
export type AudioFormat = 'wav' | 'flac' | 'mp3'
export type SampleSteps = 4 | 8 | 16 | 32
export type LivePreset = 'stable' | 'balanced' | 'low-latency'

export const PAGE_IDS: PageId[] = ['speak', 'cover', 'live', 'tools', 'library', 'jobs', 'settings']
export const LANGS: Lang[] = ['zh', 'ja', 'en']
export const SPLIT_METHODS: SplitMethod[] = ['cut0', 'cut1', 'cut2', 'cut3', 'cut4', 'cut5']
export const F0_METHODS: F0Method[] = ['rmvpe', 'pm', 'harvest', 'crepe']
export const AUDIO_FORMATS: AudioFormat[] = ['wav', 'flac', 'mp3']
export const SAMPLE_STEPS: SampleSteps[] = [4, 8, 16, 32]
export const LIVE_SAMPLE_RATES = [48000, 44100, 32000, 24000] as const
export const LIVE_PRESET_BLOCK_SECONDS: Record<LivePreset, number> = { stable: 0.25, balanced: 0.18, 'low-latency': 0.12 }

// ---------------------------------------------------------------------------
// 设置
// ---------------------------------------------------------------------------

export interface GptSovitsEngine {
  rootPath: string
  pythonPath: string
  apiBaseUrl: string
  /** 应用启动时若接口不可用，自动在后台启动 api_v2.py */
  autoStart: boolean
}

export interface RvcEngine {
  rootPath: string
  pythonPath: string
  /** 留空时自动在 RVC 环境、项目目录与 PATH 中查找 */
  ffmpegPath: string
  modelDirs: string[]
  indexDirs: string[]
}

export interface EngineSettings {
  gptSovits: GptSovitsEngine
  rvc: RvcEngine
  /** 默认输出目录；留空时使用 文档/睦音工坊 */
  outputDir: string
}

export interface RvcParams {
  speakerId: number
  pitch: number
  f0Method: F0Method
  indexRate: number
  filterRadius: number
  resampleRate: number
  volumeEnvelope: number
  protect: number
  uvrAggression: number
  outputFormat: AudioFormat
  backgroundVolume: number
  vocalVolume: number
}

export interface SpeakPrefs {
  voiceId: string
  textLang: Lang
  splitMethod: SplitMethod
  speed: number
  sampleSteps: SampleSteps
  fragmentInterval: number
  outputDir: string
}

export interface CoverPrefs {
  modelPath: string
  indexPath: string
  uvrModel: string
  outputDir: string
  params: RvcParams
}

export interface LivePrefs {
  inputDeviceId: string
  outputDeviceId: string
  modelPath: string
  indexPath: string
  indexRate: number
  sampleRate: number
  preset: LivePreset
  f0Method: F0Method
  pitch: number
  gain: number
  record: boolean
}

export interface ToolsPrefs {
  ncmSourceDir: string
  ncmOutputDir: string
}

export interface Preferences {
  theme: ThemeMode
  lastPage: PageId
  speak: SpeakPrefs
  cover: CoverPrefs
  live: LivePrefs
  tools: ToolsPrefs
}

export interface StudioSettings {
  engines: EngineSettings
  prefs: Preferences
}

export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? (T[K] extends unknown[] ? T[K] : DeepPartial<T[K]>) : T[K] }

export const DEFAULT_RVC_PARAMS: RvcParams = {
  speakerId: 0,
  pitch: 0,
  f0Method: 'rmvpe',
  indexRate: 0.75,
  filterRadius: 3,
  resampleRate: 0,
  volumeEnvelope: 0.25,
  protect: 0.33,
  uvrAggression: 10,
  outputFormat: 'wav',
  backgroundVolume: 0.7,
  vocalVolume: 1.2,
}

export const DEFAULT_PREFERENCES: Preferences = {
  theme: 'light',
  lastPage: 'speak',
  speak: { voiceId: '', textLang: 'zh', splitMethod: 'cut3', speed: 1, sampleSteps: 16, fragmentInterval: 0.3, outputDir: '' },
  cover: { modelPath: '', indexPath: '', uvrModel: 'HP5_only_main_vocal', outputDir: '', params: DEFAULT_RVC_PARAMS },
  live: {
    inputDeviceId: '', outputDeviceId: '', modelPath: '', indexPath: '', indexRate: 0.75,
    sampleRate: 48000, preset: 'stable', f0Method: 'rmvpe', pitch: 0, gain: 1, record: false,
  },
  tools: { ncmSourceDir: '', ncmOutputDir: '' },
}

// ---------------------------------------------------------------------------
// 声音档案（GPT-SoVITS 角色）
// ---------------------------------------------------------------------------

export interface VoiceProfile {
  id: string
  name: string
  group: string
  gptModel: string
  sovitsModel: string
  refAudio: string
  refText: string
  refLang: Lang
}

export interface VoiceFileCheck {
  gptModel: boolean
  sovitsModel: boolean
  refAudio: boolean
}

// ---------------------------------------------------------------------------
// RVC 目录
// ---------------------------------------------------------------------------

export interface CatalogFile {
  name: string
  path: string
}

export interface RvcCatalog {
  models: CatalogFile[]
  indices: CatalogFile[]
  uvrModels: CatalogFile[]
  /** 环境诊断：缺失的依赖或目录 */
  problems: string[]
}

export interface NcmFileInfo {
  name: string
  path: string
  size: number
  mtimeMs: number
}

// ---------------------------------------------------------------------------
// 任务
// ---------------------------------------------------------------------------

export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'interrupted'
export type ArtifactRole = 'speech' | 'vocal' | 'instrument' | 'converted' | 'mixed' | 'decoded' | 'recording'

export interface TtsRequest {
  kind: 'tts'
  voiceId: string
  voiceName: string
  gptModel: string
  sovitsModel: string
  refAudio: string
  refText: string
  refLang: Lang
  text: string
  textLang: Lang
  splitMethod: SplitMethod
  speed: number
  sampleSteps: SampleSteps
  fragmentInterval: number
  outputDir: string
}

export interface RvcFullRequest {
  kind: 'rvc-full'
  inputPath: string
  outputDir: string
  modelPath: string
  indexPath: string
  uvrModel: string
  params: RvcParams
}

export interface RvcSeparateRequest {
  kind: 'rvc-separate'
  inputPath: string
  outputDir: string
  uvrModel: string
  params: RvcParams
}

export interface RvcConvertRequest {
  kind: 'rvc-convert'
  inputPath: string
  outputDir: string
  modelPath: string
  indexPath: string
  params: RvcParams
}

export interface RvcMixRequest {
  kind: 'rvc-mix'
  vocalPath: string
  instrumentPath: string
  outputDir: string
  params: RvcParams
}

export interface NcmRequest {
  kind: 'ncm'
  inputPath: string
  outputDir: string
}

export type JobRequest = TtsRequest | RvcFullRequest | RvcSeparateRequest | RvcConvertRequest | RvcMixRequest | NcmRequest
export type JobKind = JobRequest['kind'] | 'live'

export interface JobArtifact {
  role: ArtifactRole
  path: string
  bytes: number
}

export interface Job {
  id: string
  kind: JobKind
  title: string
  status: JobStatus
  stage: string
  progress: number
  createdAt: string
  startedAt?: string
  finishedAt?: string
  request?: JobRequest
  artifacts: JobArtifact[]
  logs: string[]
  error?: string
}

export const ACTIVE_JOB_STATUSES: JobStatus[] = ['queued', 'running']

// ---------------------------------------------------------------------------
// GPT-SoVITS 服务
// ---------------------------------------------------------------------------

export type ServiceState = 'unknown' | 'ready' | 'starting' | 'stopped' | 'error'

export interface GptSovitsStatus {
  state: ServiceState
  /** 当前服务是否由本程序启动 */
  managed: boolean
  detail: string
  logPath: string
}

// ---------------------------------------------------------------------------
// 实时变声
// ---------------------------------------------------------------------------

export interface RealtimeAudioDevice {
  id: string
  name: string
  hostApi: string
  inputChannels: number
  outputChannels: number
  defaultSampleRate: number
  isDefaultInput?: boolean
  isDefaultOutput?: boolean
}

export type RealtimeState = 'stopped' | 'starting' | 'running' | 'stopping' | 'failed'

export interface RealtimeStatus {
  sessionId: string | null
  state: RealtimeState
  startedAt?: string
  blockDurationMs?: number
  inferenceMs?: number
  overflowCount: number
  inputLevel: number
  outputLevel: number
  message?: string
  recordingPath?: string
}

export interface RealtimeStartOptions {
  inputDeviceId: string
  outputDeviceId: string
  modelPath: string
  indexPath: string
  indexRate: number
  sampleRate: number
  blockSeconds: number
  pitch: number
  f0Method: F0Method
  outputGain: number
  record: boolean
}

export interface AppInfo {
  version: string
  defaultOutputDir: string
  userDataDir: string
}
