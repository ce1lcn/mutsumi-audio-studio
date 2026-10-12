import { useCallback, useEffect, useMemo, useState } from 'react'
import { AudioLines, CircleAlert, FolderOpen, Headphones, Mic2, RefreshCw, Square, Volume2 } from 'lucide-react'
import {
  F0_METHODS, LIVE_PRESET_BLOCK_SECONDS, LIVE_SAMPLE_RATES,
  type LivePreset, type RealtimeAudioDevice,
} from '../../shared/contracts'
import { studio } from '../api'
import { fileName } from '../lib/format'
import { THEME_ART } from '../lib/theme-assets'
import { PageHeader } from '../shell/Shell'
import { errorText, useLive, useStudio } from '../state/studio'
import { Badge, Button, Card, Field, Notice, Segmented, Select, Slider, Toggle } from '../ui'

const PRESETS: { value: LivePreset; label: string }[] = [
  { value: 'stable', label: '稳定' },
  { value: 'balanced', label: '均衡' },
  { value: 'low-latency', label: '低延迟' },
]

const VIRTUAL_DEVICE = /cable|virtual|voicemeeter|vb-audio|立体声混音|stereo mix/i

/** 默认设备优先：系统默认 > 非虚拟设备 > 其他 */
function pickDefault(list: RealtimeAudioDevice[], kind: 'input' | 'output'): string {
  const candidates = list.filter((device) => (kind === 'input' ? device.inputChannels : device.outputChannels) > 0)
  const score = (device: RealtimeAudioDevice) =>
    ((kind === 'input' ? device.isDefaultInput : device.isDefaultOutput) ? 0 : 10) + (VIRTUAL_DEVICE.test(device.name) ? 5 : 0) + hostRank(device)
  return [...candidates].sort((a, b) => score(a) - score(b))[0]?.id ?? ''
}

function hostRank(device: RealtimeAudioDevice): number {
  if (device.hostApi.includes('WASAPI')) return 0
  if (device.hostApi.includes('DirectSound')) return 1
  if (device.hostApi === 'MME') return 2
  return 3
}

function Meter({ label, level }: { label: string; level: number }) {
  const percent = Math.min(100, Math.round(level * 300))
  return (
    <div className="meter">
      <div className="meter__label"><span>{label}</span><b>{percent}%</b></div>
      <div className="meter__track"><div className="meter__fill" style={{ width: `${percent}%` }} /></div>
    </div>
  )
}

