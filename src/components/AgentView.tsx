import { Component, useEffect, useRef, useState, type ReactNode } from 'react'
import {
  Bot, Send, Square, Trash2, Wrench, AlertTriangle,
  BookOpen, Settings, TerminalSquare, Plus, X, Paperclip,
  Sparkles, Award, MessageSquare, PanelLeftClose, PanelLeftOpen, Edit2,
  Zap, Brain, GraduationCap, Globe
} from 'lucide-react'
import { marked } from 'marked'
import { sanitizeHtml } from '../lib/sanitize'
import { useAgentStore, DOC_QUICK_CMDS } from '../stores/agentStore'
import { useAppStore } from '../stores/appStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useFileStore } from '../stores/fileStore'
import { useWordbookStore } from '../stores/wordbookStore'
import { toast } from '../stores/noticeStore'
import { makeSegment } from '../lib/parse'
import { recognizeClipboardImage } from '../lib/ocr'
import { TOOLS, type ToolId, type ToolCategory } from '../lib/agentTools'
import { isDue } from '../lib/srs'
import EmptyState from './EmptyState'

/** 智能体场景预设快捷提示词 */
const QUICK_PROMPTS: { icon: typeof Bot; label: string; prompt: string }[] = [
  { icon: GraduationCap, label: '帮我把考研高频词加入生词本', prompt: '帮我把考研高频核心词汇加入生词本并标注考点' },
  { icon: Award, label: '六级必备词库有多少词？', prompt: '六级必备词库有多少词？帮我查一下六级高频词' },
  { icon: Brain, label: '考研长难句语法深度拆解', prompt: '请帮我深度拆解分析一段考研英语学术长难句的主谓宾骨架与修饰从句' },
  { icon: Globe, label: '雅思学术大作文官方评分', prompt: '请按照雅思 TR/CC/LR/GRA 官方四维度批改我的英文学术作文' },
  { icon: Sparkles, label: '文献研读全套学习包', prompt: '为这篇论文生成学术研读全套包（摘要+术语+测验）' },
  { icon: BookOpen, label: '检索前沿 arXiv 论文', prompt: '联网搜索关于 LLM Reasoning 深度思考的前沿 arXiv 论文' }
]

/** 分类面板展示顺序与标题（固定，不随 TOOLS 定义漂移） */
const CATEGORY_ORDER: ToolCategory[] = ['学习', '项目', '审查核实', '个性化', '设置', '端侧操作']

/** 每个工具点选后填入输入框的示例指令（可再编辑后回车执行） */
const SKILL_EXAMPLES: Partial<Record<ToolId, string>> = {
  academic_search: '搜索关于 Transformer 架构的最新 arXiv 论文',
  github_search: '搜索 LangChain 或 AutoGen 的 GitHub 开源仓库',
  project_list: '查看我的所有学术项目及文献',
  project_create: '新建学术项目：多模态医学图像 主题：Multimodal Medical Imaging',
  project_add_doc: '将当前文献加入项目',
  project_summary: '生成当前学术项目的跨文献全景综述',
  word_lookup: '查一下单词 resilience',
  grade_word: '给单词 serendipity 分级，判断难度档次',
  organize_words: '整理生词本，按近义分组',
  flashcard_draw: '抽 10 张闪卡',
  doc_context: '当前打开的是什么文档？',
  doc_summarize: '总结当前文档',
  doc_unknown: '统计当前文档的生词命中率',
  doc_export: '导出当前文档的译文',
  report: '帮我生成学情周报',
  fact_check: '核查这段话是否靠谱：……',
  set_goal: '设置学习目标：想通过六级',
  get_profile: '查看我的学习档案',
  navigate: '跳转到来做学术工作台',
  set_lookup_source: '切换为词典优先（uapis）查词',
  wordbook_add: '把单词 ubiquitous 加入生词本',
  wordbook_summary: '看看生词本的概览和掌握情况',
  wordbook_due: '今天有哪些词到期要复习？',
  wordbook_list: '列出生词本前 10 个词',
  speak: '朗读一下单词 meticulous',
  open_external: '打开链接 https://example.com',
  history_search: '查找之前《独立宣言》的译文',
  quiz_generate: '考考我，根据这篇文档出 3 道题',
  quiz_grade: '帮我批改答卷：1. A  2. Dropout  3. 降低过拟合',
  pipeline_study_pack: '生成这篇文献的学术研读全套包',
  math_explain: '讲解这个公式：$E = mc^2$',
  polish_run: '润色这段英文：The results are very good...'
}

