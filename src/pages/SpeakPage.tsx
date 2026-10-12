import { useEffect, useMemo, useRef, useState } from 'react'
import { AudioLines, CircleAlert, FolderOpen, Mic, Search, SlidersHorizontal, UserRound } from 'lucide-react'
import { LANGS, SAMPLE_STEPS, SPLIT_METHODS, type VoiceFileCheck } from '../../shared/contracts'
import { studio } from '../api'
import { JobCard } from '../components/JobCard'
import { LANG_LABEL, SPLIT_LABEL } from '../lib/format'
import { THEME_ART } from '../lib/theme-assets'
import { PageHeader } from '../shell/Shell'
import { usePlayer } from '../state/player'
import { errorText, useJobs, useStudio } from '../state/studio'
import { Badge, Button, Card, Collapse, EmptyState, Field, Notice, PathField, Segmented, Select, Slider } from '../ui'

export function SpeakPage() {
  const { prefs, updatePrefs, voices, notify, goto, info, service } = useStudio()
  const jobs = useJobs()
  const player = usePlayer()
  const speak = prefs.speak
  const [text, setText] = useState('')
  const [refText, setRefText] = useState('')
  const [search, setSearch] = useState('')
  const [group, setGroup] = useState('')
  const [checks, setChecks] = useState<Record<string, VoiceFileCheck>>({})
  const [submitting, setSubmitting] = useState(false)
  const lastSubmitted = useRef('')
  const autoPlayed = useRef(new Set<string>())

  const voice = voices.find((item) => item.id === speak.voiceId) ?? voices[0]
  const groups = useMemo(() => [...new Set(voices.map((item) => item.group))], [voices])
  const visibleVoices = useMemo(() => voices.filter((item) =>
    (!group || item.group === group) && `${item.name}${item.group}`.toLowerCase().includes(search.trim().toLowerCase())), [voices, group, search])
  const ttsJobs = useMemo(() => jobs.filter((job) => job.kind === 'tts').slice(0, 6), [jobs])
  const activeJob = ttsJobs.find((job) => job.status === 'running' || job.status === 'queued')

  useEffect(() => {
    studio.voices.check().then(setChecks).catch(() => undefined)
  }, [voices])

  useEffect(() => { setRefText(voice?.refText ?? '') }, [voice?.id, voice?.refText])

  // 刚提交的配音完成后自动试听
  useEffect(() => {
    const job = jobs.find((item) => item.id === lastSubmitted.current)
    if (!job || autoPlayed.current.has(job.id)) return
    if (job.status === 'succeeded' && job.artifacts[0]) {
      autoPlayed.current.add(job.id)
      player.toggle(job.artifacts[0].path)
      notify('配音完成，正在试听', 'ok')
    } else if (job.status === 'failed') {
      autoPlayed.current.add(job.id)
    }
  }, [jobs, player, notify])

  const check = voice ? checks[voice.id] : undefined
  const missing = check ? [!check.gptModel && 'GPT 权重', !check.sovitsModel && 'SoVITS 权重', !check.refAudio && '参考音频'].filter(Boolean) as string[] : []

  async function generate() {
    if (!voice) return
    setSubmitting(true)
    try {
      const job = await studio.jobs.enqueue({
        kind: 'tts',
        voiceId: voice.id,
        voiceName: voice.name,
        gptModel: voice.gptModel,
        sovitsModel: voice.sovitsModel,
        refAudio: voice.refAudio,
        refText: refText.trim() || voice.refText,
        refLang: voice.refLang,
        text: text.trim(),
        textLang: speak.textLang,
        splitMethod: speak.splitMethod,
        speed: speak.speed,
        sampleSteps: speak.sampleSteps,
        fragmentInterval: speak.fragmentInterval,
        outputDir: speak.outputDir,
      })
      lastSubmitted.current = job.id
      if (service.state !== 'ready') notify('GPT-SoVITS 服务启动中，首次合成需要多等一会儿', 'info')
    } catch (error) {
      notify(errorText(error), 'error')
    } finally {
      setSubmitting(false)
    }
  }

  const art = THEME_ART[prefs.theme]
  return (
    <div className="page">
      <PageHeader title="文字配音" description="挑一个声音，写下想说的话，生成可以直接试听和保存的语音。" />
      <div className="page-grid">
        <div className="stack stack--lg">
          <Card title="想让 TA 说什么" icon={AudioLines}
            actions={<Segmented value={speak.textLang} onChange={(value) => updatePrefs({ speak: { textLang: value } })}
              options={LANGS.map((lang) => ({ value: lang, label: LANG_LABEL[lang] }))} />}>
            <div className="speak-editor">
              <textarea className="control speak-editor__input" value={text} maxLength={20000} rows={9}
                placeholder={`在这里输入文字……\n\n小提示：文字语言要和上方选择一致；长文本会按“切分方式”自动分段合成。`}
                onChange={(event) => setText(event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Enter' && event.ctrlKey && text.trim()) void generate() }} />
              <div className="speak-editor__footer">
                <span className="muted small">{text.length.toLocaleString()} / 20,000 字 · Ctrl + Enter 生成</span>
                <Button variant="cta" size="lg" mascot={art.sticker} icon={Mic} loading={submitting}
                  disabled={!voice || !text.trim() || missing.length > 0 || submitting} onClick={() => void generate()}>
                  {activeJob ? '加入队列' : '生成配音'}
                </Button>
              </div>
            </div>
            {missing.length > 0 && (
              <Notice tone="warn" icon={CircleAlert}>
                「{voice?.name}」缺少 {missing.join('、')}，暂时无法生成。
                <button type="button" className="link-button" onClick={() => goto('library')}>去声音库补全</button>
              </Notice>
            )}
          </Card>

          <Card title="最近的配音" subtitle="新生成的配音完成后会自动试听" icon={AudioLines}
            actions={ttsJobs.length > 0 && <Button size="sm" variant="ghost" onClick={() => goto('jobs')}>查看全部</Button>}>
            {ttsJobs.length
              ? <div className="stack stack--sm">{ttsJobs.map((job) => <JobCard key={job.id} job={job} compact />)}</div>
              : <EmptyState art={art.sticker} title="还没有配音" text="写好文字后点“生成配音”，结果会出现在这里。" />}
          </Card>
        </div>

        <div className="stack stack--lg">
          <Card title="选择声音" subtitle={`${voices.length} 个角色`} icon={UserRound}>
            <div className="voice-search">
              <Search size={15} />
              <input className="control" value={search} placeholder="搜索角色…" onChange={(event) => setSearch(event.target.value)} />
            </div>
            <div className="chip-row">
              <button type="button" className={`chip${group === '' ? ' is-active' : ''}`} onClick={() => setGroup('')}>全部</button>
              {groups.map((item) => <button type="button" key={item} className={`chip${group === item ? ' is-active' : ''}`} onClick={() => setGroup(item)}>{item}</button>)}
            </div>
            <div className="voice-list">
              {visibleVoices.map((item) => {
                const itemCheck = checks[item.id]
                const ok = !itemCheck || (itemCheck.gptModel && itemCheck.sovitsModel && itemCheck.refAudio)
                return (
                  <button type="button" key={item.id} className={`voice-tile${item.id === voice?.id ? ' is-selected' : ''}`}
                    onClick={() => updatePrefs({ speak: { voiceId: item.id } })}>
                    <span className="voice-tile__avatar">{item.name.slice(0, 1)}</span>
                    <span className="voice-tile__text"><strong className="truncate">{item.name}</strong><small className="truncate">{item.group} · {LANG_LABEL[item.refLang]}参考</small></span>
                    {!ok && <Badge tone="warn">缺文件</Badge>}
                  </button>
                )
              })}
              {!visibleVoices.length && <div className="muted small voice-list__empty">没有匹配的角色</div>}
            </div>
          </Card>

          <Card title="参考与参数" icon={SlidersHorizontal}>
            <Field label="参考文本" hint="参考音频里说的原话，影响音色与语气；默认使用声音库中的文本。">
              <textarea className="control" rows={3} value={refText} onChange={(event) => setRefText(event.target.value)} />
            </Field>
            <Collapse title="高级参数" icon={SlidersHorizontal}>
              <Field label="切分方式">
                <Select value={speak.splitMethod} onChange={(value) => updatePrefs({ speak: { splitMethod: value } })}
                  options={SPLIT_METHODS.map((method) => ({ value: method, label: SPLIT_LABEL[method] }))} />
              </Field>
              <Slider label="语速" value={speak.speed} min={0.6} max={1.6} step={0.05} format={(value) => `${value.toFixed(2)}×`}
                onChange={(value) => updatePrefs({ speak: { speed: value } })} />
              <Slider label="句间停顿" value={speak.fragmentInterval} min={0.05} max={1} step={0.05} format={(value) => `${value.toFixed(2)} 秒`}
                onChange={(value) => updatePrefs({ speak: { fragmentInterval: value } })} />
              <Field label="采样步数" hint="步数越多越细腻，但更慢（仅 v3/v4 模型生效）">
                <Select value={speak.sampleSteps} onChange={(value) => updatePrefs({ speak: { sampleSteps: value } })}
                  options={SAMPLE_STEPS.map((steps) => ({ value: steps, label: `${steps} 步${steps === 4 ? '（最快）' : steps === 32 ? '（最细）' : ''}` }))} />
              </Field>
            </Collapse>
            <Field label="保存到" hint={speak.outputDir ? undefined : `默认：${info.defaultOutputDir}\\配音`}>
              <PathField value={speak.outputDir} placeholder="使用默认位置" onChange={(value) => updatePrefs({ speak: { outputDir: value } })}
                onPick={async () => { const path = await studio.dialog.pickFolder(speak.outputDir); if (path) updatePrefs({ speak: { outputDir: path } }) }} />
            </Field>
            {speak.outputDir && <Button size="sm" variant="ghost" icon={FolderOpen} onClick={() => studio.shell.openPath(speak.outputDir).catch((error) => notify(errorText(error), 'error'))}>打开文件夹</Button>}
          </Card>
        </div>
      </div>
    </div>
  )
}
