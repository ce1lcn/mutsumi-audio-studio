import { spawn, type ChildProcess } from 'child_process'
import { StringDecoder } from 'string_decoder'

// 旧 Windows Python 的 .pth 文件可能使用本机编码，强制 UTF-8 会让 site.py 启动失败。
// 保留原生启动编码；管道日志仍通过 PYTHONIOENCODING 使用 UTF-8。
export const PYTHONUTF8 = process.platform === 'win32' ? '0' : '1'

export const PYTHON_ENV = { PYTHONIOENCODING: 'utf-8', PYTHONUTF8 }

// 进度条、ANSI 控制符等终端噪声不进入日志
const ANSI = /\u001b\[[\d;?]*[a-zA-Z]/g
const CONTROL = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F�]/g
const PROGRESS_BAR = /^\s*[\d.]+%\s*[|│█-▏#=> -]+/

export function cleanLogLine(line: string): string {
  const cleaned = line.replace(ANSI, '').replace(CONTROL, '').trim()
  return PROGRESS_BAR.test(cleaned) ? '' : cleaned
}

/** 把子进程 stdout/stderr 按行（UTF-8 安全）交给回调 */
export function readLines(child: ChildProcess, onLine: (line: string, stream: 'stdout' | 'stderr') => void): void {
  for (const stream of ['stdout', 'stderr'] as const) {
    const source = child[stream]
    if (!source) continue
    const decoder = new StringDecoder('utf8')
    let carry = ''
    source.on('data', (chunk: Buffer) => {
      carry += decoder.write(chunk)
      const lines = carry.split(/\r?\n|\r/)
      carry = lines.pop() ?? ''
      for (const line of lines) if (line.trim()) onLine(line, stream)
    })
    source.on('end', () => {
      carry += decoder.end()
      if (carry.trim()) onLine(carry, stream)
      carry = ''
    })
  }
}

/** 尝试把一行解析为带 type 字段的 JSON 事件 */
export function parseEvent<T extends { type: string }>(line: string): T | null {
  const trimmed = line.trim()
  if (!trimmed.startsWith('{')) return null
  try {
    const value = JSON.parse(trimmed) as T
    return value && typeof value.type === 'string' ? value : null
  } catch {
    return null
  }
}

/** Windows 上结束整个进程树（Python 可能派生子进程） */
export function killTree(child: ChildProcess): void {
  if (child.exitCode !== null || child.pid === undefined) return
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
      .on('error', () => child.kill())
  } else {
    child.kill('SIGTERM')
  }
}

export function waitForExit(child: ChildProcess): Promise<number | null> {
  if (child.exitCode !== null) return Promise.resolve(child.exitCode)
  return new Promise((resolve) => {
    child.once('close', (code) => resolve(code))
    child.once('error', () => resolve(null))
  })
}