/**
 * 「点击即执行」的技能：示例自带完整参数，无需用户再编辑输入框，
 * 点击后直接 send（如总结文档、抽闪卡后立即跳转闪卡页）。
 * 参数化技能（查词/加词/设目标/核查/朗读/开链接）则填入输入框供用户改词后回车。
 */
const INSTANT_SKILLS: ReadonlySet<ToolId> = new Set<ToolId>([
  'grade_word',
  'organize_words',
  'flashcard_draw',
  'doc_context',
  'doc_summarize',
  'doc_unknown',
  'doc_export',
  'report',
  'get_profile',
  'navigate',
  'set_lookup_source',
  'wordbook_summary',
  'wordbook_due',
  'wordbook_list',
  'quiz_generate',
  'pipeline_study_pack',
  'project_list',
  'project_summary'
])

/** 错误边界：对话区渲染异常时给出兜底而非白屏（借鉴 1.md 的状态响应式避坑） */
class AgentErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean; message: string }> {
  state = { hasError: false, message: '' }

  static getDerivedStateFromError(err: unknown): { hasError: boolean; message: string } {
    return { hasError: true, message: err instanceof Error ? err.message : String(err) }
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-danger/10 text-danger">
            <AlertTriangle size={22} />
          </span>
          <p className="text-[13px] font-medium text-ink-1">智能体面板渲染出错</p>
          <p className="max-h-24 max-w-md overflow-y-auto break-words text-[11px] text-ink-3 select-text">
            {this.state.message}
          </p>
          <div className="mt-2 flex items-center gap-2">
            <button className="btn btn-primary" onClick={() => useAgentStore.getState().clear()}>
              <Trash2 size={12} /> 清空对话
            </button>
            <button className="btn btn-ghost" onClick={() => this.setState({ hasError: false, message: '' })}>
              重试
            </button>
          </div>
          <p className="text-[10px] text-ink-3">若反复出现，可先「清空对话」排除问题消息。</p>
        </div>
      )
    }
    return this.props.children
  }
}

export default function AgentView(): React.JSX.Element {
  return (
    <AgentErrorBoundary>
      <AgentViewInner />
    </AgentErrorBoundary>
  )
}

