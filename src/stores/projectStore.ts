import { create } from 'zustand'
import type { Segment } from '../lib/types'
import { newId } from '../lib/parse'

export interface ProjectDoc {
  id: string
  name: string
  size: number
  path?: string
  rawBuffer?: Uint8Array
  pageCount?: number
  summary?: string
  addedAt: number
  tags?: string[]
  segments?: Segment[]
}

export interface AcademicProject {
  id: string
  title: string
  topic: string
  description?: string
  createdAt: number
  updatedAt: number
  documents: ProjectDoc[]
}

interface ProjectState {
  projects: AcademicProject[]
  activeProjectId: string | null
  activeDocId: string | null
  loaded: boolean

  load: () => Promise<void>
  createProject: (input: { title: string; topic: string; description?: string }) => AcademicProject
  updateProject: (id: string, patch: Partial<Pick<AcademicProject, 'title' | 'topic' | 'description'>>) => void
  removeProject: (id: string) => void
  addDocToProject: (
    projectId: string,
    doc: { name: string; size: number; path?: string; rawBuffer?: Uint8Array; segments?: Segment[]; summary?: string }
  ) => ProjectDoc
  removeDocFromProject: (projectId: string, docId: string) => void
  setActiveProject: (id: string | null) => void
  setActiveDoc: (docId: string | null) => void
  getActiveProject: () => AcademicProject | undefined
  getActiveDoc: () => ProjectDoc | undefined
}

const DEFAULT_PROJECTS: AcademicProject[] = [
  {
    id: 'proj-agents',
    title: '大模型智能体与规划系统',
    topic: 'LLM Multi-Agent Architecture & Planning',
    description: '追踪 ReAct、Plan-and-Solve、Reflexion 等前沿学术智能体架构与落地实践',
    createdAt: Date.now() - 86400000 * 2,
    updatedAt: Date.now() - 86400000 * 2,
    documents: [
      {
        id: 'doc-react-paper',
        name: 'ReAct: Synergizing Reasoning and Acting in Language Models.pdf',
        size: 1420500,
        summary: '普林斯顿大学与 Google 团队提出 ReAct 框架，将大模型的推理（Reasoning）与行动（Acting）协同结合，大幅提升了工具调用与决策准确率。',
        addedAt: Date.now() - 86400000 * 2,
        tags: ['ICLR 2023', 'Agent', 'Reasoning']
      }
    ]
  },
  {
    id: 'proj-multimodal',
    title: '多模态对比学习与跨模态表征',
    topic: 'Multimodal Representation & Contrastive Learning',
    description: 'CLIP、BLIP、SigLIP 等视觉-语言大模型表征对齐算法与预训练技术',
    createdAt: Date.now() - 86400000 * 5,
    updatedAt: Date.now() - 86400000 * 5,
    documents: [
      {
        id: 'doc-clip-paper',
        name: 'Learning Transferable Visual Models From Natural Language Supervision.pdf',
        size: 2350100,
        summary: 'OpenAI 提出的 CLIP 模型，通过 4 亿图文对进行对比学习预训练，实现了卓越的 Zero-Shot 迁移与泛化能力。',
        addedAt: Date.now() - 86400000 * 5,
        tags: ['ICML 2021', 'Vision-Language', 'Zero-Shot']
      }
    ]
  }
]

const save = (projects: AcademicProject[]): void => {
  // 过滤掉二进制 rawBuffer 避免过大持久化
  const serialized = projects.map((p) => ({
    ...p,
    documents: p.documents.map((d) => ({
      ...d,
      rawBuffer: undefined
    }))
  }))
  void window.bridge.storeSet('academicProjects', serialized)
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  projects: DEFAULT_PROJECTS,
  activeProjectId: DEFAULT_PROJECTS[0]?.id ?? null,
  activeDocId: DEFAULT_PROJECTS[0]?.documents[0]?.id ?? null,
  loaded: false,

  load: async () => {
    if (get().loaded) return
    try {
      const saved = await window.bridge.storeGet<AcademicProject[]>('academicProjects')
      if (Array.isArray(saved) && saved.length > 0) {
        set({
          projects: saved,
          activeProjectId: saved[0]?.id ?? null,
          activeDocId: saved[0]?.documents[0]?.id ?? null,
          loaded: true
        })
      } else {
        set({ projects: DEFAULT_PROJECTS, loaded: true })
      }
    } catch {
      set({ projects: DEFAULT_PROJECTS, loaded: true })
    }
  },

  createProject: ({ title, topic, description }) => {
    const now = Date.now()
    const newProj: AcademicProject = {
      id: `proj-${newId().slice(0, 8)}`,
      title: title.trim() || '未命名学术项目',
      topic: topic.trim() || '通用学术研究',
      description: description?.trim() || '',
      createdAt: now,
      updatedAt: now,
      documents: []
    }
    const updated = [newProj, ...get().projects]
    set({ projects: updated, activeProjectId: newProj.id, activeDocId: null })
    save(updated)
    return newProj
  },

  updateProject: (id, patch) => {
    const updated = get().projects.map((p) =>
      p.id === id ? { ...p, ...patch, updatedAt: Date.now() } : p
    )
    set({ projects: updated })
    save(updated)
  },

  removeProject: (id) => {
    const updated = get().projects.filter((p) => p.id !== id)
    const nextActive = updated[0]?.id ?? null
    const nextDoc = updated[0]?.documents[0]?.id ?? null
    set({ projects: updated, activeProjectId: nextActive, activeDocId: nextDoc })
    save(updated)
  },

  addDocToProject: (projectId, doc) => {
    const newDoc: ProjectDoc = {
      id: `doc-${newId().slice(0, 8)}`,
      name: doc.name,
      size: doc.size,
      path: doc.path,
      rawBuffer: doc.rawBuffer,
      segments: doc.segments,
      summary: doc.summary,
      addedAt: Date.now()
    }
    const updated = get().projects.map((p) => {
      if (p.id === projectId) {
        // 去重同名
        const filtered = p.documents.filter((d) => d.name !== doc.name)
        return {
          ...p,
          updatedAt: Date.now(),
          documents: [newDoc, ...filtered]
        }
      }
      return p
    })
    set({ projects: updated, activeProjectId: projectId, activeDocId: newDoc.id })
    save(updated)
    return newDoc
  },

  removeDocFromProject: (projectId, docId) => {
    const updated = get().projects.map((p) => {
      if (p.id === projectId) {
        const docs = p.documents.filter((d) => d.id !== docId)
        return { ...p, documents: docs, updatedAt: Date.now() }
      }
      return p
    })
    const curProj = updated.find((p) => p.id === projectId)
    set({
      projects: updated,
      activeDocId: curProj?.documents[0]?.id ?? null
    })
    save(updated)
  },

  setActiveProject: (id) => {
    const p = get().projects.find((it) => it.id === id)
    set({
      activeProjectId: id,
      activeDocId: p?.documents[0]?.id ?? null
    })
  },

  setActiveDoc: (docId) => set({ activeDocId: docId }),

  getActiveProject: () => get().projects.find((p) => p.id === get().activeProjectId),

  getActiveDoc: () => {
    const proj = get().getActiveProject()
    return proj?.documents.find((d) => d.id === get().activeDocId)
  }
}))
