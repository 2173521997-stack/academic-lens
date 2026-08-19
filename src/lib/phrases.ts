/* =====================================================================
 * 常见短语识别（小窗一键翻译用）
 *
 * 目标：让常见短语像单词一样走词卡展示（释义 + 例句），而不是普通直译。
 * 判定分两层：
 *   1) 精选短语表精确命中（含学术常用短语 + CS 领域术语）；
 *   2) 兜底规则：2–3 个纯字母单词的短短语也按短语处理。
 * 注意：多词短语必须绕过 cleanWord（它只取第一个单词），直走 LLM 词卡。
 * ===================================================================== */

/** 精选常见短语（小写、单词间单空格；匹配时大小写/多余空格不敏感，容忍尾部标点） */
const PHRASES: string[] = [
  // 学术/写作常用
  'as well as', 'such as', 'due to', 'in order to', 'in terms of', 'with respect to', 'with regard to',
  'in relation to', 'in accordance with', 'according to', 'apart from', 'because of', 'instead of',
  'regardless of', 'on behalf of', 'by means of', 'in spite of', 'in spite of the fact that',
  'for example', 'for instance', 'in addition', 'in addition to', 'in contrast', 'in comparison with',
  'on the contrary', 'on the other hand', 'as a result', 'as a result of', 'as a consequence',
  'in consequence', 'in the meantime', 'at the same time', 'in the long run', 'in the short run',
  'in the end', 'at the end of the day', 'in general', 'in particular', 'in fact', 'in practice',
  'in theory', 'in principle', 'in other words', 'in a nutshell', 'in a word', 'in brief',
  'in short', 'to sum up', 'to conclude', 'in conclusion', 'to some extent', 'to a large extent',
  'in some cases', 'in most cases', 'in this case', 'in that case', 'in any case', 'in no case',
  'more or less', 'by and large', 'so far', 'so far so good', 'up to now', 'from now on',
  'from time to time', 'now and then', 'once in a while', 'all of a sudden', 'at first glance',
  'at first sight', 'in the first place', 'in the second place', 'last but not least',
  'first of all', 'above all', 'after all', 'all in all', 'at all', 'at least', 'at most',
  'at once', 'at present', 'at random', 'at stake', 'at will', 'by accident', 'by chance',
  'by far', 'by heart', 'by mistake', 'by no means', 'in vain', 'in advance', 'in detail',
  'in turn', 'in return', 'in public', 'in private', 'in silence', 'in a hurry', 'in a sense',
  'out of date', 'up to date', 'out of order', 'out of control', 'under control', 'under way',
  'on time', 'in time', 'on purpose', 'on the contrary', 'on the whole', 'on average',
  'in depth', 'in width', 'in height', 'in length', 'in size', 'in number', 'in shape',
  'in color', 'in price', 'in value', 'in weight', 'in spirit', 'in name', 'in reality',
  'in fact', 'in effect', 'in essence', 'in nature', 'in origin', 'in character', 'in quality',
  // CS / 技术领域常见术语
  'deep learning', 'machine learning', 'reinforcement learning', 'supervised learning',
  'unsupervised learning', 'semi supervised learning', 'transfer learning', 'federated learning',
  'neural network', 'convolutional neural network', 'recurrent neural network', 'graph neural network',
  'large language model', 'language model', 'natural language processing', 'computer vision',
  'computer science', 'software engineering', 'software development', 'programming language',
  'source code', 'open source', 'application programming interface', 'user interface',
  'user experience', 'operating system', 'database management', 'data structure', 'data mining',
  'data warehouse', 'big data', 'cloud computing', 'edge computing', 'distributed system',
  'distributed computing', 'parallel computing', 'high performance computing', 'quantum computing',
  'information retrieval', 'information extraction', 'knowledge graph', 'knowledge base',
  'recommendation system', 'recommendation algorithm', 'search engine', 'web search',
  'image processing', 'image segmentation', 'image classification', 'object detection',
  'object recognition', 'face recognition', 'speech recognition', 'text classification',
  'text summarization', 'machine translation', 'sentiment analysis', 'named entity recognition',
  'part of speech', 'dependency parsing', 'semantic analysis', 'syntactic analysis',
  'time complexity', 'space complexity', 'binary search', 'binary tree', 'linked list',
  'hash table', 'hash function', 'dynamic programming', 'greedy algorithm', 'genetic algorithm',
  'gradient descent', 'stochastic gradient descent', 'back propagation', 'forward propagation',
  'loss function', 'activation function', 'objective function', 'cost function', 'decision tree',
  'random forest', 'support vector machine', 'k nearest neighbor', 'principal component analysis',
  'singular value decomposition', 'dimensionality reduction', 'feature extraction',
  'feature engineering', 'feature selection', 'hyper parameter', 'hyper parameter tuning',
  'cross validation', 'over fitting', 'under fitting', 'data augmentation', 'data preprocessing',
  'model training', 'model inference', 'model evaluation', 'model compression', 'model pruning',
  'model quantization', 'model distillation', 'transfer learning', 'fine tuning', 'prompt tuning',
  'few shot learning', 'zero shot learning', 'one shot learning', 'chain of thought',
  'retrieval augmented generation', 'generative adversarial network', 'variational autoencoder',
  'transformer model', 'attention mechanism', 'self attention', 'multi head attention',
  'positional encoding', 'word embedding', 'token embedding', 'sequence to sequence',
  'end to end', 'state of the art', 'proof of concept', 'test driven development',
  'continuous integration', 'continuous deployment', 'version control', 'code review',
  'pull request', 'release candidate', 'production environment', 'development environment',
  'test environment', 'user story', 'acceptance criteria', 'design pattern', 'software architecture',
  'object oriented', 'functional programming', 'type inference', 'garbage collection',
  'memory management', 'virtual memory', 'process scheduling', 'deadlock detection',
  'breadth first search', 'depth first search', 'shortest path', 'minimum spanning tree',
  'topological sorting', 'union find', 'sliding window', 'two pointer', 'divide and conquer'
]

const PHRASE_SET = new Set(PHRASES.map((p) => p.toLowerCase()))

const WORD_TOKEN = /^[a-z]+(?:['-][a-z]+)*$/i

/** 归一化：小写、折叠空白、去尾部标点（选中文本常带句号/逗号） */
export function normalizePhrase(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[.,;:!?，。；：！？"”’)\]]+$/, '')
    .trim()
}

/**
 * 是否应按「短语词卡」处理：
 * 精选表命中，或 2–3 个纯字母单词的短短语（不含中文/数字/标点）。
 */
export function isPhrase(text: string): boolean {
  const t = normalizePhrase(text)
  if (!t || /[\u4e00-\u9fff0-9]/.test(t)) return false
  if (PHRASE_SET.has(t)) return true
  const toks = t.split(' ')
  return toks.length >= 2 && toks.length <= 3 && t.length <= 40 && toks.every((w) => WORD_TOKEN.test(w))
}
