import { useEffect, useState } from 'react'
import { X, Sparkles, CheckCircle2, XCircle, Award, BookPlus, RefreshCw, Send } from 'lucide-react'
import { generateQuiz, gradeQuiz, type QuizPaper, type QuizGradeResult } from '../lib/quiz'
import { useWordbookStore } from '../stores/wordbookStore'
import { toast } from '../stores/noticeStore'

interface QuizModalProps {
  docName: string
  docText: string
  onClose: () => void
}

export default function QuizModal({ docName, docText, onClose }: QuizModalProps): React.JSX.Element {
  const [loading, setLoading] = useState(true)
  const [grading, setGrading] = useState(false)
  const [paper, setPaper] = useState<QuizPaper | null>(null)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [result, setResult] = useState<QuizGradeResult | null>(null)
  const [addedTerms, setAddedTerms] = useState<Set<string>>(new Set())

  useEffect(() => {
    let active = true
    setLoading(true)
    generateQuiz(docName, docText)
      .then((p) => {
        if (active) {
          setPaper(p)
          setLoading(false)
        }
      })
      .catch((err) => {
        if (active) {
          toast('danger', `自测题生成失败：${err instanceof Error ? err.message : String(err)}`)
          setLoading(false)
        }
      })
    return () => {
      active = false
    }
  }, [docName, docText])

  const setOption = (qId: string, val: string): void => {
    setAnswers((prev) => ({ ...prev, [qId]: val }))
  }

  const submitAnswers = async (): Promise<void> => {
    if (!paper) return
    setGrading(true)
    try {
      const res = await gradeQuiz(paper, answers)
      setResult(res)
    } catch (err) {
      toast('danger', `批改失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setGrading(false)
    }
  }

  const addAllMissed = (): void => {
    if (!result?.missedTerms) return
    const items = result.missedTerms
      .filter((t) => !addedTerms.has(t))
      .map((t) => ({ word: t, definition: '随堂自测考点词', context: docName }))
    if (items.length) {
      useWordbookStore.getState().addMany(items)
      setAddedTerms(new Set([...addedTerms, ...result.missedTerms]))
      toast('success', `已将 ${items.length} 个核心考点词批量加入生词本`)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm animate-in fade-in duration-150">
      <div
        className="card relative flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden border border-line shadow-2xl animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 标题栏 */}
        <div className="flex shrink-0 items-center justify-between border-b border-line px-5 py-3.5">
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent/10 text-accent">
              <Award size={16} />
            </div>
            <div>
              <h2 className="text-[14px] font-semibold text-ink-1">📝 读后随堂自测（考考我）</h2>
              <p className="text-[10px] text-ink-3">核心贡献 · 关键术语填空 · 结论理解 · 即时批改</p>
            </div>
          </div>
          <button onClick={onClose} className="btn btn-ghost !p-1 text-ink-3 hover:text-ink-1" title="关闭">
            <X size={16} />
          </button>
        </div>

        {/* 主体区 */}
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
          {loading && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Sparkles size={24} className="animate-spin text-accent" />
              <p className="mt-3 text-[13px] font-medium text-ink-2">AI 正在根据文档内容设计考点自测题…</p>
            </div>
          )}

          {!loading && paper && !result && (
            <div className="space-y-5">
              <p className="text-[12px] text-ink-3">请完成以下 3 道题目，检验本篇阅读掌握情况：</p>
              {paper.questions.map((q, idx) => (
                <div key={q.id} className="rounded-xl border border-line bg-card/60 p-4">
                  <div className="flex items-start gap-2">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent/10 text-[11px] font-bold text-accent">
                      {idx + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-medium leading-relaxed text-ink-1">{q.title}</p>

                      {/* 单选 */}
                      {q.type === 'choice' && q.options && (
                        <div className="mt-3 space-y-2">
                          {q.options.map((opt) => (
                            <label
                              key={opt.key}
                              className={`flex cursor-pointer items-center gap-2.5 rounded-lg border p-2.5 text-[12px] transition ${
                                answers[q.id] === opt.key
                                  ? 'border-accent bg-accent/10 font-medium text-accent'
                                  : 'border-line bg-surface/40 hover:bg-surface'
                              }`}
                            >
                              <input
                                type="radio"
                                name={q.id}
                                value={opt.key}
                                checked={answers[q.id] === opt.key}
                                onChange={() => setOption(q.id, opt.key)}
                                className="accent-accent"
                              />
                              <span>
                                <strong className="mr-1">{opt.key}.</strong> {opt.text}
                              </span>
                            </label>
                          ))}
                        </div>
                      )}

                      {/* 填空 */}
                      {q.type === 'blank' && (
                        <div className="mt-3">
                          <input
                            type="text"
                            value={answers[q.id] ?? ''}
                            onChange={(e) => setOption(q.id, e.target.value)}
                            placeholder="请输入英文术语…"
                            className="w-full rounded-lg border border-line bg-surface/50 px-3 py-2 text-[13px] outline-none focus:border-accent"
                          />
                        </div>
                      )}

                      {/* 主观题 */}
                      {q.type === 'subjective' && (
                        <div className="mt-3">
                          <textarea
                            value={answers[q.id] ?? ''}
                            onChange={(e) => setOption(q.id, e.target.value)}
                            placeholder="请用中文简述你的理解与要点…"
                            rows={3}
                            className="w-full resize-none rounded-lg border border-line bg-surface/50 p-3 text-[13px] outline-none focus:border-accent"
                          />
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* 批改结果 */}
          {result && (
            <div className="space-y-4">
              {/* 分数卡片 */}
              <div className="flex items-center justify-between rounded-xl border border-accent/20 bg-accent/5 p-4">
                <div>
                  <span className="text-[11px] text-ink-3">自测得分</span>
                  <div className="text-[28px] font-bold text-accent">{result.score} <span className="text-[14px] font-normal text-ink-2">/ 100</span></div>
                  <p className="mt-0.5 text-[12px] text-ink-2">{result.feedback}</p>
                </div>
                {result.missedTerms.length > 0 && (
                  <button onClick={addAllMissed} className="btn btn-primary gap-1.5 text-[12px]">
                    <BookPlus size={14} />
                    <span>错词一键入生词本 ({result.missedTerms.length})</span>
                  </button>
                )}
              </div>

              {/* 逐题解析 */}
              <div className="space-y-3">
                {result.details.map((d, i) => (
                  <div key={i} className="rounded-xl border border-line bg-card p-3.5 text-[12px]">
                    <div className="flex items-center gap-2 font-medium">
                      {d.isCorrect ? (
                        <span className="flex items-center gap-1 text-ok">
                          <CheckCircle2 size={14} /> 第 {i + 1} 题 回答正确
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-danger">
                          <XCircle size={14} /> 第 {i + 1} 题 需加强
                        </span>
                      )}
                    </div>
                    <div className="mt-2 space-y-1 text-ink-2">
                      <p>你的作答：<span className="font-medium text-ink-1">{d.userAnswer || '（未作答）'}</span></p>
                      <p>参考答案：<span className="font-semibold text-ok">{d.correctAnswer}</span></p>
                      <p className="text-[11px] text-ink-3">💡 解析：{d.comment}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* 底部操作 */}
        <div className="flex items-center justify-between border-t border-line px-5 py-3">
          <button onClick={onClose} className="btn btn-ghost text-[12px] text-ink-3">
            关闭
          </button>
          {!result && (
            <button
              onClick={submitAnswers}
              disabled={loading || grading || !paper}
              className="btn btn-primary gap-1.5 px-5 text-[12px]"
            >
              {grading ? <RefreshCw size={13} className="animate-spin" /> : <Send size={13} />}
              <span>{grading ? '正在智能批改中…' : '提交试卷'}</span>
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
