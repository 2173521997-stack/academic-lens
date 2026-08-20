import { useState, useCallback, useMemo } from 'react'
import {
  FolderKanban,
  FileText,
  Plus,
  Trash2,
  BookOpen,
  Feather,
  Image as ImageIcon,
  ChevronRight,
  ChevronLeft,
  UploadCloud,
  Check,
  Sparkles,
  MessageSquare,
  Copy,
  RefreshCw,
  Scale,
  Code,
  BookMarked
} from 'lucide-react'
import { marked } from 'marked'
import { sanitizeHtml } from '../lib/sanitize'
import { useProjectStore } from '../stores/projectStore'
import { useFileStore } from '../stores/fileStore'
import { useAgentStore } from '../stores/agentStore'
import { useAppStore } from '../stores/appStore'
import { parseAnyFile, makeSegment } from '../lib/parse'
import { recognizeClipboardImage } from '../lib/ocr'
import { isSupported } from '../lib/types'
import { toast } from '../stores/noticeStore'
import { generatePeerReview, generateCodeSkeleton } from '../lib/academicAdvanced'
import { generateBibTeX, generateAPA, generateIEEE, generateGBT7714 } from '../lib/citationGenerator'
import FileView from './FileView'
import PolishView from './PolishView'
import TextTranslateView from './TextTranslateView'
import ImageZoneView from './ImageZoneView'
import HomeView from './HomeView'

type ResearchTab = 'reader' | 'writing' | 'image'
type ReaderSubTab = 'bilingual' | 'summary' | 'review' | 'citation'
type WritingSubTab = 'polish' | 'translate'

