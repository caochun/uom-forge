// Review artifacts describe business questions, never a particular domain model.
export interface DesignAcceptance {
  scope: string
  scenario: string
  outcome: string
  questions: {
    id: string
    question: string
    kind: 'result' | 'behavior' | 'boundary'
    grounding: 'explicit' | 'inferred' | 'unknown'
    sourceQuote: string
    reason: string
    expected: string
  }[]
}

export interface DefinitionEvidence { quote: string; reason: string }
export interface DesignCheckReport {
  summary: string
  answers: {
    questionId: string
    status: 'supported' | 'gap' | 'clarify' | 'bounded' | 'not-applicable'
    sourceQuote: string
    evidence: DefinitionEvidence[]
    scenario: string
    result: string
    gap: string
  }[]
  issues: {
    id: string
    type: 'basis' | 'model' | 'business'
    status: 'open' | 'resolved'
    sourceQuote: string
    problem: string
    acceptance: string
    resolution: string
    evidence: (DefinitionEvidence & { artifact: 'design' | 'basis' })[]
  }[]
}

const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const nonempty = (v: unknown): v is string => typeof v === 'string' && !!v.trim()
const strings = (v: Record<string, unknown>, keys: string[]) => keys.every(k => nonempty(v[k]))
const member = (v: unknown, values: string[]) => typeof v === 'string' && values.includes(v)
const evidence = (v: unknown): v is DefinitionEvidence => record(v) && strings(v, ['quote', 'reason'])

// Shared decoding checks shape only. Source, design and history checks run on the server.
export function readDesignAcceptance(v: unknown): DesignAcceptance | undefined {
  if (!record(v) || !strings(v, ['scope', 'scenario', 'outcome']) || !Array.isArray(v.questions) || !v.questions.length ||
    !v.questions.every(q => record(q) && strings(q, ['id', 'question', 'sourceQuote', 'reason', 'expected']) &&
      member(q.kind, ['result', 'behavior', 'boundary']) && member(q.grounding, ['explicit', 'inferred', 'unknown']))) return undefined
  return v as unknown as DesignAcceptance
}

export function readDesignCheckReport(v: unknown): DesignCheckReport | undefined {
  if (!record(v) || !nonempty(v.summary) || !Array.isArray(v.answers) || !Array.isArray(v.issues) ||
    !v.answers.every(a => record(a) && strings(a, ['questionId', 'sourceQuote', 'scenario', 'result']) &&
      member(a.status, ['supported', 'gap', 'clarify', 'bounded', 'not-applicable']) && typeof a.gap === 'string' &&
      Array.isArray(a.evidence) && a.evidence.every(evidence)) ||
    !v.issues.every(i => record(i) && strings(i, ['id', 'sourceQuote', 'problem', 'acceptance', 'resolution']) &&
      member(i.type, ['basis', 'model', 'business']) && member(i.status, ['open', 'resolved']) &&
      Array.isArray(i.evidence) && i.evidence.every(e => evidence(e) && member((e as unknown as Record<string, unknown>).artifact, ['design', 'basis'])))) return undefined
  return v as unknown as DesignCheckReport
}

export function acceptanceMarkdown(acceptance: DesignAcceptance): string {
  return `${acceptance.scope}\n\n代表场景：${acceptance.scenario}\n\n预期业务结果：${acceptance.outcome}\n\n${acceptance.questions.map(q =>
    `### ${q.id} · ${q.question}\n\n依据：${q.sourceQuote}\n\n必要性：${q.reason}\n\n验收预期：${q.expected}\n\n依据性质：${{ explicit: '明示', inferred: '推导', unknown: '未决' }[q.grounding]}`,
  ).join('\n\n')}`
}
