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

工作台有四个页面：业务文档、业务理解、建模、模型检验。默认链路为“业务理解 → 业务依据 → 模型设计 → 模型 JSON”。前三项直接生成可读文本，不因标题、字段或引用格式差异触发重试；最后 JSON 才进行结构与引用校验。建模页的业务依据、模型设计、模型视图与运行记录中的三个步骤一一对应。正文流式展示，停止、失败和刷新后保留草稿；运行期间不会强制切换用户正在阅读的标签。模型自述和过程支撑评估由用户单独启动。前端使用 React TSX，后端、共享契约、验证脚本和 Vite 入口统一使用 TypeScript。

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

`stages/understanding.ts` 整理文档并发现表述问题，`stages/business-basis.ts` 提炼事实、组织故事并形成建模要求，`stages/modeling.ts` 生成设计并编译模型。Pi 的业务理解和依据共用单轮 `agents/pi-text.ts`；`agents/pi-modeling.ts` 在设计阶段通过 `check_expression` 进行最多三轮语义审阅与修订，设计和检查使用同一份业务依据及检验情形，检查意见为自由文本，不增加格式修复或完成交接回合。运行时校验放在 `validation/`。

| 步骤 | 业务输入 | 输出 |
| --- | --- | --- |
| 业务理解 | 原始文档 | 忠实的文档整理稿、表述问题及原文引用 |
| 业务依据 | 当前整理稿及已保存确认 | 事实、故事、完整规则、未决边界和检验情形 |
| 模型设计 | 业务依据；迭代时的候选与设计反馈 | 模型定义、设计理由和边界 |
| 设计表达检查（Pi 内部） | 同一份业务依据、当前设计；复查时加上一版设计与历史意见 | 情形的表达路径、缺口及修订反馈 |
| 模型 JSON | 仅模型设计 | 经本地结构和引用校验的候选模型 |
| 模型自述（单独启动） | 仅候选模型 | 模型表达的业务含义 |
| 过程支撑评估（单独启动） | 仅候选模型 | 逐项支撑判断、缺口与建议 |

业务理解从阅读理解和文档表达的角度理顺语句、层次和上下文，指出歧义与矛盾，不预先按建模类别提炼内容，不再规定七个业务主题。原文块引用可用于追溯，无法关联时保留整理稿并提示，不进行逐块覆盖验收或格式重试。业务依据再提炼建模要求，保留具体条件、阈值和公式，不能用“按文档规定”替代；它不强制 facts/stories JSON、固定编号或枚举。设计与检查直接承接这份依据，不重复传入整理稿全文。两种运行时都围绕同一个核心问题进行建模：当前对象、关系、业务操作、只读能力和规则，能否表达具体业务事实或过程？详见 [语义交接规范](docs/semantic-handoff.md) 和 [软方法学](docs/软方法学：从业务事实到候选模型.md)。

最终编译先机械处理代码围栏和固定空元数据，再检查 JSON 结构、唯一 ID、端点和引用；不静默删除未知引用或补造业务对象。校验失败最多增加一次 JSON 修复调用，不再使用 Pi 的 validate/finish 工具回合。Pi 首轮设计通过时从阅读到模型共五次调用，每次语义修订增加设计与复查两次，最多三轮；direct 为四次基础调用。业务待澄清、检查失败或达到上限时保留设计和意见，继续编译，不恢复逐条事实映射。结构通过不代表业务正确，用户仍应结合设计、自述和支撑评估审阅。

文档整理稿和原始文档快照保留在草稿中，用户回答和手工修订不冒充原文。开始建模时保存本轮采用的整理稿；后续修改不会改变旧模型的来源。设计中可识别的澄清交回业务理解，引用业务依据时明确标注为提炼内容，不能显示成原文引文；不符合问题表单要求的内容仍保留在设计原文中，不因此阻断建模。已确认说明先并入整理稿，随后重新提炼依据；旧结果按版本标记过期。

