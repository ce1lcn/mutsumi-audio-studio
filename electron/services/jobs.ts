import { randomUUID } from 'crypto'
import { EventEmitter } from 'events'
import { existsSync, statSync } from 'fs'
import type { ArtifactRole, Job, JobRequest } from '../../shared/contracts'
import { MAX_JOB_HISTORY, type StateStore } from '../core/store'
import { errorMessage } from '../core/validate'
import type { Lane, PreparedRequest } from './requests'

export interface RunContext {
  job: Readonly<Job>
  signal: AbortSignal
  stage(stage: string, progress?: number): void
  log(line: string): void
  artifact(role: ArtifactRole, path: string): void
}

export type Runner = (request: JobRequest, ctx: RunContext) => Promise<void>

const MAX_LOG_LINES = 400

/**
 * 主进程任务队列。每条通道（GPU 推理 / 文件处理）串行执行，
 * 任务记录持久化到状态文件，界面通过事件实时刷新。
 */
export class JobManager extends EventEmitter {
  private readonly running = new Map<Lane, { id: string; controller: AbortController }>()
  private readonly laneOf = new Map<string, Lane>()
  private readonly pendingEmit = new Map<string, NodeJS.Timeout>()

  constructor(
    private readonly store: StateStore,
    private readonly runner: Runner,
    /** 返回非空字符串表示该通道暂不可用（例如实时变声占用 GPU） */
    private readonly laneBlocker: (lane: Lane) => string,
  ) {
    super()
    // 上次退出时仍在进行的任务标记为中断
    store.mutate((state) => {
      for (const job of state.jobs) {
        if (job.status === 'queued' || job.status === 'running') {
          job.status = 'interrupted'
          job.stage = '应用上次退出时任务未完成'
          job.finishedAt = new Date().toISOString()
        }
      }
    }, true)
  }

  list(): Job[] {
    return this.store.state.jobs.map((job) => ({ ...job }))
  }

  isLaneBusy(lane: Lane): boolean {
    return this.running.has(lane) || this.store.state.jobs.some((job) => job.status === 'queued' && this.laneOf.get(job.id) === lane)
  }

  enqueue(prepared: PreparedRequest): Job {
    const blocked = this.laneBlocker(prepared.lane)
    if (blocked) throw new Error(blocked)
    const job: Job = {
      id: randomUUID(),
      kind: prepared.request.kind,
      title: prepared.title,
      status: 'queued',
      stage: this.running.has(prepared.lane) ? '排队等待' : '准备开始',
      progress: 0,
      createdAt: new Date().toISOString(),
      request: prepared.request,
      artifacts: [],
      logs: [],
    }
    this.laneOf.set(job.id, prepared.lane)
    this.insert(job)
    queueMicrotask(() => this.pump(prepared.lane))
    return { ...job }
  }

  /** 记录不经过队列的任务（实时变声会话） */
  record(job: Omit<Job, 'id' | 'createdAt' | 'artifacts' | 'logs'> & Partial<Pick<Job, 'artifacts' | 'logs'>>): string {
    const full: Job = { id: randomUUID(), createdAt: new Date().toISOString(), artifacts: [], logs: [], ...job }
    this.insert(full)
    return full.id
  }

  patch(id: string, change: (job: Job) => void, immediate = false): void {
    const job = this.store.state.jobs.find((item) => item.id === id)
    if (!job) return
    this.store.mutate(() => change(job), immediate)
    this.scheduleEmit(job, immediate)
  }

  cancel(id: string): void {
    const job = this.store.state.jobs.find((item) => item.id === id)
    if (!job) return
    if (job.status === 'queued') {
      this.finish(id, 'cancelled', '已取消')
      return
    }
    for (const active of this.running.values()) {
      if (active.id === id) {
        this.patch(id, (item) => { item.stage = '正在取消…' })
        active.controller.abort()
      }
    }
  }

  remove(id: string): void {
    const job = this.store.state.jobs.find((item) => item.id === id)
    if (!job || job.status === 'queued' || job.status === 'running') return
    this.store.mutate((state) => { state.jobs = state.jobs.filter((item) => item.id !== id) }, true)
    this.emit('removed', [id])
  }

