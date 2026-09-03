import React, { useEffect, useRef, useState } from 'react'
import {
  PanelRightClose,
  Send,
  Square,
  Trash2,
  Sparkles,
  Zap,
  Wrench,
  Bot,
  Paperclip,
  Brain,
  CheckCircle2
} from 'lucide-react'
import { useAgentStore } from '../stores/agentStore'
import { useAppStore } from '../stores/appStore'
import { useFileStore } from '../stores/fileStore'
import { useSettingsStore } from '../stores/settingsStore'
import { TOOLS, type ToolId } from '../lib/agentTools'
import { parseAnyFile } from '../lib/parse'
import { recognizeClipboardImage } from '../lib/ocr'
import { isSupported } from '../lib/types'
import { renderLatexInText } from '../lib/renderLatex'
import { marked } from 'marked'
import { sanitizeHtml } from '../lib/sanitize'

const QUICK_CMDS = ['/总结全文', '/翻译段落', '/长难句分析', '/论文润色', '/公式推导']

/**
 * 把模型输出中的段落引用标记统一转成占位符，Markdown 渲染后再还原为可点击芯片：
 * 支持 【P12】 / 【段落 12】 / ¶12 三种写法。
 */
function protectCitations(content: string): string {
  return content
    .replace(/【P\s*(\d+)】/g, '%%P$1%%')
    .replace(/【段落\s*(\d+)】/g, '%%P$1%%')
    .replace(/¶\s*(\d+)/g, '%%P$1%%')
}

const CITE_CHIP_RE = /%%P(\d+)%%/g

function toChips(html: string): string {
  return html.replace(
    CITE_CHIP_RE,
    (_m, n: string) =>
      `<span class="cite-chip mx-0.5 inline-flex items-baseline rounded bg-accent-soft px-1.5 align-baseline text-[11px] font-semibold text-accent cursor-pointer select-none" data-para="${n}" role="button" title="跳转到原文第 ${n} 段">¶ ${n}</span>`
  )
}

const SKILL_EXAMPLES: Partial<Record<ToolId, string>> = {
  navigate: '跳转到生词本',
  start_translation: '开始翻译当前文档',
  stop_translation: '停止文档翻译',
  set_domain_preset: '将翻译领域设为计算机科学',
  wordbook_add: '将 ubiquitous 存入生词本',
  wordbook_remove: '从生词本中删除 ephemeral',
  import_exam_words: '从考研词库导入 5 个高频词',
  export_wordbook: '将生词本导出为 Markdown 表格',
  wordbook_query: '在考研词库中查 address 的考点与搭配',
  doc_summarize: '为当前文档生成摘要',
  doc_export: '将双语对照导出为 Markdown',
  doc_extract_terms: '提取本文专业术语存入生词本',
  set_theme: '切换为深色模式',
  speak: '朗读单词 paradigm'
}

