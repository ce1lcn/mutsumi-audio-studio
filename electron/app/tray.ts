import { Menu, Tray, nativeImage, shell } from 'electron'
import type { GptSovitsStatus, RealtimeStatus } from '../../shared/contracts'
import { appIconPath } from '../core/paths'

const SERVICE_LABEL: Record<GptSovitsStatus['state'], string> = {
  unknown: '检查中', ready: '已就绪', starting: '启动中', stopped: '未启动', error: '异常',
}

interface TrayActions {
  showWindow(): void
  startService(): void
  stopService(): void
  stopRealtime(): void
  quit(): void
}

/** 系统托盘：与窗口、任务栏共用同一个 icon.ico（多尺寸图层由 Windows 按 DPI 选择） */
export class StudioTray {
  private readonly tray: Tray
  private service: GptSovitsStatus | null = null
  private realtime: RealtimeStatus | null = null

  constructor(private readonly actions: TrayActions) {
    this.tray = new Tray(nativeImage.createFromPath(appIconPath()))
    this.tray.setToolTip('睦音工坊')
    this.tray.on('click', () => actions.showWindow())
    this.tray.on('double-click', () => actions.showWindow())
    this.render()
  }

  setService(status: GptSovitsStatus): void {
    this.service = status
    this.render()
  }

  setRealtime(status: RealtimeStatus): void {
    const wasActive = this.isLive(this.realtime)
    this.realtime = status
    if (wasActive !== this.isLive(status)) this.render()
  }

  private isLive(status: RealtimeStatus | null): boolean {
    return Boolean(status && ['starting', 'running', 'stopping'].includes(status.state))
  }

  private render(): void {
    const state = this.service?.state ?? 'unknown'
    const live = this.isLive(this.realtime)
    this.tray.setToolTip(live ? '睦音工坊 · 实时变声中' : '睦音工坊')
    this.tray.setContextMenu(Menu.buildFromTemplate([
      { label: '打开睦音工坊', click: () => this.actions.showWindow() },
      { type: 'separator' },
      { label: `GPT-SoVITS 服务：${SERVICE_LABEL[state]}`, enabled: false },
      state === 'ready' || state === 'starting'
        ? { label: '停止 GPT-SoVITS 服务', enabled: Boolean(this.service?.managed), click: () => this.actions.stopService() }
        : { label: '启动 GPT-SoVITS 服务', click: () => this.actions.startService() },
      { label: '打开服务日志', click: () => { if (this.service) void shell.openPath(this.service.logPath) } },
      ...(live ? [{ type: 'separator' as const }, { label: '停止实时变声', click: () => this.actions.stopRealtime() }] : []),
      { type: 'separator' },
      { label: '退出', click: () => this.actions.quit() },
    ]))
  }

  destroy(): void {
    this.tray.destroy()
  }
}
