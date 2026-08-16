import { useEffect, useRef } from 'react'
import { PanelRightClose, Send, Square, Trash2 } from 'lucide-react'
import { useChatStore } from '../stores/chatStore'
import { useAppStore } from '../stores/appStore'
import { marked } from 'marked'
import { sanitizeHtml } from '../lib/sanitize'
import { useFileStore } from '../stores/fileStore'

const QUICK_CMDS = ['/总结', '/翻译', '/解释术语', '/推导公式', '/出题']

export default function AssistantPanel(): React.JSX.Element {
  const messages = useChatStore((s) => s.messages)
  const streaming = useChatStore((s) => s.streaming)
  const streamingId = useChatStore((s) => s.streamingId)
  const send = useChatStore((s) => s.send)
  const stop = useChatStore((s) => s.stop)
  const clear = useChatStore((s) => s.clear)
  const input = useChatStore((s) => s.input)
  const setInput = useChatStore((s) => s.setInput)
  const setAssistant = useAppStore((s) => s.setAssistant)
  const fileDoc = useFileStore((s) => s.doc)

  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [messages, streaming])

  const submit = (): void => {
    if (!input.trim()) return
    send()
  }

  return (
    <aside className="glass flex w-[320px] shrink-0 flex-col border-l">
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-line px-3">
        <span className="flex items-center gap-2 text-[13px] font-semibold">
          AI 学术助手
          {fileDoc && <span className="chip max-w-[140px] truncate">{fileDoc.name}</span>}
        </span>
        <div className="flex items-center gap-1">
          <button className="btn btn-ghost !p-1.5" onClick={clear} title="清空对话">
            <Trash2 size={14} />
          </button>
          <button className="btn btn-ghost !p-1.5" onClick={() => setAssistant(false)} title="收起">
            <PanelRightClose size={14} />
          </button>
        </div>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {!messages.length && (
          <div className="pt-8 text-center text-[12px] leading-relaxed text-ink-3">
            打开文件后，可问「第 3 页的 v 是什么意思」
            <br />
            或使用 <code className="rounded bg-surface px-1">@段落号</code> 引用原文
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={m.role === 'user' ? 'text-right' : 'text-left'}>
            {m.role === 'user' ? (
              <div className="inline-block max-w-[85%] rounded-2xl rounded-br-md bg-accent px-3.5 py-2.5 text-left text-[13px] leading-relaxed text-white select-text">
                {m.content}
                {m.refs?.length ? (
                  <div className="mt-1 text-[10px] opacity-70">引用：{m.refs.join('、')}</div>
                ) : null}
              </div>
            ) : m.error ? (
              <div className="inline-block max-w-[90%] rounded-2xl rounded-bl-md border border-danger/30 bg-danger/10 px-3.5 py-2.5 text-left text-[12px] text-danger">
                {m.error}
              </div>
            ) : (
              <div
                className={`card inline-block max-w-[90%] rounded-2xl rounded-bl-md px-3.5 py-2.5 text-left ${
                  streaming && m.id === streamingId ? 'stream-caret' : ''
                }`}
              >
                <div
                  className="md-body !text-[13px]"
                  dangerouslySetInnerHTML={{ __html: sanitizeHtml(marked.parse(m.content || '…', { async: false }) as string) }}
                />
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="shrink-0 border-t border-line p-3">
        {fileDoc && (
          <div className="mb-2 flex flex-wrap gap-1">
            {QUICK_CMDS.map((c) => (
              <button
                key={c}
                className="chip cursor-pointer transition hover:brightness-95"
                onClick={() => setInput(c + ' ')}
              >
                {c}
              </button>
            ))}
          </div>
        )}
        <div className="flex items-end gap-2">
          <textarea
            className="input max-h-32 min-h-[40px] resize-none !rounded-2xl"
            rows={1}
            placeholder={fileDoc ? '问点什么，或 @段落号 引用原文…' : '打开文件后可基于文档提问'}
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
            <button className="btn btn-primary !p-2.5" onClick={stop} title="停止">
              <Square size={14} />
            </button>
          ) : (
            <button className="btn btn-primary !p-2.5" onClick={submit} disabled={!input.trim()} title="发送">
              <Send size={14} />
            </button>
          )}
        </div>
        <p className="mt-1.5 text-[10px] text-ink-3">Enter 发送 · Shift+Enter 换行</p>
      </div>
    </aside>
  )
}