export function LivePage() {
  const { prefs, updatePrefs, catalog, notify, page, goto } = useStudio()
  const status = useLive()
  const live = prefs.live
  const [devices, setDevices] = useState<RealtimeAudioDevice[]>([])
  const [scanning, setScanning] = useState(false)
  const [scanError, setScanError] = useState('')
  const [scanned, setScanned] = useState(false)
  const [busy, setBusy] = useState(false)
  const [logs, setLogs] = useState<string[]>([])
  const active = ['starting', 'running', 'stopping'].includes(status.state)

  const scan = useCallback(async () => {
    setScanning(true)
    setScanError('')
    try {
      const list = [...await studio.realtime.devices()].sort((a, b) => hostRank(a) - hostRank(b))
      setDevices(list)
      const firstIn = pickDefault(list, 'input')
      const firstOut = pickDefault(list, 'output')
      const patch: { inputDeviceId?: string; outputDeviceId?: string } = {}
      if (!list.some((device) => device.id === live.inputDeviceId && device.inputChannels > 0)) patch.inputDeviceId = firstIn
      if (!list.some((device) => device.id === live.outputDeviceId && device.outputChannels > 0)) patch.outputDeviceId = firstOut
      if (Object.keys(patch).length) updatePrefs({ live: patch })
    } catch (error) {
      setScanError(errorText(error))
    } finally {
      setScanning(false)
      setScanned(true)
    }
  }, [live.inputDeviceId, live.outputDeviceId, updatePrefs])

  // 第一次打开本页时才扫描设备（扫描不会打开麦克风）
  useEffect(() => {
    if (page === 'live' && !scanned && !scanning) void scan()
  }, [page, scanned, scanning, scan])

  useEffect(() => studio.realtime.onLog((line) => setLogs((list) => [...list.slice(-60), line])), [])

  useEffect(() => {
    if (status.state === 'failed' && status.message) notify(status.message, 'error')
  }, [status.state, status.message, notify])

  const deviceOption = (device: RealtimeAudioDevice) => ({ value: device.id, label: `${device.name}${device.isDefaultInput || device.isDefaultOutput ? '（系统默认）' : ''}`, group: device.hostApi })
  const inputs = useMemo(() => devices.filter((device) => device.inputChannels > 0).map(deviceOption), [devices])
  const outputs = useMemo(() => devices.filter((device) => device.outputChannels > 0).map(deviceOption), [devices])
  const models = (catalog?.models ?? []).map((model) => ({ value: model.path, label: model.name }))
  const indices = (catalog?.indices ?? []).map((index) => ({ value: index.path, label: index.name }))

  function chooseModel(path: string) {
    const stem = fileName(path).replace(/\.pth$/i, '').toLowerCase().replace(/[-_](local|cloud|v\d+)$/i, '')
    const matched = catalog?.indices.find((index) => stem && index.name.toLowerCase().includes(stem))?.path ?? ''
    updatePrefs({ live: { modelPath: path, indexPath: matched } })
  }

  async function start() {
    setBusy(true)
    setLogs([])
    try {
      await studio.realtime.start({
        inputDeviceId: live.inputDeviceId,
        outputDeviceId: live.outputDeviceId,
        modelPath: live.modelPath,
        indexPath: live.indexPath,
        indexRate: live.indexRate,
        sampleRate: live.sampleRate,
        blockSeconds: LIVE_PRESET_BLOCK_SECONDS[live.preset],
        pitch: live.pitch,
        f0Method: live.f0Method,
        outputGain: live.gain,
        record: live.record,
      })
    } catch (error) {
      notify(errorText(error), 'error')
    } finally {
      setBusy(false)
    }
  }

  function setControl(patch: { pitch?: number; gain?: number }) {
    updatePrefs({ live: patch })
    if (status.state === 'running') {
      studio.realtime.update({ pitch: patch.pitch, outputGain: patch.gain }).catch((error) => notify(errorText(error), 'error'))
    }
  }

  const art = THEME_ART[prefs.theme]
  const stateLabel = { stopped: '未开始', starting: '准备中', running: '变声中', stopping: '正在停止', failed: '出错了' }[status.state]
  const canStart = Boolean(live.inputDeviceId && live.outputDeviceId && live.modelPath) && !busy

  return (
    <div className="page">
      <PageHeader title="实时变声" description="把麦克风的声音实时换成喜欢的音色。只有按下“开始变声”后才会打开麦克风。" />
      <div className="page-grid page-grid--live">
        <div className="stack stack--lg">
          <Card title="音频设备" icon={Headphones} subtitle="优先列出 WASAPI 设备；若无法启动可换同一设备的其他驱动"
            actions={<Button size="sm" icon={RefreshCw} loading={scanning} disabled={active} onClick={() => void scan()}>重新扫描</Button>}>
            {scanError && <Notice tone="danger" icon={CircleAlert}>{scanError}<br />如提示缺少 sounddevice，请到“设置 → RVC”查看安装方法。</Notice>}
            <div className="grid-2">
              <Field label={<><Mic2 size={13} /> 麦克风（输入）</>}>
                <Select value={live.inputDeviceId} placeholder={scanning ? '正在读取…' : '选择输入设备…'} options={inputs} disabled={active} onChange={(value) => updatePrefs({ live: { inputDeviceId: value } })} />
              </Field>
              <Field label={<><Volume2 size={13} /> 输出到</>} hint="发给其他软件时选择虚拟声卡（如 VB-Cable）的播放端">
                <Select value={live.outputDeviceId} placeholder={scanning ? '正在读取…' : '选择耳机或虚拟声卡…'} options={outputs} disabled={active} onChange={(value) => updatePrefs({ live: { outputDeviceId: value } })} />
              </Field>
              <Field label="采样率">
                <Select value={live.sampleRate} disabled={active} options={LIVE_SAMPLE_RATES.map((rate) => ({ value: rate, label: `${rate.toLocaleString()} Hz` }))} onChange={(value) => updatePrefs({ live: { sampleRate: value } })} />
              </Field>
              <Field label="延迟与稳定" hint={`每块 ${Math.round(LIVE_PRESET_BLOCK_SECONDS[live.preset] * 1000)} ms；卡顿时选“稳定”`}>
                <Segmented block value={live.preset} disabled={active} onChange={(value) => updatePrefs({ live: { preset: value } })} options={PRESETS} />
              </Field>
            </div>
          </Card>

          <Card title="声音" icon={AudioLines}>
            {models.length === 0 && <Notice tone="warn" icon={CircleAlert}>还没有找到 RVC 声音模型。<button type="button" className="link-button" onClick={() => goto('settings')}>去设置模型目录</button></Notice>}
            <div className="grid-2">
              <Field label="声音模型">
                <Select value={live.modelPath} placeholder="选择声音模型…" options={models} disabled={active} onChange={chooseModel} />
              </Field>
              <Field label="特征索引">
                <Select value={live.indexPath} placeholder="不使用索引" options={indices} disabled={active} onChange={(value) => updatePrefs({ live: { indexPath: value } })} />
              </Field>
              <Field label="音高提取算法" hint="实时推荐 RMVPE；显卡较弱时可试 PM">
                <Select value={live.f0Method} disabled={active} options={F0_METHODS.map((method) => ({ value: method, label: method === 'rmvpe' ? 'RMVPE（推荐）' : method.toUpperCase() }))} onChange={(value) => updatePrefs({ live: { f0Method: value } })} />
              </Field>
              <Slider label="索引比例" value={live.indexRate} min={0} max={1} step={0.05} disabled={active || !live.indexPath} onChange={(value) => updatePrefs({ live: { indexRate: value } })} />
            </div>
          </Card>
        </div>

        <div className="stack stack--lg">
          <Card className={`live-panel live-panel--${status.state}`}>
            <div className="live-panel__hero">
              <img src={art.sticker} alt="" className="live-panel__art" />
              <div>
                <Badge tone={status.state === 'running' ? 'ok' : status.state === 'failed' ? 'danger' : active ? 'warn' : undefined}>{stateLabel}</Badge>
                <p className="live-panel__message">{status.message || '准备好后点击开始。建议佩戴耳机，避免扬声器回授。'}</p>
              </div>
            </div>
            {active
              ? <Button variant="danger" size="lg" icon={Square} disabled={status.state === 'stopping'} onClick={() => void studio.realtime.stop()}>停止变声</Button>
              : <Button variant="cta" size="lg" icon={Mic2} loading={busy} disabled={!canStart} onClick={() => void start()}>开始变声</Button>}

            <Meter label="麦克风输入" level={status.inputLevel} />
            <Meter label="变声输出" level={status.outputLevel} />
            <div className="live-stats">
              <div><span>推理耗时</span><b>{status.inferenceMs == null ? '—' : `${Math.round(status.inferenceMs)} ms`}</b></div>
              <div><span>分块</span><b>{status.blockDurationMs == null ? '—' : `${Math.round(status.blockDurationMs)} ms`}</b></div>
              <div><span>卡顿次数</span><b className={status.overflowCount ? 'is-warn' : ''}>{status.overflowCount}</b></div>
            </div>

            <Slider label="变调" value={live.pitch} min={-12} max={12} step={1} format={(value) => `${value > 0 ? '+' : ''}${value} 半音`}
              hint="运行中拖动会即时生效" onChange={(value) => setControl({ pitch: value })} />
            <Slider label="输出音量" value={live.gain} min={0} max={2} step={0.05} format={(value) => `${Math.round(value * 100)}%`} onChange={(value) => setControl({ gain: value })} />
            <Toggle checked={live.record} disabled={active} onChange={(value) => updatePrefs({ live: { record: value } })} label="同时录下变声后的声音" />
            {status.recordingPath && (
              <Button size="sm" variant="ghost" icon={FolderOpen} onClick={() => studio.shell.reveal(status.recordingPath!).catch((error) => notify(errorText(error), 'error'))}>
                录音：{fileName(status.recordingPath)}
              </Button>
            )}
          </Card>

          {logs.length > 0 && (
            <Card title="运行日志">
              <pre className="job__log selectable">{logs.join('\n')}</pre>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}
