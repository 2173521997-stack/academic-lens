import { agentComplete } from './llm'
import { useFileStore } from '../stores/fileStore'
import { useWordbookStore } from '../stores/wordbookStore'
import { useProfileStore } from '../stores/profileStore'
import { isDue } from './srs'
import type { LLMMessage } from '../bridge/types'

/**
 * 1. 万物百科与跨学科通识 (Knowledge Query)
 * 用博学、生动、通俗且兼具学术严谨度的语言，拆解任意跨学科概念
 */
export async function queryKnowledge(topic: string): Promise<string> {
  const t = topic.trim()
  if (!t) return '请告诉我你想了解什么知识或概念（如「量子纠缠」、「认知失调」、「博弈论纳什均衡」）。'

  const prompt =
    `你是 Academic Lens 的博学科学与人文导师。\n` +
    `请用通俗生动的比喻、严谨的科学脉络和结构化的 Markdown 为用户深度拆解「${t}」。\n\n` +
    `【回答结构要求】：\n` +
    `1. 💡 **一句话核心本质（通俗直觉比喻）**；\n` +
    `2. 🔬 **底层原理与运作机制**（清晰条理）；\n` +
    `3. 🌐 **跨学科应用与现实案例**（在计算机/物理/社会学等领域的体现）；\n` +
    `4. 📖 **延伸思考与经典文献/著作推荐**。\n\n` +
    `请用优雅、博学、启发性的简体中文作答。`

  const messages: LLMMessage[] = [
    { role: 'system', content: 'You are an omniscient scholar and science communicator. Explain concepts with clarity, depth, and vivid metaphors.' },
    { role: 'user', content: prompt }
  ]

  try {
    const res = await agentComplete(messages, { temperature: 0.3, maxTokens: 1200 }).promise
    return res.trim()
  } catch (e) {
    return `知识解析失败：${e instanceof Error ? e.message : String(e)}`
  }
}

/**
 * 2. 科研灵感头脑风暴与跨界类比 (Creative Brainstorm)
 * 跨学科灵感激发，打破科研瓶颈
 */
export async function brainstormIdeas(theme: string): Promise<string> {
  const { doc } = useFileStore.getState()
  const curContext = doc ? `当前研究文献：《${doc.name}》` : '通用研究场景'
  const t = theme.trim() || doc?.name || '跨模态与大模型研究'

  const prompt =
    `你是顶尖学者与创新顾问，拥有横跨计算机科学、认知科学、物理学与哲学的广博视野。\n` +
    `用户目前在思考的主题为：「${t}」（背景参考：${curContext}）。\n` +
    `请为用户提供 3~4 个具有高度启发性、跨学科视角的创新切入点或头脑风暴方向：\n\n` +
    `【每个切入点包含】：\n` +
    `- 🚀 **创新假设 / 突破点**；\n` +
    `- 🔗 **跨学科类比灵感**（如借鉴生物免疫、热力学熵增、复杂网络等）；\n` +
    `- 🧪 **可行的实验验证方案 / MVP 构想**；\n` +
    `- ⚠️ **潜在挑战与避坑指南**。\n\n` +
    `请用充满激情、严谨且富有远见的学术管家口吻作答。`

  const messages: LLMMessage[] = [
    { role: 'system', content: 'You are a creative academic brainstormer and visionary thinker.' },
    { role: 'user', content: prompt }
  ]

  try {
    const res = await agentComplete(messages, { temperature: 0.7, maxTokens: 1400 }).promise
    return res.trim()
  } catch (e) {
    return `灵感激发失败：${e instanceof Error ? e.message : String(e)}`
  }
}

/**
 * 3. 学术与学习管家日程规划 (Daily Planner)
 * 结合当前文献阅读、生词复习与用户目标，生成专注科研时间轴
 */
export async function planDailySchedule(userInput?: string): Promise<string> {
  const { doc, segments } = useFileStore.getState()
  const { words } = useWordbookStore.getState()
  const { profile } = useProfileStore.getState()

  const pendingWords = words.filter((w) => isDue(w.srs)).length
  const docInfo = doc ? `文献《${doc.name}》（共 ${segments.length} 段）` : '暂未打开文献'
  const goalInfo = profile.goal ? `学习目标：「${profile.goal}」` : '暂未设定明确目标'

  const prompt =
    `你是用户的专属学术管家（Academic Servant / Butler）。\n` +
    `用户当下的学情与环境：\n` +
    `- 📚 当前文献：${docInfo}\n` +
    `- 🗂️ 生词待复习：${pendingWords} 个词\n` +
    `- 🎯 目标定位：${goalInfo}\n` +
    `- 💬 用户临时需求/时间安排：${userInput || '请为我规划今天 3 小时的高效学术研读与英语学习专注计划'}\n\n` +
    `【请为用户制定一份贴心、优雅的专注时间表】：\n` +
    `1. ☕ **晨间/启动期（15-20 min）**：低阻力启动与生词闪卡温习；\n` +
    `2. 🧠 **深度工作块（Deep Work Block 45-60 min）**：核心文献研读/算法推导；\n` +
    `3. 🌿 **科学休息与间歇**：微休息、眼部放松建议；\n` +
    `4. ✍️ **输出与巩固块（30 min）**：学术写作/长难句拆解/随堂测验；\n` +
    `5. 🎩 **管家寄语与专注提示**（绅士、贴心、鼓舞人心的 Servant 语气）。`

  const messages: LLMMessage[] = [
    { role: 'system', content: 'You are an attentive, sophisticated, and supportive academic butler/servant.' },
    { role: 'user', content: prompt }
  ]

  try {
    const res = await agentComplete(messages, { temperature: 0.4, maxTokens: 1200 }).promise
    return res.trim()
  } catch (e) {
    return `日程规划失败：${e instanceof Error ? e.message : String(e)}`
  }
}

/**
 * 4. 学术解压幽默与科学家轶事 (Scholar Humor & Wisdom)
 * 缓解科研压力，分享学术幽默、历史趣闻或哲思箴言
 */
export async function getScholarHumorOrWisdom(type?: string): Promise<string> {
  const typeHint = type ? `用户关注点：${type}` : '通用解压'
  const prompt =
    `你是博学风趣的学术管家。\n` +
    `用户现在可能正在经历烧脑的科研或英语学习，需要放松解压或汲取智慧（${typeHint}）。\n` +
    `请为用户分享：\n` +
    `1. 😄 **一个高水平的学术/科研幽默梗**（如关于 LaTeX 排版玄学、审稿人二号、Overleaf 崩溃或跑实验玄学）；\n` +
    `2. 📜 **一段世界著名学者/科学家的真实趣味轶事**（如费曼、图灵、爱因斯坦、哥德尔的趣事）；\n` +
    `3. 🌟 **一句触动人心的学术哲思与治愈寄语**。\n\n` +
    `语气要既有学者的博雅，又有管家的幽默与温度！`

  const messages: LLMMessage[] = [
    { role: 'system', content: 'You are a witty, cultured, and charming academic butler.' },
    { role: 'user', content: prompt }
  ]

  try {
    const res = await agentComplete(messages, { temperature: 0.8, maxTokens: 1000 }).promise
    return res.trim()
  } catch (e) {
    return `内容获取失败：${e instanceof Error ? e.message : String(e)}`
  }
}
