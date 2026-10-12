import { useEffect, useMemo, useState } from 'react'
import { AudioLines, Boxes, CheckCircle2, CircleAlert, FolderOpen, Pause, Play, Plus, Save, Search, Trash2, UserRound, X } from 'lucide-react'
import { LANGS, type VoiceFileCheck, type VoiceProfile } from '../../shared/contracts'
import { studio } from '../api'
import { LANG_LABEL, fileName } from '../lib/format'
import { PageHeader } from '../shell/Shell'
import { usePlayer } from '../state/player'
import { errorText, useStudio } from '../state/studio'
import { Badge, Button, Card, EmptyState, Field, IconButton, Notice, PathField, Segmented } from '../ui'

function blankVoice(): VoiceProfile {
  return { id: `voice-${Date.now().toString(36)}`, name: '', group: '自定义', gptModel: '', sovitsModel: '', refAudio: '', refText: '', refLang: 'ja' }
}

function matchIndex(modelPath: string, indices: { name: string; path: string }[]): string {
  const stem = fileName(modelPath).replace(/\.pth$/i, '').toLowerCase().replace(/[-_](local|cloud|v\d+)$/i, '')
  return indices.find((index) => stem && index.name.toLowerCase().includes(stem))?.name ?? ''
}

export function LibraryPage() {
  const { voices, setVoices, catalog, notify, goto } = useStudio()
  const player = usePlayer()
  const [tab, setTab] = useState<'voices' | 'rvc'>('voices')
  const [checks, setChecks] = useState<Record<string, VoiceFileCheck>>({})
  const [editing, setEditing] = useState<VoiceProfile | null>(null)
  const [search, setSearch] = useState('')

  useEffect(() => { studio.voices.check().then(setChecks).catch(() => undefined) }, [voices])

  const grouped = useMemo(() => {
    const keyword = search.trim().toLowerCase()
    const map = new Map<string, VoiceProfile[]>()
    for (const voice of voices) {
      if (keyword && !`${voice.name}${voice.group}`.toLowerCase().includes(keyword)) continue
      map.set(voice.group, [...(map.get(voice.group) ?? []), voice])
    }
    return [...map.entries()]
  }, [voices, search])
  const missingCount = voices.filter((voice) => { const check = checks[voice.id]; return check && !(check.gptModel && check.sovitsModel && check.refAudio) }).length

  async function save() {
    if (!editing) return
    if (!editing.name.trim()) { notify('请填写角色名称', 'error'); return }
    try {
      setVoices(await studio.voices.save(editing))
      notify(`已保存「${editing.name}」`, 'ok')
      setEditing(null)
    } catch (error) {
      notify(errorText(error), 'error')
    }
  }

  async function remove(voice: VoiceProfile) {
    if (!window.confirm(`从声音库移除「${voice.name}」？\n只删除档案，模型和参考音频文件会保留。`)) return
    setVoices(await studio.voices.remove(voice.id))
    if (editing?.id === voice.id) setEditing(null)
  }

  const pick = async (kind: 'gpt' | 'sovits' | 'audio', key: 'gptModel' | 'sovitsModel' | 'refAudio') => {
    const [path] = await studio.dialog.pickFiles(kind)
    if (path && editing) {
      const next = { ...editing, [key]: path }
      // 选参考音频时，用文件名猜测参考文本
      if (key === 'refAudio' && !editing.refText) next.refText = fileName(path).replace(/\.[^.]+$/, '').replace(/^\([^)]*\)/, '').trim()
      setEditing(next)
    }
  }

  return (
    <div className="page">
      <PageHeader title="声音库" description="管理 GPT-SoVITS 角色档案，查看本机可用的 RVC 声音模型。这里只整理路径，不会移动或删除模型文件。"
        actions={<Segmented value={tab} onChange={setTab} options={[{ value: 'voices', label: '配音角色', icon: UserRound }, { value: 'rvc', label: 'RVC 模型', icon: Boxes }]} />} />

      {tab === 'voices' ? (
        <div className="page-grid">
          <Card title="配音角色" icon={UserRound} subtitle={`${voices.length} 个角色${missingCount ? ` · ${missingCount} 个缺少文件` : ''}`}
            actions={<Button variant="primary" icon={Plus} onClick={() => setEditing(blankVoice())}>添加角色</Button>}>
            <div className="voice-search">
              <Search size={15} />
              <input className="control" value={search} placeholder="搜索角色或分组…" onChange={(event) => setSearch(event.target.value)} />
            </div>
            {grouped.map(([group, list]) => (
              <div key={group} className="library-group">
                <div className="library-group__title">{group}<span>{list.length}</span></div>
                <div className="library-grid">
                  {list.map((voice) => {
                    const check = checks[voice.id]
                    const ok = !check || (check.gptModel && check.sovitsModel && check.refAudio)
                    return (
                      <div key={voice.id} className={`library-card${editing?.id === voice.id ? ' is-selected' : ''}`}>
                        <span className="voice-tile__avatar">{voice.name.slice(0, 1)}</span>
                        <button type="button" className="library-card__main" onClick={() => setEditing({ ...voice })}>
                          <strong className="truncate">{voice.name}</strong>
                          <small className="truncate">{ok ? `${LANG_LABEL[voice.refLang]}参考 · ${voice.refText || '无参考文本'}` : '缺少文件，点击补全'}</small>
                        </button>
                        {ok ? <CheckCircle2 size={16} className="library-card__ok" /> : <Badge tone="warn">缺文件</Badge>}
                        {voice.refAudio && check?.refAudio && (
                          <IconButton icon={player.path === voice.refAudio && player.playing ? Pause : Play} label="试听参考音频" onClick={() => player.toggle(voice.refAudio)} />
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
            {!grouped.length && <EmptyState title="没有匹配的角色" text="试试别的关键词，或添加一个新角色。" />}
          </Card>

          <div className="stack stack--lg">
            {editing ? (
              <Card title={voices.some((voice) => voice.id === editing.id) ? '编辑角色' : '新角色'} icon={AudioLines}
                actions={<IconButton icon={X} label="关闭" onClick={() => setEditing(null)} />}>
                <div className="grid-2">
                  <Field label="名称"><input className="control" value={editing.name} onChange={(event) => setEditing({ ...editing, name: event.target.value })} /></Field>
                  <Field label="分组"><input className="control" value={editing.group} list="voice-groups" onChange={(event) => setEditing({ ...editing, group: event.target.value })} /></Field>
                </div>
                <datalist id="voice-groups">{[...new Set(voices.map((voice) => voice.group))].map((group) => <option key={group} value={group} />)}</datalist>
                <Field label="GPT 权重（.ckpt）" hint={editing.gptModel && checks[editing.id]?.gptModel === false ? '文件不存在' : undefined} hintTone="error">
                  <PathField value={editing.gptModel} onChange={(value) => setEditing({ ...editing, gptModel: value })} onPick={() => void pick('gpt', 'gptModel')} />
                </Field>
                <Field label="SoVITS 权重（.pth）" hint={editing.sovitsModel && checks[editing.id]?.sovitsModel === false ? '文件不存在' : undefined} hintTone="error">
                  <PathField value={editing.sovitsModel} onChange={(value) => setEditing({ ...editing, sovitsModel: value })} onPick={() => void pick('sovits', 'sovitsModel')} />
                </Field>
                <Field label="参考音频" hint="3~10 秒、吐字清晰的一句话效果最好">
                  <PathField value={editing.refAudio} onChange={(value) => setEditing({ ...editing, refAudio: value })} onPick={() => void pick('audio', 'refAudio')} />
                </Field>
                <Field label="参考音频的原文">
                  <textarea className="control" rows={3} value={editing.refText} onChange={(event) => setEditing({ ...editing, refText: event.target.value })} />
                </Field>
                <Field label="参考音频语言">
                  <Segmented value={editing.refLang} onChange={(value) => setEditing({ ...editing, refLang: value })} options={LANGS.map((lang) => ({ value: lang, label: LANG_LABEL[lang] }))} />
                </Field>
                <div className="row row--between">
                  {voices.some((voice) => voice.id === editing.id)
                    ? <Button variant="danger" icon={Trash2} onClick={() => void remove(editing)}>移除</Button> : <span />}
                  <div className="row">
                    <Button variant="ghost" onClick={() => setEditing(null)}>取消</Button>
                    <Button variant="primary" icon={Save} onClick={() => void save()}>保存</Button>
                  </div>
                </div>
              </Card>
            ) : (
              <Card title="小贴士" icon={AudioLines}>
                <p className="muted small">点左侧任意角色即可编辑。一个角色需要同一套训练得到的 GPT 权重（.ckpt）与 SoVITS 权重（.pth），再加一段参考音频和它的原文。</p>
                <p className="muted small">带「缺文件」标记的角色暂时不能配音，补全路径后即可使用。</p>
              </Card>
            )}
          </div>
        </div>
      ) : (
        <Card title="RVC 声音模型" icon={Boxes} subtitle={catalog ? `${catalog.models.length} 个模型 · ${catalog.indices.length} 个索引 · ${catalog.uvrModels.length} 个分离模型` : '正在扫描…'}
          actions={<Button size="sm" onClick={() => goto('settings')}>管理模型目录</Button>}>
          {catalog?.problems.map((problem) => <Notice key={problem} tone="warn" icon={CircleAlert}>{problem}</Notice>)}
          <div className="model-table">
            {catalog?.models.map((model) => {
              const index = matchIndex(model.path, catalog.indices)
              return (
                <div key={model.path} className="model-row">
                  <span className="voice-tile__avatar">{model.name.slice(0, 1).toUpperCase()}</span>
                  <div className="grow">
                    <strong>{model.name}</strong>
                    <div className="muted small truncate" title={model.path}>{model.path}</div>
                  </div>
                  {index ? <Badge tone="ok">有索引</Badge> : <Badge>无索引</Badge>}
                  <IconButton icon={FolderOpen} label="在文件夹中显示" onClick={() => studio.shell.reveal(model.path).catch((error) => notify(errorText(error), 'error'))} />
                </div>
              )
            })}
          </div>
          {catalog && !catalog.models.length && <EmptyState title="没有找到 RVC 模型" text="到“设置 → RVC”添加存放 .pth 模型的文件夹。" />}
        </Card>
      )}
    </div>
  )
}
