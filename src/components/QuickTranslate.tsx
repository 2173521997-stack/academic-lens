import { useCallback, useEffect, useRef, useState } from 'react'
import { Send, Square, Volume2, Copy, Eraser, History, FolderOpen, Maximize2, Loader2, BookmarkPlus, BookmarkCheck, SearchX, BookOpen, Languages, Sparkles, Feather, Keyboard, Calculator, Lightbulb } from 'lucide-react'
import { quickTranslate, loadRecents, clearRecents, isCn, isCnWord, type QuickMode, type QuickRecent } from '../lib/quickTranslate'
import { isPhrase } from '../lib/phrases'
import { useFileStore } from '../stores/fileStore'
import { useWindowStore } from '../stores/windowStore'
import { useWordbookStore } from '../stores/wordbookStore'
import { isSupported } from '../lib/types'
import { parseAnyFile } from '../lib/parse'
import { suggest } from '../lib/suggest'
import { parseWordCard, type WordEntry } from '../lib/wordCard'
import Segmented from './Segmented'

const PLACEHOLDERS: Record<QuickMode, string> = {
  word: '输入英文单词/学术术语或中文词语... [Enter 查词卡 · 真实词典/AI 双轨]',
  translate: '输入英文句子/段落... [Enter 即翻 · 自动修复 PDF 跨行断词与连字符]',
  explain: '输入长难句（拆解语法修饰）或公式/LaTeX（提取变量字典与大白话直觉）...',
  polish: '输入待润色英文或中文草稿... [Enter 输出学术规范版与变体]',
  cn2en: '输入中文词语自动反查英文词卡，句子直接直译...'
}

const MODE_SAMPLES: Record<QuickMode, { label: string; text: string }[]> = {
  word: [
    { label: '核心学术词', text: 'transformer' },
    { label: '学术短语', text: 'attention mechanism' },
    { label: '中文反查', text: '过拟合' }
  ],
  translate: [
    { label: '结论句', text: 'Our framework achieves state-of-the-art accuracy on public benchmarks.' },
    { label: '动机句', text: 'Due to data scarcity, semi-supervised learning plays a crucial role.' }
  ],
  explain: [
    { label: '长难句剖析', text: 'The model, whose parameters were trained on diverse corpora, shows high robustness.' },
    { label: '公式拆解', text: 'L_{reg} = \\lambda \\sum_{i=1}^n ||\\theta_i||^2' }
  ],
  polish: [
    { label: '摘要润色', text: 'Nowadays deep learning is very good and used in many areas, but has data problems.' }
  ],
  cn2en: []
}

