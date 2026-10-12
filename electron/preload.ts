import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'
import { EVENTS, IPC, MEDIA_SCHEME, type StudioApi } from '../shared/ipc'

const invoke = <T>(channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args) as Promise<T>

function subscribe<T>(channel: string, callback: (payload: T) => void): () => void {
  const listener = (_event: IpcRendererEvent, payload: T) => callback(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: StudioApi = {
  app: { info: () => invoke(IPC.appInfo) },
  window: {
    minimize: () => invoke(IPC.windowMinimize),
    toggleMaximize: () => invoke(IPC.windowToggleMaximize),
    close: () => invoke(IPC.windowClose),
    isMaximized: () => invoke(IPC.windowIsMaximized),
    onMaximized: (callback) => subscribe(EVENTS.windowMaximized, callback),
  },
  dialog: {
    pickFolder: (defaultPath) => invoke(IPC.pickFolder, defaultPath),
    pickFiles: (kind, multiple) => invoke(IPC.pickFiles, kind, multiple),
  },
  shell: {
    reveal: (path) => invoke(IPC.reveal, path),
    openPath: (path) => invoke(IPC.openPath, path),
  },
  settings: {
    get: () => invoke(IPC.settingsGet),
    updateEngines: (patch) => invoke(IPC.settingsUpdateEngines, patch),
    updatePrefs: (patch) => invoke(IPC.settingsUpdatePrefs, patch),
    importLegacy: (values) => invoke(IPC.settingsImportLegacy, values),
    onChanged: (callback) => subscribe(EVENTS.settingsChanged, callback),
  },
  voices: {
    list: () => invoke(IPC.voicesList),
    save: (voice) => invoke(IPC.voicesSave, voice),
    remove: (id) => invoke(IPC.voicesRemove, id),
    check: () => invoke(IPC.voicesCheck),
  },
  catalog: { scanRvc: () => invoke(IPC.catalogScan) },
  ncm: { scan: (directory) => invoke(IPC.ncmScan, directory) },
  service: {
    status: () => invoke(IPC.serviceStatus),
    start: () => invoke(IPC.serviceStart),
    stop: () => invoke(IPC.serviceStop),
    onStatus: (callback) => subscribe(EVENTS.serviceStatus, callback),
  },
  jobs: {
    list: () => invoke(IPC.jobsList),
    enqueue: (request) => invoke(IPC.jobsEnqueue, request),
    cancel: (id) => invoke(IPC.jobsCancel, id),
    remove: (id) => invoke(IPC.jobsRemove, id),
    clearFinished: () => invoke(IPC.jobsClearFinished),
    onUpdated: (callback) => subscribe(EVENTS.jobUpdated, callback),
    onRemoved: (callback) => subscribe(EVENTS.jobRemoved, callback),
  },
  realtime: {
    status: () => invoke(IPC.realtimeStatus),
    devices: () => invoke(IPC.realtimeDevices),
    start: (options) => invoke(IPC.realtimeStart, options),
    stop: () => invoke(IPC.realtimeStop),
    update: (controls) => invoke(IPC.realtimeUpdate, controls),
    onStatus: (callback) => subscribe(EVENTS.realtimeStatus, callback),
    onLog: (callback) => subscribe(EVENTS.realtimeLog, callback),
  },
  media: {
    url: (path) => `${MEDIA_SCHEME}://file/${encodeURIComponent(path)}`,
    pathForFile: (file) => webUtils.getPathForFile(file),
  },
  onNavigate: (callback) => subscribe(EVENTS.navigate, callback),
}

contextBridge.exposeInMainWorld('studio', api)
