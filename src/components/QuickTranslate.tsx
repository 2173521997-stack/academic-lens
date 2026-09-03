import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  Send,
  Square,
  Volume2,
  Copy,
  Loader2,
  BookmarkPlus,
  Sparkles,
  Camera,
  Image as ImageIcon,
  Binary,
  Check,
  X,
  RefreshCw,
  Languages
} from 'lucide-react'
import {
  quickTranslate,
  loadWordRecents,
  clearWordRecents,
  loadTranslateRecents,
  clearTranslateRecents,
  isCn,
  isEnglishWordOrPhrase,
  type QuickMode,
  type QuickRecent
} from '../lib/quickTranslate'
import { cleanTermList } from '../stores/wordbookStore'
import { agentStream, type StreamCall } from '../lib/llm'
import { useWordbookStore } from '../stores/wordbookStore'
import { useAgentStore } from '../stores/agentStore'
import { suggest, findTypoSuggestion } from '../lib/suggest'
import { parseWordCard, type WordEntry } from '../lib/wordCard'
import { recognizeClipboardImage, fileToDataUrl, correctOcrMathStream, type OcrProgress } from '../lib/ocr'
import { renderLatexInText } from '../lib/renderLatex'
import { marked } from 'marked'
import { sanitizeHtml } from '../lib/sanitize'
import Segmented from './Segmented'

type MiniTab = 'text' | 'ocr'
type OcrActionTab = 'math' | 'deep' | 'translate'

interface ImgTask {
  preview: string
  lines: string[]
  rawText: string
  name: string
  error: string | null
}

const SYS_DEEP_ANALYZE =
  '你是资深理工科与学术文献解析专家。针对用户提供的图片OCR文字、公式、图表或图例，进行深度学术解析：\n' +
  '1. 若为数学/物理/工程公式：拆解每个变量与符号的物理含义、推导背景与适用场景（使用标准 LaTeX 格式如 $...$, $$...$$）；\n' +
  '2. 若为图表/图例/实验数据：解析横纵坐标含义、图例标签、曲线趋势、核心对比结论；\n' +
  '3. 若为学术概念/句子：给出核心论点剖析与术语辨析。\n' +
  '语言严谨、条理清晰，使用 Markdown 格式输出。'

