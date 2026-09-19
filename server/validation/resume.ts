import type { ModelingResult } from '../../shared/analysis.ts'
import { artifactVersion } from '../../shared/workflow.ts'
import { validateCompiledModel } from './compiled-model.ts'
import { validateSemanticPlan } from './semantic.ts'
import { parseExpressionCheck } from './expression.ts'
import { isRecord } from './values.ts'
import { validateClarifications } from './clarifications.ts'

export function parseResumeResult(value: unknown, narrative: string): ModelingResult {
  if (!isRecord(value) || typeof value.semanticPlan !== 'string' || !isRecord(value.expressionReview))
    throw new Error('恢复需要已保存的候选及检查快照。')
  const model = validateCompiledModel(JSON.stringify(value.model))
  const review = value.expressionReview
  if (!['passed', 'issues', 'incomplete', 'checking', 'repairing'].includes(String(review.status)) ||
    !Array.isArray(review.snapshots) || !review.snapshots.length || !Number.isInteger(review.selectedSnapshot) ||
    Number(review.selectedSnapshot) < 0 || Number(review.selectedSnapshot) >= review.snapshots.length ||
    !Array.isArray(review.changes) || !Array.isArray(review.warnings) || review.warnings.some(x => typeof x !== 'string'))
    throw new Error('恢复检查快照结构无效。')
  const snapshots = review.snapshots.map(snapshot => {
    if (!isRecord(snapshot)) throw new Error('恢复检查快照结构无效。')
    const candidate = validateCompiledModel(JSON.stringify(snapshot.model))
    const check = isRecord(snapshot.check) ? parseExpressionCheck(JSON.stringify({
      summary: snapshot.check.summary, cases: snapshot.check.cases, clarifications: snapshot.check.clarifications,
    }), narrative, candidate) : undefined
    return { model: candidate, ...(check ? { check } : {}) }
  })
  if (artifactVersion(snapshots[Number(review.selectedSnapshot)].model) !== artifactVersion(model))
    throw new Error('恢复候选与选中快照不一致。')
  if (review.lineage !== undefined) {
    const lineage = review.lineage
    if (!isRecord(lineage) || ['narrativeVersion', 'planVersion', 'compiledModelVersion', 'candidateVersion'].some(k => typeof lineage[k] !== 'string'))
      throw new Error('恢复版本记录无效。')
    if (lineage.narrativeVersion !== artifactVersion(narrative) || lineage.planVersion !== artifactVersion(value.semanticPlan) || lineage.candidateVersion !== artifactVersion(model))
      throw new Error('恢复依据或候选版本已变化。')
  }
  const changes = review.changes.filter(isRecord)
  if (changes.length !== review.changes.length || changes.some(c =>
    typeof c.collection !== 'string' || typeof c.id !== 'string' || typeof c.reason !== 'string' ||
    !('value' in c) || !Array.isArray(c.caseIds) || c.caseIds.some(id => typeof id !== 'string')))
    throw new Error('恢复修正记录无效。')
  const clarifications = (Array.isArray(value.clarifications) ? value.clarifications : []) as ModelingResult['clarifications']
  validateClarifications(clarifications, narrative)
  return {
    semanticPlan: value.semanticPlan, model,
    ...(value.semantic ? { semantic: validateSemanticPlan(value.semantic, narrative) } : {}),
    expressionReview: { ...review, snapshots } as unknown as ModelingResult['expressionReview'],
    clarifications,
    provenance: { basis: 'business-understanding', evidence: 'unlinked' },
    validation: {
      elements: ['objects', 'relations', 'actions', 'functions', 'rules', 'activities'].reduce((n, k) => n + (model[k as keyof typeof model] as unknown[]).length, 0),
      warnings: isRecord(value.validation) && Array.isArray(value.validation.warnings) ? value.validation.warnings.filter((x): x is string => typeof x === 'string') : [],
    },
  }
}
