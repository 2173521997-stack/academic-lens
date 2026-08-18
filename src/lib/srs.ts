/** SM-2 风格间隔重复调度（简化版：二值反馈 认识/不认识） */

export interface SRSState {
  /** 难度系数（1.3–3.0，越大越容易） */
  ease: number
  /** 当前复习间隔（天） */
  interval: number
  /** 连续答对次数 */
  reps: number
  /** 遗忘次数 */
  lapses: number
  /** 下次到期时间戳 */
  due: number
  /** 最近一次复习时间戳 */
  last?: number
}

export const DAY = 86400000
/** 答错后的重新学习间隔：10 分钟 */
const RELEARN_MS = 10 * 60 * 1000

export function initSRS(now = Date.now()): SRSState {
  return { ease: 2.5, interval: 0, reps: 0, lapses: 0, due: now }
}

/**
 * 复习一次并返回新调度状态。
 * known=true：按 SM-2 递增间隔（1 天 -> 6 天 -> interval × ease）
 * known=false：重置 reps，10 分钟后重新学习
 */
export function reviewSRS(prev: SRSState | undefined, known: boolean, now = Date.now()): SRSState {
  const s: SRSState = prev ? { ...prev } : initSRS(now)
  if (known) {
    s.reps += 1
    s.interval = s.reps === 1 ? 1 : s.reps === 2 ? 6 : Math.max(1, Math.round(s.interval * s.ease))
    s.ease = Math.min(3.0, s.ease + 0.05)
    s.due = now + s.interval * DAY
  } else {
    s.reps = 0
    s.interval = 1
    s.lapses += 1
    s.ease = Math.max(1.3, s.ease - 0.2)
    s.due = now + RELEARN_MS
  }
  s.last = now
  return s
}

/** 是否到期（含新词：无 srs 视为可学） */
export function isDue(srs: SRSState | undefined, now = Date.now()): boolean {
  if (!srs) return true
  return srs.due <= now
}

export type MasteryLevel = 'new' | 'learning' | 'young' | 'mature'

/** 掌握度分级：新词 / 学习中（<7天）/ 较熟（<21天）/ 已掌握（≥21天） */
export function masteryLevel(srs: SRSState | undefined): MasteryLevel {
  if (!srs || srs.reps === 0) return 'new'
  if (srs.interval < 7) return 'learning'
  if (srs.interval < 21) return 'young'
  return 'mature'
}

export const MASTERY_LABELS: Record<MasteryLevel, string> = {
  new: '新词',
  learning: '学习中',
  young: '较熟',
  mature: '已掌握'
}
