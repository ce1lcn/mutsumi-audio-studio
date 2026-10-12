import { useEffect, useState } from 'react'
import { Copy, Cpu, FolderOpen, HardDrive, Info, Play, Plus, RefreshCw, RotateCcw, Save, ScrollText, Server, Square, X } from 'lucide-react'
import type { EngineSettings } from '../../shared/contracts'
import { studio } from '../api'
import { PageHeader } from '../shell/Shell'
import { errorText, useStudio } from '../state/studio'
import { Badge, Button, Card, Dot, Field, IconButton, Notice, PathField, Toggle } from '../ui'

const SERVICE_TEXT = { unknown: '检查中', ready: '已就绪', starting: '启动中', stopped: '未启动', error: '异常' } as const

function DirList({ label, dirs, onChange }: { label: string; dirs: string[]; onChange: (dirs: string[]) => void }) {
  return (
    <Field label={label}>
      <div className="dir-list">
        {dirs.map((dir) => (
          <div key={dir} className="dir-list__item">
            <FolderOpen size={14} />
            <span className="truncate grow" title={dir}>{dir}</span>
            <IconButton icon={X} label="移除" size={14} onClick={() => onChange(dirs.filter((item) => item !== dir))} />
          </div>
        ))}
        <Button size="sm" variant="ghost" icon={Plus} onClick={async () => {
          const path = await studio.dialog.pickFolder()
          if (path && !dirs.includes(path)) onChange([...dirs, path])
        }}>添加文件夹</Button>
      </div>
    </Field>
  )
}

