import test from 'node:test'
import assert from 'node:assert/strict'
import type { DesignAcceptance, DesignCheckReport } from '../../shared/design-acceptance.ts'
import { parseDesignAcceptance, parseDesignCheckReport, checkedDesignVerdict, designCheckMarkdown } from './design-acceptance.ts'
import { prepareDesignAcceptance } from '../stages/design-acceptance.ts'

const context = { narrative: '事项形成成果，成果记录测量值和测量期间。' }
const basis = context.narrative
const design = '成果记录测量值和测量期间；形成操作将本次输入关联到该成果。未说明的舍入方式保留未决。'
const acceptance: DesignAcceptance = { scope: '成果的信息承接', scenario: '假设两次事项的测量值与期间不同。', outcome: '各成果表达各自的测量值与期间，并能区分归属。', questions: [
  { id: 'value', question: '成果能否表达测量值？', kind: 'result', grounding: 'explicit', sourceQuote: basis, reason: '来源要求记录。', expected: '能区分不同测量值的成果。' },
  { id: 'period', question: '成果能否表达测量期间？', kind: 'result', grounding: 'explicit', sourceQuote: basis, reason: '来源要求记录。', expected: '能区分不同期间的成果。' },
] }
const report = (): DesignCheckReport => ({ summary: '已核对来源及两项必要信息。',
  answers: acceptance.questions.map(q => ({ questionId: q.id, status: 'supported', sourceQuote: basis,
    evidence: [{ quote: '成果记录测量值和测量期间', reason: '结果定义承载该信息。' }, { quote: '形成操作将本次输入关联到该成果', reason: '定义输入到结果的承接。' }],
    scenario: '假设两次输入只在本项取值上不同。', result: '两份成果可以表达该区别。', gap: '' })), issues: [],
})
const parse = (value: DesignCheckReport, previous: DesignCheckReport[] = [], model = design) =>
  parseDesignCheckReport(JSON.stringify(value), acceptance, model, basis, context, previous)

test('acceptance questions are source-grounded and IDs are unique, without domain-specific requirements', () => {
  assert.deepEqual(parseDesignAcceptance(JSON.stringify(acceptance), context), acceptance)
  const unrelated = structuredClone(acceptance)
  unrelated.questions[0].sourceQuote = '不存在的原句'
  assert.throws(() => parseDesignAcceptance(JSON.stringify(unrelated), context), /引文/)
  assert.throws(() => parseDesignAcceptance(JSON.stringify({ ...acceptance, questions: [] }), context), /结构/)
  assert.throws(() => parseDesignAcceptance(JSON.stringify({ ...acceptance, questions: [acceptance.questions[0], acceptance.questions[0]] }), context), /重复/)
})

test('quote correction repairs only unmatched quotations and preserves every acceptance field', async () => {
  const draft = structuredClone(acceptance)
  draft.questions[0].sourceQuote = '事项形成成果，成果记录测量值。'
  let calls = 0
  const fixed = await prepareDesignAcceptance(context, async prompt => {
    calls++
    if (calls === 1) return JSON.stringify(draft)
    assert.ok(prompt.includes(draft.questions[0].question))
    assert.ok(!prompt.includes(draft.questions[1].question), 'only unmatched quotes are repaired')
    return JSON.stringify({ quotes: [{ id: 'value', sourceQuote: basis }] })
  }, {})
  assert.equal(calls, 2)
  assert.deepEqual(fixed, acceptance)
})

test('quote repair cannot change questions, drop IDs, invent citations or repeatedly retry', async () => {
  const draft = structuredClone(acceptance)
  draft.questions[0].sourceQuote = '不在来源中的句子。'
  for (const patch of [
    { quotes: [] }, { quotes: [{ id: 'unknown', sourceQuote: basis }] },
    { quotes: [{ id: 'value', sourceQuote: '仍不存在的原句' }] },
    { quotes: [{ id: 'value', sourceQuote: basis, expected: '改弱后的预期' }] },
    { quotes: [{ id: 'value', sourceQuote: basis }], questions: [] },
  ]) {
    let calls = 0
    await assert.rejects(prepareDesignAcceptance(context, async () => { calls++; return JSON.stringify(patch) }, {}, JSON.stringify(draft)), /校正/)
    assert.equal(calls, 1)
  }
  let calls = 0
  await assert.rejects(prepareDesignAcceptance(context, async () => { calls++; return '{}' }, {}, '{"questions":[]}'), /结构/)
  assert.equal(calls, 0, 'shape errors do not become a semantic regeneration')
})

test('a complete report with actual definition evidence can pass and render all acceptance conditions', () => {
  const verified = parse(report())
  assert.equal(checkedDesignVerdict(verified), 'sufficient')
  const text = designCheckMarkdown(verified, acceptance)
  for (const q of acceptance.questions) assert.ok(text.includes(q.expected))
})

test('definition citations accept rendered emphasis, code and quotation styles without changing source matching', () => {
  const value = report()
  value.answers.forEach(a => { a.evidence = [{ quote: '成果：记录"测量值"与测量期间。', reason: '当前定义的可见文字。' }] })
  const model = '- **成果**：记录“测量值”与`测量期间`。'
  assert.equal(checkedDesignVerdict(parse(value, [], model)), 'sufficient')
  value.answers[0].sourceQuote = '事项形成成果，成果记录“测量值”和测量期间。'
  assert.throws(() => parse(value, [], model), /业务引文不存在/)
})

