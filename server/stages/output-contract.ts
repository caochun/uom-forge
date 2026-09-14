// Compact notation for the conceptual round. The full JSON Schema stays in the
// validator; business input for this turn is exclusively the semantic plan.
export const COMPILE_OUTPUT_CONTRACT = `以下为结构记法，实际输出 JSON（不是 TypeScript）。业务语义字段必须提供；evidence、properties、inputs 以及活动要求的 status/reason/evidence 等无语义的空字段可省略，程序会统一补齐默认值。
Element = { id: string, name: string, description: string }
Object = Element + { properties?: [] }
Relation = Element + { from: objectId, to: objectId, properties?: [] }
Action = Element + { targets: objectId[], inputs?: [], preconditions: string[], effects: string[] }
Function = Element + { targets: objectId[], inputs?: [], output: string }
Rule = Element + { elements: elementId[] }
Requirement = { description: string, elements: elementId[], status?: "partial", reason?: "待支撑评估", evidence?: [] }
Activity = { id: string, name: string, goal: string, requirements: Requirement[], evidence?: [] }
Model = { schemaVersion?: "1", name: string, summary: string, objects?: Object[], relations?: Relation[], actions?: Action[], functions?: Function[], rules?: Rule[], activities?: Activity[], boundaries?: string[] }
“+”代表将字段展开到同一对象内。objectId 引用 objects 中的 id；elementId 引用本模型已有元素 id。字符串非空。`
