import { spawn } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'
import type { ArtifactRole, EngineSettings, JobRequest, RvcParams } from '../../shared/contracts'
import { workerPath } from '../core/paths'
import { PYTHON_ENV, cleanLogLine, killTree, parseEvent, readLines, waitForExit } from '../core/process'
import type { GptSovitsService } from './gpt-sovits'
import type { RunContext, Runner } from './jobs'
import { convertNcm } from './ncm'
import { synthesize } from './tts'

interface WorkerEvent {
  type: 'progress' | 'log' | 'outputs' | 'done' | 'error'
  progress?: number
  stage?: string
  message?: string
  detail?: string
  outputs?: Record<string, string>
}

const OUTPUT_ROLE: Record<string, ArtifactRole> = { vocal: 'vocal', instrument: 'instrument', converted: 'converted', mixed: 'mixed' }

interface RvcWorkerOptions {
  action: 'full' | 'separate' | 'convert' | 'mix'
  inputPath?: string
  vocalPath?: string
  instrumentPath?: string
  outputDir: string
  modelPath?: string
  indexPath?: string
  uvrModel?: string
  params: RvcParams
}

async function runRvcWorker(options: RvcWorkerOptions, engines: EngineSettings, ctx: RunContext): Promise<void> {
  const { rootPath, pythonPath, ffmpegPath } = engines.rvc
  if (!rootPath || !existsSync(rootPath)) throw new Error('RVC 根目录不存在，请在“设置”中检查')
  if (!pythonPath || !existsSync(pythonPath)) throw new Error('RVC Python 解释器不存在，请在“设置”中检查')
  const script = workerPath('rvc_worker.py')
  if (!existsSync(script)) throw new Error(`缺少 RVC worker：${script}`)

  const payload = JSON.stringify({ ...options, rvcRoot: rootPath, ffmpegPath })
  const child = spawn(pythonPath, [script, payload], {
    cwd: rootPath,
    env: { ...process.env, ...PYTHON_ENV },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const onAbort = () => killTree(child)
  ctx.signal.addEventListener('abort', onAbort, { once: true })

  let failure = ''
  let finished = false
  readLines(child, (line) => {
    const event = parseEvent<WorkerEvent>(line)
    if (!event) {
      const cleaned = cleanLogLine(line)
      if (cleaned) ctx.log(cleaned)
      return
    }
    if (event.outputs) for (const [key, path] of Object.entries(event.outputs)) if (OUTPUT_ROLE[key]) ctx.artifact(OUTPUT_ROLE[key], path)
    if (event.type === 'progress') ctx.stage(event.stage || '处理中', event.progress)
    else if (event.type === 'log' && event.message) ctx.log(cleanLogLine(event.message))
    else if (event.type === 'error') {
      failure = event.message || 'RVC 任务失败'
      if (event.detail) ctx.log(event.detail)
    } else if (event.type === 'done') finished = true
  })

  const code = await waitForExit(child)
  ctx.signal.removeEventListener('abort', onAbort)
  if (ctx.signal.aborted) return
  if (failure) throw new Error(failure)
  if (code !== 0 || !finished) throw new Error(`RVC 进程异常退出（代码 ${code}），请查看任务日志`)
}

/** NCM 输入先解密为普通音频 */
async function decodeIfNcm(path: string, outputDir: string, ctx: RunContext): Promise<string> {
  if (!path.toLowerCase().endsWith('.ncm')) return path
  ctx.stage('解密 NCM 文件', 1)
  const decoded = await convertNcm(path, join(outputDir, 'NCM 解密'))
  ctx.artifact('decoded', decoded)
  return decoded
}

export function createRunner(deps: { engines: () => EngineSettings; gptSovits: GptSovitsService }): Runner {
  return async (request: JobRequest, ctx: RunContext) => {
    const engines = deps.engines()
    switch (request.kind) {
      case 'tts': {
        const path = await synthesize(request, {
          service: deps.gptSovits,
          apiBaseUrl: engines.gptSovits.apiBaseUrl,
          outputDir: request.outputDir,
          signal: ctx.signal,
          onStage: (stage, progress) => ctx.stage(stage, progress),
        })
        ctx.artifact('speech', path)
        return
      }
      case 'ncm': {
        ctx.stage('正在解密', 20)
        const path = await convertNcm(request.inputPath, request.outputDir)
        ctx.artifact('decoded', path)
        return
      }
      case 'rvc-full': {
        const inputPath = await decodeIfNcm(request.inputPath, request.outputDir, ctx)
        await runRvcWorker({ action: 'full', ...request, inputPath }, engines, ctx)
        return
      }
      case 'rvc-separate': {
        const inputPath = await decodeIfNcm(request.inputPath, request.outputDir, ctx)
        await runRvcWorker({ action: 'separate', ...request, inputPath }, engines, ctx)
        return
      }
      case 'rvc-convert': {
        const inputPath = await decodeIfNcm(request.inputPath, request.outputDir, ctx)
        await runRvcWorker({ action: 'convert', ...request, inputPath }, engines, ctx)
        return
      }
      case 'rvc-mix':
        await runRvcWorker({ action: 'mix', ...request }, engines, ctx)
        return
    }
  }
}
