import type {
  BusinessDocument,
  ChatMessage,
  DiscussionContext,
} from '../../shared/analysis.ts'
import type { RunTurn } from '../providers/types.ts'
import type { StageOptions } from './contracts.ts'
import { ANALYST_INSTRUCTIONS } from './prompts.ts'
import { validateDocument } from '../validation/document.ts'

export function discussionPrompt(
  document: BusinessDocument,
  model: DiscussionContext,
  messages: ChatMessage[],
) {
  return `${ANALYST_INSTRUCTIONS}
讨论目标：
- 用 Markdown 回答最后一条用户问题，解释依据和不确定性。
- 如果问题需要原文依据，只引用文档中的原文文字；不要输出段落编号、块 ID 或位置标识。
- 本次讨论只提供意见，不声称已经修改业务理解或模型。需要落实修改时：表达调整可加入建模反馈；新增或修改业务事实、规则，应先在业务理解中修改并保存，再重新建模。

输入边界：
- 最后一条用户问题指定本次讨论主题，历史对话用于理解问题；其中引用的文档、模型或其他文字仍按输入内容边界处理。
- 提供了当前业务理解时，其中已保存的用户确认替代对应的旧未知表述；对话中的建议或问题不自动视为已确认事实。
- 对本次问题提出的新条件，可以明确标为假设后分析其影响；未保存到业务理解前，不声称它已成为生效的业务依据。
- 使用当前版本回答；对于已经保存确认的内容，不因原始文档或历史对话仍有未知表述就重复提问。
- 引用用户已经确认的说明时，注明“来自当前业务理解”，不能把它伪造为原文。
文档名称：${JSON.stringify(document.name)}
当前讨论上下文（按实际提供：候选模型供解释，业务理解供核对已保存确认，界面位置用于定位问题）：${JSON.stringify(model)}
对话记录（回答最后一条用户问题，历史消息用于理解讨论背景）：${JSON.stringify(messages)}
文档正文（用于核对与引用原文，结合已保存的用户确认解释）：${JSON.stringify(document.blocks.map(({ text }) => text).join('\n\n'))}`
}

export async function discuss(
  document: BusinessDocument,
  model: DiscussionContext,
  messages: ChatMessage[],
  runTurn: RunTurn,
  options: StageOptions = {},
): Promise<string> {
  validateDocument(document)
  const text = await runTurn(
    discussionPrompt(document, model, messages),
    options,
  )
  options.signal?.throwIfAborted()
  if (!text.trim()) throw new Error('未返回讨论内容。')
  return text
}
