# UOM Forge

Evidence-first domain modeling workbench. Forge produces a provider-neutral candidate
model from business documents and lets a domain expert review the evidence before it
is exported to a runtime-specific model.

The project will encode a repeatable modeling methodology that helps domain experts
identify stable concepts, business objects, facts, relations, constraints, and
capabilities before describing business processes.

## Prototype

The browser saves the document and candidate drafts locally. Provider credentials
stay on the server. DeepSeek API and GPT API implement the same turn interface;
every call receives explicit stage inputs, without earlier conversation history.

工作台有四个页面：业务文档、业务理解、候选模型、模型检验。模型检验内包含模型自述和业务过程支撑。前端使用 React TSX，后端、共享契约、验证脚本和 Vite 入口统一使用 TypeScript。

| 代码位置 | 职责 |
| --- | --- |
| `server/providers/` | DeepSeek、GPT 的配置及共用 Chat Completions 流式传输、超时、取消和资源清理；ACP 适配器暂时停用，不包含建模提示词或阶段逻辑 |
| `server/stages/` | 业务理解、A/B 建模、自述、评估和讨论；接受注入的推理调用，决定显式输入、提示词与结果处理 |
| `server/validation/` | HTTP 输入、文档、模型结构及引用、证据和评估结果的运行时校验；完整 Schema 留在这里 |
| `server/api.ts` | HTTP 路由、请求解析、阶段调用、SSE 响应和客户端断开处理 |
| `shared/analysis.ts`、`shared/model.ts` | 前后端共享的数据与事件类型，不依赖 server |
| `vite.config.ts` | 加载环境配置、挂载 API、配置前端开发服务 |
| `src/main.tsx`、`src/components/*.tsx` | 工作区状态、阶段交互、文档阅读、模型展示与表单 |
| `src/types.ts`、`src/persistence.ts` | 前端草稿和视图类型；解码浏览器存储并保留旧草稿内容 |
| `src/document.ts`、`src/responses.ts` | 文档处理、SSE 读取、响应边界与阶段结果检查 |

`stages/modeling.ts` 负责 A/B 生成与第二阶段编排，`stages/expression.ts` 负责独立业务表达检查及一轮定点修正，校验放在 `validation/`。流式事件以可区分的联合类型定义；提供方只发出推理事件，阶段层附加阶段信息。检查失败不补造默认结论，保留最后一次有效候选及已完成检查。用户取消、请求超时和提前断流分别处理，失败路径同样清理计时器、流和 ACP 进程。

| 步骤 | 业务输入 | 输出 |
| --- | --- | --- |
| 1 业务理解 | 原始文档 | 按语义章节组织的 Markdown 业务说明 |
| 2A 建模判断 | 业务说明；迭代时的当前候选模型与用户反馈 | Markdown 建模说明，无 Schema |
| 2B 格式整理 | 仅 2A 建模说明 | 符合 MODEL_SCHEMA 的 JSON，由本地严格校验 |
| 2C 业务表达检查 | 当前业务理解与实际候选 | 具体事实用例、表达缺陷与未决语义 |
| 2D 定点修正及复查（有缺陷时） | 当前业务理解、候选与检查用例 | 一轮局部修正、复查与完整历史 |
| 3 模型自述 | 仅候选模型 | 自然语言业务复述 |
| 4 业务过程支撑评估 | 仅候选模型 | 模型声明的业务要求与对象、关系、行为及规则的逐项对照、缺口及改进建议 |

第一阶段规范及其 11 项语义判断见 [语义交接规范](docs/semantic-handoff.md)。只调用一次模型，不再整理第二份阅读提纲。程序检查缺少的标题并提示，不能据此证明业务理解正确。待确认问题支持单选、多选和文字回答；保存答案会将确认说明并入当前业务理解，替代对应的不确定表述，未回答的问题继续保留。确认说明标明来自用户修订，不冒充原文；原始说明及问题目录留在本地草稿，供修改或撤回答案。

第二阶段 A 不提供 JSON Schema；B 的业务输入只有 A 的结果，另外提供 `output-contract.ts` 中的紧凑格式说明。完整 JSON Schema 留在本地校验，不再重复展开到提示词。B 不接收第一阶段业务说明、原文、用户对话或完整旧模型。本轮先识别概念、关系和业务行为，不细化属性和输入字段；本地也检查属性和输入为空、业务过程支撑尚未评估。每次 API 调用只发送当前阶段输入，B 不继承 A 的额外上下文。选择 Pi 时，B 先由程序校验；只有 JSON 不合法时才启动 Pi 定点修复，Pi 必须根据程序返回的具体错误调用 `validate_json`，修复结果再次经过同一程序校验后才可接受。

