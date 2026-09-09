import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import {
  Activity,
  ArrowRight,
  BadgeCheck,
  Bot,
  Box,
  Check,
  ChevronDown,
  CircleAlert,
  ClipboardCheck,
  CloudUpload,
  FileText,
  GitBranch,
  Link2,
  LoaderCircle,
  MessageCircle,
  MoreHorizontal,
  Network,
  Plus,
  RefreshCw,
  Save,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Table2,
  Target,
  Upload,
  X,
  Zap,
} from 'lucide-react'
import QQDocEditor from 'qq-doc-clone'
import { activityCoverage } from '../shared/model-contract.js'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import DOMPurify from 'dompurify'
import './styles.css'

const DEFAULT_DOCUMENT = {
  name: '尚未上传业务文档',
  size: '—',
  updated: '等待导入',
  content: '',
  blocks: [],
}

const INITIAL_OBJECTS = []
/* Demo candidates are intentionally not loaded. Analysis must come from the
   current evidence document through the ACP provider. */
const INITIAL_RELATIONS = []
const INITIAL_ACTIVITIES = []

const NAV_ITEMS = [
  { id: 'document', label: '业务文档', icon: FileText, step: '01' },
  { id: 'understanding', label: '业务理解', icon: Activity, step: '02' },
  { id: 'model', label: '候选模型', icon: Network, step: '03' },
  { id: 'narrative', label: '模型自述', icon: MessageCircle, step: '04' },
  { id: 'assessment', label: '支撑评估', icon: ClipboardCheck, step: '05' },
]

const STATUS_LABELS = {
  confirmed: '已确认',
  review: '待确认',
  supported: '可支撑',
  partial: '部分支撑',
  gap: '存在缺口',
}

