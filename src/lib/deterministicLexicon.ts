/**
 * 确定性考纲词库与分级算法引擎（Deterministic Lexicon & Exam Grading Engine）
 *
 * 设计原则：
 * 1. 智能体只负责识别与提取意图，分级等级与考点数据完全由确定性算法映射，彻底杜绝大模型幻觉；
 * 2. 内置六级必备、考研必备、雅思核心、托福核心等权威结构化词库；
 * 3. 提供 O(1) 字典查找、考点与熟词生义提取、高频搭配、同反义词与分页换批机制。
 */

export type ExamCategory = 'my' | 'cet6' | 'kaoyan' | 'ielts' | 'toefl'

export interface LexiconWord {
  word: string
  phonetic: string
  pos: string
  levelKey: string
  levelBadge: string
  badgeColor: string
  definition: string
  examPoint?: string
  collocation?: string
  example: { en: string; zh: string }
  synonyms?: string[]
  antonyms?: string[]
  tags: string[]
}

export const EXAM_CATEGORIES: { id: ExamCategory; label: string; icon: string; desc: string }[] = [
  { id: 'my', label: '我的生词', icon: 'BookMarked', desc: '用户自主收录与阅读沉淀的生词' },
  { id: 'cet6', label: '六级必备', icon: 'Award', desc: '大学英语六级 CET-6 高频核心考纲词汇' },
  { id: 'kaoyan', label: '考研必备', icon: 'GraduationCap', desc: '全国硕士研究生统一招生考试英语核心词汇' },
  { id: 'ielts', label: '雅思核心', icon: 'Globe', desc: 'IELTS 学术类高分核心词汇' },
  { id: 'toefl', label: '托福核心', icon: 'Compass', desc: 'TOEFL iBT 顶尖学术精选核心词汇' }
]

