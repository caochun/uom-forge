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

// Bound cost and preserve every valid candidate before invoking more inference.
export async function checkAndRepair(
  result: Omit<ModelingResult, 'expressionReview'>,
  narrative: string,
  runTurn: RunTurn,
  options: StageOptions,
): Promise<ModelingResult> {
  let model = result.model
  const review: ExpressionReview = {
    status: 'checking',
    snapshots: [{ model }],
    selectedSnapshot: 0,
    changes: [],
    warnings: [],
  }
  const publish = () =>
    options.onEvent?.({
      type: 'model-checkpoint',
      model,
      expressionReview: structuredClone(review),
    })
  const phase = (part: 'expression' | 'repair' | 'recheck', text: string) => {
    options.signal?.throwIfAborted()
    options.onEvent?.({ type: 'phase', part, text })
  }
  publish()
  try {
    phase('expression', '检查候选模型能否表达具体业务事实。')
    const first = parseExpressionCheck(
      await runTurn(
        expressionPrompt(narrative, model),
        scopedTurn(options, 'expression'),
      ),
      narrative,
      model,
    )
    options.signal?.throwIfAborted()
    review.snapshots[0].check = first
    review.warnings.push(...first.warnings)
    review.status = first.cases.some((item) => item.status === 'defect')
      ? 'repairing'
      : first.cases.some((item) => item.status === 'uncertain') ||
          first.clarifications.length ||
          first.warnings.length
        ? 'issues'
        : 'passed'
    publish()
    if (review.status === 'repairing') {
      phase('repair', '按已明确的业务语义进行一轮定点修正。')
      const repaired = applyModelRepair(
        await runTurn(
          repairPrompt(narrative, model, first),
          scopedTurn(options, 'repair'),
        ),
        model,
        first,
      )
      options.signal?.throwIfAborted()
      if (
        !repaired.changes.length ||
        JSON.stringify(repaired.model) === JSON.stringify(model)
      ) {
        review.status = 'issues'
        review.warnings.push('未产生有效修正，已保留原候选与未解决缺陷。')
      } else {
        model = repaired.model
        review.changes = repaired.changes
        review.snapshots.push({ model })
        review.selectedSnapshot = 1
        review.status = 'checking'
        publish()
        phase('recheck', '复查原有业务事实及相关语义，检查是否产生回归。')
        const second = parseExpressionCheck(
          await runTurn(
            expressionPrompt(narrative, model, first),
            scopedTurn(options, 'recheck'),
          ),
          narrative,
          model,
          first,
        )
        options.signal?.throwIfAborted()
        review.snapshots[1].check = second
        review.warnings.push(...second.warnings)
        review.status =
          second.cases.every((item) => item.status === 'expressed') &&
          !second.clarifications.length &&
          !second.warnings.length
            ? 'passed'
            : 'issues'
        const regressions = first.cases.filter(
          (item) =>
            item.status === 'expressed' &&
            second.cases.find((next) => next.id === item.id)?.status !==
              'expressed',
        )
        if (regressions.length) {
          model = review.snapshots[0].model
          review.selectedSnapshot = 0
          review.status = 'issues'
          review.warnings.push(
            `复查不再认可原先通过的业务事实（${regressions.map((item) => item.id).join('、')}），已恢复初始候选；修正尝试和两次判断仍保留，请审阅是否发生回归或检查误判。`,
          )
        }
        if (review.status === 'issues')
          review.warnings.push(
            '已完成一轮自动修正；剩余事项保留供审阅，不继续自动循环。',
          )
      }
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