function App() {
  const [activeView, setActiveView] = useState('model')
  const [document, setDocument] = useState(DEFAULT_DOCUMENT)
  const [objects, setObjects] = useState(INITIAL_OBJECTS)
  const [relations, setRelations] = useState(INITIAL_RELATIONS)
  const [capabilityCount, setCapabilityCount] = useState(0)
  const [ruleCount, setRuleCount] = useState(0)
  const [capabilities, setCapabilities] = useState([])
  const [rules, setRules] = useState([])
  const [selectedObjectId, setSelectedObjectId] = useState(null)
  const [selectedRelationId, setSelectedRelationId] = useState(null)
  const [activities, setActivities] = useState(INITIAL_ACTIVITIES)
  const [understanding, setUnderstanding] = useState(null)
  const [questionAnswers, setQuestionAnswers] = useState({})
  const [questionsSubmitted, setQuestionsSubmitted] = useState(false)
  const [assessment, setAssessment] = useState(null)
  const [modelNarrative, setModelNarrative] = useState('')
  const [stageOutput, setStageOutput] = useState({ understand: '', model: '', narrate: '', assess: '' })
  const [runningStage, setRunningStage] = useState(null)
  const [selectedActivityId, setSelectedActivityId] = useState(null)
  const [isAddingObject, setIsAddingObject] = useState(false)
  const [newObjectName, setNewObjectName] = useState('')
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      content: '上传业务文档后，我会先理解业务，再生成候选模型，并让模型用自己的对象和关系复述业务，最后评估模型对业务过程的支撑情况。每一轮结果都会等待你的反馈。',
    },
  ])
  const [draftMessage, setDraftMessage] = useState('')
  const [isDiscussing, setIsDiscussing] = useState(false)
  const [provider, setProvider] = useState(() => window.localStorage.getItem('uom-forge-provider') || 'deepseek')
  const [toast, setToast] = useState('')
  const fileInputRef = useRef(null)

  const selectedObject = objects.find((object) => object.id === selectedObjectId) || objects[0]
  const selectedActivity = activities.find((activity) => activity.id === selectedActivityId) || activities[0]
  const confirmedCount = objects.filter((object) => object.status === 'confirmed').length
  const avgCoverage = activities.length ? Math.round(activities.reduce((sum, activity) => sum + activity.coverage, 0) / activities.length) : 0
  const llmConfigured = true

  useEffect(() => {
    const stored = window.localStorage.getItem('uom-forge-project-v3')
    if (!stored) return
    try {
      const project = JSON.parse(stored)
      if (!project.version || project.version < 2) return
      if (project.document) setDocument(project.document)
      if (project.objects?.length) setObjects(project.objects)
      if (project.relations?.length) setRelations(project.relations)
      if (project.capabilityCount) setCapabilityCount(project.capabilityCount)
      if (project.ruleCount) setRuleCount(project.ruleCount)
      if (project.capabilities) setCapabilities(project.capabilities)
      if (project.rules) setRules(project.rules)
      if (project.activities?.length) setActivities(project.activities)
      if (project.understanding) setUnderstanding(project.understanding)
      if (project.assessment) setAssessment(project.assessment)
      if (project.modelNarrative) setModelNarrative(project.modelNarrative)
      if (project.questionAnswers) setQuestionAnswers(project.questionAnswers)
      if (project.questionsSubmitted) setQuestionsSubmitted(project.questionsSubmitted)
    } catch {
      // Ignore stale local drafts and keep the built-in prototype state.
    }
  }, [])

  useEffect(() => {
    if (!document.blocks?.length) setDocument((current) => ({ ...current, blocks: documentToBlocks(current.content) }))
  }, [document.blocks?.length])

  useEffect(() => {
    if (!toast) return undefined
    const timer = window.setTimeout(() => setToast(''), 2400)
    return () => window.clearTimeout(timer)
  }, [toast])

  const persistProject = () => {
    window.localStorage.setItem('uom-forge-project-v3', JSON.stringify({ version: 3, document, objects, relations, activities, understanding, assessment, modelNarrative, questionAnswers, questionsSubmitted, capabilityCount, ruleCount, capabilities, rules }))
    setToast('项目草稿已保存')
  }

  const loadDocumentFile = async (file) => {
    if (!file) return
    const isDocx = /\.docx$/i.test(file.name)
    const supported = /\.(md|markdown|txt|html?)$/i.test(file.name) || isDocx
    if (!supported) {
      setToast('目前支持 DOCX、Markdown、TXT 和 HTML 文档')
      return
    }
    try {
      const content = isDocx
        ? (await (await import('mammoth')).default.convertToHtml({ arrayBuffer: await file.arrayBuffer() })).value
        : await file.text()
      setDocument({
        name: file.name,
        size: `${(file.size / 1024).toFixed(1)} KB`,
        updated: '刚刚导入',
        content,
        blocks: documentToBlocks(content),
      })
      setActiveView('document')
      setMessages((current) => [...current, { role: 'assistant', content: `已载入「${file.name}」，可以开始提取领域模型。` }])
      setToast('文档已载入')
    } catch (error) {
      console.error('Failed to read business document', error)
      setToast('DOCX 文档解析失败，请检查文件是否完整')
    }
  }

  const handleFile = async (event) => {
    const file = event.target.files?.[0]
    await loadDocumentFile(file)
    event.target.value = ''
  }

  const runStage = async (stage, body, messageId, label, view) => {
    setRunningStage(stage)
    setStageOutput((current) => ({ ...current, [stage]: '' }))
    setActiveView(view)
    const requestBody = { ...body, stage, provider }
    if (stage !== 'narrate') requestBody.document = document
    const response = await fetch('/api/analyze/stream', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(requestBody) })
    if (!response.ok) throw new Error(`分析服务调用失败（HTTP ${response.status}）`)
    let payload
    let streamedOutput = ''
    const providerName = provider === 'deepseek' ? 'DeepSeek API' : 'Codex ACP'
    await readSse(response, (event) => {
      if (event.type === 'phase') setMessages((current) => current.map((message) => message.id === messageId ? { ...message, progress: true, content: `${label}\n\n${event.text}` } : message))
      if (event.type === 'delta') {
        streamedOutput += event.text || ''
        setStageOutput((current) => ({ ...current, [stage]: streamedOutput.slice(-6000) }))
        setMessages((current) => current.map((message) => message.id === messageId ? { ...message, progress: true, content: `${label}\n\n${providerName} 正在输出` } : message))
      }
      if (event.type === 'result') payload = event.result
      if (event.type === 'error') throw new Error(event.error || '分析服务调用失败')
    })
    if (!payload) throw new Error(`${label}未返回结果`)
    setMessages((current) => current.map((message) => message.id === messageId ? { ...message, progress: false } : message))
    setRunningStage(null)
    return payload
  }

  const runAnalysis = async ({ fromFeedback = false, feedbackOverride = '' } = {}) => {
    if (isAnalyzing) return
    setIsAnalyzing(true)
    const addStageMessage = (content) => { const id = `analysis-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`; setMessages((current) => [...current, { id, role: 'assistant', content, progress: true }]); return id }
    try {
      const understood = fromFeedback && understanding ? understanding : (await runStage('understand', {}, addStageMessage('第一阶段：理解业务文档'), '第一阶段：理解业务文档', 'understanding')).understanding
      setUnderstanding(understood)
      if (!fromFeedback) {
        setQuestionAnswers({})
        setQuestionsSubmitted(false)
      }
      const feedback = feedbackOverride || messages.filter((message) => message.role === 'user').slice(-3).map((message) => message.content).join('\n')
      const currentModel = { objects, relations, actions: capabilities.filter((item) => item.kind === '操作'), functions: capabilities.filter((item) => item.kind === '只读能力'), rules, activities }
      const modelMessageId = addStageMessage('第二阶段：建立候选模型')
      const modelResult = await runStage('model', { understanding: understood, model: currentModel, instruction: fromFeedback ? `用户上一轮反馈：\n${feedback}` : '' }, modelMessageId, '第二阶段：建立候选模型', 'model')
      const result = modelResult?.model
      if (!result || !Array.isArray(result.objects) || !Array.isArray(result.relations) || !Array.isArray(result.activities)) throw new Error('分析结果结构不完整')
      const objectNames = new Map(result.objects.map((item) => [item.id, item.name]))
      const palette = ['blue', 'teal', 'orange', 'violet', 'rose', 'slate']
      const viewObjects = result.objects.map((item, index) => ({ ...item, type: '候选对象', source: item.evidence?.[0]?.quote || '材料语义', status: 'review', fields: (item.properties || []).map((property) => `${property.name}（${property.type}）`), tint: item.tint || palette[index % palette.length] }))
      const viewRelations = result.relations.map((item, index) => ({ ...item, id: item.id || `relation-${index + 1}`, fromId: item.from, toId: item.to, from: objectNames.get(item.from) || item.from, to: objectNames.get(item.to) || item.to }))
      // Publish the candidate graph as soon as stage 2 finishes. The longer
      // support assessment can continue without blocking the graph view.
      setObjects(viewObjects)
      setRelations(viewRelations)
      setCapabilityCount((result.actions || []).length + (result.functions || []).length)
      setRuleCount((result.rules || []).length)
      setCapabilities([...(result.actions || []).map((item) => ({ ...item, kind: '操作' })), ...(result.functions || []).map((item) => ({ ...item, kind: '只读能力' }))])
      setRules(result.rules || [])
      setSelectedObjectId(viewObjects[0]?.id || null)
      setSelectedRelationId(null)
      setModelNarrative('')
      const narrativeResult = await runStage('narrate', { model: result }, addStageMessage('第三阶段：模型自述'), '第三阶段：模型自述', 'narrative')
      setModelNarrative(narrativeResult?.narrative || '')
      const assessed = await runStage('assess', { understanding: understood, model: result }, addStageMessage('第四阶段：评估业务过程支撑情况'), '第四阶段：评估业务过程支撑情况', 'assessment')
      setAssessment(assessed.assessment)
      const assessedActivities = (assessed.assessment?.processAssessments || []).map((item) => ({ id: item.processId, name: item.processName, goal: understood.processes?.find((process) => process.id === item.processId)?.description || '', evidence: item.evidence || [], requirements: [{ description: item.gaps?.length ? item.gaps.join('；') : '当前候选模型可以表达该业务过程。', elements: item.coveredElements || [], status: item.status === 'missing' ? 'missing' : item.status === 'supported' ? 'covered' : 'partial', reason: item.gaps?.join('；') || '' }] }))
      const viewActivities = (assessedActivities.length ? assessedActivities : result.activities).map((item) => ({ ...item, coverage: activityCoverage(item) ?? 0, status: item.requirements?.every((requirement) => requirement.status === 'covered') ? 'supported' : item.requirements?.some((requirement) => requirement.status === 'covered') ? 'partial' : 'gap', elements: [...new Set(item.requirements?.flatMap((requirement) => requirement.elements || []) || [])].map((id) => objectNames.get(id) || id), gap: item.requirements?.filter((requirement) => requirement.status !== 'covered').map((requirement) => requirement.reason).join('；') || '' }))
      setActivities(viewActivities); setSelectedActivityId(viewActivities[0]?.id || null)
      setIsAnalyzing(false); setActiveView('assessment')
      setQuestionsSubmitted(Boolean(fromFeedback && feedbackOverride))
      setMessages((current) => [...current, { role: 'assistant', content: `${assessed.assessment?.summary || result.summary || '本轮建模完成。'}\n\n已完成业务理解、候选建模、模型自述和业务过程支撑评估。请查看结果并反馈，下一轮将从建模阶段继续。` }])
      setToast('本轮建模与评估完成')
    } catch (error) {
      console.error('Codex ACP modeling failed', error); setIsAnalyzing(false); setRunningStage(null)
      if (feedbackOverride) setQuestionsSubmitted(false)
      setMessages((current) => [...current.map((message) => message.progress ? { ...message, progress: false } : message), { role: 'assistant', content: `建模失败：${error.message}\n\n如果这是 ACP 连接错误，再确认本机已登录 Codex 且开发服务可以启动 codex-acp；如果是模型或证据校验错误，请根据具体信息修正文档或模型。` }]); setToast('建模失败')
    }
  }

  const submitQuestionAnswers = () => {
    if (!understanding?.questions?.length || isAnalyzing) return
    const answers = understanding.questions.map((question, index) => ({ question: String(question), answer: String(questionAnswers[index] || '').trim() })).filter((item) => item.answer)
    if (!answers.length) {
      setToast('请至少填写一个待确认问题的答案')
      return
    }
    const feedback = ['用户对待确认问题的补充：', ...answers.map((item, index) => `${index + 1}. 问题：${item.question}\n   答案：${item.answer}`)].join('\n')
    setQuestionsSubmitted(true)
    setMessages((current) => [...current, { role: 'user', content: feedback }])
    runAnalysis({ fromFeedback: true, feedbackOverride: feedback })
  }

  const addObject = () => {
    const name = newObjectName.trim()
    if (!name) return
    const id = `custom-${Date.now()}`
    const object = {
      id,
      name,
      type: '候选对象',
      source: '用户补充',
      status: 'review',
      description: '由用户在对话中补充的候选业务对象。',
      fields: [],
      tint: 'slate',
    }
    setObjects((current) => [...current, object])
    setSelectedObjectId(id)
    setNewObjectName('')
    setIsAddingObject(false)
    setMessages((current) => [...current, { role: 'assistant', content: `已加入候选对象「${name}」，它还需要来源和属性确认。` }])
  }

  const sendMessage = () => {
    const content = draftMessage.trim()
    if (!content) return
    setDraftMessage('')
    setMessages((current) => [...current, { role: 'user', content }])
    setIsDiscussing(true)
    fetch('/api/discuss', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ document, provider, model: { objects, relations, activities }, messages: [...messages, { role: 'user', content }] }) })
      .then(async (response) => { const payload = await response.json(); if (!response.ok) throw new Error(payload.error || '讨论服务调用失败'); return payload.text })
      .then((response) => setMessages((current) => [...current, { role: 'assistant', content: response }]))
      .catch((error) => setMessages((current) => [...current, { role: 'assistant', content: `讨论失败：${error.message}` }]))
      .finally(() => setIsDiscussing(false))
  }

  const currentTabLabel = NAV_ITEMS.find((item) => item.id === activeView)?.label
  const selectProvider = (value) => { setProvider(value); window.localStorage.setItem('uom-forge-provider', value) }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-mark"><BrandMark /></div>
          <div className="brand-name">领域建模工作台</div>
        </div>
        <div className="project-context">
          <span className="context-label">项目</span>
          <button className="project-picker" type="button" title="切换项目">
          <span>未选择领域</span>
            <ChevronDown size={14} />
          </button>
          <span className="project-state"><span className="state-dot" /> 草稿</span>
        </div>
        <div className="topbar-actions">
          <div className={`llm-indicator ${llmConfigured ? 'online' : ''}`} title="建模与讨论请求使用当前选择的推理提供方">
            <span className="state-dot" />
            <span>{provider === 'codex' ? 'Codex ACP' : 'DeepSeek API'}</span>
          </div>
          <div className="provider-switch" aria-label="选择推理提供方"><button type="button" className={provider === 'codex' ? 'active' : ''} onClick={() => selectProvider('codex')}>Codex</button><button type="button" className={provider === 'deepseek' ? 'active' : ''} onClick={() => selectProvider('deepseek')}>DeepSeek</button></div>
          <button className="icon-button" type="button" title="保存项目" onClick={persistProject}><Save size={17} /></button>
          <button className="icon-button" type="button" title="项目设置"><Settings2 size={17} /></button>
          <div className="avatar">CH</div>
        </div>
      </header>

      <div className="app-body">
        <main className="main-content">
          <div className="workspace-heading">
            <div>
              <div className="eyebrow"><span>业务建模</span><ArrowRight size={13} /><span>{currentTabLabel}</span></div>
              <h1>{activeView === 'document' ? '业务文档' : activeView === 'understanding' ? '业务理解' : activeView === 'narrative' ? '模型自述' : activeView === 'assessment' ? '业务过程支撑评估' : '候选领域模型'}</h1>
              <p className="heading-note">{document.name} · {document.updated}</p>
            </div>
            <div className="heading-actions">
              <button className="secondary-button" type="button" onClick={() => setActiveView('document')}><FileText size={15} />查看文档</button>
              <button className="primary-button" type="button" onClick={runAnalysis} disabled={isAnalyzing}>
                {isAnalyzing ? <LoaderCircle className="spin" size={16} /> : <Sparkles size={16} />}
                {isAnalyzing ? '分析中' : '重新分析'}
              </button>
            </div>
          </div>

          <div className="workspace-nav" role="tablist" aria-label="工作区视图">
            {NAV_ITEMS.map((item) => { const stage = item.id === 'understanding' ? 'understand' : item.id === 'model' ? 'model' : item.id === 'narrative' ? 'narrate' : item.id === 'assessment' ? 'assess' : null; const running = Boolean(stage && runningStage === stage); return <button key={item.id} className={`workspace-nav-item ${activeView === item.id ? 'active' : ''} ${running ? 'running' : ''}`} type="button" onClick={() => setActiveView(item.id)}><item.icon size={14} />{item.label}{running && <span className="stage-spinner" />}{item.id === 'assessment' && activities.some((activity) => activity.status !== 'supported') && !runningStage && <span className="tab-count">!</span>}</button> })}
          </div>

          {activeView === 'document' && (
            <DocumentView document={document} fileInputRef={fileInputRef} onFile={handleFile} onDropFile={loadDocumentFile} onAnalyze={runAnalysis} isAnalyzing={isAnalyzing} />
          )}

          {activeView === 'model' && (
            <ModelView
              objects={objects}
              relations={relations}
              capabilityCount={capabilityCount}
              ruleCount={ruleCount}
              capabilities={capabilities}
              rules={rules}
              selectedObject={selectedObject}
              selectedObjectId={selectedObjectId}
              selectedRelation={relations.find((relation, index) => (relation.id || `relation-${index + 1}`) === selectedRelationId)}
              selectedRelationId={selectedRelationId}
              onSelectObject={(id) => { setSelectedObjectId(id); setSelectedRelationId(null) }}
              onSelectRelation={(id) => { const relation = relations.find((item, index) => (item.id || `relation-${index + 1}`) === id); const sourceId = relation?.fromId || objects.find((object) => object.name === relation?.from)?.id; if (sourceId) setSelectedObjectId(sourceId); setSelectedRelationId(id) }}
              isAddingObject={isAddingObject}
              setIsAddingObject={setIsAddingObject}
              newObjectName={newObjectName}
              setNewObjectName={setNewObjectName}
              onAddObject={addObject}
              liveOutput={stageOutput.model}
              isLive={runningStage === 'model'}
              provider={provider}
            />
          )}

          {activeView === 'understanding' && <UnderstandingView understanding={understanding} questionAnswers={questionAnswers} onQuestionAnswerChange={(index, value) => setQuestionAnswers((current) => ({ ...current, [index]: value }))} onSubmitAnswers={submitQuestionAnswers} questionsSubmitted={questionsSubmitted} isSubmitting={isAnalyzing} liveOutput={stageOutput.understand} isLive={runningStage === 'understand'} provider={provider} />}

          {activeView === 'narrative' && <NarrativeView narrative={modelNarrative} liveOutput={stageOutput.narrate} isLive={runningStage === 'narrate'} provider={provider} />}

          {activeView === 'assessment' && (
            <AssessmentView activities={activities} avgCoverage={avgCoverage} confirmedCount={objects.filter((object) => object.status === 'confirmed').length} onSelectActivity={(id) => setSelectedActivityId(id)} liveOutput={stageOutput.assess} isLive={runningStage === 'assess'} provider={provider} />
          )}
        </main>

        <aside className="assistant-rail">
          <div className="assistant-header">
            <div className="assistant-title"><div className="assistant-icon"><Bot size={17} /></div><div><strong>建模助手</strong><span>Ontology copilot</span></div></div>
            <button className="icon-button small" type="button" title="更多选项"><MoreHorizontal size={16} /></button>
          </div>
          <div className="assistant-context"><span className="context-pip" /><span>正在审阅：{activeView === 'understanding' ? '业务理解' : activeView === 'narrative' ? '模型自述' : activeView === 'assessment' ? selectedActivity?.name || '业务过程评估' : activeView === 'document' ? document.name : '候选模型'}</span></div>
          <div className="message-list">
            {messages.map((message, index) => <ChatMessage key={`${message.role}-${index}`} message={message} />)}
          </div>
          <div className="assistant-suggestions">
            <button type="button" onClick={() => setDraftMessage('当前业务理解还缺少哪些关键概念？')}><CircleAlert size={14} />识别模型缺口</button>
            <button type="button" onClick={() => setDraftMessage('请解释当前模型中的对象边界')}><MessageCircle size={14} />解释对象边界</button>
            {understanding && <button type="button" onClick={() => runAnalysis({ fromFeedback: true })} disabled={isAnalyzing}><RefreshCw size={14} />按反馈重新建模</button>}
          </div>
          <div className="composer">
            <textarea value={draftMessage} onChange={(event) => setDraftMessage(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); sendMessage() } }} placeholder="和建模助手讨论模型…" rows={2} disabled={isDiscussing} />
            <div className="composer-actions"><span aria-hidden="true" /><button className="send-button" type="button" title="发送消息" aria-label="发送消息" onClick={sendMessage} disabled={!draftMessage.trim()}><Send size={15} /></button></div>
          </div>
        </aside>
      </div>
      {toast && <div className="toast"><Check size={15} />{toast}</div>}
    </div>
  )
}

