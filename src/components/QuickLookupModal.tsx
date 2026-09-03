import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  Search,
  Volume2,
  BookmarkPlus,
  BookmarkCheck,
  X,
  ArrowRight
} from 'lucide-react'
import { useAppStore } from '../stores/appStore'
import { useWordbookStore, cleanTermList } from '../stores/wordbookStore'
import { quickTranslate, isCn, type QuickMode } from '../lib/quickTranslate'
import { parseWordCard, type WordEntry } from '../lib/wordCard'
import { suggest, findTypoSuggestion } from '../lib/suggest'

export default function QuickLookupModal(): React.JSX.Element {
  const quickLookupOpen = useAppStore((s) => s.quickLookupOpen)
  const quickLookupWord = useAppStore((s) => s.quickLookupWord)
  const closeQuickLookup = useAppStore((s) => s.closeQuickLookup)
  const addWord = useWordbookStore((s) => s.add)
  const wordbookWords = useWordbookStore((s) => s.words)

  const [input, setInput] = useState('')
  const [result, setResult] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [typoHint, setTypoHint] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const cancelRef = useRef<(() => void) | null>(null)

  const lookup = useCallback((wordToLookup: string): void => {
    const w = wordToLookup.trim()
    if (!w) return
    cancelRef.current?.()
    setStreaming(true)
    setResult('')
    setSuggestions([])
    setTypoHint(null)

    // 检查是否有明显拼写错误
    if (!isCn(w) && /^[a-zA-Z]{3,}$/.test(w)) {
      void findTypoSuggestion(w).then((suggested) => {
        if (suggested && suggested.toLowerCase() !== w.toLowerCase()) {
          setTypoHint(suggested)
        }
      })
    }

    const mode: QuickMode = isCn(w) ? 'cn2en' : 'word'

    const call = quickTranslate(w, mode, {
      onChunk: (chunk) => setResult((prev) => prev + chunk),
      onDone: () => setStreaming(false),
      onError: () => setStreaming(false)
    })
    cancelRef.current = call.cancel
  }, [])

  useEffect(() => {
    if (quickLookupOpen) {
      const initial = (quickLookupWord || '').trim()
      setInput(initial)
      setResult('')
      setSuggestions([])
      setTypoHint(null)
      setTimeout(() => inputRef.current?.focus(), 50)
      if (initial) {
        lookup(initial)
      }
    } else {
      cancelRef.current?.()
    }
  }, [quickLookupOpen, quickLookupWord, lookup])

  // 联想建议
  useEffect(() => {
    if (!quickLookupOpen || streaming) return
    const trimmed = input.trim()
    if (!/^[a-zA-Z]{2,}$/.test(trimmed)) {
      setSuggestions([])
      return
    }
    let alive = true
    void suggest(trimmed, 6).then((list) => {
      if (alive) setSuggestions(list)
    })
    return () => {
      alive = false
    }
  }, [input, quickLookupOpen, streaming])

  if (!quickLookupOpen) return <></>

  const card: WordEntry | null = result ? parseWordCard(result) : null
  const currentWord = card?.word || input.trim()
  const isSaved = currentWord
    ? wordbookWords.some((w) => w.word.toLowerCase() === currentWord.toLowerCase())
    : false

  const handleSaveToWordbook = (): void => {
    if (!currentWord || isSaved) return
    addWord({
      word: currentWord,
      phonetic: card?.phonetic,
      pos: card?.pos,
      definition: card?.def || '（已保存）',
      context: card?.exs?.[0] ? `${card.exs[0].en}（${card.exs[0].zh}）` : undefined,
      synonyms: card?.synonyms ?? [],
      antonyms: card?.antonyms ?? []
    })
  }

  return (
    <div
      className="modal-backdrop fixed inset-0 z-50 flex items-start justify-center pt-20"
      onClick={closeQuickLookup}
    >
      <div
        className="card w-full max-w-xl animate-float-in overflow-hidden border border-line bg-card shadow-pop"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 顶部搜索输入 */}
        <div className="relative flex items-center border-b border-line px-3.5 py-2.5">
          <Search size={15} strokeWidth={1.5} className="text-ink-3" />
          <input
            ref={inputRef}
            className="flex-1 bg-transparent px-2.5 text-[14px] font-medium text-ink-1 outline-none placeholder:text-ink-3"
            placeholder="输入英文单词或中文词汇，按 Enter 查词…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                closeQuickLookup()
              } else if (e.key === 'Enter') {
                e.preventDefault()
                lookup(input)
              }
            }}
          />
          <div className="flex items-center gap-1">
            <kbd className="rounded bg-surface-alt px-1.5 py-0.5 text-[10.5px] font-medium text-ink-3">
              Enter
            </kbd>
            <button
              className="btn btn-ghost !p-1 text-ink-3 hover:text-ink-1"
              onClick={closeQuickLookup}
              title="关闭 (Esc)"
            >
              <X size={14} strokeWidth={1.5} />
            </button>
          </div>
        </div>

        {/* 拼写纠错提示 */}
        {typoHint && (
          <div className="flex items-center justify-between border-b border-line bg-accent-soft px-3.5 py-1.5 text-[11.5px] text-ink-2">
            <span>
              疑似拼写错误，是否查找：
              <button
                className="font-semibold text-accent underline underline-offset-2 ml-1"
                onClick={() => {
                  setInput(typoHint)
                  lookup(typoHint)
                }}
              >
                {typoHint}
              </button>
            </span>
            <button
              className="flex items-center gap-1 text-[11px] text-accent font-medium hover:underline cursor-pointer"
              onClick={() => {
                setInput(typoHint)
                lookup(typoHint)
              }}
            >
              查词 <ArrowRight size={11} strokeWidth={1.5} />
            </button>
          </div>
        )}

        {/* 联想词列表 */}
        {suggestions.length > 0 && !result && !streaming && (
          <div className="max-h-44 overflow-y-auto border-b border-line p-1.5">
            <div className="px-2 py-0.5 text-[10.5px] font-medium text-ink-3">推荐联想词</div>
            <div className="grid grid-cols-2 gap-1">
              {suggestions.map((s) => (
                <button
                  key={s}
                  className="flex items-center justify-between rounded-md px-2 py-1 text-left text-[12.5px] text-ink-1 transition hover:bg-accent-soft hover:text-accent cursor-pointer"
                  onClick={() => {
                    setInput(s)
                    lookup(s)
                  }}
                >
                  <span>{s}</span>
                  <span className="text-[10px] text-ink-3">查询</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* 词卡详细内容 */}
        <div className="max-h-[60vh] overflow-y-auto p-4">
          {streaming && !result && (
            <div className="flex items-center justify-center gap-2 py-8 text-[12.5px] text-ink-2">
              <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-accent border-t-transparent" />
              <span>正在检索释义…</span>
            </div>
          )}

          {card ? (
            <div className="space-y-3">
              {/* 词头与朗读、收藏 */}
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="text-[18px] font-semibold tracking-tight text-ink-1">
                      {card.word || input}
                    </h2>
                    {card.field && (
                      <span className="chip bg-accent-soft text-accent text-[10px] font-medium">
                        {card.field}
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 flex items-center gap-2 text-[11.5px] text-ink-2">
                    {card.phonetic && <span>{card.phonetic}</span>}
                    {card.pos && <span className="chip text-[9.5px]">{card.pos}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    className="btn btn-ghost !p-1.5 text-ink-2 hover:text-accent"
                    onClick={() => window.bridge.speak(card.word || input)}
                    title="发音"
                  >
                    <Volume2 size={14} strokeWidth={1.5} />
                  </button>
                  <button
                    className={`btn !px-2.5 !py-1 text-[11.5px] ${
                      isSaved ? '!border-accent !bg-accent-soft text-accent' : 'btn-primary'
                    }`}
                    onClick={handleSaveToWordbook}
                    title={isSaved ? '已在生词本' : '收藏'}
                  >
                    {isSaved ? (
                      <>
                        <BookmarkCheck size={12} strokeWidth={1.5} /> 已收藏
                      </>
                    ) : (
                      <>
                        <BookmarkPlus size={12} strokeWidth={1.5} /> 收藏
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* 核心释义 */}
              <div className="rounded-lg border border-line bg-surface p-2.5">
                <p className="text-[12.5px] leading-relaxed font-medium text-ink-1">
                  {card.def}
                </p>
              </div>

              {/* 同义词与反义词拓展 */}
              {(() => {
                const syns = cleanTermList(card.synonyms)
                const ants = cleanTermList(card.antonyms)

                if (!syns.length && !ants.length) return null

                return (
                  <div className="space-y-2 rounded-lg border border-line p-2.5">
                    {syns.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-[10px] font-semibold text-ink-3 uppercase mr-1">
                          同义词
                        </span>
                        {syns.map((syn, idx) => (
                          <span
                            key={`${syn}-${idx}`}
                            className="inline-flex items-center px-1.5 py-0.2 rounded text-[10.5px] font-medium bg-surface text-ink-2 border border-line select-text"
                          >
                            {syn}
                          </span>
                        ))}
                      </div>
                    )}

                    {ants.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1.5 pt-1.5 border-t border-line/50">
                        <span className="text-[10px] font-semibold text-ink-3 uppercase mr-1">
                          反义词
                        </span>
                        {ants.map((ant, idx) => (
                          <span
                            key={`${ant}-${idx}`}
                            className="inline-flex items-center px-1.5 py-0.2 rounded text-[10.5px] font-medium bg-surface text-ink-2 border border-line select-text"
                          >
                            {ant}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })()}

              {/* 例句 */}
              {card.exs.length > 0 && (
                <div className="space-y-1.5">
                  <div className="text-[10.5px] font-semibold text-ink-3 uppercase">例句与语境</div>
                  {card.exs.map((ex, i) => (
                    <div key={i} className="rounded-md bg-surface p-2 text-[11.5px] border border-line/40">
                      <p className="select-text leading-relaxed text-ink-1">{ex.en}</p>
                      {ex.zh && <p className="mt-0.5 text-[11px] text-ink-3">{ex.zh}</p>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : result ? (
            <div className="select-text text-[12.5px] leading-relaxed text-ink-1">
              {result}
            </div>
          ) : (
            !streaming && (
              <div className="py-6 text-center text-[12px] text-ink-3">
                输入英文单词或中文词汇，按 <kbd className="rounded bg-surface px-1 py-0.5">Enter</kbd> 查看音标、学术释义与例句
              </div>
            )
          )}
        </div>

        {/* 底部按键指引 */}
        <div className="flex items-center justify-between border-t border-line bg-surface/40 px-3.5 py-1.5 text-[10.5px] text-ink-3">
          <span>支持中英双向查词</span>
          <span>按 Esc 关闭</span>
        </div>
      </div>
    </div>
  )
}