function AgentViewInner(): React.JSX.Element {
  const messages = useAgentStore((s) => s.messages)
  const streaming = useAgentStore((s) => s.streaming)
  const input = useAgentStore((s) => s.input)
  const setInput = useAgentStore((s) => s.setInput)
  const send = useAgentStore((s) => s.send)
  const stop = useAgentStore((s) => s.stop)
  const clear = useAgentStore((s) => s.clear)
  const hasAgentApi = useAgentStore((s) => s.hasAgentApi)
  const agentMode = useAgentStore((s) => s.agentMode)
  const setAgentMode = useAgentStore((s) => s.setAgentMode)
  const go = useAppStore((s) => s.go)
  const agentApiKey = useSettingsStore((s) => s.settings.agentApiKey)
  const dictApiKey = useSettingsStore((s) => s.settings.dictApiKey)
  const fileDoc = useFileStore((s) => s.doc)
  const wordbookWords = useWordbookStore((s) => s.words)
  const appendInput = useAgentStore((s) => s.appendInput)
  const pendingConfirm = useAgentStore((s) => s.pendingConfirm)
  const answerConfirm = useAgentStore((s) => s.answerConfirm)
  const [skillsOpen, setSkillsOpen] = useState(false)

  const sessions = useAgentStore((s) => s.sessions)
  const activeSessionId = useAgentStore((s) => s.activeSessionId)
  const sidebarOpen = useAgentStore((s) => s.sidebarOpen)
  const toggleSidebar = useAgentStore((s) => s.toggleSidebar)
  const createSession = useAgentStore((s) => s.createSession)
  const switchSession = useAgentStore((s) => s.switchSession)
  const deleteSession = useAgentStore((s) => s.deleteSession)
  const renameSession = useAgentStore((s) => s.renameSession)

  const [editingSessionId, setEditingSessionId] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState('')

  /** 到期复习提醒：生词本中已到复习期的单词数 */
  const dueCount = wordbookWords.filter((w) => w.srs && w.srs.reps > 0 && isDue(w.srs, Date.now())).length

  /** 技能可用性：依据当前环境（文档是否打开 / 生词本是否为空 / 词典 Key 等）判定并给出人性化原因 */
  const skillState = (toolId: ToolId): { disabled: boolean; reason?: string } => {
    switch (toolId) {
      case 'doc_context':
      case 'doc_summarize':
      case 'doc_unknown':
      case 'doc_export':
      case 'quiz_generate':
      case 'quiz_grade':
      case 'pipeline_study_pack':
        return fileDoc ? { disabled: false } : { disabled: true, reason: '当前未打开文档' }
      case 'organize_words':
      case 'wordbook_summary':
      case 'wordbook_due':
      case 'wordbook_list':
        return wordbookWords.length > 0 ? { disabled: false } : { disabled: true, reason: '生词本为空，先收藏几个词' }
      case 'word_lookup':
        // 无论是否配词典 Key 都可查词（缺 Key 自动回退 AI），仅给出提示
        return { disabled: false, reason: dictApiKey ? '' : '未配置词典 Key，将用 AI 查词' }
      default:
        return { disabled: false }
    }
  }

  /** 上传文献：智能体就地解析并呈现意图交互，零跳转闭环 */
  const handleUpload = async (): Promise<void> => {
    const IMG_EXT = /^(png|jpe?g|webp|bmp|gif)$/
    const DOC_EXT = /^(pdf|docx|txt|md|markdown)$/
    const paths = await window.bridge.openFiles()
    for (const p of paths) {
      const name = p.split(/[\\/]/).pop() ?? p
      const ext = name.split('.').pop()?.toLowerCase() ?? ''
      if (!DOC_EXT.test(ext) && !IMG_EXT.test(ext)) {
        toast('warning', `暂不支持 .${ext} 文件（支持文档 PDF/DOCX/TXT/MD 与图片）`, name)
        continue
      }
      try {
        const data = await window.bridge.readFile(p)
        if (IMG_EXT.test(ext)) {
          const blob = new Blob([data.buffer as ArrayBuffer], { type: `image/${ext === 'jpg' ? 'jpeg' : ext}` })
          const { lines } = await recognizeClipboardImage(blob)
          if (!lines.length) {
            toast('warning', '未识别到文字，请换一张更清晰的图片', name)
            continue
          }
          useFileStore.getState().setDoc(
            { name, size: data.byteLength },
            lines.map((l) => makeSegment('p', l))
          )
          toast('success', `已识别图片《${name}》`, 'OCR 成功')
        } else {
          await useAgentStore.getState().handleUploadDocument(data, name, p)
          toast('success', `已在智能体中解析《${name}》，请在对话中选择处理意图`, '文献已载入')
        }
        return
      } catch (err) {
        toast('danger', err instanceof Error ? err.message : String(err), name)
      }
    }
  }

  useEffect(() => {
    void useWordbookStore.getState().load()
  }, [])

  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // 配置保存后刷新可用状态
    useAgentStore.setState({ hasAgentApi: Boolean(agentApiKey) })
  }, [agentApiKey])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [messages, streaming])

  return (
    <div className="flex h-full overflow-hidden">
      {/* 左侧会话侧边栏 */}
      {sidebarOpen && (
        <aside className="w-64 border-r border-line bg-surface/40 backdrop-blur-sm flex flex-col shrink-0">
          <div className="p-3 border-b border-line flex items-center justify-between">
            <button
              className="btn btn-primary !w-full !py-2 text-[12px] flex items-center justify-center gap-1.5 font-medium shadow-sm"
              onClick={() => {
                createSession()
                toast('success', '已新建对话')
              }}
            >
              <Plus size={14} />
              <span>新建对话</span>
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {sessions.map((s) => {
              const isActive = s.id === activeSessionId
              const isEditing = editingSessionId === s.id

              return (
                <div
                  key={s.id}
                  onClick={() => switchSession(s.id)}
                  className={`group relative flex items-center justify-between rounded-xl px-3 py-2.5 text-[12px] cursor-pointer transition ${
                    isActive
                      ? 'bg-accent/10 text-accent font-medium'
                      : 'text-ink-2 hover:bg-surface-hover hover:text-ink-1'
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <MessageSquare size={13} className={isActive ? 'text-accent shrink-0' : 'text-ink-3 shrink-0'} />
                    {isEditing ? (
                      <input
                        type="text"
                        value={editingTitle}
                        autoFocus
                        onChange={(e) => setEditingTitle(e.target.value)}
                        onBlur={() => {
                          renameSession(s.id, editingTitle)
                          setEditingSessionId(null)
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            renameSession(s.id, editingTitle)
                            setEditingSessionId(null)
                          }
                        }}
                        className="input !py-0.5 !px-1.5 text-[12px] w-full"
                        onClick={(e) => e.stopPropagation()}
                      />
                    ) : (
                      <span className="truncate">{s.title || '新对话'}</span>
                    )}
                  </div>

                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition shrink-0 ml-1">
                    <button
                      className="p-1 hover:text-ink-1 text-ink-3 rounded"
                      title="重命名"
                      onClick={(e) => {
                        e.stopPropagation()
                        setEditingSessionId(s.id)
                        setEditingTitle(s.title)
                      }}
                    >
                      <Edit2 size={11} />
                    </button>
                    <button
                      className="p-1 hover:text-danger text-ink-3 rounded"
                      title="删除对话"
                      onClick={(e) => {
                        e.stopPropagation()
                        deleteSession(s.id)
                        toast('info', '已删除该对话')
                      }}
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </aside>
      )}

      {/* 右侧主对话区 */}
      <div className="flex h-full flex-1 flex-col min-w-0">
        <div className="glass flex shrink-0 items-center justify-between border-b px-5 py-3 bg-panel/30">
          <div className="flex items-center gap-3 min-w-0">
            <button
              className="btn btn-ghost !p-1.5 text-ink-2 hover:text-ink-1"
              onClick={toggleSidebar}
              title={sidebarOpen ? '收起会话列表' : '展开会话列表'}
            >
              {sidebarOpen ? <PanelLeftClose size={15} /> : <PanelLeftOpen size={15} />}
            </button>
            <h1 className="flex items-center gap-2 text-[15px] font-bold truncate text-ink-1">
              <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-accent text-white shadow-xs shrink-0">
                <Bot size={14} />
              </span>
              <span className="truncate">
                {sessions.find((s) => s.id === activeSessionId)?.title || '智能对话'}
              </span>
              {!hasAgentApi && (
                <span className="rounded-full bg-danger/10 px-2 py-0.5 text-[10px] font-normal text-danger shrink-0">未设 Key</span>
              )}
              {fileDoc && <span className="chip max-w-[160px] truncate">{fileDoc.name}</span>}
            </h1>
          </div>

          <div className="flex items-center gap-3">
            {/* ⚡ 极速 vs 🧠 深度思考 模式切换 */}
            <div className="flex items-center bg-black/5 dark:bg-white/5 p-0.5 rounded-xl border border-line/60">
              <button
                className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-[11px] font-semibold transition ${
                  agentMode === 'fast'
                    ? 'bg-accent text-white shadow-xs'
                    : 'text-ink-3 hover:text-ink-1'
                }`}
                onClick={() => setAgentMode('fast')}
                title="极速模式：快速响应、轻量直出、秒级工具调用"
              >
                <Zap size={12} className={agentMode === 'fast' ? 'text-amber-300' : ''} />
                <span>极速</span>
              </button>
              <button
                className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-[11px] font-semibold transition ${
                  agentMode === 'deep'
                    ? 'bg-purple-600 text-white shadow-xs'
                    : 'text-ink-3 hover:text-ink-1'
                }`}
                onClick={() => setAgentMode('deep')}
                title="深度思考模式：启用多维推理链（CoT），展示深度推导与长难句/审稿精析"
              >
                <Brain size={12} className={agentMode === 'deep' ? 'text-purple-200' : ''} />
                <span>深度思考</span>
              </button>
            </div>

            <button
              className="btn btn-ghost !px-2.5 !py-1 text-[11px] text-ink-2 hover:text-ink-1 flex items-center gap-1.5 border border-line rounded-lg"
              onClick={() => {
                clear()
                toast('success', '已清空当前对话')
              }}
              title="清空当前对话"
            >
              <Trash2 size={13} />
              <span>清空</span>
            </button>
          </div>
        </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto p-5">
        <div className="mx-auto max-w-2xl space-y-3">
          {!messages.length ? (
            <>
              <EmptyState
                icon={Bot}
                title="Academic Lens 智能副驾已就绪"
                hint={`随时为您解答学术疑难、拆解考研长难句、批改雅思作文，或直接帮您操控软件翻译、管理生词本与导出文件。\n支持「⚡ 极速」直出与「🧠 深度思考」推理双模态自由切换。`}
              />
              {!hasAgentApi && (
                <div className="flex justify-center pt-1">
                  <button className="btn btn-primary !px-4 !py-2 text-[12px]" onClick={() => go('settings')}>
                    <Settings size={12} /> 去设置配置智能体
                  </button>
                </div>
              )}
            </>
          ) : (
            messages.map((m) => (
              <div key={m.id} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
                <div
                  className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 ${
                    m.role === 'user'
                      ? 'rounded-br-sm bg-accent text-white'
                      : 'card rounded-bl-sm'
                  }`}
                >
                  {m.role === 'assistant' && m.subAgentName && (
                    <div className="mb-1.5 flex items-center gap-1">
                      <span
                        className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium"
                        style={{
                          backgroundColor: `${m.subAgentColor || '#3b82f6'}15`,
                          color: m.subAgentColor || '#3b82f6',
                          border: `1px solid ${m.subAgentColor || '#3b82f6'}30`
                        }}
                      >
                        <Bot size={10} />
                        {m.subAgentName} · {m.subAgentBadge}
                      </span>
                    </div>
                  )}

                  {/* 深度思考过程（可折叠） */}
                  {m.thinking && (
                    <details className="mb-3 rounded-xl border border-purple-500/20 bg-purple-500/5 p-3 text-[12px] text-ink-2 group" open={false}>
                      <summary className="cursor-pointer font-medium text-purple-600 dark:text-purple-400 hover:text-purple-700 flex items-center justify-between select-none">
                        <span className="flex items-center gap-1.5 font-semibold text-[11px]">
                          <Brain size={13} />
                          <span>🧠 深度思考推理过程</span>
                        </span>
                        <span className="text-[10px] opacity-70">点击展开/折叠</span>
                      </summary>
                      <div className="mt-2.5 text-ink-2 text-[11px] leading-relaxed whitespace-pre-wrap font-mono border-t border-purple-500/20 pt-2 bg-black/[0.02] dark:bg-white/[0.02] p-2 rounded-lg">
                        {m.thinking}
                      </div>
                    </details>
                  )}

                  {m.label && (
                    <span className="mb-1 flex items-center gap-1 text-[10px] text-ink-3">
                      <Wrench size={10} className={m.role === 'tool' ? 'text-accent' : ''} />
                      {m.label}
                    </span>
                  )}
                  {m.role === 'user' && m.refs?.length ? (
                    <span className="mb-1 block text-[10px] text-ink-2 opacity-70">引用：{m.refs.join('、')}</span>
                  ) : null}
                  {m.role === 'tool' && !m.label && <span className="mb-1 block text-[10px] text-ink-3">思考中…</span>}
                  {m.role === 'user' ? (
                    <p className={`whitespace-pre-wrap text-[13px] leading-relaxed ${streaming && m.id === messages[messages.length - 1].id ? 'stream-caret' : ''}`}>
                      {m.content || '…'}
                    </p>
                  ) : (
                    <div
                      className={`md-body !text-[13px] ${m.role === 'tool' && !m.label ? 'opacity-60' : ''}`}
                      dangerouslySetInnerHTML={{ __html: sanitizeHtml(marked.parse(m.content || '…', { async: false }) as string) }}
                    />
                  )}
                  {m.error && <p className="mt-1 text-[10px] text-danger">{m.error}</p>}
                  {!m.error && pendingConfirm?.msgId === m.id && (
                    <div className="mt-2 flex items-center gap-2">
                      <button
                        className="btn btn-primary !px-3 !py-1 text-[11px]"
                        disabled={streaming}
                        onClick={() => answerConfirm(true)}
                      >
                        确认执行
                      </button>
                      <button
                        className="btn btn-ghost !px-3 !py-1 text-[11px]"
                        disabled={streaming}
                        onClick={() => answerConfirm(false)}
                      >
                        取消
                      </button>
                    </div>
                  )}
                  {m.followUps && m.followUps.length > 0 && (
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <span className="text-[10px] text-ink-3">接着：</span>
                      {m.followUps.map((f) => (
                        <button
                          key={f}
                          className="chip cursor-pointer transition hover:brightness-95"
                          onClick={() => {
                            // 特殊续做：跨视图动作直接精准直达，其余交给智能体决策
                            if (f === '去阅读页做完整测验') {
                              useFileStore.getState().openQuiz()
                              go('bilingual')
                              return
                            }
                            if (f === '去润色页继续编辑' || f === '去学术润色继续编辑') {
                              go('polish')
                              return
                            }
                            if (f === '去来做学术工作台精读' || f === '回到文献阅读') {
                              go('bilingual')
                              return
                            }
                            if (f === '去来做学术工作台查看') {
                              go('research')
                              return
                            }
                            if (f === '去句型库查看' || f === '查找相关的引言句型' || f === '查找结果讨论句型') {
                              go('phrasebank')
                              return
                            }
                            send(f)
                          }}
                        >
                          {f}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))
          )}

          {!messages.length && (
            <>
              <div className="grid grid-cols-2 gap-2 pt-1">
                {QUICK_PROMPTS.map((q) => {
                  const Icon = q.icon
                  return (
                    <button
                      key={q.prompt}
                      className="btn group justify-start !py-2 text-left text-[12px]"
                      onClick={() => {
                        useAgentStore.getState().setInput(q.prompt)
                        useAgentStore.getState().send(q.prompt)
                      }}
                    >
                      <Icon size={11} className="shrink-0 text-accent" />
                      {q.label}
                    </button>
                  )
                })}
              </div>
              <p className="pt-1 text-center text-[10px] text-ink-3">
                也可以直接说：「帮我核查这段话是否靠谱」「设置目标为通过六级」……
              </p>
            </>
          )}
        </div>
      </div>

      <div className="shrink-0 border-t border-line p-3">
        {dueCount > 0 && (
          <div className="mx-auto mb-2 flex max-w-2xl items-center justify-between gap-2 rounded-lg border border-accent/30 bg-accent-soft/60 px-3 py-1.5">
            <span className="text-[11px] text-accent">有 {dueCount} 个单词到复习期</span>
            <button className="btn btn-ghost !px-2 !py-0.5 text-[10px]" onClick={() => go('flashcard')}>
              去复习
            </button>
          </div>
        )}
        {(wordbookWords.length > 0 || fileDoc) && (
          <div className="mx-auto mb-2 flex max-w-2xl flex-wrap items-center gap-1">
            {fileDoc && (
              <span className="flex items-center gap-0.5 text-[10px] text-ink-3">
                <TerminalSquare size={10} className="text-accent" />
              </span>
            )}
            {fileDoc && DOC_QUICK_CMDS.map((c) => (
              <button key={c} className="chip cursor-pointer transition hover:brightness-95" onClick={() => appendInput(c)}>
                {c}
              </button>
            ))}
            {wordbookWords.length > 0 && (
              <>
                <span className="ml-1 flex items-center gap-0.5 text-[10px] text-ink-3">
                  <BookOpen size={10} className="text-accent" /> 生词本（{wordbookWords.length}）
                </span>
                {wordbookWords.slice(0, 10).map((w) => (
                  <button
                    key={w.id}
                    className="chip max-w-[110px] cursor-pointer truncate transition hover:brightness-95"
                    title={w.definition}
                    onClick={() => appendInput(w.word)}
                  >
                    {w.word}
                  </button>
                ))}
              </>
            )}
          </div>
        )}
        <div className="relative mx-auto flex max-w-2xl items-end gap-2">
          <button
            className="btn relative z-10 font-mono !p-2.5"
            onClick={() => void handleUpload()}
            title="上传文档（PDF/DOCX/TXT/MD）或图片，自动识别并跳转翻译视图"
          >
            <Paperclip size={13} />
          </button>
          <button
            className="btn relative z-10 !p-2.5"
            onClick={() => setSkillsOpen((v) => !v)}
            title="查看可用技能与工具"
          >
            {skillsOpen ? <X size={13} /> : <Plus size={13} />}
          </button>
          <textarea
            className="input min-h-[44px] flex-1 resize-none"
            rows={1}
            placeholder={fileDoc ? '问点什么，或 @段落号 引用原文…' : '用一句话让我帮你做事…'}
            value={input}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                if (streaming) stop()
                else send()
              }
            }}
            onChange={(e) => setInput(e.target.value)}
          />
          {streaming ? (
            <button className="btn font-medium" onClick={stop}>
              <Square size={12} /> 停止
            </button>
          ) : (
            <button className="btn btn-primary" disabled={!input.trim()} onClick={() => send()}>
              <Send size={12} />
            </button>
          )}

          {/* 技能 / 工具面板：按 6 类分门别类展示，点击填入示例指令 */}
          {skillsOpen && (
            <div className="absolute bottom-full left-0 z-20 mb-2 w-[min(92vw,480px)] rounded-xl border border-line bg-panel p-3 shadow-pop backdrop-blur-xl">
              <div className="mb-2 flex items-center justify-between">
                <span className="flex items-center gap-1 text-[11px] font-semibold text-ink-2">
                  <Wrench size={11} className="text-accent" /> 我能做什么 · 分门别类的技能与工具
                </span>
                <span className="text-[10px] text-ink-3">{TOOLS.length} 个内置工具</span>
              </div>
              <div className="max-h-[40vh] space-y-2.5 overflow-y-auto pr-1">
                {CATEGORY_ORDER.map((cat) => {
                  const group = TOOLS.filter((t) => t.category === cat)
                  if (!group.length) return null
                  return (
                    <div key={cat}>
                      <div className="mb-1 flex items-center gap-1.5">
                        <span className="rounded bg-accent-soft px-1.5 py-0.5 text-[10px] font-medium text-accent">{cat}</span>
                        <span className="h-px flex-1 bg-line" />
                      </div>
                      <div className="grid grid-cols-2 gap-1.5">
                        {group.map((t) => {
                          const example = SKILL_EXAMPLES[t.id]
                          const st = skillState(t.id)
                          const instant = INSTANT_SKILLS.has(t.id)
                          const tip = st.disabled
                            ? st.reason
                            : instant
                              ? `点击「${t.name}」立即执行`
                              : st.reason
                                ? `点击填入输入框（${st.reason}）`
                                : `点击填入输入框，编辑后回车执行`
                          return (
                            <button
                              key={t.id}
                              disabled={st.disabled}
                              className={`flex flex-col items-start gap-0.5 rounded-lg border px-2 py-1.5 text-left transition ${
                                st.disabled
                                  ? 'cursor-not-allowed border-line/40 opacity-45'
                                  : 'border-line/60 hover:border-accent/60 hover:bg-accent-soft/40'
                              }`}
                              title={tip}
                              onClick={() => {
                                if (st.disabled) return
                                if (instant) useAgentStore.getState().send(example ?? `帮我${t.name}`)
                                else setInput(example ?? `帮我${t.name}`)
                                setSkillsOpen(false)
                              }}
                            >
                              <span className="flex items-center gap-1 text-[11px] font-medium text-ink-1">
                                {t.name}
                                {instant && <span className="rounded bg-ok/15 px-1 text-[9px] text-ok">即时</span>}
                                {!instant && t.sideEffect && <span className="rounded bg-warning/15 px-1 text-[9px] text-warning">改数据</span>}
                              </span>
                              <span className="line-clamp-1 text-[10px] text-ink-3">{st.reason || t.desc}</span>
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
              </div>
               <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 border-t border-line/60 pt-2 text-[9px] text-ink-3">
                 <span className="flex items-center gap-1"><span className="rounded bg-ok/15 px-1 text-ok">即时</span>点一下就执行</span>
                 <span className="flex items-center gap-1"><span className="rounded bg-warning/15 px-1 text-warning">改数据</span>会改动数据或界面</span>
                 <span className="flex items-center gap-1 opacity-60">置灰=受当前环境限制（未打开文档 / 生词本为空等）</span>
               </div>
             </div>
           )}
         </div>
        <div className="mx-auto mt-1.5 flex max-w-2xl items-center justify-between text-[10px] text-ink-3">
          <span>翻译等重型任务仍走主 API；智能体用免费 GLM-4-flash 编排轻量操作。</span>
          {!hasAgentApi && (
            <button className="text-accent hover:underline" onClick={() => go('settings')}>去配置</button>
          )}
        </div>
      </div>
    </div>
  </div>
  )
}