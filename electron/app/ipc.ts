import { app, BrowserWindow, dialog, ipcMain, shell, type IpcMainInvokeEvent, type OpenDialogOptions } from 'electron'
import { existsSync } from 'fs'
import { join } from 'path'
import {
  F0_METHODS, LIVE_SAMPLE_RATES,
  type RealtimeStartOptions, type StudioSettings, type VoiceFileCheck, type VoiceProfile,
} from '../../shared/contracts'
import { IPC, type FilePickKind } from '../../shared/ipc'
import { defaultOutputDir } from '../core/paths'
import { normalizeEngines, normalizePrefs, normalizeVoice } from '../core/settings'
import { applyLegacyPreferences, type StateStore } from '../core/store'
import { clampInteger, clampNumber, isPathString, isRecord, oneOf } from '../core/validate'
import { scanRvcCatalog } from '../services/catalog'
import type { GptSovitsService } from '../services/gpt-sovits'
import type { JobManager } from '../services/jobs'
import { scanNcmDirectory } from '../services/ncm'
import type { RealtimeService } from '../services/realtime'
import { prepareRequest } from '../services/requests'

interface Services {
  store: StateStore
  jobs: JobManager
  gptSovits: GptSovitsService
  realtime: RealtimeService
  onSettingsChanged(settings: StudioSettings): void
  onRealtimeStarted(options: RealtimeStartOptions): void
}

const FILE_FILTERS: Record<FilePickKind, OpenDialogOptions['filters']> = {
  audio: [{ name: '音频文件', extensions: ['wav', 'flac', 'mp3', 'm4a', 'ogg', 'opus', 'aac', 'ncm'] }],
  ncm: [{ name: 'NCM 文件', extensions: ['ncm'] }],
  python: [{ name: 'Python 解释器', extensions: ['exe'] }],
  ffmpeg: [{ name: 'FFmpeg', extensions: ['exe'] }],
  gpt: [{ name: 'GPT 权重', extensions: ['ckpt'] }],
  sovits: [{ name: 'SoVITS 权重', extensions: ['pth'] }],
}

function ownerWindow(event: IpcMainInvokeEvent): BrowserWindow | undefined {
  return BrowserWindow.fromWebContents(event.sender) ?? undefined
}

function snapshot(store: StateStore): StudioSettings {
  return structuredClone({ engines: store.state.engines, prefs: store.state.prefs })
}