function DocumentView({ document, fileInputRef, onFile, onDropFile, onAnalyze, isAnalyzing }) {
  const handleDrop = (event) => {
    event.preventDefault()
    const file = event.dataTransfer.files?.[0]
    if (file) onDropFile(file)
  }
  return (
    <section className="document-layout">
      <div className="document-panel panel-surface">
        <div className="panel-toolbar">
          <div className="file-meta"><div className="file-icon"><FileText size={18} /></div><div><strong>{document.name}</strong><span>{document.size} · {document.updated}</span></div></div>
          <span className="document-evidence-label">业务证据</span>
        </div>
        <div className="evidence-editor-host">
          <QQDocEditor
            key={`${document.name}-${document.updated}`}
            embedded
            readOnly
            initialTitle={document.name}
            initialContent={documentToHtml(document.content)}
          />
        </div>
      </div>
      <div className="document-side">
        <div className="document-actions panel-surface">
          <div className="panel-toolbar"><div><div className="panel-title">文档操作</div><div className="panel-subtitle">导入材料后启动分阶段建模</div></div><FileText size={16} color="#7e969b" /></div>
          <div className="document-actions-body">
            <button className="upload-button" type="button" onClick={() => fileInputRef.current?.click()} onDragOver={(event) => event.preventDefault()} onDrop={handleDrop}><CloudUpload size={18} /><span><strong>上传业务文档</strong><small>DOCX / Markdown / TXT / HTML</small></span><Upload size={15} /></button>
            <input ref={fileInputRef} className="visually-hidden" type="file" accept=".docx,.md,.markdown,.txt,.html,.htm,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/markdown,text/plain,text/html" onChange={onFile} />
            <button className="primary-button full" type="button" onClick={onAnalyze} disabled={isAnalyzing || !document.content?.trim()}>{isAnalyzing ? <LoaderCircle className="spin" size={15} /> : <Sparkles size={15} />}{isAnalyzing ? '正在建模' : '开始建模'}</button>
            <p className="document-action-note">模型会以当前文档为证据，依次完成业务理解、候选模型和支撑评估。</p>
          </div>
        </div>
      </div>
    </section>
  )
}

