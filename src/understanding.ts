import type {
  Understanding,
  Question,
  BusinessClarification,
} from '../shared/analysis.ts'
import { withoutQuestionSection, questionSection } from '../shared/questions.ts'
import { questionKey } from '../shared/clarifications.ts'
import type {
  Project,
  QuestionAnswer,
  QuestionAnswers,
  ReviewedUnderstanding,
} from './types.ts'
import { advanceRevision } from './workspace.ts'

export function answerText(answer: QuestionAnswer | undefined): string {
  return (Array.isArray(answer) ? answer.join('；') : answer || '').trim()
}

function normalizeAnswer(value: QuestionAnswer | undefined): QuestionAnswer {
  return Array.isArray(value)
    ? [...new Set(value.map((item) => item.trim()).filter(Boolean))].sort()
    : value?.trim() || ''
}

export function sameAnswer(
  left: QuestionAnswer | undefined,
  right: QuestionAnswer | undefined,
): boolean {
  return (
    answerText(normalizeAnswer(left)) === answerText(normalizeAnswer(right))
  )
}

function normalizeAnswers(
  questions: Question[],
  answers: QuestionAnswers,
): QuestionAnswers {
  const result: QuestionAnswers = {}
  questions.forEach((_, index) => {
    const normalized = normalizeAnswer(answers[index])
    if (answerText(normalized)) result[index] = normalized
  })
  return result
}

export function reviseUnderstanding(
  source: Understanding,
  answers: QuestionAnswers = {},
): ReviewedUnderstanding {
  const confirmedAnswers = normalizeAnswers(source.questions, answers)
  const pending = source.questions.filter(
    (_, index) => !answerText(confirmedAnswers[index]),
  )
  const confirmed = source.questions.flatMap((question, index) => {
    const answer = answerText(confirmedAnswers[index])
    return answer ? [`### ${question.text}\n\n已确认说明：${answer}`] : []
  })
  if (!confirmed.length) return { ...source, source, confirmedAnswers }
  const narrative = [
    withoutQuestionSection(source.narrative),
    '## 已确认的业务说明\n\n以下是用户保存的业务说明修订，补充并替代前文对应的“材料未说明”“推断”或“待确认”表述。未涉及的业务边界保持原有判断。',
    confirmed.join('\n\n'),
    questionSection(pending),
  ]
    .filter(Boolean)
    .join('\n\n')
  return { ...source, source, narrative, questions: pending, confirmedAnswers }
}

// Discovered ambiguities join the same catalogue; they are not business answers
// and do not invalidate the candidate until the user revises the understanding.
export function receiveClarifications(
  project: Project,
  items: BusinessClarification[],
  source: 'model' | 'assess',
): Project {
  if (
    !project.understanding ||
    project.revisions.understoodDocument !== project.revisions.document
  )
    return project
  const understanding = project.understanding
  const questions = [...understanding.source.questions]
  const known = new Set(questions.map((question) => questionKey(question.text)))
  for (const item of items) {
    const key = questionKey(item.text)
    if (known.has(key)) continue
    known.add(key)
    questions.push({
      text: item.text,
      options: item.options,
      multiple: item.multiple,
      clarification: {
        source,
        basis: item.basis,
        ambiguity: item.ambiguity,
        impact: item.impact,
      },
    })
  }
  if (questions.length === understanding.source.questions.length) return project
  const reading = {
    ...understanding.source,
    questions,
    narrative: [
      withoutQuestionSection(understanding.source.narrative),
      questionSection(questions),
    ]
      .filter(Boolean)
      .join('\n\n'),
  }
  return {
    ...project,
    understanding: reviseUnderstanding(reading, understanding.confirmedAnswers),
  }
}

export function hasUnsavedAnswers(
  project: Pick<Project, 'understanding' | 'answers'>,
): boolean {
  if (!project.understanding) return false
  const { source, confirmedAnswers } = project.understanding
  return (
    JSON.stringify(normalizeAnswers(source.questions, project.answers)) !==
    JSON.stringify(confirmedAnswers)
  )
}

export function saveUnderstandingAnswers(project: Project): Project {
  if (
    !project.understanding ||
    project.revisions.understoodDocument !== project.revisions.document
  )
    return project
  const understanding = reviseUnderstanding(
    project.understanding.source,
    project.answers,
  )
  return {
    ...project,
    understanding,
    questionsSaved: true,
    revisions:
      understanding.narrative === project.understanding.narrative
        ? project.revisions
        : advanceRevision(project.revisions, 'business'),
  }
}