建模说明使用“建模判断与边界”解释设计取舍、适用范围、暂不细化内容及未明确语义，模型以 `boundaries` 保留这些陈述，并在相关元素定义中表达限制。页面只在建模说明中展示相关解释，不再单独列出边界区域；`boundaries` 仍供模型自述和业务过程支撑评估使用。候选模型不再包含 `questions`。旧模型问题只作为本地历史内容保留，不进入新一轮的模型参考。

第二阶段采用过程支撑驱动的软方法学：模型先理解需要支撑的业务过程，围绕代表性业务情形持续判断当前对象、关系、操作、能力和规则能否表达真实事实；只有遇到实际表达缺口才调整模型，不以概念数量、段落数量或固定检查清单为目标。direct 在一次语义调用中完成这类自我判断；Pi Agent 可以按需调用独立检查获取建议，但检查意见不是必须逐项消除的闸门。两者之后都经过同一套候选编译和核心业务表达检查。

建模新发现的业务歧义只有在不同答案会改变本轮模型时才提出，必须包含当前业务理解中的原句依据、不同解释以及对模型的影响，并优先提供可选答案。A 在可选的“需要补充的业务信息”章节中输出；程序检查必需信息及依据，发布给前端后统一进入业务理解的确认表单。B 只收到 A 的模型说明正文，澄清章节由程序提取，不让 B 重新生成问题。原始输出仍完整保留。已有问题按规范化的问题文本去重，不重开已经回答的同一问题；语义不同的改写是否重复仍依赖模型判断和用户审阅。

原文保留在文档页及项目草稿中，第二阶段的 `evidence` 一律为空。候选模型详情专注业务边界与联系，不展示空属性、空引文警告。自述和评估只读取候选模型的业务语义，剔除原文引证和建模阶段的待评估标记，不接收原文、业务理解、问题答案或讨论历史。评估检验模型能否表达其中声明的业务过程与要求，不证明模型覆盖了原文的全部业务。

候选整理后，以当前业务理解和实际候选开展独立业务表达检查：优先选择最能区分模型边界的代表性事实，检查能否区分有业务差别的情形。只有已有明确依据的模型缺陷才自动进行一轮局部修正，然后复查原有用例。业务歧义保留，不能自动回答。修正破坏原先可表达的事实时恢复初始候选，所有尝试保留。该检查位于模型构造内部；最终模型自述和过程支撑评估仍然只接收候选模型。

`/api/analyze/stream` 返回 SSE，model 请求体使用 `{ stage: 'model', narrative, model?, instruction?, provider }`，无需 document 或完整 understanding。`/api/analyze` 采用相同输入及完整第二阶段实现，返回非流式结果。结果包含 `expressionReview`（初始及修正快照、检查用例、修改原因、状态）；流式 `model-checkpoint` 在后续推理前保存有效候选。缺少 narrative 会拒绝建模。

业务理解完成后等待用户审阅。保存问题答案后，建模和讨论使用修订后的业务理解；建模需要把已确认的条件、分支和过程复用落实到候选模型的规则、业务过程和要求中。答案草稿不影响已保存正文，存在未保存修改时需先保存再建模或检验。候选模型页在“建模说明”和“模型视图”间切换，完整展示对象关系、操作、只读能力和规则，详情按选中元素关联。生成后由用户启动模型检验，支持仅重做自述或业务过程支撑。

业务过程支撑由 `BusinessProcessSupport.tsx` 展示：顶部按状态统计及筛选，过程列表展示一句判断依据，展开后按「模型声明的业务要求 → 模型表达与判断依据 → 缺口及改进」逐项对照。对象、关系、操作、只读能力和规则可在原页面打开详情。窄窗口下各列顺序排列，保持业务要求和其支撑说明在一起。

评估接口使用 `{ stage: 'assess', model, provider }`。输出中的每个过程包含 `reason` 和 `requirements`，每项要求包含 `requirement/status/elements/explanation/gap/suggestion/evidence`，其中 `evidence` 必须为空。评估必须覆盖模型的全部业务过程，逐项沿用模型声明的要求，不遗漏或另造要求；没有细化要求时只围绕过程目标判断。模型只判断逐项状态，服务端汇总过程状态；元素引用、缺口、改进建议及过程和要求的覆盖均经过校验，不以同名元素或尚未实现代码作为判断依据。跨过程建议单独列出。用户可以讨论具体缺口，或将建议加入下一轮反馈，保留已有反馈并避免重复添加；加入反馈不会自动重建模型。旧草稿保留原结论和数据，不补造逐项对应关系，需要重新评估以获得新视图的完整内容。

