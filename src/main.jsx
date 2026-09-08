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
  Layers3,
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
import './styles.css'

const DEFAULT_DOCUMENT = {
  name: '高压接入方案业务规则说明.md',
  size: '10.4 KB',
  updated: '刚刚导入',
  content: [
    '# 接入方案业务规则说明书（高压10kV）',
    '',
    '## 一、用户需求',
    '',
    '业务类型：高压新装、高压增容、高压装表临时用电；供电电压为：10kV；用户受电变压器总容量不得超过20000kVA。',
    '',
    '现场勘查阶段需明确的字段有，其中必填字段为：负荷性质、供电电压、需求类型、用电类别、核定合计合同容量、用户重要等级、用电地址等。',
    '',
    '## 二、大模型推理',
    '',
    '### （一）新装场景',
    '',
    '#### 1. 电源点查询',
    '',
    '以用户受电点位置为中心，搜索周边电源点，从200米开始并按500、800、1000米扩散，直到找到5条不同线路。',
    '',
    '#### 2. 校核容量',
    '',
    '需同步校验关联馈线的可开放容量、当前负载率及对应主变的实时负载率。',
    '',
    '## 三、方案评分规则',
    '',
    '综合评分=造价估算与经济性×35%+容量与运行裕度×35%+设备健康与可持续性×15%+施工可实施性×15%。',
  ].join('\n'),
}

const INITIAL_OBJECTS = [
  {
    id: 'demand',
    name: '用电需求',
    type: '业务对象',
    source: '用户需求',
    status: 'confirmed',
    description: '承载高压接入申请的容量、类型与重要等级。',
    fields: ['需求类型', '供电电压', '合同容量', '用户重要等级'],
    tint: 'blue',
  },
  {
    id: 'supply-point',
    name: '电源点',
    type: '业务对象',
    source: '电源点查询',
    status: 'confirmed',
    description: '可为用户受电点提供接入的电网节点。',
    fields: ['位置', '所属馈线', '所属变电站', '供电距离'],
    tint: 'teal',
  },
  {
    id: 'feeder',
    name: '馈线',
    type: '业务对象',
    source: '容量校核',
    status: 'confirmed',
    description: '承载接入容量并参与负载率校核的线路。',
    fields: ['可开放容量', '历史最大负载率', '线路类型'],
    tint: 'orange',
  },
  {
    id: 'substation',
    name: '变电站',
    type: '业务对象',
    source: '变电站新出线',
    status: 'review',
    description: '提供主变和出线间隔的供电设施。',
    fields: ['空余间隔', '主变可开放容量', '主变实时负载率'],
    tint: 'violet',
  },
  {
    id: 'plan',
    name: '供电方案',
    type: '模型产物',
    source: '方案生成',
    status: 'review',
    description: '由候选电源点、运行方式和评分组成的方案集合。',
    fields: ['电源结构', '运行方式', '综合评分', '否决原因'],
    tint: 'rose',
  },
]

const INITIAL_RELATIONS = [
  { from: '用电需求', label: '筛选', to: '电源点' },
  { from: '电源点', label: '关联', to: '馈线' },
  { from: '馈线', label: '隶属', to: '变电站' },
  { from: '用电需求', label: '生成', to: '供电方案' },
]

