import { useMemo, useState } from 'react'
import { Copy, Download, Play, Star, Sparkles } from 'lucide-react'
import type { Segment } from '../lib/types'
import { buildPlainText, buildPlainTextHeader } from '../lib/exportText'
import { useFileStore } from '../stores/fileStore'

export default function CnView(props: { segments: Segment[] }): React.JSX.Element {
  const doc = useFileStore((s) => s.doc)
  const translateAll = useFileStore((s) => s.translateAll)
  const translating = props.segments.some((s) => s.translating)
  const [copied, setCopied] = useState(false)
  const [exported, setExported] = useState(false)

  const untranslated = useMemo(
    () => props.segments.filter((s) => !s.translation && !s.translating).length,
    [props.segments]
  )

  const copyAll = async (): Promise<void> => {
    await navigator.clipboard.writeText(buildPlainText(props.segments))
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const exportText = async (): Promise<void> => {
    if (!doc) return
    const md = buildPlainTextHeader(doc, props.segments)
    const base = doc.name.replace(/\.[^.]+$/, '')
    const path = await window.bridge.saveFile({
      defaultPath: `${base}-中文译文.md`,
      data: md,
      filters: [
        { name: 'Markdown', extensions: ['md'] },
        { name: '纯文本', extensions: ['txt'] }
      ]
    })
    if (path) {
      setExported(true)
      setTimeout(() => setExported(false), 2000)
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="chip">
            <Sparkles size={10} /> 中文译文
          </span>
          {untranslated > 0 && (
            <span className="text-[11px] text-ink-3">{untranslated} 段待翻译</span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {!translating && untranslated > 0 && (
            <button className="btn !px-3 !py-1.5 text-[12px]" onClick={translateAll}>
              <Play size={11} /> 翻译全部
            </button>
          )}
          <button className="btn !px-3 !py-1.5 text-[12px]" onClick={() => void copyAll()}>
            {copied ? <Star size={11} className="text-star" /> : <Copy size={11} />}
            {copied ? '已复制' : '复制译文'}
          </button>
          <button className="btn !px-3 !py-1.5 text-[12px]" onClick={() => void exportText()}>
            {exported ? <Star size={11} className="text-star" /> : <Download size={11} />}
            {exported ? '已导出' : '导出译文'}
          </button>
        </div>
      </div>

      <div className="card animate-float-in p-6">
        <h1 className="border-b border-line pb-3 text-[17px] font-semibold">{doc?.name}</h1>
        <div className="space-y-4 pt-4">
          {props.segments.map((s) => {
            const content = s.translation || s.text
            const missing = !s.translation
            return (
              <div key={s.id}>
                {s.type === 'h' ? (
                  <h2 className="text-[15px] font-semibold">{content}</h2>
                ) : (
                  <p className={`text-[14px] leading-relaxed ${missing ? 'text-ink-3' : 'text-ink-1'} ${s.translating ? 'stream-caret' : ''}`}>
                    {s.translating && !s.translation ? '翻译中…' : content}
                  </p>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
