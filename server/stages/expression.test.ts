import test from 'node:test'
import assert from 'node:assert/strict'
import type { CandidateModel } from '../../shared/model.ts'
import type { ExpressionCheck } from '../../shared/expression.ts'
import type { ModelingResult, StageEvent } from '../../shared/analysis.ts'
import { checkAndRepair } from './expression.ts'
import {
  parseExpressionCheck,
  applyModelRepair,
} from '../validation/expression.ts'
import { parseAnalysisRequest } from '../validation/requests.ts'

const narrative =
  '一份成果只属于一个事项。事项可以反复查询，查询不产生业务记录。记录是否公开尚未确定。'
const model: CandidateModel = {
  schemaVersion: '1',
  name: '事项管理',
  summary: '管理事项成果。',
  objects: ['matter', 'result'].map((id) => ({
    id,
    name: id,
    description: '独立管理。',
    evidence: [],
    properties: [],
  })),
  relations: [],
  actions: [],
  functions: [],
  rules: [],
  activities: [],
  boundaries: ['公开方式未定。'],
}
const relation = {
  id: 'belongs',
  name: '归属',
  description: '成果仅归属一个事项。',
  from: 'result',
  to: 'matter',
  properties: [],
  evidence: [],
}
const check: ExpressionCheck = {
  summary: '缺少实际归属关系。',
  cases: [
    {
      id: 'ownership',
      fact: '成果属于一个事项',
      basis: narrative,
      basisIds: ['U1'],
      scenario: '事项 A、B 均存在，成果 X 属于 A 而非 B。',
      status: 'defect',
      elements: ['matter', 'result'],
      explanation: '独立对象不能确定 X 的归属。',
      gap: '无法区分成果归属 A 还是 B。',
      suggestion: '补充成果归属关系。',
    },
    {
      id: 'identity',
      fact: '两个事项可分别引用',
      basis: narrative,
      basisIds: ['U1'],
      scenario: '事项 A 与事项 B 有独立身份。',
      status: 'expressed',
      elements: ['matter'],
      explanation: '事项对象有独立身份。',
      gap: '',
      suggestion: '',
    },
  ],
  clarifications: [],
  warnings: [],
}
const compiled = (): Omit<ModelingResult, 'expressionReview'> => ({
  semanticPlan: 'AUTHOR_PLAN_CANARY',
  model: structuredClone(model),
  clarifications: [],
  provenance: { basis: 'business-understanding', evidence: 'unlinked' },
  validation: { elements: 2, warnings: [] },
})
const rawCheck = (check: ExpressionCheck) =>
  JSON.stringify({
    summary: check.summary,
    clarifications: check.clarifications.map(({ basis: _basis, ...item }) => ({
      ...item,
      basisIds: ['U1'],
    })),
    cases: check.cases.map(({ basis: _basis, ...item }) => item),
  })
const rawRecheck = (check: ExpressionCheck) =>
  JSON.stringify({
    summary: check.summary,
    judgments: check.cases.map(
      ({ id, status, elements, explanation, gap, suggestion }) => ({
        id,
        status,
        elements,
        explanation,
        gap,
        suggestion,
      }),
    ),
    additionalCases: [],
    clarifications: [],
  })
const repair = {
  changes: [
    {
      collection: 'relations',
      id: 'belongs',
      value: relation,
      caseIds: ['ownership'],
      reason: '使成果能够确定其所属事项。',
    },
  ],
}
const resolved = (): ExpressionCheck => ({
  ...check,
  summary: '可表达实际归属。',
  cases: check.cases.map((item) => ({
    ...item,
    status: 'expressed',
    elements: item.id === 'ownership' ? ['belongs'] : item.elements,
    explanation: '模型已明确。',
    gap: '',
    suggestion: '',
  })),
})

test('fact defect gets one atomic repair, frozen cases are rechecked, and checkpoints preserve both candidates', async () => {
  const events: StageEvent[] = []
  let calls = 0
  const result = await checkAndRepair(
    compiled(),
    narrative,
    async (prompt) => {
      calls++
      assert.doesNotMatch(prompt, /AUTHOR_PLAN_CANARY/)
      assert.match(prompt, /一份成果只属于一个事项/)
      if (calls === 1) return rawCheck(check)
      if (calls === 2) return JSON.stringify(repair)
      assert.match(prompt, /事项 A 与事项 B 有独立身份/)
      assert.doesNotMatch(prompt, /缺少实际归属关系/)
      return rawRecheck(resolved())
    },
    { onEvent: (event) => events.push(event) },
  )
  assert.equal(calls, 3)
  assert.equal(result.expressionReview.status, 'passed')
  assert.deepEqual(result.model.relations, [relation])
  assert.equal(result.expressionReview.snapshots[0].model.relations.length, 0)
  assert.equal(
    result.expressionReview.snapshots[0].check?.cases[0].status,
    'defect',
  )
  assert.equal(
    result.expressionReview.snapshots[1].check?.cases[0].status,
    'expressed',
  )
  const checkpoints = events.filter(
    (event) => event.type === 'model-checkpoint',
  )
  assert.equal(checkpoints[0].expressionReview.snapshots[0].check, undefined)
  assert.equal(checkpoints[0].model.relations.length, 0)
})

