import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Send,
  Square,
  Volume2,
  Copy,
  Check,
  Eraser,
  History,
  FolderOpen,
  Maximize2,
  Loader2,
  BookmarkPlus,
  BookmarkCheck,
  SearchX,
  BookOpen,
  Languages,
  Feather,
  Sparkles,
  Lightbulb,
  RotateCcw
} from 'lucide-react'
import { marked } from 'marked'
import { sanitizeHtml } from '../lib/sanitize'
import {
  quickTranslate,
  loadRecents,
  clearRecents,
  isCn,
  isCnWord,
  POLISH_STYLES,
  type QuickMode,
  type QuickRecent,
  type PolishStyle
} from '../lib/quickTranslate'
import { isPhrase } from '../lib/phrases'
import { useFileStore } from '../stores/fileStore'
import { useWindowStore } from '../stores/windowStore'
import { useWordbookStore } from '../stores/wordbookStore'
import { toast } from '../stores/noticeStore'
import { isSupported } from '../lib/types'
import { parseAnyFile } from '../lib/parse'
import { suggest } from '../lib/suggest'
import { parseWordCard, type WordEntry } from '../lib/wordCard'
import Segmented from './Segmented'

const PLACEHOLDERS: Record<QuickMode, string> = {
  word: '输入英文单词/学术短语或中文词语... [Enter 查词 · 真实词典与AI双轨]',
  translate: '输入英文或中文句子/段落... [Enter 即刻学术互译 · 自动清理换行]',
  polish: '输入英文草稿或中文初稿... [Enter 即刻按所选学术风格润色]',
  cn2en: '输入中文词语反查英文词卡，输入句子学术翻译为地道英文...'
}

const MODE_SAMPLES: Record<QuickMode, { label: string; text: string }[]> = {
  word: [
    { label: '核心学术词', text: 'transformer' },
    { label: '学术短语', text: 'attention mechanism' },
    { label: '中文反查', text: '过拟合' }
  ],
  translate: [
    { label: '英译中', text: 'Our framework achieves state-of-the-art accuracy on public benchmarks.' },
    { label: '中译英', text: '本文提出了一种基于注意力机制的高效多模态表征学习方法。' }
  ],
  polish: [
    { label: '摘要润色', text: 'Nowadays deep learning is very good and used in many areas, but has data problems.' },
    { label: '中文初稿', text: '我们通过大量实验证明了该算法在抗噪性上的优越表现。' }
  ],
  cn2en: []
}

