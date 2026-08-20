import { agentComplete } from './llm'
import { useFileStore } from '../stores/fileStore'
import type { LLMMessage } from '../bridge/types'

/**
 * 1. 文学精翻与多译本赏析 (Literary Translation)
 * 告别机械翻译，提供「信达雅散文体」+「古典文雅体」+「名家译析」
 */
export async function translateLiterary(textRaw: string, style?: string): Promise<string> {
  const { doc, segments } = useFileStore.getState()
  const text = textRaw.trim() || segments.slice(0, 5).map((s) => s.text).join('\n\n')
  if (!text) return '请提供需要进行文学精翻的英文文本（散文、小说、诗歌或戏剧片段）。'

  const docContext = doc ? `（选自《${doc.name}》）` : ''
  const styleHint = style ? `用户偏好风格：${style}` : '雅致现代文学体'

  const prompt =
    `你是精通中西方文学的翻译名家（如朱生豪、傅雷、杨宪益）。\n` +
    `请对以下英文文学作品片段${docContext}进行深度文学精翻与多维译赏（${styleHint}）：\n\n` +
    `【原文】：\n${text}\n\n` +
    `【请按以下结构输出 Markdown 内容】：\n` +
    `### 📖 1. 雅致散文译本（信达雅 · 现代文学体）\n` +
    `> 兼顾现代汉语的音韵美与原文的情感温度。\n\n` +
    `### 📜 2. 古典文雅译本（半文半白 · 辞赋韵味）\n` +
    `> 凝练雅正，展现文言与古典意象之美。\n\n` +
    `### 🎨 3. 译法心法与意象剖析\n` +
    `- **核心意象传达**：原文的关键隐喻/象征如何巧妙转译；\n` +
    `- **文化与双关考量**：原文特殊句式、文化负载词或音律的权衡；\n` +
    `- **推荐名家译法对比**：类似经典篇目的翻译范式。`

  const messages: LLMMessage[] = [
    { role: 'system', content: 'You are a master of literary translation and comparative literature.' },
    { role: 'user', content: prompt }
  ]

  try {
    const res = await agentComplete(messages, { temperature: 0.5, maxTokens: 1600 }).promise
    return res.trim()
  } catch (e) {
    return `文学翻译失败：${e instanceof Error ? e.message : String(e)}`
  }
}

/**
 * 2. 文学修辞与文本细读 (Close Reading & Rhetoric Analysis)
 * 剖析文学名篇中的修辞手法、象征隐喻与艺术风格
 */
export async function analyzeLiteraryRhetoric(textRaw: string): Promise<string> {
  const { doc, segments } = useFileStore.getState()
  const text = textRaw.trim() || segments.slice(0, 5).map((s) => s.text).join('\n\n')
  if (!text) return '请提供需要进行文本细读（Close Reading）的文学或人文社科段落。'

  const docContext = doc ? `（选自《${doc.name}》）` : ''

  const prompt =
    `你是文学批评家与西方修辞学导师。\n` +
    `请对以下文本${docContext}进行深度「文本细读（Close Reading）」与修辞艺术剖析：\n\n` +
    `【文本内容】：\n${text}\n\n` +
    `【请按以下结构输出】：\n` +
    `1. 🎭 **文学基调与审美风格**（Tone, Mood & Aesthetic Style）；\n` +
    `2. 🔍 **核心修辞与象征剖析**（细致分析 Metaphor, Symbolism, Alliteration, Irony 等手法及其深层隐喻）；\n` +
    `3. 🎼 **节奏与句法张力**（句式的长短交错、音律感与情绪推进）；\n` +
    `4. 🏛️ **时代文化与互文性语境**（Intertextuality & Cultural Context）。`

  const messages: LLMMessage[] = [
    { role: 'system', content: 'You are an insightful literary critic and rhetoric expert.' },
    { role: 'user', content: prompt }
  ]

  try {
    const res = await agentComplete(messages, { temperature: 0.3, maxTokens: 1500 }).promise
    return res.trim()
  } catch (e) {
    return `修辞分析失败：${e instanceof Error ? e.message : String(e)}`
  }
}

/**
 * 3. 人文哲学思辨与批判性书评 (Humanities & Philosophy Critique)
 * 面向哲学、社会学、历史学文献的理论辨析与批判性反思
 */
export async function critiqueHumanities(textRaw: string): Promise<string> {
  const { doc, segments } = useFileStore.getState()
  const text = textRaw.trim() || segments.slice(0, 8).map((s) => s.text).join('\n\n')
  if (!text) return '请提供需要进行哲学思辨或人文社科批判的文本段落或核心论点。'

  const docTitle = doc?.name || '人文社科文本'

  const prompt =
    `你是精通西方哲学史与社会理论的人文资深学者。\n` +
    `请对以下人文社科/哲学文献《${docTitle}》进行深度理论辨析与批判性反思：\n\n` +
    `【文献材料】：\n${text}\n\n` +
    `【请按学术规范输出】：\n` +
    `### 🧠 1. 核心论题与概念范畴（Thesis & Conceptual Framework）\n` +
    `- 提炼作者的核心主张、先验假设与核心概念体系。\n\n` +
    `### 🏛️ 2. 理论流派与思想谱系（Intellectual Genealogy）\n` +
    `- 溯源该思想在哲学史/社会理论中的脉络（如康德主义、黑格尔辩证法、法兰克福学派、后结构主义等）。\n\n` +
    `### ⚔️ 3. 论证逻辑与潜在盲区（Dialectical Critique & Counter-arguments）\n` +
    `- 分析其论证推演的严密性，指出潜在的逻辑断裂、历史局限性或对立学派的反驳视角。\n\n` +
    `### 🌟 4. 当代价值与跨学科启示（Contemporary Relevance）`

  const messages: LLMMessage[] = [
    { role: 'system', content: 'You are a profound philosopher and critical humanities scholar.' },
    { role: 'user', content: prompt }
  ]

  try {
    const res = await agentComplete(messages, { temperature: 0.3, maxTokens: 1600 }).promise
    return res.trim()
  } catch (e) {
    return `人文思辨分析失败：${e instanceof Error ? e.message : String(e)}`
  }
}

/**
 * 4. 经典典故与名篇溯源 (Classic Allusion & Quote Context)
 * 追溯莎士比亚、希腊神话、圣经叙事与古典名言的文化出处与深层含义
 */
export async function lookupClassicAllusion(query: string): Promise<string> {
  const q = query.trim()
  if (!q) return '请输入要追溯的典故、名句或神话隐喻（如「阿喀琉斯之踵」、「潘多拉魔盒」、「To be or not to be」）。'

  const prompt =
    `你是西方古典文学与文化史学家。\n` +
    `请为用户详尽考据并溯源典故/名句：「${q}」：\n\n` +
    `【输出内容】：\n` +
    `1. 📜 **原始出处与历史文本**（作者、作品、篇章背景与原文）；\n` +
    `2. 🏺 **故事原委与核心意涵**（典故的来龙去脉）；\n` +
    `3. 💡 **演变与现代引申义**（在现代文学、政治、学术与哲学中的用法）；\n` +
    `4. ✍️ **地道英文表达与例句**（如何在学术写作或演讲中优雅借用）。`

  const messages: LLMMessage[] = [
    { role: 'system', content: 'You are an erudite classical historian and literature scholar.' },
    { role: 'user', content: prompt }
  ]

  try {
    const res = await agentComplete(messages, { temperature: 0.3, maxTokens: 1200 }).promise
    return res.trim()
  } catch (e) {
    return `典故溯源失败：${e instanceof Error ? e.message : String(e)}`
  }
}