  clearFinished(): void {
    const removed = this.store.state.jobs.filter((job) => job.status !== 'queued' && job.status !== 'running').map((job) => job.id)
    if (!removed.length) return
    this.store.mutate((state) => { state.jobs = state.jobs.filter((job) => job.status === 'queued' || job.status === 'running') }, true)
    this.emit('removed', removed)
  }

  /** 通道解除阻塞后调用，继续执行排队任务 */
  resume(): void {
    this.pump('gpu')
    this.pump('io')
  }

  cancelAll(): void {
    for (const active of this.running.values()) active.controller.abort()
  }

  private insert(job: Job): void {
    this.store.mutate((state) => {
      state.jobs.unshift(job)
      if (state.jobs.length > MAX_JOB_HISTORY) {
        // 只裁掉已结束的旧记录
        const keep = state.jobs.filter((item, index) => index < MAX_JOB_HISTORY || item.status === 'queued' || item.status === 'running')
        const dropped = state.jobs.filter((item) => !keep.includes(item)).map((item) => item.id)
        state.jobs = keep
        if (dropped.length) this.emit('removed', dropped)
      }
    }, true)
    this.emit('updated', { ...job })
  }

  private scheduleEmit(job: Job, immediate: boolean): void {
    const existing = this.pendingEmit.get(job.id)
    if (immediate) {
      if (existing) clearTimeout(existing)
      this.pendingEmit.delete(job.id)
      this.emit('updated', { ...job, logs: [...job.logs], artifacts: [...job.artifacts] })
      return
    }
    if (existing) return
    this.pendingEmit.set(job.id, setTimeout(() => {
      this.pendingEmit.delete(job.id)
      this.emit('updated', { ...job, logs: [...job.logs], artifacts: [...job.artifacts] })
    }, 150))
  }

  private finish(id: string, status: Job['status'], stage: string, error?: string): void {
    this.patch(id, (job) => {
      job.status = status
      job.stage = stage
      job.finishedAt = new Date().toISOString()
      if (status === 'succeeded') job.progress = 100
      if (error) {
        job.error = error
        job.logs = [...job.logs, error].slice(-MAX_LOG_LINES)
      }
    }, true)
  }

  private pump(lane: Lane): void {
    if (this.running.has(lane) || this.laneBlocker(lane)) return
    // 队列按创建时间先后执行（jobs 数组新任务在前）
    const next = [...this.store.state.jobs].reverse().find((job) => job.status === 'queued' && this.laneOf.get(job.id) === lane)
    if (!next || !next.request) return
    const controller = new AbortController()
    this.running.set(lane, { id: next.id, controller })
    this.patch(next.id, (job) => {
      job.status = 'running'
      job.stage = '开始处理'
      job.startedAt = new Date().toISOString()
    }, true)

    const ctx: RunContext = {
      job: next,
      signal: controller.signal,
      stage: (stage, progress) => this.patch(next.id, (job) => {
        job.stage = stage
        if (typeof progress === 'number' && Number.isFinite(progress)) job.progress = Math.max(job.progress, Math.min(100, progress))
      }),
      log: (line) => this.patch(next.id, (job) => { job.logs = [...job.logs, line].slice(-MAX_LOG_LINES) }),
      artifact: (role, path) => this.patch(next.id, (job) => {
        if (!path || !existsSync(path) || job.artifacts.some((item) => item.path === path)) return
        job.artifacts = [...job.artifacts, { role, path, bytes: statSync(path).size }]
      }, true),
    }

    this.runner(next.request, ctx)
      .then(() => {
        if (controller.signal.aborted) this.finish(next.id, 'cancelled', '已取消')
        else this.finish(next.id, 'succeeded', '完成')
      })
      .catch((error) => {
        if (controller.signal.aborted) this.finish(next.id, 'cancelled', '已取消')
        else this.finish(next.id, 'failed', '失败', errorMessage(error))
      })
      .finally(() => {
        this.running.delete(lane)
        this.laneOf.delete(next.id)
        this.pump(lane)
      })
  }
}
