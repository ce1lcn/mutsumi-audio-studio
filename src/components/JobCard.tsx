import { useState } from 'react'
import { CircleAlert, FolderOpen, ListX, Pause, Play, ScrollText, Trash2, Wand2, X } from 'lucide-react'
import type { Job, JobArtifact } from '../../shared/contracts'
import { studio } from '../api'
import { ROLE_LABEL, STATUS_LABEL, STATUS_TONE, elapsed, fileName, formatBytes, formatTime } from '../lib/format'
import { errorText, useStudio } from '../state/studio'
import { usePlayer } from '../state/player'
import { Badge, IconButton, Progress } from '../ui'

export function ArtifactRow({ artifact, onUse, useLabel }: { artifact: JobArtifact; onUse?: (path: string) => void; useLabel?: string }) {
  const player = usePlayer()
  const { notify, sendToCover } = useStudio()
  const active = player.path === artifact.path
  const reveal = () => studio.shell.reveal(artifact.path).catch((error) => notify(errorText(error), 'error'))
  return (
    <div className={`artifact${active ? ' is-active' : ''}`}>
      <IconButton icon={active && player.playing ? Pause : Play} label={active && player.playing ? '暂停' : '试听'} tone="accent" onClick={() => player.toggle(artifact.path)} />
      <div className="artifact__text">
        <span className="artifact__role">{ROLE_LABEL[artifact.role]}</span>
        <span className="artifact__name truncate" title={artifact.path}>{fileName(artifact.path)}</span>
      </div>
      <span className="artifact__size">{formatBytes(artifact.bytes)}</span>
      {onUse
        ? <IconButton icon={Wand2} label={useLabel || '使用该文件'} onClick={() => onUse(artifact.path)} />
        : (artifact.role === 'decoded' || artifact.role === 'speech' || artifact.role === 'recording') &&
          <IconButton icon={Wand2} label="送去翻唱换声" onClick={() => sendToCover(artifact.path)} />}
      <IconButton icon={FolderOpen} label="在文件夹中显示" onClick={reveal} />
    </div>
  )
}

export function JobCard({ job, compact, onUseArtifact }: { job: Job; compact?: boolean; onUseArtifact?: (artifact: JobArtifact) => void }) {
  const { notify } = useStudio()
  const [showLog, setShowLog] = useState(false)
  const active = job.status === 'running' || job.status === 'queued'
  const act = (action: Promise<void>) => action.catch((error) => notify(errorText(error), 'error'))
  const timing = job.status === 'running' ? `已用 ${elapsed(job.startedAt)}` : job.finishedAt && job.startedAt ? `用时 ${elapsed(job.startedAt, job.finishedAt)}` : ''

  return (
    <article className={`job job--${job.status}${compact ? ' job--compact' : ''}`}>
      <header className="job__head">
        <div className="job__titles">
          <div className="job__title truncate" title={job.title}>{job.title}</div>
          <div className="job__meta">
            <Badge tone={STATUS_TONE[job.status]}>{STATUS_LABEL[job.status]}</Badge>
            <span>{formatTime(job.createdAt)}</span>
            {timing && <span>· {timing}</span>}
          </div>
        </div>
        <div className="job__actions">
          {job.logs.length > 0 && <IconButton icon={ScrollText} label={showLog ? '收起日志' : '查看日志'} onClick={() => setShowLog(!showLog)} />}
          {active && job.kind !== 'live'
            ? <IconButton icon={X} label="取消任务" tone="danger" onClick={() => act(studio.jobs.cancel(job.id))} />
            : !active && <IconButton icon={compact ? ListX : Trash2} label="移除记录（不删除文件）" onClick={() => act(studio.jobs.remove(job.id))} />}
        </div>
      </header>

      {job.status === 'running' && job.kind !== 'live' && (
        <div className="job__progress">
          <Progress value={job.progress} />
          <span className="job__stage">{job.stage} · {Math.round(job.progress)}%</span>
        </div>
      )}
      {job.status === 'queued' && <div className="job__stage">{job.stage}</div>}
      {job.error && <div className="job__error selectable"><CircleAlert size={14} />{job.error}</div>}

      {job.artifacts.length > 0 && (
        <div className="job__artifacts">
          {job.artifacts.map((artifact) => (
            <ArtifactRow key={artifact.path} artifact={artifact}
              onUse={onUseArtifact ? () => onUseArtifact(artifact) : undefined} useLabel="用于下一步" />
          ))}
        </div>
      )}
      {showLog && <pre className="job__log selectable">{job.logs.slice(-120).join('\n')}</pre>}
    </article>
  )
}