评估输出 `clarifications` 替代独立的问题清单。普通模型缺口直接提出修改建议；确实缺少业务事实时，澄清须包含模型中的依据、歧义、影响和回答选项，依据只能来自候选模型，也统一进入业务理解表单。新增未决问题不等于业务事实变化，候选模型仍可审阅；保存答案修订业务理解后，旧模型及其评估才标记需要更新。未回答的问题和建模边界不会由程序补造答案。

各次调用均可停止；B 失败时保留说明和旧模型，发送 `{ stage: 'compile', semanticPlan, narrative, provider }` 单独重试，无须重跑 A。B 仍只接收建模说明，narrative 用于后续检查。只有严格结构校验通过才更新图，不静默删除错误引用。候选页用“业务表达检查”展示检查与修正结果；本轮通过不代表已证明全部业务覆盖。检查超时或停止时，已完成候选仍可查看。页面不提供原始输出记录区域，业务理解、建模说明和模型自述继续在各自正文中流式显示；原始输出完整保留在本地草稿中用于诊断。运行进度、耗时及停止按钮在主区域可见，建模助手可收起并保留各阶段对话。

Pi loop 使用 `UOM_PI_TIMEOUT_MS` 限制单个阶段的总时长（默认 300 秒），并与用户取消信号合并；达到轮数上限或超时不会伪造通过结果。

候选模型关系图按对象之间的联系自动排列，连线绕开卡片并标注方向。选中对象突出直接关系，可切换为只看相关对象；支持缩放、拖动画布、适应视图和展开查看。同类对象之间的多种关系共用回环路径，每条关系仍可独立选中；显示布局不改变模型语义。布局逻辑位于 `src/graph-layout.ts`，ELK 引擎按需加载，交互由 `src/components/ModelGraph.tsx` 实现。

`src/workspace.ts` 跟踪文档、业务理解、模型和检验的版本依赖。保存说明、问题答案或修改建模反馈后，旧模型标记需要更新；模型变化后，自述和评估也标记需要更新。重复保存相同答案不增加版本。未更新模型不能启动新的检验。草稿自动保存到浏览器，也可手动保存；导入旧草稿时保留用户数据，已保存的旧答案会一次性并入说明并使旧模型失效，未保存答案仍保留为草稿。

可用相同文档和提供方对比冻结的旧提示词与当前第一阶段：

```bash
npx tsx scripts/compare-understanding.ts --input /path/to/input.json --output /path/to/results --provider gpt
```

输入包含 `document`（解析后的正文文本及编辑器数据）和 `baselinePrompt`（包含同一文档的完整旧提示词）。结果保留两侧原始输出、流式事件和耗时。评价应针对准确性、完整性、可读性与无依据推断；单次对照不代表稳定质量结论。领域样例与结果放在工作区外，不加入产品提示词。

保留的 ACP 手动实验（不经过应用提供方入口，需要单独配置 Codex）：同一提示词对照 Codex 推理强度。

```bash
npx tsx scripts/compare-reasoning.ts --input /path/to/document.json --output /path/to/new-results --rounds 2
```

输入为 `document` 对象或含有 `document` 的接口请求。脚本实际运行第一阶段，顺序执行 `xhigh`、`high`，第二轮反转顺序；每次独立会话，只改变推理强度，不修改服务默认配置。保存原始 Markdown、结果、计时事件、文档与提示词哈希。输出目录必须尚不存在，防止覆盖旧实验。实验单次默认限时 600 秒，可用 `--timeout-ms` 调整；不改变服务的超时。

通过 `--efforts xhigh,high,medium` 指定需要比较的强度；`--efforts medium --rounds 1` 只验证一次 medium。中止脚本时保留已完成结果以及当前调用的部分输出和取消记录，不继续启动后续调用。

提供方通过 `timing` 事件报告实际配置、输入/输出字符数、ACP 连接（或 HTTP 响应头）、会话建立、首段正文和完成/失败/取消时间。时间从各次调用开始累计，使用单调时钟；首段正文不包含推理片段，字符数不等于 token 数。前端“调用耗时”保留这些记录，多步骤分别列出。首段正文之前的等待包含服务、网络和推理，不能由客户端计时进一步拆分。浏览器断开后只能保留最近已收到的时间记录。