export default function AssistantPanel(): React.JSX.Element {
  const messages = useAgentStore((s) => s.messages)
  const streaming = useAgentStore((s) => s.streaming)
  const reasoningMode = useAgentStore((s) => s.reasoningMode)
  const setReasoningMode = useAgentStore((s) => s.setReasoningMode)
  const send = useAgentStore((s) => s.send)
  const stop = useAgentStore((s) => s.stop)
  const clear = useAgentStore((s) => s.clear)
  const input = useAgentStore((s) => s.input)
  const setInput = useAgentStore((s) => s.setInput)
  const setAssistant = useAppStore((s) => s.setAssistant)
  const go = useAppStore((s) => s.go)
  const setDoc = useFileStore((s) => s.setDoc)
  const primaryModel = useSettingsStore((s) => s.settings.model)

  const [skillsOpen, setSkillsOpen] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, streaming])

  const submit = (): void => {
    if (!input.trim()) return
    send()
  }

  /** 点击回答里的段落引用芯片 → 切回文档视图并滚动定位到对应段落 */
  const jumpFromChip = (e: React.MouseEvent): void => {
    const target = e.target as HTMLElement
    const chip = target.closest?.('[data-para]') as HTMLElement | null
    if (!chip) return
    const para = Number(chip.dataset.para)
    if (!Number.isFinite(para) || para < 1) return
    const fs = useFileStore.getState()
    if (!fs.doc || para > fs.segments.length) return
    useAppStore.getState().go('home')
    fs.locateParagraph(para)
  }

  const handleUpload = async (): Promise<void> => {
    const paths = await window.bridge.openFiles()
    for (const p of paths) {
      const name = p.split(/[\\/]/).pop() ?? p
      const ext = name.split('.').pop()?.toLowerCase() ?? ''
      if (['png', 'jpg', 'jpeg'].includes(ext)) {
        try {
          const raw = await window.bridge.readFile(p)
          const blob = new Blob([raw.buffer as ArrayBuffer], { type: `image/${ext === 'jpg' ? 'jpeg' : ext}` })
          const { lines } = await recognizeClipboardImage(blob)
          if (lines.length) {
            const segs = lines.map((l) => ({
              id: `ocr_${Date.now()}_${Math.random()}`,
              type: 'p' as const,
              text: l,
              block: { kind: 'paragraph' as const, runs: [{ text: l }] },
              translation: '',
              translating: false
            }))
            setDoc({ name, size: raw.byteLength }, segs)
            go('home')
            return
          }
        } catch {
          /* 忽略单张失败 */
        }
      } else if (isSupported(name)) {
        try {
          const data = await window.bridge.readFile(p)
          const segs = await parseAnyFile(name, data)
          setDoc({ name, size: data.byteLength }, segs)
          go('home')
          return
        } catch {
          /* 忽略单文件失败 */
        }
      }
    }
  }

  return (
    <aside className="relative flex h-full w-[340px] xl:w-[380px] max-w-[40vw] min-w-[280px] shrink-0 flex-col border-l border-line bg-surface/90 backdrop-blur-md transition-all select-none">
      {/* 头部标题与控制栏 */}
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-line px-3 gap-2 min-w-0">
        <div className="flex items-center gap-1.5 shrink-0">
          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-accent-soft text-accent">
            <Sparkles size={13} strokeWidth={1.5} />
          </div>
          <span className="text-[13px] font-semibold text-ink-1 hidden sm:inline">AI 助手</span>
        </div>

        {/* 极速 / 深度思考双引擎切换 */}
        <div className="flex items-center gap-0.5 rounded-lg bg-surface/80 p-0.5 border border-line shrink-0">
          <button
            className={`flex items-center gap-1 px-2 py-0.5 rounded-md text-[10.5px] font-medium transition cursor-pointer ${
              reasoningMode === 'fast'
                ? 'bg-accent text-white shadow-xs'
                : 'text-ink-3 hover:text-ink-1'
            }`}
            onClick={() => setReasoningMode('fast')}
            title="极速模式（GLM-4-Flash · 免费）"
          >
            <Zap size={10} strokeWidth={1.5} /> 极速
          </button>
          <button
            className={`flex items-center gap-1 px-2 py-0.5 rounded-md text-[10.5px] font-medium transition cursor-pointer ${
              reasoningMode === 'deep'
                ? 'bg-accent text-white shadow-xs'
                : 'text-ink-3 hover:text-ink-1'
            }`}
            onClick={() => setReasoningMode('deep')}
            title={`深度推理模式（使用 ${primaryModel || '主模型'}）`}
          >
            <Brain size={10} strokeWidth={1.5} /> 深度思考
          </button>
        </div>

        <div className="flex items-center gap-1">
          <button
            className="btn btn-ghost !p-1.5 text-ink-3 hover:text-accent"
            onClick={() => setSkillsOpen(!skillsOpen)}
            title="查看助手支持的操作权限"
          >
            <Wrench size={14} strokeWidth={1.5} className={skillsOpen ? 'text-accent' : ''} />
          </button>
          <button
            className="btn btn-ghost !p-1.5 text-ink-3 hover:text-ink-1"
            onClick={clear}
            title="清空对话"
          >
            <Trash2 size={14} strokeWidth={1.5} />
          </button>
          <button
            className="btn btn-ghost !p-1.5 text-ink-3 hover:text-ink-1"
            onClick={() => setAssistant(false)}
            title="关闭侧边栏"
          >
            <PanelRightClose size={14} strokeWidth={1.5} />
          </button>
        </div>
      </div>

      {/* 软件权限与技能面板抽屉 */}
      {skillsOpen && (
        <div className="border-b border-line bg-surface/95 p-3 text-[12px] shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <span className="font-semibold text-ink-1 flex items-center gap-1.5">
              <CheckCircle2 size={13} strokeWidth={1.5} className="text-ok" /> 助手具备的系统操作权限
            </span>
            <button
              className="text-ink-3 hover:text-ink-1 text-[11px]"
              onClick={() => setSkillsOpen(false)}
            >
              收起
            </button>
          </div>
          <div className="max-h-48 overflow-y-auto space-y-1.5 pr-1">
            {TOOLS.map((t) => (
              <div
                key={t.id}
                className="flex items-start justify-between gap-2 rounded-lg bg-surface/60 p-2 border border-line/60 hover:border-accent/30 cursor-pointer transition"
                onClick={() => {
                  const eg = SKILL_EXAMPLES[t.id] ?? `执行 ${t.name}`
                  setInput(eg)
                  setSkillsOpen(false)
                }}
              >
                <div>
                  <div className="flex items-center gap-1.5">
                    <span className="font-medium text-ink-1 text-[11.5px]">{t.name}</span>
                    <span className="chip !text-[9px] !px-1.5 !py-0">{t.category}</span>
                  </div>
                  <p className="text-[10.5px] text-ink-3 leading-tight mt-0.5">{t.desc}</p>
                </div>
                <span className="text-[10.5px] text-accent shrink-0 mt-0.5">填入 ↗</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 消息历史滚动区 */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3.5 space-y-3">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center p-4 select-none">
            <div className="mb-2 text-ink-3/70">
              <Bot size={28} strokeWidth={1.5} />
            </div>
            <h3 className="text-[14px] font-semibold text-ink-1">AI 助手</h3>
            <p className="text-[11.5px] text-ink-3 mt-1 max-w-[260px] leading-relaxed">
              随时解答学术疑难、长难句分析、论文润色，或直接协助管理生词本与导出文件。
              引用文档会以 ¶段落 标注，点击即可跳回原文定位；极速模式默认走免费 GLM。
            </p>
            <div className="mt-4 flex flex-wrap justify-center gap-1.5">
              {['帮我把考研高频词加入生词本', '把双语文档导出为 Markdown…', '切换到深色模式', '六级必备词库有多少词？'].map((prompt) => (
                <button
                  key={prompt}
                  className="rounded-lg bg-surface/80 px-2.5 py-1 text-[11px] text-ink-2 border border-line hover:border-accent/40 hover:text-accent transition text-left cursor-pointer"
                  onClick={() => setInput(prompt)}
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m) => {
            const isUser = m.role === 'user'
            const isTool = m.role === 'tool'

            if (isTool) {
              return (
                <div
                  key={m.id}
                  className="rounded-xl border border-line/60 bg-surface/40 p-2 text-[11px] text-ink-3 select-text"
                >
                  <div className="font-semibold text-ink-2 mb-0.5 flex items-center gap-1">
                    <Wrench size={10} strokeWidth={1.5} className="text-accent" /> {m.label || '系统操作'}
                  </div>
                  <p className="whitespace-pre-wrap font-mono text-[10.5px] text-ink-2">{m.content}</p>
                </div>
              )
            }

            return (
              <div
                key={m.id}
                className={`flex flex-col gap-1 ${isUser ? 'items-end' : 'items-start'}`}
              >
                {m.label && (
                  <span className="text-[10px] text-accent font-medium px-1">{m.label}</span>
                )}
                <div
                  className={`max-w-[90%] rounded-2xl px-3.5 py-2.5 text-[12.5px] leading-relaxed select-text shadow-xs ${
                    isUser
                      ? 'bg-accent text-white font-medium'
                      : 'bg-surface border border-line text-ink-1'
                  }`}
                  onClick={!isUser ? jumpFromChip : undefined}
                >
                  {isUser ? (
                    <p className="whitespace-pre-wrap break-words">{m.content}</p>
                  ) : m.content ? (
                    <div
                      className="prose prose-sm dark:prose-invert max-w-none text-[12.5px] leading-relaxed break-words"
                      dangerouslySetInnerHTML={{
                        __html: toChips(
                          sanitizeHtml(marked.parse(renderLatexInText(protectCitations(m.content))) as string)
                        )
                      }}
                    />
                  ) : (
                    <div className="flex items-center gap-2 text-ink-3">
                      <span className="inline-block h-2 w-2 rounded-full bg-accent animate-pulse" />
                      <span>{m.label || '正在思考…'}</span>
                    </div>
                  )}
                </div>
              </div>
            )
          })
        )}
      </div>

      {/* 底部快捷指令栏 */}
      <div className="flex shrink-0 items-center gap-1.5 overflow-x-auto px-3 py-1.5 border-t border-line/60 bg-surface/40 no-scrollbar">
        {QUICK_CMDS.map((cmd) => (
          <button
            key={cmd}
            className="shrink-0 rounded-md bg-surface px-2 py-0.5 text-[11px] text-ink-3 hover:text-accent hover:bg-surface/80 border border-line/60 transition cursor-pointer"
            onClick={() => setInput(`${cmd} `)}
          >
            {cmd}
          </button>
        ))}
      </div>

      {/* 底部输入框 */}
      <div className="border-t border-line p-3 bg-surface/90">
        <div className="relative flex items-end gap-1.5 rounded-xl border border-line bg-surface p-1.5 focus-within:border-accent/50 focus-within:ring-2 focus-within:ring-accent/15 transition-all shadow-xs">
          <button
            className="btn btn-ghost !p-1.5 text-ink-3 hover:text-accent"
            onClick={() => void handleUpload()}
            title="添加附件…"
          >
            <Paperclip size={14} strokeWidth={1.5} />
          </button>
          <textarea
            className="flex-1 max-h-24 min-h-[32px] resize-none bg-transparent px-2 py-1 text-[13px] text-ink-1 placeholder:text-ink-3 focus:outline-none leading-normal"
            placeholder={reasoningMode === 'deep' ? '深度推理：长难句分析 / 公式推导…' : '输入学术问题或操作指令…'}
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                submit()
              }
            }}
          />
          {streaming ? (
            <button
              className="flex h-7 w-7 items-center justify-center rounded-lg bg-danger text-white transition hover:opacity-90 cursor-pointer"
              onClick={stop}
              title="停止"
            >
              <Square size={12} strokeWidth={1.5} />
            </button>
          ) : (
            <button
              className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent text-white transition hover:opacity-90 disabled:opacity-40 cursor-pointer"
              disabled={!input.trim()}
              onClick={submit}
              title="发送"
            >
              <Send size={12} strokeWidth={1.5} />
            </button>
          )}
        </div>
      </div>
    </aside>
  )
}
