import { useEffect, useMemo, useState } from 'react'
import {
  BookOpen, Layers, Sparkles, RefreshCw, Shuffle, Check, X, GraduationCap, PenLine, Clock, Volume2, Headphones
} from 'lucide-react'
import { toast } from '../stores/noticeStore'
import { useFlashcardStore } from '../stores/flashcardStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useWordbookStore } from '../stores/wordbookStore'
import { useFileStore } from '../stores/fileStore'
import { analyzeUnknownWords } from '../lib/unknownWords'
import { useReviewLogStore } from '../stores/reviewLogStore'
import { normalizeAnswer } from '../lib/flashcard'
import { isDue } from '../lib/srs'
import { levelLabel } from '../lib/levels'
import { pronounce } from '../lib/pronounce'
import Segmented from './Segmented'
import EmptyState from './EmptyState'

type FlashTab = 'card' | 'exercise' | 'dictation'
type CardSource = 'wordbook' | 'due' | 'custom' | 'doc'

const COUNTS = [5, 10, 20]

export default function FlashcardView(): React.JSX.Element {
  const store = useFlashcardStore()
  const hasApi = Boolean(useSettingsStore((s) => s.settings.apiKey))
  const wbWords = useWordbookStore((s) => s.words)
  const docSegments = useFileStore((s) => s.segments)
  const docName = useFileStore((s) => s.doc?.name ?? '')
  const docUnknownCount = useMemo(
    () => (docSegments.length ? analyzeUnknownWords(docSegments).unknownWords.length : 0),
    [docSegments]
  )

  // 闪卡生成失败：用统一 Notice 呈现
  useEffect(() => {
    if (store.error) toast('warning', store.error, '闪卡生成失败', 6000)
  }, [store.error])
  const [tab, setTab] = useState<FlashTab>('card')
  const source = store.source
  const setSource = (s: CardSource): void => store.setSource(s)
  const [count, setCount] = useState(10)
  const [aiEnhance, setAiEnhance] = useState(hasApi)
  const [customText, setCustomText] = useState('')

  const dueTotal = wbWords.filter((w) => isDue(w.srs)).length
  const card = store.deck[store.index]
  const progress = store.deck.length ? store.index + 1 : 0

  const draw = (): void => {
    if (source === 'wordbook') void store.drawFromWordbook(count, aiEnhance)
    else if (source === 'due') void store.drawDue(count, aiEnhance)
    else if (source === 'doc') void store.drawFromDoc(count, aiEnhance)
    else {
      const words = customText.split(/[\s,，;；]+/).filter(Boolean)
      void store.drawFromWords(words, count, aiEnhance)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="glass flex shrink-0 items-center justify-between border-b px-5 py-3">
        <h1 className="flex items-center gap-2 text-[17px] font-semibold">
          <Layers size={16} className="text-accent" /> 闪卡抽词
        </h1>
        <div className="flex items-center gap-2">
          {store.deck.length > 0 && (
            <>
              <span className="chip">
                认识 <span className="text-ok">{store.known}</span> · 不认识{' '}
                <span className="text-danger">{store.unknown}</span>
              </span>
              <button className="btn btn-ghost !p-1.5" onClick={store.reset} title="重置">
                <RefreshCw size={13} />
              </button>
            </>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-3 border-b border-line px-5 py-2">
        <Segmented<FlashTab>
          items={[
            { value: 'card', label: '闪卡' },
            { value: 'exercise', label: '小练习' },
            { value: 'dictation', label: '听写' }
          ]}
          value={tab}
          onChange={setTab}
        />
        {tab === 'card' && (
          <>
            <Segmented<CardSource>
              items={[
                { value: 'wordbook', label: '生词本' },
                { value: 'due', label: '今日到期' },
                { value: 'doc', label: '当前文档' },
                { value: 'custom', label: '自选词' }
              ]}
              value={source}
              onChange={setSource}
            />
            {source === 'due' && (
              <span className="flex items-center gap-1 text-[11px] text-accent">
                <Clock size={11} /> {dueTotal} 词可复习
              </span>
            )}
            {source === 'doc' && (
              <span className="flex items-center gap-1 text-[11px] text-accent">
                <BookOpen size={11} /> {docName ? `${docName} · 生词 ${docUnknownCount}` : '未打开文档'}
              </span>
            )}
            <div className="flex items-center gap-1">
              {COUNTS.map((c) => (
                <button
                  key={c}
                  className={`chip cursor-pointer transition ${count === c ? '!bg-accent !text-white' : ''}`}
                  onClick={() => setCount(c)}
                >
                  {c}
                </button>
              ))}
            </div>
            <label className="flex cursor-pointer select-none items-center gap-1.5 text-[11px] text-ink-2">
              <input
                type="checkbox"
                checked={aiEnhance}
                disabled={!hasApi}
                onChange={(e) => setAiEnhance(e.target.checked)}
                className="h-3.5 w-3.5 accent-[var(--accent)]"
              />
              AI 增强
            </label>
            <button className="btn btn-primary !py-1.5 text-[12px]" onClick={draw}>
              <Sparkles size={12} /> 抽卡
            </button>
          </>
        )}
        {tab === 'exercise' && (
          <button className="btn btn-primary !py-1.5 text-[12px]" disabled={!hasApi} onClick={() => store.genExercises(count)}>
            <GraduationCap size={12} /> 生成练习
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-2xl">
          {tab === 'card' && (
            <>
              {!store.deck.length ? (
                <EmptyState
                  icon={BookOpen}
                  title="先抽一组闪卡"
                  hint={
                    source === 'wordbook'
                      ? '从生词本随机抽取，逐张翻面记忆'
                      : source === 'doc'
                        ? '抽取当前打开文档里「未收藏」的生词来背'
                        : '输入几个单词，AI 自动生成音标 / 构词 / 关联词'
                  }
                />
              ) : (
                <>
                  {source === 'custom' && (
                    <div className="mb-4">
                      <div className="relative">
                        <PenLine size={12} className="absolute left-3 top-3 text-ink-3" />
                        <textarea
                          className="input min-h-[64px] resize-none !pl-8 text-[13px]"
                          placeholder="输入要学习的单词，空格 / 逗号分隔…"
                          value={customText}
                          onChange={(e) => setCustomText(e.target.value)}
                        />
                      </div>
                    </div>
                  )}
                  <div className="mb-3 flex items-center justify-between text-[11px] text-ink-3">
                    <span>
                      第 {progress} / {store.deck.length} 张
                    </span>
                    <button className="flex items-center gap-1 transition hover:text-accent" onClick={draw} title="换一组">
                      <Shuffle size={11} /> 换一组
                    </button>
                  </div>

                  <div
                    className="card group relative min-h-[300px] cursor-pointer select-none p-8 text-center transition hover:shadow-pop"
                    onClick={store.flip}
                    title="点击翻面"
                  >
                    {!store.flipped ? (
                      <div className="animate-float-in flex h-full min-h-[236px] flex-col items-center justify-center">
                        <p className="text-[34px] font-semibold tracking-tight">{card?.word}</p>
                        {card?.phonetic && <p className="mt-2 text-[14px] text-ink-2">{card.phonetic}</p>}
                        {card?.pos && <span className="chip mt-2">{card.pos}</span>}
                        {card?.level && <span className="chip mt-1 !bg-ink-3/10 !text-ink-2 !text-[10px]">{levelLabel(card.level)}</span>}
                        <p className="mt-6 text-[11px] text-ink-3">点击卡片翻面查看释义</p>
                      </div>
                    ) : (
                      <div className="animate-float-in flex h-full min-h-[236px] flex-col items-start justify-center text-left">
                        <div className="flex items-center gap-2">
                          <p className="text-[20px] font-semibold">{card?.word}</p>
                          {card?.pos && <span className="chip !text-[10px]">{card.pos}</span>}
                          {card?.level && <span className="chip !bg-ink-3/10 !text-ink-2 !text-[10px]">{levelLabel(card.level)}</span>}
                          {card?.register && <span className="chip !text-[10px] text-accent">{card.register}</span>}
                        </div>
                        <p className="mt-2 text-[14px] leading-relaxed text-ink-1">{card?.definition}</p>
                        {card?.composition && (
                          <p className="mt-3 rounded-xl bg-surface px-3 py-2 text-[12px] leading-relaxed text-ink-2">
                            <span className="font-medium text-accent">构词 </span>
                            {card.composition}
                          </p>
                        )}
                        {card?.context && (
                          <p className="mt-2 text-[12px] leading-relaxed text-ink-3 select-text">{card.context}</p>
                        )}
                        {card?.collocation && (
                          <p className="mt-1.5 text-[12px] leading-relaxed text-ink-2">
                            <span className="font-medium text-accent">搭配：</span>
                            <span className="select-text">{card.collocation}</span>
                          </p>
                        )}
                        {card?.nuance && (
                          <p className="mt-1.5 text-[12px] leading-relaxed text-ink-3">
                            <span className="font-medium text-accent">辨析：</span>
                            {card.nuance}
                          </p>
                        )}
                        {card?.wordFamily?.length ? (
                          <div className="mt-2 flex flex-wrap gap-1">
                            {card.wordFamily.map((r) => (
                              <span key={r} className="chip !text-[10px] text-ink-2">{r}</span>
                            ))}
                          </div>
                        ) : null}
                        {card?.related?.length ? (
                          <div className="mt-1 flex flex-wrap gap-1">
                            {card.related.map((r) => (
                              <span key={r} className="chip !text-[10px] text-accent">{r}</span>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    )}
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-3">
                    <button
                      className="btn !py-3 !text-danger"
                      onClick={() => store.mark(false)}
                      title="标记为不认识，复习时重点看"
                    >
                      <X size={14} /> 不认识
                    </button>
                    <button
                      className="btn btn-primary !py-3"
                      onClick={() => store.mark(true)}
                      title="标记为认识，下一张"
                    >
                      <Check size={14} /> 认识
                    </button>
                  </div>
                </>
              )}
            </>
          )}

          {tab === 'exercise' && <ExerciseArea />}
          {tab === 'dictation' && <DictationArea deck={store.deck} />}
        </div>
      </div>
    </div>
  )
}

function ExerciseArea(): React.JSX.Element {
  const store = useFlashcardStore()
  const ex = store.exercises[store.exIndex]

  if (!store.exercises.length) {
    return (
      <EmptyState
        icon={GraduationCap}
        title={store.exDone ? `本轮练习完成 · 答对 ${store.exScore} 题` : '生成一组词汇小练习'}
        hint={store.exDone ? '点击「生成练习」再来一组' : '选择 · 填空 · 拼写 · 造句（AI 批改），自动出题'}
      />
    )
  }

  const typeLabel =
    ex.type === 'choice' ? '选择题' : ex.type === 'fill' ? '填空题' : ex.type === 'spelling' ? '拼写题' : '造句题'

  const isSentence = ex.type === 'sentence'
  const submit = (): void => {
    if (isSentence) void store.gradeSentence()
    else store.submitExercise(ex.type === 'choice' ? '' : store.exInput)
  }

  return (
    <div className="card p-5">
      <div className="mb-1 flex items-center justify-between">
        <span className="chip">{typeLabel}</span>
        <span className="text-[11px] text-ink-3">
          {store.exIndex + 1} / {store.exercises.length} · 已答对 {store.exScore}
        </span>
      </div>

      <p className="mt-3 text-[15px] leading-relaxed select-text">{ex.prompt}</p>

      {ex.type === 'choice' ? (
        <div className="mt-4 grid gap-2">
          {ex.options?.map((o, i) => {
            const isAnswer = o === ex.answer
            return (
              <button
                key={i}
                disabled={store.exAnswered}
                onClick={() => store.submitExercise(o)}
                className={`btn justify-start !py-2.5 text-left text-[13px] ${
                  store.exAnswered
                    ? isAnswer
                      ? '!border-ok !bg-ok/10 !text-ok'
                      : '!opacity-50'
                    : 'hover:!border-accent'
                }`}
              >
                <span className="mr-1.5 text-[11px] text-ink-3">{String.fromCharCode(65 + i)}.</span>
                {o}
              </button>
            )
          })}
        </div>
      ) : isSentence ? (
        <div className="mt-4">
          <textarea
            className="input min-h-[72px] resize-none"
            placeholder={`用 ${ex.word} 写一个英文句子…`}
            value={store.exInput}
            disabled={store.exAnswered}
            onChange={(e) => store.setExInput(e.target.value)}
          />
          {!store.exAnswered && (
            <div className="mt-2 flex justify-end">
              <button
                className="btn btn-primary"
                disabled={!store.exInput.trim() || store.exGrading}
                onClick={submit}
              >
                {store.exGrading ? (
                  <>
                    <span className="h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
                    AI 批改中…
                  </>
                ) : (
                  <>
                    <PenLine size={13} /> 提交批改
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="mt-4 flex items-center gap-2">
          <input
            className="input flex-1"
            placeholder={ex.type === 'spelling' ? '输入单词…' : '填入单词…'}
            value={store.exInput}
            disabled={store.exAnswered}
            onChange={(e) => store.setExInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !store.exAnswered) submit()
            }}
          />
          {!store.exAnswered && (
            <button className="btn btn-primary" disabled={!store.exInput.trim()} onClick={submit}>
              <Check size={13} /> 作答
            </button>
          )}
        </div>
      )}

      {store.exAnswered && (
        <div className="mt-4 animate-float-in">
          {isSentence && store.exGrade ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between rounded-xl bg-surface px-3 py-2.5">
                <span className="text-[13px] font-medium">AI 批改得分</span>
                <span
                  className={`text-[18px] font-semibold ${store.exCorrect ? 'text-ok' : 'text-danger'}`}
                >
                  {store.exGrade.score}
                </span>
              </div>
              <GradeRow label="语法" text={store.exGrade.grammar} />
              <GradeRow label="搭配" text={store.exGrade.collocation} />
              <GradeRow label="词义用法" text={store.exGrade.usage} />
              <GradeRow label="建议" text={store.exGrade.suggestion} />
              {store.exGrade.revised && (
                <div className="rounded-xl border border-accent/30 bg-accent-soft px-3 py-2.5">
                  <p className="text-[10px] font-medium text-accent">改写参考</p>
                  <p className="mt-0.5 select-text text-[13px] leading-relaxed">{store.exGrade.revised}</p>
                </div>
              )}
            </div>
          ) : (
            <div
              className={`rounded-xl px-3 py-2.5 text-[13px] ${
                store.exCorrect ? 'bg-ok/10 text-ok' : 'bg-danger/10 text-danger'
              }`}
            >
              {store.exCorrect ? '回答正确！' : `回答错误，正确答案：${ex.answer}`}
            </div>
          )}
          {!isSentence && ex.explanation && (
            <p className="mt-2 rounded-xl bg-surface px-3 py-2 text-[12px] leading-relaxed text-ink-2">
              解析：{ex.explanation}
            </p>
          )}
          <div className="mt-3 flex justify-end">
            <button className="btn btn-primary" onClick={store.nextExercise}>
              {store.exDone ? '完成本轮' : '下一题'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function GradeRow(props: { label: string; text: string }): React.JSX.Element {
  return (
    <div className="rounded-xl bg-surface px-3 py-2">
      <span className="text-[10px] font-medium text-accent">{props.label}</span>
      <p className="mt-0.5 select-text text-[12px] leading-relaxed text-ink-2">{props.text}</p>
    </div>
  )
}

/** 听写模式：逐词播放发音 → 用户输入拼写 → 判分并更新复习调度 */
function DictationArea({ deck }: { deck: FlashcardViewFlashCard[] }): React.JSX.Element {
  const [idx, setIdx] = useState(0)
  const [value, setValue] = useState('')
  const [checked, setChecked] = useState<null | boolean>(null)

  const total = deck.length

  const playWord = (): void => {
    const w = deck[idx]
    if (!w) return
    void pronounce(w.word, 0.85)
  }
  const reset = (): void => {
    setIdx(0)
    setValue('')
    setChecked(null)
  }

  if (!total) {
    return (
      <EmptyState
        icon={Headphones}
        title="先抽一组闪卡"
        hint="请在「闪卡」页抽一组单词后再来听写（播放发音 → 输入拼写）"
      />
    )
  }

  const submit = (): void => {
    const w = deck[idx]
    if (!w) return
    // 拼写判分
    const ok = normalizeAnswer(value) === normalizeAnswer(w.word)
    setChecked(ok)
    useWordbookStore.getState().reviewWord(w.word, ok)
    useReviewLogStore.getState().add({ word: w.word, kind: 'exercise', correct: ok })
  }

  const next = (): void => {
    if (idx >= total - 1) {
      reset()
    } else {
      setIdx(idx + 1)
      setValue('')
      setChecked(null)
    }
  }

  const current = deck[idx]

  return (
    <div className="space-y-3">
      <div className="mb-1 flex items-center justify-between text-[11px] text-ink-3">
        <span className="flex items-center gap-1">
          <Headphones size={11} /> 听写模式 · 播放后拼写，回车判分
        </span>
        <span>
          第 {idx + 1} / {total}
        </span>
      </div>

      <div className="card p-8 text-center">
        <button
          className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-accent-soft text-accent transition hover:brightness-95"
          onClick={playWord}
          title="播放发音"
        >
          <Volume2 size={26} />
        </button>
        <p className="mt-2 text-[11px] text-ink-3">点击播放发音（或每次进入自动朗读）</p>

        <div className="mx-auto mt-5 flex max-w-sm items-center gap-2">
          <input
            className="input flex-1 text-center !text-[18px] tracking-wide"
            placeholder="拼写这个单词…"
            value={value}
            autoFocus
            disabled={checked !== null}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && checked === null) submit()
            }}
          />
          {checked === null && (
            <button className="btn btn-primary" disabled={!value.trim()} onClick={submit}>
              <Check size={13} /> 判分
            </button>
          )}
        </div>

        {checked !== null && (
          <div className="mt-4 animate-float-in">
            <p className={`text-[14px] font-medium ${checked ? 'text-ok' : 'text-danger'}`}>
              {checked ? '拼写正确！' : `拼错了，正确答案：${current.word}`}
            </p>
            {current.definition && <p className="mt-1 text-[13px] text-ink-2">{current.definition}</p>}
            <div className="mt-4 flex justify-center gap-2">
              <button
                className="btn btn-ghost !px-3 !py-1.5 text-[11px]"
                onClick={() => void pronounce(current.word, 0.75)}
                title="再听一次"
              >
                <Volume2 size={11} /> 再听
              </button>
              <button className="btn btn-primary" onClick={next}>
                {idx >= total - 1 ? '完成本轮' : '下一词'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

type FlashcardViewFlashCard = {
  word: string
  definition?: string
}
