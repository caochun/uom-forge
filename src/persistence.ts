import type {
  Assessment,
  Question,
  SupportStatus,
  TurnTiming,
  Understanding,
  BusinessClarification,
} from '../shared/analysis.ts'
import type {
  CandidateModel,
  Evidence,
  Property,
  Requirement,
} from '../shared/model.ts'
import type { Project, SemanticPlan } from './types.ts'
import { isRecord, number, record, records, strings, text } from './values.ts'
import { reviseUnderstanding } from './understanding.ts'
import type { ExpressionCase, ExpressionReview } from '../shared/expression.ts'
import {
  EXPRESSION_STATUS,
  interruptReview,
  STAGE_PART_LABELS,
} from '../shared/expression.ts'
import type { StagePart } from '../shared/analysis.ts'

const stages = ['understand', 'model', 'compile', 'narrate', 'assess'] as const
const evidence = (value: unknown): Evidence[] =>
  records(value).map((item) => ({
    ...item,
    blockId: text(item.blockId),
    quote: text(item.quote),
  }))
const element = (item: Record<string, unknown>) => ({
  ...item,
  id: text(item.id),
  name: text(item.name, text(item.label)),
  description: text(item.description),
  evidence: evidence(item.evidence),
})
function properties(value: unknown): Property[] {
  return records(value).map((item) => {
    const kind = item.type
    const type =
      kind === 'number' ||
      kind === 'integer' ||
      kind === 'boolean' ||
      kind === 'date' ||
      kind === 'datetime' ||
      kind === 'enum'
        ? kind
        : 'string'
    return {
      ...item,
      name: text(item.name),
      description: text(item.description),
      type,
      evidence: evidence(item.evidence),
    }
  })
}
// Old drafts can lack optional UI fields and predate the current layout. Decode
// at the storage boundary, retaining original extra fields rather than treating
// every JSON value as an already typed Project or discarding the user's draft.
function readModel(value: unknown): CandidateModel | null {
  if (!isRecord(value) || !Array.isArray(value.objects)) return null
  const { questions: _questions, ...semantic } = value
  return {
    ...semantic,
    schemaVersion: '1',
    name: text(value.name, '已有候选模型'),
    summary: text(value.summary),
    objects: records(value.objects).map((item) => ({
      ...element(item),
      properties: properties(item.properties),
    })),
    relations: records(value.relations).map((item) => ({
      ...element(item),
      name: text(item.name, text(item.label, '关联')),
      from: text(item.from, text(item.fromId)),
      to: text(item.to, text(item.toId)),
      properties: properties(item.properties),
    })),
    actions: records(value.actions).map((item) => ({
      ...element(item),
      targets: strings(item.targets),
      inputs: properties(item.inputs),
      preconditions: strings(item.preconditions),
      effects: strings(item.effects),
    })),
    functions: records(value.functions).map((item) => ({
      ...element(item),
      targets: strings(item.targets),
      inputs: properties(item.inputs),
      output: text(item.output),
    })),
    rules: records(value.rules).map((item) => ({
      ...element(item),
      elements: strings(item.elements),
    })),
    activities: records(value.activities).map((item) => ({
      ...item,
      id: text(item.id),
      name: text(item.name),
      goal: text(item.goal),
      evidence: evidence(item.evidence),
      requirements: records(item.requirements).map(
        (requirement): Requirement => ({
          ...requirement,
          description: text(requirement.description),
          elements: strings(requirement.elements),
          status:
            requirement.status === 'covered' || requirement.status === 'missing'
              ? requirement.status
              : 'partial',
          reason: text(requirement.reason),
          evidence: evidence(requirement.evidence),
        }),
      ),
    })),
    boundaries: strings(value.boundaries),
  }
}
function readUnderstanding(value: unknown): Understanding | null {
  if (!isRecord(value)) return null
  const questions: Question[] = Array.isArray(value.questions)
    ? value.questions.flatMap((question: unknown): Question[] => {
        if (typeof question === 'string')
          return [{ text: question, options: [] }]
        if (!isRecord(question)) return []
        return [
          {
            ...question,
            text: text(question.text),
            options: strings(question.options),
            multiple: question.multiple === true,
            clarification:
              isRecord(question.clarification) &&
              ['model', 'assess'].includes(
                String(question.clarification.source),
              )
                ? {
                    source:
                      question.clarification.source === 'model'
                        ? 'model'
                        : 'assess',
                    basis: text(question.clarification.basis),
                    ambiguity: text(question.clarification.ambiguity),
                    impact: text(question.clarification.impact),
                  }
                : undefined,
          },
        ]
      })
    : []
  return {
    ...value,
    narrative: text(value.narrative),
    questions,
    warnings: strings(value.warnings),
  }
}
function readAssessment(value: unknown): Assessment | null {
  if (!isRecord(value)) return null
  const { questions: _questions, ...assessment } = value
  const status = (value: unknown): SupportStatus =>
    value === 'supported' || value === 'missing' ? value : 'partial'
  return {
    ...assessment,
    summary: text(value.summary),
    recommendations: strings(value.recommendations),
    clarifications: records(value.clarifications).map(
      (item): BusinessClarification => ({
        text: text(item.text),
        basis: text(item.basis),
        ambiguity: text(item.ambiguity),
        impact: text(item.impact),
        options: strings(item.options),
        multiple: item.multiple === true,
      }),
    ),
    historicalQuestions: [
      ...new Set([
        ...strings(value.historicalQuestions),
        ...strings(value.questions),
      ]),
    ],
    processAssessments: records(value.processAssessments).map((item) => ({
      ...item,
      processId: text(item.processId),
      processName: text(item.processName),
      status: status(item.status),
      // Preserve old conclusions, but never invent a requirement/element mapping.
      reason: text(item.reason, strings(item.gaps).join('；')),
      requirements: records(item.requirements).map((requirement) => ({
        ...requirement,
        requirement: text(requirement.requirement),
        status: status(requirement.status),
        elements: strings(requirement.elements),
        explanation: text(requirement.explanation),
        gap: text(requirement.gap),
        suggestion: text(requirement.suggestion),
        evidence: evidence(requirement.evidence),
      })),
      evidence: evidence(item.evidence),
    })),
  }
}
function readPlan(value: unknown): SemanticPlan | null {
  if (!isRecord(value)) return null
  return {
    ...value,
    plan: text(value.plan),
    complete: value.complete === true,
    compiled: value.compiled === true,
    warnings: strings(value.warnings),
  }
}
function readExpressionReview(value: unknown): ExpressionReview | undefined {
  if (
    !isRecord(value) ||
    typeof value.status !== 'string' ||
    !(value.status in EXPRESSION_STATUS)
  )
    return undefined
  const snapshots: ExpressionReview['snapshots'] = records(
    value.snapshots,
  ).flatMap((snapshot) => {
    const model = readModel(snapshot.model)
    if (!model) return []
    const check =
      isRecord(snapshot.check) && Array.isArray(snapshot.check.cases)
        ? {
            summary: text(snapshot.check.summary),
            warnings: strings(snapshot.check.warnings),
            cases: records(snapshot.check.cases).map(
              (item): ExpressionCase => ({
                id: text(item.id),
                fact: text(item.fact),
                basis: text(item.basis),
                basisIds: strings(item.basisIds),
                scenario: text(item.scenario),
                status:
                  item.status === 'expressed' || item.status === 'defect'
                    ? item.status
                    : 'uncertain',
                elements: strings(item.elements),
                explanation: text(item.explanation),
                gap: text(item.gap),
                suggestion: text(item.suggestion),
              }),
            ),
            clarifications: records(snapshot.check.clarifications).map(
              (item): BusinessClarification => ({
                text: text(item.text),
                basis: text(item.basis),
                ambiguity: text(item.ambiguity),
                impact: text(item.impact),
                options: strings(item.options),
                multiple: item.multiple === true,
              }),
            ),
          }
        : undefined
    return [{ model, check }]
  })
  if (!snapshots.length) return undefined
  return interruptReview({
    status: value.status as ExpressionReview['status'],
    snapshots,
    selectedSnapshot:
      Number.isInteger(value.selectedSnapshot) &&
      number(value.selectedSnapshot) >= 0 &&
      number(value.selectedSnapshot) < snapshots.length
        ? number(value.selectedSnapshot)
        : snapshots.length - 1,
    changes: records(value.changes).map((change) => ({
      collection: text(change.collection),
      id: text(change.id),
      value: change.value,
      caseIds: strings(change.caseIds),
      reason: text(change.reason),
    })),
    warnings: strings(value.warnings),
  })
}
function readTimings(value: unknown): Project['timings'] {
  const source = record(value)
  const result: Project['timings'] = {}
  for (const stage of stages) {
    if (!Array.isArray(source[stage])) continue
    result[stage] = records(source[stage]).flatMap((item) => {
      if (
        typeof item.callId !== 'string' ||
        (item.provider !== 'codex' &&
          item.provider !== 'deepseek' &&
          item.provider !== 'gpt')
      )
        return []
      const status: TurnTiming['status'] =
        item.status === 'completed' || item.status === 'cancelled'
          ? item.status
          : 'failed'
      const optionalNumber = (value: unknown) =>
        typeof value === 'number' && Number.isFinite(value) ? value : undefined
      return [
        {
          ...item,
          callId: item.callId,
          provider: item.provider,
          model: text(item.model),
          reasoningEffort:
            typeof item.reasoningEffort === 'string'
              ? item.reasoningEffort
              : undefined,
          startedAt: text(item.startedAt),
          promptCharacters: number(item.promptCharacters),
          outputCharacters: number(item.outputCharacters),
          elapsedMs: number(item.elapsedMs),
          connectedMs: optionalNumber(item.connectedMs),
          sessionReadyMs: optionalNumber(item.sessionReadyMs),
          firstTextMs: optionalNumber(item.firstTextMs),
          status,
          part:
            typeof item.part === 'string' && item.part in STAGE_PART_LABELS
              ? (item.part as StagePart)
              : undefined,
        },
      ]
    })
  }
  return result
}
export function restoreProject(value: unknown, empty: Project): Project {
  if (!isRecord(value)) return empty
  const current = value.version === 4
  const candidate = record(value.candidate)
  const model = current
    ? readModel(candidate.model)
    : records(value.objects).length
      ? readModel({
          ...value,
          actions: records(value.capabilities).filter(
            (item) => item.kind === '操作',
          ),
          functions: records(value.capabilities).filter(
            (item) => item.kind === '只读能力',
          ),
        })
      : null
  const savedUnderstanding = record(value.understanding)
  const reading =
    readUnderstanding(savedUnderstanding.source) ||
    readUnderstanding(value.understanding)
  const plan = readPlan(current ? value.plan : value.modelingState)
  const revision = record(value.revisions)
  const document = record(value.document)
  const answers: Project['answers'] = {}
  for (const [key, answer] of Object.entries(
    record(current ? value.answers : value.questionAnswers),
  )) {
    if (!/^\d+$/.test(key)) continue
    if (typeof answer === 'string') answers[Number(key)] = answer
    else if (Array.isArray(answer)) answers[Number(key)] = strings(answer)
  }
  const savedAnswers: Project['answers'] = {}
  for (const [key, answer] of Object.entries(
    record(savedUnderstanding.confirmedAnswers),
  )) {
    if (!/^\d+$/.test(key)) continue
    if (typeof answer === 'string') savedAnswers[Number(key)] = answer
    else if (Array.isArray(answer)) savedAnswers[Number(key)] = strings(answer)
  }
  // Upgrade already-saved confirmations locally, preserving uncommitted edits.
  const understanding = reading
    ? reviseUnderstanding(
        reading,
        isRecord(savedUnderstanding.source)
          ? savedAnswers
          : value.questionsSaved === true
            ? answers
            : {},
      )
    : null
  const nullableNumber = (
    value: unknown,
    fallback: number | null,
  ): number | null =>
    value === null
      ? null
      : typeof value === 'number' && Number.isFinite(value)
        ? value
        : fallback
  const revisions = current
    ? {
        document: number(revision.document),
        business: number(revision.business),
        understoodDocument: nullableNumber(revision.understoodDocument, null),
        planBasis: nullableNumber(revision.planBasis, null),
        candidateBasis: nullableNumber(revision.candidateBasis, null),
        model: number(revision.model),
        narrationBasis: nullableNumber(revision.narrationBasis, null),
        assessmentBasis: nullableNumber(revision.assessmentBasis, null),
      }
    : {
        ...empty.revisions,
        understoodDocument: understanding ? 0 : null,
        planBasis: plan?.complete ? 0 : null,
        candidateBasis: model ? 0 : null,
        model: model ? 1 : 0,
      }
  const outputs: Project['outputs'] = {}
  const priorModel = record(current ? candidate.model : value)
  if (
    (understanding &&
      understanding.narrative !== savedUnderstanding.narrative) ||
    (strings(priorModel.questions).length > 0 &&
      !Array.isArray(priorModel.boundaries))
  )
    revisions.business += 1
  const rawOutputs = record(value.outputs)
  for (const stage of stages)
    if (typeof rawOutputs[stage] === 'string')
      outputs[stage] = rawOutputs[stage]
  return {
    ...empty,
    ...value,
    version: 4,
    document: {
      ...empty.document,
      ...document,
      name: text(document.name, empty.document.name),
      content: text(document.content),
      size: text(document.size, empty.document.size),
      updated: text(document.updated),
      blocks: records(document.blocks).map((item) => ({
        ...item,
        id: text(item.id),
        text: text(item.text),
      })),
    },
    understanding,
    plan,
    candidate: model
      ? {
          ...candidate,
          model,
          revision: number(candidate.revision, 1),
          documentRevision: number(candidate.documentRevision),
          edited: candidate.edited === true,
          ...(candidate.expressionReview
            ? {
                expressionReview: readExpressionReview(
                  candidate.expressionReview,
                ),
              }
            : {}),
          historicalQuestions: [
            ...new Set([
              ...strings(candidate.historicalQuestions),
              ...strings(record(current ? candidate.model : value).questions),
            ]),
          ],
        }
      : null,
    answers,
    questionsSaved: value.questionsSaved === true,
    feedback: text(value.feedback),
    feedbackDocumentRevision: current
      ? nullableNumber(
          value.feedbackDocumentRevision ?? revisions.document,
          revisions.document,
        )
      : null,
    narration: text(current ? value.narration : value.modelNarrative),
    assessment: readAssessment(value.assessment),
    outputs,
    timings: readTimings(value.timings),
    revisions,
    messages:
      current && Array.isArray(value.messages)
        ? records(value.messages).map((item) => ({
            ...item,
            id: typeof item.id === 'string' ? item.id : undefined,
            role: item.role === 'user' ? 'user' : 'assistant',
            content: text(item.content),
            progress: false,
            stage: stages.find((stage) => stage === item.stage),
            context: isRecord(item.context)
              ? {
                  ...item.context,
                  name: text(item.context.name),
                  description: text(item.context.description),
                  id:
                    typeof item.context.id === 'string'
                      ? item.context.id
                      : undefined,
                }
              : null,
          }))
        : empty.messages,
  }
}
