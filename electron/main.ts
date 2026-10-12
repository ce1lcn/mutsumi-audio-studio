import { app, BrowserWindow } from 'electron'
import { existsSync, statSync } from 'fs'
import { join } from 'path'
import { EVENTS } from '../shared/ipc'
import { registerIpc } from './app/ipc'
import { handleMediaProtocol, registerMediaScheme } from './app/media-protocol'
import { StudioTray } from './app/tray'
import { createMainWindow } from './app/window'
import { stateDir } from './core/paths'
import { StateStore } from './core/store'
import { GptSovitsService } from './services/gpt-sovits'
import { JobManager } from './services/jobs'
import { RealtimeService } from './services/realtime'
import { createRunner } from './services/runners'
import { resetLoadedWeights } from './services/tts'

// 3.x 使用新的应用 ID：旧 ID 在任务栏上被 2.x 固定项及其图标缓存占用
const APP_ID = 'com.czy.mutsumi.studio'

// 沿用 2.x 的用户数据目录，保证设置、声音档案与历史任务可以迁移
const legacyUserData = join(app.getPath('appData'), 'smartchat')
if (process.env.MUTSUMI_USER_DATA) {
  // 开发与验收测试用：指定独立的数据目录
  app.setPath('userData', process.env.MUTSUMI_USER_DATA)
} else if (existsSync(join(legacyUserData, 'mutsumi-audio-studio')) || existsSync(join(legacyUserData, 'Local Storage'))) {
  app.setPath('userData', legacyUserData)
}

registerMediaScheme()

let mainWindow: BrowserWindow | null = null
let tray: StudioTray | null = null
let quitting = false

function send(channel: string, payload: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload)
}

function showWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

async function bootstrap(): Promise<void> {
  app.setAppUserModelId(APP_ID)
  const store = await StateStore.open(stateDir())

  const gptSovits = new GptSovitsService(() => store.state.engines.gptSovits)
  const realtime = new RealtimeService()
  const jobs = new JobManager(
    store,
    createRunner({ engines: () => store.state.engines, gptSovits }),
    (lane) => (lane === 'gpu' && realtime.isActive() ? '实时变声正在占用显卡，请先停止实时变声' : ''),
  )

  jobs.on('updated', (job) => send(EVENTS.jobUpdated, job))
  jobs.on('removed', (ids) => send(EVENTS.jobRemoved, ids))
  gptSovits.on('status', (status) => {
    if (status.state !== 'ready') resetLoadedWeights()
    send(EVENTS.serviceStatus, status)
    tray?.setService(status)
  })

  // 实时变声会话写入任务历史
  let liveJobId = ''
  realtime.on('status', (status) => {
    send(EVENTS.realtimeStatus, status)
    tray?.setRealtime(status)
  })
  realtime.on('log', (line) => send(EVENTS.realtimeLog, line))
  realtime.on('ended', ({ failed, message, recordingPath }) => {
    if (liveJobId) {
      jobs.patch(liveJobId, (job) => {
        job.status = failed ? 'failed' : 'succeeded'
        job.stage = message
        job.progress = 100
        job.finishedAt = new Date().toISOString()
        if (failed) job.error = message
        if (recordingPath && existsSync(recordingPath)) job.artifacts = [{ role: 'recording', path: recordingPath, bytes: statSync(recordingPath).size }]
      }, true)
      liveJobId = ''
    }
    jobs.resume()
  })

  registerIpc({
    store,
    jobs,
    gptSovits,
    realtime,
    onSettingsChanged: (settings) => send(EVENTS.settingsChanged, settings),
    onRealtimeStarted: (options) => {
      const model = options.modelPath.split(/[\\/]/).pop()?.replace(/\.pth$/i, '') || 'RVC'
      liveJobId = jobs.record({ kind: 'live', title: `实时变声：${model}`, status: 'running', stage: '正在实时变声', progress: 0, startedAt: new Date().toISOString() })
    },
  })
  handleMediaProtocol()

  mainWindow = createMainWindow(store.state.prefs.theme)
  mainWindow.on('closed', () => { mainWindow = null })

  tray = new StudioTray({
    showWindow,
    startService: () => void gptSovits.start().catch(() => undefined),
    stopService: () => gptSovits.stop(),
    stopRealtime: () => realtime.stop(),
    quit: () => app.quit(),
  })

  // 启动时检查 GPT-SoVITS 接口，按设置自动启动
  void gptSovits.refresh().then((status) => {
    if (status.state !== 'ready' && store.state.engines.gptSovits.autoStart) void gptSovits.start().catch(() => undefined)
  })

  app.on('before-quit', () => {
    quitting = true
    realtime.dispose()
    jobs.cancelAll()
    gptSovits.dispose()
    tray?.destroy()
    tray = null
    void store.flush()
  })
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', showWindow)
  app.whenReady().then(bootstrap).catch((error) => {
    console.error('[Main] 启动失败：', error)
    app.quit()
  })
  app.on('window-all-closed', () => {
    if (!quitting) app.quit()
  })
}