export default function ResearchView(): React.JSX.Element {
  const projects = useProjectStore((s) => s.projects)
  const activeProjectId = useProjectStore((s) => s.activeProjectId)
  const activeDocId = useProjectStore((s) => s.activeDocId)
  const setActiveProject = useProjectStore((s) => s.setActiveProject)
  const setActiveDoc = useProjectStore((s) => s.setActiveDoc)
  const createProject = useProjectStore((s) => s.createProject)
  const removeProject = useProjectStore((s) => s.removeProject)
  const addDocToProject = useProjectStore((s) => s.addDocToProject)
  const removeDocFromProject = useProjectStore((s) => s.removeDocFromProject)
  const getActiveProject = useProjectStore((s) => s.getActiveProject)

  const curProject = getActiveProject()
  const doc = useFileStore((s) => s.doc)
  const setDoc = useFileStore((s) => s.setDoc)

  const [tab, setTab] = useState<ResearchTab>('reader')
  const [readerSubTab, setReaderSubTab] = useState<ReaderSubTab>('bilingual')
  const [writingSubTab, setWritingSubTab] = useState<WritingSubTab>('polish')
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [createModalOpen, setCreateModalOpen] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newTopic, setNewTopic] = useState('')
  const [newDesc, setNewDesc] = useState('')

  // 切换文档时自动载入到 fileStore
  const handleSelectDoc = useCallback(
    async (projectId: string, docId: string) => {
      setActiveProject(projectId)
      setActiveDoc(docId)
      const p = projects.find((it) => it.id === projectId)
      const targetDoc = p?.documents.find((it) => it.id === docId)
      if (targetDoc) {
        if (targetDoc.segments?.length) {
          setDoc(
            {
              name: targetDoc.name,
              size: targetDoc.size,
              path: targetDoc.path,
              rawBuffer: targetDoc.rawBuffer
            },
            targetDoc.segments
          )
        } else if (targetDoc.path) {
          try {
            const data = await window.bridge.readFile(targetDoc.path)
            const segs = await parseAnyFile(targetDoc.name, data)
            setDoc(
              {
                name: targetDoc.name,
                size: data.byteLength,
                path: targetDoc.path,
                rawBuffer: new Uint8Array(data)
              },
              segs
            )
          } catch {
            /* 忽略读取错误 */
          }
        }
      }
    },
    [projects, setActiveProject, setActiveDoc, setDoc]
  )

  // 导入文件到当前项目
  const handleImportDoc = useCallback(async () => {
    if (!curProject) {
      toast('warning', '请先选择或新建一个学术项目', '导入文献')
      return
    }
    const paths = await window.bridge.openFiles()
    for (const p of paths) {
      const name = p.split(/[\\/]/).pop() ?? p
      if (!isSupported(name)) continue
      try {
        const data = await window.bridge.readFile(p)
        const segs = await parseAnyFile(name, data)
        const raw = new Uint8Array(data)
        const added = addDocToProject(curProject.id, {
          name,
          size: data.byteLength,
          path: p,
          rawBuffer: raw,
          segments: segs
        })
        setDoc({ name, size: data.byteLength, path: p, rawBuffer: raw }, segs)
        setActiveDoc(added.id)
        toast('success', `已将《${name}》加入学术项目「${curProject.title}」`, '导入成功')
      } catch (err) {
        toast('danger', err instanceof Error ? err.message : String(err), '导入失败')
      }
    }
  }, [curProject, addDocToProject, setDoc, setActiveDoc])

  const handleImageFile = useCallback(
    async (file: Blob, name: string) => {
      try {
        const { lines } = await recognizeClipboardImage(file)
        if (!lines.length) {
          toast('warning', '未识别到文字，请换一张更清晰的图片', name)
          return
        }
        const segs = lines.map((l) => makeSegment('p', l))
        setDoc({ name, size: file.size }, segs)
        if (curProject) {
          addDocToProject(curProject.id, {
            name,
            size: file.size,
            segments: segs
          })
        }
        setTab('reader')
        toast('success', `图片《${name}》已识别并载入阅读器`, 'OCR 成功')
      } catch (err) {
        toast('danger', err instanceof Error ? err.message : String(err), 'OCR 识别失败')
      }
    },
    [curProject, addDocToProject, setDoc]
  )

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!newTitle.trim() || !newTopic.trim()) return
    const created = createProject({
      title: newTitle,
      topic: newTopic,
      description: newDesc
    })
    setNewTitle('')
    setNewTopic('')
    setNewDesc('')
    setCreateModalOpen(false)
    toast('success', `已创建学术项目「${created.title}」`, '项目已建立')
  }

  return (
    <div className="flex h-full w-full overflow-hidden bg-bg-app">
      {/* 左侧：学术项目与文献树 */}
      <aside
        className={`${
          sidebarOpen ? 'w-72' : 'w-0'
        } shrink-0 transition-all duration-300 ease-in-out relative border-r border-line bg-panel/60 backdrop-blur-xl flex flex-col overflow-hidden`}
      >
        <div className="p-3.5 border-b border-line flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-accent-soft text-accent">
              <FolderKanban size={14} />
            </span>
            <span className="text-[13px] font-semibold text-ink-1">学术项目管理</span>
          </div>
          <button
            className="btn btn-ghost !p-1.5 text-accent hover:bg-accent-soft"
            onClick={() => setCreateModalOpen(true)}
            title="新建学术项目"
          >
            <Plus size={14} />
          </button>
        </div>

        {/* 项目选择与切换 */}
        <div className="min-h-0 flex-1 overflow-y-auto p-3 space-y-4">
          <div className="space-y-1.5">
            <span className="text-[11px] font-medium text-ink-3 uppercase tracking-wider px-1">当前项目</span>
            <div className="space-y-1">
              {projects.map((proj) => {
                const isActive = proj.id === activeProjectId
                return (
                  <div
                    key={proj.id}
                    className={`group relative flex flex-col gap-1 rounded-xl p-2.5 cursor-pointer transition border ${
                      isActive
                        ? 'bg-accent/10 border-accent/40 text-ink-1 shadow-xs'
                        : 'border-line/40 hover:bg-panel hover:border-line text-ink-2'
                    }`}
                    onClick={() => setActiveProject(proj.id)}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[12px] font-semibold line-clamp-1">{proj.title}</span>
                      <div className="flex items-center gap-1">
                        <span className="text-[10px] rounded-full bg-accent-soft px-1.5 py-0.2 text-accent">
                          {proj.documents.length} 篇
                        </span>
                        {projects.length > 1 && (
                          <button
                            className="opacity-0 group-hover:opacity-100 p-0.5 text-ink-3 hover:text-danger rounded transition"
                            onClick={(e) => {
                              e.stopPropagation()
                              removeProject(proj.id)
                            }}
                            title="删除项目"
                          >
                            <Trash2 size={11} />
                          </button>
                        )}
                      </div>
                    </div>
                    <span className="text-[10px] text-ink-3 line-clamp-1">主题：{proj.topic}</span>
                  </div>
                )
              })}
            </div>
          </div>

          {/* 当前项目下属文献列表 */}
          {curProject && (
            <div className="space-y-2 border-t border-line/60 pt-3">
              <div className="flex items-center justify-between px-1">
                <span className="text-[11px] font-medium text-ink-3 uppercase tracking-wider">
                  项目文献 ({curProject.documents.length})
                </span>
                <button
                  className="text-[11px] text-accent hover:underline flex items-center gap-0.5"
                  onClick={handleImportDoc}
                >
                  <Plus size={11} /> 导入
                </button>
              </div>

              {!curProject.documents.length ? (
                <div className="rounded-xl border border-dashed border-line p-4 text-center">
                  <FileText size={18} className="mx-auto mb-1 text-ink-3 opacity-60" />
                  <p className="text-[11px] text-ink-3">暂无文献，点击导入</p>
                  <button className="btn btn-ghost !px-2.5 !py-1 text-[11px] mt-2 text-accent" onClick={handleImportDoc}>
                    <UploadCloud size={11} /> 导入 PDF/Word
                  </button>
                </div>
              ) : (
                <div className="space-y-1">
                  {curProject.documents.map((d) => {
                    const isDocActive = d.id === activeDocId
                    return (
                      <div
                        key={d.id}
                        className={`group flex items-center justify-between rounded-lg p-2 text-[12px] cursor-pointer transition border ${
                          isDocActive
                            ? 'bg-accent text-white border-accent shadow-xs'
                            : 'border-transparent hover:bg-black/[0.04] dark:hover:bg-white/[0.04] text-ink-1'
                        }`}
                        onClick={() => handleSelectDoc(curProject.id, d.id)}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <FileText size={13} className={isDocActive ? 'text-white' : 'text-accent shrink-0'} />
                          <span className="truncate">{d.name}</span>
                        </div>
                        <button
                          className={`opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-black/10 transition ${
                            isDocActive ? 'text-white' : 'text-danger'
                          }`}
                          onClick={(e) => {
                            e.stopPropagation()
                            removeDocFromProject(curProject.id, d.id)
                          }}
                          title="移除文献"
                        >
                          <Trash2 size={11} />
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* 底部折叠收起 */}
        <div className="p-2 border-t border-line flex items-center justify-between">
          <button
            className="btn btn-ghost !p-1.5 text-ink-3 hover:text-ink-1"
            onClick={() => setSidebarOpen(false)}
            title="收起侧边栏"
          >
            <ChevronLeft size={14} />
          </button>
          <span className="text-[10px] text-ink-3">项目制学术研究</span>
        </div>
      </aside>

      {/* 侧边栏展开小按钮 */}
      {!sidebarOpen && (
        <button
          className="absolute left-2 top-14 z-20 flex h-7 w-7 items-center justify-center rounded-lg border border-line bg-panel shadow-sm text-ink-2 hover:text-accent transition"
          onClick={() => setSidebarOpen(true)}
          title="展开学术项目树"
        >
          <ChevronRight size={14} />
        </button>
      )}

      {/* 右侧：文献研读与学术工作台 */}
      <main className="min-w-0 flex-1 flex flex-col overflow-hidden">
        {/* 子功能 Tab 切换栏 */}
        <div className="glass shrink-0 border-b border-line px-4 py-2 flex items-center justify-between">
          <div className="flex items-center gap-1">
            <button
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium transition ${
                tab === 'reader'
                  ? 'bg-accent text-white shadow-xs'
                  : 'text-ink-2 hover:bg-black/[0.04] dark:hover:bg-white/[0.04]'
              }`}
              onClick={() => setTab('reader')}
            >
              <BookOpen size={13} />
              文献研读与分析
            </button>

            <button
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium transition ${
                tab === 'writing'
                  ? 'bg-accent text-white shadow-xs'
                  : 'text-ink-2 hover:bg-black/[0.04] dark:hover:bg-white/[0.04]'
              }`}
              onClick={() => setTab('writing')}
            >
              <Feather size={13} />
              学术写作与翻译
            </button>

            <button
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium transition ${
                tab === 'image'
                  ? 'bg-accent text-white shadow-xs'
                  : 'text-ink-2 hover:bg-black/[0.04] dark:hover:bg-white/[0.04]'
              }`}
              onClick={() => setTab('image')}
            >
              <ImageIcon size={13} />
              论文图表 OCR
            </button>
          </div>

          {curProject && (
            <div className="hidden sm:flex items-center gap-2 text-[11px] text-ink-3">
              <span>学术项目：</span>
              <span className="font-semibold text-ink-1 truncate max-w-[160px]">{curProject.title}</span>
            </div>
          )}
        </div>

        {/* 内容呈现区 */}
        <div className="min-h-0 flex-1 overflow-hidden relative flex flex-col">
          {tab === 'reader' && (
            doc ? (
              <div className="h-full flex flex-col overflow-hidden">
                {/* 文献研讨二级精简导航 */}
                <div className="glass shrink-0 border-b border-line px-4 py-1.5 flex items-center justify-between bg-panel/30">
                  <div className="flex items-center gap-1">
                    <button
                      className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition ${readerSubTab === 'bilingual' ? 'bg-accent text-white' : 'text-ink-2 hover:bg-black/5 dark:hover:bg-white/5'}`}
                      onClick={() => setReaderSubTab('bilingual')}
                    >
                      📖 双语精读
                    </button>
                    <button
                      className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition ${readerSubTab === 'summary' ? 'bg-accent text-white' : 'text-ink-2 hover:bg-black/5 dark:hover:bg-white/5'}`}
                      onClick={() => {
                        setReaderSubTab('summary')
                        if (useFileStore.getState().summaryState === 'idle' && !useFileStore.getState().summary) {
                          useFileStore.getState().summarize()
                        }
                      }}
                    >
                      📑 核心摘要与综述
                    </button>
                    <button
                      className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition ${readerSubTab === 'review' ? 'bg-accent text-white' : 'text-ink-2 hover:bg-black/5 dark:hover:bg-white/5'}`}
                      onClick={() => setReaderSubTab('review')}
                    >
                      ⚖️ 审稿评审与复现
                    </button>
                    <button
                      className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition ${readerSubTab === 'citation' ? 'bg-accent text-white' : 'text-ink-2 hover:bg-black/5 dark:hover:bg-white/5'}`}
                      onClick={() => setReaderSubTab('citation')}
                    >
                      📋 引用与 BibTeX
                    </button>
                  </div>
                  <span className="text-[11px] text-ink-3 truncate max-w-[240px] font-mono">
                    《{doc.name}》
                  </span>
                </div>

                <div className="flex-1 overflow-hidden min-h-0">
                  {readerSubTab === 'bilingual' && <FileView />}
                  {readerSubTab === 'summary' && <SummaryWorkspace onSwitchToReader={() => setReaderSubTab('bilingual')} />}
                  {readerSubTab === 'review' && <ReviewWorkspace />}
                  {readerSubTab === 'citation' && <CitationWorkspace />}
                </div>
              </div>
            ) : (
              <HomeView />
            )
          )}

          {tab === 'writing' && (
            <div className="h-full flex flex-col overflow-hidden">
              <div className="glass shrink-0 border-b border-line px-4 py-1.5 flex items-center justify-between bg-panel/30">
                <div className="flex items-center gap-1">
                  <button
                    className={`px-3 py-1 rounded-md text-[11px] font-medium transition ${writingSubTab === 'polish' ? 'bg-accent text-white' : 'text-ink-2 hover:bg-black/5 dark:hover:bg-white/5'}`}
                    onClick={() => setWritingSubTab('polish')}
                  >
                    ✍️ 学术论文润色
                  </button>
                  <button
                    className={`px-3 py-1 rounded-md text-[11px] font-medium transition ${writingSubTab === 'translate' ? 'bg-accent text-white' : 'text-ink-2 hover:bg-black/5 dark:hover:bg-white/5'}`}
                    onClick={() => setWritingSubTab('translate')}
                  >
                    💬 自由专业翻译
                  </button>
                </div>
              </div>
              <div className="flex-1 overflow-hidden min-h-0">
                {writingSubTab === 'polish' ? <PolishView /> : <TextTranslateView />}
              </div>
            </div>
          )}

          {tab === 'image' && <ImageZoneView onImageFile={handleImageFile} />}
        </div>
      </main>

      {/* 新建项目弹窗 */}
      {createModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl border border-line bg-panel p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-[15px] font-semibold text-ink-1 flex items-center gap-2">
                <FolderKanban size={16} className="text-accent" /> 新建学术项目
              </h3>
              <button
                className="text-ink-3 hover:text-ink-1 text-[12px]"
                onClick={() => setCreateModalOpen(false)}
              >
                取消
              </button>
            </div>

            <form onSubmit={handleCreateSubmit} className="space-y-3">
              <div>
                <label className="block text-[11px] font-medium text-ink-2 mb-1">项目名称</label>
                <input
                  type="text"
                  required
                  placeholder="例如：大模型智能体与规划系统"
                  className="input w-full text-[13px]"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-ink-2 mb-1">研究预设主题 (Topic)</label>
                <input
                  type="text"
                  required
                  placeholder="例如：LLM Multi-Agent Planning & Memory"
                  className="input w-full text-[13px]"
                  value={newTopic}
                  onChange={(e) => setNewTopic(e.target.value)}
                />
                <p className="text-[10px] text-ink-3 mt-1">智能体将依据该主题理解下属文献与进行跨文献问答。</p>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-ink-2 mb-1">研究目标与备忘（可选）</label>
                <textarea
                  rows={3}
                  placeholder="记录该学术项目的重点研究方向、创新设想或实验进展…"
                  className="input w-full text-[12px] leading-relaxed resize-none"
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                />
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  className="btn btn-ghost text-[12px]"
                  onClick={() => setCreateModalOpen(false)}
                >
                  取消
                </button>
                <button type="submit" className="btn btn-primary text-[12px] !px-4">
                  <Check size={13} /> 立即创建
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

/** 核心摘要与项目全景速览工作区 */
function SummaryWorkspace({ onSwitchToReader }: { onSwitchToReader: () => void }): React.JSX.Element {
  const doc = useFileStore((s) => s.doc)
  const summary = useFileStore((s) => s.summary)
  const summaryState = useFileStore((s) => s.summaryState)
  const error = useFileStore((s) => s.error)
  const summarize = useFileStore((s) => s.summarize)
  const stopSummarize = useFileStore((s) => s.stopSummarize)
  const curProject = useProjectStore((s) => s.getActiveProject())

  const html = useMemo(() => {
    if (!summary) return ''
    return sanitizeHtml(marked.parse(summary, { async: false }) as string)
  }, [summary])

  const copySummary = () => {
    if (!summary) return
    void navigator.clipboard.writeText(summary)
    toast('success', '摘要内容已复制到剪贴板', '复制成功')
  }

  return (
    <div className="h-full overflow-y-auto p-6 max-w-4xl mx-auto space-y-6">
      {/* 顶部：当前打开文献的摘要 */}
      <div className="card p-6 space-y-4">
        <div className="flex items-center justify-between border-b border-line pb-3">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-xl bg-accent-soft text-accent">
              <Sparkles size={15} />
            </span>
            <div>
              <h2 className="text-[15px] font-bold text-ink-1 line-clamp-1">
                {doc ? `《${doc.name}》核心学术摘要` : '请先在左侧选择或导入文献'}
              </h2>
              <p className="text-[11px] text-ink-3">AI 结构化提炼 · 核心贡献 · 大纲脉络 · 重点术语</p>
            </div>
          </div>

          {doc && (
            <div className="flex items-center gap-2">
              {summaryState === 'streaming' ? (
                <button className="btn !px-3 !py-1.5 text-[12px] text-danger" onClick={stopSummarize}>
                  停止生成
                </button>
              ) : (
                <button
                  className="btn btn-primary !px-3.5 !py-1.5 text-[12px]"
                  onClick={() => summarize()}
                >
                  <RefreshCw size={12} />
                  {summary ? '重新提炼' : '生成摘要'}
                </button>
              )}
              {summary && (
                <>
                  <button className="btn btn-ghost !p-2" onClick={copySummary} title="复制摘要">
                    <Copy size={14} />
                  </button>
                  <button
                    className="btn btn-ghost !px-3 !py-1.5 text-[12px] text-accent"
                    onClick={() => {
                      useAgentStore.getState().setInput(`/总结 结合文献《${doc.name}》的摘要，深入讲解核心创新点`)
                      useAppStore.getState().go('agent')
                    }}
                    title="在智能体中深入追问"
                  >
                    <MessageSquare size={13} /> 深入追问
                  </button>
                  <button
                    className="btn btn-ghost !px-3 !py-1.5 text-[12px]"
                    onClick={onSwitchToReader}
                    title="切换到全文双语精读"
                  >
                    <BookOpen size={13} /> 查看全文
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        {/* 摘要内容展示 */}
        {!doc ? (
          <div className="py-12 text-center text-ink-3 text-[13px]">
            <BookOpen size={24} className="mx-auto mb-2 opacity-50 text-ink-3" />
            左侧学术项目中暂未选择文献，请点击左侧文献或导入新文献查看摘要。
          </div>
        ) : summaryState === 'streaming' ? (
          <div className="space-y-3 py-4">
            <div className="flex items-center gap-2 text-[12px] text-accent font-medium">
              <span className="h-3 w-3 animate-spin rounded-full border-2 border-accent border-t-transparent" />
              文献研读专家正在为您全面分析并生成核心摘要…
            </div>
            {summary && <div className="md-body stream-caret text-[13px]" dangerouslySetInnerHTML={{ __html: html }} />}
          </div>
        ) : summaryState === 'error' ? (
          <div className="py-8 text-center text-danger text-[13px]">{error || '摘要生成失败'}</div>
        ) : summary ? (
          <div className="md-body text-[13px] leading-relaxed" dangerouslySetInnerHTML={{ __html: html }} />
        ) : (
          <div className="py-12 text-center space-y-3">
            <p className="text-[13px] text-ink-2">该文献尚未生成结构化摘要</p>
            <button className="btn btn-primary" onClick={() => summarize()}>
              <Sparkles size={14} /> 一键提炼核心学术摘要
            </button>
          </div>
        )}
      </div>

      {/* 底部：当前学术项目的多文献全景概览 */}
      {curProject && (
        <div className="card p-6 space-y-4">
          <div className="flex items-center justify-between border-b border-line pb-3">
            <div>
              <h3 className="text-[14px] font-bold text-ink-1 flex items-center gap-2">
                <FolderKanban size={15} className="text-accent" />
                学术项目「{curProject.title}」文献库 ({curProject.documents.length} 篇)
              </h3>
              <p className="text-[11px] text-ink-3">研究主题：`{curProject.topic}`</p>
            </div>
            {curProject.documents.length > 0 && (
              <button
                className="btn btn-primary !px-3.5 !py-1.5 text-[12px]"
                onClick={() => {
                  useAgentStore.getState().send(`生成学术项目「${curProject.title}」的跨文献全景综述`)
                  useAppStore.getState().go('agent')
                }}
              >
                <Sparkles size={12} /> 一键生成项目跨文献综述
              </button>
            )}
          </div>

          {!curProject.documents.length ? (
            <p className="text-[12px] text-ink-3 py-4 text-center">暂无文献，请在左侧导入文献。</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {curProject.documents.map((d, i) => (
                <div
                  key={d.id}
                  className="rounded-xl border border-line/70 p-3.5 space-y-2 hover:border-accent/50 transition bg-panel/40"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[12px] font-semibold line-clamp-1 text-ink-1">
                      {i + 1}. {d.name}
                    </span>
                    <span className="text-[10px] text-ink-3">{(d.size / 1024).toFixed(0)} KB</span>
                  </div>
                  <p className="text-[11px] text-ink-3 line-clamp-2 leading-relaxed">
                    {d.summary || '（已归档入项目，可点击精读并生成摘要）'}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/* =====================================================================
 * 2. 审稿人评审与算法复现工作区（Review & Code Skeleton）
 * ===================================================================== */
function ReviewWorkspace(): React.JSX.Element {
  const doc = useFileStore((s) => s.doc)
  const segments = useFileStore((s) => s.segments)
  const summary = useFileStore((s) => s.summary)

  const [mode, setMode] = useState<'review' | 'code'>('review')
  const [reviewResult, setReviewResult] = useState('')
  const [codeResult, setCodeResult] = useState('')
  const [loading, setLoading] = useState(false)

  const handleGenerate = async () => {
    if (!doc || !segments.length) return
    setLoading(true)
    const text = summary
      ? `【核心摘要】：\n${summary}\n\n【正文】：\n${segments.slice(0, 10).map((s) => s.text).join('\n')}`
      : segments.map((s) => s.text).join('\n')

    try {
      if (mode === 'review') {
        const res = await generatePeerReview(text, doc.name)
        setReviewResult(res)
      } else {
        const res = await generateCodeSkeleton(text, doc.name)
        setCodeResult(res)
      }
    } finally {
      setLoading(false)
    }
  }

  const activeContent = mode === 'review' ? reviewResult : codeResult
  const html = activeContent ? sanitizeHtml(marked.parse(activeContent, { async: false }) as string) : ''

  const handleCopy = () => {
    if (!activeContent) return
    void navigator.clipboard.writeText(activeContent)
    toast('success', '内容已复制到剪贴板', '复制成功')
  }

  return (
    <div className="h-full overflow-y-auto p-6 max-w-4xl mx-auto space-y-6">
      <div className="card p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-line pb-4">
          <div className="flex items-center gap-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-accent-soft text-accent">
              {mode === 'review' ? <Scale size={16} /> : <Code size={16} />}
            </span>
            <div>
              <h2 className="text-[15px] font-bold text-ink-1">
                {doc ? `《${doc.name}》` : '请先选择文献'} - {mode === 'review' ? '顶刊同行评审' : '算法复现指南'}
              </h2>
              <p className="text-[11px] text-ink-3">
                {mode === 'review' ? '批判性创新性评估 · 方法论严谨度 · 局限性质疑 · 4维雷达打分' : '输入输出规范 · 模块化 PyTorch 核心实现 · 训练技巧与避坑指南'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex bg-black/5 dark:bg-white/5 p-0.5 rounded-xl text-[12px]">
              <button
                className={`px-3 py-1 rounded-lg font-medium transition ${mode === 'review' ? 'bg-accent text-white shadow-xs' : 'text-ink-2'}`}
                onClick={() => setMode('review')}
              >
                ⚖️ 审稿人评审
              </button>
              <button
                className={`px-3 py-1 rounded-lg font-medium transition ${mode === 'code' ? 'bg-accent text-white shadow-xs' : 'text-ink-2'}`}
                onClick={() => setMode('code')}
              >
                💻 算法代码复现
              </button>
            </div>

            {doc && (
              <button
                className="btn btn-primary !px-3.5 !py-1.5 text-[12px]"
                onClick={handleGenerate}
                disabled={loading}
              >
                {loading ? <RefreshCw size={13} className="animate-spin" /> : <Sparkles size={13} />}
                {loading ? '正在分析生成…' : activeContent ? '重新生成' : '立即生成'}
              </button>
            )}
          </div>
        </div>

        {!doc ? (
          <div className="py-12 text-center text-ink-3 text-[13px]">
            <BookOpen size={24} className="mx-auto mb-2 opacity-50" />
            请先在左侧学术项目中选择或导入文献。
          </div>
        ) : loading ? (
          <div className="py-12 text-center space-y-3">
            <div className="flex items-center justify-center gap-2 text-[13px] text-accent font-medium">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-accent border-t-transparent" />
              {mode === 'review' ? '资深审稿人正在深度评估该文献的创新性与严谨度…' : '算法工程师正在解剖架构并编写 PyTorch 实现骨架…'}
            </div>
          </div>
        ) : activeContent ? (
          <div className="space-y-4">
            <div className="flex justify-end gap-2">
              <button className="btn btn-ghost !px-3 !py-1 text-[12px]" onClick={handleCopy}>
                <Copy size={13} /> 复制全文
              </button>
              <button
                className="btn btn-ghost !px-3 !py-1 text-[12px] text-accent"
                onClick={() => {
                  useAgentStore.getState().setInput(`/审稿 结合文献《${doc.name}》的评审报告，进一步剖析其局限性`)
                  useAppStore.getState().go('agent')
                }}
              >
                <MessageSquare size={13} /> 深入追问
              </button>
            </div>
            <div className="md-body text-[13px] leading-relaxed" dangerouslySetInnerHTML={{ __html: html }} />
          </div>
        ) : (
          <div className="py-12 text-center space-y-3">
            <p className="text-[13px] text-ink-2">
              {mode === 'review' ? '尚未为本文献生成审稿人评审报告' : '尚未为本文献生成 PyTorch 算法复现骨架'}
            </p>
            <button className="btn btn-primary" onClick={handleGenerate}>
              <Sparkles size={14} /> 立即开始智能分析
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

/* =====================================================================
 * 3. BibTeX 与多学术规范引用生成工作区（Citation & BibTeX）
 * ===================================================================== */
function CitationWorkspace(): React.JSX.Element {
  const doc = useFileStore((s) => s.doc)
  const [title, setTitle] = useState(doc?.name.replace(/\.[^.]+$/, '') || 'Attention Is All You Need')
  const [authors, setAuthors] = useState('Vaswani, A., Shazeer, N., Parmar, N., Uszkoreit, J.')
  const [year, setYear] = useState('2017')
  const [venue, setVenue] = useState('NeurIPS')

  const meta = useMemo(
    () => ({
      title: title.trim(),
      authors: authors.split(/[,，;；]+/).map((a) => a.trim()).filter(Boolean),
      year: year.trim(),
      venue: venue.trim()
    }),
    [title, authors, year, venue]
  )

  const bib = useMemo(() => generateBibTeX(meta), [meta])
  const apa = useMemo(() => generateAPA(meta), [meta])
  const ieee = useMemo(() => generateIEEE(meta), [meta])
  const gbt = useMemo(() => generateGBT7714(meta), [meta])

  const copyText = (text: string, label: string) => {
    void navigator.clipboard.writeText(text)
    toast('success', `${label}已复制到剪贴板`, '复制成功')
  }

  const downloadBib = async () => {
    try {
      await window.bridge.saveFile({
        defaultPath: `${meta.title.slice(0, 30)}.bib`,
        data: bib,
        filters: [{ name: 'BibTeX 引用文件', extensions: ['bib'] }]
      })
      toast('success', '已导出 .bib 文件', '导出成功')
    } catch {
      /* 忽略取消 */
    }
  }

  return (
    <div className="h-full overflow-y-auto p-6 max-w-4xl mx-auto space-y-6">
      {/* 顶部元数据编辑卡片 */}
      <div className="card p-6 space-y-4">
        <div className="flex items-center justify-between border-b border-line pb-3">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-xl bg-accent-soft text-accent">
              <BookMarked size={15} />
            </span>
            <div>
              <h2 className="text-[15px] font-bold text-ink-1">学术引用与 BibTeX 生成器</h2>
              <p className="text-[11px] text-ink-3">支持 BibTeX、APA、IEEE、GB/T 7714 国标格式实时生成与导出</p>
            </div>
          </div>
          <button className="btn btn-primary !px-3.5 !py-1.5 text-[12px]" onClick={downloadBib}>
            <Copy size={13} /> 导出 .bib 文件
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2">
            <label className="block text-[11px] font-medium text-ink-2 mb-1">论文标题 (Title)：</label>
            <input
              type="text"
              className="input w-full text-[12px]"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-ink-2 mb-1">作者列表 (逗号分隔)：</label>
            <input
              type="text"
              className="input w-full text-[12px]"
              value={authors}
              onChange={(e) => setAuthors(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[11px] font-medium text-ink-2 mb-1">发表年份：</label>
              <input
                type="text"
                className="input w-full text-[12px]"
                value={year}
                onChange={(e) => setYear(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-ink-2 mb-1">期刊 / 会议 (Venue)：</label>
              <input
                type="text"
                className="input w-full text-[12px]"
                value={venue}
                onChange={(e) => setVenue(e.target.value)}
              />
            </div>
          </div>
        </div>
      </div>

      {/* 引用格式展示卡片 */}
      <div className="space-y-4">
        {/* BibTeX */}
        <div className="card p-5 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[13px] font-bold text-ink-1 flex items-center gap-2">
              <span className="badge badge-accent">BibTeX</span> 标准 LaTeX 引用代码
            </span>
            <button className="btn btn-ghost !px-3 !py-1 text-[12px]" onClick={() => copyText(bib, 'BibTeX')}>
              <Copy size={13} /> 复制
            </button>
          </div>
          <pre className="p-3 rounded-xl bg-black/5 dark:bg-white/5 text-[12px] font-mono overflow-x-auto text-ink-1">
            {bib}
          </pre>
        </div>

        {/* APA / IEEE / GBT */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="card p-4 space-y-2 flex flex-col justify-between">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[12px] font-bold text-ink-1">APA 7th 格式</span>
                <button className="btn btn-ghost !p-1" onClick={() => copyText(apa, 'APA 格式')}>
                  <Copy size={12} />
                </button>
              </div>
              <p className="text-[11px] text-ink-3 leading-relaxed">{apa}</p>
            </div>
          </div>

          <div className="card p-4 space-y-2 flex flex-col justify-between">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[12px] font-bold text-ink-1">IEEE 格式</span>
                <button className="btn btn-ghost !p-1" onClick={() => copyText(ieee, 'IEEE 格式')}>
                  <Copy size={12} />
                </button>
              </div>
              <p className="text-[11px] text-ink-3 leading-relaxed">{ieee}</p>
            </div>
          </div>

          <div className="card p-4 space-y-2 flex flex-col justify-between">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[12px] font-bold text-ink-1">GB/T 7714 中文国标</span>
                <button className="btn btn-ghost !p-1" onClick={() => copyText(gbt, 'GB/T 7714 格式')}>
                  <Copy size={12} />
                </button>
              </div>
              <p className="text-[11px] text-ink-3 leading-relaxed">{gbt}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
