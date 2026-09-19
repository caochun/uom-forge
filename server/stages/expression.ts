import { artifactVersion } from '../../shared/workflow.ts'
import type { ExpressionBaseline } from '../../shared/expression.ts'
import type { SemanticPlanV2 } from '../../shared/semantic.ts'
import { containsBasis } from '../../shared/clarifications.ts'
import type { ExpressionReview } from '../../shared/expression.ts'
import type { ModelingResult } from '../../shared/analysis.ts'
import { MODEL_COLLECTIONS } from '../../shared/model.ts'
import { questionKey } from '../../shared/clarifications.ts'
import type { RunTurn } from '../providers/types.ts'
import { scopedTurn, type StageOptions } from './contracts.ts'
import { expressionPrompt, repairPrompt } from './expression-prompts.ts'
import {
  applyModelRepair,
  parseExpressionCheck,
} from '../validation/expression.ts'
import { errorMessage } from '../validation/values.ts'

async function runExpressionCheck(
  narrative: string,
  model: ModelingResult['model'],
  runTurn: RunTurn,
  options: StageOptions,
  previous?: ExpressionBaseline,
  semantic?: SemanticPlanV2,
  mode: 'initial' | 'recheck' = 'recheck',
): Promise<import('../../shared/expression.ts').ExpressionCheck> {
  let formatError = ''
  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = await runTurn(
      expressionPrompt(
        narrative,
        model,
        previous,
        formatError,
        semantic?.understandingReview,
        mode,
      ),
      scopedTurn(options, mode === 'recheck' ? 'recheck' : 'expression'),
    )
    try {
      const check = parseExpressionCheck(raw, narrative, model, previous, mode)
      if (semantic) for (const item of check.cases) {
        if (item.factIds?.some(id => !semantic.facts.some(f => f.id === id)))
          throw new Error(`检查用例 ${item.id} 引用了未知事实。`)
        item.factIds ??= semantic.facts.filter(f => containsBasis(item.basis, f.source)).map(f => f.id)
      }
      return check
    } catch (error) {
      formatError = errorMessage(error)
      // Provider failures are not recoverable by changing the prompt; let
      // the outer stage preserve an incomplete review. Retry only malformed
      // or structurally invalid checker output.
      const retryable = [
        '业务表达检查',
        '复查必须',
        '复查遗漏',
        '复查用例',
        '复查不能',
        '重复检查用例',
        '检查用例',
        '可表达用例',
        '未解决用例',
      ].some((marker) => formatError.includes(marker))
      if (!retryable) throw error
      if (attempt === 1) throw error
      options.onEvent?.({
        type: 'phase',
        part: mode === 'recheck' ? 'recheck' : 'expression',
        text: '检查结果格式无效，正在请求一次结构化重试。',
      })
    }
    options.signal?.throwIfAborted()
  }
  throw new Error('业务表达检查未返回有效结果。')
}