const INITIAL_ACTIVITIES = [
  {
    id: 'new-install',
    name: '高压新装接入方案设计',
    goal: '为新装用户推荐满足供电可靠性和承载能力的接入方案。',
    coverage: 86,
    status: 'supported',
    elements: ['用电需求', '电源点', '馈线', '变电站', '容量校核'],
    gap: '',
  },
  {
    id: 'capacity-upgrade',
    name: '增容可行性校核',
    goal: '在保留原接入关系的前提下判断增容或升级双电源是否可行。',
    coverage: 68,
    status: 'partial',
    elements: ['用电需求', '馈线', '变电站'],
    gap: '缺少“原接入关系”的稳定事实及其查询能力。',
  },
  {
    id: 'score-plan',
    name: '供电方案评分与输出',
    goal: '按经济性、运行裕度、设备健康和施工可实施性输出候选方案。',
    coverage: 54,
    status: 'partial',
    elements: ['供电方案', '馈线', '变电站'],
    gap: '设备健康、历史停电和施工条件尚未进入模型。',
  },
  {
    id: 'new-feeder',
    name: '变电站新出线判断',
    goal: '在既有电源点不可用时，判断是否需要新出线及其候选变电站。',
    coverage: 41,
    status: 'gap',
    elements: ['变电站', '馈线'],
    gap: '缺少“空余间隔”和“新出线可行性”能力，无法闭合判断。',
  },
]

