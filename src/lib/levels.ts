/**
 * 词汇分级体系：CEFR + 中国教育考试 + 出国考试。
 * 一个单词可被归入一个"难度档位"，由「考试标签集 + CEFR 档位」描述。
 */

export interface LevelInfo {
  /** 唯一键 */
  key: string
  /** 展示名 */
  label: string
  /** 所属体系 */
  system: string
  /** CEFR 近似档位（A1 最低 → C2 最高） */
  cefr: number
}

export const LEVELS: Record<string, LevelInfo> = {
  'a1': { key: 'a1', label: 'CEFR A1', system: 'CEFR', cefr: 1 },
  'a2': { key: 'a2', label: 'CEFR A2', system: 'CEFR', cefr: 2 },
  'b1': { key: 'b1', label: 'CEFR B1', system: 'CEFR', cefr: 3 },
  'b2': { key: 'b2', label: 'CEFR B2', system: 'CEFR', cefr: 4 },
  'c1': { key: 'c1', label: 'CEFR C1', system: 'CEFR', cefr: 5 },
  'c2': { key: 'c2', label: 'CEFR C2', system: 'CEFR', cefr: 6 },
  'cet4': { key: 'cet4', label: '四级（CET-4）', system: '大学英语', cefr: 4 },
  'cet6': { key: 'cet6', label: '六级（CET-6）', system: '大学英语', cefr: 5 },
  'kaoyan': { key: 'kaoyan', label: '考研英语核心', system: '研究生统考', cefr: 5 },
  'tem4': { key: 'tem4', label: '专四（TEM-4）', system: '专业英语', cefr: 5 },
  'tem8': { key: 'tem8', label: '专八（TEM-8）', system: '专业英语', cefr: 6 },
  'ielts5': { key: 'ielts5', label: '雅思 5.5', system: '雅思', cefr: 4 },
  'ielts7': { key: 'ielts7', label: '雅思 7.0', system: '雅思', cefr: 6 },
  'toefl85': { key: 'toefl85', label: '托福 85', system: '托福', cefr: 4 },
  'toefl110': { key: 'toefl110', label: '托福 110', system: '托福', cefr: 6 },
  'csterm': { key: 'csterm', label: '学术/顶会术语', system: '学术前沿', cefr: 6 },
  'unrated': { key: 'unrated', label: '未分级', system: '-', cefr: 0 }
}

/** 简体中文的常用展示排序（由易到难） */
export const LEVEL_ORDER = ['unrated', 'a1', 'a2', 'b1', 'cet4', 'ielts5', 'toefl85', 'b2', 'cet6', 'kaoyan', 'ielts7', 'toefl110', 'tem4', 'c1', 'c2', 'tem8', 'csterm']

export function levelLabel(key?: string): string {
  if (!key || !LEVELS[key]) return '未分级'
  return LEVELS[key].label
}

/** CEFR 数字档位 → 文案 */
export function cefrLabel(level: number): string {
  if (level <= 0) return '入门'
  if (level <= 2) return '基础'
  if (level <= 4) return '进阶'
  return '高阶'
}

/**
 * 从 LLM 文本解析分级（兼容输出 "level|CET-4" / "四级" / "B2" 等松散格式）。
 * 返回标准键；无法识别返回 undefined。
 */
export function resolveLevel(raw: string): string | undefined {
  const s = raw.trim().toLowerCase()
  if (!s) return undefined
  if (s === 'a1') return 'a1'
  if (s === 'a2' || s === 'a2.b' || s === 'a2.a') return 'a2'
  if (s === 'b1') return 'b1'
  if (s === 'b2') return 'b2'
  if (s === 'c1') return 'c1'
  if (s === 'c2') return 'c2'
  if (/kaoyan|考研|研究生/.test(s)) return 'kaoyan'
  if (/cet[-\s]?4|四级/.test(s)) return 'cet4'
  if (/cet[-\s]?6|六级/.test(s)) return 'cet6'
  if (/tem[-\s]?4|专四/.test(s)) return 'tem4'
  if (/tem[-\s]?8|专八/.test(s)) return 'tem8'
  if (/csterm|学术|术语|顶会|论文/.test(s)) return 'csterm'
  if (/ielts|雅思/.test(s)) {
    if (/(7|8|9)/.test(s)) return 'ielts7'
    return 'ielts5'
  }
  if (/toefl|托福/.test(s)) {
    if (/(110|100|105)/.test(s)) return 'toefl110'
    return 'toefl85'
  }
  return undefined
}

/** 构造分级提示词片段，供词卡/批量分级复用 */
export const LEVEL_VOCAB =
  '可用档位：CEFR A1/A2/B1/B2/C1/C2、四级 CET-4、六级 CET-6、考研英语核心、专业四级 TEM-4、专业八级 TEM-8、雅思 5.5/7.0、托福 85/110、学术/顶会术语。'