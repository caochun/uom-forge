# UOM Forge

Evidence-first domain modeling workbench. Forge produces a provider-neutral candidate
model from business documents and lets a domain expert review the evidence before it
is exported to a runtime-specific model.

The project will encode a repeatable modeling methodology that helps domain experts
identify stable concepts, business objects, facts, relations, constraints, and
capabilities before describing business processes.

## Prototype

The browser UI keeps the working document, candidate model, activity assessment and
conversation in local browser storage. Analysis is performed by the local Vite
server through the standard Agent Client Protocol (ACP): the server starts the
installed `@agentclientprotocol/codex-acp` adapter, creates a temporary read-only
Codex session, sends the evidence blocks, and validates the returned model before
showing it. Forge keeps provider credentials on the server and never exposes them to the
browser. 建模请求使用 `/api/analyze/stream` 以 SSE 流式返回阶段状态和当前提供方的输出片段，
完整 JSON 在服务端接收完毕并通过证据校验后才应用到工作区；`/api/analyze` 仍提供非流式调用。

建模采用三个阶段：先形成独立的业务理解，再生成候选对象关系模型，最后评估模型对业务过程的支撑情况。
用户反馈后保留业务理解，从候选模型阶段重新生成并再次评估。

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

The UI provider switch is saved locally for the next session. The default is Codex;
the server can set `UOM_LLM_PROVIDER=deepseek` as its default. DeepSeek credentials
are loaded from the parent UOM `.env` and remain server-side.

默认单次 ACP 分析最长等待 5 分钟。文档较大或 Codex 推理较慢时，可通过
`CODEX_ACP_TIMEOUT_MS`（毫秒）调整，例如 `CODEX_ACP_TIMEOUT_MS=600000`。

The server starts with:

```bash
npm install
npm run dev -- --host 127.0.0.1
```

The Codex adapter needs a working Codex login or API-compatible provider in the
user's Codex configuration. If the ACP call fails, the UI reports the error and
keeps the previous draft; it never silently falls back to fixed demo data.