const NAV_ITEMS = [
  { id: 'document', label: '业务文档', icon: FileText, step: '01' },
  { id: 'model', label: '领域模型', icon: Network, step: '02' },
  { id: 'activities', label: '业务活动', icon: Activity, step: '03' },
  { id: 'assessment', label: '支撑评估', icon: ClipboardCheck, step: '04' },
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
  const [selectedObjectId, setSelectedObjectId] = useState('demand')
  const [activities, setActivities] = useState(INITIAL_ACTIVITIES)
  const [selectedActivityId, setSelectedActivityId] = useState('new-install')
  const [isAddingObject, setIsAddingObject] = useState(false)
  const [newObjectName, setNewObjectName] = useState('')
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      content: '我已从文档中识别出 5 个候选业务对象、4 条关系和 4 个待验证活动。当前模型还缺少设备健康与原接入关系的事实。',
    },
  ])
  const [draftMessage, setDraftMessage] = useState('')
  const [toast, setToast] = useState('')
  const fileInputRef = useRef(null)

  const selectedObject = objects.find((object) => object.id === selectedObjectId) || objects[0]
  const selectedActivity = activities.find((activity) => activity.id === selectedActivityId) || activities[0]
  const confirmedCount = objects.filter((object) => object.status === 'confirmed').length
  const avgCoverage = Math.round(activities.reduce((sum, activity) => sum + activity.coverage, 0) / activities.length)
  const llmConfigured = Boolean(import.meta.env.VITE_LLM_API_URL && import.meta.env.VITE_LLM_MODEL)

  useEffect(() => {
    const stored = window.localStorage.getItem('uom-forge-project')
    if (!stored) return
    try {
      const project = JSON.parse(stored)
      if (project.document) setDocument(project.document)
      if (project.objects?.length) setObjects(project.objects)
      if (project.activities?.length) setActivities(project.activities)
    } catch {
      // Ignore stale local drafts and keep the built-in prototype state.
    }
  }, [])

  useEffect(() => {
    if (!toast) return undefined
    const timer = window.setTimeout(() => setToast(''), 2400)
    return () => window.clearTimeout(timer)
  }, [toast])

  const persistProject = () => {
    window.localStorage.setItem('uom-forge-project', JSON.stringify({ document, objects, activities }))
    setToast('项目草稿已保存')
  }

  const handleFile = async (event) => {
    const file = event.target.files?.[0]
    if (!file) return
    const content = await file.text()
    setDocument({
      name: file.name,
      size: `${(file.size / 1024).toFixed(1)} KB`,
      updated: '刚刚导入',
      content,
    })
    setActiveView('document')
    setMessages((current) => [...current, { role: 'assistant', content: `已载入「${file.name}」，可以开始提取领域模型。` }])
    setToast('文档已载入')
  }

  const runAnalysis = () => {
    if (isAnalyzing) return
    setIsAnalyzing(true)
    setMessages((current) => [...current, { role: 'assistant', content: '正在对文档进行分段理解，并将候选概念映射到模型元素……' }])
    window.setTimeout(() => {
      setIsAnalyzing(false)
      setActiveView('model')
      setMessages((current) => [...current, { role: 'assistant', content: '首轮建模完成。建议先确认“用电需求”和“电源点”的边界，再处理设备健康信息缺口。' }])
      setToast('首轮模型已更新')
    }, 1050)
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
    window.setTimeout(() => {
      const response = content.includes('设备')
        ? '文档确实提到设备投运年限、缺陷和历史停电，但目前它们只作为评分依据出现。建议先补充“设备”对象及其与馈线、变电站的关系。'
        : '我会把这条意见记录为模型调整建议。请在画布中确认对象边界，再重新运行活动支撑评估。'
      setMessages((current) => [...current, { role: 'assistant', content: response }])
    }, 620)
  }

  const currentTabLabel = NAV_ITEMS.find((item) => item.id === activeView)?.label

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-mark"><Layers3 size={19} strokeWidth={2.5} /></div>
          <div>
            <div className="brand-name">UOM Forge</div>
            <div className="brand-subtitle">领域建模工作台</div>
          </div>
        </div>
        <div className="project-context">
          <span className="context-label">项目</span>
          <button className="project-picker" type="button" title="切换项目">
            <span>高压接入方案</span>
            <ChevronDown size={14} />
          </button>
          <span className="project-state"><span className="state-dot" /> 草稿</span>
        </div>
        <div className="topbar-actions">
          <div className={`llm-indicator ${llmConfigured ? 'online' : ''}`} title={llmConfigured ? 'LLM 配置已就绪' : '当前为本地演示模式'}>
            <span className="state-dot" />
            <span>{llmConfigured ? 'LLM 已连接' : '演示模式'}</span>
          </div>
          <button className="icon-button" type="button" title="保存项目" onClick={persistProject}><Save size={17} /></button>
          <button className="icon-button" type="button" title="项目设置"><Settings2 size={17} /></button>
          <div className="avatar">CH</div>
        </div>
      </header>

      <div className="app-body">
        <aside className="sidebar">
          <div className="sidebar-caption">建模项目</div>
          <nav className="primary-nav" aria-label="建模项目导航">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon
              const active = activeView === item.id
              return (
                <button key={item.id} className={`nav-item ${active ? 'active' : ''}`} type="button" onClick={() => setActiveView(item.id)}>
                  <span className="nav-step">{item.step}</span>
                  <Icon size={17} />
                  <span>{item.label}</span>
                  {item.id === 'assessment' && <span className="nav-badge">3</span>}
                </button>
              )
            })}
          </nav>

          <div className="sidebar-divider" />
          <div className="sidebar-caption">当前模型</div>
          <div className="model-totals">
            <div className="total-row"><Box size={15} /><span>对象</span><strong>{objects.length}</strong></div>
            <div className="total-row"><GitBranch size={15} /><span>关系</span><strong>{INITIAL_RELATIONS.length}</strong></div>
            <div className="total-row"><Zap size={15} /><span>能力</span><strong>6</strong></div>
            <div className="total-row"><ShieldCheck size={15} /><span>约束</span><strong>8</strong></div>
          </div>

          <div className="sidebar-footer">
            <div className="sync-row"><span className="sync-icon"><Check size={12} /></span><span>本地草稿已同步</span></div>
            <div className="version-label">UOM/OAG schema v1</div>
          </div>
        </aside>

        <main className="main-content">
          <div className="workspace-heading">
            <div>
              <div className="eyebrow"><span>业务建模</span><ArrowRight size={13} /><span>{currentTabLabel}</span></div>
              <h1>{activeView === 'document' ? '先读懂业务，再确认模型' : activeView === 'activities' ? '哪些活动能被模型支撑' : activeView === 'assessment' ? '模型完整性评估' : '领域模型工作台'}</h1>
              <p className="heading-note">高压 10kV 接入方案 · 最后分析于 {document.updated}</p>
            </div>
            <div className="heading-actions">
              <button className="secondary-button" type="button" onClick={() => setActiveView('document')}><FileText size={15} />查看文档</button>
              <button className="primary-button" type="button" onClick={runAnalysis} disabled={isAnalyzing}>
                {isAnalyzing ? <LoaderCircle className="spin" size={16} /> : <Sparkles size={16} />}
                {isAnalyzing ? '分析中' : '重新分析'}
              </button>
            </div>
          </div>

          <div className="view-tabs" role="tablist" aria-label="工作区视图">
            {NAV_ITEMS.map((item) => (
              <button key={item.id} className={`view-tab ${activeView === item.id ? 'active' : ''}`} type="button" onClick={() => setActiveView(item.id)}>
                {item.label}
                {item.id === 'assessment' && <span className="tab-count">3</span>}
              </button>
            ))}
          </div>

          {activeView === 'document' && (
            <DocumentView document={document} fileInputRef={fileInputRef} onFile={handleFile} onAnalyze={runAnalysis} />
          )}

          {activeView === 'model' && (
            <ModelView
              objects={objects}
              selectedObject={selectedObject}
              selectedObjectId={selectedObjectId}
              onSelectObject={setSelectedObjectId}
              isAddingObject={isAddingObject}
              setIsAddingObject={setIsAddingObject}
              newObjectName={newObjectName}
              setNewObjectName={setNewObjectName}
              onAddObject={addObject}
            />
          )}

          {activeView === 'activities' && (
            <ActivitiesView activities={activities} selectedActivityId={selectedActivityId} onSelectActivity={setSelectedActivityId} />
          )}

          {activeView === 'assessment' && (
            <AssessmentView activities={activities} avgCoverage={avgCoverage} onSelectActivity={(id) => { setSelectedActivityId(id); setActiveView('activities') }} />
          )}
        </main>

        <aside className="assistant-rail">
          <div className="assistant-header">
            <div className="assistant-title"><div className="assistant-icon"><Bot size={17} /></div><div><strong>建模助手</strong><span>Ontology copilot</span></div></div>
            <button className="icon-button small" type="button" title="更多选项"><MoreHorizontal size={16} /></button>
          </div>
          <div className="assistant-context"><span className="context-pip" /><span>正在审阅：{activeView === 'activities' ? selectedActivity.name : activeView === 'document' ? document.name : '领域模型'}</span></div>
          <div className="message-list">
            {messages.map((message, index) => <ChatMessage key={`${message.role}-${index}`} message={message} />)}
          </div>
          <div className="assistant-suggestions">
            <button type="button" onClick={() => setDraftMessage('设备健康信息是否应该成为领域对象？')}><CircleAlert size={14} />识别模型缺口</button>
            <button type="button" onClick={() => setDraftMessage('请解释当前模型中的对象边界')}><MessageCircle size={14} />解释对象边界</button>
          </div>
          <div className="composer">
            <textarea value={draftMessage} onChange={(event) => setDraftMessage(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); sendMessage() } }} placeholder="和建模助手讨论模型…" rows={2} />
            <div className="composer-actions"><span aria-hidden="true" /><button className="send-button" type="button" title="发送消息" aria-label="发送消息" onClick={sendMessage} disabled={!draftMessage.trim()}><Send size={15} /></button></div>
          </div>
        </aside>
      </div>
      {toast && <div className="toast"><Check size={15} />{toast}</div>}
    </div>
  )
}

