import type { SchemaObject } from 'ajv'
const text = { type: 'string', minLength: 1 }
const texts = { type: 'array', items: text }
const record = (properties: Record<string, SchemaObject>) => ({
  type: 'object',
  additionalProperties: false,
  properties,
  required: Object.keys(properties),
})
const list = (item: SchemaObject) => ({ type: 'array', items: item })
export const evidence = list(record({ quote: text }))
const properties = list(
  record({
    name: text,
    type: {
      enum: [
        'string',
        'number',
        'integer',
        'boolean',
        'date',
        'datetime',
        'enum',
      ],
    },
    description: text,
    evidence,
  }),
)
const identity = { id: text, name: text, description: text, evidence }

// Provider-neutral modeling output; no dependency on UOM/OAG runtime schemas.
export const MODEL_SCHEMA = record({
  schemaVersion: { const: '1' },
  name: text,
  summary: text,
  objects: list(record({ ...identity, properties })),
  relations: list(record({ ...identity, from: text, to: text, properties })),
  actions: list(
    record({
      ...identity,
      targets: texts,
      inputs: properties,
      preconditions: texts,
      effects: texts,
    }),
  ),
  functions: list(
    record({ ...identity, targets: texts, inputs: properties, output: text }),
  ),
  rules: list(record({ ...identity, elements: texts })),
  boundaries: texts,
})
