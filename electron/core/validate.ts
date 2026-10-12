// 跨进程输入校验。界面传来的数据一律视为不可信。

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function isPathString(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 4096 && !value.includes('\0')
}

export function pathOr(value: unknown, fallback: string): string {
  return isPathString(value) ? value.trim() : fallback
}

export function stringOr(value: unknown, fallback: string, maxLength = 4096): string {
  return typeof value === 'string' && value.length <= maxLength ? value : fallback
}

export function oneOf<T extends string | number>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback
}

export function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const number = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(max, Math.max(min, number))
}

export function clampInteger(value: unknown, min: number, max: number, fallback: number): number {
  return Math.round(clampNumber(value, min, max, fallback))
}

export function boolOr(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

export function pathList(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value) || value.length > 100) return fallback
  return [...new Set(value.filter(isPathString).map((item) => item.trim()).filter(Boolean))]
}

export function isLoopbackUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 512) return false
  try {
    const parsed = new URL(value)
    return ['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname) && ['http:', 'https:'].includes(parsed.protocol)
  } catch {
    return false
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Windows 文件名中不可用的字符替换为下划线 */
export function safeFileStem(value: string, fallback = '音频'): string {
  return value.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/\s+/g, ' ').replace(/[. ]+$/g, '').trim().slice(0, 70) || fallback
}
