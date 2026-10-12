import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { randomUUID } from 'crypto'
import { EventEmitter } from 'events'
import { existsSync } from 'fs'
import { join } from 'path'
import type { RealtimeAudioDevice, RealtimeStartOptions, RealtimeStatus, RvcEngine } from '../../shared/contracts'
import { workerPath } from '../core/paths'
import { PYTHON_ENV, cleanLogLine, killTree, parseEvent, readLines } from '../core/process'

interface WorkerEvent {
  type: 'ready' | 'running' | 'telemetry' | 'recording' | 'stopped' | 'error' | 'log'
  message?: string
  detail?: string
  blockDurationMs?: number
  inferMs?: number
  inputLevel?: number
  outputLevel?: number
  overflowCount?: number
  path?: string
}

const IDLE: RealtimeStatus = { sessionId: null, state: 'stopped', overflowCount: 0, inputLevel: 0, outputLevel: 0 }

/**
 * 实时变声会话。音频流完全在 Python/PortAudio 内部，
 * 进程边界只传递 JSON 控制指令与遥测。
 * 事件：'status' (RealtimeStatus)、'log' (string)、'ended' ({ sessionId, failed, message, recordingPath })
 */
export class RealtimeService extends EventEmitter {
  private child: ChildProcessWithoutNullStreams | null = null
  private status: RealtimeStatus = { ...IDLE }
  private stopRequested = false
  private lastEmit = 0

  getStatus(): RealtimeStatus {
    return { ...this.status }
  }

  isActive(): boolean {
    return Boolean(this.child)
  }

  private update(patch: Partial<RealtimeStatus>, force = true): void {
    this.status = { ...this.status, ...patch }
    const now = Date.now()
    if (force || now - this.lastEmit > 200) {
      this.lastEmit = now
      this.emit('status', this.getStatus())
    }
  }

  async listDevices(engine: RvcEngine): Promise<RealtimeAudioDevice[]> {
    if (!engine.pythonPath || !existsSync(engine.pythonPath)) throw new Error('请先在“设置”中配置 RVC Python 解释器')
    const child = spawn(engine.pythonPath, [workerPath('realtime_worker.py'), '--devices'], {
      cwd: engine.rootPath && existsSync(engine.rootPath) ? engine.rootPath : undefined,
      env: { ...process.env, ...PYTHON_ENV },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const lines: string[] = []
    readLines(child, (line) => lines.push(line))
    const code = await new Promise<number | null>((resolve, reject) => {
      const timer = setTimeout(() => { killTree(child); reject(new Error('读取音频设备超时')) }, 30_000)
      child.once('error', (error) => { clearTimeout(timer); reject(error) })
      child.once('close', (exitCode) => { clearTimeout(timer); resolve(exitCode) })
    })
    const json = [...lines].reverse().find((line) => line.trim().startsWith('{'))
    if (json) {
      const parsed = JSON.parse(json) as { devices?: RealtimeAudioDevice[]; error?: string }
      if (parsed.error) throw new Error(parsed.error)
      if (parsed.devices) return parsed.devices
    }
    throw new Error(lines.slice(-4).join('\n') || `设备扫描进程退出（代码 ${code}）`)
  }

  start(options: RealtimeStartOptions, engine: RvcEngine, recordDir: string): RealtimeStatus {
    if (this.child) throw new Error('实时变声已经在运行')
    const script = workerPath('realtime_worker.py')
    if (!existsSync(script)) throw new Error(`缺少实时变声 worker：${script}`)
    if (!engine.rootPath || !existsSync(engine.rootPath)) throw new Error('RVC 根目录不存在，请在“设置”中检查')
    if (!engine.pythonPath || !existsSync(engine.pythonPath)) throw new Error('RVC Python 解释器不存在，请在“设置”中检查')

    const sessionId = randomUUID()
    const recordPath = join(recordDir, `实时变声 ${new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '')}.wav`)
    const child = spawn(engine.pythonPath, [script, '--config', JSON.stringify({ ...options, recordPath, rvcRoot: engine.rootPath })], {
      cwd: engine.rootPath,
      env: { ...process.env, ...PYTHON_ENV },
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    this.child = child
    this.stopRequested = false
    this.status = { ...IDLE, sessionId, state: 'starting', message: '正在加载模型并打开音频设备…' }
    this.emit('status', this.getStatus())

    let failure = ''
    let recordingPath = ''
    readLines(child, (line, stream) => {
      const event = parseEvent<WorkerEvent>(line)
      if (!event) {
        const cleaned = cleanLogLine(line)
        if (cleaned) this.emit('log', stream === 'stderr' ? `[RVC] ${cleaned}` : cleaned)
        return
      }
      switch (event.type) {
        case 'ready':
          this.update({ state: 'running', blockDurationMs: event.blockDurationMs, startedAt: new Date().toISOString(), message: '正在实时变声' })
          break
        case 'running':
          this.update({ state: 'running', message: '正在实时变声' })
          break
        case 'telemetry':
          this.update({
            state: this.status.state === 'stopping' ? 'stopping' : 'running',
            inferenceMs: event.inferMs,
            overflowCount: event.overflowCount ?? this.status.overflowCount,
            inputLevel: event.inputLevel ?? 0,
            outputLevel: event.outputLevel ?? 0,
          }, false)
          break
        case 'recording':
          if (event.path) {
            recordingPath = event.path
            this.update({ recordingPath: event.path })
          }
          break
        case 'error':
          failure = event.message || '实时变声失败'
          if (event.detail) this.emit('log', event.detail)
          break
        case 'log':
          if (event.message) this.emit('log', event.message)
          break
      }
    })

    child.once('error', (error) => { failure = failure || error.message })
    child.once('close', (code) => {
      if (this.child !== child) return
      this.child = null
      const failed = Boolean(failure) || (!this.stopRequested && code !== 0)
      const message = failed ? failure || `实时变声进程异常退出（代码 ${code}）` : recordingPath ? `已停止，录音已保存` : '已停止'
      this.status = { ...IDLE, state: failed ? 'failed' : 'stopped', message, recordingPath: recordingPath || undefined }
      this.emit('status', this.getStatus())
      this.emit('ended', { sessionId, failed, message, recordingPath })
    })
    return this.getStatus()
  }

  updateControls(controls: { pitch?: number; outputGain?: number }): void {
    if (!this.child?.stdin.writable) throw new Error('实时变声尚未启动')
    this.child.stdin.write(`${JSON.stringify({ type: 'controls', pitch: controls.pitch, gain: controls.outputGain })}\n`)
  }

  stop(): void {
    const child = this.child
    if (!child) return
    this.stopRequested = true
    this.update({ state: 'stopping', message: '正在关闭音频流…' })
    if (child.stdin.writable) child.stdin.write('{"type":"stop"}\n')
    // 录音需要时间写盘；超时后强制结束
    setTimeout(() => { if (this.child === child) killTree(child) }, 8000).unref()
  }

  /** 应用退出：立即结束进程，确保麦克风被释放 */
  dispose(): void {
    const child = this.child
    if (!child) return
    this.stopRequested = true
    if (child.stdin.writable) child.stdin.write('{"type":"stop"}\n')
    killTree(child)
  }
}
