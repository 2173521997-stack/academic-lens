import { create } from 'zustand'

/** 个性化学习档案：供智能体多轮上下文注入，理解用户目标与偏好 */
export interface LearnerProfile {
  /** 主要学习目标 */
  goal: string
  /** 当前大致水平（自由文本，如「四级 → 六级」） */
  level: string
  /** 偏好的学习方式 */
  style: string
  /** 最想提升的方面 */
  focus: string
}

/** 可信度配置 */
export interface TrustSettings {
  /** 是否在 AI 生成内容后附「AI 生成」来源标注 */
  aiWatermark: boolean
  /** 关键结论是否追加引用溯源 */
  withSources: boolean
}

interface ProfileState {
  profile: LearnerProfile
  trust: TrustSettings
  onboarded: boolean
  load: () => Promise<void>
  updateProfile: (patch: Partial<LearnerProfile>) => void
  updateTrust: (patch: Partial<TrustSettings>) => void
  setOnboarded: (v: boolean) => void
}

export const useProfileStore = create<ProfileState>((set, get) => ({
  profile: { goal: '', level: '', style: '', focus: '' },
  trust: { aiWatermark: true, withSources: true },
  onboarded: false,

  load: async () => {
    const saved = await window.bridge.storeGet<Partial<ProfileState>>('profile')
    if (saved) {
      set({
        profile: { ...get().profile, ...(saved.profile ?? {}) },
        trust: { ...get().trust, ...(saved.trust ?? {}) },
        onboarded: saved.onboarded ?? false
      })
    }
  },

  updateProfile: (patch) => {
    const next = { ...get().profile, ...patch }
    set({ profile: next })
    void window.bridge.storeSet('profile', { profile: next, trust: get().trust, onboarded: get().onboarded })
  },

  updateTrust: (patch) => {
    const next = { ...get().trust, ...patch }
    set({ trust: next })
    void window.bridge.storeSet('profile', { profile: get().profile, trust: next, onboarded: get().onboarded })
  },

  setOnboarded: (v) => {
    set({ onboarded: v })
    void window.bridge.storeSet('profile', { profile: get().profile, trust: get().trust, onboarded: v })
  }
}))

/** 简洁档案摘要，供智能体上下文注入；未填时返回空 */
export function profileContext(): string {
  const p = useProfileStore.getState().profile
  const parts: string[] = []
  if (p.goal) parts.push(`目标：${p.goal}`)
  if (p.level) parts.push(`水平：${p.level}`)
  if (p.style) parts.push(`偏好：${p.style}`)
  if (p.focus) parts.push(`想加强：${p.focus}`)
  return parts.length ? `\n\n（学习者档案：${parts.join('；')}）` : ''
}