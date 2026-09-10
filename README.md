# UOM Forge

Evidence-first domain modeling workbench. Forge produces a provider-neutral candidate
model from business documents and lets a domain expert review the evidence before it
is exported to a runtime-specific model.

The project will encode a repeatable modeling methodology that helps domain experts
identify stable concepts, business objects, facts, relations, constraints, and
capabilities before describing business processes.

## Prototype

The browser saves the document and candidate drafts locally. Provider credentials
stay on the server. DeepSeek API and Codex ACP implement the same turn interface;
every call receives explicit stage inputs, without earlier conversation history.

工作台有四个页面：业务文档、业务理解、候选模型、模型检验。模型检验内包含模型自述和过程支撑。前端使用 React TSX，后端、共享契约、验证脚本和 Vite 入口统一使用 TypeScript。

| 代码位置 | 职责 |
| --- | --- |
| `server/providers/` | Codex ACP、DeepSeek 的协议适配，文本/推理流、超时、取消和资源清理；不包含建模提示词或阶段逻辑 |
| `server/stages/` | 业务理解、A/B 建模、自述、评估和讨论；接受注入的推理调用，决定显式输入、提示词与结果处理 |
| `server/validation/` | HTTP 输入、文档、模型结构及引用、证据和评估结果的运行时校验；完整 Schema 留在这里 |
| `server/api.ts` | HTTP 路由、请求解析、阶段调用、SSE 响应和客户端断开处理 |
| `shared/analysis.ts`、`shared/model.ts` | 前后端共享的数据与事件类型，不依赖 server |
| `vite.config.ts` | 加载环境配置、挂载 API、配置前端开发服务 |
| `src/main.tsx`、`src/components/*.tsx` | 工作区状态、阶段交互、文档阅读、模型展示与表单 |
| `src/types.ts`、`src/persistence.ts` | 前端草稿和视图类型；解码浏览器存储并保留旧草稿内容 |
| `src/document.ts`、`src/responses.ts` | 文档处理、SSE 读取、响应边界与阶段结果检查 |

`stages/modeling.ts` 仅负责第二阶段 A/B，不再保留混合提示词和校验的 `server/modeling.js`。流式事件以可区分的联合类型定义；提供方只发出推理事件，阶段层负责附加阶段信息。评估输出缺字段或引用不存在的元素时会报错，不再补造默认结果。用户取消、请求超时和提前断流分别处理，失败路径同样清理计时器、流和 ACP 进程。

| 步骤 | 业务输入 | 输出 |
| --- | --- | --- |
| 1 业务理解 | 原始文档 | 按语义章节组织的 Markdown 业务说明 |
| 2A 建模判断 | 业务说明；迭代时的当前候选模型与用户反馈 | Markdown 建模说明，无 Schema |
| 2B 格式整理 | 仅 2A 建模说明 | 符合 MODEL_SCHEMA 的 JSON，由本地严格校验 |
| 3 模型自述 | 仅候选模型 | 自然语言业务复述 |
| 4 支撑评估 | 业务说明、候选模型、原文证据 | 过程支撑与缺口 |

第一阶段规范及其 11 项语义判断见 [语义交接规范](docs/semantic-handoff.md)。只调用一次模型，不再整理第二份阅读提纲。程序检查缺少的标题并提示，不能据此证明业务理解正确。待确认问题支持单选、多选和文字回答；答案作为第二阶段用户反馈，不冒充原文。

第二阶段 A 不提供 JSON Schema；B 的业务输入只有 A 的结果，另外提供 `output-contract.ts` 中的紧凑格式说明。完整 JSON Schema 留在本地校验，不再重复展开到提示词。B 不接收第一阶段业务说明、原文、用户对话或完整旧模型。本轮先识别概念、关系和业务行为，不细化属性和输入字段；本地也检查属性和输入为空、过程支撑尚未评估。每次 ACP 调用新建独立会话，确保 B 不继承 A 的额外上下文；尚未实现同进程多会话复用。

原文保留在文档页及项目草稿中，第二阶段的 `evidence` 一律为空。候选模型详情专注业务边界与联系，不展示空属性、空引文警告。尚未实现自动证据匹配，过程支撑评估仍可核查原文。

`/api/analyze/stream` 返回 SSE，model 请求体使用 `{ stage: 'model', narrative, model?, instruction?, provider }`，无需 document 或完整 understanding。`/api/analyze` 采用相同输入及两步骤实现，返回非流式结果。缺少 narrative 会拒绝建模。

业务理解完成后等待用户审阅，问题答案独立保存，点击“开始建模”时一并采用。候选模型页在“建模说明”和“模型视图”间切换，完整展示对象关系、操作、只读能力和规则，详情按选中元素关联。生成后由用户启动模型检验，支持仅重做自述或过程支撑。

两次建模调用均可停止；B 失败时保留说明和旧模型，只需发送 `{ stage: 'compile', semanticPlan, provider }` 即可单独重试，无须重跑 A。只有严格校验通过才更新图，不静默删除错误引用。原始输出默认折叠，保留完整内容；运行进度、耗时及停止按钮在主区域可见，建模助手可收起并保留各阶段对话。

`src/workspace.ts` 跟踪文档、业务理解、模型和检验的版本依赖。修改说明、问题答案或建模反馈后，旧模型标记需要更新；模型变化后，自述和评估也标记需要更新。未更新模型不能启动新的检验。草稿自动保存到浏览器，也可手动保存；导入旧布局的草稿时保留用户数据。

