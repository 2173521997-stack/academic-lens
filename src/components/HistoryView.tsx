import { useState } from 'react'
import { History, Trash2, BookmarkPlus, BookmarkCheck, ChevronDown, ChevronRight, Copy } from 'lucide-react'
import { useHistoryStore, type HistoryType } from '../stores/historyStore'
import { useWordbookStore } from '../stores/wordbookStore'
import { loadRecents } from '../lib/quickTranslate'
import { parseWordCard } from '../lib/wordCard'
import EmptyState from './EmptyState'

const TYPE_META: Record<HistoryType, { label: string; cls: string }> = {
  file: { label: '文件', cls: 'bg-accent/10 text-accent' },
  translate: { label: '翻译', cls: 'bg-accent/10 text-accent' },
  summary: { label: '摘要', cls: 'bg-star/20 text-[#8a6d00] dark:text-star' },
  chat: { label: '对话', cls: 'bg-ok/15 text-[#1d7a3c] dark:text-ok' },
  word: { label: '生词', cls: 'bg-star/20 text-[#8a6d00] dark:text-star' }
}

const WORD_RE = /^[A-Za-z][A-Za-z'-]{1,45}$/

export default function HistoryView(): React.JSX.Element {
  const entries = useHistoryStore((s) => s.entries)
  const clear = useHistoryStore((s) => s.clear)
  const words = useWordbookStore((s) => s.words)
  const addWord = useWordbookStore((s) => s.add)
  const [openId, setOpenId] = useState<string | null>(null)

  /** 从搜索历史中回填词卡例句作为"搭配" */
  const collectContext = async (word: string): Promise<string | undefined> => {
    try {
      const recents = await loadRecents()
      const hit = recents.find((r) => r.mode === 'word' && r.src.trim().toLowerCase() === word.toLowerCase())
      if (!hit) return undefined
      const card = parseWordCard(hit.dst)
      if (!card || !card.exs.length) return undefined
      return card.exs.map((x) => `${x.en}（${x.zh}）`).join('；')
    } catch {
      return undefined
    }
  }

  const bookmark = async (entry: { title: string; detail?: string }): Promise<void> => {
    const word = entry.title.trim()
    if (!WORD_RE.test(word)) return
    const saved = words.some((w) => w.word.toLowerCase() === word.toLowerCase())
    if (saved) return
    const context = await collectContext(word)
    addWord({
      word,
      definition: entry.detail?.trim() || '',
      context
    })
  }

  return (
    <div className="flex h-full flex-col">
      <div className="glass flex shrink-0 items-center justify-between border-b px-5 py-3">
        <h1 className="text-[17px] font-semibold">历史记录</h1>
        <div className="flex items-center gap-2">
          {entries.length > 0 && (
            <button className="btn" onClick={clear}>
              <Trash2 size={13} /> 清空历史
            </button>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        <div className="mx-auto max-w-3xl space-y-1">
          {!entries.length && (
            <EmptyState icon={History} title="暂无记录" hint="翻译、对话、文件操作都会记录在这里" />
          )}
          {entries.map((e) => {
            const meta = TYPE_META[e.type]
            const isWord = e.type === 'translate' && WORD_RE.test(e.title.trim())
            const saved = isWord && words.some((w) => w.word.toLowerCase() === e.title.trim().toLowerCase())
            return (
              <div key={e.id} className="card card-hover flex flex-col gap-2 p-3.5">
                <div className="flex items-center gap-3">
                  <span className={`chip ${meta.cls}`}>{meta.label}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium select-text">{e.title}</p>
                    {e.detail && <p className="truncate text-[11px] text-ink-3 select-text">{e.detail}</p>}
                  </div>
                  {isWord && (
                    <button
                      className={`btn btn-ghost !px-2 !py-1.5 ${saved ? 'pointer-events-none' : ''}`}
                      title={saved ? '已在生词本' : '收藏到生词本（拼写 + 释义 + 例句搭配）'}
                      onClick={() => void bookmark(e)}
                    >
                      {saved ? (
                        <BookmarkCheck size={14} className="text-accent" />
                      ) : (
                        <BookmarkPlus size={14} className="text-ink-3 transition group-hover:text-accent" />
                      )}
                    </button>
                  )}
                  <span className="shrink-0 text-[11px] text-ink-3">
                    {new Date(e.time).toLocaleString('zh-CN', {
                      month: 'numeric',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit'
                    })}
                  </span>
                </div>
                {(e.payload || e.type === 'translate') && (
                  <div className="border-t border-line/60 pt-1.5">
                    <button
                      className="flex items-center gap-1 text-[10px] text-accent hover:underline"
                      onClick={() => setOpenId(openId === e.id ? null : e.id)}
                    >
                      {openId === e.id ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                      {e.payload ? '查看摘要全文' : '查看译文存档'}
                    </button>
                    {openId === e.id &&
                      (e.payload ? (
                        <div className="mt-2 rounded-lg border border-line/60 bg-ink-1/5 p-2">
                          <div className="mb-1 flex items-center justify-between">
                            <span className="text-[10px] text-ink-3">摘要</span>
                            <button
                              className="flex items-center gap-1 text-[10px] text-ink-3 hover:text-accent"
                              onClick={() => {
                                void navigator.clipboard?.writeText(e.payload ?? '')
                              }}
                            >
                              <Copy size={10} /> 复制
                            </button>
                          </div>
                          <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap break-words text-[11px] text-ink-1 select-text">{e.payload}</pre>
                        </div>
                      ) : (
                        <p className="mt-1.5 text-[10px] text-ink-3">
                          原文与译文已完整存档（保留最近若干篇）。可回到智能体对话，用「历史检索」或直接问「《{e.title}》之前的译文是什么」来找回。
                        </p>
                      ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
