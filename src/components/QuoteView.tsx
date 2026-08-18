import { useEffect, useRef, useState } from 'react'
import { Quote as QuoteIcon, Plus, Trash2, ExternalLink, BookmarkPlus, Volume2, Loader2, X } from 'lucide-react'
import { BUILTIN_QUOTES, splitWords, type Quote } from '../lib/quotes'
import { useQuoteStore } from '../stores/quoteStore'
import { useWordbookStore } from '../stores/wordbookStore'
import { quickTranslate } from '../lib/quickTranslate'
import { parseWordCard, type WordEntry } from '../lib/wordCard'
import EmptyState from './EmptyState'

interface Lookup {
  quoteId: string
  word: string
  entry: WordEntry | null
  loading: boolean
  error: string | null
}

const EMPTY_FORM = { text: '', zh: '', source: '', link: '' }

export default function QuoteView(): React.JSX.Element {
  const customs = useQuoteStore((s) => s.customs)
  const addQuote = useQuoteStore((s) => s.add)
  const removeQuote = useQuoteStore((s) => s.remove)
  const addWord = useWordbookStore((s) => s.add)

  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [lookup, setLookup] = useState<Lookup | null>(null)
  const cancelRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    void useQuoteStore.getState().load()
    return () => cancelRef.current?.()
  }, [])

  const lookUp = (quoteId: string, word: string): void => {
    cancelRef.current?.()
    setLookup({ quoteId, word, entry: null, loading: true, error: null })
    cancelRef.current = quickTranslate(word, 'word', {
      onChunk: () => {
        /* 由 onDone 汇总 */
      },
      onDone: (full) => {
        const entry = parseWordCard(full)
        setLookup({ quoteId, word, entry, loading: false, error: entry ? null : '未能解析该词，请重试' })
      },
      onError: (m) => setLookup({ quoteId, word, entry: null, loading: false, error: m })
    }).cancel
  }

  const submitQuote = (): void => {
    addQuote({ text: form.text, zh: form.zh, source: form.source || '自收藏', link: form.link })
    setForm(EMPTY_FORM)
    setShowForm(false)
  }

  const renderQuote = (q: Quote, custom: boolean): React.JSX.Element => (
    <div key={q.id} className="card p-5">
      <div className="flex items-start justify-between gap-3">
        <p className="select-text text-[15px] font-medium leading-relaxed">
          {splitWords(q.text).map((p, i) =>
            p.isWord ? (
              <button
                key={i}
                className="word-link cursor-pointer"
                onClick={() => lookUp(q.id, p.text)}
                title="点击查词"
              >
                {p.text}
              </button>
            ) : (
              <span key={i}>{p.text}</span>
            )
          )}
        </p>
        {custom && (
          <button
            className="btn btn-ghost !p-1.5 shrink-0 text-ink-3 hover:!text-danger"
            onClick={() => removeQuote(q.id)}
            title="删除"
          >
            <Trash2 size={13} />
          </button>
        )}
      </div>

      <p className="mt-2 text-[13px] leading-relaxed text-ink-2">{q.zh}</p>

      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-2.5">
        <span className="text-[11px] text-ink-3">— {q.source}</span>
        {q.link && (
          <button
            className="flex items-center gap-0.5 text-[11px] text-accent transition hover:brightness-95"
            onClick={() => void window.bridge.openExternal(q.link!)}
            title="打开出处链接"
          >
            <ExternalLink size={11} /> 出处
          </button>
        )}
        {q.tags?.map((t) => (
          <span key={t} className="chip !px-2 !py-0.5 text-[10px] text-accent">#{t}</span>
        ))}
      </div>

      {lookup?.quoteId === q.id && (
        <div className="mt-3 animate-float-in rounded-xl border border-line bg-surface p-3">
          {lookup.loading ? (
            <div className="flex items-center gap-2 text-[12px] text-ink-3">
              <Loader2 size={12} className="animate-spin" /> 正在查询「{lookup.word}」…
            </div>
          ) : lookup.error ? (
            <p className="text-[12px] text-danger">查询失败：{lookup.error}</p>
          ) : lookup.entry ? (
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[14px] font-semibold">{lookup.entry.word}</span>
                {lookup.entry.phonetic && <span className="text-[12px] text-ink-3">{lookup.entry.phonetic}</span>}
                {lookup.entry.pos && <span className="chip !text-[10px]">{lookup.entry.pos}</span>}
              </div>
              <p className="mt-1 text-[13px] leading-relaxed">{lookup.entry.def}</p>
              {lookup.entry.exs.length > 0 && (
                <p className="mt-1 select-text text-[11px] leading-relaxed text-ink-3">
                  {lookup.entry.exs[0].en} {lookup.entry.exs[0].zh && `（${lookup.entry.exs[0].zh}）`}
                </p>
              )}
              <div className="mt-2 flex items-center gap-1">
                <button
                  className="btn btn-ghost !px-2 !py-1 text-[11px]"
                  onClick={() => window.bridge.speak(lookup.entry!.word)}
                  title="朗读"
                >
                  <Volume2 size={11} /> 朗读
                </button>
                <button
                  className="btn btn-ghost !px-2 !py-1 text-[11px]"
                  onClick={() =>
                    addWord({
                      word: lookup.entry!.word,
                      definition: `${lookup.entry!.pos} ${lookup.entry!.def}`.trim(),
                      pos: lookup.entry!.pos,
                      context: lookup.entry!.exs[0]?.en
                    })
                  }
                  title="加入生词本"
                >
                  <BookmarkPlus size={11} /> 加入生词本
                </button>
                <button
                  className="btn btn-ghost !px-2 !py-1 text-[11px] ml-auto text-ink-3"
                  onClick={() => setLookup(null)}
                  title="关闭"
                >
                  <X size={11} />
                </button>
              </div>
            </div>
          ) : null}
        </div>
      )}
    </div>
  )

  const all = [...customs, ...BUILTIN_QUOTES]

  return (
    <div className="flex h-full flex-col">
      <div className="glass flex shrink-0 items-center justify-between border-b px-5 py-3">
        <h1 className="flex items-center gap-2 text-[17px] font-semibold">
          <QuoteIcon size={16} className="text-accent" /> 美人美言
          <span className="text-[11px] font-normal text-ink-3">共 {all.length} 句 · 点英文单词可查释义</span>
        </h1>
        <button className="btn btn-primary" onClick={() => setShowForm((v) => !v)}>
          <Plus size={13} /> 收藏句子
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        <div className="mx-auto max-w-3xl space-y-3">
          {showForm && (
            <div className="card animate-float-in space-y-2 p-4">
              <textarea
                className="input min-h-[64px] resize-none"
                placeholder="英文句子 / 名言 *"
                value={form.text}
                onChange={(e) => setForm({ ...form, text: e.target.value })}
              />
              <input
                className="input"
                placeholder="中文释义"
                value={form.zh}
                onChange={(e) => setForm({ ...form, zh: e.target.value })}
              />
              <div className="grid grid-cols-2 gap-2">
                <input
                  className="input"
                  placeholder="出处（作者 · 作品）"
                  value={form.source}
                  onChange={(e) => setForm({ ...form, source: e.target.value })}
                />
                <input
                  className="input"
                  placeholder="出处链接（可选）"
                  value={form.link}
                  onChange={(e) => setForm({ ...form, link: e.target.value })}
                />
              </div>
              <div className="flex justify-end gap-2">
                <button className="btn" onClick={() => { setShowForm(false); setForm(EMPTY_FORM) }}>取消</button>
                <button className="btn btn-primary" disabled={!form.text.trim()} onClick={submitQuote}>保存</button>
              </div>
            </div>
          )}

          {!all.length && (
            <EmptyState icon={QuoteIcon} title="还没有美言" hint="收藏一句名言，或浏览内置的经典句子" />
          )}
          {all.map((q) => renderQuote(q, customs.some((c) => c.id === q.id)))}
        </div>
      </div>
    </div>
  )
}
