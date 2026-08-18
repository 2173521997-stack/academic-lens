# Academic Lens 改动记录（2026-08-18）

> 本文档汇总今天（2026-08-18）做出的全部改动，供与同学协作的公共仓库同步参考。
> 改动分两部分：**A. 对照阅读核心升级**（吸收 `PRODUCT_OPTIMIZATION.md` 同学方案中优秀、且与现有总设计不冲突的部分）；**B. 今日其它功能开发**（Agent 智能体、闪卡 SRS、语录统计、生词本增强等）。

---

## A. 对照阅读核心升级（吸取 PRODUCT_OPTIMIZATION.md）

原则：**不改动既有总设计**——保留原有 Segment 平铺 `text/type` 字段作兼容投影，所有既有消费点（fileStore / 历史 / 生词分析 / Agent 引用等）无需大改，仅新增富结构渲染能力。

### A1. 块模型数据升级（`src/lib/types.ts`）

- 新增 `Inline`（text + bold/italic/code/link）与 `Block` 联合类型，共 8 种块：
  `heading / paragraph / list / table / code / blockquote / image / math`
- `Segment` 新增 `block: Block` 字段，保留 `type` / `text` 平铺投影（`blockText()` 由块推导可读文本，提示词/历史/生词分析零改动）
- 配套辅助：`inlineText` / `blockText` / `segText` 等

### A2. 解析层改造（`src/lib/parse.ts`）

| 格式 | 改动 |
|------|------|
| DOCX | 表格保留真实行列（不再 `cells.join('|')` 拍平）；列表保留序号/圆点；`<strong>/<em>/<code>/<a>` 提取为 `Inline[]` 行内样式 |
| PDF | 复用原启发式；新增列表前缀（`•`/`1.`）与 `\|` 列对齐表格检测 → 表格块；每段保留 `page` 页码 |
| MD/TXT | MD 改用 `marked.lexer` AST，原生保留标题/列表/表格/代码/引用/图片/公式 |

### A3. 翻译管线增强（`src/lib/prompt.ts` + `src/stores/fileStore.ts` + settings）

- **术语一致性注入**：生词本词条（word → 中文释义，上限 40 条）注入翻译系统提示，保证术语全文译法统一（设置页可开关）
- **领域/风格预设**：通用 / 计算机论文 / 生物医学 / 新闻时政 / 学术润色 5 档，切换翻译措辞倾向（设置页选择）
- **表格独立提示词**：表格段走专门提示词（保持行列与 `|` 结构，数字/公式/引用不动），且不并入批处理、独立流式请求
- 批处理 JSON 模式、本地缓存、长段流式等原有能力保持不变

### A4. 双栏渲染升级（`src/components/FileView.tsx` + `src/lib/inline.ts`）

- 按块类型渲染真实结构：表格→真实 `<table>`、列表→有序/无序列表、代码→`<pre>`、图片/公式→占位（不翻译）、引用→引用样式、标题→加粗加大
- 译文侧同样支持轻量行内标记（`**加粗**` / `*斜体*` / `` `代码` ``），表格译文按 `|` 还原为表格
- **逐句对齐**：`Intl.Segmenter` 按句子拆分段落为双语对照行，工具栏「逐段/逐句」切换
- 生词高亮、hover 操作区等既有交互保留

### A5. 多格式导出（`src/lib/exportText.ts` + IPC）

- 工具栏新增格式下拉：**译文 MD** / **双语对照 MD** / **双语对照 DOCX**
- 双语对照 MD：每块一个两列表格（左原文/右译文），复用块模型序列化
- 双语对照 DOCX：`docx` npm 包生成双列表格文档（新增依赖 + `file:saveBuffer` IPC 写二进制）
- 原有 `buildPlainText` / `buildPlainTextHeader` 保持兼容

---

## B. 今日其它功能开发

### B1. AI 智能体系统（Agent）

- 新增独立「智能体」全页视图（`AgentView`），标题栏入口；内置 21 个工具分 6 类（学习/项目/审查核实/个性化/设置/端侧操作），白名单 + `sideEffect` + `maxParam` 安全边界
- `agentStore` 取代原 `chatStore`：会话持久化（`agentSession`，60 条）、24 条多轮上下文、流式输出
- 双路径执行：`resolveByRules` 确定性规则表（零延迟快路径）→ `runReAct` ReAct 多步循环（GLM-4-flash，严格 JSON `{tool,params}`/`{done,answer}`，maxSteps=6）
- 重型工具 await 真实结果：查词 / 分级 / 整理 / 收藏 / 文档导出 / 历史检索
- 对话「#」上传：文档走 `parseAnyFile`、图片走 OCR，载入后自动跳转翻译视图；`getFileContextForChat` 携带当前文档上下文
- 智能体用独立 GLM-4-flash 免费配置（context_length 65536）；`llm.ts`/`electron/llm.ts` 支持 `response_format: json_object`、瞬时错误重试、usage 统计、80ms chunk 批量合并

### B2. 闪卡与 SRS 记忆

