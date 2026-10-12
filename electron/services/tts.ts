import { existsSync } from 'fs'
import { mkdir, writeFile } from 'fs/promises'
import { join } from 'path'
import type { TtsRequest } from '../../shared/contracts'
import { safeFileStem } from '../core/validate'
import { apiUrl, type GptSovitsService } from './gpt-sovits'

interface TtsContext {
  service: GptSovitsService
  apiBaseUrl: string
  outputDir: string
  signal: AbortSignal
  onStage(stage: string, progress: number): void
}

/** 已加载的权重，避免同一角色连续合成时重复切换 */
const loaded = { gpt: '', sovits: '', base: '' }

async function setWeights(ctx: TtsContext, endpoint: string, path: string, label: string): Promise<void> {
  const query = new URLSearchParams({ weights_path: path })
  const response = await fetch(apiUrl(ctx.apiBaseUrl, `${endpoint}?${query}`), { signal: AbortSignal.any([ctx.signal, AbortSignal.timeout(120_000)]) })
  const body = await response.text()
  if (!response.ok) throw new Error(`${label}加载失败（HTTP ${response.status}）：${body.slice(0, 400)}`)
  try {
    const parsed = JSON.parse(body) as { message?: string }
    if (parsed.message && !/success/i.test(parsed.message)) throw new Error(`${label}加载失败：${parsed.message}`)
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error
  }
}

export async function synthesize(request: TtsRequest, ctx: TtsContext): Promise<string> {
  ctx.onStage('连接 GPT-SoVITS 服务', 5)
  await ctx.service.ensureReady()

  if (loaded.base !== ctx.apiBaseUrl) Object.assign(loaded, { gpt: '', sovits: '', base: ctx.apiBaseUrl })
  if (loaded.gpt !== request.gptModel) {
    ctx.onStage('加载 GPT 模型', 15)
    await setWeights(ctx, '/set_gpt_weights', request.gptModel, 'GPT 模型')
    loaded.gpt = request.gptModel
  }
  if (loaded.sovits !== request.sovitsModel) {
    ctx.onStage('加载 SoVITS 模型', 30)
    await setWeights(ctx, '/set_sovits_weights', request.sovitsModel, 'SoVITS 模型')
    loaded.sovits = request.sovitsModel
  }

  ctx.onStage('正在合成语音', 45)
  const response = await fetch(apiUrl(ctx.apiBaseUrl, '/tts'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'audio/wav' },
    body: JSON.stringify({
      text: request.text,
      text_lang: request.textLang,
      ref_audio_path: request.refAudio,
      prompt_text: request.refText,
      prompt_lang: request.refLang,
      text_split_method: request.splitMethod,
      batch_size: 1,
      media_type: 'wav',
      streaming_mode: false,
      speed_factor: request.speed,
      sample_steps: request.sampleSteps,
      fragment_interval: request.fragmentInterval,
    }),
    signal: AbortSignal.any([ctx.signal, AbortSignal.timeout(15 * 60_000)]),
  })
  const bytes = Buffer.from(await response.arrayBuffer())
  if (!response.ok) {
    // 服务端出错时权重状态未知，下次重新加载
    Object.assign(loaded, { gpt: '', sovits: '' })
    throw new Error(`语音合成失败（HTTP ${response.status}）：${bytes.toString('utf8').slice(0, 600)}`)
  }
  if (bytes.length < 44 || bytes.subarray(0, 4).toString('latin1') !== 'RIFF' || bytes.subarray(8, 12).toString('latin1') !== 'WAVE') {
    throw new Error(`GPT-SoVITS 返回的不是有效 WAV：${bytes.subarray(0, 200).toString('utf8')}`)
  }

  ctx.onStage('保存音频', 95)
  await mkdir(ctx.outputDir, { recursive: true })
  const stem = safeFileStem(`${request.voiceName} - ${request.text.slice(0, 24)}`)
  const stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '')
  let target = join(ctx.outputDir, `${stem} ${stamp}.wav`)
  for (let counter = 2; existsSync(target); counter++) target = join(ctx.outputDir, `${stem} ${stamp} (${counter}).wav`)
  await writeFile(target, bytes, { flag: 'wx' })
  return target
}

/** 服务重启后清空已加载记录 */
export function resetLoadedWeights(): void {
  Object.assign(loaded, { gpt: '', sovits: '', base: '' })
}
