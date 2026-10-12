import { spawn, type ChildProcess } from 'child_process'
import { EventEmitter } from 'events'
import { createWriteStream, existsSync, mkdirSync, type WriteStream } from 'fs'
import { dirname, join } from 'path'
import type { GptSovitsEngine, GptSovitsStatus } from '../../shared/contracts'
import { gptSovitsLogPath } from '../core/paths'
import { PYTHON_ENV, killTree } from '../core/process'
import { isLoopbackUrl } from '../core/validate'

const START_TIMEOUT_MS = 180_000

export function apiUrl(base: string, path: string): string {
  if (!isLoopbackUrl(base)) throw new Error('GPT-SoVITS 接口地址必须是本机回环地址')
  return `${base.replace(/\/+$/, '')}${path}`
}

/** 接口可用：openapi 中同时存在 /tts 与权重切换端点 */
export async function probeApi(baseUrl: string): Promise<boolean> {
  try {
    const response = await fetch(apiUrl(baseUrl, '/openapi.json'), { signal: AbortSignal.timeout(2500) })
    if (!response.ok) return false
    const schema = await response.json() as { paths?: Record<string, unknown> }
    return Boolean(schema.paths?.['/tts'] && schema.paths?.['/set_gpt_weights'] && schema.paths?.['/set_sovits_weights'])
  } catch {
    return false
  }
}

/**
 * GPT-SoVITS api_v2 服务管理：
 * - 若本机已有可用接口（外部启动），直接使用；
 * - 否则按设置启动 api_v2.py，日志写入 userData/gpt-sovits-logs。
 */
export class GptSovitsService extends EventEmitter {
  private child: ChildProcess | null = null
  private log: WriteStream | null = null
  private starting: Promise<void> | null = null
  private status: GptSovitsStatus = { state: 'unknown', managed: false, detail: '尚未检查', logPath: gptSovitsLogPath() }

  constructor(private readonly getEngine: () => GptSovitsEngine) {
    super()
  }

  getStatus(): GptSovitsStatus {
    return { ...this.status }
  }

  private setStatus(patch: Partial<GptSovitsStatus>): void {
    this.status = { ...this.status, ...patch, managed: Boolean(this.child) }
    this.emit('status', this.getStatus())
  }

  async refresh(): Promise<GptSovitsStatus> {
    if (this.starting) return this.getStatus()
    const engine = this.getEngine()
    const host = new URL(engine.apiBaseUrl).host
    if (await probeApi(engine.apiBaseUrl)) {
      this.setStatus({ state: 'ready', detail: this.child ? `服务运行中（${host}）` : `已连接本机服务（${host}）` })
    } else if (this.child) {
      this.setStatus({ state: 'error', detail: '服务进程在运行，但接口没有响应；请查看日志' })
    } else {
      this.setStatus({ state: 'stopped', detail: `服务未启动（${host}）` })
    }
    return this.getStatus()
  }

  /** 确保接口可用；必要时启动服务并等待就绪 */
  async ensureReady(): Promise<void> {
    const engine = this.getEngine()
    if (await probeApi(engine.apiBaseUrl)) {
      if (this.status.state !== 'ready') await this.refresh()
      return
    }
    await this.start()
  }

  start(): Promise<void> {
    if (!this.starting) {
      this.starting = this.launch().finally(() => { this.starting = null })
    }
    return this.starting
  }

  private async launch(): Promise<void> {
    const engine = this.getEngine()
    if (await probeApi(engine.apiBaseUrl)) {
      this.setStatus({ state: 'ready', detail: '已连接本机服务' })
      return
    }
    const { rootPath, pythonPath, apiBaseUrl } = engine
    const problem = !rootPath ? '尚未设置 GPT-SoVITS 目录'
      : !existsSync(join(rootPath, 'api_v2.py')) ? `目录中没有 api_v2.py：${rootPath}`
      : !existsSync(pythonPath) ? `Python 解释器不存在：${pythonPath}` : ''
    if (problem) {
      this.setStatus({ state: 'error', detail: problem })
      throw new Error(`${problem}。请在“设置”中检查 GPT-SoVITS 路径。`)
    }

    if (!this.child) {
      const address = new URL(apiBaseUrl)
      const host = address.hostname.replace(/^\[|\]$/g, '')
      const port = address.port || (address.protocol === 'https:' ? '443' : '80')
      const args = ['api_v2.py', '-a', host, '-p', port, '-c', 'GPT_SoVITS/configs/tts_infer.yaml']
      mkdirSync(dirname(this.status.logPath), { recursive: true })
      this.log?.end()
      this.log = createWriteStream(this.status.logPath, { flags: 'a' })
      this.log.write(`\n[${new Date().toISOString()}] 启动：${pythonPath} ${args.join(' ')}\n`)
      const child = spawn(pythonPath, args, { cwd: rootPath, env: { ...process.env, ...PYTHON_ENV }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
      this.child = child
      child.stdout?.on('data', (chunk: Buffer) => this.log?.write(chunk))
      child.stderr?.on('data', (chunk: Buffer) => this.log?.write(chunk))
      child.once('error', (error) => this.log?.write(`[${new Date().toISOString()}] 启动失败：${error.message}\n`))
      child.once('close', (code) => {
        this.log?.write(`[${new Date().toISOString()}] 服务进程退出（${code}）\n`)
        if (this.child === child) {
          this.child = null
          this.setStatus({ state: code === 0 || code === null ? 'stopped' : 'error', detail: code === 0 || code === null ? '服务已停止' : `服务异常退出（代码 ${code}），请查看日志` })
        }
      })
    }
    this.setStatus({ state: 'starting', detail: '正在启动 GPT-SoVITS 服务（首次加载可能需要一两分钟）' })

    const child = this.child
    const deadline = Date.now() + START_TIMEOUT_MS
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 1500))
      if (!this.child || this.child !== child) throw new Error(`GPT-SoVITS 服务启动失败：${this.status.detail}。日志：${this.status.logPath}`)
      if (await probeApi(apiBaseUrl)) {
        this.setStatus({ state: 'ready', detail: `服务运行中（${new URL(apiBaseUrl).host}）` })
        return
      }
    }
    this.setStatus({ state: 'error', detail: '服务启动超时' })
    throw new Error(`GPT-SoVITS 服务在 ${START_TIMEOUT_MS / 1000} 秒内没有就绪。日志：${this.status.logPath}`)
  }

  stop(): void {
    const child = this.child
    if (!child) return
    this.child = null
    killTree(child)
    this.log?.write(`[${new Date().toISOString()}] 已请求停止服务\n`)
    this.setStatus({ state: 'stopped', detail: '服务已停止' })
  }

  dispose(): void {
    this.stop()
    this.log?.end()
    this.log = null
  }
}
