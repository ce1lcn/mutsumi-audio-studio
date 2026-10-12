import { useCallback, useEffect, useMemo, useState } from 'react'
import { FilePlus2, FolderSearch, ListChecks, Music, RefreshCw, Search, Unlock } from 'lucide-react'
import type { NcmFileInfo } from '../../shared/contracts'
import { studio } from '../api'
import { JobCard } from '../components/JobCard'
import { fileName, formatBytes } from '../lib/format'
import { THEME_ART } from '../lib/theme-assets'
import { PageHeader } from '../shell/Shell'
import { errorText, useJobs, useStudio } from '../state/studio'
import { Badge, Button, Card, EmptyState, Field, PathField } from '../ui'

// 未设置时留空，由用户自行选择目录；不内置任何作者本机路径
const DEFAULT_NCM_DIR = ''

export function ToolsPage() {
  const { prefs, updatePrefs, notify, info, page } = useStudio()
  const jobs = useJobs()
  const tools = prefs.tools
  const sourceDir = tools.ncmSourceDir || DEFAULT_NCM_DIR
  const [files, setFiles] = useState<NcmFileInfo[]>([])
  const [extra, setExtra] = useState<NcmFileInfo[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [filter, setFilter] = useState('')
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const scan = useCallback(async (directory: string) => {
    setLoading(true)
    try {
      setFiles(await studio.ncm.scan(directory))
      setSelected(new Set())
    } catch (error) {
      notify(errorText(error), 'error')
    } finally {
      setLoading(false)
      setLoaded(true)
    }
  }, [notify])

  useEffect(() => {
    if (page === 'tools' && !loaded && !loading) void scan(sourceDir)
  }, [page, loaded, loading, scan, sourceDir])

  const all = useMemo(() => [...extra.filter((item) => !files.some((file) => file.path === item.path)), ...files], [extra, files])
  const visible = useMemo(() => all.filter((file) => file.name.toLowerCase().includes(filter.trim().toLowerCase())), [all, filter])
  const ncmJobs = useMemo(() => jobs.filter((job) => job.kind === 'ncm').slice(0, 30), [jobs])
  const running = ncmJobs.filter((job) => job.status === 'running' || job.status === 'queued').length

  function toggle(path: string) {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  async function convert() {
    const paths = all.filter((file) => selected.has(file.path)).map((file) => file.path)
    setSubmitting(true)
    let failed = 0
    for (const inputPath of paths) {
      try {
        await studio.jobs.enqueue({ kind: 'ncm', inputPath, outputDir: tools.ncmOutputDir })
      } catch (error) {
        failed++
        notify(`${fileName(inputPath)}：${errorText(error)}`, 'error')
      }
    }
    setSubmitting(false)
    setSelected(new Set())
    if (paths.length - failed > 0) notify(`已加入 ${paths.length - failed} 个转换任务`, 'ok')
  }

  const art = THEME_ART[prefs.theme]
  return (
    <div className="page">
      <PageHeader title="音频工具" description="批量解密网易云音乐的 NCM 文件，转换出的音频可以一键送去翻唱。" />
      <div className="page-grid">
        <div className="stack stack--lg">
          <Card title="NCM 文件" icon={Unlock} subtitle={`${all.length} 个文件 · 已选 ${selected.size} 个`}
            actions={<>
              <Button size="sm" icon={FilePlus2} onClick={async () => {
                const paths = await studio.dialog.pickFiles('ncm', true)
                if (!paths.length) return
                setExtra((current) => [...current, ...paths.map((path) => ({ name: fileName(path), path, size: 0, mtimeMs: Date.now() }))])
                setSelected((current) => new Set([...current, ...paths]))
              }}>添加文件</Button>
              <Button size="sm" icon={RefreshCw} loading={loading} onClick={() => void scan(sourceDir)}>刷新</Button>
            </>}>
            <Field label="扫描文件夹">
              <PathField value={sourceDir} onPick={async () => {
                const path = await studio.dialog.pickFolder(sourceDir)
                if (!path) return
                updatePrefs({ tools: { ncmSourceDir: path } })
                void scan(path)
              }} pickLabel="更换" />
            </Field>
            <div className="row">
              <div className="voice-search grow">
                <Search size={15} />
                <input className="control" value={filter} placeholder="筛选文件名…" onChange={(event) => setFilter(event.target.value)} />
              </div>
              <Button size="sm" variant="ghost" icon={ListChecks} disabled={!visible.length}
                onClick={() => setSelected(visible.every((file) => selected.has(file.path)) ? new Set() : new Set(visible.map((file) => file.path)))}>
                {visible.length && visible.every((file) => selected.has(file.path)) ? '取消全选' : '全选'}
              </Button>
            </div>
            <div className="file-list">
              {visible.map((file) => (
                <label key={file.path} className={`file-row${selected.has(file.path) ? ' is-selected' : ''}`}>
                  <input type="checkbox" checked={selected.has(file.path)} onChange={() => toggle(file.path)} />
                  <Music size={15} className="file-row__icon" />
                  <span className="truncate grow" title={file.path}>{file.name.replace(/\.ncm$/i, '')}</span>
                  <span className="muted small">{formatBytes(file.size)}</span>
                </label>
              ))}
              {!visible.length && (
                <EmptyState art={art.sticker} title={loading ? '正在扫描…' : '没有找到 NCM 文件'}
                  text={loading ? undefined : '换一个文件夹，或点“添加文件”手动选择。'} action={!loading && <Button size="sm" icon={FolderSearch} onClick={async () => {
                    const path = await studio.dialog.pickFolder()
                    if (path) { updatePrefs({ tools: { ncmSourceDir: path } }); void scan(path) }
                  }}>选择文件夹</Button>} />
              )}
            </div>
            <div className="grid-2">
              <Field label="转换后保存到" hint={tools.ncmOutputDir ? undefined : `默认：${info.defaultOutputDir}\\NCM 转换`}>
                <PathField value={tools.ncmOutputDir} placeholder="使用默认位置" onChange={(value) => updatePrefs({ tools: { ncmOutputDir: value } })}
                  onPick={async () => { const path = await studio.dialog.pickFolder(tools.ncmOutputDir); if (path) updatePrefs({ tools: { ncmOutputDir: path } }) }} />
              </Field>
              <div className="row row--end" style={{ alignSelf: 'end' }}>
                <Button variant="cta" size="lg" mascot={art.sticker} icon={Unlock} disabled={!selected.size || submitting} loading={submitting} onClick={() => void convert()}>
                  {selected.size ? `转换 ${selected.size} 个文件` : '勾选要转换的文件'}
                </Button>
              </div>
            </div>
          </Card>
        </div>

        <div className="stack stack--lg">
          <Card title="转换结果" icon={Music} subtitle="点 ✨ 可把音频送去翻唱换声"
            actions={running > 0 && <Badge tone="accent">{running} 个进行中</Badge>}>
            {ncmJobs.length
              ? <div className="stack stack--sm">{ncmJobs.map((job) => <JobCard key={job.id} job={job} compact />)}</div>
              : <EmptyState title="还没有转换记录" text="勾选文件后点“转换”，每个文件的结果都会列在这里。" />}
          </Card>
        </div>
      </div>
    </div>
  )
}
