import { useEffect, useRef, useState } from 'react'
import {
  Bot, Send, Square, Trash2, Wrench, ShieldCheck,
  BookOpen, FileText, BadgeCheck, User, Settings, Monitor, TerminalSquare, Plus, X, Paperclip
} from 'lucide-react'
import { marked } from 'marked'
import { sanitizeHtml } from '../lib/sanitize'
import { useAgentStore, DOC_QUICK_CMDS } from '../stores/agentStore'
import { useAppStore } from '../stores/appStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useFileStore } from '../stores/fileStore'
import { useWordbookStore } from '../stores/wordbookStore'
import { toast } from '../stores/noticeStore'
import { parseAnyFile, makeSegment } from '../lib/parse'
import { recognizeClipboardImage } from '../lib/ocr'
import { TOOLS, type ToolId, type ToolCategory } from '../lib/agentTools'
import EmptyState from './EmptyState'

/** 按 6 类工具组织的快捷入口，方便用户发现能力 */
const QUICK_PROMPTS: { icon: typeof Bot; label: string; prompt: string }[] = [
  { icon: BookOpen, label: '查个单词', prompt: '查一下单词 resilience' },
  { icon: FileText, label: '总结当前文档', prompt: '总结当前文档' },
  { icon: BadgeCheck, label: '生成学情周报', prompt: '帮我生成学情周报' },
  { icon: Settings, label: '生词本概览', prompt: '看看生词本怎么样' },
  { icon: Monitor, label: '今天要复习的词', prompt: '今天有哪些词到期要复习？' },
  { icon: User, label: '设置学习目标', prompt: '我的学习目标是想通过四级' }
]

/** 分类面板展示顺序与标题（固定，不随 TOOLS 定义漂移） */
const CATEGORY_ORDER: ToolCategory[] = ['学习', '项目', '审查核实', '个性化', '设置', '端侧操作']

/** 每个工具点选后填入输入框的示例指令（可再编辑后回车执行） */
const SKILL_EXAMPLES: Partial<Record<ToolId, string>> = {
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
  navigate: '跳转到闪卡页面',
  set_lookup_source: '切换为词典优先（uapis）查词',
  wordbook_add: '把单词 ubiquitous 加入生词本',
  wordbook_summary: '看看生词本的概览和掌握情况',
  wordbook_due: '今天有哪些词到期要复习？',
  wordbook_list: '列出生词本前 10 个词',
  speak: '朗读一下单词 meticulous',
  open_external: '打开链接 https://example.com',
  history_search: '查找之前《独立宣言》的译文'
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
  'wordbook_list'
])

export default function AgentView(): React.JSX.Element {
  const messages = useAgentStore((s) => s.messages)
  const streaming = useAgentStore((s) => s.streaming)
  const input = useAgentStore((s) => s.input)
  const setInput = useAgentStore((s) => s.setInput)
  const send = useAgentStore((s) => s.send)
  const stop = useAgentStore((s) => s.stop)
  const clear = useAgentStore((s) => s.clear)
  const hasAgentApi = useAgentStore((s) => s.hasAgentApi)
  const go = useAppStore((s) => s.go)
  const agentApiKey = useSettingsStore((s) => s.settings.agentApiKey)
  const dictApiKey = useSettingsStore((s) => s.settings.dictApiKey)
  const fileDoc = useFileStore((s) => s.doc)
  const wordbookWords = useWordbookStore((s) => s.words)
  const appendInput = useAgentStore((s) => s.appendInput)
  const [skillsOpen, setSkillsOpen] = useState(false)

  /** 技能可用性：依据当前环境（文档是否打开 / 生词本是否为空 / 词典 Key 等）判定并给出人性化原因 */
  const skillState = (toolId: ToolId): { disabled: boolean; reason?: string } => {
    switch (toolId) {
      case 'doc_context':
      case 'doc_summarize':
      case 'doc_unknown':
      case 'doc_export':
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

  /** 「#」上传：解析文档或 OCR 图片 → 载入 fileStore → 跳转原生翻译视图 */
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
        } else {
          const segs = await parseAnyFile(name, data)
          if (!segs.length) {
            toast('warning', '文档未解析到内容，请检查文件', name)
            continue
          }
          useFileStore.getState().setDoc({ name, size: data.byteLength }, segs)
        }
        useAppStore.getState().go('home')
        toast('success', `已载入《${name}》；也可回到对话追问总结 / 翻译 / 生词`, '已上传')
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
    <div className="flex h-full flex-col">
      <div className="glass flex shrink-0 items-center justify-between border-b px-5 py-3">
        <h1 className="flex items-center gap-2 text-[17px] font-semibold">
          <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-accent-soft text-accent">
            <Bot size={14} />
          </span>
          智能体
          <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[10px] font-normal text-accent">
            GLM-4-flash · 免费
          </span>
          {!hasAgentApi && (
            <span className="rounded-full bg-danger/10 px-2 py-0.5 text-[10px] font-normal text-danger">未配置 Key</span>
          )}
          {fileDoc && <span className="chip max-w-[200px] truncate">{fileDoc.name}</span>}
        </h1>
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1 text-[10px] text-ink-3" title="决策边界：仅白名单工具，参数受限">
            <ShieldCheck size={11} className="text-ok" /> 工具受限
          </span>
          <button className="btn btn-ghost !p-1.5" onClick={clear} disabled={!messages.length} title="清空对话">
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto p-5">
        <div className="mx-auto max-w-2xl space-y-3">
          {!messages.length ? (
            <EmptyState
              icon={Bot}
              title="你好，我可以用一句话帮你做事"
              hint={`我能：查词分级、整理生词、总结文档、导出生词命中、生成周报与核查、设目标、跳转页面、切换查词、朗读、打开链接。\n若未配置，请先到「设置 → 智能体」填入 GLM-4-flash API Key。`}
            />
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
  )
}