import type { ArtifactRole, JobKind, JobStatus, Lang, SplitMethod } from '../../shared/contracts'

export function fileName(path: string): string {
  return path.split(/[\\/]/).pop() || path
}

export function fileStem(path: string): string {
  return fileName(path).replace(/\.[^.]+$/, '')
}

export function formatBytes(bytes: number): string {
  if (!bytes) return '—'
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00'
  const minutes = Math.floor(seconds / 60)
  return `${minutes}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`
}

export function formatTime(iso?: string): string {
  if (!iso) return ''
  const date = new Date(iso)
  const now = new Date()
  const time = date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  if (date.toDateString() === now.toDateString()) return `今天 ${time}`
  const yesterday = new Date(now.getTime() - 86_400_000)
  if (date.toDateString() === yesterday.toDateString()) return `昨天 ${time}`
  return `${date.getMonth() + 1}月${date.getDate()}日 ${time}`
}

export function elapsed(start?: string, end?: string): string {
  if (!start) return ''
  const seconds = Math.max(0, ((end ? new Date(end) : new Date()).getTime() - new Date(start).getTime()) / 1000)
  if (seconds < 60) return `${Math.round(seconds)} 秒`
  return `${Math.floor(seconds / 60)} 分 ${Math.round(seconds % 60)} 秒`
}

export const LANG_LABEL: Record<Lang, string> = { zh: '中文', ja: '日本語', en: 'English' }

export const SPLIT_LABEL: Record<SplitMethod, string> = {
  cut0: '不切分', cut1: '每四句一段', cut2: '每 50 字一段', cut3: '按中文句号', cut4: '按英文句号', cut5: '按标点符号',
}

export const ROLE_LABEL: Record<ArtifactRole, string> = {
  speech: '配音', vocal: '人声', instrument: '伴奏', converted: '换声人声', mixed: '混音成品', decoded: '解密音频', recording: '录音',
}

export const KIND_LABEL: Record<JobKind, string> = {
  tts: '文字配音', 'rvc-full': '一键翻唱', 'rvc-separate': '分离', 'rvc-convert': '换声', 'rvc-mix': '混音', ncm: 'NCM 转换', live: '实时变声',
}

export const STATUS_LABEL: Record<JobStatus, string> = {
  queued: '排队中', running: '进行中', succeeded: '完成', failed: '失败', cancelled: '已取消', interrupted: '已中断',
}

export const STATUS_TONE: Record<JobStatus, 'ok' | 'warn' | 'danger' | 'accent' | undefined> = {
  queued: undefined, running: 'accent', succeeded: 'ok', failed: 'danger', cancelled: undefined, interrupted: 'warn',
}
