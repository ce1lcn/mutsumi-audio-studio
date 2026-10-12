import { useEffect, useMemo, useState, type DragEvent } from 'react'
import {
  AudioWaveform, Blend, CircleAlert, FileAudio, Music2, RefreshCw, Scissors, SlidersHorizontal, Sparkles, Wand2,
} from 'lucide-react'
import { AUDIO_FORMATS, F0_METHODS, type Job, type JobArtifact, type JobRequest, type RvcParams } from '../../shared/contracts'
import { studio } from '../api'
import { JobCard } from '../components/JobCard'
import { fileName } from '../lib/format'
import { THEME_ART } from '../lib/theme-assets'
import { PageHeader } from '../shell/Shell'
import { errorText, useJobs, useStudio } from '../state/studio'
import { Button, Card, Collapse, EmptyState, Field, Notice, NumberInput, PathField, Segmented, Select, Slider } from '../ui'

type Mode = 'full' | 'separate' | 'convert' | 'mix'

const MODES: { value: Mode; label: string; icon: typeof Music2 }[] = [
  { value: 'full', label: '一键翻唱', icon: Sparkles },
  { value: 'separate', label: '分离人声伴奏', icon: Scissors },
  { value: 'convert', label: '单独换声', icon: Wand2 },
  { value: 'mix', label: '单独混音', icon: Blend },
]

const MODE_HINT: Record<Mode, string> = {
  full: '放入一首歌：自动分离人声与伴奏 → 用选择的声音重新演唱 → 与伴奏混音。',
  separate: '把歌曲拆成「人声」和「伴奏」两个文件，可继续用于换声或混音。',
  convert: '把一段干声（最好是已分离的人声）换成选择的声音。',
  mix: '把人声与伴奏按设定音量合成为成品。',
}

const COVER_KINDS = new Set(['rvc-full', 'rvc-separate', 'rvc-convert', 'rvc-mix'])

function useDropPath(onPath: (path: string) => void) {
  const [over, setOver] = useState(false)
  return {
    over,
    props: {
      onDragOver: (event: DragEvent) => { event.preventDefault(); setOver(true) },
      onDragLeave: () => setOver(false),
      onDrop: (event: DragEvent) => {
        event.preventDefault()
        setOver(false)
        const file = event.dataTransfer.files[0]
        if (file) onPath(studio.media.pathForFile(file))
      },
    },
  }
}

function SourceSlot({ label, hint, value, onChange }: { label: string; hint: string; value: string; onChange: (path: string) => void }) {
  const drop = useDropPath(onChange)
  return (
    <div className={`drop-slot${drop.over ? ' is-over' : ''}${value ? ' has-file' : ''}`} {...drop.props}>
      <span className="drop-slot__icon"><FileAudio size={20} /></span>
      <div className="drop-slot__text">
        <strong>{label}</strong>
        <span className="truncate" title={value}>{value ? fileName(value) : hint}</span>
      </div>
      <Button size="sm" onClick={async () => { const [path] = await studio.dialog.pickFiles('audio'); if (path) onChange(path) }}>{value ? '更换' : '选择文件'}</Button>
    </div>
  )
}

