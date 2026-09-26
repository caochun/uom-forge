import test from 'node:test'
import assert from 'node:assert/strict'
import { buildModel, compileModel } from './modeling.ts'
import { validateCompiledModel } from '../validation/compiled-model.ts'
import { extractQuestions } from '../../shared/questions.ts'
import { businessBasisPrompt, compileModelPrompt, modelDesignPrompt, understandingPrompt } from './prompts.ts'
import type { CandidateModel } from '../../shared/model.ts'
import type { StageEvent } from '../../shared/analysis.ts'
import { testAgents } from '../testing/agents.ts'

const plan = '## 模型概述\n跟踪事项与成果。\n## 对象及边界\n事项 req；成果 result。\n## 关系\n事项通过产出关系 produces 指向成果。'
const candidate = (): CandidateModel => ({
  schemaVersion: '1', name: '通用业务', summary: '事项形成成果。',
  objects: [
    { id: 'req', name: '事项', description: '一次独立事项。', properties: [], evidence: [] },
    { id: 'result', name: '成果', description: '可追溯产出。', properties: [], evidence: [] },
  ],
  relations: [{ id: 'produces', name: '形成', description: '事项形成成果。', from: 'req', to: 'result', properties: [], evidence: [] }],
  actions: [{ id: 'record-result', name: '登记成果', description: '登记形成的成果。', targets: ['result'], inputs: [], preconditions: [], effects: ['创建成果'], evidence: [] }],
  functions: [], rules: [{ id: 'trace', name: '可追溯', description: '成果需追溯事项。', elements: ['req', 'result', 'produces'], evidence: [] }],
  boundaries: [],
})

test('the four-stage pipeline passes text artifacts forward and validates only final JSON', async () => {
  const events: StageEvent[] = []
  const basis = '业务依据：事项形成成果，成果属于该事项。'
  const runTurn = async (prompt: string, options: Parameters<import('../providers/types.ts').RunTurn>[1]) => {
    if (prompt.includes('形成用于建模的业务依据')) {
      options.onEvent?.({ type: 'delta', text: basis })
      return basis
    }
    if (prompt.includes('候选领域模型设计')) {
      options.onEvent?.({ type: 'delta', text: plan })
      return plan
    }
    assert.match(prompt, /完整 JSON 对象/)
    assert.match(prompt, /事项 req/)
    options.onEvent?.({ type: 'delta', text: JSON.stringify(candidate()) })
    return JSON.stringify(candidate())
  }
  const result = await buildModel({ narrative: '事项形成成果。' }, runTurn, {
    provider: 'gpt', agents: testAgents(runTurn), onEvent: event => events.push(event),
  })
  assert.equal(result.businessBasis, basis)
  assert.equal(result.modelDesign, plan)
  assert.deepEqual(result.model, candidate())
  assert.ok(events.some(event => event.type === 'business-basis' && event.text === basis))
  assert.ok(events.some(event => event.type === 'model-design' && event.modelDesign === plan))
  assert.deepEqual(events.filter(event => event.type === 'delta').map(event => event.part), ['basis', 'design', 'compile'])
})

test('compiler retries only invalid JSON and preserves the saved design', async () => {
  let calls = 0
  const result = await compileModel(plan, '事项形成成果。', async prompt => {
    calls++
    if (calls === 1) assert.equal(prompt, compileModelPrompt(plan))
    return calls === 1 ? 'not json' : JSON.stringify(candidate())
  })
  assert.equal(calls, 2)
  assert.equal(result.modelDesign, plan)
  assert.deepEqual(result.model, candidate())
})

test('missing business input stops before any provider call', async () => {
  let calls = 0
  await assert.rejects(buildModel({ narrative: '' }, async () => { calls++; return '' }), /业务说明/)
  await assert.rejects(compileModel('', '业务说明', async () => { calls++; return '' }), /建模说明/)
  assert.equal(calls, 0)
})

test('compiled output rejects dangling references and invented evidence', () => {
  const invalid = candidate()
  invalid.relations[0].to = 'missing'
  assert.throws(() => validateCompiledModel(JSON.stringify(invalid)))
  const evidence = candidate()
  evidence.objects[0].evidence = [{ quote: 'invented' }]
  assert.throws(() => validateCompiledModel(JSON.stringify(evidence)))
  const legacy = { ...candidate(), activities: [] }
  assert.throws(() => validateCompiledModel(JSON.stringify(legacy)), /模型结构不完整/)
  assert.throws(() => validateCompiledModel('{}'))
})

test('text stages retain their distinct responsibilities', () => {
  const understanding = understandingPrompt({ name: 'test', blocks: [{ id: '1', text: '业务说明' }] })
  assert.match(understanding, /文档阅读工作/)
  assert.match(understanding, /业务事实、已知业务计划和检验情形由下一阶段/)
  const basis = businessBasisPrompt('整理稿')
  assert.match(basis, /领域模型必须表达哪些事实、规则和已知业务情形/)
  assert.match(basis, /每项事实表示一条模型必须保留的业务判断/)
  assert.match(basis, /已知业务计划或流程是建模时的检验目标/)
  assert.match(basis, /检验情形是用于判断领域模型能否表达或推理出业务含义的具体案例/)
  assert.match(basis, /业务文档整理稿/)
  const design = modelDesignPrompt({ feedback: '' }, basis)
  assert.match(design, /模型设计阶段/)
  assert.doesNotMatch(design, /第二阶段 A/)
  assert.match(compileModelPrompt('PLAN'), /只返回一个完整 JSON 对象/)
  assert.match(compileModelPrompt('PLAN'), /不重新提炼事实、组织计划/)
})

test('confirmation choices preserve punctuation and multiple selection', () => {
  assert.deepEqual(extractQuestions('## 待确认问题\n1. 如何处理？\n  选项：满足条件，继续办理；退回\n2. 需要哪些信息？\n  多选：编号；地址'), [
    { text: '如何处理？', options: ['满足条件，继续办理', '退回'] },
    { text: '需要哪些信息？', options: ['编号', '地址'], multiple: true },
  ])
})
