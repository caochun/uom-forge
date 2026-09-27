import { CLARIFICATION_SCHEMA } from './clarifications.ts'

const text = { type: 'string', minLength: 1, pattern: '\\S' }

export const ASSESSMENT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'caseAssessments', 'recommendations', 'clarifications'],
  properties: {
    summary: text,
    caseAssessments: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['caseId', 'scenario', 'basis', 'status', 'elements', 'explanation', 'gap', 'suggestion'],
        properties: {
          caseId: text,
          scenario: text,
          basis: text,
          status: { enum: ['supported', 'partial', 'missing', 'clarify'] },
          elements: { type: 'array', uniqueItems: true, items: text },
          explanation: text,
          gap: { type: 'string' },
          suggestion: { type: 'string' },
        },
      },
    },
    recommendations: { type: 'array', items: text },
    clarifications: { type: 'array', items: CLARIFICATION_SCHEMA },
  },
}
