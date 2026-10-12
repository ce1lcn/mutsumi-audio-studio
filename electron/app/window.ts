import { app, BrowserWindow, shell } from 'electron'
import { join } from 'path'
import { EVENTS } from '../../shared/ipc'
import { appIconPath } from '../core/paths'

export function createMainWindow(theme: 'light' | 'dark'): BrowserWindow {
  const devUrl = app.isPackaged ? undefined : process.env.ELECTRON_RENDERER_URL
  const window = new BrowserWindow({
    width: 1360,
    height: 880,
    minWidth: 980,
    minHeight: 640,
    show: false,
    title: '睦音工坊',
    icon: appIconPath(),
    frame: false,
    backgroundColor: theme === 'dark' ? '#1d1719' : '#f5f6ef',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
    },
  })

  window.once('ready-to-show', () => window.show())
  const sendMaximized = () => window.webContents.send(EVENTS.windowMaximized, window.isMaximized())
  window.on('maximize', sendMaximized)
  window.on('unmaximize', sendMaximized)

  // 外部链接一律交给系统浏览器
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file:') && !(devUrl && url.startsWith(devUrl))) event.preventDefault()
  })

  if (devUrl) void window.loadURL(devUrl)
  else void window.loadFile(join(__dirname, '../renderer/index.html'))
  return window
}
