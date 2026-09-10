// Compact notation for the conceptual round. The full JSON Schema stays in the
// validator; business input for this turn is exclusively the semantic plan.
export const COMPILE_OUTPUT_CONTRACT = `以下为结构记法，实际输出 JSON（不是 TypeScript）。所有字段必填，不添加其他字段；[] 表示必须为空的数组。
Element = { id: string, name: string, description: string, evidence: [] }
Object = Element + { properties: [] }
Relation = Element + { from: objectId, to: objectId, properties: [] }
Action = Element + { targets: objectId[], inputs: [], preconditions: string[], effects: string[] }
Function = Element + { targets: objectId[], inputs: [], output: string }
Rule = Element + { elements: elementId[] }
Requirement = { description: string, elements: elementId[], status: "partial", reason: "待支撑评估", evidence: [] }
Activity = { id: string, name: string, goal: string, evidence: [], requirements: Requirement[] }
Model = { schemaVersion: "1", name: string, summary: string, objects: Object[], relations: Relation[], actions: Action[], functions: Function[], rules: Rule[], activities: Activity[], boundaries: string[] }
“+”代表将字段展开到同一对象内。objectId 引用 objects 中的 id；elementId 引用本模型已有元素 id。字符串非空。`
