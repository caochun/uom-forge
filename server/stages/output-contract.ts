// Compact notation for the conceptual round. The full JSON Schema stays in the
// validator; business input for this turn is exclusively the model design text.
export const COMPILE_OUTPUT_CONTRACT = `结构契约：
- 下面是字段结构说明；实际返回必须是 JSON，不是 TypeScript。
- 有业务含义的字段必须填写。evidence、properties、inputs，以及 activity requirement 的 status/reason/evidence 只是程序元数据，可以省略，由程序补齐。
- Element = { id: string, name: string, description: string }
- Object = Element + { properties?: [] }
- Relation = Element + { from: objectId, to: objectId, properties?: [] }
- Action = Element + { targets: objectId[], inputs?: [], preconditions: string[], effects: string[] }
- Function = Element + { targets: objectId[], inputs?: [], output: string }
- Rule = Element + { elements: elementId[] }
- Requirement = { description: string, elements: elementId[], status?: "partial", reason?: "待业务审阅", evidence?: [] }
- Activity = { id: string, name: string, goal: string, requirements: Requirement[], evidence?: [] }
- Model = { schemaVersion?: "1", name: string, summary: string, objects?: Object[], relations?: Relation[], actions?: Action[], functions?: Function[], rules?: Rule[], activities?: Activity[], boundaries?: string[] }
- “+”表示把右侧字段放到同一个对象中。
- objectId 必须引用 objects 中已有的 id；elementId 必须引用模型中已有的元素 id。
- 所有字符串必须非空。`