export default function QuickTranslate(): React.JSX.Element {
  // 顶层双子界面切分
  const [tab, setTab] = useState<MiniTab>('text')

  // ================= 1. 查词与翻译子界面状态 =================
  const [input, setInput] = useState('')
  const [activeType, setActiveType] = useState<'word' | 'translate'>('translate')
  const [streaming, setStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState('')
  const [copied, setCopied] = useState(false)

  // 联想词与错词建议
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [selIdx, setSelIdx] = useState(-1)
  const [typoSuggestion, setTypoSuggestion] = useState<string | null>(null)
  const [recents, setRecents] = useState<QuickRecent[]>([])

  const cancelRef = useRef<(() => void) | null>(null)
  const streamingRef = useRef(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // ================= 2. 图片识别与公式解析子界面状态 =================
  const [imgTask, setImgTask] = useState<ImgTask | null>(null)
  const [ocrBusy, setOcrBusy] = useState(false)
  const [ocrPercent, setOcrPercent] = useState(0)
  const [ocrAction, setOcrAction] = useState<OcrActionTab>('math')

  // AI 结果状态
  const [aiOut, setAiOut] = useState('')
  const [aiStreaming, setAiStreaming] = useState(false)
  const [aiCopied, setAiCopied] = useState(false)
  const aiCallRef = useRef<StreamCall | null>(null)

  const imgInputRef = useRef<HTMLInputElement>(null)
  const addWord = useWordbookStore((s) => s.add)

  // 初始化加载历史
  useEffect(() => {
    void loadWordRecents().then((wList) => {
      void loadTranslateRecents().then((tList) => {
        setRecents([...wList, ...tList].slice(0, 8))
      })
    })

    // 监听聚焦
    const offFocus = window.bridge.onFocusInput(() => {
      setTab('text')
      setTimeout(() => {
        inputRef.current?.focus()
        inputRef.current?.select()
      }, 50)
    })

    // 监听全局划词取词事件（Cmd/Ctrl+X 或跨应用取词）
    const offSelection = window.bridge.onSelectionText((text: string) => {
      const t = text.trim()
      if (t) {
        setTab('text')
        setInput(t)
        void executeSmart(t)
      }
    })

    return () => {
      offFocus()
      offSelection()
    }
  }, [])

  // 查词联想与拼写检查
  useEffect(() => {
    if (streamingRef.current || tab !== 'text') {
      setSuggestions([])
      setTypoSuggestion(null)
      return
    }
    const trimmed = input.trim()
    if (!/^[a-zA-Z]{2,30}$/.test(trimmed)) {
      setSuggestions([])
      setSelIdx(-1)
      setTypoSuggestion(null)
      return
    }
    let alive = true
    void suggest(trimmed, 6).then((list) => {
      if (alive) {
        setSuggestions(list)
        setSelIdx(-1)
      }
    })
    void findTypoSuggestion(trimmed).then((suggested) => {
      if (alive && suggested && suggested.toLowerCase() !== trimmed.toLowerCase()) {
        setTypoSuggestion(suggested)
      } else if (alive) {
        setTypoSuggestion(null)
      }
    })
    return () => {
      alive = false
    }
  }, [input, tab])

  // 执行智能查词 / 翻译
  const executeSmart = useCallback(
    (text: string): void => {
      const t = text.trim()
      if (!t || streamingRef.current) return

      const isWord = isEnglishWordOrPhrase(t) || (isCn(t) && t.length <= 8 && !/[。！？!?,，]/.test(t))
      setActiveType(isWord ? 'word' : 'translate')

      let eff: QuickMode
      if (isCn(t)) {
        eff = 'cn2en'
      } else if (isWord) {
        eff = 'word'
      } else {
        eff = 'translate'
      }

      streamingRef.current = true
      setStreaming(true)
      setError(null)
      setResult('')
      setSuggestions([])

      cancelRef.current = quickTranslate(t, eff, {
        onChunk: (d) => setResult((r) => r + d),
        onDone: () => {
          streamingRef.current = false
          setStreaming(false)
          void loadWordRecents().then((wList) => {
            void loadTranslateRecents().then((tList) => {
              setRecents([...wList, ...tList].slice(0, 8))
            })
          })
        },
        onError: (err) => {
          streamingRef.current = false
          setError(err)
          setStreaming(false)
        }
      }).cancel
    },
    []
  )

  const stopText = (): void => {
    cancelRef.current?.()
    cancelRef.current = null
    streamingRef.current = false
    setStreaming(false)
  }

  /** 把小窗当前内容交给 AI 助手：切到大窗、打开助手面板并自动提问 */
  const askAi = (): void => {
    const text = input.trim() || result.trim()
    useAgentStore.getState().askFromMini(text || undefined)
  }

  const stopAi = (): void => {
    aiCallRef.current?.cancel()
    aiCallRef.current = null
    setAiStreaming(false)
  }

  // 图片 OCR 处理
  const handleImageFile = useCallback(async (file: Blob, name: string): Promise<void> => {
    setTab('ocr')
    setOcrBusy(true)
    setOcrPercent(10)
    setError(null)
    setAiOut('')
    try {
      const preview = await fileToDataUrl(file, 480)
      const { text, lines } = await recognizeClipboardImage(file, {
        onProgress: (p: OcrProgress) => setOcrPercent(p.percent)
      })
      const task: ImgTask = { preview, lines, rawText: text, name, error: null }
      setImgTask(task)
      if (text.trim()) {
        runOcrAiAction('math', text)
      }
    } catch (err) {
      setImgTask({
        preview: '',
        lines: [],
        rawText: '',
        name,
        error: err instanceof Error ? err.message : String(err)
      })
    } finally {
      setOcrBusy(false)
    }
  }, [])

  // 触发图片 AI 后续动作（公式校正 / 深度解析 / 翻译）
  const runOcrAiAction = (action: OcrActionTab, rawText: string): void => {
    if (!rawText.trim()) return
    setOcrAction(action)
    setAiStreaming(true)
    setAiOut('')

    if (action === 'math') {
      let acc = ''
      aiCallRef.current = correctOcrMathStream(rawText, {
        onChunk: (d) => {
          acc += d
          setAiOut(acc)
        },
        onDone: () => setAiStreaming(false),
        onError: (e) => {
          setAiOut(`校正失败：${e}`)
          setAiStreaming(false)
        }
      })
    } else if (action === 'deep') {
      let acc = ''
      aiCallRef.current = agentStream(
        [
          { role: 'system', content: SYS_DEEP_ANALYZE },
          { role: 'user', content: `请对以下从图片识别出的内容进行公式/图表/图例 AI 深度解析：\n\n${rawText}` }
        ],
        {
          onChunk: (d) => {
            acc += d
            setAiOut(acc)
          },
          onDone: () => setAiStreaming(false),
          onError: (e) => {
            setAiOut(`解析失败：${e}`)
            setAiStreaming(false)
          }
        },
        { maxTokens: 4096, temperature: 0.2 }
      )
    } else if (action === 'translate') {
      let acc = ''
      aiCallRef.current = quickTranslate(rawText, 'translate', {
        onChunk: (d) => {
          acc += d
          setAiOut(acc)
        },
        onDone: () => setAiStreaming(false),
        onError: (e) => {
          setAiOut(`翻译失败：${e}`)
          setAiStreaming(false)
        }
      })
    }
  }

  // 剪贴板图片粘贴 (Ctrl/Cmd+V)
  useEffect(() => {
    const onPaste = (e: ClipboardEvent): void => {
      const items = e.clipboardData?.items
      if (!items) return
      for (const it of Array.from(items)) {
        if (it.type.startsWith('image/')) {
          const file = it.getAsFile()
          if (file) {
            e.preventDefault()
            const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(5, 19)
            void handleImageFile(file, `截图-${ts}.png`)
            return
          }
        }
      }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [handleImageFile])

  const copyText = (t: string): void => {
    if (!t) return
    window.bridge.copyText(t)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const wordCard =
    activeType === 'word' && result && !streaming ? parseWordCard(result) : null

  // 组件卸载（切大窗/切视图/关闭）时取消仍在进行的请求，避免空耗 Token 与内存
  useEffect(() => {
    return () => {
      cancelRef.current?.()
      cancelRef.current = null
      aiCallRef.current?.cancel()
      aiCallRef.current = null
    }
  }, [])

  return (
    <div className="flex min-h-0 flex-1 flex-col select-none bg-surface">
      {/* 顶部主选项卡切换：查词/翻译 vs 图片与公式识别 */}
      <div className="flex items-center justify-between border-b border-line px-3 py-1.5 bg-panel/80 backdrop-blur-md">
        <Segmented<MiniTab>
          items={[
            { value: 'text', label: '查词与翻译' },
            { value: 'ocr', label: '图片与公式' }
          ]}
          value={tab}
          onChange={(t) => setTab(t)}
        />

        {tab === 'ocr' && (
          <button
            className="btn btn-ghost !px-2 !py-0.8 text-[11px] text-accent hover:bg-accent-soft cursor-pointer"
            onClick={() => imgInputRef.current?.click()}
          >
            <Camera size={12} strokeWidth={1.5} />
            <span>选择图片</span>
          </button>
        )}

        <input
          ref={imgInputRef}
          type="file"
          hidden
          accept="image/*"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void handleImageFile(f, f.name)
            e.target.value = ''
          }}
        />
      </div>

      {/* ================= 界面 1：查词与翻译 ================= */}
      {tab === 'text' && (
        <div className="flex min-h-0 flex-1 flex-col p-3 space-y-2 overflow-hidden">
          {/* 输入框区 */}
          <div className="relative shrink-0">
            <textarea
              ref={inputRef}
              className="input w-full min-h-[72px] max-h-[110px] resize-y !text-[13px] leading-relaxed p-2.5 select-text"
              placeholder="输入英文查词卡，输入句子/段落自动翻译；按 Ctrl/Cmd+V 粘贴截图…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  if (suggestions.length > 0 && selIdx >= 0) {
                    const picked = suggestions[selIdx]
                    setInput(picked)
                    setSuggestions([])
                    executeSmart(picked)
                    return
                  }
                  executeSmart(input)
                } else if (e.key === 'ArrowDown' && suggestions.length > 0) {
                  e.preventDefault()
                  setSelIdx((prev) => (prev + 1) % suggestions.length)
                } else if (e.key === 'ArrowUp' && suggestions.length > 0) {
                  e.preventDefault()
                  setSelIdx((prev) => (prev <= 0 ? suggestions.length - 1 : prev - 1))
                }
              }}
            />

            {/* 联想下拉菜单 */}
            {suggestions.length > 0 && (
              <div className="absolute left-0 right-0 top-full z-30 mt-1 rounded-xl border border-line bg-surface/95 backdrop-blur shadow-pop overflow-hidden">
                {suggestions.map((w, idx) => (
                  <div
                    key={w}
                    className={`flex cursor-pointer items-center justify-between px-3 py-1.5 text-[12px] ${
                      idx === selIdx ? 'bg-accent text-white font-medium' : 'text-ink-1 hover:bg-surface-alt'
                    }`}
                    onMouseDown={(e) => {
                      e.preventDefault()
                      setInput(w)
                      setSuggestions([])
                      executeSmart(w)
                    }}
                  >
                    <span>{w}</span>
                    <span className="text-[10px] opacity-70">Enter 选取</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 错词修正提示 */}
          {typoSuggestion && (
            <div className="flex items-center gap-1.5 text-[11.5px] text-ink-3 px-1">
              <span>您是不是想查：</span>
              <button
                className="font-medium text-accent hover:underline cursor-pointer"
                onClick={() => {
                  setInput(typoSuggestion)
                  setTypoSuggestion(null)
                  executeSmart(typoSuggestion)
                }}
              >
                {typoSuggestion}
              </button>
            </div>
          )}

          {error && (
            <div className="rounded-xl border border-danger/30 bg-danger/10 p-2.5 text-[12px] text-danger">
              {error}
            </div>
          )}

          {/* 结果可滚动区 */}
          <div className="min-h-0 flex-1 overflow-y-auto space-y-2">
            {wordCard ? (
              <WordCard
                entry={wordCard}
                onSpeak={() => window.bridge.speak(wordCard.word)}
                onCopy={() => copyText(`${wordCard.word} [${wordCard.phonetic || ''}] ${wordCard.def}`)}
                copied={copied}
                onBookmark={() => {
                  addWord({
                    word: wordCard.word,
                    phonetic: wordCard.phonetic,
                    pos: wordCard.pos,
                    definition: wordCard.def,
                    context: wordCard.exs.map((e) => `${e.en} ${e.zh || ''}`).join('\n'),
                    synonyms: wordCard.synonyms,
                    antonyms: wordCard.antonyms,
                    tags: wordCard.field ? ['小窗收藏', wordCard.field] : ['小窗收藏']
                  })
                }}
                onPickWord={(w) => {
                  setInput(w)
                  executeSmart(w)
                }}
              />
            ) : result || streaming ? (
              <div className="card p-3 border border-line bg-card space-y-2 animate-float-in">
                <div className="flex items-center justify-between border-b border-line pb-1.5">
                  <span className="text-[11.5px] font-semibold text-accent flex items-center gap-1">
                    <Sparkles size={12} /> 学术译文（公式标准排版）
                  </span>
                  {result && (
                    <div className="flex items-center gap-1">
                      <button
                        className="btn btn-ghost !p-1 text-ink-3 hover:text-accent cursor-pointer"
                        onClick={() => window.bridge.speak(result)}
                        title="朗读"
                      >
                        <Volume2 size={13} />
                      </button>
                      <button
                        className="btn btn-ghost !px-2 !py-0.5 text-[11px] text-ink-3 hover:text-ink-1 cursor-pointer"
                        onClick={() => copyText(result)}
                      >
                        {copied ? <Check size={12} className="text-ok" /> : <Copy size={12} />}
                        <span>{copied ? '已复制' : '复制'}</span>
                      </button>
                    </div>
                  )}
                </div>

                <div
                  className="select-text text-[13px] leading-relaxed text-ink-1 break-words"
                  dangerouslySetInnerHTML={{ __html: sanitizeHtml(renderLatexInText(streaming && !result ? '正在翻译…' : result)) }}
                />
              </div>
            ) : (
              /* 历史记录 */
              recents.length > 0 && (
                <div className="space-y-1.5 pt-1">
                  <div className="flex items-center justify-between px-0.5 text-[11px] text-ink-3">
                    <span>最近查词与翻译</span>
                    <button
                      className="hover:text-ink-1 cursor-pointer"
                      onClick={() => {
                        void clearWordRecents()
                        void clearTranslateRecents()
                        setRecents([])
                      }}
                    >
                      清空
                    </button>
                  </div>
                  <div className="space-y-1">
                    {recents.slice(0, 5).map((r, i) => (
                      <div
                        key={i}
                        className="card flex items-center justify-between p-2 text-[11.5px] hover:border-accent/40 border border-line/60 cursor-pointer"
                        onClick={() => {
                          setInput(r.src)
                          executeSmart(r.src)
                        }}
                      >
                        <span className="font-medium text-ink-1 truncate mr-2">{r.src}</span>
                        <span className="text-[10.5px] text-ink-3 truncate max-w-[120px]">{r.dst}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )
            )}
          </div>

          {/* 底部行动栏 */}
          <div className="shrink-0 flex items-center gap-2 pt-1 border-t border-line/60">
            {streaming ? (
              <button className="btn btn-primary flex-1 justify-center !py-1.5 cursor-pointer" onClick={stopText}>
                <Square size={12} strokeWidth={1.5} /> 停止
              </button>
            ) : (
              <>
                <button
                  className="btn btn-primary flex-1 justify-center !py-1.5 cursor-pointer"
                  disabled={!input.trim()}
                  onClick={() => executeSmart(input)}
                >
                  <Send size={12} strokeWidth={1.5} />
                  <span>{isEnglishWordOrPhrase(input) ? '查询词卡' : '学术翻译'}</span>
                </button>
                <button
                  className="btn shrink-0 !px-2.5 !py-1.5 text-accent cursor-pointer"
                  onClick={askAi}
                  title="把小窗当前内容交给 AI 助手深入解析（切到大窗）"
                >
                  <Sparkles size={12} strokeWidth={1.5} /> 问 AI
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* ================= 界面 2：图片识别与公式解析 ================= */}
      {tab === 'ocr' && (
        <div className="flex min-h-0 flex-1 flex-col p-3 space-y-2.5 overflow-hidden">
          {!imgTask ? (
            /* 未选图状态：拖放 / 粘贴区域 */
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault()
                const f = Array.from(e.dataTransfer.files).find((x) => x.type.startsWith('image/'))
                if (f) void handleImageFile(f, f.name)
              }}
              onClick={() => imgInputRef.current?.click()}
              className="flex-1 flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-line hover:border-accent/40 bg-card p-6 cursor-pointer transition text-center"
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent-soft text-accent">
                {ocrBusy ? <Loader2 size={24} className="animate-spin" /> : <Camera size={24} strokeWidth={1.5} />}
              </div>
              <div>
                <p className="text-[13.5px] font-semibold text-ink-1">
                  {ocrBusy ? `正在高精识别图像 (${ocrPercent}%)…` : '点击上传或按 Ctrl/Cmd+V 粘贴截图'}
                </p>
                <p className="text-[11.5px] text-ink-3 mt-1">
                  支持公式符号校正、图表图例深度分析与标准数学排版
                </p>
              </div>
            </div>
          ) : (
            /* 已识图状态：预览 + 三重动作 + 标准公式呈现 */
            <div className="flex min-h-0 flex-1 flex-col space-y-2 overflow-hidden">
              {/* 顶部简略缩略图与状态 */}
              <div className="flex items-center justify-between gap-2 p-2 rounded-xl bg-card border border-line shrink-0">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="h-9 w-9 rounded-lg border border-line bg-surface overflow-hidden shrink-0 flex items-center justify-center">
                    {imgTask.preview ? (
                      <img src={imgTask.preview} alt="预览" className="h-full w-full object-cover" />
                    ) : (
                      <ImageIcon size={14} className="text-ink-3" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-[12px] font-medium text-ink-1">{imgTask.name}</p>
                    <p className="text-[10px] text-ink-3">{imgTask.lines.length} 行文本/公式</p>
                  </div>
                </div>

                <div className="flex items-center gap-1">
                  <button
                    className="btn btn-ghost !p-1 text-ink-3 hover:text-ink-1 cursor-pointer"
                    onClick={() => imgInputRef.current?.click()}
                    title="重新选图"
                  >
                    <RefreshCw size={12} />
                  </button>
                  <button
                    className="btn btn-ghost !p-1 text-ink-3 hover:text-ink-1 cursor-pointer"
                    onClick={() => {
                      setImgTask(null)
                      setAiOut('')
                    }}
                    title="清空"
                  >
                    <X size={13} />
                  </button>
                </div>
              </div>

              {/* 三大 AI 处理动作选择 */}
              <div className="flex items-center justify-between gap-1 shrink-0">
                <div className="flex gap-1">
                  <button
                    className={`btn !px-2.5 !py-1 text-[11px] font-medium cursor-pointer ${
                      ocrAction === 'math'
                        ? 'border-accent bg-accent-soft text-accent font-semibold'
                        : 'border-line text-ink-2'
                    }`}
                    onClick={() => runOcrAiAction('math', imgTask.rawText)}
                  >
                    <Binary size={11} /> 📐 公式排版校正
                  </button>
                  <button
                    className={`btn !px-2.5 !py-1 text-[11px] font-medium cursor-pointer ${
                      ocrAction === 'deep'
                        ? 'border-accent bg-accent-soft text-accent font-semibold'
                        : 'border-line text-ink-2'
                    }`}
                    onClick={() => runOcrAiAction('deep', imgTask.rawText)}
                  >
                    <Sparkles size={11} /> 🧠 深度解析
                  </button>
                  <button
                    className={`btn !px-2.5 !py-1 text-[11px] font-medium cursor-pointer ${
                      ocrAction === 'translate'
                        ? 'border-accent bg-accent-soft text-accent font-semibold'
                        : 'border-line text-ink-2'
                    }`}
                    onClick={() => runOcrAiAction('translate', imgTask.rawText)}
                  >
                    <Languages size={11} /> 🌐 中文翻译
                  </button>
                </div>

                {aiOut && (
                  <button
                    className="btn btn-ghost !px-2 !py-0.5 text-[10.5px] text-ink-3 hover:text-ink-1 cursor-pointer"
                    onClick={() => {
                      window.bridge.copyText(aiOut)
                      setAiCopied(true)
                      setTimeout(() => setAiCopied(false), 1500)
                    }}
                  >
                    {aiCopied ? <Check size={11} className="text-ok" /> : <Copy size={11} />}
                    <span>{aiCopied ? '已复制' : '复制'}</span>
                  </button>
                )}
              </div>

              {/* 结果呈现：标准 KaTeX 排版输出 */}
              <div className="min-h-0 flex-1 overflow-y-auto card p-3 border border-line bg-card shadow-xs">
                {aiStreaming && !aiOut ? (
                  <div className="flex items-center gap-2 text-accent py-4 text-[12px] justify-center">
                    <Loader2 size={14} className="animate-spin" />
                    <span>正在进行高精公式校正与标准排版渲染…</span>
                  </div>
                ) : aiOut ? (
                  <div
                    className="markdown-body select-text prose prose-sm dark:prose-invert max-w-none text-[12.5px] leading-relaxed text-ink-1 break-words"
                    dangerouslySetInnerHTML={{
                      __html: sanitizeHtml(marked.parse(renderLatexInText(aiOut)) as string)
                    }}
                  />
                ) : (
                  <div className="font-mono text-[11px] text-ink-2 whitespace-pre-wrap select-text p-1">
                    {imgTask.rawText || '未检测到文字'}
                  </div>
                )}
              </div>

              {/* 底部行动 */}
              {aiStreaming && (
                <div className="shrink-0 pt-1">
                  <button className="btn btn-primary w-full justify-center !py-1.5 cursor-pointer" onClick={stopAi}>
                    <Square size={12} strokeWidth={1.5} /> 停止生成
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function WordCard(props: {
  entry: WordEntry
  onSpeak: () => void
  onCopy: () => void
  copied: boolean
  onBookmark: () => void
  onPickWord?: (w: string) => void
}): React.JSX.Element {
  const { entry: w } = props

  const syns = cleanTermList(w.synonyms)
  const ants = cleanTermList(w.antonyms)

  return (
    <div className="card animate-float-in p-3 space-y-2 border border-line bg-card shadow-xs">
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-[16px] font-semibold tracking-tight text-ink-1">{w.word}</h2>
            {w.field && (
              <span className="chip bg-accent-soft text-accent text-[9.5px] font-medium">
                {w.field}
              </span>
            )}
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-[11.5px] text-ink-2">
            {w.phonetic && <span>{w.phonetic}</span>}
            {w.pos && <span className="chip text-[9.5px]">{w.pos}</span>}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button className="btn btn-ghost !p-1 text-ink-3 hover:text-accent cursor-pointer" onClick={props.onSpeak} title="发音">
            <Volume2 size={13} strokeWidth={1.5} />
          </button>
          <button className="btn btn-ghost !p-1 text-ink-3 hover:text-accent cursor-pointer" onClick={props.onBookmark} title="收藏到生词本">
            <BookmarkPlus size={13} strokeWidth={1.5} />
          </button>
        </div>
      </div>

      <p className="text-[12.5px] leading-relaxed text-ink-1 font-medium select-text">{w.def}</p>

      {/* 同义词与反义词动态点击药丸列表 */}
      {(syns.length > 0 || ants.length > 0) && (
        <div className="space-y-1.5 rounded-lg border border-line bg-surface/60 p-2 text-[11px]">
          {syns.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[10px] font-semibold text-ink-3 uppercase mr-1">同义</span>
              {syns.map((s, idx) => (
                <button
                  key={`${s}-${idx}`}
                  className="inline-flex items-center px-1.5 py-0.5 rounded text-[10.5px] font-medium bg-surface text-ink-2 border border-line hover:border-accent hover:text-accent cursor-pointer transition"
                  onClick={() => props.onPickWord?.(s)}
                  title={`查询同义词 ${s}`}
                >
                  {s}
                </button>
              ))}
            </div>
          )}
          {ants.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 pt-1 border-t border-line/50">
              <span className="text-[10px] font-semibold text-ink-3 uppercase mr-1">反义</span>
              {ants.map((a, idx) => (
                <button
                  key={`${a}-${idx}`}
                  className="inline-flex items-center px-1.5 py-0.5 rounded text-[10.5px] font-medium bg-surface text-ink-2 border border-line hover:border-accent hover:text-accent cursor-pointer transition"
                  onClick={() => props.onPickWord?.(a)}
                  title={`查询反义词 ${a}`}
                >
                  {a}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {w.exs.map((ex, i) => (
        <div key={i} className="rounded-lg bg-surface/50 p-2 border border-line/40 space-y-0.5">
          <p className="select-text text-[11.5px] leading-relaxed text-ink-1">{ex.en}</p>
          {ex.zh && <p className="text-[10.5px] text-ink-3 select-text">{ex.zh}</p>}
        </div>
      ))}

      <div className="flex items-center justify-between border-t border-line pt-1.5">
        <span className="text-[9.5px] text-ink-3">词卡速查</span>
        <button className="btn btn-ghost !px-2 !py-0.5 text-[10.5px] text-ink-3 hover:text-ink-1 cursor-pointer" onClick={props.onCopy}>
          {props.copied ? <span className="text-ok">已复制</span> : <><Copy size={10} strokeWidth={1.5} /> 复制</>}
        </button>
      </div>
    </div>
  )
}
