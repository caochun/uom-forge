import type { Question } from './analysis.ts'
export function questionSection(questions: Question[]): string {
  if (!questions.length) return ''
  return (
    '## 待确认问题\n\n' +
    questions
      .map((question, index) => {
        const context = question.clarification
        return [
          `${index + 1}. ${question.text}`,
          context
            ? `来源：${context.source === 'model' ? '建模' : '评估'}\n依据：${context.basis}\n歧义：${context.ambiguity}\n影响：${context.impact}`
            : '',
          question.options.length
            ? `${question.multiple ? '多选' : '选项'}：${question.options.join('；')}`
            : '',
        ]
          .filter(Boolean)
          .join('\n')
      })
      .join('\n\n')
  )
}

export function withoutQuestionSection(narrative: string): string {
  // Remove only this section, preserving any later sections and their contents.
  return narrative
    .replace(
      /^##[ \t]+待确认问题[ \t]*\r?\n[\s\S]*?(?=^##[ \t]+|$(?![\s\S]))/gm,
      '',
    )
    .trimEnd()
}

export function extractQuestions(narrative: string): Question[] {
  const section = /^##\s+待确认问题[ \t]*\r?$/m.exec(narrative)
  if (!section) return []
  const text = narrative
    .slice(section.index + section[0].length)
    .split(/^##[ \t]+/m)[0]
  const questions: Question[] = []
  let current: Question | undefined
  let contextField: 'basis' | 'ambiguity' | 'impact' | undefined
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim().replace(/\\$/, '').replace(/\*\*/g, '').trim()
    const source = /^来源[:：]\s*(建模|评估)$/.exec(line)
    if (source && current) {
      contextField = undefined
      current.clarification = {
        source: source[1] === '建模' ? 'model' : 'assess',
        basis: '',
        ambiguity: '',
        impact: '',
      }
      continue
    }
    const detail = /^(依据|歧义|影响)[:：]\s*(.+)$/.exec(line)
    if (detail && current?.clarification) {
      const field =
        detail[1] === '依据'
          ? 'basis'
          : detail[1] === '歧义'
            ? 'ambiguity'
            : 'impact'
      current.clarification[field] = detail[2]
      contextField = field
      continue
    }
    const option = /^(?:[-*]\s*)?(选项|多选|可选答案)\s*[:：]\s*(.+)$/.exec(
      line,
    )
    if (option && current) {
      contextField = undefined
      // Semicolons are the delimiter; commas can be part of an answer.
      current.options = [
        ...new Set(
          option[2]
            .split(/[；;]/)
            .map((item) => item.trim())
            .filter(Boolean),
        ),
      ]
      if (option[1] === '多选') current.multiple = true
      continue
    }
    const item = /^(?:\d+[.)、]|[-*])\s+(.+)$/.exec(line)
    if (item) {
      contextField = undefined
      current = { text: item[1], options: [] }
      questions.push(current)
    } else if (current?.clarification && contextField && line) {
      current.clarification[contextField] += `\n${line}`
    } else if (current && line) current.text += `\n${line}`
  }
  return questions
}