function documentToHtml(content) {
  if (content.trimStart().startsWith('<')) return DOMPurify.sanitize(content, { USE_PROFILES: { html: true } })
  const escapeHtml = (value) => value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
  const lines = content.split('\n')
  const blocks = []
  let paragraph = []
  const flushParagraph = () => {
    if (!paragraph.length) return
    blocks.push(`<p>${paragraph.join('<br />')}</p>`)
    paragraph = []
  }
  lines.forEach((line) => {
    const trimmed = line.trim()
    if (!trimmed) {
      flushParagraph()
      return
    }
    const heading = trimmed.match(/^(#{1,6})\s+(.+)$/)
    if (heading) {
      flushParagraph()
      const level = heading[1].length
      blocks.push(`<h${level}>${escapeHtml(heading[2])}</h${level}>`)
      return
    }
    const bullet = trimmed.match(/^[-*]\s+(.+)$/)
    if (bullet) {
      flushParagraph()
      blocks.push(`<ul><li><p>${escapeHtml(bullet[1])}</p></li></ul>`)
      return
    }
    paragraph.push(escapeHtml(line))
  })
  flushParagraph()
  return blocks.join('') || '<p></p>'
}

function documentToBlocks(content) {
  const html = documentToHtml(String(content || ''))
  if (typeof DOMParser === 'undefined') {
    return String(content || '').split(/\n+/).map((text, index) => ({ id: `block-${index + 1}`, text: text.trim() })).filter((block) => block.text)
  }
  const root = new DOMParser().parseFromString(`<article>${html}</article>`, 'text/html').body.firstElementChild
  return [...(root?.children || [])].map((element, index) => ({
    id: `block-${index + 1}`,
    type: element.tagName.toLowerCase(),
    text: element.textContent?.replace(/\s+/g, ' ').trim() || '',
  })).filter((block) => block.text)
}

async function readSse(response, onEvent) {
  if (!response.body) throw new Error('分析服务没有返回流')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { value, done } = await reader.read()
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done })
    const events = buffer.split(/\n\n/)
    buffer = events.pop() || ''
    for (const event of events) {
      const data = event.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).join('')
      if (data) onEvent(JSON.parse(data))
    }
    if (done) break
  }
  if (buffer.trim()) {
    const data = buffer.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).join('')
    if (data) onEvent(JSON.parse(data))
  }
}

