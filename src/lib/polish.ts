import { llmJSON } from './llm'

export type PolishTone = 'strict' | 'concise' | 'hedging'

export interface PolishDiff {
  type: 'replace' | 'insert' | 'delete'
  original?: string
  replacement?: string
  reason: string
}

export interface AcademicCollocation {
  word: string
  meaning: string
  usage: string
}

export interface PolishResult {
  polished: string
  diffs: PolishDiff[]
  improvements: string[]
  collocations: AcademicCollocation[]
  wordCountOriginal: number
  wordCountPolished: number
}

const TONE_PROMPTS: Record<PolishTone, string> = {
  strict:
    '【严格学术语气（Strict Academic - IEEE/ACM/Nature 规范）】\n' +
    '要求：使用地道、严谨的学术书面用语，彻底消除口语化表达（如 get, make, a lot of -> obtain, yield, substantial）；' +
    '规范主被动语态，确保名词短语与谓语动词的专业度，逻辑连接词清晰（furthermore, consequently, whereas）。',
  concise:
    '【精炼紧凑语气（Concise - 篇幅精简/防超页）】\n' +
    '要求：在完全保留核心信息与学术严谨性的前提下，大力剔除冗余词汇、空洞修饰与啰嗦从句；' +
    '使用强力动作动词与复合名词短语精炼句子，压缩字数 15%~30%，适合摘要与篇幅受限场景。',
  hedging:
    '【严谨委婉语气（Academic Hedging - 学术留有余地）】\n' +
    '要求：运用学术界标准的模糊限制语（如 suggests, tends to, under certain constraints, potentially, preliminary findings indicate）；' +
    '避免绝对化断言（如 proves, completely ensures -> demonstrates, substantially mitigates），增强论文结论的科学性与审稿人信服力。'
}

const SYS_POLISH =
  '你是一名顶级英文期刊（Nature/IEEE/ACM）资深学术编辑兼母语审稿人。' +
  '用户会提供一段英文学术文本，请根据指定的学术语气要求进行专业润色。' +
  '请必须且只返回一个严格合法的 JSON 对象（不要 Markdown 格式块包裹，不要任何额外开场白），字段结构如下：\n' +
  '{\n' +
  '  "polished": "完整润色后的整段英文正文",\n' +
  '  "diffs": [\n' +
  '    {\n' +
  '      "type": "replace",\n' +
  '      "original": "原句中被替换的词句片段",\n' +
  '      "replacement": "替换后的学术地道词句",\n' +
  '      "reason": "修改简述（如：提升专业度/消除口语/增强逻辑连接）"\n' +
  '    }\n' +
  '  ],\n' +
  '  "improvements": ["要点1：语法与时态修正", "要点2：精准动词替换", "要点3：结构精简"],\n' +
  '  "collocations": [\n' +
  '    {"word": "核心学术高级词汇", "meaning": "中文释义", "usage": "学术短语例句搭配"}\n' +
  '  ]\n' +
  '}'

export async function polishText(text: string, tone: PolishTone = 'strict'): Promise<PolishResult> {
  const trimmed = text.trim()
  if (!trimmed) throw new Error('请输入需要润色的英文文本')

  const wordsOrig = trimmed.split(/\s+/).filter(Boolean).length
  const userPrompt = `${TONE_PROMPTS[tone]}\n\n【待润色原文】：\n${trimmed}`

  const call = llmJSON(
    [
      { role: 'system', content: SYS_POLISH },
      { role: 'user', content: userPrompt }
    ],
    { temperature: 0.3 }
  )

  const rawJson = await call.promise

  let parsed: {
    polished?: string
    diffs?: PolishDiff[]
    improvements?: string[]
    collocations?: AcademicCollocation[]
  } = {}

  try {
    const jsonMatch = rawJson.match(/\{[\s\S]*\}/)
    parsed = JSON.parse(jsonMatch ? jsonMatch[0] : rawJson)
  } catch {
    parsed = { polished: rawJson, diffs: [], improvements: ['完成学术润色'], collocations: [] }
  }

  const polished = (parsed.polished ?? '').trim() || trimmed
  const wordsPolished = polished.split(/\s+/).filter(Boolean).length

  return {
    polished,
    diffs: Array.isArray(parsed.diffs) ? parsed.diffs : [],
    improvements: Array.isArray(parsed.improvements) ? parsed.improvements : [],
    collocations: Array.isArray(parsed.collocations) ? parsed.collocations : [],
    wordCountOriginal: wordsOrig,
    wordCountPolished: wordsPolished
  }
}
