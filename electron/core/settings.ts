import { existsSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import {
  AUDIO_FORMATS,
  DEFAULT_PREFERENCES,
  DEFAULT_RVC_PARAMS,
  F0_METHODS,
  LANGS,
  LIVE_SAMPLE_RATES,
  PAGE_IDS,
  SAMPLE_STEPS,
  SPLIT_METHODS,
  type EngineSettings,
  type LivePreset,
  type Preferences,
  type RvcParams,
  type VoiceProfile,
} from '../../shared/contracts'
import {
  boolOr, clampInteger, clampNumber, isLoopbackUrl, isRecord, oneOf, pathList, pathOr, stringOr,
} from './validate'

// ---------------------------------------------------------------------------
// 引擎路径自动探测（仅在对应设置为空时使用）
// ---------------------------------------------------------------------------

// 仅在对应设置为空时用于自动探测，只使用通用的用户目录位置，
// 不内置任何作者本机路径。
const GPT_SOVITS_ROOT_CANDIDATES = [
  join(homedir(), 'GPT-SoVITS'),
  join(homedir(), 'Downloads', 'GPT-SoVITS'),
]
const RVC_ROOT_CANDIDATES = [
  join(homedir(), 'Retrieval-based-Voice-Conversion-WebUI'),
  join(homedir(), 'Downloads', 'Retrieval-based-Voice-Conversion-WebUI'),
]

export function guessGptSovitsPython(rootPath: string): string {
  return rootPath ? join(rootPath, 'runtime', 'python.exe') : ''
}

export function guessRvcPython(rootPath: string): string {
  if (!rootPath) return ''
  const candidates = [
    join(rootPath, 'rvc_env', 'Scripts', 'python.exe'),
    join(rootPath, 'runtime', 'python.exe'),
    join(rootPath, '.venv', 'Scripts', 'python.exe'),
    join(rootPath, 'venv', 'Scripts', 'python.exe'),
  ]
  return candidates.find((candidate) => existsSync(candidate)) || candidates[0]
}

export function detectEngines(): EngineSettings {
  const gptRoot = GPT_SOVITS_ROOT_CANDIDATES.find((root) => existsSync(join(root, 'api_v2.py'))) || ''
  const rvcRoot = RVC_ROOT_CANDIDATES.find((root) => existsSync(join(root, 'infer'))) || ''
  return {
    gptSovits: { rootPath: gptRoot, pythonPath: guessGptSovitsPython(gptRoot), apiBaseUrl: 'http://127.0.0.1:9880', autoStart: true },
    rvc: { rootPath: rvcRoot, pythonPath: guessRvcPython(rvcRoot), ffmpegPath: '', modelDirs: [], indexDirs: [] },
    outputDir: '',
  }
}

// ---------------------------------------------------------------------------
// 规范化：任何来源（磁盘旧数据、界面补丁）都经过这里
// ---------------------------------------------------------------------------

export function normalizeEngines(raw: unknown, base: EngineSettings): EngineSettings {
  const input = isRecord(raw) ? raw : {}
  const gpt = isRecord(input.gptSovits) ? input.gptSovits : {}
  const rvc = isRecord(input.rvc) ? input.rvc : {}
  const gptRoot = pathOr(gpt.rootPath, base.gptSovits.rootPath)
  const rvcRoot = pathOr(rvc.rootPath, base.rvc.rootPath)
  // 根目录变化且解释器仍是旧根目录推导出的默认值（或为空）时，同步推导新解释器位置
  const derivePython = (rawPython: unknown, baseRoot: string, nextRoot: string, basePython: string, guess: (root: string) => string) => {
    const requested = pathOr(rawPython, basePython)
    if (nextRoot === baseRoot) return requested
    return !requested || requested === basePython && basePython === guess(baseRoot) ? guess(nextRoot) : requested
  }
  const gptPython = derivePython(gpt.pythonPath, base.gptSovits.rootPath, gptRoot, base.gptSovits.pythonPath, guessGptSovitsPython)
  const rvcPython = derivePython(rvc.pythonPath, base.rvc.rootPath, rvcRoot, base.rvc.pythonPath, guessRvcPython)
  return {
    gptSovits: {
      rootPath: gptRoot,
      pythonPath: gptPython,
      apiBaseUrl: isLoopbackUrl(gpt.apiBaseUrl) ? gpt.apiBaseUrl.replace(/\/+$/, '') : base.gptSovits.apiBaseUrl,
      autoStart: boolOr(gpt.autoStart, base.gptSovits.autoStart),
    },
    rvc: {
      rootPath: rvcRoot,
      pythonPath: rvcPython,
      ffmpegPath: pathOr(rvc.ffmpegPath, base.rvc.ffmpegPath),
      modelDirs: pathList(rvc.modelDirs, base.rvc.modelDirs),
      indexDirs: pathList(rvc.indexDirs, base.rvc.indexDirs),
    },
    outputDir: pathOr(input.outputDir, base.outputDir),
  }
}

export function normalizeRvcParams(raw: unknown, base: RvcParams = DEFAULT_RVC_PARAMS): RvcParams {
  const input = isRecord(raw) ? raw : {}
  return {
    speakerId: clampInteger(input.speakerId, 0, 1000, base.speakerId),
    pitch: clampInteger(input.pitch, -24, 24, base.pitch),
    f0Method: oneOf(input.f0Method, F0_METHODS, base.f0Method),
    indexRate: clampNumber(input.indexRate, 0, 1, base.indexRate),
    filterRadius: clampInteger(input.filterRadius, 0, 7, base.filterRadius),
    resampleRate: clampInteger(input.resampleRate, 0, 96000, base.resampleRate),
    volumeEnvelope: clampNumber(input.volumeEnvelope, 0, 1, base.volumeEnvelope),
    protect: clampNumber(input.protect, 0, 0.5, base.protect),
    uvrAggression: clampInteger(input.uvrAggression, 0, 20, base.uvrAggression),
    outputFormat: oneOf(input.outputFormat, AUDIO_FORMATS, base.outputFormat),
    backgroundVolume: clampNumber(input.backgroundVolume, 0, 2, base.backgroundVolume),
    vocalVolume: clampNumber(input.vocalVolume, 0, 2, base.vocalVolume),
  }
}

export function normalizePrefs(raw: unknown, base: Preferences): Preferences {
  const input = isRecord(raw) ? raw : {}
  const speak = isRecord(input.speak) ? input.speak : {}
  const cover = isRecord(input.cover) ? input.cover : {}
  const live = isRecord(input.live) ? input.live : {}
  const tools = isRecord(input.tools) ? input.tools : {}
  return {
    theme: oneOf(input.theme, ['light', 'dark'] as const, base.theme),
    lastPage: oneOf(input.lastPage, PAGE_IDS, base.lastPage),
    speak: {
      voiceId: stringOr(speak.voiceId, base.speak.voiceId, 200),
      textLang: oneOf(speak.textLang, LANGS, base.speak.textLang),
      splitMethod: oneOf(speak.splitMethod, SPLIT_METHODS, base.speak.splitMethod),
      speed: clampNumber(speak.speed, 0.5, 2, base.speak.speed),
      sampleSteps: oneOf(speak.sampleSteps, SAMPLE_STEPS, base.speak.sampleSteps),
      fragmentInterval: clampNumber(speak.fragmentInterval, 0, 2, base.speak.fragmentInterval),
      outputDir: pathOr(speak.outputDir, base.speak.outputDir),
    },
    cover: {
      modelPath: pathOr(cover.modelPath, base.cover.modelPath),
      indexPath: pathOr(cover.indexPath, base.cover.indexPath),
      uvrModel: stringOr(cover.uvrModel, base.cover.uvrModel, 260),
      outputDir: pathOr(cover.outputDir, base.cover.outputDir),
      params: normalizeRvcParams(cover.params, base.cover.params),
    },
    live: {
      inputDeviceId: stringOr(live.inputDeviceId, base.live.inputDeviceId, 40),
      outputDeviceId: stringOr(live.outputDeviceId, base.live.outputDeviceId, 40),
      modelPath: pathOr(live.modelPath, base.live.modelPath),
      indexPath: pathOr(live.indexPath, base.live.indexPath),
      indexRate: clampNumber(live.indexRate, 0, 1, base.live.indexRate),
      sampleRate: oneOf(live.sampleRate, LIVE_SAMPLE_RATES, base.live.sampleRate as (typeof LIVE_SAMPLE_RATES)[number]),
      preset: oneOf<LivePreset>(live.preset, ['stable', 'balanced', 'low-latency'], base.live.preset),
      f0Method: oneOf(live.f0Method, F0_METHODS, base.live.f0Method),
      pitch: clampInteger(live.pitch, -24, 24, base.live.pitch),
      gain: clampNumber(live.gain, 0, 2, base.live.gain),
      record: boolOr(live.record, base.live.record),
    },
    tools: {
      ncmSourceDir: pathOr(tools.ncmSourceDir, base.tools.ncmSourceDir),
      ncmOutputDir: pathOr(tools.ncmOutputDir, base.tools.ncmOutputDir),
    },
  }
}

export function normalizeVoice(raw: unknown): VoiceProfile | null {
  if (!isRecord(raw)) return null
  const id = stringOr(raw.id, '', 200).trim()
  const name = stringOr(raw.name, '', 120).trim()
  if (!id || !name) return null
  return {
    id,
    name,
    group: stringOr(raw.group, '', 120).trim() || '自定义',
    gptModel: pathOr(raw.gptModel, ''),
    sovitsModel: pathOr(raw.sovitsModel, ''),
    refAudio: pathOr(raw.refAudio, ''),
    refText: stringOr(raw.refText, '', 2000).trim(),
    refLang: oneOf(raw.refLang, LANGS, 'ja'),
  }
}

export { DEFAULT_PREFERENCES }
