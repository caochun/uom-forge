import DOMPurify from 'dompurify'
import type { BusinessDocument } from '../shared/analysis.ts'
export { readSse } from './api/sse.ts'

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
