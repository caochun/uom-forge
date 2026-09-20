// Normalize presentation only. Keep inline text and citations as body content;
// a harmless trailing colon must not cause another full model generation.
export function normalizeSectionHeadings(markdown: string, titles: readonly string[]): string {
  const alternatives = titles.map(title => title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
  const heading = new RegExp(`^##[ \\t]+(?:\\d+[.)、][ \\t]*)?(${alternatives})(?:[ \\t]*[:：][ \\t]*(.*))?[ \\t]*$`)
  return markdown.split(/\r?\n/).map(line => {
    const match = heading.exec(line)
    if (!match) return line
    return `## ${match[1]}${match[2]?.trim() ? `\n${match[2]}` : ''}`
  }).join('\n')
}

export const MODEL_SECTIONS = [
  '模型概述', '对象及边界', '关系', '业务操作', '只读能力', '业务规则', '业务过程', '建模判断与边界',
] as const

export function normalizeModelPlan(plan: string): string {
  return normalizeSectionHeadings(plan, [...MODEL_SECTIONS, '需要补充的业务信息'])
}
