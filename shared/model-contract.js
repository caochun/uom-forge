const text = { type: 'string', minLength: 1 }
const texts = { type: 'array', items: text }
const record = (properties) => ({ type: 'object', additionalProperties: false, properties, required: Object.keys(properties) })
const list = (item) => ({ type: 'array', items: item })
export const evidence = list(record({ blockId: text, quote: text }))
const properties = list(record({
  name: text,
  type: { enum: ['string', 'number', 'integer', 'boolean', 'date', 'datetime', 'enum'] },
  description: text,
  evidence,
}))
const identity = { id: text, name: text, description: text, evidence }

// Provider-neutral modeling output; no dependency on UOM/OAG runtime schemas.
export const MODEL_SCHEMA = record({
  schemaVersion: { const: '1' }, name: text, summary: text,
  objects: list(record({ ...identity, properties })),
  relations: list(record({ ...identity, from: text, to: text, properties })),
  actions: list(record({ ...identity, targets: texts, inputs: properties, preconditions: texts, effects: texts })),
  functions: list(record({ ...identity, targets: texts, inputs: properties, output: text })),
  rules: list(record({ ...identity, elements: texts })),
  activities: list(record({
    id: text, name: text, goal: text, evidence,
    requirements: list(record({
      description: text, elements: texts,
      status: { enum: ['covered', 'partial', 'missing'] }, reason: text, evidence,
    })),
  })),
  questions: texts,
})

export const MODEL_COLLECTIONS = ['objects', 'relations', 'actions', 'functions', 'rules', 'activities']

export function activityCoverage(activity) {
  const requirements = activity.requirements || []
  if (!requirements.length) return null
  return Math.round(requirements.filter((item) => item.status === 'covered').length / requirements.length * 100)
}

export function modelDiff(before, after) {
  return MODEL_COLLECTIONS.map((key) => {
    const old = new Map((before?.[key] || []).map((item) => [item.id, item]))
    const next = new Map((after?.[key] || []).map((item) => [item.id, item]))
    return {
      key,
      added: [...next.keys()].filter((id) => !old.has(id)).length,
      removed: [...old.keys()].filter((id) => !next.has(id)).length,
      changed: [...next.keys()].filter((id) => old.has(id) && JSON.stringify(old.get(id)) !== JSON.stringify(next.get(id))).length,
    }
  })
}
