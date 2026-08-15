import { useMemo, useState } from 'react'
import { BookOpen, Plus, Trash2, Search } from 'lucide-react'
import { useWordbookStore } from '../stores/wordbookStore'
import EmptyState from './EmptyState'

export default function WordbookView(): React.JSX.Element {
  const words = useWordbookStore((s) => s.words)
  const search = useWordbookStore((s) => s.search)
  const setSearch = useWordbookStore((s) => s.setSearch)
  const add = useWordbookStore((s) => s.add)
  const remove = useWordbookStore((s) => s.remove)

  const [word, setWord] = useState('')
  const [def, setDef] = useState('')
  const [ctx, setCtx] = useState('')
  const [showForm, setShowForm] = useState(false)

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return words
    return words.filter(
      (w) => w.word.toLowerCase().includes(q) || (w.definition ?? '').toLowerCase().includes(q)
    )
  }, [words, search])

  return (
    <div className="flex h-full flex-col">
      <div className="glass flex shrink-0 items-center justify-between border-b px-5 py-3">
        <h1 className="text-[17px] font-semibold">生词本</h1>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
            <input
              className="input !w-52 !py-1.5 !pl-8 text-[12px]"
              placeholder="搜索单词…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <button className="btn btn-primary" onClick={() => setShowForm((v) => !v)}>
            <Plus size={13} /> 添加
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        <div className="mx-auto max-w-3xl space-y-3">
          {showForm && (
            <div className="card animate-float-in space-y-2 p-4">
              <div className="grid grid-cols-2 gap-2">
                <input className="input" placeholder="单词 *" value={word} onChange={(e) => setWord(e.target.value)} />
                <input className="input" placeholder="释义" value={def} onChange={(e) => setDef(e.target.value)} />
              </div>
              <input
                className="input"
                placeholder="原文语境句（可选）"
                value={ctx}
                onChange={(e) => setCtx(e.target.value)}
              />
              <div className="flex justify-end gap-2">
                <button
                  className="btn"
                  onClick={() => {
                    setShowForm(false)
                    setWord('')
                    setDef('')
                    setCtx('')
                  }}
                >
                  取消
                </button>
                <button
                  className="btn btn-primary"
                  disabled={!word.trim()}
                  onClick={() => {
                    add({ word, definition: def, context: ctx })
                    setWord('')
                    setDef('')
                    setCtx('')
                    setShowForm(false)
                  }}
                >
                  保存
                </button>
              </div>
            </div>
          )}

          {!filtered.length && (
            <EmptyState
              icon={BookOpen}
              title={words.length ? '没有匹配的单词' : '生词本还是空的'}
              hint={words.length ? '换个关键词试试' : '收藏单词，或在小窗查词后点 ⭐'}
            />
          )}

          {filtered.map((w) => (
            <div key={w.id} className="card card-hover group flex items-start justify-between gap-3 p-4">
              <div className="min-w-0">
                <p className="text-[15px] font-semibold">{w.word}</p>
                {w.definition && <p className="mt-0.5 text-[13px] text-ink-2">{w.definition}</p>}
                {w.context && (
                  <p className="mt-1.5 line-clamp-2 text-[12px] text-ink-3 select-text">{w.context}</p>
                )}
                <p className="mt-1 text-[10px] text-ink-3">{new Date(w.addedAt).toLocaleString('zh-CN')}</p>
              </div>
              <button
                className="btn btn-ghost !p-2 text-ink-3 opacity-0 transition group-hover:opacity-100 hover:!text-danger"
                onClick={() => remove(w.id)}
                title="删除"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
