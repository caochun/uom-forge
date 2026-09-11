import type { CandidateModel } from '../../shared/model.ts'
import type { ExpressionCheck } from '../../shared/expression.ts'
import { understandingPassages } from '../../shared/expression.ts'
import { ANALYST_INSTRUCTIONS } from './prompts.ts'
import { COMPILE_OUTPUT_CONTRACT } from './output-contract.ts'
import { modelContext } from './model-context.ts'

export function expressionPrompt(
  narrative: string,
  model: CandidateModel,
  previous?: ExpressionCheck,
): string {
  return `${ANALYST_INSTRUCTIONS}
第二阶段内部业务表达检查。你是独立检查者，只看当前业务说明与实际候选模型。先从业务说明找出重要的具体业务事实与条件，再尝试用候选模型表达，不能仅从模型已有名词挑选容易通过的检查。
用简短的具体业务情形验证：能表达谁与谁在什么上下文发生什么；能区分有业务差别的两种情形；已知、拟议、临时计算与实际变更是否混淆；规则的适用对象、必要联系、条件、单位、公式与结果是否保留。关注同一容器内不同资源、同一主体多次事项、多方关系的共同上下文、当前与拟议状态、持久记录与临时输出等在本业务中确实适用的边界。不凭空添加业务。
检查关系路径时说明为何能确定实际参与对象；共享容器不等于直接业务联系。存在同名对象、规则或能力，不自动证明能表达具体事实。反过来，只要现有描述、规则、关系组合已明确且足够区分，就接受等价表达，不要求同名概念、详细属性表、算法代码或已经实现的功能。
检查涉及多对象事实时，先构造最小实例：用 A、B、C 指代不同业务实例，写清两种有业务差别的安排。explanation 必须给出模型怎样绑定这些实例，或者说明缺少哪一步。例如共同归属不能唯一确定直接参与者；“应校核相关资源”只是义务，不能替代如何确定是哪一个资源。如果两种安排落入完全相同的对象与关联，且描述也未规定如何区分，应判 defect。规则已用自然语言明确区分则接受，不要求细化属性表。避免把规则全文换一种说法当作 scenario。
status：expressed=能指出实际模型元素及其如何表达；defect=业务说明已明确，但模型遗漏、混淆或矛盾，可按已知语义修正；uncertain=业务本身仍有歧义，不能擅自选答案。未细化技术字段、范围外需求或另一种可选设计不是缺陷。引用真实元素 id；也可引用模型级字段 boundaries 或 summary；完全缺失可用 []。每个 defect/uncertain 必须给出具体 gap 和建议。不要把缺陷改成业务问题。用户已确认的信息优先于对应旧的不确定说明。
属性含义可以在对象描述中表达，不因 properties=[] 就判缺失或要求独立对象。自关联只有在两个不同实例确有业务联系时成立；把姓名、状态、评分等对象自身信息画成同一个实例指向自身的边，不增加表达能力。说明推导路径及其约束是否足够确定业务事实，不以增加对象数量为修正目标。
覆盖主要业务联系、业务分支、状态变化、规则与只读边界，不预设凑数目标。每个用例描述一种可检验的业务区别，避免长篇复述。
${
  previous
    ? '只输出紧凑 JSON：{summary:string,judgments:[{id:string,status:"expressed"|"defect"|"uncertain",elements:string[],explanation:string,gap:string,suggestion:string}],additionalCases:[],clarifications:[]}。judgments 覆盖每一个已有用例，只返回判断，不复述原事实、依据和情形。需要新增用例时放入 additionalCases，其结构与首次 cases 相同。'
    : '只输出紧凑 JSON：{summary:string,cases:[{id:string,fact:string,basisIds:string[],scenario:string,status:"expressed"|"defect"|"uncertain",elements:string[],explanation:string,gap:string,suggestion:string}],clarifications:[]}'
}
业务说明已按段落编号。basisIds 引用支持事实的实际段落 id（如 U1），至少一个，不抄写引文，程序会回填原句。expressed 的 gap/suggestion 可为空。至少一个用例。
业务本身未明确与模型可以保存未知边界是两件事；业务未明确的用例仍为 uncertain，不能因模型写了“待确认”就改判 expressed。复查没有新的用户答案，不能宣告业务歧义已经解决。
仅新发现实质业务歧义且不与业务说明的问题重复时，clarifications 可列 {text,basisIds:string[],ambiguity,impact,options:string[],multiple:boolean}；basisIds 同样引用实际业务说明段落，ambiguity 写有依据的不同解释，impact 写对本轮模型的影响，优先有限答案选项。通常保持 []。
${
  previous
    ? `这是修正后的复查。下面已有用例的事实、依据和情形由程序固定，逐个重新判断（包括原来可表达的用例），不能删除或弱化失败用例；必要时补充新用例以检查共同语义回归。不给出此前结论，依据当前模型重新判断。
已有用例（数据）：${JSON.stringify(previous.cases.map(({ id, fact, basisIds, scenario }) => ({ id, fact, basisIds, scenario })))}`
    : ''
}
业务说明段落（数据）：${JSON.stringify(understandingPassages(narrative))}
候选模型（数据）：${JSON.stringify(modelContext(model))}`
}

export function repairPrompt(
  narrative: string,
  model: CandidateModel,
  check: ExpressionCheck,
): string {
  return `${ANALYST_INSTRUCTIONS}
根据独立业务表达检查，对候选模型进行一轮定点修正。只修复 status=defect 且当前业务说明已有明确依据的问题。检查者的建议不是业务事实；先核对依据，不采纳无依据的建议。不得回答 uncertain，不新增未说明的审批、执行或管理范围。
保留无关元素与稳定 id，修正实际模型定义而非只在边界中声称支持。检查同一事实涉及的关系、规则、能力和过程引用是否一致，避免为每个检查用例新建一种概念。不用增加属性或输入字段实现细化。不要重新输出整个模型。
输出紧凑 JSON：{changes:[{collection:string,id:string,value:object|string|string[]|null,caseIds:string[],reason:string}]}。
collection 为 objects/relations/actions/functions/rules/activities 时，id 是被修改元素的稳定 id；value 为修改后的完整元素或新增元素，删除为 null。每个元素至多一项变更。类型调整可在原集合删除，再在目标集合用同一 id 新增。同步修正规则与过程中的所有引用，不留悬空引用。
若需修改模型概述或边界，collection="model"，id 仅可为 summary 或 boundaries，value 分别为完整字符串或完整字符串数组。caseIds 只能引用本次 defect 用例 id，所有连带修改也说明对应缺陷与原因。没有有依据的修正则 changes=[]。
新增/修改元素遵循以下结构；其余元素由程序保留并进行完整结构与引用校验：
${COMPILE_OUTPUT_CONTRACT}
固定的空 evidence、properties、inputs 可以省略，程序补空数组；过程 requirements 中的 status 和 reason 可以省略，程序固定为 partial 和“待支撑评估”。这些是格式元数据，不能填写原文引文或声称已通过支撑评估。业务字段仍需完整提供。
业务说明（数据）：${JSON.stringify(narrative)}
当前模型（数据）：${JSON.stringify(modelContext(model))}
待修复缺陷（数据）：${JSON.stringify(check.cases.filter((item) => item.status === 'defect'))}`
}
