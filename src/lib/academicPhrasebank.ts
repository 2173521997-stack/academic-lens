/* =====================================================================
 * 曼彻斯特大学学术写作句型库（Academic Phrasebank 精选）
 * 覆盖 6 大核心场景：引言陈述、方法描述、结果对比、讨论阐释、结论总结、局限性表达
 * ===================================================================== */

export interface PhraseCategory {
  id: string
  name: string
  icon: string
  description: string
  subcategories: {
    name: string
    phrases: { en: string; zh: string; tip?: string }[]
  }[]
}

export const ACADEMIC_PHRASEBANK: PhraseCategory[] = [
  {
    id: 'intro',
    name: '引言与背景陈述 (Introduction)',
    icon: '🌟',
    description: '建立研究重要性、指出领域现有研究空白与提出核心假设',
    subcategories: [
      {
        name: '强调研究领域的重要性',
        phrases: [
          { en: 'In recent years, there has been an increasing interest in ...', zh: '近年来，人们对……的研究兴趣日益浓厚。' },
          { en: '... plays a pivotal role in maintaining the stability of ...', zh: '……在维持……的稳定性方面起着举足轻重的作用。' },
          { en: 'The issue of ... has received considerable critical attention in recent decades.', zh: '近几十年来，……问题受到了广泛而审慎的关注。' }
        ]
      },
      {
        name: '指出既有研究空白 (Research Gap)',
        phrases: [
          { en: 'However, few studies have systematically investigated the mechanism of ...', zh: '然而，很少有研究系统地探讨……的机制。' },
          { en: 'Despite its critical importance, the precise role of ... remains elusive.', zh: '尽管至关重要，但……的确切作用仍未明确。' },
          { en: 'Previous research has primarily focused on ..., leaving ... largely unexplored.', zh: '先前的研究主要集中在……，使得……在很大程度上未被探索。' }
        ]
      },
      {
        name: '阐述本研究目的与贡献',
        phrases: [
          { en: 'The primary objective of this paper is to bridge this gap by introducing ...', zh: '本文的主要目的是通过引入……来填补这一空白。' },
          { en: 'We propose a novel framework that synergistically combines ... and ...', zh: '我们提出了一种新颖的框架，将……与……协同结合。' }
        ]
      }
    ]
  },
  {
    id: 'method',
    name: '研究方法与设计 (Methodology)',
    icon: '🔬',
    description: '描述实验设置、算法架构、样本选择与变量控制',
    subcategories: [
      {
        name: '描述系统与算法流程',
        phrases: [
          { en: 'To achieve this, the system is designed to iteratively optimize ...', zh: '为此，该系统被设计为迭代优化……' },
          { en: 'Formally, we define the objective function as follows: ...', zh: '形式上，我们将目标函数定义如下：……' },
          { en: 'The model architecture consists of three distinct yet interconnected modules: ...', zh: '该模型架构由三个不同但相互连接的模块组成：……' }
        ]
      },
      {
        name: '说明参数设定与基线对比',
        phrases: [
          { en: 'All hyperparameters were empirically tuned based on the validation set.', zh: '所有超参数均基于验证集进行了经验调优。' },
          { en: 'For fair comparison, all baseline models were trained under identical conditions.', zh: '为了公平对比，所有基线模型均在相同条件下进行训练。' }
        ]
      }
    ]
  },
  {
    id: 'results',
    name: '实验结果与对比 (Results & Comparison)',
    icon: '📊',
    description: '呈现数据发现、显著性对比、消融实验与性能提升',
    subcategories: [
      {
        name: '报告性能提升与 SOTA 表现',
        phrases: [
          { en: 'As illustrated in Table 1, our proposed method consistently outperforms all existing baselines across all benchmark datasets.', zh: '如表 1 所示，我们提出的方法在所有基准数据集上均持续优于所有现有基线。' },
          { en: 'Specifically, our approach yields a substantial improvement of 4.2% in terms of ...', zh: '具体而言，我们的方法在……指标上实现了 4.2% 的显著提升。' }
        ]
      },
      {
        name: '消融实验与组件分析 (Ablation Study)',
        phrases: [
          { en: 'To dissect the individual contribution of each component, we conduct an extensive ablation study.', zh: '为了剖析各组件的单独贡献，我们进行了详尽的消融实验。' },
          { en: 'Removing the attention module leads to a noticeable degradation in performance, corroborating its indispensability.', zh: '移除注意力模块会导致性能明显下降，证实了其不可或缺性。' }
        ]
      }
    ]
  },
  {
    id: 'discussion',
    name: '讨论与机理解释 (Discussion)',
    icon: '💡',
    description: '阐释实验现象背后的机理、与前人工作的异同',
    subcategories: [
      {
        name: '合理解释实验现象',
        phrases: [
          { en: 'A plausible explanation for this phenomenon is that ...', zh: '对这一现象的一个合理解释是……' },
          { en: 'These findings are in good agreement with earlier observations reported by Smith et al. (2022).', zh: '这些发现与 Smith 等人 (2022) 报道的早期观察结果高度吻合。' }
        ]
      }
    ]
  },
  {
    id: 'limitations',
    name: '局限性与未来展望 (Limitations & Future Work)',
    icon: '⚖️',
    description: '客观指出实验约束、算力开销或未来拓展方向',
    subcategories: [
      {
        name: '委婉说明研究局限',
        phrases: [
          { en: 'A potential limitation of the current work is the reliance on ...', zh: '当前工作的一个潜在局限性是对……的依赖。' },
          { en: 'Due to computational constraints, we were unable to scale the experiments to ...', zh: '由于算力限制，我们未能将实验扩展至……' },
          { en: 'Future research should therefore focus on extending this paradigm to multimodal domains.', zh: '因此，未来的研究应侧重于将该范式扩展到多模态领域。' }
        ]
      }
    ]
  }
]

/** 根据关键词模糊搜索学术句型 */
export function searchPhrasebank(keyword: string): { category: string; subcategory: string; en: string; zh: string }[] {
  const kw = keyword.trim().toLowerCase()
  if (!kw) return []
  const results: { category: string; subcategory: string; en: string; zh: string }[] = []

  for (const cat of ACADEMIC_PHRASEBANK) {
    for (const sub of cat.subcategories) {
      for (const phrase of sub.phrases) {
        if (
          phrase.en.toLowerCase().includes(kw) ||
          phrase.zh.toLowerCase().includes(kw) ||
          sub.name.toLowerCase().includes(kw) ||
          cat.name.toLowerCase().includes(kw)
        ) {
          results.push({
            category: cat.name,
            subcategory: sub.name,
            en: phrase.en,
            zh: phrase.zh
          })
        }
      }
    }
  }

  return results.slice(0, 10)
}