SSE 使用 `part: reading / basis / semantic / design-check / compile`。`business-basis` 保存完整业务依据，`design-review` 保存设计轮次和检查意见，`model-plan` 交接最终设计，`model-checkpoint` 保存有效候选；最终结果返回 `businessBasis`、`semanticPlan`、`designReview` 和 `model`。设计审阅位于“模型设计”页，仍与三个建模步骤对应。`expressionReview.status = not-run` 表示未运行旧版编译后检查，与文本设计的 `designReview` 分开。编译重试保留业务依据、设计与匹配版本的审阅，只把设计交给模型。旧草稿的 `semantic-plan`、映射与检查记录仍可查看和显式恢复。

业务理解完成后等待用户审阅。保存问题答案后，建模和讨论使用修订后的业务理解；建模需要把已确认的条件、分支和过程复用落实到候选模型的规则、业务过程和要求中。答案草稿不影响已保存正文，存在未保存修改时需先保存再建模或检验。建模页的模型视图完整展示对象关系、操作、只读能力和规则，详情按选中元素关联，历史业务依据中的映射元素仍可跳转到详情。生成后由用户启动模型检验，支持仅重做自述或业务过程支撑。

业务过程支撑由 `BusinessProcessSupport.tsx` 展示：顶部按状态统计及筛选，过程列表展示一句判断依据，展开后按「模型声明的业务要求 → 模型表达与判断依据 → 缺口及改进」逐项对照。对象、关系、操作、只读能力和规则可在原页面打开详情。窄窗口下各列顺序排列，保持业务要求和其支撑说明在一起。

评估接口使用 `{ stage: 'assess', model, provider }`。输出中的每个过程包含 `reason` 和 `requirements`，每项要求包含 `requirement/status/elements/explanation/gap/suggestion/evidence`，其中 `evidence` 必须为空。评估必须覆盖模型的全部业务过程，逐项沿用模型声明的要求，不遗漏或另造要求；没有细化要求时只围绕过程目标判断。模型只判断逐项状态，服务端汇总过程状态；元素引用、缺口、改进建议及过程和要求的覆盖均经过校验，不以同名元素或尚未实现代码作为判断依据。跨过程建议单独列出。用户可以讨论具体缺口，或将建议加入下一轮反馈，保留已有反馈并避免重复添加；加入反馈不会自动重建模型。旧草稿保留原结论和数据，不补造逐项对应关系，需要重新评估以获得新视图的完整内容。

评估输出 `clarifications` 替代独立的问题清单。普通模型缺口直接提出修改建议；确实缺少业务事实时，澄清须包含模型中的依据、歧义、影响和回答选项，依据只能来自候选模型，也统一进入业务理解表单。新增未决问题不等于业务事实变化，候选模型仍可审阅；保存答案修订业务理解后，旧模型及其评估才标记需要更新。未回答的问题和建模边界不会由程序补造答案。

各次调用均可停止。模型 JSON 失败时保留业务依据、设计和旧模型，发送 `{ stage: 'compile', semanticPlan, businessBasis, narrative, provider }` 单独重试，不重新生成中间文本。只有最终模型校验通过才更新图。业务依据与设计正文直接流式展示；原始调用输出保存在本地草稿中用于诊断。运行进度、耗时及停止按钮在主区域可见，建模助手可收起。

Pi 使用 `UOM_PI_TIMEOUT_MS` 限制一次阶段运行的总时长（默认 300 秒）；设计阶段包含其全部迭代，并与用户取消信号合并。服务错误、超时或断流不能被当成格式问题反复重试。

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

单独验证第二阶段：准备外部 JSON 文件 `{ "narrative": "完整业务说明", "feedback": "可选反馈" }`，执行 `npx tsx scripts/run-modeling.ts --input /path/to/input.json --provider gpt`，环境中需提供对应的 API 配置。从 B 重试使用 `--semantic-plan /path/to/saved-plan.md --semantic /path/to/semantic.json --narrative /path/to/understanding.md` 替代 `--input`；`--semantic` 仅用于携带历史结构化草稿，可省略；单独重试编译不重跑设计审阅或映射。脚本在临时目录保留输入、输出、事件及耗时。Pi 第二阶段首轮设计通过时包含依据、设计、审阅和编译四次调用，语义修订受三轮上限约束；最终 JSON 校验失败最多另加一次修复。

