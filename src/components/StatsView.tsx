import { useMemo } from 'react'
import { BarChart3, Flame, AlertTriangle, Layers, FileText, Square, Sparkles } from 'lucide-react'
import { useWordbookStore } from '../stores/wordbookStore'
import { useReviewLogStore, dailyStats } from '../stores/reviewLogStore'
import { useReportStore } from '../stores/reportStore'
import { masteryLevel, MASTERY_LABELS, isDue, type MasteryLevel } from '../lib/srs'
import { useAppStore } from '../stores/appStore'
import { useSettingsStore } from '../stores/settingsStore'
import { marked } from 'marked'
import { sanitizeHtml } from '../lib/sanitize'
import EmptyState from './EmptyState'

const LEVEL_COLORS: Record<MasteryLevel, string> = {
  new: 'var(--ink-3)',
  learning: '#ff9f0a',
  young: '#30b0c7',
  mature: 'var(--ok)'
}

export default function StatsView(): React.JSX.Element {
  const words = useWordbookStore((s) => s.words)
  const records = useReviewLogStore((s) => s.records)
  const go = useAppStore((s) => s.go)
  const hasApi = Boolean(useSettingsStore((s) => s.settings.apiKey))
  const report = useReportStore()
  const reportHtml = useMemo(() => (report.report ? sanitizeHtml(marked.parse(report.report, { async: false }) as string) : ''), [report.report])

  const mastery = useMemo(() => {
    const counts: Record<MasteryLevel, number> = { new: 0, learning: 0, young: 0, mature: 0 }
    for (const w of words) counts[masteryLevel(w.srs)]++
    return counts
  }, [words])

  const dueCount = useMemo(() => words.filter((w) => isDue(w.srs)).length, [words])

  const week = useMemo(() => dailyStats(records, 7), [records])
  const maxCount = Math.max(1, ...week.map((d) => d.count))

  const totalReviews = records.length
  const totalCorrect = records.filter((r) => r.correct).length
  const accuracy = totalReviews ? Math.round((totalCorrect / totalReviews) * 100) : 0

  // 易错词：遗忘次数最多的前 8 个
  const errorProne = useMemo(
    () =>
      words
        .filter((w) => w.srs && w.srs.lapses > 0)
        .sort((a, b) => (b.srs?.lapses ?? 0) - (a.srs?.lapses ?? 0))
        .slice(0, 8),
    [words]
  )

  // 连续学习天数（从今天往前数，含今天无记录则从昨天起算）
  const streak = useMemo(() => {
    const days = new Set(records.map((r) => new Date(r.at).toDateString()))
    let count = 0
    const d = new Date()
    if (!days.has(d.toDateString())) d.setDate(d.getDate() - 1)
    while (days.has(d.toDateString())) {
      count++
      d.setDate(d.getDate() - 1)
    }
    return count
  }, [records])

  return (
    <div className="flex h-full flex-col">
      <div className="glass flex shrink-0 items-center justify-between border-b px-5 py-3">
        <h1 className="flex items-center gap-2 text-[17px] font-semibold">
          <BarChart3 size={16} className="text-accent" /> 学习统计
        </h1>
        {dueCount > 0 && (
          <button className="btn btn-primary !py-1.5 text-[12px]" onClick={() => go('flashcard')}>
            <Layers size={12} /> 今日到期 {dueCount} 词，去复习
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        <div className="mx-auto max-w-3xl space-y-4">
          {!words.length ? (
            <EmptyState icon={BarChart3} title="还没有学习数据" hint="收藏单词并复习后，这里会展示掌握度与趋势" />
          ) : (
            <>
              {/* 关键指标 */}
              <div className="grid grid-cols-4 gap-3">
                <StatCard label="生词总量" value={String(words.length)} />
                <StatCard label="今日到期" value={String(dueCount)} accent={dueCount > 0} />
                <StatCard label="总复习次数" value={String(totalReviews)} />
                <StatCard label="正确率" value={totalReviews ? `${accuracy}%` : '-'} />
              </div>

              {/* 学情周报（AI 生成） */}
              <div className="card p-5">
                <div className="flex items-center justify-between">
                  <h2 className="flex items-center gap-1.5 text-[14px] font-semibold">
                    <FileText size={14} className="text-accent" /> 学情周报
                  </h2>
                  {report.state === 'loading' ? (
                    <button className="btn !px-2.5 !py-1 text-[11px]" onClick={report.stop}>
                      <Square size={10} /> 停止
                    </button>
                  ) : (
                    <button className="btn btn-primary !px-2.5 !py-1 text-[11px]" onClick={report.generate}>
                      <Sparkles size={11} /> 生成
                    </button>
                  )}
                </div>
                {!hasApi ? (
                  <p className="mt-3 text-[12px] text-ink-3">配置 AI 服务后，可一键生成本周学习周报。</p>
                ) : report.state === 'loading' ? (
                  <p className="mt-3 flex items-center gap-2 text-[12px] text-ink-3">
                    <span className="h-3 w-3 animate-spin rounded-full border-2 border-accent border-t-transparent" />
                    正在分析本周学习数据…
                  </p>
                ) : report.error ? (
                  <p className="mt-3 text-[12px] text-danger">{report.error}</p>
                ) : report.report ? (
                  <div className="md-body mt-3 text-[13px] leading-relaxed" dangerouslySetInnerHTML={{ __html: reportHtml }} />
                ) : (
                  <p className="mt-3 text-[12px] text-ink-3">本周数据将汇成「概览 + 薄弱主题 + 易错词提醒 + 下周建议」。</p>
                )}
              </div>

              {/* 掌握度分布 */}
              <div className="card p-5">
                <div className="flex items-center justify-between">
                  <h2 className="text-[14px] font-semibold">掌握度分布</h2>
                  <span className="flex items-center gap-1 text-[11px] text-ink-3">
                    <Flame size={11} className="text-accent" /> 连续学习 {streak} 天
                  </span>
                </div>
                <div className="mt-4 flex h-3 overflow-hidden rounded-full bg-surface">
                  {(Object.keys(mastery) as MasteryLevel[]).map((lv) =>
                    mastery[lv] > 0 ? (
                      <div
                        key={lv}
                        style={{ width: `${(mastery[lv] / words.length) * 100}%`, background: LEVEL_COLORS[lv] }}
                        title={`${MASTERY_LABELS[lv]} ${mastery[lv]}`}
                      />
                    ) : null
                  )}
                </div>
                <div className="mt-3 grid grid-cols-4 gap-2">
                  {(Object.keys(mastery) as MasteryLevel[]).map((lv) => (
                    <div key={lv} className="flex items-center gap-1.5 text-[12px]">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ background: LEVEL_COLORS[lv] }} />
                      <span className="text-ink-2">{MASTERY_LABELS[lv]}</span>
                      <span className="font-semibold">{mastery[lv]}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* 近 7 天复习热力 */}
              <div className="card p-5">
                <h2 className="text-[14px] font-semibold">近 7 天复习</h2>
                <div className="mt-4 flex items-end justify-between gap-2">
                  {week.map((d) => (
                    <div key={d.day} className="flex flex-1 flex-col items-center gap-1.5">
                      <span className="text-[11px] font-medium text-ink-2">{d.count || ''}</span>
                      <div
                        className="w-full rounded-md bg-accent transition-all"
                        style={{
                          height: `${Math.max(4, (d.count / maxCount) * 72)}px`,
                          opacity: d.count ? Math.max(0.35, d.count / maxCount) : 0.12
                        }}
                        title={`${d.day}：复习 ${d.count} 次，答对 ${d.correct}`}
                      />
                      <span className="text-[10px] text-ink-3">{d.day}</span>
                    </div>
                  ))}
                </div>
                {totalReviews > 0 && (
                  <p className="mt-3 text-[11px] text-ink-3">
                    共复习 {totalReviews} 次 · 答对 {totalCorrect} 次（{accuracy}%）
                  </p>
                )}
              </div>

              {/* 易错词 */}
              {errorProne.length > 0 && (
                <div className="card p-5">
                  <h2 className="flex items-center gap-1.5 text-[14px] font-semibold">
                    <AlertTriangle size={14} className="text-danger" /> 易错词（按遗忘次数）
                  </h2>
                  <div className="mt-3 space-y-1.5">
                    {errorProne.map((w) => (
                      <div key={w.id} className="flex items-center justify-between gap-3 rounded-lg bg-surface px-3 py-2">
                        <div className="min-w-0">
                          <span className="text-[13px] font-medium">{w.word}</span>
                          {w.definition && (
                            <span className="ml-2 truncate text-[11px] text-ink-3">{w.definition}</span>
                          )}
                        </div>
                        <span className="chip shrink-0 !text-[10px] !text-danger">
                          遗忘 {w.srs?.lapses} 次
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function StatCard(props: { label: string; value: string; accent?: boolean }): React.JSX.Element {
  return (
    <div className="card p-4 text-center">
      <p className={`text-[22px] font-semibold tracking-tight ${props.accent ? 'text-accent' : ''}`}>{props.value}</p>
      <p className="mt-1 text-[11px] text-ink-3">{props.label}</p>
    </div>
  )
}
