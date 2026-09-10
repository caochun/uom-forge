import DOMPurify from 'dompurify'
import type { AnalysisEvent, BusinessDocument } from '../shared/analysis.ts'
import { parseAnalysisEvent } from './responses.ts'

export function documentToHtml(content: string): string {
  if (content.trimStart().startsWith('<'))
    return DOMPurify.sanitize(content, { USE_PROFILES: { html: true } })
  const escapeHtml = (value: string) =>
    value
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;')
  const lines = content.split('\n')
  const blocks: string[] = []
  let paragraph: string[] = []
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

export function documentToBlocks(content: string): BusinessDocument['blocks'] {
  const html = documentToHtml(String(content || ''))
  if (typeof DOMParser === 'undefined') {
    return String(content || '')
      .split(/\n+/)
      .map((text, index) => ({ id: `block-${index + 1}`, text: text.trim() }))
      .filter((block) => block.text)
  }
  const root = new DOMParser().parseFromString(
    `<article>${html}</article>`,
    'text/html',
  ).body.firstElementChild
  return [...(root?.children || [])]
    .map((element, index) => ({
      id: `block-${index + 1}`,
      type: element.tagName.toLowerCase(),
      text: element.textContent?.replace(/\s+/g, ' ').trim() || '',
    }))
    .filter((block) => block.text)
}

export async function readSse(
  response: Response,
  onEvent: (event: AnalysisEvent) => void,
): Promise<void> {
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
      const data = event
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trim())
        .join('')
      if (data) onEvent(parseAnalysisEvent(JSON.parse(data) as unknown))
    }
    if (done) break
  }
  if (buffer.trim()) {
    const data = buffer
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim())
      .join('')
    if (data) onEvent(parseAnalysisEvent(JSON.parse(data) as unknown))
  }
}