export function registerIpc(services: Services): void {
  const { store, jobs, gptSovits, realtime } = services
  const handle = (channel: string, listener: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown) => ipcMain.handle(channel, listener)
  const settingsChanged = () => {
    const current = snapshot(store)
    services.onSettingsChanged(current)
    return current
  }

  handle(IPC.appInfo, () => ({ version: app.getVersion(), defaultOutputDir: store.state.engines.outputDir || defaultOutputDir(), userDataDir: app.getPath('userData') }))

  // 窗口
  handle(IPC.windowMinimize, (event) => ownerWindow(event)?.minimize())
  handle(IPC.windowToggleMaximize, (event) => {
    const window = ownerWindow(event)
    if (!window) return false
    if (window.isMaximized()) window.unmaximize()
    else window.maximize()
    return window.isMaximized()
  })
  handle(IPC.windowClose, (event) => ownerWindow(event)?.close())
  handle(IPC.windowIsMaximized, (event) => ownerWindow(event)?.isMaximized() ?? false)

  // 文件与系统
  handle(IPC.pickFolder, async (event, defaultPath) => {
    const options: OpenDialogOptions = { properties: ['openDirectory', 'createDirectory'], defaultPath: isPathString(defaultPath) && existsSync(defaultPath) ? defaultPath : undefined }
    const window = ownerWindow(event)
    const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options)
    return result.canceled ? null : result.filePaths[0] ?? null
  })
  handle(IPC.pickFiles, async (event, kind, multiple) => {
    const filters = FILE_FILTERS[kind as FilePickKind]
    if (!filters) throw new Error('文件类型无效')
    const options: OpenDialogOptions = { properties: multiple === true ? ['openFile', 'multiSelections'] : ['openFile'], filters }
    const window = ownerWindow(event)
    const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options)
    return result.canceled ? [] : result.filePaths
  })
  handle(IPC.reveal, (_event, path) => {
    if (!isPathString(path) || !existsSync(path)) throw new Error('文件不存在或已被移动')
    shell.showItemInFolder(path)
  })
  handle(IPC.openPath, async (_event, path) => {
    if (!isPathString(path) || !existsSync(path)) throw new Error('路径不存在')
    const failure = await shell.openPath(path)
    if (failure) throw new Error(failure)
  })

  // 设置
  handle(IPC.settingsGet, () => snapshot(store))
  handle(IPC.settingsUpdateEngines, (_event, patch) => {
    if (!isRecord(patch)) throw new Error('设置格式无效')
    const previousApi = store.state.engines.gptSovits.apiBaseUrl
    store.mutate((state) => { state.engines = normalizeEngines(patch, state.engines) }, true)
    if (previousApi !== store.state.engines.gptSovits.apiBaseUrl) void gptSovits.refresh()
    return settingsChanged()
  })
  handle(IPC.settingsUpdatePrefs, (_event, patch) => {
    if (!isRecord(patch)) throw new Error('设置格式无效')
    const current = store.state.prefs
    // 深合并一层（speak/cover/live/tools 为对象）
    const merged: Record<string, unknown> = { ...current, ...patch }
    for (const key of ['speak', 'cover', 'live', 'tools'] as const) {
      if (isRecord(patch[key])) {
        const section = { ...current[key], ...patch[key] } as Record<string, unknown>
        if (key === 'cover' && isRecord((patch.cover as Record<string, unknown>).params)) {
          section.params = { ...current.cover.params, ...((patch.cover as Record<string, unknown>).params as object) }
        }
        merged[key] = section
      }
    }
    store.mutate((state) => { state.prefs = normalizePrefs(merged, state.prefs) })
    return settingsChanged()
  })
  handle(IPC.settingsImportLegacy, (_event, values) => {
    if (store.state.legacyLocalImported) return { imported: false }
    store.mutate((state) => {
      if (isRecord(values)) applyLegacyPreferences(state, values)
      state.legacyLocalImported = true
    }, true)
    settingsChanged()
    return { imported: true }
  })

  // 声音档案
  handle(IPC.voicesList, () => structuredClone(store.state.voices))
  handle(IPC.voicesSave, (_event, raw) => {
    const voice = normalizeVoice(raw)
    if (!voice) throw new Error('声音档案需要名称')
    store.mutate((state) => {
      const index = state.voices.findIndex((item) => item.id === voice.id)
      if (index >= 0) state.voices[index] = voice
      else state.voices.push(voice)
    }, true)
    return structuredClone(store.state.voices)
  })
  handle(IPC.voicesRemove, (_event, id) => {
    store.mutate((state) => { state.voices = state.voices.filter((item: VoiceProfile) => item.id !== id) }, true)
    return structuredClone(store.state.voices)
  })
  handle(IPC.voicesCheck, () => {
    const result: Record<string, VoiceFileCheck> = {}
    for (const voice of store.state.voices) {
      result[voice.id] = {
        gptModel: Boolean(voice.gptModel) && existsSync(voice.gptModel),
        sovitsModel: Boolean(voice.sovitsModel) && existsSync(voice.sovitsModel),
        refAudio: Boolean(voice.refAudio) && existsSync(voice.refAudio),
      }
    }
    return result
  })

  // 目录扫描
  handle(IPC.catalogScan, () => scanRvcCatalog(store.state.engines.rvc))
  handle(IPC.ncmScan, (_event, directory) => (isPathString(directory) ? scanNcmDirectory(directory) : []))

  // GPT-SoVITS 服务
  handle(IPC.serviceStatus, () => gptSovits.refresh())
  handle(IPC.serviceStart, async () => {
    await gptSovits.start()
    return gptSovits.getStatus()
  })
  handle(IPC.serviceStop, () => {
    gptSovits.stop()
    return gptSovits.getStatus()
  })

  // 任务
  handle(IPC.jobsList, () => jobs.list())
  handle(IPC.jobsEnqueue, (_event, request) => jobs.enqueue(prepareRequest(request, store.state.engines)))
  handle(IPC.jobsCancel, (_event, id) => { if (typeof id === 'string') jobs.cancel(id) })
  handle(IPC.jobsRemove, (_event, id) => { if (typeof id === 'string') jobs.remove(id) })
  handle(IPC.jobsClearFinished, () => jobs.clearFinished())

  // 实时变声
  handle(IPC.realtimeStatus, () => realtime.getStatus())
  handle(IPC.realtimeDevices, () => realtime.listDevices(store.state.engines.rvc))
  handle(IPC.realtimeStart, (_event, raw) => {
    if (jobs.isLaneBusy('gpu')) throw new Error('还有配音或翻唱任务在进行，请等它们完成后再开始实时变声')
    if (!isRecord(raw)) throw new Error('实时变声设置无效')
    const device = (value: unknown) => typeof value === 'string' && /^\d+:\d+$/.test(value) ? value : ''
    const inputDeviceId = device(raw.inputDeviceId)
    const outputDeviceId = device(raw.outputDeviceId)
    if (!inputDeviceId || !outputDeviceId) throw new Error('请选择输入和输出设备')
    const modelPath = isPathString(raw.modelPath) ? raw.modelPath : ''
    if (!modelPath.toLowerCase().endsWith('.pth') || !existsSync(modelPath)) throw new Error('请选择存在的 RVC 声音模型')
    const indexPath = isPathString(raw.indexPath) ? raw.indexPath : ''
    if (indexPath && (!indexPath.toLowerCase().endsWith('.index') || !existsSync(indexPath))) throw new Error('索引文件不存在')
    const options: RealtimeStartOptions = {
      inputDeviceId,
      outputDeviceId,
      modelPath,
      indexPath,
      indexRate: indexPath ? clampNumber(raw.indexRate, 0, 1, 0.75) : 0,
      sampleRate: oneOf(raw.sampleRate, LIVE_SAMPLE_RATES, 48000),
      blockSeconds: clampNumber(raw.blockSeconds, 0.08, 0.5, 0.25),
      pitch: clampInteger(raw.pitch, -24, 24, 0),
      f0Method: oneOf(raw.f0Method, F0_METHODS, 'rmvpe'),
      outputGain: clampNumber(raw.outputGain, 0, 2, 1),
      record: raw.record === true,
    }
    const recordDir = join(store.state.engines.outputDir || defaultOutputDir(), '实时录音')
    const status = realtime.start(options, store.state.engines.rvc, recordDir)
    services.onRealtimeStarted(options)
    return status
  })
  handle(IPC.realtimeStop, () => realtime.stop())
  handle(IPC.realtimeUpdate, (_event, raw) => {
    if (!isRecord(raw)) throw new Error('参数无效')
    realtime.updateControls({
      pitch: raw.pitch === undefined ? undefined : clampInteger(raw.pitch, -24, 24, 0),
      outputGain: raw.outputGain === undefined ? undefined : clampNumber(raw.outputGain, 0, 2, 1),
    })
  })
}
