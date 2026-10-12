import { createDecipheriv } from 'crypto'
import { existsSync } from 'fs'
import { mkdir, readdir, readFile, stat, writeFile } from 'fs/promises'
import { basename, join } from 'path'
import type { NcmFileInfo } from '../../shared/contracts'

// 网易云 NCM 容器：AES-128-ECB 加密的 RC4 密钥 + 元数据 + 封面 + 加密音频流
const CORE_KEY = Buffer.from('hzHRAmso5kInbaxW')
const META_KEY = Buffer.from("#14ljk_!\\]&0U<'(")
const MAGIC = 'CTENFDAM'

function aesEcbDecrypt(data: Buffer, key: Buffer): Buffer {
  const decipher = createDecipheriv('aes-128-ecb', key, null)
  return Buffer.concat([decipher.update(data), decipher.final()])
}

function xorBytes(data: Buffer, value: number): Buffer {
  const result = Buffer.allocUnsafe(data.length)
  for (let i = 0; i < data.length; i++) result[i] = data[i] ^ value
  return result
}

function buildKeyBox(key: Buffer): Uint8Array {
  const box = new Uint8Array(256)
  for (let i = 0; i < 256; i++) box[i] = i
  let last = 0
  let keyOffset = 0
  for (let i = 0; i < 256; i++) {
    const swap = box[i]
    const c = (swap + last + key[keyOffset]) & 0xff
    keyOffset = (keyOffset + 1) % key.length
    box[i] = box[c]
    box[c] = swap
    last = c
  }
  return box
}

function decryptAudio(data: Buffer, box: Uint8Array): Buffer {
  // 流密钥只与位置 (i+1)&0xff 有关，先算出 256 字节的密钥流再循环异或
  const stream = new Uint8Array(256)
  for (let i = 0; i < 256; i++) {
    const j = (i + 1) & 0xff
    stream[i] = box[(box[j] + box[(box[j] + j) & 0xff]) & 0xff]
  }
  const result = Buffer.allocUnsafe(data.length)
  for (let i = 0; i < data.length; i++) result[i] = data[i] ^ stream[i & 0xff]
  return result
}

function detectExtension(audio: Buffer): string {
  if (audio.length < 4) return 'mp3'
  if (audio.subarray(0, 3).toString('latin1') === 'ID3') return 'mp3'
  if (audio.subarray(0, 4).toString('latin1') === 'fLaC') return 'flac'
  if (audio.subarray(0, 4).toString('latin1') === 'RIFF') return 'wav'
  if (audio.subarray(0, 4).toString('latin1') === 'OggS') return 'ogg'
  if (audio[0] === 0xff && (audio[1] & 0xe0) === 0xe0) return 'mp3'
  return 'mp3'
}

function readMetadataFormat(rawMeta: Buffer): string {
  try {
    const text = xorBytes(rawMeta, 0x63).toString('utf8').replace(/^163 key\(Don't modify\):/, '')
    const json = aesEcbDecrypt(Buffer.from(text, 'base64'), META_KEY).toString('utf8').replace(/^music:/, '').replace(/\0+$/g, '')
    const format = (JSON.parse(json) as { format?: unknown }).format
    return typeof format === 'string' ? format.toLowerCase().replace(/^\./, '') : ''
  } catch {
    return ''
  }
}

/** 解密一个 NCM 文件，写入 outputDir，返回生成文件路径（不覆盖已有文件） */
export async function convertNcm(ncmPath: string, outputDir: string): Promise<string> {
  const data = await readFile(ncmPath)
  if (data.subarray(0, 8).toString('latin1') !== MAGIC) throw new Error('不是有效的 NCM 文件')

  let offset = 10
  const readChunk = (label: string): Buffer => {
    if (offset + 4 > data.length) throw new Error(`NCM 文件不完整（${label}）`)
    const length = data.readUInt32LE(offset)
    offset += 4
    if (offset + length > data.length) throw new Error(`NCM 文件不完整（${label}）`)
    const chunk = data.subarray(offset, offset + length)
    offset += length
    return chunk
  }

  const audioKey = aesEcbDecrypt(xorBytes(readChunk('密钥'), 0x64), CORE_KEY).subarray(17)
  if (!audioKey.length) throw new Error('NCM 音频密钥无效')
  const format = readMetadataFormat(readChunk('元数据'))
  offset += 9 // CRC32 + 5 字节保留
  readChunk('封面')

  const audio = decryptAudio(data.subarray(offset), buildKeyBox(audioKey))
  const extension = ['mp3', 'flac', 'wav', 'ogg'].includes(format) ? format : detectExtension(audio)

  await mkdir(outputDir, { recursive: true })
  const stem = basename(ncmPath).replace(/\.ncm$/i, '')
  let target = join(outputDir, `${stem}.${extension}`)
  for (let counter = 2; existsSync(target); counter++) target = join(outputDir, `${stem} (${counter}).${extension}`)
  await writeFile(target, audio, { flag: 'wx' })
  return target
}

export async function scanNcmDirectory(directory: string): Promise<NcmFileInfo[]> {
  if (!directory || !existsSync(directory)) return []
  const entries = await readdir(directory, { withFileTypes: true })
  const files = await Promise.all(entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.ncm'))
    .map(async (entry) => {
      const path = join(directory, entry.name)
      try {
        const info = await stat(path)
        return { name: entry.name, path, size: info.size, mtimeMs: info.mtimeMs }
      } catch {
        return null
      }
    }))
  return files.filter((file): file is NcmFileInfo => Boolean(file)).sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
}
