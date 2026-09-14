import type { BusinessDocument } from '../../shared/analysis.ts'
import { isRecord } from './values.ts'

export function validateDocument(
  value: unknown,
): asserts value is BusinessDocument {
  if (
    !isRecord(value) ||
    typeof value.name !== 'string' ||
    !Array.isArray(value.blocks) ||
    !value.blocks.length
  )
    throw new Error('请先上传包含正文的文档。')
  const ids = new Set<string>()
  let length = 0
  for (const block of value.blocks) {
    if (
      !isRecord(block) ||
      typeof block.id !== 'string' ||
      !block.id ||
      typeof block.text !== 'string' ||
      !block.text.trim() ||
      ids.has(block.id)
    )
      throw new Error('文档正文片段无效或重复，请重新导入。')
    ids.add(block.id)
    length += block.text.length
  }
  if (length > 120000)
    throw new Error(
      '本轮最多分析 12 万个正文字符，请将文档按章节拆分后导入。不会截断正文。',
    )
}

export function requireText(
  value: unknown,
  label: string,
): asserts value is string {
  if (typeof value !== 'string' || !value.trim())
    throw new Error(`请先提供${label}。`)
  if (value.length > 120000)
    throw new Error(`${label}超过 12 万个字符，请先拆分范围。不会截断输入。`)
}
