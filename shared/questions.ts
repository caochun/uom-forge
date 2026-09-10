import type { Question } from './analysis.ts'
export function extractQuestions(narrative: string): Question[] {
  const section = /^##\s+待确认问题[ \t]*\r?$/m.exec(narrative)
  if (!section) return []
  const text = narrative
    .slice(section.index + section[0].length)
    .split(/^##[ \t]+/m)[0]
  const questions: Question[] = []
  let current: Question | undefined
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim().replace(/\\$/, '').replace(/\*\*/g, '').trim()
    const option = /^(?:[-*]\s*)?(选项|多选|可选答案)\s*[:：]\s*(.+)$/.exec(
      line,
    )
    if (option && current) {
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
      current = { text: item[1], options: [] }
      questions.push(current)
    } else if (current && line) current.text += `\n${line}`
  }
  return questions
}
