import { useCallback, useEffect, useRef, useState } from 'react'
import { Send, Square, Volume2, Copy, Eraser, History, FolderOpen, Maximize2, Loader2, BookmarkPlus, BookmarkCheck } from 'lucide-react'
import { quickTranslate, loadRecents, type QuickMode, type QuickRecent } from '../lib/quickTranslate'
import { useFileStore } from '../stores/fileStore'
import { useWindowStore } from '../stores/windowStore'
import { useWordbookStore } from '../stores/wordbookStore'
import { isSupported } from '../lib/types'
import { parseAnyFile } from '../lib/parse'
import { suggest } from '../lib/suggest'
import { parseWordCard, type WordEntry } from '../lib/wordCard'
import Segmented from './Segmented'

export default function QuickTranslate(): React.JSX.Element {
  const [input, setInput] = useState('')
  const [result, setResult] = useState('')
  const [mode, setMode] = useState<QuickMode>('translate')
  const [streaming, setStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [recents, setRecents] = useState<QuickRecent[]>([])
  const [copied, setCopied] = useState(false)
  const [opening, setOpening] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const cancelRef = useRef<(() => void) | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const streamingRef = useRef(false)

  const doc = useFileStore((s) => s.doc)
  const segments = useFileStore((s) => s.segments)
  const progress = useFileStore((s) => s.progress)
  const translating = segments.some((s) => s.translating)
  const doneCount = segments.filter((s) => s.translation).length
  const setModeFull = useWindowStore((s) => s.setMode)
  const addWord = useWordbookStore((s) => s.add)
  const wordbookWords = useWordbookStore((s) => s.words)

  const [suggestions, setSuggestions] = useState<string[]>([])
  const [selIdx, setSelIdx] = useState(-1)

  useEffect(() => {
    void loadRecents().then(setRecents)
    inputRef.current?.focus()
  }, [])

  // 推荐搜索：纯字母输入时推测完整单词
  useEffect(() => {
    if (streamingRef.current) return
    if (!/^[a-zA-Z]{2,}$/.test(input.trim())) {
      setSuggestions([])
      setSelIdx(-1)
      return
    }
    let alive = true
    void suggest(input.trim()).then((list) => {
      if (alive) {
        setSuggestions(list)
        setSelIdx(-1)
      }
    })
    return () => {
      alive = false
    }
  }, [input])

  const run = useCallback(
    (text: string, explicitMode?: QuickMode): void => {
      const t = text.trim()
      const m = explicitMode ?? mode
      if (!t || streamingRef.current) return
      streamingRef.current = true
      setStreaming(true)
      setError(null)
      setResult('')
      cancelRef.current = quickTranslate(
        t,
        m,
        {
          onChunk: (d) => setResult((r) => r + d),
          onDone: () => {
            streamingRef.current = false
            setStreaming(false)
          },
          onError: (err) => {
            streamingRef.current = false
            setError(err)
            setStreaming(false)
          }
        }
      ).cancel
    },
    [mode]
  )

  const pickSuggestion = useCallback(
    (word: string): void => {
      cancelRef.current?.()
      cancelRef.current = null
      streamingRef.current = false
      setStreaming(false)
      setInput(word)
      setMode('word')
      setSuggestions([])
      run(word, 'word')
      inputRef.current?.focus()
    },
    [run]
  )

  useEffect(() => {
    if (!input.trim() || streamingRef.current) return
    // 疑似单词输入（纯字母）交给推荐系统，不自动翻译
    if (/^[a-zA-Z]{2,}$/.test(input.trim())) return
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => run(input), 300)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [input, mode, run])

  useEffect(() => {
    window.bridge.onSelectionText((text) => {
      const t = text.trim()
      if (!t) return
      const isWord = /^[A-Za-z][A-Za-z'-]{1,45}$/.test(t)
      const m: QuickMode = isWord ? 'word' : 'translate'
      setInput(t)
      setMode(m)
      run(t, m)
    })
    window.bridge.onSelectionEmpty(() => {
      setError('未检测到选中文字：请先在目标应用中选中单词/句子，再按 Ctrl/Cmd+Shift+D' + (navigator.platform.includes('Mac') ? '（macOS 需在「系统设置→隐私与安全性→辅助功能」授权）' : ''))
    })
  }, [run])

  const stop = (): void => {
    cancelRef.current?.()
    cancelRef.current = null
    streamingRef.current = false
    setStreaming(false)
  }

  const openFile = async (): Promise<void> => {
    const paths = await window.bridge.openFiles()
    for (const p of paths) {
      const name = p.split(/[\\/]/).pop() ?? p
      if (!isSupported(name)) continue
      setOpening(true)
      try {
        const data = await window.bridge.readFile(p)
        const segs = await parseAnyFile(name, data)
        useFileStore.getState().setDoc({ name, size: data.byteLength }, segs)
        setModeFull('full')
        return
      } catch {
        /* 跳过失败文件 */
      } finally {
        setOpening(false)
      }
    }
  }

  const wordCard = mode === 'word' && result && !streaming ? parseWordCard(result) : null

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between px-3 pt-2.5">
        <Segmented<QuickMode>
          items={[
            { value: 'word', label: '单词' },
            { value: 'translate', label: '翻译' },
            { value: 'explain', label: '讲解' }
          ]}
          value={mode}
          onChange={setMode}
        />
        <div className="flex items-center gap-1">
          <button className="btn btn-ghost !p-1.5" onClick={() => void openFile()} title="打开文档翻译">
            {opening ? <Loader2 size={14} className="animate-spin" /> : <FolderOpen size={14} />}
          </button>
          <button className="btn btn-ghost !p-1.5" onClick={() => { setInput(''); setResult(''); setError(null); inputRef.current?.focus() }} title="清空">
            <Eraser size={14} />
          </button>
        </div>
      </div>

      <div className="px-3 pt-2">
        <textarea
          ref={inputRef}
          className="input min-h-[64px] resize-none !rounded-2xl !text-[14px]"
          placeholder="粘贴或输入英文，自动翻译…（Ctrl/Cmd+Shift+D 划词取词）"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              if (suggestions.length) {
                setSuggestions([])
                setSelIdx(-1)
              } else {
                window.bridge.windowHide()
              }
            } else if (e.key === 'ArrowDown' && suggestions.length) {
              e.preventDefault()
              setSelIdx((i) => (i + 1) % suggestions.length)
            } else if (e.key === 'ArrowUp' && suggestions.length) {
              e.preventDefault()
              setSelIdx((i) => (i <= 0 ? suggestions.length - 1 : i - 1))
            } else if (e.key === 'Tab' && suggestions.length) {
              e.preventDefault()
              pickSuggestion(suggestions[selIdx >= 0 ? selIdx : 0])
            } else if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              if (suggestions.length && selIdx >= 0) {
                pickSuggestion(suggestions[selIdx])
              } else if (streaming) {
                stop()
              } else {
                run(input.trim())
              }
            }
          }}
        />
        {suggestions.length > 0 && (
          <div className="card mt-1.5 animate-float-in !rounded-xl p-1 shadow-pop">
            {suggestions.map((w, i) => (
              <button
                key={w}
                className={`flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-[13px] transition ${
                  i === selIdx ? 'bg-accent-soft text-accent' : 'text-ink-1 hover:bg-accent-soft/60'
                }`}
                onMouseEnter={() => setSelIdx(i)}
                onClick={() => pickSuggestion(w)}
              >
                {w}
                {i === selIdx && <span className="text-[10px] text-ink-3">Enter 查词</span>}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2.5">
        {error && (
          <div className="mb-2 rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-[12px] text-danger">{error}</div>
        )}
        {streaming && (
          <div className="mb-1 flex items-center gap-2 text-[11px] text-ink-3">
            <span className="h-3 w-3 animate-spin rounded-full border-2 border-accent border-t-transparent" />
            正在{mode === 'word' ? '查词' : mode === 'translate' ? '翻译' : '讲解'}…
          </div>
        )}

        {wordCard ? (
          <WordCard
            entry={wordCard}
            onSpeak={() => window.bridge.speak(wordCard.word)}
            onCopy={() => {
              void navigator.clipboard.writeText(
                `${wordCard.word} ${wordCard.phonetic} ${wordCard.pos} ${wordCard.def}`
              )
              setCopied(true)
              setTimeout(() => setCopied(false), 1500)
            }}
            copied={copied}
            onBookmark={() => {
              addWord({
                word: wordCard.word,
                definition: `${wordCard.pos} ${wordCard.def}`,
                context: wordCard.exs[0]?.en ?? ''
              })
            }}
            onTranslateSentence={() => run(input, 'translate')}
          />
        ) : result ? (
          <div className="card animate-float-in p-3">
            <div className={`select-text text-[13px] leading-relaxed ${streaming ? 'stream-caret' : ''}`}>
              {mode === 'explain' ? (
                <div className="md-body" dangerouslySetInnerHTML={{ __html: markdownLite(result) }} />
              ) : (
                result
              )}
            </div>
            {!streaming && (
              <div className="mt-2 flex items-center gap-1 border-t border-line pt-2">
                <button className="btn btn-ghost !px-2 !py-1 text-[11px]" onClick={() => window.bridge.speak(result)} title="朗读">
                  <Volume2 size={11} /> 朗读
                </button>
                <button
                  className="btn btn-ghost !px-2 !py-1 text-[11px]"
                  onClick={() => {
                    void navigator.clipboard.writeText(result)
                    setCopied(true)
                    setTimeout(() => setCopied(false), 1500)
                  }}
                >
                  {copied ? <span className="text-ok">已复制</span> : (<><Copy size={11} /> 复制</>)}
                </button>
              </div>
            )}
          </div>
        ) : (
          !streaming && (
            <div className="py-8 text-center text-[11px] leading-relaxed text-ink-3">
              上课 / 读论文时的随手翻译
              <br />
              选中单词按 <kbd className="rounded bg-surface px-1.5 py-0.5 font-semibold">Ctrl/Cmd+Shift+D</kbd> 查词
              <br />
              粘贴图片进大窗可 OCR 翻译
            </div>
          )
        )}

        {!streaming && recents.length > 0 && (
          <div className="mt-3">
            <p className="mb-1.5 flex items-center gap-1 text-[10px] font-medium text-ink-3">
              <History size={10} /> 搜索历史（点击回看 · ⭐ 加入生词本）
            </p>
            <div className="space-y-1">
              {recents.map((r) => {
                const word = r.mode === 'word' ? r.src.trim() : /^[A-Za-z][A-Za-z'-]{1,45}$/.test(r.src.trim()) ? r.src.trim() : ''
                const saved = word && wordbookWords.some((w) => w.word.toLowerCase() === word.toLowerCase())
                return (
                  <div
                    key={r.time}
                    className="group flex w-full items-stretch overflow-hidden rounded-lg border border-line bg-card transition hover:bg-accent-soft"
                  >
                    <button
                      className="min-w-0 flex-1 px-2.5 py-1.5 text-left"
                      onClick={() => {
                        setInput(r.src)
                        setMode(r.mode)
                        setResult('')
                        setRecents(recents.filter((x) => x !== r))
                      }}
                    >
                      <span className="block truncate text-[11px] text-ink-2">{r.src}</span>
                      <span className="block truncate text-[11px] text-ink-3">{r.dst}</span>
                    </button>
                    {word && (
                      <button
                        className="flex w-8 shrink-0 items-center justify-center border-l border-line text-ink-3 transition hover:bg-accent hover:text-white"
                        title={saved ? '已在生词本' : '加入生词本（含释义与例句）'}
                        onClick={() => {
                          if (saved) return
                          if (r.mode === 'word') {
                            const card = parseWordCard(r.dst)
                            if (card) {
                              addWord({
                                word: card.word || word,
                                definition: `${card.pos} ${card.def}`.trim(),
                                context: card.exs.map((x) => `${x.en}（${x.zh}）`).join('；') || undefined
                              })
                              return
                            }
                          }
                          addWord({ word, definition: r.dst, context: r.src })
                        }}
                      >
                        {saved ? <BookmarkCheck size={13} className="text-accent" /> : <BookmarkPlus size={13} />}
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {doc && (
        <div className="shrink-0 border-t border-line bg-panel px-3 py-2">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-[11px] font-medium">{doc.name}</p>
              <div className="mt-1 h-1 overflow-hidden rounded-full bg-black/[0.08] dark:bg-white/[0.12]">
                <div
                  className="h-full rounded-full bg-accent transition-all"
                  style={{ width: `${segments.length ? Math.round((doneCount / segments.length) * 100) : 0}%` }}
                />
              </div>
            </div>
            <button className="btn !px-2.5 !py-1.5 text-[11px]" onClick={() => setModeFull('full')}>
              <Maximize2 size={11} /> 展开阅读
            </button>
          </div>
          {translating && (
            <p className="mt-1 text-[10px] text-ink-3">翻译中… {progress.done}/{progress.total}</p>
          )}
        </div>
      )}

      <div className="flex items-center gap-2 px-3 pb-2.5">
        {streaming ? (
          <button className="btn btn-primary flex-1 justify-center" onClick={stop}>
            <Square size={12} /> 停止
          </button>
        ) : (
          <button
            className="btn btn-primary flex-1 justify-center"
            disabled={!input.trim()}
            onClick={() => run(input.trim())}
          >
            <Send size={12} /> {mode === 'word' ? '查词' : mode === 'translate' ? '翻译' : '讲解'}
          </button>
        )}
      </div>
    </div>
  )
}

function WordCard(props: {
  entry: WordEntry
  onSpeak: () => void
  onCopy: () => void
  copied: boolean
  onBookmark: () => void
  onTranslateSentence: () => void
}): React.JSX.Element {
  const { entry: w } = props
  return (
    <div className="card animate-float-in p-3.5">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-[19px] font-semibold tracking-tight">{w.word}</h2>
          <div className="mt-1 flex items-center gap-2 text-[12px] text-ink-2">
            {w.phonetic && <span>{w.phonetic}</span>}
            {w.pos && <span className="chip">{w.pos}</span>}
          </div>
        </div>
        <div className="flex items-center gap-0.5">
          <button className="btn btn-ghost !p-1.5" onClick={props.onSpeak} title="朗读">
            <Volume2 size={14} />
          </button>
          <button className="btn btn-ghost !p-1.5" onClick={props.onBookmark} title="收藏到生词本">
            <BookmarkPlus size={14} />
          </button>
        </div>
      </div>
      <p className="mt-2 text-[13px] leading-relaxed text-ink-1">{w.def}</p>
      {w.exs.map((ex, i) => (
        <div key={i} className="mt-2 rounded-xl bg-surface px-3 py-2">
          <p className="select-text text-[12px] leading-relaxed">{ex.en}</p>
          {ex.zh && <p className="mt-0.5 text-[11px] text-ink-3">{ex.zh}</p>}
        </div>
      ))}
      <div className="mt-2.5 flex items-center gap-1 border-t border-line pt-2">
        <button className="btn btn-ghost !px-2 !py-1 text-[11px]" onClick={props.onTranslateSentence}>
          翻译整句
        </button>
        <button className="btn btn-ghost !px-2 !py-1 text-[11px]" onClick={props.onCopy}>
          {props.copied ? <span className="text-ok">已复制</span> : (<><Copy size={11} /> 复制词条</>)}
        </button>
      </div>
    </div>
  )
}

function markdownLite(md: string): string {
  let html = md
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  html = html
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>[\s\S]*?<\/li>)/g, '<ul>$1</ul>')
    .replace(/\n{2,}/g, '</p><p>')
    .replace(/\n/g, '<br/>')
  return `<p>${html}</p>`
}