export function SettingsPage() {
  const { engines, updateEngines, service, catalog, rescanCatalog, notify, info } = useStudio()
  const [draft, setDraft] = useState<EngineSettings>(engines)
  const [saving, setSaving] = useState(false)
  const [serviceBusy, setServiceBusy] = useState(false)
  useEffect(() => setDraft(engines), [engines])
  const dirty = JSON.stringify(draft) !== JSON.stringify(engines)

  const setGpt = (patch: Partial<EngineSettings['gptSovits']>) => setDraft((current) => ({ ...current, gptSovits: { ...current.gptSovits, ...patch } }))
  const setRvc = (patch: Partial<EngineSettings['rvc']>) => setDraft((current) => ({ ...current, rvc: { ...current.rvc, ...patch } }))

  async function save() {
    setSaving(true)
    try {
      await updateEngines(draft)
      notify('设置已保存', 'ok')
    } catch (error) {
      notify(errorText(error), 'error')
    } finally {
      setSaving(false)
    }
  }

  async function serviceAction(action: 'start' | 'stop' | 'status') {
    setServiceBusy(true)
    try {
      await studio.service[action]()
    } catch (error) {
      notify(errorText(error), 'error')
    } finally {
      setServiceBusy(false)
    }
  }

  const pickPath = async (kind: 'python' | 'ffmpeg') => (await studio.dialog.pickFiles(kind))[0]
  const pipCommand = `& "${draft.rvc.pythonPath || 'RVC环境\\python.exe'}" -m pip install "sounddevice>=0.4,<0.5"`
  const serviceTone = service.state === 'ready' ? 'ok' : service.state === 'starting' ? 'warn' : service.state === 'error' ? 'danger' : undefined

  return (
    <div className="page">
      <PageHeader title="设置" description="连接本机已有的 GPT-SoVITS 与 RVC 环境。睦音工坊不会下载模型，也不会修改这些环境。"
        actions={<>
          <Button variant="ghost" icon={RotateCcw} disabled={!dirty} onClick={() => setDraft(engines)}>撤销修改</Button>
          <Button variant="primary" icon={Save} disabled={!dirty} loading={saving} onClick={() => void save()}>保存设置</Button>
        </>} />

      <div className="settings-grid">
        <Card title="GPT-SoVITS 文字配音" icon={Server}
          actions={<Badge tone={serviceTone}><Dot tone={serviceTone} pulse={service.state === 'starting'} />{SERVICE_TEXT[service.state]}</Badge>}>
          <div className="service-box">
            <p className="grow small">{service.detail || '—'}{service.managed && ' · 由睦音工坊启动'}</p>
            <div className="row">
              {service.state === 'ready' || service.state === 'starting'
                ? <Button size="sm" icon={Square} disabled={!service.managed || serviceBusy} onClick={() => void serviceAction('stop')}>停止</Button>
                : <Button size="sm" variant="primary" icon={Play} loading={serviceBusy} onClick={() => void serviceAction('start')}>启动服务</Button>}
              <IconButton icon={RefreshCw} label="重新检查" onClick={() => void serviceAction('status')} />
              <IconButton icon={ScrollText} label="打开服务日志" onClick={() => studio.shell.openPath(service.logPath).catch(() => notify('还没有服务日志', 'info'))} />
            </div>
          </div>
          <Field label="GPT-SoVITS 目录" hint="包含 api_v2.py 的整合包目录">
            <PathField value={draft.gptSovits.rootPath} onChange={(value) => setGpt({ rootPath: value })}
              onPick={async () => { const path = await studio.dialog.pickFolder(draft.gptSovits.rootPath); if (path) setGpt({ rootPath: path, pythonPath: `${path}\\runtime\\python.exe` }) }} />
          </Field>
          <Field label="Python 解释器" hint="整合包一般为 runtime\python.exe">
            <PathField value={draft.gptSovits.pythonPath} onChange={(value) => setGpt({ pythonPath: value })}
              onPick={async () => { const path = await pickPath('python'); if (path) setGpt({ pythonPath: path }) }} />
          </Field>
          <Field label="接口地址" hint="仅支持本机地址，默认 http://127.0.0.1:9880">
            <input className="control" value={draft.gptSovits.apiBaseUrl} onChange={(event) => setGpt({ apiBaseUrl: event.target.value })} />
          </Field>
          <Toggle checked={draft.gptSovits.autoStart} onChange={(value) => setGpt({ autoStart: value })} label="打开睦音工坊时自动启动服务（接口已可用时不会重复启动）" />
        </Card>

        <Card title="RVC 翻唱与实时变声" icon={Cpu}
          actions={<Button size="sm" icon={RefreshCw} onClick={() => void rescanCatalog()}>重新扫描</Button>}>
          {catalog?.problems.length ? catalog.problems.map((problem) => <Notice key={problem} tone="warn">{problem}</Notice>)
            : catalog && <Notice tone="ok">已找到 {catalog.models.length} 个声音模型、{catalog.indices.length} 个索引、{catalog.uvrModels.length} 个分离模型</Notice>}
          <Field label="RVC 目录" hint="Retrieval-based-Voice-Conversion-WebUI 所在目录">
            <PathField value={draft.rvc.rootPath} onChange={(value) => setRvc({ rootPath: value })}
              onPick={async () => { const path = await studio.dialog.pickFolder(draft.rvc.rootPath); if (path) setRvc({ rootPath: path }) }} />
          </Field>
          <Field label="Python 解释器" hint="需要能运行 RVC 推理的环境">
            <PathField value={draft.rvc.pythonPath} onChange={(value) => setRvc({ pythonPath: value })}
              onPick={async () => { const path = await pickPath('python'); if (path) setRvc({ pythonPath: path }) }} />
          </Field>
          <Field label="FFmpeg（可留空）" hint="留空时自动在 RVC 环境与 PATH 中查找">
            <PathField value={draft.rvc.ffmpegPath} placeholder="自动查找" onChange={(value) => setRvc({ ffmpegPath: value })}
              onPick={async () => { const path = await pickPath('ffmpeg'); if (path) setRvc({ ffmpegPath: path }) }} />
          </Field>
          <DirList label="额外的声音模型文件夹（.pth）" dirs={draft.rvc.modelDirs} onChange={(dirs) => setRvc({ modelDirs: dirs })} />
          <DirList label="额外的索引文件夹（.index）" dirs={draft.rvc.indexDirs} onChange={(dirs) => setRvc({ indexDirs: dirs })} />
          <Field label="实时变声依赖" hint="实时变声需要 RVC 环境中安装 sounddevice；设备扫描报错时，在 PowerShell 运行：">
            <div className="command-box">
              <code className="selectable">{pipCommand}</code>
              <IconButton icon={Copy} label="复制命令" onClick={() => { void navigator.clipboard.writeText(pipCommand); notify('已复制', 'ok') }} />
            </div>
          </Field>
        </Card>

        <Card title="输出位置" icon={HardDrive}>
          <Field label="默认保存目录" hint={`留空时使用 ${info.defaultOutputDir}；各功能会分别保存在「配音」「翻唱」「NCM 转换」「实时录音」子文件夹`}>
            <PathField value={draft.outputDir} placeholder="文档\睦音工坊" onChange={(value) => setDraft({ ...draft, outputDir: value })}
              onPick={async () => { const path = await studio.dialog.pickFolder(draft.outputDir); if (path) setDraft({ ...draft, outputDir: path }) }} />
          </Field>
          <Button size="sm" variant="ghost" icon={FolderOpen} onClick={() => studio.shell.openPath(engines.outputDir || info.defaultOutputDir).catch(() => notify('文件夹还不存在，生成第一个作品后会自动创建', 'info'))}>打开输出文件夹</Button>
        </Card>

        <Card title="关于" icon={Info}>
          <p className="small">睦音工坊 {info.version} · 本地音频工作站</p>
          <p className="muted small">所有处理都在本机完成。GPT-SoVITS 与 RVC 模型由你自行管理，程序只读取它们。</p>
          <Button size="sm" variant="ghost" icon={FolderOpen} onClick={() => void studio.shell.openPath(info.userDataDir)}>打开数据目录</Button>
        </Card>
      </div>
      {dirty && (
        <div className="save-bar">
          <span>有未保存的修改</span>
          <Button variant="ghost" size="sm" onClick={() => setDraft(engines)}>撤销</Button>
          <Button variant="primary" size="sm" icon={Save} loading={saving} onClick={() => void save()}>保存设置</Button>
        </div>
      )}
    </div>
  )
}