// Bound cost and preserve every valid candidate before invoking more inference.
export async function checkAndRepair(
  result: Omit<ModelingResult, 'expressionReview'>,
  narrative: string,
  runTurn: RunTurn,
  options: StageOptions,
  retained?: ExpressionReview,
): Promise<ModelingResult> {
  let model = result.model
  const review: ExpressionReview = retained ? structuredClone(retained) : {
    status: 'checking',
    snapshots: [{ model }],
    selectedSnapshot: 0,
    changes: [],
    warnings: [],
  }
  const originalIndex = review.selectedSnapshot
  if (retained) review.warnings = []
  review.status = 'checking'
  review.lineage = {
    narrativeVersion: artifactVersion(narrative), planVersion: artifactVersion(result.semanticPlan),
    compiledModelVersion: retained?.lineage?.compiledModelVersion || artifactVersion(result.model),
    candidateVersion: artifactVersion(model),
  }
  const repairable = (item: import('../../shared/expression.ts').ExpressionCase) =>
    item.status === 'defect' && (!item.repairTarget || item.repairTarget === 'model')
  const statusFor = (check: import('../../shared/expression.ts').ExpressionCheck): ExpressionReview['status'] =>
    check.cases.some(repairable) ? 'repairing' :
      check.cases.some(item => item.status !== 'expressed') || check.clarifications.length || check.warnings.length ? 'issues' : 'passed'
  const seeds: ExpressionBaseline | undefined = result.semantic?.scenarios?.length ? {
    cases: result.semantic.scenarios.map(item => ({
      id: item.id, fact: item.statement, scenario: `${item.scenario}\n需保留的区别：${item.distinction}`,
      factIds: item.factIds,
      basis: (() => {
        const sources = [...new Set(item.factIds.map(id => result.semantic!.facts.find(f => f.id === id)!.source))]
        return sources.length === 1 ? sources[0] : sources.map(source => `“${source}”`).join('；')
      })(),
    })),
  } : undefined
  const publish = () => {
    review.lineage!.candidateVersion = artifactVersion(model)
    options.onEvent?.({
      type: 'model-checkpoint',
      model,
      expressionReview: structuredClone(review),
    })
  }
  const phase = (part: 'expression' | 'repair' | 'recheck', text: string) => {
    options.signal?.throwIfAborted()
    options.onEvent?.({ type: 'phase', part, text })
  }
  publish()
  try {
    phase('expression', '检查候选模型能否表达具体业务事实。')
    const baseline = retained?.snapshots.slice(0, retained.selectedSnapshot + 1).reverse().find(snapshot => snapshot.check)?.check || seeds
    const first = await runExpressionCheck(
      narrative,
      model,
      runTurn,
      options,
      baseline,
      result.semantic,
      retained ? 'recheck' : 'initial',
    )
    options.signal?.throwIfAborted()
    review.snapshots[originalIndex].check = first
    review.warnings.push(...first.warnings)
    review.status = statusFor(first)
    publish()
    // Keep the semantic gate closed until a candidate passes a complete
    // check. A bounded loop lets the checker repair more than one defect
    // (including schema/reference errors introduced by a repair) while
    // avoiding an unbounded agent conversation.
    const maxRounds = 3
    let previousCheck = first
    for (let round = 0; round < maxRounds && review.status === 'repairing'; round++) {
      phase('repair', `按已明确的业务语义进行第 ${round + 1} 轮定点修正。`)
      let repaired: ReturnType<typeof applyModelRepair> | undefined
      let repairError: string | undefined
      for (let attempt = 0; attempt < 2 && !repaired; attempt++) {
        // Provider failures (timeouts/cancellation) belong to the outer
        // stage and must produce an `incomplete` review. Only malformed
        // patches are recovered locally and sent back with the validator
        // error.
        const rawRepair = await runTurn(
          repairPrompt(narrative, model, previousCheck, repairError),
          scopedTurn(options, 'repair'),
        )
        try {
          repaired = applyModelRepair(rawRepair, model, previousCheck)
        } catch (error) {
          repairError = errorMessage(error)
          if (attempt === 1) {
            review.status = 'incomplete'
            review.warnings.push(`定点修正未通过程序校验：${repairError}`)
          }
        }
        options.signal?.throwIfAborted()
      }
      if (!repaired) break
      if (
        !repaired.changes.length ||
        JSON.stringify(repaired.model) === JSON.stringify(model)
      ) {
        review.status = 'issues'
        review.warnings.push('未产生有效修正，已保留原候选与未解决缺陷。')
        break
      }
      const previousIndex = review.selectedSnapshot
      model = repaired.model
      review.changes.push(...repaired.changes)
      review.snapshots.push({ model })
      review.selectedSnapshot = review.snapshots.length - 1
      review.status = 'checking'
      publish()
      phase('recheck', '复查原有业务事实及相关语义，检查是否产生回归。')
      const next = await runExpressionCheck(
        narrative,
        model,
        runTurn,
        options,
        previousCheck,
        result.semantic,
      )
      options.signal?.throwIfAborted()
      review.snapshots[review.snapshots.length - 1].check = next
      review.warnings.push(...next.warnings)
      const regressions = previousCheck.cases.filter(
        (item) =>
          item.status === 'expressed' &&
          next.cases.find((candidate) => candidate.id === item.id)?.status !==
            'expressed',
      )
      if (regressions.length) {
        model = review.snapshots[previousIndex].model
        review.selectedSnapshot = previousIndex
        review.status = 'issues'
        review.warnings.push(
          `复查不再认可原先通过的业务事实（${regressions.map((item) => item.id).join('、')}），已恢复本轮修正前的候选；不继续自动循环。`,
        )
        break
      }
      previousCheck = next
      review.status = statusFor(next)
      publish()
    }
    if (review.status === 'repairing') {
      review.status = 'issues'
      review.warnings.push(`已达到 ${maxRounds} 轮自动修正上限，剩余缺陷保留供审阅。`)
    }
  } catch (error) {
    review.status = 'incomplete'
    review.warnings.push(
      `业务表达检查未完成，最后一次有效候选已保留：${errorMessage(error)}`,
    )
    publish()
    options.signal?.throwIfAborted()
  }
  publish()
  const clarificationMap = new Map(
    result.clarifications.map((item) => [questionKey(item.text), item]),
  )
  const latestCheck = review.snapshots[review.selectedSnapshot]?.check
  for (const item of latestCheck?.clarifications || [])
    clarificationMap.set(questionKey(item.text), item)
  return {
    ...result,
    model,
    expressionReview: review,
    clarifications: [...clarificationMap.values()],
    validation: {
      elements: MODEL_COLLECTIONS.reduce(
        (count, key) => count + model[key].length,
        0,
      ),
      warnings: [...result.validation.warnings, ...review.warnings],
    },
  }
}