function ModelView({ objects, relations, capabilityCount, ruleCount, capabilities, rules, selectedObject, selectedObjectId, selectedRelation, selectedRelationId, onSelectObject, onSelectRelation, isAddingObject, setIsAddingObject, newObjectName, setNewObjectName, onAddObject, liveOutput, isLive, provider }) {
  return (
    <section className="model-layout">
      <div className="model-canvas panel-surface">
        <div className="panel-toolbar"><div><div className="panel-title">领域对象关系图</div><div className="panel-subtitle">{objects.length} 对象 · {relations.length} 关系 · {capabilityCount} 操作/能力 · {ruleCount} 规则</div></div><div className="toolbar-actions"><button className="view-control active" type="button"><Network size={14} />关系图</button><button className="view-control" type="button"><Table2 size={14} />表格</button><button className="icon-button small" type="button" title="画布设置"><Settings2 size={15} /></button></div></div>
        <GraphCanvas objects={objects} relations={relations} selectedObjectId={selectedObjectId} selectedRelationId={selectedRelationId} onSelectObject={onSelectObject} onSelectRelation={onSelectRelation} provider={provider} />
      </div>
      <div className="model-inspector">
        <div className="section-label">{selectedRelation ? '关系详情' : '对象详情'}</div>
        {selectedRelation && <div className="relation-focus panel-surface"><div className="relation-focus-title"><Link2 size={16} /><strong>{selectedRelation.label || '关联'}</strong></div><div className="relation-focus-path"><span>{selectedRelation.from}</span><ArrowRight size={13} /><span>{selectedRelation.to}</span></div>{selectedRelation.description && <p>{selectedRelation.description}</p>}{selectedRelation.evidence?.length ? <div className="relation-focus-evidence">依据 {selectedRelation.evidence.map((evidence) => evidence.blockId).join('、')}</div> : null}</div>}
        <div className="inspector-context-label">{selectedRelation ? '关联对象' : '当前对象'}</div>
        <div className="inspector-heading"><div className={`object-icon tint-${selectedObject?.tint || 'slate'}`}><Box size={18} /></div><div><h2>{selectedObject?.name}</h2><span>{selectedObject?.type} · 来源：{selectedObject?.source}</span></div><button className="icon-button small" type="button" title="对象选项"><MoreHorizontal size={15} /></button></div>
        <div className={`review-status ${selectedObject?.status}`}><span className="status-dot" />{STATUS_LABELS[selectedObject?.status] || '待确认'}<span className="status-divider" />{selectedObject?.status === 'confirmed' ? '有文档依据' : '需要人工确认'}</div>
        <p className="inspector-description">{selectedObject?.description}</p>
        <div className="inspector-section"><div className="inspector-section-title">属性字段 <span>{selectedObject?.fields?.length || 0}</span></div>{selectedObject?.fields?.length ? <div className="field-list">{selectedObject.fields.map((field) => <div className="field-row" key={field}><span className="field-type">{field.match(/（(.+)）/)?.[1] || 'str'}</span><span>{field.replace(/（.+）$/, '')}</span><Check size={14} /></div>)}</div> : <div className="empty-inline">尚未定义属性字段</div>}</div>
        <div className="inspector-section"><div className="inspector-section-title">原文依据 <span>{selectedObject?.evidence?.length || 0}</span></div>{selectedObject?.evidence?.length ? <div className="evidence-quotes">{selectedObject.evidence.slice(0, 3).map((item, index) => <div key={`${item.blockId}-${index}`}><small>{item.blockId}</small><span>“{item.quote}”</span></div>)}</div> : <div className="empty-inline">尚未找到直接引文</div>}</div>
        <div className="inspector-section"><div className="inspector-section-title">业务操作与只读能力 <span>{capabilityCount}</span></div>{capabilities.length ? <div className="compact-element-list">{capabilities.slice(0, 5).map((item) => <div key={item.id}><span>{item.kind}</span><strong>{item.name}</strong></div>)}</div> : <div className="empty-inline">材料中尚未识别</div>}</div>
        <div className="inspector-section"><div className="inspector-section-title">业务规则 <span>{ruleCount}</span></div>{rules.length ? <div className="compact-element-list">{rules.slice(0, 4).map((item) => <div key={item.id}><span>规则</span><strong>{item.name}</strong></div>)}</div> : <div className="empty-inline">材料中尚未识别</div>}</div>
        <div className="inspector-section"><div className="inspector-section-title">直接关系 <span>{relations.filter((relation) => relation.from === selectedObject?.name || relation.to === selectedObject?.name).length}</span></div><div className="relation-list">{relations.filter((relation) => relation.from === selectedObject?.name || relation.to === selectedObject?.name).slice(0, 6).map((relation, index) => <div key={`${relation.label}-${index}`}><Link2 size={14} /><span>{relation.label}</span><strong>{relation.from === selectedObject?.name ? `→ ${relation.to}` : `← ${relation.from}`}</strong></div>)}{!relations.some((relation) => relation.from === selectedObject?.name || relation.to === selectedObject?.name) && <div className="empty-inline">尚未定义直接关系</div>}</div></div>
        <button className="secondary-button full" type="button" onClick={() => setIsAddingObject(true)}><Plus size={15} />补充模型对象</button>
        {isAddingObject && <div className="add-object-form"><input autoFocus value={newObjectName} onChange={(event) => setNewObjectName(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && onAddObject()} placeholder="输入对象名称" /><button className="primary-button" type="button" onClick={onAddObject}>添加</button><button className="icon-button small" type="button" title="取消" onClick={() => setIsAddingObject(false)}><X size={15} /></button></div>}
      </div>
      <LiveStageOutput output={liveOutput} isLive={isLive} provider={provider} />
    </section>
  )
}

function GraphNode({ object, active, onClick }) {
  if (!object) return null
  return <button className={`graph-node ${active ? 'active' : ''}`} type="button" onClick={onClick}><span className={`node-icon tint-${object.tint || 'slate'}`}><Box size={15} /></span><span className="node-copy"><strong>{object.name}</strong><small>{object.type} · {object.properties?.length || object.fields?.length || 0} 个属性</small></span><span className={`node-status ${object.status}`} title={STATUS_LABELS[object.status]} /></button>
}

function GraphCanvas({ objects, relations, selectedObjectId, selectedRelationId, onSelectObject, onSelectRelation, provider }) {
  const nodeWidth = 190
  const nodeHeight = 68
  const gapX = 72
  const gapY = 35
  const padding = 34
  const columns = Math.max(1, Math.min(4, Math.ceil(Math.sqrt(Math.max(objects.length, 1)))))
  const rows = Math.max(1, Math.ceil(objects.length / columns))
  const width = Math.max(680, padding * 2 + columns * nodeWidth + (columns - 1) * gapX)
  const height = Math.max(470, padding * 2 + rows * nodeHeight + (rows - 1) * gapY)
  const positions = new Map(objects.map((object, index) => [object.id, { x: padding + (index % columns) * (nodeWidth + gapX), y: padding + Math.floor(index / columns) * (nodeHeight + gapY) }]))
  const resolveId = (value) => objects.some((object) => object.id === value) ? value : objects.find((object) => object.name === value)?.id
  const providerName = provider === 'deepseek' ? 'DeepSeek API' : 'Codex ACP'
  return <div className="graph-canvas"><div className="graph-stage" style={{ width, height }}>
    <svg className="graph-edges" width={width} height={height} aria-hidden="true"><defs><marker id="graph-arrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0,0 L7,3.5 L0,7 z" fill="currentColor" /></marker></defs>{relations.map((relation, index) => { const relationId = relation.id || `relation-${index + 1}`; const from = positions.get(resolveId(relation.fromId || relation.from)); const to = positions.get(resolveId(relation.toId || relation.to)); if (!from || !to) return null; const x1 = from.x + nodeWidth / 2; const y1 = from.y + nodeHeight / 2; const x2 = to.x + nodeWidth / 2; const y2 = to.y + nodeHeight / 2; const active = selectedRelationId === relationId; return <g className={`graph-edge ${active ? 'active' : ''}`} key={relationId} onClick={() => onSelectRelation(relationId)} role="button" tabIndex="0" onKeyDown={(event) => event.key === 'Enter' && onSelectRelation(relationId)}><line className="graph-edge-hit" x1={x1} y1={y1} x2={x2} y2={y2} /><line className="graph-edge-line" x1={x1} y1={y1} x2={x2} y2={y2} markerEnd="url(#graph-arrow)" /><text x={(x1 + x2) / 2} y={(y1 + y2) / 2 - 7}>{relation.label || '关联'}</text></g> })}</svg>
    {objects.map((object) => { const position = positions.get(object.id); return <div className="graph-node-position" key={object.id} style={{ left: position.x, top: position.y }}><GraphNode object={object} active={selectedObjectId === object.id} onClick={() => onSelectObject(object.id)} /></div> })}
    {!objects.length && <div className="empty-graph">上传材料后点击“开始建模”，这里会显示 {providerName} 识别的候选对象。</div>}
  </div><div className="graph-legend"><span><i className="legend-dot confirmed" />已确认</span><span><i className="legend-dot review" />待确认</span><span><i className="legend-dot gap" />待补充</span></div></div>
}

function BrandMark() {
  return <svg width="21" height="21" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 6.5 18 6.5M6.8 8.2 11 16.1M17.2 8.2 13 16.1" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /><circle cx="6" cy="6.5" r="2.35" fill="currentColor" /><circle cx="18" cy="6.5" r="2.35" fill="currentColor" /><circle cx="12" cy="18" r="2.55" fill="currentColor" /></svg>
}

function UnderstandingView({ understanding, questionAnswers, onQuestionAnswerChange, onSubmitAnswers, questionsSubmitted, isSubmitting, liveOutput, isLive, provider }) {
  if (!understanding) return <section className="understanding-view"><div className="empty-state panel-surface">先上传业务文档并开始分析，这里会显示当前提供方对业务目标、概念和过程的理解。</div><LiveStageOutput output={liveOutput} isLive={isLive} provider={provider} /></section>
  return <section className="understanding-view">
    <div className="understanding-summary panel-surface"><div className="panel-toolbar"><div><div className="panel-title">本轮业务理解</div><div className="panel-subtitle">这是建模输入，概念尚未细化属性</div></div><span className="stage-badge">阶段 1</span></div><p>{understanding.summary}</p></div>
    <div className="understanding-grid"><div className="understanding-card understanding-goals panel-surface"><div className="section-label">业务目标</div>{understanding.goals?.length ? <ul>{understanding.goals.map((item) => <li key={item}>{item}</li>)}</ul> : <div className="empty-inline">材料中尚未明确</div>}</div><div className="understanding-card understanding-facts panel-surface"><div className="section-label">业务事实与规则</div>{[...(understanding.facts || []), ...(understanding.rules || [])].length ? <ul>{[...(understanding.facts || []), ...(understanding.rules || [])].map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ul> : <div className="empty-inline">材料中尚未明确</div>}</div></div>
    <div className="understanding-columns"><div className="understanding-card panel-surface"><div className="panel-toolbar"><div className="panel-title">业务概念 <span className="count-pill">{understanding.concepts?.length || 0}</span></div></div><div className="concept-list">{understanding.concepts?.map((item) => <div className="concept-item" key={item.id}><strong>{item.name}</strong><p>{item.description || '待在建模阶段确认边界。'}</p><small>{item.evidence?.length ? `依据 ${item.evidence.map((evidence) => evidence.blockId).join('、')}` : '暂无直接引文'}</small></div>)}</div></div><div className="understanding-card panel-surface"><div className="panel-toolbar"><div className="panel-title">业务过程 <span className="count-pill">{understanding.processes?.length || 0}</span></div></div><div className="concept-list">{understanding.processes?.map((item, index) => <div className="concept-item process-item" key={item.id}><span className="process-index">{String(index + 1).padStart(2, '0')}</span><div><strong>{item.name}</strong><p>{item.description || '待评估模型支撑情况。'}</p><small>{item.evidence?.length ? `依据 ${item.evidence.map((evidence) => evidence.blockId).join('、')}` : '暂无直接引文'}</small></div></div>)}</div></div></div>
    {understanding.questions?.length ? <div className="questions-panel panel-surface"><div className="questions-panel-heading"><div className="questions-heading-icon"><CircleAlert size={15} /></div><div><strong>待确认问题</strong><p>请补充这些信息。提交后将作为反馈带入候选模型阶段。</p></div><span className={questionsSubmitted ? 'question-status submitted' : 'question-status'}>{questionsSubmitted ? '已提交' : `${understanding.questions.length} 项`}</span></div><div className="question-form">{understanding.questions.map((question, index) => <label className="question-row" key={`${question}-${index}`}><span>{index + 1}</span><div><strong>{question}</strong><textarea rows={2} value={questionAnswers?.[index] || ''} onChange={(event) => onQuestionAnswerChange(index, event.target.value)} placeholder="填写你的确认或补充" disabled={isSubmitting} /></div></label>)}</div><div className="question-actions"><small>已填写 {understanding.questions.filter((_, index) => questionAnswers?.[index]?.trim()).length} / {understanding.questions.length}</small><button className="primary-button" type="button" onClick={onSubmitAnswers} disabled={isSubmitting}>{isSubmitting ? <LoaderCircle className="spin" size={14} /> : <Check size={14} />}{isSubmitting ? '正在重新建模' : questionsSubmitted ? '再次提交并重新建模' : '确认并重新建模'}</button></div></div> : null}
    <LiveStageOutput output={liveOutput} isLive={isLive} provider={provider} />
  </section>
}

function ActivitiesView({ activities, selectedActivityId, onSelectActivity }) {
  const selected = activities.find((activity) => activity.id === selectedActivityId) || activities[0]
  if (!selected) return <section className="activity-layout"><div className="empty-state panel-surface">运行一次文档分析后，这里会显示业务活动及其模型支撑情况。</div></section>
  return (
    <section className="activity-layout">
      <div className="activity-list panel-surface"><div className="panel-toolbar"><div><div className="panel-title">业务活动清单</div><div className="panel-subtitle">来自文档的目标场景，不写入核心领域模型</div></div><button className="icon-button small" type="button" title="筛选活动"><Search size={15} /></button></div><div className="activity-items">{activities.map((activity) => <button className={`activity-item ${selectedActivityId === activity.id ? 'active' : ''}`} key={activity.id} type="button" onClick={() => onSelectActivity(activity.id)}><div className="activity-item-top"><span className={`activity-state ${activity.status}`}><i />{STATUS_LABELS[activity.status]}</span><span>{activity.coverage}%</span></div><strong>{activity.name}</strong><p>{activity.goal}</p><div className="coverage-track"><span style={{ width: `${activity.coverage}%` }} /></div></button>)}</div></div>
      <div className="activity-detail"><div className="section-label">活动验证</div><div className="activity-detail-heading"><div className={`activity-detail-icon ${selected.status}`}><Target size={21} /></div><div><h2>{selected.name}</h2><span>活动目标</span></div></div><p className="activity-goal">{selected.goal}</p><div className="support-score"><div><span>模型支撑度</span><strong>{selected.coverage}%</strong></div><div className="large-track"><span className={selected.status} style={{ width: `${selected.coverage}%` }} /></div></div><div className="mapping-section"><div className="section-label">已映射模型元素</div><div className="mapping-list">{selected.elements.map((element) => <div key={element}><Check size={14} /><span>{element}</span><ArrowRight size={13} /><small>模型元素</small></div>)}</div></div>{selected.gap ? <div className="gap-callout"><CircleAlert size={17} /><div><strong>模型缺口</strong><p>{selected.gap}</p><button type="button">在对话中讨论 <ArrowRight size={13} /></button></div></div> : <div className="success-callout"><BadgeCheck size={17} /><div><strong>当前模型可以支撑此活动</strong><p>关键对象、关系和能力已具备。</p></div></div>}</div>
    </section>
  )
}

function NarrativeView({ narrative, liveOutput, isLive, provider }) {
  const content = narrative || liveOutput
  const providerName = provider === 'deepseek' ? 'DeepSeek API' : 'Codex ACP'
  if (!content && !isLive) return <section className="narrative-view"><div className="empty-state panel-surface">候选模型生成后，这里会显示仅基于模型的自然语言复述。</div></section>
  return <section className="narrative-view"><div className="narrative-card panel-surface"><div className="panel-toolbar"><div><div className="panel-title">候选模型自述</div><div className="panel-subtitle">仅依据候选模型生成，不读取业务文档和第一阶段业务理解</div></div><span className={`narrative-status ${isLive ? 'live' : ''}`}>{isLive ? `${providerName} 正在复述` : '可供审阅'}</span></div><div className="narrative-body">{content ? <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown> : <span className="narrative-placeholder">正在等待模型自述……</span>}{isLive && <span className="typing-indicator" aria-label="正在输出"><i /><i /><i /></span>}</div></div></section>
}

function AssessmentView({ activities, avgCoverage, confirmedCount, onSelectActivity, liveOutput, isLive, provider }) {
  const supported = activities.filter((activity) => activity.status === 'supported').length
  const partial = activities.filter((activity) => activity.status === 'partial').length
  const gaps = activities.filter((activity) => activity.status === 'gap').length
  return (
    <section className="assessment-view"><div className="assessment-summary"><div><div className="section-label">整体支撑度</div><div className="assessment-score"><strong>{avgCoverage}%</strong><span>基于 {activities.length} 个业务过程</span></div></div><button className="secondary-button" type="button"><RefreshCw size={15} />重新评估</button></div><div className="assessment-metrics"><MetricCard icon={BadgeCheck} label="可支撑" value={supported} tone="green" /><MetricCard icon={CircleAlert} label="部分支撑" value={partial} tone="amber" /><MetricCard icon={Target} label="存在缺口" value={gaps} tone="red" /><MetricCard icon={Box} label="已确认对象" value={confirmedCount} tone="blue" /></div><div className="assessment-table panel-surface"><div className="panel-toolbar"><div><div className="panel-title">业务过程支撑矩阵</div><div className="panel-subtitle">查看每个过程的覆盖元素和模型缺口</div></div><button className="view-control" type="button"><SlidersHorizontal size={14} />按支撑度排序</button></div><div className="matrix-head"><span>业务过程</span><span>关键模型元素</span><span>支撑度</span><span>结论</span></div>{activities.map((activity) => <button className="matrix-row" type="button" key={activity.id} onClick={() => onSelectActivity(activity.id)}><span className="matrix-name"><span className={`activity-state ${activity.status}`}><i /></span><strong>{activity.name}</strong></span><span className="matrix-elements">{activity.elements.slice(0, 3).join(' · ')}</span><span className="matrix-progress"><span><i className={activity.status} style={{ width: `${activity.coverage}%` }} /></span><strong>{activity.coverage}%</strong></span><span className={`matrix-conclusion ${activity.status}`}>{STATUS_LABELS[activity.status]} <ArrowRight size={14} /></span></button>)}</div><LiveStageOutput output={liveOutput} isLive={isLive} provider={provider} /></section>
  )
}

function MetricCard({ icon: Icon, label, value, tone }) {
  return <div className="metric-card"><div className={`metric-icon ${tone}`}><Icon size={17} /></div><div><span>{label}</span><strong>{value}</strong></div></div>
}

function LiveStageOutput({ output, isLive, provider }) {
  if (!isLive && !output) return null
  const providerName = provider === 'deepseek' ? 'DeepSeek API' : 'Codex ACP'
  return <div className="live-stage-output panel-surface"><div className="live-stage-heading"><span className={`live-dot ${isLive ? 'active' : ''}`} /><strong>{isLive ? `${providerName} 流式输出` : '本阶段输出记录'}</strong><small>{isLive ? '正在接收' : '已完成'}</small></div><pre>{output || `正在等待 ${providerName} 输出……`}</pre></div>
}

function ChatMessage({ message }) {
  return <div className={`chat-message ${message.role}`}><div className="message-avatar">{message.role === 'assistant' ? <Bot size={14} /> : '你'}</div><div className="message-bubble">{message.role === 'assistant' ? <><ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>{message.progress && <span className="typing-indicator" aria-label="正在输出"><i /><i /><i /></span>}</> : message.content}</div></div>
}

export default App

createRoot(document.getElementById('root')).render(<App />)