export function CoverPage() {
  const { prefs, updatePrefs, catalog, rescanCatalog, notify, coverSource, info, goto } = useStudio()
  const jobs = useJobs()
  const cover = prefs.cover
  const params = cover.params
  const [mode, setMode] = useState<Mode>('full')
  const [inputPath, setInputPath] = useState('')
  const [vocalPath, setVocalPath] = useState('')
  const [instrumentPath, setInstrumentPath] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!coverSource.path) return
    setInputPath(coverSource.path)
    setMode((current) => (current === 'mix' || current === 'convert' ? 'full' : current))
  }, [coverSource])

  const setParams = (patch: Partial<RvcParams>) => updatePrefs({ cover: { params: patch } })
  const coverJobs = useMemo(() => jobs.filter((job) => COVER_KINDS.has(job.kind)).slice(0, 8), [jobs])

  const modelOptions = (catalog?.models ?? []).map((model) => ({ value: model.path, label: model.name }))
  const indexOptions = (catalog?.indices ?? []).map((index) => ({ value: index.path, label: index.name }))
  const uvrOptions = (catalog?.uvrModels ?? []).map((model) => ({ value: model.name, label: model.name }))
  const needsVoice = mode === 'full' || mode === 'convert'
  const needsUvr = mode === 'full' || mode === 'separate'
  const needsMix = mode === 'full' || mode === 'mix'

  function chooseModel(path: string) {
    const stem = fileName(path).replace(/\.pth$/i, '').toLowerCase().replace(/[-_](local|cloud|v\d+)$/i, '')
    const matched = catalog?.indices.find((index) => stem && index.name.toLowerCase().includes(stem))?.path ?? ''
    updatePrefs({ cover: { modelPath: path, indexPath: matched } })
  }

  function useArtifact(artifact: JobArtifact) {
    if (artifact.role === 'vocal') { setInputPath(artifact.path); setVocalPath(artifact.path); setMode('convert'); notify('已把人声放入“单独换声”', 'info') }
    else if (artifact.role === 'instrument') { setInstrumentPath(artifact.path); setMode('mix'); notify('已把伴奏放入“单独混音”', 'info') }
    else if (artifact.role === 'converted') { setVocalPath(artifact.path); setMode('mix'); notify('已把换声人声放入“单独混音”', 'info') }
    else { setInputPath(artifact.path); setMode('full') }
  }

  // 找到最近一次分离的伴奏，混音时可一键带入
  const lastInstrument = useMemo(() => {
    for (const job of jobs) {
      const found = job.artifacts.find((artifact) => artifact.role === 'instrument')
      if (found) return found.path
    }
    return ''
  }, [jobs])

  async function start() {
    const base = { outputDir: cover.outputDir, params }
    let request: JobRequest
    if (mode === 'full') request = { kind: 'rvc-full', inputPath, modelPath: cover.modelPath, indexPath: cover.indexPath, uvrModel: cover.uvrModel, ...base }
    else if (mode === 'separate') request = { kind: 'rvc-separate', inputPath, uvrModel: cover.uvrModel, ...base }
    else if (mode === 'convert') request = { kind: 'rvc-convert', inputPath, modelPath: cover.modelPath, indexPath: cover.indexPath, ...base }
    else request = { kind: 'rvc-mix', vocalPath, instrumentPath, ...base }
    setSubmitting(true)
    try {
      const job: Job = await studio.jobs.enqueue(request)
      notify(`已加入队列：${job.title}`, 'ok')
    } catch (error) {
      notify(errorText(error), 'error')
    } finally {
      setSubmitting(false)
    }
  }

  const ready = mode === 'mix' ? Boolean(vocalPath && instrumentPath) : Boolean(inputPath) && (!needsVoice || Boolean(cover.modelPath))
  const art = THEME_ART[prefs.theme]

  return (
    <div className="page">
      <PageHeader title="翻唱换声" description="RVC 声音转换与 UVR 人声分离：从一首歌到翻唱成品，每一步都可以单独完成。"
        actions={<Button icon={RefreshCw} onClick={() => void rescanCatalog().then((next) => next && notify(`找到 ${next.models.length} 个声音模型`, 'ok'))}>刷新模型</Button>} />

      <Segmented value={mode} onChange={setMode} options={MODES} />
      <p className="mode-hint">{MODE_HINT[mode]}</p>

      {catalog && catalog.problems.length > 0 && (
        <Notice tone="warn" icon={CircleAlert}>
          {catalog.problems.join('；')}。
          <button type="button" className="link-button" onClick={() => goto('settings')}>去设置</button>
        </Notice>
      )}

      <div className="page-grid">
        <div className="stack stack--lg">
          <Card title="素材" icon={FileAudio} subtitle="可以直接把文件拖进来；支持 NCM，会先自动解密">
            {mode === 'mix' ? (
              <div className="stack stack--sm">
                <SourceSlot label="人声" hint="换声后的人声或干声" value={vocalPath} onChange={setVocalPath} />
                <SourceSlot label="伴奏" hint="分离出的伴奏" value={instrumentPath} onChange={setInstrumentPath} />
                {!instrumentPath && lastInstrument && (
                  <Button size="sm" variant="ghost" icon={Music2} onClick={() => setInstrumentPath(lastInstrument)}>使用最近分离的伴奏：{fileName(lastInstrument)}</Button>
                )}
              </div>
            ) : (
              <SourceSlot label={mode === 'convert' ? '人声 / 干声' : '歌曲'} hint={mode === 'convert' ? '拖入或选择一段人声' : '拖入或选择一首歌（mp3 / flac / wav / ncm…）'}
                value={inputPath} onChange={setInputPath} />
            )}
          </Card>

          {needsVoice && (
            <Card title="声音" icon={Wand2} subtitle={`${modelOptions.length} 个 RVC 模型 · ${indexOptions.length} 个索引`}>
              <div className="grid-2">
                <Field label="声音模型">
                  <Select value={cover.modelPath} placeholder="选择声音模型…" options={modelOptions} onChange={chooseModel} />
                </Field>
                <Field label="特征索引" hint={cover.indexPath ? '已按模型名自动匹配，可手动更换' : '可选；使用索引通常更像目标音色'}>
                  <Select value={cover.indexPath} placeholder="不使用索引" options={indexOptions} onChange={(value) => updatePrefs({ cover: { indexPath: value } })} />
                </Field>
              </div>
              <Slider label="变调" value={params.pitch} min={-24} max={24} step={1}
                format={(value) => `${value > 0 ? '+' : ''}${value} 半音`}
                hint="男声唱女声通常 +12，女声唱男声通常 -12；同性别一般 0"
                onChange={(value) => setParams({ pitch: value })} />
            </Card>
          )}

          {(needsUvr || needsMix) && (
            <Card title={needsUvr ? '分离与混音' : '混音'} icon={AudioWaveform}>
              {needsUvr && (
                <div className="grid-2">
                  <Field label="分离模型" hint="HP5 只保留主唱；HP2 保留全部人声">
                    <Select value={cover.uvrModel} options={uvrOptions.length ? uvrOptions : [{ value: cover.uvrModel, label: cover.uvrModel }]} onChange={(value) => updatePrefs({ cover: { uvrModel: value } })} />
                  </Field>
                  <Slider label="人声提取激进程度" value={params.uvrAggression} min={0} max={20} step={1} onChange={(value) => setParams({ uvrAggression: value })} />
                </div>
              )}
              {needsMix && (
                <div className="grid-2">
                  <Slider label="伴奏音量" value={params.backgroundVolume} min={0} max={2} step={0.05} format={(value) => `${Math.round(value * 100)}%`} onChange={(value) => setParams({ backgroundVolume: value })} />
                  <Slider label="人声音量" value={params.vocalVolume} min={0} max={2} step={0.05} format={(value) => `${Math.round(value * 100)}%`} onChange={(value) => setParams({ vocalVolume: value })} />
                </div>
              )}
            </Card>
          )}

          {needsVoice && (
            <Collapse title="高级换声参数" icon={SlidersHorizontal}>
              <div className="grid-2">
                <Field label="音高提取算法" hint="RMVPE 效果最好，推荐">
                  <Select value={params.f0Method} options={F0_METHODS.map((method) => ({ value: method, label: method === 'rmvpe' ? 'RMVPE（推荐）' : method.toUpperCase() }))} onChange={(value) => setParams({ f0Method: value })} />
                </Field>
                <Field label="说话人 ID"><NumberInput value={params.speakerId} min={0} onChange={(value) => setParams({ speakerId: value })} /></Field>
                <Slider label="索引比例" value={params.indexRate} min={0} max={1} step={0.05} hint="越高越像目标音色，过高可能有杂音" onChange={(value) => setParams({ indexRate: value })} />
                <Slider label="呼吸与辅音保护" value={params.protect} min={0} max={0.5} step={0.01} hint="0.5 为关闭保护" onChange={(value) => setParams({ protect: value })} />
                <Slider label="响度包络融合" value={params.volumeEnvelope} min={0} max={1} step={0.05} hint="越接近 1 越贴近原唱的音量起伏" onChange={(value) => setParams({ volumeEnvelope: value })} />
                <Slider label="中值滤波半径" value={params.filterRadius} min={0} max={7} step={1} hint="≥3 可减少哑音" onChange={(value) => setParams({ filterRadius: value })} />
                <Field label="输出重采样" hint="0 表示保持模型采样率">
                  <Select value={params.resampleRate} options={[0, 32000, 40000, 44100, 48000].map((rate) => ({ value: rate, label: rate ? `${rate} Hz` : '不重采样' }))} onChange={(value) => setParams({ resampleRate: value })} />
                </Field>
              </div>
            </Collapse>
          )}

          <Card>
            <div className="grid-2">
              <Field label="保存到" hint={cover.outputDir ? undefined : `默认：${info.defaultOutputDir}\\翻唱`}>
                <PathField value={cover.outputDir} placeholder="使用默认位置" onChange={(value) => updatePrefs({ cover: { outputDir: value } })}
                  onPick={async () => { const path = await studio.dialog.pickFolder(cover.outputDir); if (path) updatePrefs({ cover: { outputDir: path } }) }} />
              </Field>
              <Field label="输出格式">
                <Segmented value={params.outputFormat} onChange={(value) => setParams({ outputFormat: value })}
                  options={AUDIO_FORMATS.map((format) => ({ value: format, label: format.toUpperCase() }))} />
              </Field>
            </div>
            <div className="row row--end">
              <Button variant="cta" size="lg" mascot={art.sticker} icon={MODES.find((item) => item.value === mode)!.icon}
                disabled={!ready || submitting} loading={submitting} onClick={() => void start()}>
                {mode === 'full' ? '开始一键翻唱' : mode === 'separate' ? '开始分离' : mode === 'convert' ? '开始换声' : '开始混音'}
              </Button>
            </div>
          </Card>
        </div>

        <div className="stack stack--lg">
          <Card title="进度与结果" icon={Music2} subtitle="点 ✨ 可把结果放进下一步"
            actions={coverJobs.length > 0 && <Button size="sm" variant="ghost" onClick={() => goto('jobs')}>全部</Button>}>
            {coverJobs.length
              ? <div className="stack stack--sm">{coverJobs.map((job) => <JobCard key={job.id} job={job} compact onUseArtifact={useArtifact} />)}</div>
              : <EmptyState art={art.sticker} title="还没有翻唱任务" text="选择歌曲和声音后开始，进度和生成的文件会显示在这里。" />}
          </Card>
        </div>
      </div>
    </div>
  )
}
