import { useEffect, useMemo, useState } from 'react'
import { BookOpen, Plus, Trash2, Search, Tag as TagIcon, Check, X, Wand2, RefreshCw, Layers, Sparkles, Tags } from 'lucide-react'
import { useWordbookStore } from '../stores/wordbookStore'
import { useSettingsStore } from '../stores/settingsStore'
import {
  clusterByPos,
  clusterBySimilarity,
  aiOrganize,
  ORGANIZE_MODES,
  type WordCluster,
  type OrganizeMode
} from '../lib/organize'
import { levelLabel } from '../lib/levels'
import { aiGradeWords } from '../lib/flashcard'
import Segmented from './Segmented'
import EmptyState from './EmptyState'

type OrgView = 'all' | 'regular' | 'smart'
type RegularMode = 'pos' | 'similarity'

export default function WordbookView(): React.JSX.Element {
  const words = useWordbookStore((s) => s.words)
  const search = useWordbookStore((s) => s.search)
  const setSearch = useWordbookStore((s) => s.setSearch)
  const add = useWordbookStore((s) => s.add)
  const remove = useWordbookStore((s) => s.remove)
  const update = useWordbookStore((s) => s.update)
  const hasApi = Boolean(useSettingsStore((s) => s.settings.apiKey))

  // 新增表单
  const [word, setWord] = useState('')
  const [def, setDef] = useState('')
  const [ctx, setCtx] = useState('')
  const [pos, setPos] = useState('')
  const [tags, setTags] = useState('')
  const [showForm, setShowForm] = useState(false)

  // 整理模式
  const [orgView, setOrgView] = useState<OrgView>('all')
  const [regularMode, setRegularMode] = useState<RegularMode>('pos')
  const [smartMode, setSmartMode] = useState<OrganizeMode>('synonym')
  const [smartClusters, setSmartClusters] = useState<WordCluster[]>([])
  const [smartLoading, setSmartLoading] = useState(false)
  const [smartError, setSmartError] = useState<string | null>(null)
  const [smartRun, setSmartRun] = useState(0)

  // 标签内联编辑
  const [editId, setEditId] = useState<string | null>(null)
  const [editTags, setEditTags] = useState('')
  // 已应用回写的整理分组 id
  const [appliedClusters, setAppliedClusters] = useState<Set<string>>(new Set())
  // 批量自动分级
  const [gradingAll, setGradingAll] = useState(false)

  const gradeAll = async (): Promise<void> => {
    if (!hasApi || gradingAll || !words.length) return
    setGradingAll(true)
    try {
      const ungraded = words.filter((w) => !w.level).slice(0, 100)
      if (!ungraded.length) return
      const results = await aiGradeWords(ungraded.map((w) => w.word))
      for (const r of results) {
        if (!r.level) continue
        const id = ungraded.find((w) => w.word.toLowerCase() === r.word.toLowerCase())?.id
        if (id) update(id, { level: r.level })
      }
    } catch (err) {
      setGradingAll(false)
      window.alert(err instanceof Error ? err.message : '批量分级失败')
      return
    }
    setGradingAll(false)
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return words
    return words.filter(
      (w) =>
        w.word.toLowerCase().includes(q) ||
        (w.definition ?? '').toLowerCase().includes(q) ||
        w.tags.some((t) => t.toLowerCase().includes(q))
    )
  }, [words, search])

  // 普通整理
  const regularClusters = useMemo(() => {
    if (orgView !== 'regular') return []
    return regularMode === 'pos' ? clusterByPos(filtered) : clusterBySimilarity(filtered)
  }, [orgView, regularMode, filtered])

  // 智能整理（AI 异步分组）
  useEffect(() => {
    let alive = true
    if (orgView !== 'smart' || !words.length) {
      setSmartClusters([])
      return
    }
    setSmartLoading(true)
    setSmartError(null)
    void aiOrganize(words, smartMode).then((res) => {
      if (!alive) return
      setSmartLoading(false)
      if (res.error) setSmartError(res.error)
      else setSmartClusters(res.clusters)
    })
    return () => {
      alive = false
    }
  }, [orgView, smartMode, smartRun, words])

  const commitAdd = (): void => {
    add({
      word,
      definition: def,
      context: ctx,
      pos,
      tags: tags.split(/[,，]/).map((t) => t.trim())
    })
    setWord('')
    setDef('')
    setCtx('')
    setPos('')
    setTags('')
    setShowForm(false)
  }

  const startEditTags = (w: (typeof words)[number]): void => {
    setEditId(w.id)
    setEditTags(w.tags.join(', '))
  }

  const commitEditTags = (id: string): void => {
    update(id, { tags: editTags.split(/[,，]/).map((t) => t.trim()) })
    setEditId(null)
    setEditTags('')
  }

  const renderWordList = (list: (typeof words)[number][]): React.JSX.Element => (
    <>
      {!list.length && (
        <EmptyState
          icon={BookOpen}
          title={words.length ? '没有匹配的单词' : '生词本还是空的'}
          hint={words.length ? '换个关键词试试' : '收藏单词，或在小窗查词后点 ⭐'}
        />
      )}
      {list.map((w) => (
        <div key={w.id} className="card card-hover group flex items-start justify-between gap-3 p-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="text-[15px] font-semibold">{w.word}</p>
              {w.pos && <span className="chip !text-[10px]">{w.pos}</span>}
              {w.level && <span className="chip !bg-ink-3/10 !text-ink-2 !text-[10px]">{levelLabel(w.level)}</span>}
            </div>
            {w.definition && <p className="mt-0.5 text-[13px] text-ink-2">{w.definition}</p>}
            {w.context && (
              <p className="mt-1.5 line-clamp-2 text-[12px] text-ink-3 select-text">{w.context}</p>
            )}
            {editId === w.id ? (
              <div className="mt-2 flex items-center gap-1.5">
                <div className="relative flex-1">
                  <TagIcon size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3" />
                  <input
                    className="input !py-1.5 !pl-7 text-[12px]"
                    placeholder="标签，逗号分隔…"
                    value={editTags}
                    onChange={(e) => setEditTags(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitEditTags(w.id)
                      if (e.key === 'Escape') setEditId(null)
                    }}
                    autoFocus
                  />
                </div>
                <button className="btn btn-ghost !p-1.5" onClick={() => commitEditTags(w.id)} title="保存标签">
                  <Check size={13} className="text-ok" />
                </button>
                <button className="btn btn-ghost !p-1.5" onClick={() => setEditId(null)} title="取消">
                  <X size={13} />
                </button>
              </div>
            ) : (
              w.tags.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {w.tags.map((t) => (
                    <span key={t} className="chip !px-2 !py-0.5 text-[10px] text-accent">
                      #{t}
                    </span>
                  ))}
                </div>
              )
            )}
            <p className="mt-1 text-[10px] text-ink-3">{new Date(w.addedAt).toLocaleString('zh-CN')}</p>
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            <button
              className="btn btn-ghost !p-2 text-ink-3 opacity-0 transition group-hover:opacity-100 hover:!text-accent"
              onClick={() => startEditTags(w)}
              title="编辑标签"
            >
              <TagIcon size={14} />
            </button>
            <button
              className="btn btn-ghost !p-2 text-ink-3 opacity-0 transition group-hover:opacity-100 hover:!text-danger"
              onClick={() => remove(w.id)}
              title="删除"
            >
              <Trash2 size={14} />
            </button>
          </div>
        </div>
      ))}
    </>
  )

  /** 把 AI 分组名一键回写为词条标签，形成整理闭环 */
  const applyClusterTags = (c: WordCluster): void => {
    for (const w of c.words) {
      if (!w.tags.includes(c.name)) update(w.id, { tags: [...w.tags, c.name] })
    }
    setAppliedClusters((s) => new Set(s).add(c.id))
  }

  const renderClusters = (clusters: WordCluster[], writable: boolean): React.JSX.Element => (
    <div className="space-y-3">
      {clusters.map((c) => (
        <div key={c.id} className="card p-4">
          <div className="flex items-center gap-2">
            <span className="text-[14px] font-semibold">{c.name}</span>
            <span className="chip !text-[10px]">{c.words.length} 词</span>
            {c.note && <span className="min-w-0 flex-1 truncate text-[10px] text-ink-3">{c.note}</span>}
            {writable && (
              <button
                className={`btn btn-ghost ml-auto !px-2 !py-1 shrink-0 text-[11px] ${appliedClusters.has(c.id) ? '!text-ok' : ''}`}
                disabled={appliedClusters.has(c.id)}
                onClick={() => applyClusterTags(c)}
                title="把分组名写入这些词的标签"
              >
                {appliedClusters.has(c.id) ? (
                  <>
                    <Check size={11} /> 已应用
                  </>
                ) : (
                  <>
                    <Tags size={11} /> 应用为标签
                  </>
                )}
              </button>
            )}
          </div>
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {c.words.map((w) => (
              <span key={w.id} className="chip select-text cursor-default">
                {w.word}
                {w.pos && <span className="ml-1 text-[9px] text-ink-3">{w.pos}</span>}
              </span>
            ))}
          </div>
        </div>
      ))}
      {!clusters.length && !smartLoading && (
        <EmptyState icon={Layers} title="暂未生成分组" hint="添加更多单词，或尝试切换整理方式" />
      )}
    </div>
  )

  return (
    <div className="flex h-full flex-col">
      <div className="glass flex shrink-0 flex-wrap items-center justify-between gap-2 border-b px-5 py-3">
        <h1 className="text-[17px] font-semibold">生词本</h1>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
            <input
              className="input !w-52 !py-1.5 !pl-8 text-[12px]"
              placeholder="搜索单词 / 标签…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <button
            className="btn btn-ghost !px-2.5 !py-1.5 text-[11px]"
            onClick={() => void gradeAll()}
            disabled={!hasApi || gradingAll || !words.length}
            title="用 AI 为生词标注难度（CEFR / 四六级 / 雅思托福 / 专四专八）"
          >
            <Sparkles size={11} /> {gradingAll ? '分级中…' : '自动分级'}
          </button>
          <button className="btn btn-primary" onClick={() => setShowForm((v) => !v)}>
            <Plus size={13} /> 添加
          </button>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-3 border-b border-line px-5 py-2">
        <Segmented<OrgView>
          items={[
            { value: 'all', label: '全部' },
            { value: 'regular', label: '普通整理' },
            { value: 'smart', label: '智能整理' }
          ]}
          value={orgView}
          onChange={setOrgView}
        />
        {orgView === 'regular' && (
          <Segmented<RegularMode>
            items={[
              { value: 'pos', label: '按词性' },
              { value: 'similarity', label: '词形相似' }
            ]}
            value={regularMode}
            onChange={setRegularMode}
          />
        )}
        {orgView === 'smart' && (
          <>
            <Segmented<OrganizeMode>
              items={ORGANIZE_MODES.map((m) => ({ value: m.value, label: m.label }))}
              value={smartMode}
              onChange={setSmartMode}
            />
            <button
              className="btn btn-ghost !px-2 !py-1 text-[11px]"
              onClick={() => setSmartRun((n) => n + 1)}
              title="重新整理"
            >
              <RefreshCw size={12} />
            </button>
          </>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        <div className="mx-auto max-w-3xl space-y-3">
          {showForm && (
            <div className="card animate-float-in space-y-2 p-4">
              <div className="grid grid-cols-2 gap-2">
                <input className="input" placeholder="单词 *" value={word} onChange={(e) => setWord(e.target.value)} />
                <input className="input" placeholder="词性（如 n. / v. / adj.）" value={pos} onChange={(e) => setPos(e.target.value)} />
              </div>
              <input className="input" placeholder="释义" value={def} onChange={(e) => setDef(e.target.value)} />
              <input
                className="input"
                placeholder="原文语境句（可选）"
                value={ctx}
                onChange={(e) => setCtx(e.target.value)}
              />
              <input
                className="input"
                placeholder="标签（逗号分隔，如：学术,CS,高频）"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
              />
              <div className="flex justify-end gap-2">
                <button
                  className="btn"
                  onClick={() => {
                    setShowForm(false)
                    setWord('')
                    setDef('')
                    setCtx('')
                    setPos('')
                    setTags('')
                  }}
                >
                  取消
                </button>
                <button className="btn btn-primary" disabled={!word.trim()} onClick={commitAdd}>
                  保存
                </button>
              </div>
            </div>
          )}

          {orgView === 'all' && renderWordList(filtered)}

          {orgView === 'regular' && renderClusters(regularClusters, false)}

          {orgView === 'smart' && (
            <>
              {!hasApi ? (
                <EmptyState
                  icon={Sparkles}
                  title="智能整理需要先配置 AI 服务"
                  hint="请前往「设置」填写 API Key 后使用"
                />
              ) : smartLoading ? (
                <div className="flex items-center gap-3 py-10 text-[13px] text-ink-2">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-accent border-t-transparent" />
                  正在分析 {words.length} 个单词，生成{"「" + (ORGANIZE_MODES.find((m) => m.value === smartMode)?.label ?? '') + "」"}分组…
                </div>
              ) : smartError ? (
                <EmptyState icon={Sparkles} title="整理失败" hint={smartError} />
              ) : (
                renderClusters(smartClusters, true)
              )}
              {!smartLoading && (
                <div className="flex items-center justify-center gap-2 pt-1 text-[11px] text-ink-3">
                  <Wand2 size={11} />
                  {ORGANIZE_MODES.find((m) => m.value === smartMode)?.desc}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
