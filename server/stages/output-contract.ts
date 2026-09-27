// Compact notation for the conceptual round. The full JSON Schema stays in the
// validator; business input for this turn is exclusively the model design text.
export const COMPILE_OUTPUT_CONTRACT = `结构契约：
- 下面是字段结构说明；实际返回必须是 JSON，不是 TypeScript。
- 当前结构不展开 properties、inputs；必要业务语义须保留在对应定义中。原文证据未在此阶段提供，不生成 evidence；这三个数组可省略，由程序补为 []。
- Element = { id: string, name: string, description: string }
- Object = Element + { properties?: [] }
- Relation = Element + { from: objectId, to: objectId, properties?: [] }
- Action = Element + { targets: objectId[], inputs?: [], preconditions: string[], effects: string[] }
- Function = Element + { targets: objectId[], inputs?: [], output: string }
- Rule = Element + { elements: elementId[] }
- Model = { schemaVersion?: "1", name: string, summary: string, objects?: Object[], relations?: Relation[], actions?: Action[], functions?: Function[], rules?: Rule[], boundaries?: string[] }
- “+”表示把右侧字段放到同一个对象中。
- objectId 必须引用 objects 中已有的 id；elementId 必须引用模型中已有的元素 id。
- 所有字符串必须非空。`

// Business meanings and a compact shape suffice in the prompt; Ajv validates the response.
export const ASSESSMENT_OUTPUT_CONTRACT = `输出约定：
- 只返回一个 JSON 对象，不加代码围栏；结构如下，所有列出的字段均必填，不增加其他字段：
- Assessment = { summary: string, caseAssessments: Case[], recommendations: string[], clarifications: Clarification[] }
- Case = { caseId: string, scenario: string, basis: string, status: "supported" | "partial" | "missing" | "clarify", elements: string[], explanation: string, gap: string, suggestion: string }
- Clarification = { text: string, basis: string, ambiguity: string, impact: string, options: string[], multiple: boolean }
- caseId 沿用案例编号或名称；没有时分配本报告内唯一编号。scenario 写清具体上下文和预期表达或推理结果，basis 摘录建模依据中支持该案例的原句。案例不重复。
- elements 只引用当前模型中实际参与表达的元素 id；explanation 说明表达或推理路径，缺失之处如实说明。
- supported 表示可表达，partial 表示部分表达，missing 表示无有效支撑；业务未决导致无法判断时用 clarify。明确模型缺口与未决同时存在时先用 partial 或 missing，并分别说明。
- supported、partial 必须引用实际元素；supported 的 gap、suggestion 为空字符串，其余状态写清缺口或未决边界及处理建议。
- summary 概括本轮案例结论，recommendations 只放跨案例建议。没有可形成的案例时 caseAssessments 可为空，并说明原因；不宣称穷尽业务。
- clarifications 只列新发现且影响明确业务要求的歧义、冲突或必要信息缺失：text 写问题，basis 引用建模依据原句，ambiguity 写不同解释、冲突或缺失内容，impact 写影响；已有未决只在对应案例说明，不重复提问。有合理答案时填写 options，multiple 表示是否可多选；没有合理选项时用 []、false。没有新问题时为 []。
- 除 gap、suggestion 外，字符串均非空；数组无内容时用 []。不输出原文证据或流程元素。`