function DocumentView({ document, fileInputRef, onFile, onAnalyze }) {
  const lines = document.content.split('\n')
  return (
    <section className="document-layout">
      <div className="document-panel panel-surface">
        <div className="panel-toolbar">
          <div className="file-meta"><div className="file-icon"><FileText size={18} /></div><div><strong>{document.name}</strong><span>{document.size} · {document.updated}</span></div></div>
          <div className="toolbar-actions"><button className="icon-button small" type="button" title="刷新文档"><RefreshCw size={15} /></button><button className="icon-button small" type="button" title="更多选项"><MoreHorizontal size={15} /></button></div>
        </div>
        <div className="document-body">
          {lines.map((line, index) => {
            if (line.startsWith('# ')) return <h2 key={index}>{line.slice(2)}</h2>
            if (line.startsWith('## ')) return <h3 key={index}>{line.slice(3)}</h3>
            if (line.startsWith('### ')) return <h4 key={index}>{line.slice(4)}</h4>
            if (line.startsWith('#### ')) return <h5 key={index}>{line.slice(5)}</h5>
            if (!line.trim()) return <div className="document-spacer" key={index} />
            return <p key={index}>{line}</p>
          })}
        </div>
      </div>
      <div className="document-side">
        <div className="section-label">文档操作</div>
        <button className="upload-button" type="button" onClick={() => fileInputRef.current?.click()}><CloudUpload size={18} /><span><strong>导入业务文档</strong><small>Markdown / TXT</small></span><Upload size={15} /></button>
        <input ref={fileInputRef} className="visually-hidden" type="file" accept=".md,.markdown,.txt,text/markdown,text/plain" onChange={onFile} />
        <div className="source-card"><div className="source-card-title"><BadgeCheck size={15} />来源状态</div><div className="source-card-value">已载入 1 份文档</div><div className="source-card-note">所有模型候选都会保留原文依据。</div></div>
        <div className="extract-card"><div className="section-label">首轮识别</div><div className="extract-row"><span>候选对象</span><strong>5</strong></div><div className="extract-row"><span>候选关系</span><strong>4</strong></div><div className="extract-row"><span>业务活动</span><strong>4</strong></div><button className="primary-button full" type="button" onClick={onAnalyze}><Sparkles size={15} />开始建模</button></div>
      </div>
    </section>
  )
}

