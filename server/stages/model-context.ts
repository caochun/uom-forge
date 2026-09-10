// Only semantic fields cross a stage boundary. UI state and earlier document
// quotations in an existing draft must never become hidden stage-two input.
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
const list = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value) ? value.map(record) : []
const pick = (item: Record<string, unknown>, keys: string[]) =>
  Object.fromEntries(
    keys.filter((key) => key in item).map((key) => [key, item[key]]),
  )

export function modelContext(value: unknown): Record<string, unknown> | null {
  const model = record(value)
  const fields = ['id', 'name', 'description']
  const properties = (value: unknown) =>
    list(value).map((item) => pick(item, ['name', 'type', 'description']))
  const context = {
    ...pick(model, ['name', 'summary']),
    objects: list(model.objects).map((item) => ({
      ...pick(item, fields),
      properties: properties(item.properties),
    })),
    relations: list(model.relations).map((item) => ({
      ...pick(item, fields),
      from: item.fromId || item.from,
      to: item.toId || item.to,
      properties: properties(item.properties),
    })),
    actions: list(model.actions).map((item) => ({
      ...pick(item, [...fields, 'targets', 'preconditions', 'effects']),
      inputs: properties(item.inputs),
    })),
    functions: list(model.functions).map((item) => ({
      ...pick(item, [...fields, 'targets', 'output']),
      inputs: properties(item.inputs),
    })),
    rules: list(model.rules).map((item) => pick(item, [...fields, 'elements'])),
    activities: list(model.activities).map((item) => ({
      ...pick(item, ['id', 'name', 'goal']),
      requirements: list(item.requirements).map((requirement) =>
        pick(requirement, ['description', 'elements']),
      ),
    })),
    boundaries: Array.isArray(model.boundaries)
      ? model.boundaries.filter((item) => typeof item === 'string')
      : [],
  }
  return [
    context.objects,
    context.relations,
    context.actions,
    context.functions,
    context.rules,
    context.activities,
  ].some((items) => items.length) ||
    context.boundaries.length ||
    (typeof model.summary === 'string' && model.summary.trim())
    ? context
    : null
}
