import { protocol } from 'electron'
import { createReadStream, existsSync } from 'fs'
import { stat } from 'fs/promises'
import { extname } from 'path'
import { Readable } from 'stream'
import { MEDIA_SCHEME } from '../../shared/ipc'

// 界面通过 studio-media://file/<编码后的绝对路径> 试听本地音频，只允许音频扩展名。
const MIME: Record<string, string> = {
  '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.flac': 'audio/flac', '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.opus': 'audio/ogg',
}

export function registerMediaScheme(): void {
  protocol.registerSchemesAsPrivileged([{
    scheme: MEDIA_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: false },
  }])
}

export function handleMediaProtocol(): void {
  protocol.handle(MEDIA_SCHEME, async (request) => {
    try {
      const url = new URL(request.url)
      const filePath = decodeURIComponent(url.pathname.replace(/^\/+/, ''))
      const mime = MIME[extname(filePath).toLowerCase()]
      if (!mime || !existsSync(filePath)) return new Response('Not found', { status: 404 })
      const size = (await stat(filePath)).size
      const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get('range') || '')
      if (range && (range[1] || range[2])) {
        const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]))
        const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1
        if (start >= size || start > end) {
          return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } })
        }
        const body = Readable.toWeb(createReadStream(filePath, { start, end })) as ReadableStream
        return new Response(body, {
          status: 206,
          headers: { 'Content-Type': mime, 'Content-Length': String(end - start + 1), 'Content-Range': `bytes ${start}-${end}/${size}`, 'Accept-Ranges': 'bytes' },
        })
      }
      const body = Readable.toWeb(createReadStream(filePath)) as ReadableStream
      return new Response(body, { headers: { 'Content-Type': mime, 'Content-Length': String(size), 'Accept-Ranges': 'bytes' } })
    } catch (error) {
      console.error('[Media] 读取失败：', error)
      return new Response('Media error', { status: 500 })
    }
  })
}