test('unresolved business facts are retained without selecting an answer or entering the repair loop', async () => {
  let calls = 0
  const clarification = {
    text: '记录是否公开？',
    basis: '记录是否公开尚未确定。',
    ambiguity: '公开或不公开。',
    impact: '改变记录访问含义。',
    options: ['公开', '不公开'],
    multiple: false,
  }
  const result = await checkAndRepair(
    compiled(),
    narrative,
    async () => {
      calls++
      return rawCheck({
        ...check,
        cases: [
          {
            ...check.cases[0],
            basis: clarification.basis,
            status: 'uncertain',
          },
        ],
        clarifications: [clarification],
      })
    },
    {},
  )
  assert.equal(calls, 1)
  assert.equal(result.expressionReview.status, 'issues')
  assert.deepEqual(result.model, model)
  assert.deepEqual(result.clarifications, [
    { ...clarification, basis: narrative },
  ])
})

test('one repair is the budget even when defects remain or a previously expressed fact regresses', async () => {
  let calls = 0
  const result = await checkAndRepair(
    compiled(),
    narrative,
    async () => {
      if (++calls === 1) return rawCheck(check)
      if (calls === 2) return JSON.stringify(repair)
      return rawRecheck({
        ...check,
        cases: check.cases.map((item) => ({
          ...item,
          status: 'defect',
          gap: '仍然不能区分。',
          suggestion: '需继续审阅。',
        })),
      })
    },
    {},
  )
  assert.equal(calls, 3)
  assert.equal(result.expressionReview.status, 'issues')
  assert.match(result.expressionReview.warnings.join(''), /不继续自动循环/)
  assert.equal(result.expressionReview.selectedSnapshot, 0)
  assert.equal(result.model.relations.length, 0)
  assert.equal(result.expressionReview.snapshots[1].model.relations.length, 1)
})

test('invalid patches, timeout and cancelled calls preserve the last valid candidate without reporting pass', async () => {
  for (const failure of [
    'invalid-repair',
    'check-timeout',
    'recheck-timeout',
    'cancel',
  ] as const) {
    let calls = 0
    const events: StageEvent[] = []
    const controller = new AbortController()
    const task = checkAndRepair(
      compiled(),
      narrative,
      async () => {
        calls++
        if (failure === 'check-timeout') throw new Error('模拟超时')
        if (calls === 1) return rawCheck(check)
        if (failure === 'cancel') {
          controller.abort()
          controller.signal.throwIfAborted()
        }
        if (failure === 'invalid-repair')
          return JSON.stringify({
            changes: [
              { ...repair.changes[0], value: { ...relation, to: 'missing' } },
            ],
          })
        if (calls === 2) return JSON.stringify(repair)
        throw new Error('复查超时')
      },
      { signal: controller.signal, onEvent: (event) => events.push(event) },
    )
    if (failure === 'cancel') await assert.rejects(task, { name: 'AbortError' })
    else {
      const result = await task
      assert.equal(result.expressionReview.status, 'incomplete')
      assert.equal(
        result.model.relations.length,
        failure === 'recheck-timeout' ? 1 : 0,
      )
    }
    const last = events
      .filter((event) => event.type === 'model-checkpoint')
      .at(-1)!
    assert.equal(last.expressionReview.status, 'incomplete')
    assert.equal(last.expressionReview.snapshots[0].model.relations.length, 0)
  }
})

