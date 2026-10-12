import { existsSync } from 'fs'
import { basename, join } from 'path'
import {
  LANGS, SAMPLE_STEPS, SPLIT_METHODS,
  type EngineSettings, type JobRequest, type TtsRequest,
} from '../../shared/contracts'
import { defaultOutputDir } from '../core/paths'
import { normalizeRvcParams } from '../core/settings'
import { clampNumber, isPathString, isRecord, oneOf, stringOr } from '../core/validate'

export type Lane = 'gpu' | 'io'

export interface PreparedRequest {
  request: JobRequest
  title: string
  lane: Lane
}

const OUTPUT_SUBFOLDER: Record<JobRequest['kind'], string> = {
  tts: '配音', 'rvc-full': '翻唱', 'rvc-separate': '翻唱', 'rvc-convert': '翻唱', 'rvc-mix': '翻唱', ncm: 'NCM 转换',
}

function requireFile(value: unknown, label: string, extensions?: string[]): string {
  if (!isPathString(value) || !value.trim()) throw new Error(`请先选择${label}`)
  const path = value.trim()
  if (extensions && !extensions.some((extension) => path.toLowerCase().endsWith(extension))) {
    throw new Error(`${label}格式不正确（需要 ${extensions.join(' / ')}）`)
  }
  if (!existsSync(path)) throw new Error(`${label}不存在：${path}`)
  return path
}

function optionalFile(value: unknown, label: string, extension: string): string {
  if (!isPathString(value) || !value.trim()) return ''
  return requireFile(value, label, [extension])
}

function stem(path: string): string {
  return basename(path).replace(/\.[^.]+$/, '')
}

/** 校验并规范化界面提交的任务，补全输出目录 */
export function prepareRequest(raw: unknown, engines: EngineSettings): PreparedRequest {
  if (!isRecord(raw)) throw new Error('任务参数无效')
  const kind = raw.kind as JobRequest['kind']
  if (!(kind in OUTPUT_SUBFOLDER)) throw new Error('未知的任务类型')
  const requestedDir = isPathString(raw.outputDir) ? raw.outputDir.trim() : ''
  const outputDir = requestedDir || join(engines.outputDir || defaultOutputDir(), OUTPUT_SUBFOLDER[kind])

  switch (kind) {
    case 'tts': {
      const text = stringOr(raw.text, '', 20_000).trim()
      if (!text) throw new Error('请先输入要配音的文字（单次最多 20,000 字）')
      const voiceName = stringOr(raw.voiceName, '', 120).trim()
      if (!voiceName) throw new Error('请选择声音')
      const request: TtsRequest = {
        kind,
        voiceId: stringOr(raw.voiceId, '', 200),
        voiceName,
        gptModel: requireFile(raw.gptModel, 'GPT 权重', ['.ckpt']),
        sovitsModel: requireFile(raw.sovitsModel, 'SoVITS 权重', ['.pth']),
        refAudio: requireFile(raw.refAudio, '参考音频'),
        refText: stringOr(raw.refText, '', 2000).trim(),
        refLang: oneOf(raw.refLang, LANGS, 'ja'),
        text,
        textLang: oneOf(raw.textLang, LANGS, 'zh'),
        splitMethod: oneOf(raw.splitMethod, SPLIT_METHODS, 'cut3'),
        speed: clampNumber(raw.speed, 0.5, 2, 1),
        sampleSteps: oneOf(raw.sampleSteps, SAMPLE_STEPS, 16),
        fragmentInterval: clampNumber(raw.fragmentInterval, 0, 2, 0.3),
        outputDir,
      }
      const preview = text.length > 18 ? `${text.slice(0, 18)}…` : text
      return { request, title: `${voiceName}：${preview}`, lane: 'gpu' }
    }
    case 'rvc-full': {
      const inputPath = requireFile(raw.inputPath, '歌曲文件')
      const modelPath = requireFile(raw.modelPath, 'RVC 声音模型', ['.pth'])
      const request = {
        kind, inputPath, outputDir, modelPath,
        indexPath: optionalFile(raw.indexPath, '索引文件', '.index'),
        uvrModel: stringOr(raw.uvrModel, 'HP5_only_main_vocal', 260) || 'HP5_only_main_vocal',
        params: normalizeRvcParams(raw.params),
      }
      return { request, title: `一键翻唱：${stem(inputPath)} → ${stem(modelPath)}`, lane: 'gpu' }
    }
    case 'rvc-separate': {
      const inputPath = requireFile(raw.inputPath, '音频文件')
      const request = { kind, inputPath, outputDir, uvrModel: stringOr(raw.uvrModel, 'HP5_only_main_vocal', 260) || 'HP5_only_main_vocal', params: normalizeRvcParams(raw.params) }
      return { request, title: `分离人声伴奏：${stem(inputPath)}`, lane: 'gpu' }
    }
    case 'rvc-convert': {
      const inputPath = requireFile(raw.inputPath, '人声文件')
      const modelPath = requireFile(raw.modelPath, 'RVC 声音模型', ['.pth'])
      const request = { kind, inputPath, outputDir, modelPath, indexPath: optionalFile(raw.indexPath, '索引文件', '.index'), params: normalizeRvcParams(raw.params) }
      return { request, title: `换声：${stem(inputPath)} → ${stem(modelPath)}`, lane: 'gpu' }
    }
    case 'rvc-mix': {
      const vocalPath = requireFile(raw.vocalPath, '人声文件')
      const instrumentPath = requireFile(raw.instrumentPath, '伴奏文件')
      const request = { kind, vocalPath, instrumentPath, outputDir, params: normalizeRvcParams(raw.params) }
      return { request, title: `混音：${stem(vocalPath)}`, lane: 'gpu' }
    }
    case 'ncm': {
      const inputPath = requireFile(raw.inputPath, 'NCM 文件', ['.ncm'])
      return { request: { kind, inputPath, outputDir }, title: `NCM 转换：${stem(inputPath)}`, lane: 'io' }
    }
  }
}
