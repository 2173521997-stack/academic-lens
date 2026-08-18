import { agentComplete } from './llm'
import { isKnownWord, bestOfflineSpelling } from './suggest'

/* =====================================================================
 * 单词输入清洗工具
 *
 * 目标：在把用户输入交给 uapi 词典 / AI 查词 / 生词本之前，规范化成
 * 一个干净的英文单词，并对拼写错误、大小写、音标噪声作出处理。
 *
 * 策略（离线优先，LLM 兜底，控制成本）：
 *   1) 离线正则：剥音标/标点/引号，提取第一个字母 token，去噪声转小写。
 *   2) 离线词库（public/words.txt）用于「已知词短路」：已知词直接返回，
 *      不再做任何纠错（词库含变体如 prudence 却可能缺 base 词 prudent，故绝不改词）。
 *   3) 纠错只在词典 miss 路径触发：先离线编辑距离命中，不确定才走 GLM-4-flash。
 *      输入混乱/歧义则直接交给小模型归一化。
 * ===================================================================== */

export interface CleanedWord {
  /** 清洗后确定要查的英文单词（小写） */
  word: string
  /** 原始输入（去空白后） */
  original: string
  /** 离线阶段是否已足够确定（true 表示未用 LLM，词基本可靠） */
  fromLLM: boolean
  /** 拼写建议（仅在判定原文可能打错时给出，如 repercssion → repercussion） */
  suggestion?: string
}

/** 剥离音标括号 /…/、[...]、引号，返回去掉这些噪声后的字符串 */
function stripPhoneticAndNoise(raw: string): string {
  return raw
    .replace(/\/(?:[^/]*)\//g, ' ') // /.../ 音标
    .replace(/\[[^\]]*\]/g, ' ') // [...] 音标
    .replace(/[*"“”‘’,.:;?!、，。；：（）()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** 取里第一个含 ASCII 字母的 token 的纯字母串（小写，保留连字符与撇号） */
function firstAlphaWord(s: string): string | null {
  const tok = s.split(/\s+/).find((t) => /[a-z]/i.test(t))
  if (!tok) return null
  const letters = tok.match(/[a-z]+(?:['-][a-z]+)*/gi)
  if (!letters || !letters.length) return null
  return letters.join('').toLowerCase()
}

/** 判断某字符串“看起来不干净”，需要 LLM 兜底的启发式 */
function looksMessy(word: string, original: string): boolean {
  if (!word) return true
  // 过长（>45 或字母串超长）或过短（1 个字母）
  if (word.length > 45 || word.length < 2) return true
  // 原输入里明显夹带了多词/标点/音标噪声（已剥掉后仍有多个 token）
  const tokens = original.split(/\s+/).filter(Boolean)
  if (tokens.length > 2) return true
  // 原输入含引号/括号/斜杠等（可能是误选中了整句带括号）
  if (/[\/[\]"“”‘’()（）]/.test(original)) return true
  return false
}

/** GLM 兜底：归一化成一个英文单词 + 可选拼写建议 */
async function llmClean(raw: string): Promise<CleanedWord | null> {
  const sys =
    '你是单词清洗器。用户的一条输入可能是干净的单词，也可能夹带音标、标点、被误选的多词片段或拼写错误。' +
    '请只输出一个 JSON（不要解释）格式：' +
    '{"word":"规范后的唯一英文单词（小写，只含a-z。若输入含多个词，取最重要的那一个）","suggestion":"可选的拼写更正（若原文拼写明显有误）；否则省略"}。' +
    '若输入根本不含字母，输出 {"word":""}。'
  try {
    const call = agentComplete(
      [
        { role: 'system', content: sys },
        { role: 'user', content: raw }
      ],
      { temperature: 0, maxTokens: 80, json: true }
    )
    const text = (await call.promise).trim()
    const m = text.match(/\{[\s\S]*\}/)
    if (!m) return null
    const obj = JSON.parse(m[0]) as { word?: string; suggestion?: string }
    const word = (obj.word ?? '').toLowerCase().replace(/[^a-z'-]/g, '')
    if (!word) return null
    const original = raw.trim()
    return {
      word,
      original,
      fromLLM: true,
      suggestion: obj.suggestion?.trim() || undefined
    }
  } catch {
    return null
  }
}

/**
 * 清洗入口。返回 null 表示没识别到任何英文单词。
 *
 * 注意：离线词库只用于「已知词短路」，绝不自动改词——因为 words.txt 是
 * 屈折/变体词表（含 prudence，却可能缺 base 词 prudent），自动替换会把
 * 合法词误改成变体。真正的纠错只发生在「词典 miss」路径（见 suggestSpelling）。
 */
export async function cleanWord(raw: string): Promise<CleanedWord | null> {
  const stripped = stripPhoneticAndNoise(raw)
  const original = stripped || raw
  const word = firstAlphaWord(original)

  // 干净且足够确定 → 归一化 + 离线词库短路，不消耗 LLM
  if (word && !looksMessy(word, original)) {
    // 已知词：直接返回（合法词库外的词不在此截断，仍按原词继续）
    if (await isKnownWord(word)) {
      return { word, original, fromLLM: false }
    }
    return { word, original, fromLLM: false }
  }

  // 混乱/歧义 → 交给小模型兜底（失败则回退到离线结果）
  const llmRes = await llmClean(original)
  if (llmRes) return llmRes
  if (word) return { word, original, fromLLM: false }
  return null
}

/**
 * 拼写建议：仅在「词典未收录 / 明确 miss」之后的事后纠正。
 *
 * 顺序：先试离线词库 + 编辑距离（快、零成本）；只有离线不确定时才走小模型。
 * 返回到纠错后的词；拿不到则返回空串。
 */
export async function suggestSpelling(word: string): Promise<string> {
  // 离线优先：邻域编辑距离命中且置信度高 → 直接用
  const offline = await bestOfflineSpelling(word)
  if (offline && offline !== word.toLowerCase()) return offline

  // 离线不确定 → LLM（仅在 miss 路径触发，成本可控）
  const sys =
    '你是英语拼写助手。用户给出的一个英文单词可能是拼写错误。请只输出一个 JSON：' +
    '{"suggestion":"你认为最可能的正确拼写（小写）。若无法判断，保持原词"}。不要解释。'
  try {
    const call = agentComplete(
      [
        { role: 'system', content: sys },
        { role: 'user', content: word.trim() }
      ],
      { temperature: 0, maxTokens: 40, json: true }
    )
    const text = (await call.promise).trim()
    const m = text.match(/\{[\s\S]*\}/)
    if (!m) return ''
    const obj = JSON.parse(m[0]) as { suggestion?: string }
    const s = (obj.suggestion ?? '').toLowerCase().replace(/[^a-z'-]/g, '')
    if (!s || s === word.toLowerCase()) return ''
    return s
  } catch {
    return ''
  }
}