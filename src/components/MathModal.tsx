import { useEffect, useState } from 'react'
import { X, Sparkles, Copy, Check, BookOpen, Lightbulb, ListOrdered } from 'lucide-react'
import { explainMath, type MathExplanation } from '../lib/mathExplain'
import { toast } from '../stores/noticeStore'

interface MathModalProps {
  latex: string
  context?: string
  onClose: () => void
}

export default function MathModal({ latex, context, onClose }: MathModalProps): React.JSX.Element {
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<MathExplanation | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let active = true
    setLoading(true)
    setError(null)
    explainMath(latex, context)
      .then((res) => {
        if (active) {
          setData(res)
          setLoading(false)
        }
      })
      .catch((err) => {
        if (active) {
          setError(err instanceof Error ? err.message : String(err))
          setLoading(false)
        }
      })
    return () => {
      active = false
    }
  }, [latex, context])

  const copyLatex = (): void => {
    window.bridge.copyText(latex)
    setCopied(true)
    toast('success', '已复制公式 LaTeX 代码')
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm animate-in fade-in duration-150">
      <div
        className="card relative flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden border border-line shadow-2xl animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 标题栏 */}
        <div className="flex shrink-0 items-center justify-between border-b border-line px-5 py-3.5">
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent/10 text-accent">
              <Sparkles size={16} />
            </div>
            <div>
              <h2 className="text-[14px] font-semibold text-ink-1">🔬 学术公式深度拆解与白话导读</h2>
              <p className="text-[10px] text-ink-3">变量字典 · 算法链路核心作用 · 计算推导步骤</p>
            </div>
          </div>
          <button onClick={onClose} className="btn btn-ghost !p-1 text-ink-3 hover:text-ink-1" title="关闭">
            <X size={16} />
          </button>
        </div>

        {/* 内容区 */}
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
          {/* 公式展示 */}
          <div className="rounded-xl border border-line bg-surface/60 p-3.5">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-[11px] font-medium text-ink-3">公式原文</span>
              <button onClick={copyLatex} className="btn btn-ghost !h-6 !px-2 text-[11px] text-accent">
                {copied ? <Check size={12} /> : <Copy size={12} />}
                <span>{copied ? '已复制' : '复制 LaTeX'}</span>
              </button>
            </div>
            <div className="overflow-x-auto font-mono text-[13px] leading-relaxed text-ink-1">
              <code>{latex}</code>
            </div>
          </div>

          {loading && (
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <Sparkles size={24} className="animate-spin text-accent" />
              <p className="mt-3 text-[13px] font-medium text-ink-2">正在分析公式中各变量与算法作用…</p>
            </div>
          )}

          {error && (
            <div className="rounded-xl border border-danger/20 bg-danger/5 p-4 text-center text-[12px] text-danger">
              解析失败：{error}
            </div>
          )}

          {data && !loading && (
            <div className="space-y-4">
              {/* 大白话总结 */}
              <div className="rounded-xl border border-accent/20 bg-accent/5 p-3.5">
                <div className="mb-1 flex items-center gap-1.5 text-[12px] font-semibold text-accent">
                  <Lightbulb size={14} />
                  <span>核心作用（一句话讲透）</span>
                </div>
                <p className="text-[13px] font-medium text-ink-1">{data.plainSummary}</p>
                {data.intuition && (
                  <p className="mt-1.5 text-[12px] leading-relaxed text-ink-2">{data.intuition}</p>
                )}
              </div>

              {/* 变量字典 */}
              {data.symbols.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center gap-1.5 text-[12px] font-semibold text-ink-2">
                    <BookOpen size={14} className="text-accent" />
                    <span>📖 变量字典 (Symbol Table)</span>
                  </div>
                  <div className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-card">
                    {data.symbols.map((s, idx) => (
                      <div key={idx} className="flex items-start gap-3 p-2.5 text-[12px]">
                        <span className="font-mono font-semibold text-accent">{s.symbol}</span>
                        <div className="min-w-0 flex-1">
                          <span className="font-medium text-ink-1">{s.name}</span>
                          <p className="mt-0.5 text-[11px] text-ink-3">{s.meaning}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 计算步骤与链路推导 */}
              {data.steps.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center gap-1.5 text-[12px] font-semibold text-ink-2">
                    <ListOrdered size={14} className="text-accent" />
                    <span>🔢 算法计算链路与推导逻辑</span>
                  </div>
                  <div className="space-y-1.5">
                    {data.steps.map((st, i) => (
                      <div key={i} className="flex items-start gap-2.5 rounded-lg border border-line bg-card/60 p-2.5 text-[12px]">
                        <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-surface text-[10px] font-bold text-ink-2">
                          {i + 1}
                        </span>
                        <p className="min-w-0 flex-1 text-ink-1">{st}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* 底部按钮 */}
        <div className="flex justify-end border-t border-line px-5 py-3">
          <button onClick={onClose} className="btn btn-primary px-5 text-[12px]">
            知道了
          </button>
        </div>
      </div>
    </div>
  )
}