export const DETERMINISTIC_LEXICON: Record<string, LexiconWord> = {
  // 六级必备核心词汇
  accumulate: {
    word: 'accumulate',
    phonetic: '/əˈkjuːmjəleɪt/',
    pos: 'v.',
    levelKey: 'cet6',
    levelBadge: '六级核心',
    badgeColor: '#3b82f6',
    definition: '积累，积聚；堆积',
    examPoint: '常考主谓搭配与知识/财富积累语境，注意与 gather、pile up 的近义辨析',
    collocation: 'accumulate knowledge / accumulate wealth',
    example: {
      en: 'Dust began to accumulate on the unused scientific instruments.',
      zh: '闲置的科学仪器上开始积累起灰尘。'
    },
    synonyms: ['amass', 'gather', 'pile up'],
    antonyms: ['disperse', 'dissipate'],
    tags: ['六级必备', '高频词汇']
  },
  acknowledge: {
    word: 'acknowledge',
    phonetic: '/əkˈnɑːlɪdʒ/',
    pos: 'v.',
    levelKey: 'cet6',
    levelBadge: '六级核心',
    badgeColor: '#3b82f6',
    definition: '承认；致谢，表示感谢；确认收到',
    examPoint: '考点：acknowledge receipt of（确认收到信件/通知），写作常用于向资助或导师致谢',
    collocation: 'acknowledge the importance of / acknowledge receipt of',
    example: {
      en: 'The author acknowledged the contribution of the research team.',
      zh: '作者对研究团队的贡献表示了致谢。'
    },
    synonyms: ['admit', 'recognize', 'concede'],
    antonyms: ['deny', 'disclaim'],
    tags: ['六级必备', '学术写作']
  },
  adequate: {
    word: 'adequate',
    phonetic: '/ˈædɪkwət/',
    pos: 'adj.',
    levelKey: 'cet6',
    levelBadge: '六级核心',
    badgeColor: '#3b82f6',
    definition: '充足的，足够的；胜任的',
    examPoint: '与 sufficient 的辨析：adequate 强调满足特定最低需求，sufficient 强调量上充分',
    collocation: 'adequate preparation / adequate funding',
    example: {
      en: 'The experimental group received adequate nutritional support.',
      zh: '实验组得到了充足的营养支持。'
    },
    synonyms: ['sufficient', 'ample', 'enough'],
    antonyms: ['inadequate', 'insufficient'],
    tags: ['六级必备', '实验描述']
  },
  advocate: {
    word: 'advocate',
    phonetic: '/ˈædvəkeɪt/',
    pos: 'v. & n.',
    levelKey: 'cet6',
    levelBadge: '六级核心',
    badgeColor: '#3b82f6',
    definition: 'v. 主张，提倡；n. 倡导者，拥护者',
    examPoint: '后接名词或动名词（advocate doing sth.），不能接不定式',
    collocation: 'advocate for policy reform / strong advocate',
    example: {
      en: 'Many environmental scientists advocate reducing carbon emissions.',
      zh: '许多环境科学家倡导减少碳排放。'
    },
    synonyms: ['champion', 'promote', 'endorse'],
    antonyms: ['oppose', 'discourage'],
    tags: ['六级必备', '学术观点']
  },
  ambiguous: {
    word: 'ambiguous',
    phonetic: '/æmˈbɪɡjuəs/',
    pos: 'adj.',
    levelKey: 'cet6',
    levelBadge: '六级核心',
    badgeColor: '#3b82f6',
    definition: '模棱两可的，含糊不清的',
    examPoint: '常用于批判现有文献研究假设不明确或实验结论模糊',
    collocation: 'ambiguous statement / ambiguous findings',
    example: {
      en: 'The preliminary data yielded ambiguous results.',
      zh: '初步数据产生了模棱两可的结果。'
    },
    synonyms: ['vague', 'equivocal', 'obscure'],
    antonyms: ['explicit', 'clear', 'unambiguous'],
    tags: ['六级必备', '结果讨论']
  },
  allocate: {
    word: 'allocate',
    phonetic: '/ˈæləkeɪt/',
    pos: 'v.',
    levelKey: 'cet6',
    levelBadge: '六级核心',
    badgeColor: '#3b82f6',
    definition: '分配，配给；拨出',
    examPoint: '常考搭配 allocate sth. to/for sth.，主要用于资源、算力与预算分配',
    collocation: 'allocate resources / allocate budget to',
    example: {
      en: 'The department allocated computing resources for the deep learning project.',
      zh: '该部门为深度学习项目分配了计算资源。'
    },
    synonyms: ['assign', 'distribute', 'allot'],
    antonyms: ['withhold', 'gather'],
    tags: ['六级必备', '资源管理']
  },
  compile: {
    word: 'compile',
    phonetic: '/kəmˈpaɪl/',
    pos: 'v.',
    levelKey: 'cet6',
    levelBadge: '六级核心',
    badgeColor: '#3b82f6',
    definition: '汇编，编制，搜集；[计] 编译',
    examPoint: '文献综述中常用于“汇编数据集”或“编译调查结果”',
    collocation: 'compile a dataset / compile a comprehensive survey',
    example: {
      en: 'We compiled a benchmark dataset from multiple open-source repositories.',
      zh: '我们从多个开源仓库中汇编了一个基准数据集。'
    },
    synonyms: ['assemble', 'gather', 'organize'],
    antonyms: ['disperse', 'scatter'],
    tags: ['六级必备', '数据集构建']
  },
  compensate: {
    word: 'compensate',
    phonetic: '/ˈkɑːmpenseɪt/',
    pos: 'v.',
    levelKey: 'cet6',
    levelBadge: '六级核心',
    badgeColor: '#3b82f6',
    definition: '补偿，弥补；赔偿',
    examPoint: '常考搭配 compensate for sth.（弥补某方面的缺陷或性能损失）',
    collocation: 'compensate for the loss / compensate for error',
    example: {
      en: 'The proposed algorithm compensates for sensor noise effectively.',
      zh: '所提出的算法有效地弥补了传感器噪声。'
    },
    synonyms: ['make up for', 'offset', 'counterbalance'],
    antonyms: ['deprive', 'damage'],
    tags: ['六级必备', '算法改进']
  },
  conceive: {
    word: 'conceive',
    phonetic: '/kənˈsiːv/',
    pos: 'v.',
    levelKey: 'cet6',
    levelBadge: '六级核心',
    badgeColor: '#3b82f6',
    definition: '构想出，设想；怀孕',
    examPoint: '常考搭配 conceive of sth.（设想某种概念/理论架构）',
    collocation: 'conceive a novel architecture / conceive of',
    example: {
      en: 'The theoretical model was originally conceived in the early 1990s.',
      zh: '该理论模型最初构想于20世纪90年代初。'
    },
    synonyms: ['devise', 'formulate', 'envisage'],
    antonyms: ['disregard', 'destroy'],
    tags: ['六级必备', '理论提出']
  },
  deteriorate: {
    word: 'deteriorate',
    phonetic: '/dɪˈtɪriəreɪt/',
    pos: 'v.',
    levelKey: 'cet6',
    levelBadge: '六级核心',
    badgeColor: '#3b82f6',
    definition: '恶化，退化，变坏',
    examPoint: '描述模型泛化性能或系统健康状态下降时的顶刊高频动词',
    collocation: 'performance deteriorates / conditions deteriorate',
    example: {
      en: 'The classification accuracy deteriorates when noise levels increase.',
      zh: '当噪声水平增加时，分类准确率出现恶化。'
    },
    synonyms: ['worsen', 'decline', 'degenerate'],
    antonyms: ['improve', 'enhance', 'ameliorate'],
    tags: ['六级必备', '性能分析']
  },

  // 考研必备高频核心词汇
  comprehensive: {
    word: 'comprehensive',
    phonetic: '/ˌkɑːmprɪˈhensɪv/',
    pos: 'adj.',
    levelKey: 'kaoyan',
    levelBadge: '考研必备',
    badgeColor: '#8b5cf6',
    definition: '全面的，综合性的；详尽的',
    examPoint: '熟词生义考点：comprehensive university（综合性大学），写作高频搭配 comprehensive review',
    collocation: 'comprehensive overview / comprehensive evaluation',
    example: {
      en: 'The survey provides a comprehensive analysis of state-of-the-art methods.',
      zh: '这篇综述对最先进的方法进行了全面的分析。'
    },
    synonyms: ['exhaustive', 'thorough', 'all-inclusive'],
    antonyms: ['partial', 'superficial', 'limited'],
    tags: ['考研必备', '文献综述']
  },
  subsequent: {
    word: 'subsequent',
    phonetic: '/ˈsʌbsɪkwənt/',
    pos: 'adj.',
    levelKey: 'kaoyan',
    levelBadge: '考研必备',
    badgeColor: '#8b5cf6',
    definition: '随后的，后来的；接续的',
    examPoint: '常考搭配 subsequent to（在……之后），用于描述实验前后时序与衍生工作',
    collocation: 'subsequent studies / subsequent experiments',
    example: {
      en: 'Subsequent research confirmed the validity of the hypothesis.',
      zh: '随后的研究证实了该假设的有效性。'
    },
    synonyms: ['following', 'succeeding', 'consequent'],
    antonyms: ['previous', 'prior', 'antecedent'],
    tags: ['考研必备', '实验流程']
  },
  perspective: {
    word: 'perspective',
    phonetic: '/pərˈspektɪv/',
    pos: 'n.',
    levelKey: 'kaoyan',
    levelBadge: '考研必备',
    badgeColor: '#8b5cf6',
    definition: '视角，观点；透视法；远景',
    examPoint: '考点搭配 from the perspective of...（从……视角出发），阅读理解核心题眼',
    collocation: 'from a theoretical perspective / broad perspective',
    example: {
      en: 'We analyze the optimization landscape from an information-theoretic perspective.',
      zh: '我们从信息论的视角分析优化曲面。'
    },
    synonyms: ['viewpoint', 'standpoint', 'angle'],
    antonyms: ['blindness', 'narrowness'],
    tags: ['考研必备', '方法视角']
  },
  arbitrary: {
    word: 'arbitrary',
    phonetic: '/ˈɑːrbətreri/',
    pos: 'adj.',
    levelKey: 'kaoyan',
    levelBadge: '考研必备',
    badgeColor: '#8b5cf6',
    definition: '任意的，武断的；专制的',
    examPoint: '学术论文常用于说明“非任意选定超参数”或“支持任意维度的输入”',
    collocation: 'arbitrary choice / arbitrary shape / not arbitrary',
    example: {
      en: 'The hyperparameters were not chosen in an arbitrary manner.',
      zh: '超参数的选择并非采用武断或任意的方式。'
    },
    synonyms: ['random', 'discretionary', 'capricious'],
    antonyms: ['systematic', 'rational', 'reasoned'],
    tags: ['考研必备', '实验严谨性']
  },
  prevalent: {
    word: 'prevalent',
    phonetic: '/ˈprevələnt/',
    pos: 'adj.',
    levelKey: 'kaoyan',
    levelBadge: '考研必备',
    badgeColor: '#8b5cf6',
    definition: '盛行的，普遍存在的；流行的',
    examPoint: '常用于引言段描述当前领域普遍存在的研究范式或未解挑战',
    collocation: 'prevalent assumption / prevalent paradigm',
    example: {
      en: 'Self-supervised pre-training has become prevalent across multimodal tasks.',
      zh: '自监督预训练在多模态任务中已变得极为盛行。'
    },
    synonyms: ['widespread', 'ubiquitous', 'pervasive'],
    antonyms: ['rare', 'scarce', 'isolated'],
    tags: ['考研必备', '背景描述']
  },
  vulnerable: {
    word: 'vulnerable',
    phonetic: '/ˈvʌlnərəbl/',
    pos: 'adj.',
    levelKey: 'kaoyan',
    levelBadge: '考研必备',
    badgeColor: '#8b5cf6',
    definition: '易受伤害的，脆弱的；有安全漏洞的',
    examPoint: '考点搭配 vulnerable to（易受……攻击/干扰），安全与鲁棒性核心词',
    collocation: 'vulnerable to adversarial attacks / vulnerable system',
    example: {
      en: 'Deep neural networks remain vulnerable to subtle adversarial perturbations.',
      zh: '深度神经网络对于细微的对抗扰动仍然十分脆弱。'
    },
    synonyms: ['susceptible', 'fragile', 'defenseless'],
    antonyms: ['robust', 'invulnerable', 'resilient'],
    tags: ['考研必备', '鲁棒性分析']
  },
  plausible: {
    word: 'plausible',
    phonetic: '/ˈplɔːzəbl/',
    pos: 'adj.',
    levelKey: 'kaoyan',
    levelBadge: '考研必备',
    badgeColor: '#8b5cf6',
    definition: '合理的，貌似可信的；说得通的',
    examPoint: '用于讨论某种机理解释或假设的合理性，顶刊审稿高频词',
    collocation: 'plausible explanation / biologically plausible',
    example: {
      en: 'The authors proposed a biologically plausible mechanism for synaptic plasticity.',
      zh: '作者为突触可塑性提出了一种生物学上合理的机制。'
    },
    synonyms: ['credible', 'reasonable', 'believable'],
    antonyms: ['implausible', 'unlikely', 'absurd'],
    tags: ['考研必备', '机理解释']
  },
  reinforce: {
    word: 'reinforce',
    phonetic: '/ˌriːɪnˈfɔːrs/',
    pos: 'v.',
    levelKey: 'kaoyan',
    levelBadge: '考研必备',
    badgeColor: '#8b5cf6',
    definition: '增强，加强；巩固；[计] 强化',
    examPoint: '熟词生义：Reinforcement Learning（强化学习），动词用于加强结论或理论依据',
    collocation: 'reinforce the conclusion / reinforce learning',
    example: {
      en: 'Our empirical ablation experiments reinforce the core claim of the paper.',
      zh: '我们的实证消融实验增强了本文的核心论点。'
    },
    synonyms: ['strengthen', 'fortify', 'bolster'],
    antonyms: ['undermine', 'weaken', 'diminish'],
    tags: ['考研必备', '论证支持']
  },
  undermine: {
    word: 'undermine',
    phonetic: '/ˌʌndərˈmaɪn/',
    pos: 'v.',
    levelKey: 'kaoyan',
    levelBadge: '考研必备',
    badgeColor: '#8b5cf6',
    definition: '逐渐削弱，损害；从根基上破坏',
    examPoint: '考研真题高频题眼词，用于指出某种偏差会削弱实验结论的有效性',
    collocation: 'undermine the validity / undermine generalization',
    example: {
      en: 'Data leakage can severely undermine the validity of benchmark evaluations.',
      zh: '数据泄露会严重破坏基准评估的有效性。'
    },
    synonyms: ['weaken', 'compromise', 'sabotage'],
    antonyms: ['reinforce', 'bolster', 'support'],
    tags: ['考研必备', '批判反思']
  },
  inevitable: {
    word: 'inevitable',
    phonetic: '/ɪnˈevɪtəbl/',
    pos: 'adj.',
    levelKey: 'kaoyan',
    levelBadge: '考研必备',
    badgeColor: '#8b5cf6',
    definition: '不可避免的，必然发生的',
    examPoint: '写作高频句式：It is inevitable that...（……是不可避免的）',
    collocation: 'inevitable consequence / inevitable trade-off',
    example: {
      en: 'There is an inevitable trade-off between computational cost and accuracy.',
      zh: '在计算成本与准确率之间存在着不可避免的权衡。'
    },
    synonyms: ['unavoidable', 'inescapable', 'fated'],
    antonyms: ['avoidable', 'preventable', 'uncertain'],
    tags: ['考研必备', '权衡讨论']
  },

  // 雅思核心高频学术词汇
  coherent: {
    word: 'coherent',
    phonetic: '/koʊˈhɪrənt/',
    pos: 'adj.',
    levelKey: 'ielts',
    levelBadge: '雅思核心',
    badgeColor: '#10b981',
    definition: '条理连贯的，逻辑一致的；相干的',
    examPoint: '雅思官方写作四大评分标准之一 Coherence and Cohesion（连贯与衔接）的核心词根',
    collocation: 'coherent argument / coherent narrative',
    example: {
      en: 'The essay presents a clear and coherent argument supporting renewable energy.',
      zh: '这篇短文提出了支持可再生能源的清晰且连贯的论点。'
    },
    synonyms: ['logical', 'consistent', 'lucid'],
    antonyms: ['incoherent', 'disjointed', 'confused'],
    tags: ['雅思核心', '写作评分']
  },
  diverse: {
    word: 'diverse',
    phonetic: '/daɪˈvɜːrs/',
    pos: 'adj.',
    levelKey: 'ielts',
    levelBadge: '雅思核心',
    badgeColor: '#10b981',
    definition: '多元的，各式各样的；不同的',
    examPoint: '大作文社会文化/教育/科技类话题极其高频，搭配 diverse perspectives/backgrounds',
    collocation: 'diverse backgrounds / diverse applications',
    example: {
      en: 'Modern universities bring together students from diverse cultural backgrounds.',
      zh: '现代大学汇聚了来自不同文化背景的学生。'
    },
    synonyms: ['varied', 'heterogeneous', 'multifaceted'],
    antonyms: ['homogeneous', 'uniform', 'identical'],
    tags: ['雅思核心', '大作文高频']
  },
  innovative: {
    word: 'innovative',
    phonetic: '/ˈɪnəveɪtɪv/',
    pos: 'adj.',
    levelKey: 'ielts',
    levelBadge: '雅思核心',
    badgeColor: '#10b981',
    definition: '创新的，革新性的；富有创意的',
    examPoint: '雅思考官高分替换词，可替代简单的 new 或 creative',
    collocation: 'innovative solutions / innovative methodology',
    example: {
      en: 'Governments should invest in innovative solutions to tackle urban congestion.',
      zh: '政府应当投资于创新的解决方案以解决城市交通拥堵。'
    },
    synonyms: ['groundbreaking', 'pioneering', 'novel'],
    antonyms: ['conventional', 'traditional', 'outdated'],
    tags: ['雅思核心', '高分替换']
  },
  substantial: {
    word: 'substantial',
    phonetic: '/səbˈstænʃl/',
    pos: 'adj.',
    levelKey: 'ielts',
    levelBadge: '雅思核心',
    badgeColor: '#10b981',
    definition: '大量的，实质性的；重大的',
    examPoint: '小作文图表描述（Task 1）描述显著增长的核心词汇，如 a substantial increase',
    collocation: 'substantial increase / substantial improvement',
    example: {
      en: 'The chart illustrates a substantial increase in public transport usage.',
      zh: '该图表展示了公共交通使用量的显著增长。'
    },
    synonyms: ['significant', 'considerable', 'dramatic'],
    antonyms: ['negligible', 'minor', 'slight'],
    tags: ['雅思核心', '图表写作']
  },
  facilitate: {
    word: 'facilitate',
    phonetic: '/fəˈsɪlɪteɪt/',
    pos: 'v.',
    levelKey: 'ielts',
    levelBadge: '雅思核心',
    badgeColor: '#10b981',
    definition: '促进，使便利；推动',
    examPoint: '动词及物，直接接宾语，常替代简单的 help 或 make easy',
    collocation: 'facilitate communication / facilitate learning',
    example: {
      en: 'Digital platforms facilitate cross-border collaboration between scholars.',
      zh: '数字平台促进了学者之间的跨国协作。'
    },
    synonyms: ['promote', 'expedite', 'assist'],
    antonyms: ['hinder', 'obstruct', 'impede'],
    tags: ['雅思核心', '高级动词']
  },
  justify: {
    word: 'justify',
    phonetic: '/ˈdʒʌstɪfaɪ/',
    pos: 'v.',
    levelKey: 'ielts',
    levelBadge: '雅思核心',
    badgeColor: '#10b981',
    definition: '证明……是正当的；为……辩护',
    examPoint: '用于论证某个政策、开销或实验设计的正当性与必要性',
    collocation: 'justify the investment / justify the cost',
    example: {
      en: 'The anticipated benefits fully justify the high initial investment.',
      zh: '预期的收益充分证明了高昂初期投资的正当性。'
    },
    synonyms: ['vindicate', 'validate', 'substantiate'],
    antonyms: ['condemn', 'disprove', 'invalidate'],
    tags: ['雅思核心', '论述辩护']
  },
  perceive: {
    word: 'perceive',
    phonetic: '/pərˈsiːv/',
    pos: 'v.',
    levelKey: 'ielts',
    levelBadge: '雅思核心',
    badgeColor: '#10b981',
    definition: '感知，察觉；理解，看待',
    examPoint: '常考搭配 be perceived as（被普遍认为是……）',
    collocation: 'perceive as / perceive a threat',
    example: {
      en: 'Artificial intelligence is widely perceived as a catalyst for industrial transformation.',
      zh: '人工智能被广泛视为工业转型的催化剂。'
    },
    synonyms: ['discern', 'regard', 'comprehend'],
    antonyms: ['overlook', 'misunderstand', 'ignore'],
    tags: ['雅思核心', '观点转述']
  },
  specify: {
    word: 'specify',
    phonetic: '/ˈspesɪfaɪ/',
    pos: 'v.',
    levelKey: 'ielts',
    levelBadge: '雅思核心',
    badgeColor: '#10b981',
    definition: '明确指定，具体说明；列举',
    examPoint: '强调清晰、具体无歧义地给出参数或条件',
    collocation: 'specify parameters / clearly specify',
    example: {
      en: 'The protocol specifies the exact temperature range required for the reaction.',
      zh: '该方案明确指定了反应所需的精确温度范围。'
    },
    synonyms: ['designate', 'state', 'itemise'],
    antonyms: ['generalize', 'obscure'],
    tags: ['雅思核心', '方法规范']
  },

  // 托福核心学术精选词汇
  abundant: {
    word: 'abundant',
    phonetic: '/əˈbʌndənt/',
    pos: 'adj.',
    levelKey: 'toefl',
    levelBadge: '托福核心',
    badgeColor: '#f59e0b',
    definition: '丰富的，充裕的；大量的',
    examPoint: '托福自然科学（生态学/地质学）听力与阅读高频核心词汇',
    collocation: 'abundant resources / abundant evidence',
    example: {
      en: 'The tropical rainforest provides an abundant supply of nutrients.',
      zh: '热带雨林提供了丰富充裕的养分供给。'
    },
    synonyms: ['plentiful', 'copious', 'bountiful'],
    antonyms: ['scarce', 'sparse', 'meager'],
    tags: ['托福核心', '自然科学']
  },
  accelerate: {
    word: 'accelerate',
    phonetic: '/əkˈseləreɪt/',
    pos: 'v.',
    levelKey: 'toefl',
    levelBadge: '托福核心',
    badgeColor: '#f59e0b',
    definition: '加速，加快；促进',
    examPoint: '描述化学反应速率、气候变化趋势或演化进程加速',
    collocation: 'accelerate the process / accelerate climate change',
    example: {
      en: 'Catalysts are used to accelerate the rate of chemical reactions.',
      zh: '催化剂被用来加快化学反应的速率。'
    },
    synonyms: ['speed up', 'quicken', 'hasten'],
    antonyms: ['decelerate', 'retard', 'slow down'],
    tags: ['托福核心', '反应与演化']
  },
  converge: {
    word: 'converge',
    phonetic: '/kənˈvɜːrdʒ/',
    pos: 'v.',
    levelKey: 'toefl',
    levelBadge: '托福核心',
    badgeColor: '#f59e0b',
    definition: '汇聚，集中；[数] 收敛',
    examPoint: '托福生物学/地质学/计算机考点，如生物趋同演化（convergent evolution）与算法收敛',
    collocation: 'converge on a solution / convergent evolution',
    example: {
      en: 'The optimization algorithm converges rapidly within a few iterations.',
      zh: '该优化算法在几次迭代之内迅速收敛。'
    },
    synonyms: ['merge', 'intersect', 'coincide'],
    antonyms: ['diverge', 'separate', 'branch'],
    tags: ['托福核心', '跨学科概念']
  },
  derive: {
    word: 'derive',
    phonetic: '/dɪˈraɪv/',
    pos: 'v.',
    levelKey: 'toefl',
    levelBadge: '托福核心',
    badgeColor: '#f59e0b',
    definition: '源于，起源于；导出，推导；获得',
    examPoint: '常考搭配 derive from（起源于……）与 be derived from（由……推导得出）',
    collocation: 'derive from / derive theoretical bounds',
    example: {
      en: 'Many modern pharmaceuticals are derived from plant compounds.',
      zh: '许多现代药物都源自植物化合物。'
    },
    synonyms: ['originate', 'stem from', 'deduce'],
    antonyms: ['generate', 'create'],
    tags: ['托福核心', '溯源与推导']
  },
  inhibit: {
    word: 'inhibit',
    phonetic: '/ɪnˈhɪbɪt/',
    pos: 'v.',
    levelKey: 'toefl',
    levelBadge: '托福核心',
    badgeColor: '#f59e0b',
    definition: '抑制，阻止；妨碍',
    examPoint: '托福生物医学与化学阅读极其高频，如抑制酶活性或细胞过度增殖',
    collocation: 'inhibit enzyme activity / inhibit growth',
    example: {
      en: 'The chemical compound acts to inhibit the replication of viral cells.',
      zh: '该化合物能够抑制病毒细胞的复制。'
    },
    synonyms: ['suppress', 'restrain', 'impede'],
    antonyms: ['stimulate', 'facilitate', 'encourage'],
    tags: ['托福核心', '生化机制']
  },
  integrate: {
    word: 'integrate',
    phonetic: '/ˈɪntɪɡreɪt/',
    pos: 'v.',
    levelKey: 'toefl',
    levelBadge: '托福核心',
    badgeColor: '#f59e0b',
    definition: '整合，使一体化；[数] 积分',
    examPoint: '搭配 integrate A into/with B（将A整合并入B中）',
    collocation: 'integrate into the system / seamless integration',
    example: {
      en: 'The new module integrates seamlessly with the existing software stack.',
      zh: '新模块与现有的软件栈实现了无缝整合。'
    },
    synonyms: ['incorporate', 'assimilate', 'synthesize'],
    antonyms: ['segregate', 'isolate', 'separate'],
    tags: ['托福核心', '系统集成']
  },
  resilient: {
    word: 'resilient',
    phonetic: '/rɪˈzɪliənt/',
    pos: 'adj.',
    levelKey: 'toefl',
    levelBadge: '托福核心',
    badgeColor: '#f59e0b',
    definition: '有弹性的；有韧性的，适应力强的',
    examPoint: '常用于描述生态系统或分布式系统在经受扰动后迅速恢复的能力',
    collocation: 'resilient ecosystem / resilient infrastructure',
    example: {
      en: 'Mangrove forests are remarkably resilient to coastal storm surges.',
      zh: '红树林对沿海风暴潮具有极强的抵御韧性。'
    },
    synonyms: ['elastic', 'tenacious', 'adaptable'],
    antonyms: ['fragile', 'vulnerable', 'brittle'],
    tags: ['托福核心', '生态与韧性']
  },
  trigger: {
    word: 'trigger',
    phonetic: '/ˈtrɪɡər/',
    pos: 'v. & n.',
    levelKey: 'toefl',
    levelBadge: '托福核心',
    badgeColor: '#f59e0b',
    definition: 'v. 触发，引起；n. 扳机；诱因',
    examPoint: '表示因果链条中的诱发因素，常替代 cause 或 initiate',
    collocation: 'trigger an immune response / trigger a chain reaction',
    example: {
      en: 'Elevated greenhouse gas levels trigger a series of feedback mechanisms.',
      zh: '温室气体水平升高触发了一系列反馈机制。'
    },
    synonyms: ['precipitate', 'instigate', 'spark'],
    antonyms: ['halt', 'suppress', 'prevent'],
    tags: ['托福核心', '因果机制']
  }
}

