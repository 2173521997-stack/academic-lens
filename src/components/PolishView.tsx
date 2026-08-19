import { useState } from 'react'
import {
  Sparkles,
  Copy,
  Check,
  RotateCcw,
  BookOpen,
  ArrowRight,
  Sliders,
  History,
  Feather,
  Info,
  X
} from 'lucide-react'
import { usePolishStore } from '../stores/polishStore'
import { type PolishTone } from '../lib/polish'
import { toast } from '../stores/noticeStore'

const SAMPLE_PROMPTS: { label: string; text: string; tone: PolishTone }[] = [
  {
    label: '摘要背景句',
    text: 'Nowadays, deep learning is very popular and widely used in lots of areas, but it has big problems in data efficiency.',
    tone: 'strict'
  },
  {
    label: '方法创新句',
    text: 'To get better performance, we make a new framework which combines attention with graph convolution.',
    tone: 'strict'
  },
  {
    label: '实验结论（防绝对化）',
    text: 'Our method completely beats all existing baselines and proves that larger models are always better.',
    tone: 'hedging'
  },
  {
    label: '精简长难句（防超页）',
    text: 'Due to the fact that there are numerous challenges and difficulties in the current existing systems, we decided to introduce our approach.',
    tone: 'concise'
  }
]

export default function PolishView(): React.JSX.Element {
  const { input, tone, result, state, error, history, setInput, setTone, runPolish, clear, loadFromHistory } =
    usePolishStore()
  const [copied, setCopied] = useState(false)
  const [activeTab, setActiveTab] = useState<'diff' | 'final'>('diff')
  const [showHistory, setShowHistory] = useState(false)

  const copyFinal = (text: string): void => {
    window.bridge.copyText(text)
    setCopied(true)
    toast('success', '已复制润色后文本至剪贴板')
    setTimeout(() => setCopied(false), 2000)
  }

  const wordCount = input.trim().split(/\s+/).filter(Boolean).length

  return (
    <div className="relative flex h-full flex-col overflow-hidden">
      {/* 顶部状态栏 */}
      <div className="glass flex shrink-0 items-center justify-between border-b px-5 py-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-accent/10 text-accent">
            <Feather size={18} />
          </div>
          <div>
            <h1 className="text-[15px] font-semibold text-ink-1">学术写作与论文润色工作台</h1>
            <p className="text-[11px] text-ink-3">IEEE / ACM / Nature 规范 · 语气调优 · 差异对比 · 高级搭配推荐</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {history.length > 0 && (
            <button
              className={`btn btn-ghost text-[12px] ${showHistory ? '!bg-accent/10 !text-accent' : ''}`}
              onClick={() => setShowHistory(!showHistory)}
            >
              <History size={14} />
              <span>历史记录 ({history.length})</span>
            </button>
          )}
        </div>
      </div>

      {/* 历史记录悬浮抽屉 */}
      {showHistory && (
        <div className="card absolute right-4 top-14 z-30 flex max-h-80 w-80 flex-col overflow-hidden border border-line shadow-xl animate-in fade-in slide-in-from-top-2">
          <div className="flex items-center justify-between border-b border-line px-3 py-2 text-[12px] font-semibold text-ink-2">
            <span>最近润色记录</span>
            <button onClick={() => setShowHistory(false)} className="btn btn-ghost !p-1" title="关闭历史记录">
              <X size={13} />
            </button>
          </div>
          <div className="divide-y divide-line overflow-y-auto">
            {history.map((h) => (
              <button
                key={h.id}
                onClick={() => {
                  loadFromHistory(h)
                  setShowHistory(false)
                }}
                className="flex w-full flex-col p-2.5 text-left transition hover:bg-surface/80"
              >
                <div className="flex items-center justify-between text-[10px] text-ink-3">
                  <span>{h.tone === 'strict' ? '严格学术' : h.tone === 'concise' ? '精简紧凑' : '严谨委婉'}</span>
                  <span>{new Date(h.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                </div>
                <p className="mt-1 line-clamp-2 text-[12px] text-ink-1">{h.input}</p>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 主体工作区 */}
      <div className="grid min-h-0 flex-1 grid-cols-1 divide-y overflow-hidden lg:grid-cols-2 lg:divide-x lg:divide-y-0">
        {/* 左侧：输入与控制 */}
        <div className="flex min-h-0 flex-col overflow-y-auto p-5">
          <div className="space-y-4">
            {/* 语气选择器 */}
            <div>
              <label className="mb-1.5 flex items-center justify-between text-[12px] font-medium text-ink-2">
                <span className="flex items-center gap-1.5">
                  <Sliders size={13} />
                  <span>学术语气预设</span>
                </span>
                <span className="text-[11px] text-ink-3">
                  {tone === 'strict' ? '期刊投稿/标准学术' : tone === 'concise' ? '压缩篇幅/防超页' : '学术留有余地/防绝对化'}
                </span>
              </label>
              <div className="grid grid-cols-3 gap-2">
                <button
                  onClick={() => setTone('strict')}
                  className={`flex flex-col items-center rounded-xl border p-2.5 text-center transition ${
                    tone === 'strict'
                      ? 'border-accent bg-accent/5 font-semibold text-accent shadow-xs'
                      : 'border-line bg-card/60 text-ink-2 hover:bg-card'
                  }`}
                >
                  <span className="text-[13px]">严格学术</span>
                  <span className="text-[10px] text-ink-3">IEEE/ACM 规范</span>
                </button>
                <button
                  onClick={() => setTone('concise')}
                  className={`flex flex-col items-center rounded-xl border p-2.5 text-center transition ${
                    tone === 'concise'
                      ? 'border-accent bg-accent/5 font-semibold text-accent shadow-xs'
                      : 'border-line bg-card/60 text-ink-2 hover:bg-card'
                  }`}
                >
                  <span className="text-[13px]">精炼紧凑</span>
                  <span className="text-[10px] text-ink-3">剔除冗余/防超页</span>
                </button>
                <button
                  onClick={() => setTone('hedging')}
                  className={`flex flex-col items-center rounded-xl border p-2.5 text-center transition ${
                    tone === 'hedging'
                      ? 'border-accent bg-accent/5 font-semibold text-accent shadow-xs'
                      : 'border-line bg-card/60 text-ink-2 hover:bg-card'
                  }`}
                >
                  <span className="text-[13px]">严谨委婉</span>
                  <span className="text-[10px] text-ink-3">Hedging 留有余地</span>
                </button>
              </div>
            </div>

            {/* 常用场景预设 */}
            <div>
              <p className="mb-1.5 text-[11px] font-medium text-ink-3">快速填入学术范例：</p>
              <div className="flex flex-wrap gap-1.5">
                {SAMPLE_PROMPTS.map((s, i) => (
                  <button
                    key={i}
                    onClick={() => {
                      setInput(s.text)
                      setTone(s.tone)
                    }}
                    className="rounded-lg border border-line bg-surface/60 px-2 py-1 text-[11px] text-ink-2 transition hover:border-accent/40 hover:bg-surface hover:text-accent"
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>

            {/* 输入文本框 */}
            <div className="relative">
              <div className="mb-1.5 flex items-center justify-between text-[12px] font-medium text-ink-2">
                <span>待润色英文原文</span>
                <span className="text-[11px] text-ink-3">{wordCount} 词 · {input.length} 字符</span>
              </div>
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="粘贴需要润色的论文段落、英文摘要或课程论文句子…"
                className="h-64 w-full resize-none rounded-xl border border-line bg-card p-3.5 text-[14px] leading-relaxed text-ink-1 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20"
              />
            </div>

            {/* 底部操作区 */}
            <div className="flex items-center justify-between pt-1">
              <button onClick={clear} disabled={!input} className="btn btn-ghost text-[12px] text-ink-3">
                <RotateCcw size={13} />
                <span>清空</span>
              </button>
              <button
                onClick={runPolish}
                disabled={!input.trim() || state === 'loading'}
                className="btn btn-primary gap-1.5 px-5 py-2.5 text-[13px] shadow-sm"
              >
                <Sparkles size={15} className={state === 'loading' ? 'animate-spin' : ''} />
                <span>{state === 'loading' ? '正在学术润色中…' : '✨ 开始学术润色'}</span>
              </button>
            </div>
          </div>
        </div>

        {/* 右侧：结果展示与 Diff */}
        <div className="flex min-h-0 flex-col overflow-y-auto bg-surface/30 p-5">
          {state === 'loading' && (
            <div className="flex flex-1 flex-col items-center justify-center p-8 text-center">
              <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-accent/10 text-accent">
                <Sparkles size={24} className="animate-spin text-accent" />
              </div>
              <p className="text-[14px] font-medium text-ink-1">AI 正在深度剖析学术句式…</p>
              <p className="mt-1 text-[12px] text-ink-3">规范主被动语态 · 升级精准动词 · 消除口语化</p>
            </div>
          )}

          {state === 'error' && (
            <div className="flex flex-1 flex-col items-center justify-center p-8 text-center">
              <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-danger/10 text-danger">
                <Info size={20} />
              </div>
              <p className="text-[14px] font-semibold text-danger">润色失败</p>
              <p className="mt-1 text-[12px] text-ink-3">{error}</p>
            </div>
          )}

          {state === 'idle' && !result && (
            <div className="flex flex-1 flex-col items-center justify-center p-8 text-center text-ink-3">
              <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl border border-dashed border-line bg-card/40">
                <Feather size={22} className="text-ink-3" />
              </div>
              <p className="text-[14px] font-medium text-ink-2">准备就绪</p>
              <p className="mt-1 max-w-sm text-[12px] leading-relaxed">
                在左侧输入英文论文句子或段落，选择语气后点击「开始学术润色」，即可在此查看修改理由与红绿差异高亮对比。
              </p>
            </div>
          )}

          {result && (
            <div className="space-y-4">
              {/* 模式与复制栏 */}
              <div className="flex items-center justify-between">
                <div className="flex rounded-lg border border-line bg-card p-0.5">
                  <button
                    onClick={() => setActiveTab('diff')}
                    className={`rounded-md px-3 py-1 text-[12px] font-medium transition ${
                      activeTab === 'diff' ? 'bg-accent text-white shadow-xs' : 'text-ink-2 hover:text-ink-1'
                    }`}
                  >
                    差异高亮对比 (Diff)
                  </button>
                  <button
                    onClick={() => setActiveTab('final')}
                    className={`rounded-md px-3 py-1 text-[12px] font-medium transition ${
                      activeTab === 'final' ? 'bg-accent text-white shadow-xs' : 'text-ink-2 hover:text-ink-1'
                    }`}
                  >
                    最终定稿正文
                  </button>
                </div>

                <button
                  onClick={() => copyFinal(result.polished)}
                  className="btn btn-ghost gap-1 text-[12px] text-accent"
                >
                  {copied ? <Check size={14} /> : <Copy size={14} />}
                  <span>{copied ? '已复制' : '一键复制定稿'}</span>
                </button>
              </div>

              {/* 词数变化徽章 */}
              <div className="flex flex-wrap items-center gap-2 text-[11px]">
                <span className="chip">原文：{result.wordCountOriginal} 词</span>
                <span className="chip !bg-ok/10 !text-ok font-semibold">定稿：{result.wordCountPolished} 词</span>
                {result.wordCountOriginal > result.wordCountPolished && (
                  <span className="chip !bg-info/10 !text-info">
                    精炼率：-{Math.round(((result.wordCountOriginal - result.wordCountPolished) / result.wordCountOriginal) * 100)}%
                  </span>
                )}
              </div>

              {/* 差异对比视图 */}
              {activeTab === 'diff' && (
                <div className="card space-y-3 p-4">
                  <h3 className="text-[12px] font-semibold text-ink-2">修改细节与理由剖析</h3>
                  {result.diffs.length > 0 ? (
                    <div className="space-y-2">
                      {result.diffs.map((d, idx) => (
                        <div
                          key={idx}
                          className="flex items-start gap-2.5 rounded-xl border border-line bg-card/60 p-3 text-[13px] leading-relaxed transition hover:bg-card"
                        >
                          <span className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-accent/10 text-[10px] font-bold text-accent">
                            {idx + 1}
                          </span>
                          <div className="min-w-0 flex-1 space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                              {d.original && (
                                <span className="rounded bg-danger/10 px-1.5 py-0.5 text-danger line-through">
                                  {d.original}
                                </span>
                              )}
                              <ArrowRight size={12} className="text-ink-3" />
                              {d.replacement && (
                                <span className="rounded bg-ok/15 px-1.5 py-0.5 font-semibold text-ok">
                                  {d.replacement}
                                </span>
                              )}
                            </div>
                            <p className="text-[11px] text-ink-2">💡 理由：{d.reason}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-[12px] text-ink-3">整体句式调整与词汇升级完成。</p>
                  )}
                </div>
              )}

              {/* 定稿正文 */}
              <div className="card p-4">
                <h3 className="mb-2 text-[12px] font-semibold text-ink-2">最终学术定稿</h3>
                <p className="font-serif-reading text-[15px] leading-relaxed text-ink-1 selection:bg-accent/20">
                  {result.polished}
                </p>
              </div>

              {/* 学术高级搭配推荐 */}
              {result.collocations.length > 0 && (
                <div className="card space-y-2.5 p-4">
                  <div className="flex items-center gap-1.5 text-[12px] font-semibold text-ink-2">
                    <BookOpen size={14} className="text-accent" />
                    <span>学术高级搭配与核心词汇 (Collocations)</span>
                  </div>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {result.collocations.map((c, i) => (
                      <div key={i} className="rounded-xl border border-line bg-card/60 p-2.5 text-[12px]">
                        <div className="flex items-center justify-between font-semibold text-accent">
                          <span>{c.word}</span>
                          <span className="text-[10px] font-normal text-ink-3">{c.meaning}</span>
                        </div>
                        <p className="mt-1 text-[11px] italic text-ink-2">"{c.usage}"</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
