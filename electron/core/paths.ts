import { app } from 'electron'
import { join } from 'path'

// 打包后资源位于 resources/；开发模式直接读取仓库文件。
const projectRoot = join(__dirname, '../..')

export function resourcePath(fileName: string): string {
  return app.isPackaged ? join(process.resourcesPath, fileName) : join(projectRoot, 'resources', fileName)
}

export function workerPath(fileName: 'rvc_worker.py' | 'realtime_worker.py' | 'requirements-realtime.txt'): string {
  return app.isPackaged ? join(process.resourcesPath, 'workers', fileName) : join(projectRoot, 'electron', 'workers', fileName)
}

export const appIconPath = (): string => resourcePath('icon.ico')

export function defaultOutputDir(): string {
  return join(app.getPath('documents'), '睦音工坊')
}

export function stateDir(): string {
  return join(app.getPath('userData'), 'mutsumi-audio-studio')
}

export function gptSovitsLogPath(): string {
  return join(app.getPath('userData'), 'gpt-sovits-logs', 'api_v2.log')
}