浏览器回归：先启动开发服务，再运行 `npm run test:ui`（可追加服务 URL）。首次使用需安装 Playwright Chromium：`npx playwright install chromium`。脚本使用独立浏览器上下文和模拟 SSE，不调用真实 LLM，覆盖跨页停止、产物跳转、草稿恢复、编译重试和窄屏布局。

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
GLM uses `GLM_API_KEY`, with optional `GLM_API_URL` and `GLM_MODEL`.
All four use streaming Chat Completions over HTTP and expose the same staged
interface and return the same validated provider-neutral model containing objects,
relations, actions, functions, rules, activities, boundaries and textual evidence.
`/api/discuss` uses the selected provider through the same interface.

The UI and shared protocol constants default to GLM and the Pi Agent runtime. Users
can switch provider and reasoning settings for the current session; the UI's direct
runtime button is disabled. Reasoning options come from `/api/models`, based on the
server's configured model, and reset to the lowest supported setting when switching
providers or reloading. Each request carries that choice through Pi, review,
compilation, validation and discussion without mutating the server environment.
See [model reasoning settings and sources](docs/model-reasoning.md). Previously saved provider
preferences do not override this default. The server and command-line provider resolver
also default to GLM. Set `UOM_LLM_PROVIDER=deepseek`, `gpt`, `qwen` or `glm` to override
the provider default; the server uses Pi when a request selects it or when
`UOM_AGENT_RUNTIME=pi` is set.
an explicit request or `--provider` choice takes precedence.
Credentials are loaded from the project root `.env` and remain server-side.
API URLs accept either a base URL ending in `/v1` or the full `/chat/completions` endpoint.
DeepSeek Flash supports disabled thinking or `low`, `high`, `max`; the UI defaults
to disabled thinking. Legacy requests without a selection retain the previous defaults.
`LLM_MAX_OUTPUT_TOKENS` sets its output limit (default: 16384) to allow longer
candidate models to finish. A response cut off by the upstream limit still fails
validation; partial JSON is never accepted as a model.

Qwen uses `QWEN_MAX_OUTPUT_TOKENS` (default `16384`). Qwen 3.6 exposes a thinking
switch, not invented named effort tiers. The local server uses
`chat_template_kwargs.enable_thinking`; DashScope uses `enable_thinking`.

GLM defaults to `glm-5.3-flash` at `https://open.bigmodel.cn/api/coding/paas/v4`;
`GLM_API_KEY` is required in the project root `.env`. Standard API keys can
override the endpoint with `GLM_API_URL=https://open.bigmodel.cn/api/paas/v4`.
Coding Plan quota is separate from standard API balance. See the [Coding Plan setup guide](https://docs.bigmodel.cn/cn/coding-plan/quick-start)
for key creation and supported tools, including Pi Coding Agent.
`GLM_API_URL` also accepts the full `/chat/completions` endpoint. `GLM_MODEL` can select
`glm-5.3-flashx`. Explicit request selections override the environment in both
direct calls and all Pi agents. Requests without a selection use
`GLM_REASONING_EFFORT` (default `max`; allowed: `low`, `high`, `max`) and
`GLM_MAX_OUTPUT_TOKENS=32768` (up to `131072`). `GLM_API_TIMEOUT_MS` controls
direct requests (default `300000`); `UOM_PI_TIMEOUT_MS` controls each Pi loop.
GLM-5.3-Flash requires thinking: requests use `thinking.type=enabled` and
`clear_thinking=false`, and Pi returns the original `reasoning_content` after
tool calls. Tool arguments stream with `tool_stream=true`; GLM supports only
`tool_choice=auto`, including handoff retries. Sampling uses the documented
`temperature=1` and `top_p=0.95`. JSON stages still use `json_object` output.
See the [GLM model documentation](https://docs.bigmodel.cn/cn/guide/models/vlm/glm-5.3-flash)
and [thinking mode requirements](https://docs.bigmodel.cn/cn/guide/capabilities/thinking-mode).
The current document workflow supplies text; this integration does not add image uploads.

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