/**
 * 确定性词典匹配：O(1) 精准检索
 */
export function getDeterministicLexiconEntry(word: string): LexiconWord | null {
  const clean = word.trim().toLowerCase()
  if (!clean) return null
  return DETERMINISTIC_LEXICON[clean] || null
}

/**
 * 确定性考纲分级算法：
 * 输入单词数组，确定性匹配考纲等级、考点与搭配。
 * 纯算法映射，无 LLM 随机幻觉！
 */
export function deterministicGradeWords(words: string[]): {
  word: string
  level: string
  levelBadge: string
  badgeColor: string
  examTags: string[]
  examPoint?: string
  collocation?: string
  isDeterministic: boolean
}[] {
  return words.map((raw) => {
    const w = raw.trim().toLowerCase()
    const hit = DETERMINISTIC_LEXICON[w]
    if (hit) {
      return {
        word: hit.word,
        level: hit.levelKey,
        levelBadge: hit.levelBadge,
        badgeColor: hit.badgeColor,
        examTags: hit.tags,
        examPoint: hit.examPoint,
        collocation: hit.collocation,
        isDeterministic: true
      }
    }
    // 未在内置库中收录时的规则启发式兜底
    return {
      word: raw.trim(),
      level: 'unrated',
      levelBadge: '待评级',
      badgeColor: '#94a3b8',
      examTags: ['通用词汇'],
      isDeterministic: false
    }
  })
}

/**
 * 获取指定考纲词库列表（支持分页与换一批）
 */
export function getExamLexiconList(
  category: ExamCategory,
  page = 1,
  pageSize = 5
): {
  total: number
  page: number
  totalPages: number
  items: LexiconWord[]
} {
  const allWords = Object.values(DETERMINISTIC_LEXICON)
  const filtered =
    category === 'my'
      ? allWords
      : allWords.filter((w) => w.levelKey === category)

  const total = filtered.length
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const validPage = Math.min(Math.max(1, page), totalPages)
  const start = (validPage - 1) * pageSize
  const items = filtered.slice(start, start + pageSize)

  return {
    total,
    page: validPage,
    totalPages,
    items
  }
}

/**
 * 在确定性考纲词库中全文搜索
 */
export function searchExamLexicon(keyword: string): LexiconWord[] {
  const q = keyword.trim().toLowerCase()
  if (!q) return []
  return Object.values(DETERMINISTIC_LEXICON).filter(
    (w) =>
      w.word.toLowerCase().includes(q) ||
      w.definition.includes(q) ||
      (w.examPoint && w.examPoint.includes(q)) ||
      (w.collocation && w.collocation.includes(q))
  )
}