test('checks cannot fabricate evidence or IDs, drop passed cases or weaken frozen scenarios', () => {
  assert.throws(
    () =>
      parseExpressionCheck(
        rawCheck({
          ...check,
          cases: [{ ...check.cases[0], basisIds: ['U999'] }],
        }),
        narrative,
        model,
      ),
    /依据段落不在/,
  )
  assert.throws(
    () =>
      parseExpressionCheck(
        rawCheck({
          ...check,
          cases: [{ ...check.cases[0], elements: ['invented'] }],
        }),
        narrative,
        model,
      ),
    /不存在的/,
  )
  assert.throws(
    () =>
      parseExpressionCheck(
        rawRecheck({ ...check, cases: [check.cases[0]] }),
        narrative,
        model,
        check,
      ),
    /遗漏/,
  )
  assert.throws(
    () =>
      parseExpressionCheck(
        rawCheck({
          ...check,
          cases: check.cases.map((item) => ({
            ...item,
            scenario: '弱化了业务区分',
          })),
        }),
        narrative,
        model,
        check,
      ),
    /改变/,
  )
  assert.throws(
    () =>
      applyModelRepair(
        JSON.stringify({
          changes: [{ ...repair.changes[0], caseIds: ['identity'] }],
        }),
        model,
        check,
      ),
    /真实模型缺陷/,
  )
  assert.equal(model.relations.length, 0)
})

test('retry request requires current understanding; original document and answers never enter the request', () => {
  assert.throws(
    () =>
      parseAnalysisRequest(
        { stage: 'compile', semanticPlan: 'PLAN' },
        'deepseek',
      ),
    /业务说明/,
  )
  const parsed = parseAnalysisRequest(
    {
      stage: 'compile',
      semanticPlan: 'PLAN',
      narrative,
      document: 'DOC_CANARY',
      answers: 'ANSWER_CANARY',
    },
    'deepseek',
  )
  assert.deepEqual(Object.keys(parsed).sort(), [
    'narrative',
    'provider',
    'semanticPlan',
    'stage',
  ])
})

test('formatting normalization preserves meaning, while unknown names and unsupported question metadata remain visible', () => {
  const raw = JSON.parse(rawCheck(check))
  delete raw.clarifications
  raw.cases[0].elements = ['matter', 'matter', 'result']
  raw.cases[0].basisIds = ['U1', 'U1']
  const result = parseExpressionCheck(JSON.stringify(raw), narrative, model)
  assert.deepEqual(result.cases[0].elements, ['matter', 'result'])
  assert.equal(result.cases[0].basis, narrative)
  const named = {
    ...model,
    objects: model.objects.map((item) => ({
      ...item,
      name: item.id === 'matter' ? '事项' : '成果',
    })),
  }
  raw.cases[0].elements = ['事项', '成果']
  assert.deepEqual(
    parseExpressionCheck(JSON.stringify(raw), narrative, named).cases[0]
      .elements,
    ['matter', 'result'],
  )
  raw.clarifications = [{ text: '无依据问题', basisIds: ['U999'] }]
  const isolated = parseExpressionCheck(JSON.stringify(raw), narrative, named)
  assert.equal(isolated.cases.length, 2)
  assert.equal(isolated.warnings.length, 1)
  assert.equal(isolated.clarifications.length, 0)
  raw.cases[0].elements = ['unknown']
  assert.throws(
    () => parseExpressionCheck(JSON.stringify(raw), narrative, named),
    /不存在/,
  )
})

test('repair can omit fixed empty metadata but cannot omit semantic fields or invent source evidence', () => {
  const { evidence: _evidence, properties: _properties, ...semantic } = relation
  const raw = { changes: [{ ...repair.changes[0], value: semantic }] }
  assert.deepEqual(
    applyModelRepair(JSON.stringify(raw), model, check).model.relations,
    [relation],
  )
  const { to: _to, ...incomplete } = semantic
  assert.throws(
    () =>
      applyModelRepair(
        JSON.stringify({
          changes: [{ ...repair.changes[0], value: incomplete }],
        }),
        model,
        check,
      ),
    /结构不完整/,
  )
  assert.throws(() =>
    applyModelRepair(
      JSON.stringify({
        changes: [
          {
            ...repair.changes[0],
            value: {
              ...semantic,
              evidence: [{ blockId: 'fake', quote: 'fake' }],
            },
          },
        ],
      }),
      model,
      check,
    ),
  )
})

test('recheck cannot resolve a business ambiguity without new business input', () => {
  const first = structuredClone(check)
  first.cases[0].status = 'uncertain'
  const repaired = { ...model, relations: [relation] }
  const second = parseExpressionCheck(
    rawRecheck(resolved()),
    narrative,
    repaired,
    first,
  )
  assert.equal(second.cases[0].status, 'uncertain')
  assert.equal(second.cases[0].gap, first.cases[0].gap)
  assert.match(second.cases[0].explanation, /业务歧义仍需确认/)
  assert.equal(second.cases[1].status, 'expressed')
})
