import { useMemo, useState } from 'react'
import { ListMusic, Trash2 } from 'lucide-react'
import type { Job } from '../../shared/contracts'
import { studio } from '../api'
import { JobCard } from '../components/JobCard'
import { THEME_ART } from '../lib/theme-assets'
import { PageHeader } from '../shell/Shell'
import { errorText, useJobs, useStudio } from '../state/studio'
import { Button, Card, EmptyState, Segmented } from '../ui'

type Filter = 'all' | 'active' | 'done' | 'failed'

const FILTERS: Record<Filter, (job: Job) => boolean> = {
  all: () => true,
  active: (job) => job.status === 'running' || job.status === 'queued',
  done: (job) => job.status === 'succeeded',
  failed: (job) => job.status === 'failed' || job.status === 'interrupted' || job.status === 'cancelled',
}

export function JobsPage() {
  const { prefs, notify } = useStudio()
  const jobs = useJobs()
  const [filter, setFilter] = useState<Filter>('all')
  const visible = useMemo(() => jobs.filter(FILTERS[filter]), [jobs, filter])
  const counts = useMemo(() => Object.fromEntries((Object.keys(FILTERS) as Filter[]).map((key) => [key, jobs.filter(FILTERS[key]).length])) as Record<Filter, number>, [jobs])

  async function clearFinished() {
    if (!window.confirm('清除所有已结束的任务记录？\n生成的音频文件不会被删除。')) return
    await studio.jobs.clearFinished().catch((error) => notify(errorText(error), 'error'))
  }

  return (
    <div className="page">
      <PageHeader title="任务与作品" description="所有配音、翻唱、转换与实时变声记录都在这里。清除记录不会删除音频文件。"
        actions={<Button icon={Trash2} disabled={counts.all === counts.active} onClick={() => void clearFinished()}>清除已结束</Button>} />
      <Segmented value={filter} onChange={setFilter} options={[
        { value: 'all', label: `全部 ${counts.all}` },
        { value: 'active', label: `进行中 ${counts.active}` },
        { value: 'done', label: `已完成 ${counts.done}` },
        { value: 'failed', label: `未完成 ${counts.failed}` },
      ]} />
      <Card icon={ListMusic} title={`${visible.length} 条记录`}>
        {visible.length
          ? <div className="jobs-grid">{visible.map((job) => <JobCard key={job.id} job={job} />)}</div>
          : <EmptyState art={THEME_ART[prefs.theme].sticker} title="这里还空空的" text="完成一次配音、翻唱或 NCM 转换后，作品会出现在这里。" />}
      </Card>
    </div>
  )
}