可用相同文档和提供方对比冻结的旧提示词与当前第一阶段：

```bash
npx tsx scripts/compare-understanding.ts --input /path/to/input.json --output /path/to/results --provider codex
```

输入包含 `document`（与分析接口相同的证据块格式）和 `baselinePrompt`（包含同一文档的完整旧提示词）。结果保留两侧原始输出、流式事件和耗时。评价应针对准确性、完整性、可读性与无依据推断；单次对照不代表稳定质量结论。领域样例与结果放在工作区外，不加入产品提示词。

同一提示词对照 Codex 推理强度：

```bash
npx tsx scripts/compare-reasoning.ts --input /path/to/document.json --output /path/to/new-results --rounds 2
```

输入为 `document` 对象或含有 `document` 的接口请求。脚本实际运行第一阶段，顺序执行 `xhigh`、`high`，第二轮反转顺序；每次独立会话，只改变推理强度，不修改服务默认配置。保存原始 Markdown、结果、计时事件、文档与提示词哈希。输出目录必须尚不存在，防止覆盖旧实验。实验单次默认限时 600 秒，可用 `--timeout-ms` 调整；不改变服务的超时。

通过 `--efforts xhigh,high,medium` 指定需要比较的强度；`--efforts medium --rounds 1` 只验证一次 medium。中止脚本时保留已完成结果以及当前调用的部分输出和取消记录，不继续启动后续调用。

提供方通过 `timing` 事件报告实际配置、输入/输出字符数、ACP 连接（或 HTTP 响应头）、会话建立、首段正文和完成/失败/取消时间。时间从各次调用开始累计，使用单调时钟；首段正文不包含推理片段，字符数不等于 token 数。前端“调用耗时”保留这些记录，多步骤分别列出。首段正文之前的等待包含服务、网络和推理，不能由客户端计时进一步拆分。浏览器断开后只能保留最近已收到的时间记录。

单独验证第二阶段：准备外部 JSON 文件 `{ "narrative": "完整业务说明", "feedback": "可选反馈" }`，执行 `npx tsx scripts/run-modeling.ts --input /path/to/input.json --provider codex`。只测 B 使用 `--semantic-plan /path/to/saved-plan.md` 替代 `--input`。脚本在临时目录保留实际输入、每步完整提示词、原始输出、事件、首个输出及完成耗时，包括失败记录。拆分任务能隔离职责，不保证两次推理的总耗时一定更短。

开发验证：`npm test`、`npm run typecheck`、`npm run build`。`typecheck` 分别使用 `tsconfig.json` 检查后端、脚本及测试，使用 `tsconfig.app.json` 检查全部 Forge 前端 TS/TSX 和共享类型；两者都启用 strict，不启用 allowJs。前后端共用业务数据、流式事件以及按阶段区分的请求/结果类型。QQDocEditor 沿用子模块提供的 TypeScript 组件类型，不另建宽泛声明。测试覆盖阶段输入隔离、B 单独重试、SSE 分片与断开、两种提供方的取消和失败路径、模型及评估引用、前端版本依赖和草稿恢复。运行环境需满足 Vite 8 的 Node.js 要求；脚本和测试用 tsx 执行 TypeScript。

业务文档视图使用 `src/components/evidence/qq-doc-clone` 子模块中的
`QQDocEditor` 作为证据阅读组件。Forge 以嵌入、只读模式加载文档，保留原始文档的
排版和后续证据定位能力；QQ 文档组件本身仍作为独立项目维护，Forge 不复制其实现。
上传入口支持 DOCX、Markdown、TXT 和 HTML；DOCX 在浏览器端转换为 HTML 后交给编辑器展示。

子模块更新后，在本目录执行：

```bash
git submodule update --init --recursive
npm install
```

```bash
npm install
npm run dev
```

The Codex provider uses the installation and configuration available to the user
running the Vite server. The DeepSeek provider uses `LLM_API_URL`, `LLM_API_KEY` and
`LLM_MODEL` from the server environment. Both providers expose the same staged
interface and return the same validated provider-neutral model containing objects,
relations, actions, functions, rules, activities, questions and block-level evidence.
`/api/discuss` uses the selected provider through the same interface.

The UI provider switch is saved locally for the next session. The default is DeepSeek;
the server can set `UOM_LLM_PROVIDER=deepseek` as its default. DeepSeek credentials
are loaded from the parent UOM `.env` and remain server-side.
All DeepSeek calls explicitly disable thinking with `thinking: { type: "disabled" }`
while retaining streaming output and the configured `LLM_MODEL`.

默认单次 ACP 分析最长等待 5 分钟。文档较大或 Codex 推理较慢时，可通过
`CODEX_ACP_TIMEOUT_MS`（毫秒）调整，例如 `CODEX_ACP_TIMEOUT_MS=600000`。

Codex ACP 默认使用 `gpt-6-astra`，推理强度为 `medium`，适用于各阶段及讨论调用。可用 `CODEX_MODEL` 和 `CODEX_REASONING_EFFORT` 覆盖；它们优先于 `CODEX_CONFIG` 中的同名设置，未配置时采用上述默认值。此设置仅作用于 Forge 创建的 ACP 会话，不修改用户全局 Codex 配置。

The server starts with:

```bash
npm install
npm run dev -- --host 127.0.0.1
```

The Codex adapter needs a working Codex login or API-compatible provider in the
user's Codex configuration. If the ACP call fails, the UI reports the error and
keeps the previous draft; it never silently falls back to fixed demo data.