test('format compatibility cannot remove negation, numbers, literal operators or missing words', () => {
  const model = '**成果**：数值**不得**低于 10；表达式为`a*b*c`；必须同时记录测量值和测量期间。'
  for (const quote of [
    '成果：数值得低于 10', '成果：数值不得低于 1；',
    '表达式为abc', '必须记录测量值和测量期间', '必须同时记录测量值和期间',
  ]) {
    const value = report()
    value.answers.forEach(a => { a.evidence = [{ quote, reason: '被改变的文字。' }] })
    assert.throws(() => parse(value, [], model), /不存在的定义/)
  }
  const valid = report()
  valid.answers.forEach(a => { a.evidence = [{ quote: '成果：数值不得低于 10；表达式为`a*b*c`', reason: '数值、否定及运算符仍保留。' }] })
  assert.equal(checkedDesignVerdict(parse(valid, [], model)), 'sufficient')
})

test('missing, duplicated and unknown answers cannot pass even when the summary claims success', () => {
  for (const answers of [[], [report().answers[0]], [report().answers[0], report().answers[0]],
    [report().answers[0], { ...report().answers[1], questionId: 'invented' }]]) {
    assert.throws(() => parse({ ...report(), summary: '全部通过', answers }), /覆盖|重复/)
  }
})

test('a relation name or an old definition cannot stand in for a current definition quote', () => {
  const missing = report()
  missing.answers[0].evidence = []
  assert.throws(() => parse(missing), /缺少.*证据/)
  const forged = report()
  forged.answers[0].evidence[0].quote = '旧设计中才有的定义'
  assert.throws(() => parse(forged), /不存在的定义/)
  assert.throws(() => parse(report(), [], '成果关联事项。'), /不存在的定义/)
})

test('model gaps override an optimistic summary, while bounded unknowns do not block supported requirements', () => {
  const gap = report()
  gap.summary = '全部通过'
  gap.answers[1] = { ...gap.answers[1], status: 'gap', evidence: [], gap: '期间只在输入中出现，结果缺少承接。' }
  assert.equal(checkedDesignVerdict(parse(gap)), 'revise')
  const bounded = report()
  bounded.answers[1] = { ...bounded.answers[1], status: 'bounded', gap: '舍入方式未决，不影响已确定部分。', evidence: [{ quote: '未说明的舍入方式保留未决', reason: '未将未知写成默认规则。' }] }
  assert.equal(checkedDesignVerdict(parse(bounded)), 'sufficient')
  const clarify = report()
  clarify.answers[1] = { ...clarify.answers[1], status: 'clarify', gap: '未决阻碍该项必要判断。' }
  assert.equal(checkedDesignVerdict(parse(clarify)), 'clarify')
})

test('supported with a gap and bounded without evidence are invalid reports', () => {
  const contradiction = report()
  contradiction.answers[0].gap = '仍有缺口'
  assert.throws(() => parse(contradiction), /状态.*不一致/)
  contradiction.answers[0] = { ...contradiction.answers[0], status: 'bounded', evidence: [] }
  assert.throws(() => parse(contradiction), /缺少.*证据/)
})

const issue: DesignCheckReport['issues'][number] = { id: 'G1', type: 'model', status: 'open', sourceQuote: basis,
  problem: '成果与输入无承接，影响信息归属。', acceptance: '明确本次输入如何归属本次成果。', resolution: '仍缺少承接。', evidence: [] }

test('old issues cannot disappear, change identity, weaken acceptance or resolve without current evidence', () => {
  const previous = { ...report(), issues: [issue] }
  assert.throws(() => parse(report(), [previous]), /未复查/)
  for (const change of [{ id: 'G2' }, { acceptance: '存在成果名称即可。' }, { type: 'business' as const }, { problem: '另一个问题。' }]) {
    assert.throws(() => parse({ ...report(), issues: [{ ...issue, ...change }] }, [previous]), /未复查|被改变/)
  }
  assert.throws(() => parse({ ...report(), issues: [{ ...issue, status: 'resolved' }] }, [previous]), /没有修复证据/)
  const fixed = { ...report(), issues: [{ ...issue, status: 'resolved' as const, resolution: '操作已表达承接。',
    evidence: [{ artifact: 'design' as const, quote: '形成操作将本次输入关联到该成果', reason: '明确输入归属。' }] }] }
  assert.equal(checkedDesignVerdict(parse(fixed, [previous])), 'sufficient')
  assert.throws(() => parse(report(), [previous, fixed]), /未复查/, 'resolved issues must also be replayed')
  assert.equal(checkedDesignVerdict(parse({ ...report(), issues: [issue] }, [previous, fixed])), 'revise', 'regressions reopen issues')
})

test('basis errors take priority, model gaps precede business unknowns, and inapplicable-only reports do not pass', () => {
  const value = report()
  value.answers[0] = { ...value.answers[0], status: 'gap', gap: '缺少定义。' }
  value.issues = [{ ...issue, type: 'basis' }]
  assert.equal(checkedDesignVerdict(parse(value)), 'basis-revise')
  value.issues = [{ ...issue, type: 'business' }]
  assert.equal(checkedDesignVerdict(parse(value)), 'revise')
  const rejected = report()
  rejected.answers = rejected.answers.map(a => ({ ...a, status: 'not-applicable', evidence: [], gap: '问题的预期没有来源支持。' }))
  assert.equal(checkedDesignVerdict(parse(rejected)), 'unknown')
})