- 7 维 AI 词卡：音标/词性/释义/例句/搭配/语域/词族/内涵辨析/构词/关联词 + 难度分级
- 三种抽卡来源（生词本随机 / 今日到期 / 自选词）；AI 增强 + 离线基础卡兜底
- 三种学习模式：闪卡翻面、小练习（选择/填空/拼写/造句，AI 出题 + 三维批改 + 评分）、听写（发音→拼写判分）
- `srs.ts`：SM-2 间隔调度（ease/interval/reps/lapses/due），掌握度四级（new/learning/young/mature）
- `reviewLogStore`：复习记录统一落库（封顶 3000 条），`dailyStats` 供统计/周报

### B3. 语录与统计

- 美人美言专栏（`QuoteView` + `quotes.ts`）：内置名言 + 自收藏，逐词查词/朗读/一键入生词本
- 学情周报（`reportStore`）：聚合生词本 + 复习记录生成四段式 Markdown 周报，流式输出 + AI 水印
- 学习统计页（`StatsView`）：指标卡 / 掌握度分布 / 7 天热力柱 / 连续学习天数 / 易错词 Top8
- 全局通知系统（`noticeStore` + `NoticeView`）：5 级浮层，自动消失/常驻、去重、全局 `toast()`

### B4. 生词本增强

- `wordClean.ts`：输入清洗（剥音标/标点）+ 离线拼写建议（Levenshtein 优先）
- `levels.ts`：统一分级体系（CEFR + 四六级/专四专八 + 雅思/托福），`aiGradeWords` 批量 AI 分级
- `organize.ts`：普通整理（词形相似/词性）本地零成本 + 智能整理（近反义/专业日常/词根词缀/主题场景，AI 严格 JSON）
- WordbookView：搜索、标签内联编辑、自动分级按钮、三种视图切换、分组名回写标签
- `unknownWords.ts`：文档生词命中率统计 + 高亮定位

### B5. 划词查词（小窗）

- 查词双轨：uapis 真实词典优先（notFound 引导「改用 AI」），服务不可用自动回退 LLM；未配 Key 明示回退
- 中译英分流；智能联想补全（词库二分 + 稀疏行号索引）
- 词卡统一 `key|value` 格式（词典/AI 同构输出 + 来源徽章），朗读、收藏、整句翻译
- `pronounce.ts`：词典真实音频（缓存 + in-flight 去重）→ 系统 TTS 降级

### B6. 学习画像与可信度

- `profileStore`：目标/水平/偏好/想加强方面，档案摘要注入智能体上下文；`set_goal`/`get_profile` 工具读写
- `trust.ts`：AI 生成内容水印（`aiWatermark`）与「建议以原文/词典为准」溯源开关，周报/词卡/智能体回复统一追加

### B7. 其它

- Tailwind CSS 3 → 4（`@theme inline` 设计令牌 + dark 变体 + `mini-window` 小窗样式 + 新动画）
- TitleBar 7 个导航按钮；App.tsx 挂载 8 个视图 + 全局 NoticeView + onOpenSettings
- 历史可还原：`payload` 存摘要全文、`docResults` 存档最近 8 篇整篇译文（Electron userData）、关键词检索供智能体
- 删除 `AssistantPanel`/`chatStore`（被 AgentView/agentStore 替代）

---

## 文件清单

**新增**：`src/lib/prompt.ts` `src/lib/inline.ts` `src/lib/agentLoop.ts` `src/lib/agentTools.ts` `src/lib/dictLookup.ts` `src/lib/flashcard.ts` `src/lib/levels.ts` `src/lib/organize.ts` `src/lib/pronounce.ts` `src/lib/quotes.ts` `src/lib/srs.ts` `src/lib/trust.ts` `src/lib/unknownWords.ts` `src/lib/wordClean.ts` `src/stores/agentStore.ts` `src/stores/flashcardStore.ts` `src/stores/noticeStore.ts` `src/stores/profileStore.ts` `src/stores/quoteStore.ts` `src/stores/reportStore.ts` `src/stores/reviewLogStore.ts` `src/components/AgentView.tsx` `src/components/FlashcardView.tsx` `src/components/NoticeView.tsx` `src/components/QuoteView.tsx` `src/components/StatsView.tsx` `功能概览.md`

**修改**：`electron/main.ts` `electron/preload.ts` `electron/llm.ts` `package.json` `package-lock.json`（+docx）`src/App.tsx` `src/bridge/browser.ts` `src/bridge/types.ts` `src/components/FileView.tsx` `src/components/HistoryView.tsx` `src/components/HomeView.tsx` `src/components/QuickTranslate.tsx` `src/components/SettingsView.tsx` `src/components/TitleBar.tsx` `src/components/WordbookView.tsx` `src/lib/exportText.ts` `src/lib/llm.ts` `src/lib/parse.ts` `src/lib/quickTranslate.ts` `src/lib/suggest.ts` `src/lib/types.ts` `src/lib/wordCard.ts` `src/stores/appStore.ts` `src/stores/fileStore.ts` `src/stores/historyStore.ts` `src/stores/settingsStore.ts` `src/stores/wordbookStore.ts` `src/styles/index.css` `PRODUCT_OPTIMIZATION.md`（同学方案文档）

**删除**：`src/components/AssistantPanel.tsx` `src/stores/chatStore.ts`

**验证**：`tsc --noEmit` 与 `npm run build` 均通过。
