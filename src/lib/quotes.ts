export interface Quote {
  id: string
  /** 英文原句 */
  text: string
  /** 中文释义 */
  zh: string
  /** 出处说明（作者 + 作品/场合） */
  source: string
  /** 出处快速链接 */
  link?: string
  tags?: string[]
}

/** 内置美人美言：收录可公开引用的名人名言，链接指向公开资料页 */
export const BUILTIN_QUOTES: Quote[] = [
  {
    id: 'q_roosevelt',
    text: 'The only thing we have to fear is fear itself.',
    zh: '我们唯一需要恐惧的，就是恐惧本身。',
    source: '富兰克林·罗斯福 · 1933 年就职演说',
    link: 'https://en.wikipedia.org/wiki/Only_thing_we_have_to_fear_is_fear_itself',
    tags: ['勇气', '恐惧', '演讲']
  },
  {
    id: 'q_armstrong',
    text: "That's one small step for a man, one giant leap for mankind.",
    zh: '这是个人的一小步，却是人类的一大步。',
    source: '尼尔·阿姆斯特朗 · 登月第一句话',
    link: 'https://en.wikipedia.org/wiki/Neil_Armstrong',
    tags: ['探索', '科学', '名言']
  },
  {
    id: 'q_gandhi',
    text: 'Be the change you wish to see in the world.',
    zh: '欲改变世界，先成为你想看到的改变。',
    source: '圣雄甘地（常被引用的名言）',
    link: 'https://en.wikipedia.org/wiki/Mahatma_Gandhi',
    tags: ['改变', '行动', '人生']
  },
  {
    id: 'q_socrates',
    text: 'The unexamined life is not worth living.',
    zh: '未经审视的人生不值得过。',
    source: '苏格拉底 · 《申辩篇》',
    link: 'https://en.wikipedia.org/wiki/Socrates',
    tags: ['哲学', '反思']
  },
  {
    id: 'q_descartes',
    text: 'I think, therefore I am.',
    zh: '我思，故我在。',
    source: '勒内·笛卡尔 · 《谈谈方法》',
    link: 'https://en.wikipedia.org/wiki/Cogito,_ergo_sum',
    tags: ['哲学', '理性']
  },
  {
    id: 'q_shakespeare',
    text: 'To be, or not to be, that is the question.',
    zh: '生存还是毁灭，这是一个值得思考的问题。',
    source: '莎士比亚 · 《哈姆雷特》',
    link: 'https://en.wikipedia.org/wiki/To_be,_or_not_to_be',
    tags: ['戏剧', '存在']
  },
  {
    id: 'q_bacon',
    text: 'Knowledge is power.',
    zh: '知识就是力量。',
    source: '弗朗西斯·培根',
    link: 'https://en.wikipedia.org/wiki/Knowledge_is_power',
    tags: ['知识', '学习']
  },
  {
    id: 'q_einstein',
    text: 'Imagination is more important than knowledge.',
    zh: '想象力比知识更重要。',
    source: '阿尔伯特·爱因斯坦',
    link: 'https://en.wikipedia.org/wiki/Albert_Einstein',
    tags: ['想象', '科学', '创新']
  },
  {
    id: 'q_edison',
    text: 'Genius is one percent inspiration and ninety-nine percent perspiration.',
    zh: '天才是百分之一的灵感加上百分之九十九的汗水。',
    source: '托马斯·爱迪生',
    link: 'https://en.wikipedia.org/wiki/Thomas_Edison',
    tags: ['勤奋', '天才']
  },
  {
    id: 'q_laotzu',
    text: 'The journey of a thousand miles begins with a single step.',
    zh: '千里之行，始于足下。',
    source: '老子 · 《道德经》',
    link: 'https://en.wikipedia.org/wiki/Laozi',
    tags: ['坚持', '行动']
  },
  {
    id: 'q_tolkien',
    text: 'Not all those who wander are lost.',
    zh: '并非所有流浪者都迷失了方向。',
    source: 'J.R.R. 托尔金 · 《魔戒》',
    link: 'https://en.wikipedia.org/wiki/Not_all_those_who_wander_are_lost',
    tags: ['探索', '人生']
  },
  {
    id: 'q_churchill',
    text: 'Success is not final, failure is not fatal: it is the courage to continue that counts.',
    zh: '成功不是终点，失败也不是末日：重要的是继续前行的勇气。',
    source: '温斯顿·丘吉尔',
    link: 'https://en.wikipedia.org/wiki/Winston_Churchill',
    tags: ['成功', '失败', '勇气']
  },
  {
    id: 'q_jobs',
    text: 'The only way to do great work is to love what you do.',
    zh: '做出伟大成就的唯一方式，就是热爱你所做的事。',
    source: '史蒂夫·乔布斯 · 斯坦福大学毕业演讲',
    link: 'https://en.wikipedia.org/wiki/Steve_Jobs',
    tags: ['热爱', '事业']
  },
  {
    id: 'q_frost',
    text: 'Two roads diverged in a wood, and I—I took the one less traveled by.',
    zh: '林中有两条路，而我选择了人迹更少的那一条。',
    source: '罗伯特·弗罗斯特 · 《未选择的路》',
    link: 'https://en.wikipedia.org/wiki/The_Road_Not_Taken',
    tags: ['选择', '诗歌']
  },
  {
    id: 'q_franklin',
    text: 'Well done is better than well said.',
    zh: '做得好，胜过说得好。',
    source: '本杰明·富兰克林',
    link: 'https://en.wikipedia.org/wiki/Benjamin_Franklin',
    tags: ['行动', '务实']
  }
]

/** 把句子拆成可点击的单词片段（保留标点） */
export function splitWords(text: string): { text: string; isWord: boolean }[] {
  const parts: { text: string; isWord: boolean }[] = []
  const re = /[A-Za-z][A-Za-z'-]*/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push({ text: text.slice(last, m.index), isWord: false })
    parts.push({ text: m[0], isWord: true })
    last = m.index + m[0].length
  }
  if (last < text.length) parts.push({ text: text.slice(last), isWord: false })
  return parts
}