export default function QuickTranslate(): React.JSX.Element {
  const [input, setInput] = useState('')
  const [result, setResult] = useState('')
  const [mode, setMode] = useState<QuickMode>('translate')
  const [polishStyle, setPolishStyle] = useState<PolishStyle>('journal')
  const [streaming, setStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notFound, setNotFound] = useState<string | null>(null)
  const [suggestion, setSuggestion] = useState<string | null>(null)
  const [recents, setRecents] = useState<QuickRecent[]>([])
  const [copied, setCopied] = useState(false)
  const [opening, setOpening] = useState(false)
  const [showHistory, setShowHistory] = useState(true)

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

    // 快捷键唤起小窗：聚焦输入框并选中文字，方便直接粘贴或输入
    const offFocus = window.bridge.onFocusInput(() => {
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
    (text: string, explicitMode?: QuickMode, forceLlm = false, explicitStyle?: PolishStyle): void => {
      const t = text.trim()
      const m = explicitMode ?? mode
      const st = explicitStyle ?? polishStyle
      if (!t || streamingRef.current) {
        window.bridge.debugLog(`run skipped: empty=${!t} streaming=${streamingRef.current}`)
        return
      }

      // 中文自动分流：word 模式下词语走词卡，句子走直译；translate 模式走中译英
      const eff: QuickMode = m === 'polish' ? 'polish' : isCn(t) ? 'cn2en' : m
      window.bridge.debugLog(`run start: text="${t.slice(0, 40)}" mode=${eff} style=${st}`)
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
        { forceLlm, polishStyle: st }
      ).cancel
    },
    [mode, polishStyle]
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

  // 划词取词：Ctrl+Shift+X / Alt+X / ⌘X
  useEffect(() => {
    const offText = window.bridge.onSelectionText((text) => {
      const t = text.trim()
      window.bridge.debugLog(`onSelectionText received: "${t.slice(0, 40)}" len=${t.length}`)
      if (!t) return
      const isSingleWord = !isCn(t) && /^[A-Za-z][A-Za-z'-]{1,45}$/.test(t)
      const isPhraseItem = !isCn(t) && isPhrase(t)
      const isCnItem = isCn(t) && isCnWord(t)

      // 单个单词/短语/中文短词 -> 单词模式；长句/段落 -> 翻译模式
      const targetMode: QuickMode = isSingleWord || isPhraseItem || isCnItem ? 'word' : 'translate'
      setMode(targetMode)
      setResult('')
      setError(null)
      setNotFound(null)
      setInput(t)
      run(t, targetMode)
    })
    const offEmpty = window.bridge.onSelectionEmpty((message) => {
      setError(message ?? '未检测到选中文字：请先在任意界面选中词句，再按快捷键')
    })
    return () => {
      offText()
      offEmpty()
    }
  }, [run])

  // 输入防抖：针对长句输入，停止输入 450ms 自动触发
  useEffect(() => {
    if (!input.trim() || streamingRef.current) return
    if (/^[a-zA-Z]{1,20}$/.test(input.trim())) return
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => run(input), 450)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [input, mode, polishStyle, run])

  const stop = (): void => {
    cancelRef.current?.()
    cancelRef.current = null
    streamingRef.current = false
    setStreaming(false)
  }

  const clearAll = (): void => {
    stop()
    setInput('')
    setResult('')
    setError(null)
    setNotFound(null)
    setSuggestion(null)
    setSuggestions([])
    inputRef.current?.focus()
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
  const activeStyleObj = POLISH_STYLES.find((x) => x.id === polishStyle)

  return (
    <div className="flex min-h-0 flex-1 flex-col select-none">
      {/* 顶部工具栏：模式切换 + 辅助操作 */}
      <div className="flex items-center justify-between border-b border-line/70 px-3 py-2 bg-panel/60 backdrop-blur">
        <div className="flex items-center gap-2">
          <Segmented<QuickMode>
            items={[
              { value: 'word', label: '📖 单词' },
              { value: 'translate', label: '🌐 翻译' },
              { value: 'polish', label: '✍️ 润色' }
            ]}
            value={mode}
            onChange={(m) => {
              setMode(m)
              setResult('')
              setError(null)
              setNotFound(null)
              setSuggestion(null)
              if (input.trim()) run(input.trim(), m)
            }}
          />
          {cnInput && mode !== 'polish' && (
            <span className="rounded-md bg-accent/10 px-1.5 py-0.5 text-[10px] font-medium text-accent">
              中译英
            </span>
          )}
        </div>

        <div className="flex items-center gap-1">
          <button
            className="btn btn-ghost !p-1.5 text-ink-3 hover:text-ink-1"
            onClick={clearAll}
            title="清空输入与结果 (Esc)"
          >
            <Eraser size={13} />
          </button>
          <button
            className="btn btn-ghost !p-1.5 text-ink-3 hover:text-ink-1"
            onClick={() => void openFile()}
            title="打开文献并进入双语对照大窗"
          >
            {opening ? <Loader2 size={13} className="animate-spin" /> : <FolderOpen size={13} />}
          </button>
        </div>
      </div>

      {/* 润色风格子栏（仅润色模式下显示） */}
      {mode === 'polish' && (
        <div className="flex items-center gap-1.5 border-b border-line/60 bg-surface/50 px-3 py-1.5 text-[11px]">
          <span className="text-[10px] font-medium text-ink-3">风格预设:</span>
          <div className="flex items-center gap-1">
            {POLISH_STYLES.map((st) => (
              <button
                key={st.id}
                className={`rounded-md px-2 py-0.5 transition text-[11px] ${
                  polishStyle === st.id
                    ? 'bg-accent font-semibold text-white shadow-xs'
                    : 'text-ink-2 hover:bg-surface-elevated'
                }`}
                onClick={() => {
                  setPolishStyle(st.id)
                  if (input.trim()) run(input.trim(), 'polish', false, st.id)
                }}
                title={st.desc}
              >
                {st.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 输入框与联想下拉 */}
      <div className="relative px-3 pt-2.5">
        <textarea
          ref={inputRef}
          className="input min-h-[66px] w-full resize-none !rounded-xl !text-[13px] leading-relaxed shadow-inner"
          placeholder={PLACEHOLDERS[cnInput && mode !== 'polish' ? 'cn2en' : mode]}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              if (suggestions.length) {
                setSuggestions([])
                setSelIdx(-1)
              } else if (input) {
                clearAll()
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
              } else if (input.trim()) {
                run(input.trim())
              }
            }
          }}
        />

        {/* 英文输入自动联想浮层 */}
        {suggestions.length > 0 && (
          <div className="absolute left-3 right-3 top-full z-20 mt-1 rounded-xl border border-line bg-panel p-1 shadow-lg animate-in fade-in zoom-in-95">
            {suggestions.map((w, i) => (
              <button
                key={w}
                className={`flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-[12px] transition ${
                  i === selIdx ? 'bg-accent text-white' : 'text-ink-1 hover:bg-accent-soft'
                }`}
                onMouseEnter={() => setSelIdx(i)}
                onClick={() => pickSuggestion(w)}
              >
                <span className="font-medium">{w}</span>
                <span className={`text-[10px] ${i === selIdx ? 'text-white/80' : 'text-ink-3'}`}>
                  {i === selIdx ? 'Enter 查词' : 'Tab 补全'}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 结果展示区 */}
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {/* 错误提示 */}
        {error && (
          <div className="mb-2 rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-[12px] text-danger animate-in fade-in">
            {error}
          </div>
        )}

        {/* 拼写纠错建议 */}
        {suggestion && !streaming && (
          <div className="mb-2 rounded-xl border border-accent/30 bg-accent-soft/40 p-2.5 text-[12px] text-ink-1 animate-in fade-in">
            <span>你输入的可能是 </span>
            <button
              className="inline-flex items-center rounded-md bg-accent px-2 py-0.5 font-semibold text-white transition hover:opacity-90"
              onClick={() => pickSuggestion(suggestion)}
            >
              {suggestion}
            </button>
            <span className="text-ink-3 text-[11px]">（点击按此纠错查询）</span>
          </div>
        )}

        {/* 词典未收录提示 */}
        {notFound && !streaming && (
          <div className="mb-2 rounded-xl border border-ink-3/20 bg-card p-3 animate-in fade-in">
            <div className="flex items-start gap-2.5">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-ink-3/10 text-ink-3">
                <SearchX size={14} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[12px] font-semibold text-ink-1">本地词典未收录「{notFound}」</p>
                <p className="mt-0.5 text-[11px] text-ink-3">可能是生僻术语、缩写或打错，推荐改用 AI 智能解析。</p>
                <div className="mt-2 flex items-center gap-1.5">
                  <button
                    className="btn !bg-accent !text-white !px-2.5 !py-1 text-[11px]"
                    onClick={() => run(input.trim(), 'word', true)}
                  >
                    <Sparkles size={11} /> 改用 AI 深度解析
                  </button>
                  <button
                    className="btn btn-ghost !px-2 !py-1 text-[11px]"
                    onClick={() => window.bridge.speak(notFound)}
                  >
                    <Volume2 size={11} /> 朗读拼写
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 流式生成进度提示 */}
        {streaming && (
          <div className="mb-2 flex items-center gap-2 text-[11px] text-accent">
            <span className="h-3 w-3 animate-spin rounded-full border-2 border-accent border-t-transparent" />
            <span>
              {mode === 'word'
                ? '正在查询单词与学术例句…'
                : mode === 'polish'
                ? `正在按「${activeStyleObj?.label}」风格润色…`
                : cnInput
                ? '正在进行中译英学术严谨翻译…'
                : '正在进行英译中学术严谨翻译…'}
            </span>
          </div>
        )}

        {/* 1. 单词卡片结果 */}
        {wordCard ? (
          <WordCard
            entry={wordCard}
            rawInput={input}
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
              toast('success', `已复制「${wordCard.word}」词条`, '剪贴板')
              setTimeout(() => setCopied(false), 1500)
            }}
            copied={copied}
            isSaved={wordbookWords.some((w) => w.word.toLowerCase() === wordCard.word.toLowerCase())}
            onBookmark={() => {
              const already = wordbookWords.some((w) => w.word.toLowerCase() === wordCard.word.toLowerCase())
              if (already) {
                toast('info', `「${wordCard.word}」已在生词本中`, '生词本')
                return
              }
              addWord({
                word: wordCard.word,
                definition: `${wordCard.pos} ${wordCard.def}`.trim(),
                pos: wordCard.pos,
                context: wordCard.exs[0]?.en ? `${wordCard.exs[0].en}（${wordCard.exs[0].zh}）` : input
              })
              toast('success', `已将「${wordCard.word}」加入生词本`, '收藏成功')
            }}
            onTranslateSentence={cn2enWord ? undefined : () => run(input, 'translate')}
          />
        ) : result ? (
          /* 2. 润色模式结果 vs 翻译模式结果 */
          mode === 'polish' ? (
            <PolishResultCard
              raw={result}
              streaming={streaming}
              styleLabel={activeStyleObj?.label ?? '顶刊规范'}
              onSpeak={(t) => window.bridge.speak(t)}
            />
          ) : (
            <TranslateResultCard
              result={result}
              streaming={streaming}
              cnInput={cnInput}
              onSpeak={(t) => window.bridge.speak(t)}
              onCopy={(t) => {
                window.bridge.copyText(t)
                setCopied(true)
                toast('success', '已复制译文内容', '剪贴板')
                setTimeout(() => setCopied(false), 1500)
              }}
              copied={copied}
            />
          )
        ) : (
          /* 3. 空白初始态：极简提示 + 快捷键速览 */
          !streaming && (
            <div className="space-y-3 py-2 animate-in fade-in">
              <div className="rounded-xl border border-line/70 bg-card/60 p-3 text-left">
                <div className="flex items-center justify-between text-[11px] font-semibold text-ink-1">
                  <span className="flex items-center gap-1.5">
                    {mode === 'word' ? <BookOpen size={12} className="text-accent" /> : mode === 'polish' ? <Feather size={12} className="text-accent" /> : <Languages size={12} className="text-accent" />}
                    {mode === 'word' ? '查词与短语 (支持英中双向)' : mode === 'polish' ? '学术润色 (四种顶刊风格)' : '学术互译 (自动消除换行噪声)'}
                  </span>
                </div>

                <div className="mt-2.5 grid grid-cols-2 gap-1.5 text-[10px] text-ink-2">
                  <div className="flex items-center justify-between rounded-lg bg-surface/80 px-2 py-1">
                    <span>划词秒翻</span>
                    <kbd className="font-semibold text-accent">Alt+X / Ctrl+Shift+X</kbd>
                  </div>
                  <div className="flex items-center justify-between rounded-lg bg-surface/80 px-2 py-1">
                    <span>调出小窗</span>
                    <kbd className="font-semibold text-accent">Alt+T / Ctrl+Shift+T</kbd>
                  </div>
                  <div className="flex items-center justify-between rounded-lg bg-surface/80 px-2 py-1">
                    <span>回车提交</span>
                    <kbd className="font-semibold text-accent">Enter</kbd>
                  </div>
                  <div className="flex items-center justify-between rounded-lg bg-surface/80 px-2 py-1">
                    <span>大/小窗切换</span>
                    <kbd className="font-semibold text-accent">Ctrl+Shift+M</kbd>
                  </div>
                </div>

                {MODE_SAMPLES[mode]?.length > 0 && (
                  <div className="mt-2.5 border-t border-line/60 pt-2">
                    <span className="text-[10px] text-ink-3">点击填入试用范例：</span>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {MODE_SAMPLES[mode].map((s, idx) => (
                        <button
                          key={idx}
                          onClick={() => {
                            setInput(s.text)
                            run(s.text)
                          }}
                          className="btn btn-ghost !border-line !bg-surface !px-2 !py-0.5 text-[10px] text-ink-2 hover:!border-accent/40 hover:!text-accent"
                        >
                          <Sparkles size={9} className="text-accent" />
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

        {/* 4. 搜索历史记录 */}
        {!streaming && recents.length > 0 && (
          <div className="mt-3 border-t border-line/60 pt-2">
            <div className="mb-1.5 flex items-center justify-between">
              <button
                className="flex items-center gap-1 text-[11px] font-medium text-ink-3 hover:text-ink-1"
                onClick={() => setShowHistory((v) => !v)}
              >
                <History size={11} /> 搜索历史 ({recents.length})
              </button>
              <button
                className="flex items-center gap-0.5 text-[10px] text-ink-3 transition hover:text-danger"
                onClick={() => {
                  clearRecents()
                  setRecents([])
                  toast('info', '已清空搜索历史', '历史记录')
                }}
                title="清空全部搜索历史"
              >
                <Eraser size={10} /> 清空全部
              </button>
            </div>

            {showHistory && (
              <div className="space-y-1">
                {recents.slice(0, 8).map((r) => {
                  const cleanSrc = r.src.trim()
                  const isWordItem =
                    r.mode === 'word' ||
                    /^[A-Za-z][A-Za-z'-]{1,45}$/.test(cleanSrc) ||
                    isPhrase(cleanSrc) ||
                    (isCn(cleanSrc) && isCnWord(cleanSrc))
                  const saved = isWordItem && wordbookWords.some((w) => w.word.toLowerCase() === cleanSrc.toLowerCase())

                  return (
                    <div
                      key={r.time}
                      className="group flex w-full items-stretch overflow-hidden rounded-lg border border-line bg-card transition hover:bg-accent-soft/50"
                    >
                      <button
                        className="min-w-0 flex-1 px-2.5 py-1.5 text-left"
                        onClick={() => {
                          setInput(r.src)
                          if (r.mode !== 'cn2en') setMode(r.mode)
                          setResult('')
                          run(r.src, r.mode)
                        }}
                      >
                        <div className="flex items-center justify-between">
                          <span className="block truncate text-[11px] font-medium text-ink-1">{r.src}</span>
                          <span className="text-[9px] text-ink-3">
                            {r.mode === 'word' ? '词卡' : r.mode === 'polish' ? '润色' : '翻译'}
                          </span>
                        </div>
                        <span className="block truncate text-[10px] text-ink-3">{r.dst.split('\n')[0]}</span>
                      </button>

                      {isWordItem && (
                        <button
                          className={`flex w-8 shrink-0 items-center justify-center border-l border-line transition ${
                            saved ? 'text-accent' : 'text-ink-3 hover:bg-accent hover:text-white'
                          }`}
                          title={saved ? '已在生词本' : '加入生词本'}
                          onClick={() => {
                            if (saved) {
                              toast('info', `「${cleanSrc}」已在生词本中`, '生词本')
                              return
                            }
                            const card = parseWordCard(r.dst)
                            if (card) {
                              addWord({
                                word: card.word || cleanSrc,
                                definition: `${card.pos} ${card.def}`.trim(),
                                pos: card.pos,
                                context: card.exs[0]?.en ? `${card.exs[0].en}（${card.exs[0].zh}）` : undefined
                              })
                            } else {
                              addWord({ word: cleanSrc, definition: r.dst.slice(0, 100) })
                            }
                            toast('success', `已将「${cleanSrc}」加入生词本`, '生词本')
                          }}
                        >
                          {saved ? <BookmarkCheck size={13} className="text-accent" /> : <BookmarkPlus size={13} />}
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* 底部阅读进度指示（如果后台有打开的文档） */}
      {doc && (
        <div className="shrink-0 border-t border-line bg-panel px-3 py-1.5 text-[11px]">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-[10px] font-medium text-ink-2">{doc.name}</p>
              <div className="mt-0.5 h-1 overflow-hidden rounded-full bg-black/[0.08] dark:bg-white/[0.12]">
                <div
                  className="h-full rounded-full bg-accent transition-all"
                  style={{ width: `${segments.length ? Math.round((doneCount / segments.length) * 100) : 0}%` }}
                />
              </div>
            </div>
            <button
              className="btn !px-2 !py-1 text-[10px]"
              onClick={() => setModeFull('full')}
              title="切换到全文双语对照大窗"
            >
              <Maximize2 size={10} /> 展开大窗
            </button>
          </div>
          {translating && (
            <p className="mt-0.5 text-[9px] text-ink-3">后台文档翻译中… {progress.done}/{progress.total}</p>
          )}
        </div>
      )}

      {/* 底部主执行按钮 */}
      <div className="flex items-center gap-2 px-3 pb-2.5 pt-1">
        {streaming ? (
          <button className="btn btn-primary flex-1 justify-center !py-1.5 text-[12px]" onClick={stop}>
            <Square size={12} /> 停止生成
          </button>
        ) : (
          <button
            className="btn btn-primary flex-1 justify-center !py-1.5 text-[12px]"
            disabled={!input.trim()}
            onClick={() => run(input.trim())}
          >
            <Send size={12} />
            {mode === 'word' ? '查词卡 (Enter)' : mode === 'polish' ? '润色文本 (Enter)' : '学术翻译 (Enter)'}
          </button>
        )}
      </div>
    </div>
  )
}

function WordCard(props: {
  entry: WordEntry
  rawInput: string
  onSpeak: () => void
  onCopy: () => void
  copied: boolean
  isSaved: boolean
  onBookmark: () => void
  onTranslateSentence?: () => void
}): React.JSX.Element {
  const { entry: w, isSaved } = props
  return (
    <div className="card p-3.5 animate-in fade-in select-text">
      {/* 词头栏 */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-[18px] font-bold tracking-tight text-ink-1">{w.word}</h2>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-ink-2">
            {w.phonetic && <span className="font-mono text-ink-3">{w.phonetic}</span>}
            {w.pos && <span className="chip !text-[10px]">{w.pos}</span>}
            {w.source === 'uapis' ? (
              <span className="chip !bg-ok/10 !text-ok !text-[10px]" title="来自免费词典 API（Grounding 真实数据）">
                权威词典
              </span>
            ) : (
              <span className="chip !bg-accent/10 !text-accent !text-[10px]" title="AI 深度学术释义与术语提炼">
                AI 深度
              </span>
            )}
          </div>
        </div>

        {/* 快捷操作 */}
        <div className="flex items-center gap-0.5">
          <button className="btn btn-ghost !p-1.5" onClick={props.onSpeak} title="朗读发音">
            <Volume2 size={14} />
          </button>
          <button
            className={`btn !p-1.5 transition ${isSaved ? '!bg-accent !text-white' : 'btn-ghost'}`}
            onClick={props.onBookmark}
            title={isSaved ? '已在生词本' : '收藏到生词本'}
          >
            {isSaved ? <BookmarkCheck size={14} /> : <BookmarkPlus size={14} />}
          </button>
        </div>
      </div>

      {/* 释义 */}
      <div className="mt-2.5 rounded-lg bg-surface/60 p-2 text-[13px] leading-relaxed text-ink-1">
        {w.def}
      </div>

      {/* 双语学术例句 */}
      {w.exs.length > 0 && (
        <div className="mt-2 space-y-1.5">
          {w.exs.map((ex, i) => (
            <div key={i} className="rounded-lg border border-line/60 bg-surface/30 px-2.5 py-1.5 text-[11px]">
              <p className="font-medium leading-relaxed text-ink-1">{ex.en}</p>
              {ex.zh && <p className="mt-0.5 text-ink-3">{ex.zh}</p>}
            </div>
          ))}
        </div>
      )}

      {/* 底部功能条 */}
      <div className="mt-2.5 flex items-center justify-between border-t border-line/60 pt-2 text-[11px]">
        <div className="flex items-center gap-1">
          {props.onTranslateSentence && (
            <button className="btn btn-ghost !px-2 !py-1 text-[11px]" onClick={props.onTranslateSentence}>
              <Languages size={11} /> 翻译整句
            </button>
          )}
          <button className="btn btn-ghost !px-2 !py-1 text-[11px]" onClick={props.onCopy}>
            {props.copied ? (
              <span className="text-ok flex items-center gap-0.5"><Check size={11} /> 已复制</span>
            ) : (
              <span className="flex items-center gap-0.5"><Copy size={11} /> 复制词条</span>
            )}
          </button>
        </div>

        <span className="text-[10px] text-ink-3">
          {isSaved ? '⭐ 已在生词本' : '点右上角 ⭐ 入本'}
        </span>
      </div>
    </div>
  )
}

/** 翻译模式结果展示卡片 */
function TranslateResultCard(props: {
  result: string
  streaming: boolean
  cnInput: boolean
  onSpeak: (text: string) => void
  onCopy: (text: string) => void
  copied: boolean
}): React.JSX.Element {
  const { result, streaming, cnInput, onSpeak, onCopy, copied } = props
  const html = useMemo(() => {
    try {
      return sanitizeHtml(marked.parse(result, { async: false }) as string)
    } catch {
      return result
    }
  }, [result])

  return (
    <div className="card p-3.5 animate-in fade-in select-text shadow-xs">
      <div className="mb-2 flex items-center justify-between border-b border-line/60 pb-2 text-[11px] text-ink-3">
        <span className="flex items-center gap-1.5 font-medium text-accent">
          <Languages size={13} />
          <span>{cnInput ? '中译英 · 顶刊严谨学术译文' : '英译中 · 领域学术规范译文'}</span>
        </span>
      </div>

      <div
        className={`text-[13.5px] leading-[1.8] text-ink-1 academic-markdown ${streaming ? 'stream-caret' : ''}`}
        dangerouslySetInnerHTML={{ __html: html }}
      />

      {!streaming && (
        <div className="mt-3 flex items-center justify-between border-t border-line/60 pt-2 text-[11px]">
          <div className="flex items-center gap-1">
            <button
              className="btn btn-ghost !px-2 !py-1 text-[11px]"
              onClick={() => onSpeak(result)}
              title="朗读译文"
            >
              <Volume2 size={11} /> 朗读
            </button>
            <button
              className="btn btn-ghost !px-2 !py-1 text-[11px]"
              onClick={() => onCopy(result)}
              title="复制译文"
            >
              {copied ? (
                <span className="text-ok flex items-center gap-0.5"><Check size={11} /> 已复制</span>
              ) : (
                <span className="flex items-center gap-0.5"><Copy size={11} /> 复制译文</span>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

interface PolishSectionData {
  draft: string
  suggestions: string[]
  alternative: string
}

function parsePolishSections(text: string): PolishSectionData {
  if (!text) return { draft: '', suggestions: [], alternative: '' }

  const draftMatch = text.match(/###\s*[✍️✨]*\s*润色定稿\s*([\s\S]*?)(?=###|$)/i)
  const sugMatch = text.match(/###\s*[💡🔍]*\s*改进要点[^\n]*\s*([\s\S]*?)(?=###|$)/i)
  const altMatch = text.match(/###\s*[🔄备]*\s*变体[^\n]*\s*([\s\S]*?)(?=###|$)/i)

  let draft = draftMatch ? draftMatch[1].trim() : ''
  let suggestionsRaw = sugMatch ? sugMatch[1].trim() : ''
  let alternative = altMatch ? altMatch[1].trim() : ''

  if (!draft && !suggestionsRaw && !alternative) {
    draft = text.trim()
  }

  const suggestions = suggestionsRaw
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('-') || l.startsWith('*') || l.startsWith('•') || /^\d+\./.test(l))

  return { draft, suggestions, alternative }
}

function parseSuggestionLine(line: string): { original?: string; replacement?: string; reason?: string; raw: string } {
  let c = line.replace(/^[-*•\d.]+\s*/, '').trim()
  c = c.replace(/^(?:\*\*|\*|`|)?原[表达词短语]*\s*(?:→|->)\s*替换建议(?:\*\*|\*|`|)?[\s:：]*/i, '')

  const arrowMatch = c.match(
    /^(?:(?:\*\*|\*|`|["'])(.*?)(?:\*\*|\*|`|["'])|([^\s:：→\->]+))\s*(?:→|->)\s*(?:(?:\*\*|\*|`|["'])(.*?)(?:\*\*|\*|`|["'])|([^\s:：(（]+))(?:[\s:：]+(.*)|(?:\s*[（(](.*)[）)]))?$/
  )

  if (arrowMatch) {
    const original = (arrowMatch[1] ?? arrowMatch[2] ?? '').trim().replace(/^["'*`]+|["'*`]+$/g, '')
    const replacement = (arrowMatch[3] ?? arrowMatch[4] ?? '').trim().replace(/^["'*`]+|["'*`]+$/g, '')
    let reason = (arrowMatch[5] ?? arrowMatch[6] ?? '').trim()
    reason = reason.replace(/^[（(]|[\)）]$/g, '').trim()

    if (original && replacement && original !== '原表达' && original !== '原词') {
      return { original, replacement, reason, raw: c }
    }
  }

  return { raw: c }
}

/** 风格化润色结果展示卡片（卡片化分层排版 + 差异对照 + 一键定稿复制） */
function PolishResultCard(props: {
  raw: string
  streaming: boolean
  styleLabel: string
  onSpeak: (text: string) => void
}): React.JSX.Element {
  const { raw, streaming, styleLabel, onSpeak } = props
  const [copiedSection, setCopiedSection] = useState<string | null>(null)

  const copyWithFeedback = (text: string, label: string): void => {
    window.bridge.copyText(text)
    setCopiedSection(label)
    toast('success', `已复制${label}`, '剪贴板')
    setTimeout(() => setCopiedSection(null), 1500)
  }

  const sections = useMemo(() => parsePolishSections(raw), [raw])

  const draftHtml = useMemo(() => {
    if (!sections.draft) return ''
    try {
      return sanitizeHtml(marked.parse(sections.draft, { async: false }) as string)
    } catch {
      return sections.draft
    }
  }, [sections.draft])

  const altHtml = useMemo(() => {
    if (!sections.alternative) return ''
    try {
      return sanitizeHtml(marked.parse(sections.alternative, { async: false }) as string)
    } catch {
      return sections.alternative
    }
  }, [sections.alternative])

  const parsedSuggestions = useMemo(() => {
    return sections.suggestions.map(parseSuggestionLine)
  }, [sections.suggestions])

  return (
    <div className="space-y-3 animate-in fade-in select-text">
      {/* 1. 润色定稿卡片 */}
      <div className="rounded-xl border border-accent/25 bg-card/95 p-3.5 shadow-sm transition hover:border-accent/40">
        <div className="mb-2 flex items-center justify-between border-b border-line/60 pb-2">
          <span className="flex items-center gap-1.5 text-[12px] font-bold text-accent">
            <Sparkles size={13} className="text-accent" />
            <span>润色定稿 · {styleLabel}</span>
          </span>
          <div className="flex items-center gap-1">
            <button
              className="btn !bg-accent !text-white !px-2.5 !py-1 text-[11px] font-semibold shadow-xs hover:opacity-90 transition"
              onClick={() => copyWithFeedback(sections.draft || raw, '润色定稿')}
              title="仅复制润色后的英文正文定稿"
            >
              {copiedSection === '润色定稿' ? (
                <span className="flex items-center gap-1"><Check size={11} /> 已复制定稿</span>
              ) : (
                <span className="flex items-center gap-1"><Copy size={11} /> 复制定稿</span>
              )}
            </button>
            <button
              className="btn btn-ghost !p-1 text-ink-3 hover:text-ink-1"
              onClick={() => onSpeak(sections.draft || raw)}
              title="朗读定稿"
            >
              <Volume2 size={13} />
            </button>
          </div>
        </div>

        {sections.draft ? (
          <div
            className={`text-[13.5px] leading-[1.8] text-ink-1 academic-markdown font-serif-reading ${streaming ? 'stream-caret' : ''}`}
            dangerouslySetInnerHTML={{ __html: draftHtml }}
          />
        ) : (
          <div className={`text-[13px] leading-relaxed text-ink-1 ${streaming ? 'stream-caret' : ''}`}>
            {raw}
          </div>
        )}
      </div>

      {/* 2. 改进要点与用词建议卡片 */}
      {parsedSuggestions.length > 0 && (
        <div className="rounded-xl border border-line/70 bg-card/70 p-3 animate-in fade-in">
          <div className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold text-ink-1 border-b border-line/50 pb-1.5">
            <Lightbulb size={13} className="text-amber-500" />
            <span>改进要点与用词精进</span>
            <span className="text-[10px] font-normal text-ink-3">({parsedSuggestions.length} 处优化)</span>
          </div>

          <div className="space-y-2">
            {parsedSuggestions.map((s, idx) => (
              <div
                key={idx}
                className="rounded-lg border border-line/60 bg-surface/40 p-2.5 text-[11.5px] transition hover:border-accent/30"
              >
                {s.original && s.replacement ? (
                  <>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="line-through text-red-500/90 bg-red-500/10 px-1.5 py-0.5 rounded font-mono text-[11px]">
                        {s.original}
                      </span>
                      <span className="text-accent font-bold text-[11px]">➔</span>
                      <span className="font-semibold text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded font-mono text-[11px]">
                        {s.replacement}
                      </span>
                    </div>
                    {s.reason && (
                      <p className="mt-1 text-[11px] leading-relaxed text-ink-2 pl-0.5">
                        <span className="font-medium text-accent">💡 理由：</span>
                        {s.reason}
                      </p>
                    )}
                  </>
                ) : (
                  <div
                    className="leading-relaxed text-ink-2 academic-markdown"
                    dangerouslySetInnerHTML={{ __html: sanitizeHtml(marked.parse(s.raw, { async: false }) as string) }}
                  />
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 3. 备选变体卡片 */}
      {sections.alternative && (
        <div className="rounded-xl border border-line/70 bg-card/70 p-3 animate-in fade-in">
          <div className="mb-2 flex items-center justify-between border-b border-line/50 pb-1.5 text-[11px]">
            <span className="flex items-center gap-1.5 font-semibold text-ink-2">
              <RotateCcw size={12} className="text-accent" />
              <span>备选变体句式</span>
            </span>
            <button
              className="btn btn-ghost !px-2 !py-0.5 text-[10px] text-ink-3 hover:text-ink-1"
              onClick={() => copyWithFeedback(sections.alternative, '备选变体')}
              title="复制备选变体"
            >
              {copiedSection === '备选变体' ? (
                <span className="flex items-center gap-0.5 text-ok"><Check size={10} /> 已复制</span>
              ) : (
                <span className="flex items-center gap-0.5"><Copy size={10} /> 复制变体</span>
              )}
            </button>
          </div>
          <div
            className="text-[12.5px] leading-[1.7] text-ink-2 academic-markdown font-serif-reading"
            dangerouslySetInnerHTML={{ __html: altHtml }}
          />
        </div>
      )}

      {/* 底部全量操作 */}
      {!streaming && (
        <div className="flex items-center justify-between border-t border-line/60 pt-2 text-[11px] text-ink-3">
          <div className="flex items-center gap-1">
            <button
              className="btn btn-ghost !px-2 !py-1 text-[11px]"
              onClick={() => onSpeak(raw)}
              title="朗读完整内容"
            >
              <Volume2 size={11} /> 朗读全部
            </button>
            <button
              className="btn btn-ghost !px-2 !py-1 text-[11px]"
              onClick={() => copyWithFeedback(raw, '完整润色报告')}
              title="复制包含分析的全部内容"
            >
              <Copy size={11} /> 复制全部分析
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