export default function QuickTranslate(): React.JSX.Element {
  const [input, setInput] = useState('')
  const [result, setResult] = useState('')
  const [mode, setMode] = useState<QuickMode>('translate')
  const [streaming, setStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notFound, setNotFound] = useState<string | null>(null)
  const [suggestion, setSuggestion] = useState<string | null>(null)
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
    // Cmd/Ctrl+Shift+T：唤起小窗 → 进入单词界面 + 聚焦输入框，Cmd+V 粘贴即查词
    const offFocus = window.bridge.onFocusInput(() => {
      setMode('word')
      setResult('')
      setError(null)
      setNotFound(null)
      setSuggestion(null)
      inputRef.current?.focus()
      inputRef.current?.select()
    })
    return () => offFocus()
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
    (text: string, explicitMode?: QuickMode, forceLlm = false): void => {
      const t = text.trim()
      const m = explicitMode ?? mode
      if (!t || streamingRef.current) {
        window.bridge.debugLog(`run skipped: empty=${!t} streaming=${streamingRef.current}`)
        return
      }
      // 自动检测：含中文一律走中译英（词→词卡，句→直译）；润色模式显式指定，不自动分流
      const eff: QuickMode = m === 'polish' ? 'polish' : isCn(t) ? 'cn2en' : m
      window.bridge.debugLog(`run start: text="${t.slice(0, 40)}" mode=${eff}`)
      streamingRef.current = true
      setStreaming(true)
      setError(null)
      setNotFound(null)
      setSuggestion(null)
      setResult('')
      cancelRef.current = quickTranslate(
        t,
        eff,
        {
          onChunk: (d) => setResult((r) => r + d),
          onDone: () => {
            streamingRef.current = false
            setStreaming(false)
            // 新记录立即出现在历史顶部
            void loadRecents().then(setRecents)
          },
          onNotFound: (word) => {
            window.bridge.debugLog(`lookup notFound: ${word}`)
            streamingRef.current = false
            setStreaming(false)
            setResult('')
            setNotFound(word)
          },
          onSuggestion: (s) => setSuggestion(s),
          onError: (err) => {
            window.bridge.debugLog(`lookup error: ${err}`)
            streamingRef.current = false
            setError(err)
            setStreaming(false)
          }
        },
        { forceLlm }
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

  // ⌘X / Ctrl+Shift+X：一键翻译（自动复制选中 → 唤起 → 自动填入并翻译），唤起统一落在单词页面
  useEffect(() => {
    const offText = window.bridge.onSelectionText((text) => {
      const t = text.trim()
      window.bridge.debugLog(`onSelectionText received: "${t.slice(0, 40)}" len=${t.length}`)
      if (!t) return
      const isWord = !isCn(t) && (/^[A-Za-z][A-Za-z'-]{1,45}$/.test(t) || isPhrase(t))
      // UI 固定在单词页面；prompt 仍按内容分流（词/短语→词卡，句子→翻译）
      setMode('word')
      setResult('')
      setError(null)
      setNotFound(null)
      setInput(t)
      run(t, isWord ? 'word' : 'translate')
    })
    const offEmpty = window.bridge.onSelectionEmpty((message) => {
      setError(message ?? '未检测到选中文字：请先选中单词或句子，再按取词快捷键')
    })
    return () => {
      offText()
      offEmpty()
    }
  }, [run])

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

  const cnInput = isCn(input)
  const cn2enWord = cnInput && isCnWord(input)
  const wordCard = (mode === 'word' || cn2enWord) && result && !streaming ? parseWordCard(result) : null

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between px-3 pt-2.5">
        {cnInput ? (
          <span className="flex items-center gap-1.5 text-[11px] font-medium text-accent">
            <span className="chip bg-accent-soft text-accent">中译英</span>
            {cn2enWord ? '词语 → 词卡' : '句子 → 直译'}
          </span>
        ) : (
          <Segmented<QuickMode>
            items={[
              { value: 'word', label: '单词' },
              { value: 'translate', label: '翻译' },
              { value: 'explain', label: '讲解' },
              { value: 'polish', label: '润色' }
            ]}
            value={mode}
            onChange={setMode}
          />
        )}
        <div className="flex items-center gap-1">
          <button className="btn btn-ghost !p-1.5" onClick={() => void openFile()} title="打开文档翻译">
            {opening ? <Loader2 size={14} className="animate-spin" /> : <FolderOpen size={14} />}
          </button>
          <button className="btn btn-ghost !p-1.5" onClick={() => { setInput(''); setResult(''); setError(null); setNotFound(null); setSuggestion(null); inputRef.current?.focus() }} title="清空">
            <Eraser size={14} />
          </button>
        </div>
      </div>

      <div className="px-3 pt-2">
        <textarea
          ref={inputRef}
          className="input min-h-[64px] resize-none !rounded-2xl !text-[13px] leading-relaxed"
          placeholder={PLACEHOLDERS[cnInput ? 'cn2en' : mode]}
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
        {suggestion && !streaming && (
          <div className="card animate-float-in mb-2 !rounded-xl border border-accent/30 bg-accent-soft/40 p-3">
            <p className="text-[12px] leading-relaxed text-ink-1">
              你输入的可能是
              <button
                className="mx-1.5 inline-flex items-center rounded-md bg-accent px-2 py-0.5 text-[12px] font-semibold text-white transition hover:opacity-90"
                onClick={() => pickSuggestion(suggestion)}
              >
                {suggestion}
              </button>
              （点击即按此拼写查询）
            </p>
          </div>
        )}
        {notFound && !streaming && (
          <div className="card animate-float-in mb-2 !rounded-xl border border-ink-3/20 p-3.5">
            <div className="flex items-start gap-2.5">
              <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-ink-3/10 text-ink-3">
                <SearchX size={14} />
              </div>
              <div className="min-w-0">
                <p className="text-[13px] font-semibold text-ink-1">
                  没有找到「{notFound}」
                </p>
                <p className="mt-1 text-[12px] leading-relaxed text-ink-3">
                  词典里没有收录这个词，可能是拼写有误或属于专有名词 / 生僻词。
                  <br />
                  试试下面的方式：
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <button
                    className="btn btn-ghost !px-2 !py-1 text-[11px]"
                    onClick={() => run(input.trim(), 'word', true)}
                    title="跳过词典，直接用 AI 查词"
                  >
                    改用 AI 查词
                  </button>
                  <button className="btn btn-ghost !px-2 !py-1 text-[11px]" onClick={() => window.bridge.speak(notFound)}>
                    <Volume2 size={11} /> 朗读拼写
                  </button>
                </div>
                <p className="mt-2 text-[10px] text-ink-3">
                  提示：若确定拼写无误，可在设置中将查词方式切换为「AI 查词」，或直接按上方按钮用 AI 查询。
                </p>
              </div>
            </div>
          </div>
        )}
        {streaming && (
          <div className="mb-1 flex items-center gap-2 text-[11px] text-ink-3">
            <span className="h-3 w-3 animate-spin rounded-full border-2 border-accent border-t-transparent" />
            正在{cnInput ? '中译英' : mode === 'word' ? '查词' : mode === 'explain' ? '剖析讲解' : mode === 'polish' ? '润色' : '翻译'}…
          </div>
        )}

        {wordCard ? (
          <WordCard
            entry={wordCard}
            onSpeak={() => {
              if (wordCard.audio) {
                const a = new Audio(wordCard.audio)
                void a.play().catch(() => window.bridge.speak(wordCard.word))
              } else {
                window.bridge.speak(wordCard.word)
              }
            }}
            onCopy={() => {
              window.bridge.copyText(`${wordCard.word} ${wordCard.phonetic} ${wordCard.pos} ${wordCard.def}`)
              setCopied(true)
              setTimeout(() => setCopied(false), 1500)
            }}
            copied={copied}
            onBookmark={() => {
              addWord({
                word: wordCard.word,
                definition: `${wordCard.pos} ${wordCard.def}`,
                pos: wordCard.pos,
                context: wordCard.exs[0]?.en ?? ''
              })
            }}
            onTranslateSentence={cn2enWord ? undefined : () => run(input, 'translate')}
          />
        ) : result ? (
          <div className="card animate-float-in p-3">
            <div className={`select-text text-[13px] leading-relaxed ${streaming ? 'stream-caret' : ''}`}>
              {result}
            </div>
            {!streaming && (
              <div className="mt-2 flex items-center gap-1 border-t border-line pt-2">
                <button className="btn btn-ghost !px-2 !py-1 text-[11px]" onClick={() => window.bridge.speak(result)} title="朗读">
                  <Volume2 size={11} /> 朗读
                </button>
                <button
                  className="btn btn-ghost !px-2 !py-1 text-[11px]"
                  onClick={() => {
                    window.bridge.copyText(result)
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
            <div className="space-y-3 py-2 animate-in fade-in duration-150">
              {/* 功能使用说明卡片 */}
              <div className="rounded-xl border border-line bg-card/60 p-3.5 text-left">
                <div className="flex items-center gap-2 font-medium text-ink-1">
                  <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-accent/10 text-accent">
                    {mode === 'word' ? <BookOpen size={13} /> : mode === 'translate' ? <Languages size={13} /> : mode === 'explain' ? <Calculator size={13} /> : <Feather size={13} />}
                  </div>
                  <span className="text-[12px] font-semibold">
                    {mode === 'word' ? '📖 单词模式使用方法' : mode === 'translate' ? '🌐 翻译模式使用方法' : mode === 'explain' ? '🔬 讲解模式使用方法' : '✍️ 润色模式使用方法'}
                  </span>
                </div>

                <p className="mt-2 text-[11px] leading-relaxed text-ink-2">
                  {mode === 'word' && '输入英文单词或短语，即刻生成标准音标、词性、权威简明释义与学术例句，支持一键收藏入生词本。输入中文词语自动反查英文词卡。'}
                  {mode === 'translate' && '输入学术长句或整段英文，输出地道学术直译；自动修复 PDF 复制产生的跨行断句与连字符断词。'}
                  {mode === 'explain' && '输入长难句分析主干与从句修饰关系；输入数学公式或 LaTeX，自动提取变量字典（Symbol Table）并用大白话讲透算法作用。'}
                  {mode === 'polish' && '输入英文草稿或中文初稿，自动输出符合 IEEE/ACM/Nature 规范的学术定稿，并提供用词建议与变体。'}
                </p>

                {/* 快捷键速查 */}
                <div className="mt-3 border-t border-line/60 pt-2.5">
                  <div className="flex items-center gap-1.5 text-[10px] font-medium text-ink-3">
                    <Keyboard size={11} />
                    <span>快捷操作指引</span>
                  </div>
                  <div className="mt-1.5 grid grid-cols-2 gap-1.5 text-[10px] text-ink-2">
                    <div className="flex items-center justify-between rounded-lg bg-surface/80 px-2 py-1">
                      <span>划词秒翻</span>
                      <kbd className="font-semibold text-accent">Alt+X / Ctrl+Shift+X</kbd>
                    </div>
                    <div className="flex items-center justify-between rounded-lg bg-surface/80 px-2 py-1">
                      <span>唤起小窗</span>
                      <kbd className="font-semibold text-accent">Alt+T / Ctrl+Shift+T</kbd>
                    </div>
                    <div className="flex items-center justify-between rounded-lg bg-surface/80 px-2 py-1">
                      <span>大/小窗切换</span>
                      <kbd className="font-semibold text-accent">F11 / Ctrl+Shift+M</kbd>
                    </div>
                    <div className="flex items-center justify-between rounded-lg bg-surface/80 px-2 py-1">
                      <span>提交查询</span>
                      <kbd className="font-semibold text-accent">Enter</kbd>
                    </div>
                  </div>
                </div>

                {/* 典型范例一键试用 */}
                {MODE_SAMPLES[mode]?.length > 0 && (
                  <div className="mt-3 border-t border-line/60 pt-2.5">
                    <div className="flex items-center gap-1 text-[10px] font-medium text-ink-3">
                      <Lightbulb size={11} />
                      <span>点击一键填入试用范例：</span>
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {MODE_SAMPLES[mode].map((s, idx) => (
                        <button
                          key={idx}
                          onClick={() => {
                            setInput(s.text)
                            run(s.text)
                          }}
                          className="btn btn-ghost !border-line !bg-surface !px-2 !py-1 text-[10px] text-ink-2 hover:!border-accent/40 hover:!text-accent"
                        >
                          <Sparkles size={10} className="text-accent" />
                          <span>{s.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )
        )}

        {!streaming && recents.length > 0 && (
          <div className="mt-3">
            <div className="mb-1.5 flex items-center justify-between">
              <p className="flex items-center gap-1 text-[10px] font-medium text-ink-3">
                <History size={10} /> 搜索历史（点击回看 · ⭐ 加入生词本）
              </p>
              <button
                className="flex items-center gap-0.5 text-[10px] text-ink-3 transition hover:text-danger"
                onClick={() => {
                  clearRecents()
                  setRecents([])
                }}
                title="清空全部搜索历史"
              >
                <Eraser size={10} /> 清空全部
              </button>
            </div>
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
                        // cn2en 由输入自动派生，不落回 mode 状态
                        if (r.mode !== 'cn2en') setMode(r.mode)
                        setResult('')
                        // 立即翻译，历史条目保留不消失
                        run(r.src, r.mode)
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
                                pos: card.pos,
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
            <Send size={12} /> {cnInput ? '中译英' : mode === 'word' ? '查词' : '翻译'}
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
  onTranslateSentence?: () => void
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
            {w.source === 'uapis' ? (
              <span className="chip !bg-ok/10 !text-ok" title="来自免费词典 API（Grounding 层真实数据）">词典</span>
            ) : (
              <span className="chip !bg-ink-3/10 !text-ink-3" title="由 AI 生成，仅供参考">AI</span>
            )}
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
        {props.onTranslateSentence && (
          <button className="btn btn-ghost !px-2 !py-1 text-[11px]" onClick={props.onTranslateSentence}>
            翻译整句
          </button>
        )}
        <button className="btn btn-ghost !px-2 !py-1 text-[11px]" onClick={props.onCopy}>
          {props.copied ? <span className="text-ok">已复制</span> : (<><Copy size={11} /> 复制词条</>)}
        </button>
      </div>
    </div>
  )
}