function ModelView({ objects, selectedObject, selectedObjectId, onSelectObject, isAddingObject, setIsAddingObject, newObjectName, setNewObjectName, onAddObject }) {
  return (
    <section className="model-layout">
      <div className="model-canvas panel-surface">
        <div className="panel-toolbar"><div><div className="panel-title">领域对象关系图</div><div className="panel-subtitle">稳定对象 · 关系 · 来源依据</div></div><div className="toolbar-actions"><button className="view-control active" type="button"><Network size={14} />关系图</button><button className="view-control" type="button"><Table2 size={14} />表格</button><button className="icon-button small" type="button" title="画布设置"><Settings2 size={15} /></button></div></div>
        <div className="graph-canvas">
          <div className="graph-column left-column">
            <GraphNode object={objects.find((item) => item.id === 'demand')} active={selectedObjectId === 'demand'} onClick={() => onSelectObject('demand')} />
            <GraphNode object={objects.find((item) => item.id === 'feeder')} active={selectedObjectId === 'feeder'} onClick={() => onSelectObject('feeder')} />
          </div>
          <div className="graph-middle"><RelationLine label="筛选" /><RelationLine label="关联" /><RelationLine label="生成" /></div>
          <div className="graph-column right-column">
            <GraphNode object={objects.find((item) => item.id === 'supply-point')} active={selectedObjectId === 'supply-point'} onClick={() => onSelectObject('supply-point')} />
            <GraphNode object={objects.find((item) => item.id === 'substation')} active={selectedObjectId === 'substation'} onClick={() => onSelectObject('substation')} />
            <GraphNode object={objects.find((item) => item.id === 'plan')} active={selectedObjectId === 'plan'} onClick={() => onSelectObject('plan')} />
          </div>
          {objects.filter((item) => !['demand', 'feeder', 'supply-point', 'substation', 'plan'].includes(item.id)).map((object) => <div className="custom-node-wrap" key={object.id}><GraphNode object={object} active={selectedObjectId === object.id} onClick={() => onSelectObject(object.id)} /></div>)}
          <div className="graph-legend"><span><i className="legend-dot confirmed" />已确认</span><span><i className="legend-dot review" />待确认</span><span><i className="legend-dot gap" />待补充</span></div>
        </div>
      </div>
      <div className="model-inspector">
        <div className="section-label">对象详情</div>
        <div className="inspector-heading"><div className={`object-icon tint-${selectedObject?.tint || 'slate'}`}><Box size={18} /></div><div><h2>{selectedObject?.name}</h2><span>{selectedObject?.type} · 来源：{selectedObject?.source}</span></div><button className="icon-button small" type="button" title="对象选项"><MoreHorizontal size={15} /></button></div>
        <div className={`review-status ${selectedObject?.status}`}><span className="status-dot" />{STATUS_LABELS[selectedObject?.status] || '待确认'}<span className="status-divider" />{selectedObject?.status === 'confirmed' ? '有文档依据' : '需要人工确认'}</div>
        <p className="inspector-description">{selectedObject?.description}</p>
        <div className="inspector-section"><div className="inspector-section-title">属性字段 <span>{selectedObject?.fields?.length || 0}</span></div>{selectedObject?.fields?.length ? <div className="field-list">{selectedObject.fields.map((field) => <div className="field-row" key={field}><span className="field-type">str</span><span>{field}</span><Check size={14} /></div>)}</div> : <div className="empty-inline">尚未定义属性字段</div>}</div>
        <div className="inspector-section"><div className="inspector-section-title">直接关系 <span>2</span></div><div className="relation-list"><div><Link2 size={14} /><span>关联</span><strong>{selectedObject?.name === '用电需求' ? '电源点' : '用电需求'}</strong></div><div><Link2 size={14} /><span>参与</span><strong>供电方案</strong></div></div></div>
        <button className="secondary-button full" type="button" onClick={() => setIsAddingObject(true)}><Plus size={15} />补充模型对象</button>
        {isAddingObject && <div className="add-object-form"><input autoFocus value={newObjectName} onChange={(event) => setNewObjectName(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && onAddObject()} placeholder="输入对象名称" /><button className="primary-button" type="button" onClick={onAddObject}>添加</button><button className="icon-button small" type="button" title="取消" onClick={() => setIsAddingObject(false)}><X size={15} /></button></div>}
      </div>
    </section>
  )
}

function GraphNode({ object, active, onClick }) {
  if (!object) return null
  return <button className={`graph-node ${active ? 'active' : ''}`} type="button" onClick={onClick}><span className={`node-icon tint-${object.tint}`}><Box size={15} /></span><span className="node-copy"><strong>{object.name}</strong><small>{object.type}</small></span><span className={`node-status ${object.status}`} title={STATUS_LABELS[object.status]} /></button>
}

function RelationLine({ label }) {
  return <div className="relation-line"><span>{label}</span><i /><ArrowRight size={14} /></div>
}

function ActivitiesView({ activities, selectedActivityId, onSelectActivity }) {
  const selected = activities.find((activity) => activity.id === selectedActivityId) || activities[0]
  return (
    <section className="activity-layout">
      <div className="activity-list panel-surface"><div className="panel-toolbar"><div><div className="panel-title">业务活动清单</div><div className="panel-subtitle">来自文档的目标场景，不写入核心领域模型</div></div><button className="icon-button small" type="button" title="筛选活动"><Search size={15} /></button></div><div className="activity-items">{activities.map((activity) => <button className={`activity-item ${selectedActivityId === activity.id ? 'active' : ''}`} key={activity.id} type="button" onClick={() => onSelectActivity(activity.id)}><div className="activity-item-top"><span className={`activity-state ${activity.status}`}><i />{STATUS_LABELS[activity.status]}</span><span>{activity.coverage}%</span></div><strong>{activity.name}</strong><p>{activity.goal}</p><div className="coverage-track"><span style={{ width: `${activity.coverage}%` }} /></div></button>)}</div></div>
      <div className="activity-detail"><div className="section-label">活动验证</div><div className="activity-detail-heading"><div className={`activity-detail-icon ${selected.status}`}><Target size={21} /></div><div><h2>{selected.name}</h2><span>活动目标</span></div></div><p className="activity-goal">{selected.goal}</p><div className="support-score"><div><span>模型支撑度</span><strong>{selected.coverage}%</strong></div><div className="large-track"><span className={selected.status} style={{ width: `${selected.coverage}%` }} /></div></div><div className="mapping-section"><div className="section-label">已映射模型元素</div><div className="mapping-list">{selected.elements.map((element) => <div key={element}><Check size={14} /><span>{element}</span><ArrowRight size={13} /><small>{element === '容量校核' ? '能力' : '对象'}</small></div>)}</div></div>{selected.gap ? <div className="gap-callout"><CircleAlert size={17} /><div><strong>模型缺口</strong><p>{selected.gap}</p><button type="button">在对话中讨论 <ArrowRight size={13} /></button></div></div> : <div className="success-callout"><BadgeCheck size={17} /><div><strong>当前模型可以支撑此活动</strong><p>关键对象、关系和容量校核能力已具备。</p></div></div>}</div>
    </section>
  )
}

function AssessmentView({ activities, avgCoverage, onSelectActivity }) {
  const supported = activities.filter((activity) => activity.status === 'supported').length
  const partial = activities.filter((activity) => activity.status === 'partial').length
  const gaps = activities.filter((activity) => activity.status === 'gap').length
  return (
    <section className="assessment-view"><div className="assessment-summary"><div><div className="section-label">整体支撑度</div><div className="assessment-score"><strong>{avgCoverage}%</strong><span>基于 {activities.length} 个业务活动</span></div></div><button className="secondary-button" type="button"><RefreshCw size={15} />重新评估</button></div><div className="assessment-metrics"><MetricCard icon={BadgeCheck} label="可支撑" value={supported} tone="green" /><MetricCard icon={CircleAlert} label="部分支撑" value={partial} tone="amber" /><MetricCard icon={Target} label="存在缺口" value={gaps} tone="red" /><MetricCard icon={Box} label="已确认对象" value="3 / 5" tone="blue" /></div><div className="assessment-table panel-surface"><div className="panel-toolbar"><div><div className="panel-title">活动支撑矩阵</div><div className="panel-subtitle">点击一行查看缺口和模型调整建议</div></div><button className="view-control" type="button"><SlidersHorizontal size={14} />按支撑度排序</button></div><div className="matrix-head"><span>业务活动</span><span>关键模型元素</span><span>支撑度</span><span>结论</span></div>{activities.map((activity) => <button className="matrix-row" type="button" key={activity.id} onClick={() => onSelectActivity(activity.id)}><span className="matrix-name"><span className={`activity-state ${activity.status}`}><i /></span><strong>{activity.name}</strong></span><span className="matrix-elements">{activity.elements.slice(0, 3).join(' · ')}</span><span className="matrix-progress"><span><i className={activity.status} style={{ width: `${activity.coverage}%` }} /></span><strong>{activity.coverage}%</strong></span><span className={`matrix-conclusion ${activity.status}`}>{STATUS_LABELS[activity.status]} <ArrowRight size={14} /></span></button>)}</div></section>
  )
}

function MetricCard({ icon: Icon, label, value, tone }) {
  return <div className="metric-card"><div className={`metric-icon ${tone}`}><Icon size={17} /></div><div><span>{label}</span><strong>{value}</strong></div></div>
}

function ChatMessage({ message }) {
  return <div className={`chat-message ${message.role}`}><div className="message-avatar">{message.role === 'assistant' ? <Bot size={14} /> : '你'}</div><div className="message-bubble">{message.content}</div></div>
}

export default App

createRoot(document.getElementById('root')).render(<App />)
