import { randomUUID } from 'crypto'
import { existsSync } from 'fs'
import { mkdir, open, readFile, rename, rm } from 'fs/promises'
import { join } from 'path'
import {
  DEFAULT_PREFERENCES,
  type ArtifactRole,
  type EngineSettings,
  type Job,
  type JobKind,
  type JobStatus,
  type PageId,
  type Preferences,
  type VoiceProfile,
} from '../../shared/contracts'
import { BUILTIN_VOICES } from './builtin-voices'
import { detectEngines, normalizeEngines, normalizePrefs, normalizeRvcParams, normalizeVoice } from './settings'
import { isRecord, pathList, stringOr } from './validate'

export interface StudioState {
  schemaVersion: 3
  engines: EngineSettings
  prefs: Preferences
  voices: VoiceProfile[]
  jobs: Job[]
  /** 旧版界面 localStorage 是否已迁移 */
  legacyLocalImported: boolean
}

const STATE_FILE = 'studio-state-v3.json'
const LEGACY_STATE_FILE = 'studio-state.json'
export const MAX_JOB_HISTORY = 300

/**
 * 应用状态的唯一持有者。主进程是唯一写入方，因此状态常驻内存，
 * 修改后合并写盘（临时文件 + 原子重命名）。
 */
export class StateStore {
  private writeChain: Promise<void> = Promise.resolve()
  private timer: NodeJS.Timeout | null = null

  private constructor(private readonly filePath: string, private current: StudioState) {}

  static async open(directory: string): Promise<StateStore> {
    const filePath = join(directory, STATE_FILE)
    let state: StudioState | null = null
    try {
      state = parseState(JSON.parse(await readFile(filePath, 'utf8')))
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ENOENT') {
        // 文件损坏时保留原件，避免覆盖用户数据
        await rename(filePath, `${filePath}.corrupt-${Date.now()}`).catch(() => undefined)
      }
    }
    if (!state) state = await migrateFromLegacy(join(directory, LEGACY_STATE_FILE))
    const store = new StateStore(filePath, state)
    await store.flush()
    return store
  }

  get state(): Readonly<StudioState> {
    return this.current
  }

  /** 修改状态；immediate 为 true 时立即写盘，否则 400ms 内合并写入 */
  mutate(change: (state: StudioState) => void, immediate = false): void {
    change(this.current)
    if (immediate) void this.flush()
    else if (!this.timer) this.timer = setTimeout(() => void this.flush(), 400)
  }

  flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    const snapshot = `${JSON.stringify(this.current, null, 2)}\n`
    this.writeChain = this.writeChain.then(() => writeAtomic(this.filePath, snapshot)).catch((error) => {
      console.error('[Store] 状态写入失败：', error)
    })
    return this.writeChain
  }
}

async function writeAtomic(filePath: string, content: string): Promise<void> {
  await mkdir(join(filePath, '..'), { recursive: true })
  const temporary = `${filePath}.${randomUUID()}.tmp`
  const handle = await open(temporary, 'wx')
  try {
    await handle.writeFile(content, 'utf8')
    await handle.sync()
  } finally {
    await handle.close()
  }
  try {
    await rename(temporary, filePath)
  } catch (error) {
    await rm(temporary, { force: true })
    throw error
  }
}

function parseState(raw: unknown): StudioState | null {
  if (!isRecord(raw) || raw.schemaVersion !== 3) return null
  const engines = normalizeEngines(raw.engines, detectEngines())
  const voices = Array.isArray(raw.voices) ? raw.voices.map(normalizeVoice).filter((item): item is VoiceProfile => Boolean(item)) : []
  return {
    schemaVersion: 3,
    engines,
    prefs: normalizePrefs(raw.prefs, DEFAULT_PREFERENCES),
    voices,
    jobs: Array.isArray(raw.jobs) ? raw.jobs.filter(isJobShape).slice(0, MAX_JOB_HISTORY) : [],
    legacyLocalImported: raw.legacyLocalImported === true,
  }
}

function isJobShape(value: unknown): value is Job {
  return isRecord(value) && typeof value.id === 'string' && typeof value.kind === 'string' &&
    typeof value.status === 'string' && typeof value.createdAt === 'string' && Array.isArray(value.artifacts)
}

// ---------------------------------------------------------------------------
// 从 2.x 迁移
// ---------------------------------------------------------------------------

function freshState(): StudioState {
  return {
    schemaVersion: 3,
    engines: detectEngines(),
    prefs: structuredClone(DEFAULT_PREFERENCES),
    voices: structuredClone(BUILTIN_VOICES),
    jobs: [],
    legacyLocalImported: false,
  }
}

const LEGACY_PAGE: Record<string, PageId> = {
  tts: 'speak', rvc: 'cover', live: 'live', ncm: 'tools', library: 'library', tasks: 'jobs', settings: 'settings',
}

