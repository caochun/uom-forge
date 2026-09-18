import { useState } from 'react'
import {
  AlertTriangle,
  Check,
  Circle,
  LoaderCircle,
  Square,
} from 'lucide-react'
import type {
  ModelingProgress,
  ModelRunStatus,
  ProgressItem,
} from '../modeling-progress.ts'
import type { StageTiming } from '../types.ts'
import { TimingDetails } from './WorkbenchViews.tsx'

export default function ModelingRun({
  progress,
  running,
  text,
  elapsed,
  status,
  activities,
  records,
  onStop,
  onView,
}: {
  progress: ModelingProgress
  running: boolean
  text: string
  elapsed: number
  status?: ModelRunStatus
  activities: string[]
  records: (StageTiming & { label: string })[]
  onStop: () => void
  onView: (step: ProgressItem) => void
}) {
  const [open, setOpen] = useState(false)
  const attention = progress.tabs.some(
    (tab) => tab.state === 'attention' || tab.state === 'stale',
  )
  const title = running
    ? text || progress.active?.detail || '准备建模'
    : status === 'failed'
      ? '本次运行未完成，已保留有效结果'
      : status === 'stopped'
        ? '已停止，已保留有效结果'
        : attention
          ? '已有结果需要审阅'
          : '当前建模结果'
  const seconds = Math.round(
    records.reduce((sum, record) => sum + record.elapsedMs, 0) / 1000,
  )
  return (
    <section className="workflow-status run-panel" aria-label="建模运行状态">
      <header>
        <strong className="run-live" role="status">
          {running ? (
            <LoaderCircle className="spin" size={15} />
          ) : attention || status === 'failed' || status === 'stopped' ? (
            <AlertTriangle size={15} />
          ) : (
            <Check size={15} />
          )}
          {title}
        </strong>
        <span className="run-meta">
          {running
            ? `${elapsed} 秒`
            : seconds
              ? `本次调用 ${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`
              : ''}
        </span>
        <div className="run-controls">
          {running && progress.active && (
            <button
              className="text-button"
              onClick={() => onView(progress.active!)}
            >
              查看当前产物
            </button>
          )}
          <button
            className="text-button"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            {open ? '收起运行记录' : '展开运行记录'}
          </button>
          {running && (
            <button className="stop-button" onClick={onStop}>
              <Square size={12} />
              停止
            </button>
          )}
        </div>
      </header>
      {open && (
        <div className="run-detail">
          <ol className="modeling-workflow" aria-label="执行步骤与产物">
            {progress.steps.map((step) => (
              <li key={step.id} data-state={step.state}>
                <button className="workflow-stage" onClick={() => onView(step)}>
                  <span className="workflow-marker" aria-hidden="true">
                    {step.state === 'active' ? (
                      <LoaderCircle className="spin" size={13} />
                    ) : step.state === 'done' ? (
                      <Check size={13} />
                    ) : ['attention', 'stale'].includes(step.state) ? (
                      <AlertTriangle size={13} />
                    ) : (
                      <Circle size={10} />
                    )}
                  </span>
                  <span>
                    <strong>{step.label}</strong>
                    <small>{step.detail}</small>
                  </span>
                </button>
              </li>
            ))}
          </ol>
          {!!activities.length && (
            <ol className="modeling-activity" aria-label="运行记录">
              {activities.map((activity, index) => (
                <li key={`${index}-${activity}`}>
                  <p>{activity}</p>
                </li>
              ))}
            </ol>
          )}
          <TimingDetails records={records} />
        </div>
      )}
    </section>
  )
}