单独验证第二阶段：准备外部 JSON 文件 `{ "narrative": "完整业务说明", "feedback": "可选反馈" }`，执行 `npx tsx scripts/run-modeling.ts --input /path/to/input.json --provider gpt`，环境中需提供对应的 API 配置。从 B 重试使用 `--semantic-plan /path/to/saved-plan.md --narrative /path/to/understanding.md` 替代 `--input`，之后同样开展表达检查。脚本在临时目录按调用序号和阶段保留实际输入、完整提示词、原始输出、事件及耗时，包括失败记录。没有缺陷时共三次调用，有需修正缺陷时最多五次，不保证总耗时比旧 A/B 更短。

开发验证：`npm test`、`npm run typecheck`、`npm run build`。`typecheck` 分别使用 `tsconfig.json` 检查后端、脚本及测试，使用 `tsconfig.app.json` 检查全部 Forge 前端 TS/TSX 和共享类型；两者都启用 strict，不启用 allowJs。前后端共用业务数据、流式事件以及按阶段区分的请求/结果类型。QQDocEditor 沿用子模块提供的 TypeScript 组件类型，不另建宽泛声明。测试覆盖阶段输入隔离、B 单独重试、SSE 分片与断开、两种提供方的取消和失败路径、模型及评估引用、前端版本依赖和草稿恢复。运行环境需满足 Vite 8 的 Node.js 要求；脚本和测试用 tsx 执行 TypeScript。

业务文档视图使用 `src/components/evidence/qq-doc-clone` 子模块中的
`QQDocEditor` 作为证据阅读组件。Forge 以嵌入、只读模式加载文档，保留原始文档的
排版和原文查看能力；QQ 文档组件本身仍作为独立项目维护，Forge 不复制其实现。
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

The DeepSeek provider uses `LLM_API_URL`, `LLM_API_KEY` and `LLM_MODEL`;
the GPT provider uses `GPT_API_URL`, `GPT_API_KEY` and `GPT_MODEL`; the Qwen
provider uses `QWEN_API_URL`, `QWEN_API_KEY` and `QWEN_MODEL`.
All three use streaming Chat Completions over HTTP and expose the same staged
interface and return the same validated provider-neutral model containing objects,
relations, actions, functions, rules, activities, boundaries and textual evidence.
`/api/discuss` uses the selected provider through the same interface.

The UI and shared protocol constants default to DeepSeek and the Pi Agent runtime. Users
can switch provider or runtime for the current session. Previously saved provider
preferences do not override this default. The server and command-line provider resolver
also default to DeepSeek. Set `UOM_LLM_PROVIDER=deepseek`, `gpt` or `qwen` to override
the provider default; the server uses Pi when a request selects it or when
`UOM_AGENT_RUNTIME=pi` is set.
an explicit request or `--provider` choice takes precedence.
Credentials are loaded from the parent UOM `.env` and remain server-side.
API URLs accept either a base URL ending in `/v1` or the full `/chat/completions` endpoint.
All DeepSeek calls explicitly disable thinking with `thinking: { type: "disabled" }`
while retaining streaming output and the configured `LLM_MODEL`.
`LLM_MAX_OUTPUT_TOKENS` sets its output limit (default: 16384) to allow longer
candidate models to finish. A response cut off by the upstream limit still fails
validation; partial JSON is never accepted as a model.

Qwen uses `QWEN_MAX_OUTPUT_TOKENS` (default `16384`) and does not send provider-
specific reasoning parameters, so the endpoint can remain a standard
OpenAI-compatible Chat Completions service.

GPT uses the configured model (default `gpt-6-astra`) with
`GPT_REASONING_EFFORT=medium` by default. It sends `reasoning_effort` and does not
send DeepSeek's `thinking` parameter. Each call contains only the current stage's
prompt; it does not start Codex or carry an ACP session's context.
Both APIs default to a 300-second timeout; use `LLM_API_TIMEOUT_MS` or
`GPT_API_TIMEOUT_MS` to override independently. Streaming, cancellation, timing
and retrying compilation from the saved semantic plan work with either provider.

Codex ACP 的注册入口已注释停用，页面不再提供该选项，API 明确拒绝 `provider: "codex"`。
适配器、依赖和手动实验脚本暂时保留；已有草稿的 ACP 耗时记录仍可查看。

The server starts with:

```bash
npm install
npm run dev -- --host 127.0.0.1
```

If a provider call fails, the UI reports the error and keeps the previous draft;
it never silently switches providers or falls back to fixed demo data.