async function migrateFromLegacy(legacyPath: string): Promise<StudioState> {
  const state = freshState()
  if (!existsSync(legacyPath)) return state
  try {
    const legacy = JSON.parse(await readFile(legacyPath, 'utf8')) as Record<string, unknown>
    const settings = isRecord(legacy.settings) ? legacy.settings : {}
    const gpt = isRecord(settings.gptSovits) ? settings.gptSovits : {}
    const rvc = isRecord(settings.rvc) ? settings.rvc : {}
    const detected = state.engines
    state.engines = normalizeEngines({
      gptSovits: {
        rootPath: gpt.rootPath || detected.gptSovits.rootPath,
        pythonPath: gpt.pythonPath || detected.gptSovits.pythonPath,
        apiBaseUrl: gpt.apiBaseUrl,
        autoStart: gpt.startManagedServer,
      },
      rvc: {
        rootPath: rvc.rootPath || detected.rvc.rootPath,
        pythonPath: rvc.pythonPath || detected.rvc.pythonPath,
        ffmpegPath: rvc.ffmpegPath,
        modelDirs: rvc.modelDirs,
        indexDirs: rvc.indexDirs,
      },
      outputDir: settings.outputDirectory,
    }, detected)
    state.prefs.theme = settings.theme === 'dark' ? 'dark' : 'light'
    if (typeof settings.lastPage === 'string' && LEGACY_PAGE[settings.lastPage]) state.prefs.lastPage = LEGACY_PAGE[settings.lastPage]
    if (isRecord(legacy.legacyPreferences)) applyLegacyPreferences(state, legacy.legacyPreferences)
    if (Array.isArray(legacy.tasks)) state.jobs = legacy.tasks.map(convertLegacyTask).filter((job): job is Job => Boolean(job)).slice(0, MAX_JOB_HISTORY)
  } catch (error) {
    console.error('[Store] 旧版状态迁移失败，已使用默认设置：', error)
  }
  return state
}

/** 旧版 localStorage 偏好（2.x 界面存储）合并进新状态 */
export function applyLegacyPreferences(state: StudioState, values: Record<string, unknown>): void {
  const text = (key: string) => (typeof values[key] === 'string' ? values[key] as string : '')
  const json = (key: string): unknown => {
    try { return text(key) ? JSON.parse(text(key)) : undefined } catch { return undefined }
  }

  const characters = json('tts_characters')
  if (Array.isArray(characters) && characters.length > 0) {
    const voices = characters.map((item) => isRecord(item) ? normalizeVoice({
      id: item.id, name: item.name, group: item.groupLabel, gptModel: item.gpt_model, sovitsModel: item.sovits_model,
      refAudio: item.ref_audio, refText: item.ref_text, refLang: item.ref_lang,
    }) : null).filter((item): item is VoiceProfile => Boolean(item))
    if (voices.length) state.voices = voices
  }
  if (text('tts_character')) state.prefs.speak.voiceId = text('tts_character')
  if (['zh', 'ja', 'en'].includes(text('tts_lang'))) state.prefs.speak.textLang = text('tts_lang') as 'zh' | 'ja' | 'en'
  if (text('tts_save_path')) state.prefs.speak.outputDir = text('tts_save_path')
  if (text('ncm_batch_source')) state.prefs.tools.ncmSourceDir = text('ncm_batch_source')
  if (text('ncm_batch_output')) state.prefs.tools.ncmOutputDir = text('ncm_batch_output')

  const workbench = json('smartchat-rvc-workbench')
  if (isRecord(workbench)) {
    const cover = state.prefs.cover
    cover.outputDir = stringOr(workbench.outputDir, cover.outputDir)
    cover.modelPath = stringOr(workbench.modelPath, cover.modelPath)
    cover.indexPath = stringOr(workbench.indexPath, cover.indexPath)
    cover.uvrModel = stringOr(workbench.uvrModel, cover.uvrModel, 260)
    cover.params = normalizeRvcParams(workbench.params, cover.params)
    state.engines.rvc.modelDirs = [...new Set([...state.engines.rvc.modelDirs, ...pathList(workbench.extraModelDirs, [])])]
    state.engines.rvc.indexDirs = [...new Set([...state.engines.rvc.indexDirs, ...pathList(workbench.extraIndexDirs, [])])]
  }
  const shell = json('mutsumi-audio-studio')
  if (isRecord(shell) && (shell.theme === 'dark' || shell.theme === 'light')) state.prefs.theme = shell.theme
}

const LEGACY_KIND: Record<string, JobKind> = {
  tts: 'tts', 'rvc-full': 'rvc-full', 'extract-vocal': 'rvc-separate', 'extract-instrument': 'rvc-separate',
  'rvc-convert': 'rvc-convert', mix: 'rvc-mix', 'ncm-convert': 'ncm', realtime: 'live',
}
const LEGACY_ROLE: Record<string, ArtifactRole> = {
  tts: 'speech', vocal: 'vocal', instrument: 'instrument', 'converted-vocal': 'converted', mixed: 'mixed',
  'converted-file': 'decoded', 'realtime-recording': 'recording',
}

function convertLegacyTask(raw: unknown): Job | null {
  if (!isRecord(raw) || typeof raw.id !== 'string' || !isRecord(raw.spec)) return null
  const kind = LEGACY_KIND[String(raw.spec.kind)]
  if (!kind) return null
  const status = (['succeeded', 'failed', 'cancelled'].includes(String(raw.status)) ? raw.status : 'interrupted') as JobStatus
  const error = isRecord(raw.error) && typeof raw.error.message === 'string' ? raw.error.message : undefined
  const artifacts = Array.isArray(raw.artifacts) ? raw.artifacts.filter(isRecord).map((item) => ({
    role: LEGACY_ROLE[String(item.role)] || 'decoded',
    path: String(item.path || ''),
    bytes: Number(item.bytes) || 0,
  })).filter((item) => item.path) : []
  const title = kind === 'tts' ? `文字配音 · ${String(raw.spec.characterName || '')}` : kind === 'live' ? '实时变声' : kind === 'ncm' ? 'NCM 转换' : '翻唱换声'
  return {
    id: raw.id,
    kind,
    title,
    status,
    stage: typeof raw.stage === 'string' ? raw.stage : '',
    progress: status === 'succeeded' ? 100 : Number(raw.progress) || 0,
    createdAt: String(raw.createdAt || new Date().toISOString()),
    finishedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : undefined,
    artifacts,
    logs: Array.isArray(raw.logs) ? raw.logs.filter((line): line is string => typeof line === 'string').slice(-50) : [],
    error,
  }
}
