import { useEffect, useState } from 'react'
import {
  BookOpen,
  GraduationCap,
  Target,
  PenTool,
  GitFork,
  FileCheck,
  Search,
  Copy,
  Volume2,
  Sparkles,
  RefreshCw
} from 'lucide-react'
import { marked } from 'marked'
import { sanitizeHtml } from '../lib/sanitize'
import { useWordbookStore } from '../stores/wordbookStore'
import { useProfileStore } from '../stores/profileStore'
import { useAppStore, type EnglishTab, type VocabSubTab, type AdvancedSubTab, type ProfileSubTab } from '../stores/appStore'
import { isDue } from '../lib/srs'
import { ACADEMIC_PHRASEBANK, searchPhrasebank } from '../lib/academicPhrasebank'
import { analyzeGrammarTree, evaluateIeltsToeflEssay } from '../lib/academicAdvanced'
import { toast } from '../stores/noticeStore'
import WordbookView from './WordbookView'
import FlashcardView from './FlashcardView'
import QuoteView from './QuoteView'
import StatsView from './StatsView'
import HistoryView from './HistoryView'

export default function EnglishView(): React.JSX.Element {
  const tab = useAppStore((s) => s.englishTab)
  const vocabSub = useAppStore((s) => s.vocabSubTab)
  const advancedSub = useAppStore((s) => s.advancedSubTab)
  const profileSub = useAppStore((s) => s.profileSubTab)
  const setEnglishTab = useAppStore((s) => s.setEnglishTab)

  const setTab = (t: EnglishTab) => setEnglishTab(t)
  const setVocabSub = (st: VocabSubTab) => setEnglishTab('vocabulary', st)
  const setAdvancedSub = (st: AdvancedSubTab) => setEnglishTab('advanced', st)
  const setProfileSub = (st: ProfileSubTab) => setEnglishTab('profile', st)

  const words = useWordbookStore((s) => s.words)
  const profile = useProfileStore((s) => s.profile)
  const updateProfile = useProfileStore((s) => s.updateProfile)

  const dueCount = words.filter((w) => w.srs && w.srs.reps > 0 && isDue(w.srs, Date.now())).length

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-bg-app">
      {/* 顶部个性化空间顶级导航 */}
      <header className="glass shrink-0 border-b border-line px-5 py-2.5 flex items-center justify-between">
        <div className="flex items-center gap-1.5 overflow-x-auto">
          <button
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-[12px] font-medium transition ${
              tab === 'vocabulary'
                ? 'bg-accent text-white shadow-xs'
                : 'text-ink-2 hover:bg-black/[0.04] dark:hover:bg-white/[0.04]'
            }`}
            onClick={() => setTab('vocabulary')}
          >
            <BookOpen size={13} />
            词汇与记忆中心
            <span className={`text-[10px] rounded-full px-1.5 py-0.2 ${tab === 'vocabulary' ? 'bg-white/20 text-white' : 'bg-black/5 dark:bg-white/10 text-ink-3'}`}>
              {words.length}
            </span>
          </button>

          <button
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-[12px] font-medium transition ${
              tab === 'advanced'
                ? 'bg-accent text-white shadow-xs'
                : 'text-ink-2 hover:bg-black/[0.04] dark:hover:bg-white/[0.04]'
            }`}
            onClick={() => setTab('advanced')}
          >
            <PenTool size={13} />
            学术英语进阶
          </button>

          <button
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-[12px] font-medium transition ${
              tab === 'profile'
                ? 'bg-accent text-white shadow-xs'
                : 'text-ink-2 hover:bg-black/[0.04] dark:hover:bg-white/[0.04]'
            }`}
            onClick={() => setTab('profile')}
          >
            <Target size={13} />
            学情档案与美言
          </button>
        </div>

        <div className="hidden md:flex items-center gap-2 text-[11px] text-ink-3">
          <span className="flex items-center gap-1 text-accent">
            <GraduationCap size={13} />
            {profile.goal || '个性化英语自适应空间'}
          </span>
        </div>
      </header>

      {/* 主视图内容区域 */}
      <main className="min-h-0 flex-1 overflow-hidden relative flex flex-col">
        {/* 1. 词汇与记忆中心 */}
        {tab === 'vocabulary' && (
          <div className="h-full flex flex-col overflow-hidden">
            <div className="glass shrink-0 border-b border-line px-5 py-1.5 flex items-center justify-between bg-panel/30">
              <div className="flex items-center gap-1">
                <button
                  className={`px-3 py-1 rounded-md text-[11px] font-medium transition ${vocabSub === 'wordbook' ? 'bg-accent text-white' : 'text-ink-2 hover:bg-black/5 dark:hover:bg-white/5'}`}
                  onClick={() => setVocabSub('wordbook')}
                >
                  📚 我的生词本 ({words.length})
                </button>
                <button
                  className={`px-3 py-1 rounded-md text-[11px] font-medium transition ${vocabSub === 'flashcard' ? 'bg-accent text-white' : 'text-ink-2 hover:bg-black/5 dark:hover:bg-white/5'}`}
                  onClick={() => setVocabSub('flashcard')}
                >
                  🃏 闪卡抗遗忘 {dueCount > 0 && `(${dueCount}到期)`}
                </button>
                <button
                  className={`px-3 py-1 rounded-md text-[11px] font-medium transition ${vocabSub === 'history' ? 'bg-accent text-white' : 'text-ink-2 hover:bg-black/5 dark:hover:bg-white/5'}`}
                  onClick={() => setVocabSub('history')}
                >
                  🕰️ 历史记录回填
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-hidden min-h-0">
              {vocabSub === 'wordbook' && <WordbookView />}
              {vocabSub === 'flashcard' && <FlashcardView />}
              {vocabSub === 'history' && <HistoryView />}
            </div>
          </div>
        )}

        {/* 2. 学术英语进阶学院 */}
        {tab === 'advanced' && (
          <div className="h-full flex flex-col overflow-hidden">
            <div className="glass shrink-0 border-b border-line px-5 py-1.5 flex items-center justify-between bg-panel/30">
              <div className="flex items-center gap-1">
                <button
                  className={`px-3 py-1 rounded-md text-[11px] font-medium transition ${advancedSub === 'phrasebank' ? 'bg-accent text-white' : 'text-ink-2 hover:bg-black/5 dark:hover:bg-white/5'}`}
                  onClick={() => setAdvancedSub('phrasebank')}
                >
                  ✍️ 曼彻斯特学术句型库
                </button>
                <button
                  className={`px-3 py-1 rounded-md text-[11px] font-medium transition ${advancedSub === 'grammar' ? 'bg-accent text-white' : 'text-ink-2 hover:bg-black/5 dark:hover:bg-white/5'}`}
                  onClick={() => setAdvancedSub('grammar')}
                >
                  🌳 长难句语法精析
                </button>
                <button
                  className={`px-3 py-1 rounded-md text-[11px] font-medium transition ${advancedSub === 'writing' ? 'bg-accent text-white' : 'text-ink-2 hover:bg-black/5 dark:hover:bg-white/5'}`}
                  onClick={() => setAdvancedSub('writing')}
                >
                  📝 雅思/托福考官精批
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-hidden min-h-0">
              {advancedSub === 'phrasebank' && <PhrasebankWorkspace />}
              {advancedSub === 'grammar' && <GrammarWorkspace />}
              {advancedSub === 'writing' && <WritingWorkspace />}
            </div>
          </div>
        )}

        {/* 3. 学情档案与美言 */}
        {tab === 'profile' && (
          <div className="h-full flex flex-col overflow-hidden">
            <div className="glass shrink-0 border-b border-line px-5 py-1.5 flex items-center justify-between bg-panel/30">
              <div className="flex items-center gap-1">
                <button
                  className={`px-3 py-1 rounded-md text-[11px] font-medium transition ${profileSub === 'goals' ? 'bg-accent text-white' : 'text-ink-2 hover:bg-black/5 dark:hover:bg-white/5'}`}
                  onClick={() => setProfileSub('goals')}
                >
                  🎯 学习目标与档案
                </button>
                <button
                  className={`px-3 py-1 rounded-md text-[11px] font-medium transition ${profileSub === 'stats' ? 'bg-accent text-white' : 'text-ink-2 hover:bg-black/5 dark:hover:bg-white/5'}`}
                  onClick={() => setProfileSub('stats')}
                >
                  📊 学情周报与统计
                </button>
                <button
                  className={`px-3 py-1 rounded-md text-[11px] font-medium transition ${profileSub === 'quotes' ? 'bg-accent text-white' : 'text-ink-2 hover:bg-black/5 dark:hover:bg-white/5'}`}
                  onClick={() => setProfileSub('quotes')}
                >
                  💬 美言金句积累
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-hidden min-h-0">
              {profileSub === 'goals' && (
                <div className="h-full overflow-y-auto p-6 max-w-2xl mx-auto space-y-6">
                  <div className="card p-5 space-y-4">
                    <h2 className="text-[15px] font-semibold text-ink-1 flex items-center gap-2">
                      <Target size={16} className="text-accent" /> 我的个性化英语学习档案
                    </h2>
                    <p className="text-[12px] text-ink-3 leading-relaxed">
                      在这里设定您的学习目标与水平，智能体与闪卡系统将在出题、分级与对话中为您自动适配难度。
                    </p>

                    <div className="space-y-4 pt-2">
                      <div>
                        <label className="block text-[12px] font-medium text-ink-2 mb-1.5">当前学习目标</label>
                        <input
                          type="text"
                          placeholder="例如：准备托福阅读 28+、看懂顶刊论文、积累学术写作句型"
                          className="input w-full text-[13px]"
                          value={profile.goal || ''}
                          onChange={(e) => updateProfile({ goal: e.target.value })}
                        />
                      </div>

                      <div>
                        <label className="block text-[12px] font-medium text-ink-2 mb-1.5">英语水平档位 (CEFR / 考试)</label>
                        <input
                          type="text"
                          placeholder="例如：CET-6 580 / 雅思 7.0 / 托福 100 / CEFR C1"
                          className="input w-full text-[13px]"
                          value={profile.level || ''}
                          onChange={(e) => updateProfile({ level: e.target.value })}
                        />
                      </div>

                      <div>
                        <label className="block text-[12px] font-medium text-ink-2 mb-1.5">希望重点加强的领域</label>
                        <input
                          type="text"
                          placeholder="例如：学术词汇、长难句结构、学术写作润色、发音与听读"
                          className="input w-full text-[13px]"
                          value={profile.focus || ''}
                          onChange={(e) => updateProfile({ focus: e.target.value })}
                        />
                      </div>

                      <div>
                        <label className="block text-[12px] font-medium text-ink-2 mb-1.5">偏好的学习风格</label>
                        <input
                          type="text"
                          placeholder="例如：喜欢随堂出题自测、注重词根词缀讲解、喜欢精炼学术风格"
                          className="input w-full text-[13px]"
                          value={profile.style || ''}
                          onChange={(e) => updateProfile({ style: e.target.value })}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              )}
              {profileSub === 'stats' && <StatsView />}
              {profileSub === 'quotes' && <QuoteView />}
            </div>
          </div>
        )}
      </main>
    </div>
  )
}

/* =====================================================================
 * 1. 学术写作句型库工作区（Academic Phrasebank）
 * ===================================================================== */
function PhrasebankWorkspace(): React.JSX.Element {
  const storeQuery = useAppStore((s) => s.phrasebankQuery)
  const setStoreQuery = useAppStore((s) => s.setPhrasebankQuery)
  const [keyword, setKeyword] = useState('')
  const [activeCat, setActiveCat] = useState<string>('intro')

  useEffect(() => {
    if (storeQuery) {
      setKeyword(storeQuery)
      setStoreQuery('')
    }
  }, [storeQuery, setStoreQuery])

  const filtered = keyword.trim() ? searchPhrasebank(keyword) : null
  const curCategory = ACADEMIC_PHRASEBANK.find((c) => c.id === activeCat) || ACADEMIC_PHRASEBANK[0]

  const handleCopy = (text: string) => {
    void navigator.clipboard.writeText(text)
    toast('success', '句型已复制到剪贴板', '复制成功')
  }

  const handleSpeak = (text: string) => {
    const u = new SpeechSynthesisUtterance(text)
    u.lang = 'en-US'
    window.speechSynthesis.speak(u)
  }

  return (
    <div className="h-full flex flex-col md:flex-row overflow-hidden">
      {/* 左侧场景分类列表 */}
      <aside className="w-full md:w-64 border-r border-line bg-panel/30 p-3 space-y-1.5 shrink-0 overflow-y-auto">
        <div className="mb-3 px-2">
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3" />
            <input
              type="text"
              placeholder="搜索句型 / 关键词..."
              className="input w-full !pl-8 text-[12px]"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
            />
          </div>
        </div>

        <p className="px-2 text-[10px] font-bold text-ink-3 uppercase tracking-wider mb-1">写作场景分类</p>
        {ACADEMIC_PHRASEBANK.map((cat) => (
          <button
            key={cat.id}
            className={`w-full flex items-center gap-2 px-3 py-2 rounded-xl text-[12px] font-medium transition text-left ${
              activeCat === cat.id && !keyword.trim()
                ? 'bg-accent text-white shadow-xs'
                : 'text-ink-2 hover:bg-black/[0.04] dark:hover:bg-white/[0.04]'
            }`}
            onClick={() => {
              setActiveCat(cat.id)
              setKeyword('')
            }}
          >
            <span>{cat.icon}</span>
            <span className="truncate">{cat.name.split(' (')[0]}</span>
          </button>
        ))}
      </aside>

      {/* 右侧句型展示区 */}
      <section className="flex-1 overflow-y-auto p-6 space-y-6">
        {filtered ? (
          <div className="space-y-4 max-w-3xl">
            <h3 className="text-[14px] font-bold text-ink-1 flex items-center gap-2">
              <Search size={15} className="text-accent" /> 搜索「{keyword}」匹配句型 ({filtered.length} 条)
            </h3>
            <div className="space-y-3">
              {filtered.map((item, idx) => (
                <div key={idx} className="card p-4 space-y-2 hover:border-accent/40 transition">
                  <div className="flex items-center justify-between text-[11px] text-ink-3">
                    <span className="badge badge-outline">{item.category} · {item.subcategory}</span>
                    <div className="flex items-center gap-1">
                      <button className="btn btn-ghost !p-1.5" onClick={() => handleSpeak(item.en)} title="发音">
                        <Volume2 size={13} />
                      </button>
                      <button className="btn btn-ghost !p-1.5" onClick={() => handleCopy(item.en)} title="复制句型">
                        <Copy size={13} />
                      </button>
                    </div>
                  </div>
                  <p className="text-[13px] font-semibold text-ink-1 font-mono">{item.en}</p>
                  <p className="text-[12px] text-ink-3">{item.zh}</p>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-6 max-w-3xl">
            <div className="border-b border-line pb-3">
              <h2 className="text-[16px] font-bold text-ink-1 flex items-center gap-2">
                <span>{curCategory.icon}</span> {curCategory.name}
              </h2>
              <p className="text-[12px] text-ink-3 mt-1">{curCategory.description}</p>
            </div>

            <div className="space-y-6">
              {curCategory.subcategories.map((sub, sIdx) => (
                <div key={sIdx} className="space-y-3">
                  <h3 className="text-[13px] font-bold text-accent flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-accent" />
                    {sub.name}
                  </h3>
                  <div className="space-y-2.5">
                    {sub.phrases.map((phrase, pIdx) => (
                      <div key={pIdx} className="card p-4 space-y-2 hover:border-accent/40 transition">
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-[13px] font-semibold text-ink-1 leading-relaxed">{phrase.en}</p>
                          <div className="flex items-center gap-1 shrink-0">
                            <button className="btn btn-ghost !p-1.5" onClick={() => handleSpeak(phrase.en)} title="朗读">
                              <Volume2 size={13} />
                            </button>
                            <button className="btn btn-ghost !p-1.5" onClick={() => handleCopy(phrase.en)} title="复制">
                              <Copy size={13} />
                            </button>
                          </div>
                        </div>
                        <p className="text-[12px] text-ink-3">{phrase.zh}</p>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  )
}

/* =====================================================================
 * 2. 学术长难句语法精析工作台（Grammar Deep Dive）
 * ===================================================================== */
function GrammarWorkspace(): React.JSX.Element {
  const storeGrammar = useAppStore((s) => s.grammarInput)
  const setStoreGrammar = useAppStore((s) => s.setGrammarInput)
  const [inputSentence, setInputSentence] = useState(
    'Although many deep learning architectures have demonstrated remarkable empirical performance across diverse benchmarks, the underlying theoretical mechanisms governing their generalization capability remain poorly understood.'
  )
  const [result, setResult] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (storeGrammar) {
      setInputSentence(storeGrammar)
      setStoreGrammar('')
      void (async () => {
        setLoading(true)
        try {
          const res = await analyzeGrammarTree(storeGrammar.trim())
          setResult(res)
        } finally {
          setLoading(false)
        }
      })()
    }
  }, [storeGrammar, setStoreGrammar])

  const handleAnalyze = async () => {
    if (!inputSentence.trim()) return
    setLoading(true)
    try {
      const res = await analyzeGrammarTree(inputSentence.trim())
      setResult(res)
    } finally {
      setLoading(false)
    }
  }

  const html = result ? sanitizeHtml(marked.parse(result, { async: false }) as string) : ''

  return (
    <div className="h-full overflow-y-auto p-6 max-w-3xl mx-auto space-y-6">
      <div className="card p-5 space-y-4">
        <div className="flex items-center justify-between border-b border-line pb-3">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-xl bg-accent-soft text-accent">
              <GitFork size={15} />
            </span>
            <div>
              <h2 className="text-[15px] font-bold text-ink-1">学术长难句语法树精析</h2>
              <p className="text-[11px] text-ink-3">主谓宾骨架提取 · 从句嵌套解剖 · 修饰成分归位 · 白话顺畅翻译</p>
            </div>
          </div>
          <button
            className="btn btn-primary !px-4 !py-1.5 text-[12px]"
            onClick={handleAnalyze}
            disabled={loading}
          >
            {loading ? <RefreshCw size={13} className="animate-spin" /> : <Sparkles size={13} />}
            {loading ? '正在解剖语法…' : '开始语法精析'}
          </button>
        </div>

        <div>
          <label className="block text-[11px] font-medium text-ink-2 mb-1.5">输入或粘贴需要拆解的英文句子：</label>
          <textarea
            rows={3}
            className="input w-full text-[13px] leading-relaxed resize-none font-mono"
            value={inputSentence}
            onChange={(e) => setInputSentence(e.target.value)}
            placeholder="输入长难句..."
          />
        </div>
      </div>

      {result && (
        <div className="card p-6 animate-float-in">
          <div className="md-body text-[13px] leading-relaxed" dangerouslySetInnerHTML={{ __html: html }} />
        </div>
      )}
    </div>
  )
}

/* =====================================================================
 * 3. 雅思 / 托福学术写作考官精批工作台（Writing Coach）
 * ===================================================================== */
function WritingWorkspace(): React.JSX.Element {
  const storeWriting = useAppStore((s) => s.writingInput)
  const setStoreWriting = useAppStore((s) => s.setWritingInput)
  const [promptText, setPromptText] = useState(
    'Some people believe that universities should focus on providing specialized job skills, while others argue for a broader education. Discuss both views and give your opinion.'
  )
  const [essayText, setEssayText] = useState(
    'In modern society, there is an ongoing debate regarding the primary role of higher education. While some individuals contend that universities should prioritize vocational training, others maintain that cultivating comprehensive knowledge is more vital. In my perspective, a balanced approach yields the greatest benefit.'
  )
  const [result, setResult] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (storeWriting) {
      setEssayText(storeWriting)
      setStoreWriting('')
    }
  }, [storeWriting, setStoreWriting])

  const handleEvaluate = async () => {
    if (!essayText.trim()) return
    setLoading(true)
    try {
      const res = await evaluateIeltsToeflEssay(essayText.trim(), promptText.trim())
      setResult(res)
    } finally {
      setLoading(false)
    }
  }

  const html = result ? sanitizeHtml(marked.parse(result, { async: false }) as string) : ''

  return (
    <div className="h-full overflow-y-auto p-6 max-w-3xl mx-auto space-y-6">
      <div className="card p-5 space-y-4">
        <div className="flex items-center justify-between border-b border-line pb-3">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-xl bg-accent-soft text-accent">
              <FileCheck size={15} />
            </span>
            <div>
              <h2 className="text-[15px] font-bold text-ink-1">雅思 / 托福学术写作考官精批</h2>
              <p className="text-[11px] text-ink-3">TR/CC/LR/GRA 四维标准打分 · 逐句语法润色 · 考官高分范文重写</p>
            </div>
          </div>
          <button
            className="btn btn-primary !px-4 !py-1.5 text-[12px]"
            onClick={handleEvaluate}
            disabled={loading}
          >
            {loading ? <RefreshCw size={13} className="animate-spin" /> : <Sparkles size={13} />}
            {loading ? '考官评审中…' : '立即智能批改'}
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-[11px] font-medium text-ink-2 mb-1">作文题目 (Prompt)：</label>
            <input
              type="text"
              className="input w-full text-[12px]"
              value={promptText}
              onChange={(e) => setPromptText(e.target.value)}
              placeholder="例如：IELTS Task 2 / TOEFL Independent Writing 题目..."
            />
          </div>

          <div>
            <label className="block text-[11px] font-medium text-ink-2 mb-1">考生作文正文 (Essay Content)：</label>
            <textarea
              rows={5}
              className="input w-full text-[13px] leading-relaxed resize-none font-mono"
              value={essayText}
              onChange={(e) => setEssayText(e.target.value)}
              placeholder="在此粘贴或输入英文作文..."
            />
          </div>
        </div>
      </div>

      {result && (
        <div className="card p-6 animate-float-in">
          <div className="md-body text-[13px] leading-relaxed" dangerouslySetInnerHTML={{ __html: html }} />
        </div>
      )}
    </div>
  )
}

