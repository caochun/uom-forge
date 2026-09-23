# 模型推理强度

核对日期：2026-09-20。选项针对项目当前配置的模型及接口，不把同一厂商的所有模型视为具有相同能力。

| 界面模型 | 当前模型配置 | 可选项（从低到高） | 默认 |
| --- | --- | --- | --- |
| GLM | `glm-5.3-flash` | `low`、`high`、`max` | `low` |
| GPT | `gpt-6-astra` | `low`、`medium`、`high`、`xhigh`、`max` | `low` |
| DeepSeek | `deepseek-flash` | 关闭、`low`、`high`、`max` | 关闭 |
| Qwen | `Qwen3.6`，自建服务实际提供 Qwen3.6-35B-A3B GGUF | 关闭、开启 | 关闭 |

## 依据与边界

- **GLM**：[对话补全 API](https://docs.bigmodel.cn/api-reference/模型-api/对话补全) 明确规定 GLM-5.3、GLM-5.3-Flash 只支持 `low/high/max`。[模型说明](https://docs.bigmodel.cn/cn/guide/models/vlm/glm-5.3-flash) 规定 `thinking.type` 只能是 `enabled`，因此没有“关闭”选项。
- **DeepSeek**：[官方思考模式说明](https://api-docs.deepseek.com/guides/thinking_mode) 以 `deepseek-flash` 为例，支持 `thinking.type=enabled/disabled`，开启时 `reasoning_effort=low/high/max`。工具调用后必须保留 `reasoning_content`，Pi 适配器按此传递，不能因为工具交接而关闭用户已开启的思考。
- **Qwen**：[官方深度思考说明](https://help.aliyun.com/zh/model-studio/deep-thinking) 列出 Qwen 3.6 的思考开关，以及 `thinking_budget` Token 上限；没有为 Qwen 3.6 定义 `low/medium/high` 档位。当前配置使用自建 llama.cpp 服务，读取 `/v1/models` 和 `/props` 确认实际模型与模板，模板根据 `enable_thinking` 开关生成思考前缀。该服务使用 `chat_template_kwargs.enable_thinking`；阿里云 DashScope 兼容接口使用顶层 `enable_thinking`。界面提供真实的开关，不将人为 Token 预算包装为官方强度档位。
- **GPT**：尝试获取 [官方模型页](https://developers.openai.com/api/docs/models/gpt-6-astra) 和 [推理指南](https://developers.openai.com/api/docs/guides/reasoning)，本次网络返回 403 或 TLS 错误，无法据此确认。改为核对项目实际使用的 GPT 网关：对 `gpt-6-astra` 请求 `none`，HTTP 400 明确返回 `Supported values are: 'low', 'medium', 'high', 'xhigh', and 'max'`；`low` 和 `max` 的最小流式请求取得 HTTP 200 且返回对应模型的首个流事件后取消。通用非法参数报错还列出 `none/minimal`，但不能当作本模型能力。这里的五档依据是当前网关的模型级校验结果，不声称完成了官方文档确认或每一档的完整推理验证。

## 行为

前端只使用 Pi Agent。页面加载、模型切换后默认采用最低可选项；关闭思考的模型，默认就是关闭。推理强度在一次任务执行期间锁定，下一次任务可重新选择。

`GET /api/models` 只返回模型名称、档位、默认值和说明，不返回 URL、密钥或环境变量。后端根据实际配置的模型识别已核对的能力；未知模型显示“服务默认”，不猜测支持的档位。

`reasoningEffort` 随分析和讨论请求传递，覆盖 `.env` 的强度设置，贯穿业务理解、业务依据、Pi 设计迭代、JSON 编译与修复及讨论。覆盖只作用于当前请求，不修改进程环境。旧 API/脚本未传选择时保持原来的环境配置行为。

无效或过时的选项在开始推理前报错，不悄悄替换用户选择。模型能力加载失败时可重试加载，不能无提示地按服务端默认强度启动。

## 验证

回归测试覆盖所有可选项在 Pi 和结构化模型请求中的实际参数、并发请求隔离、DeepSeek 工具循环中的原始思考回传、Qwen 本地与 DashScope 参数差异、HTTP/SSE 和讨论的参数校验，以及 GLM 全流程五次调用的强度一致性。浏览器回归检查档位随模型变化、最低默认值、请求参数和移动端布局。模拟请求验证参数传递，不代表每一档都进行过真实建模效果评测。
