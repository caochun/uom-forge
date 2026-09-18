import { CLARIFICATION_SCHEMA } from './clarifications.ts'
const evidence = { type: 'array', maxItems: 0 }

const text = { type: 'string', minLength: 1, pattern: '\\S' }
const status = { enum: ['supported', 'partial', 'missing'] }

export const ASSESSMENT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'summary',
    'processAssessments',
    'recommendations',
    'clarifications',
  ],
  properties: {
    summary: text,
    processAssessments: {
      type: 'array',
      items: {
        type: 'object',
        required: ['processId', 'processName', 'reason', 'requirements'],
        additionalProperties: false,
        properties: {
          processId: text,
          processName: text,
          reason: text,
          requirements: {
            type: 'array',
            minItems: 1,
            items: {
              type: 'object',
              additionalProperties: false,
              required: [
                'requirement',
                'status',
                'elements',
                'explanation',
                'gap',
                'suggestion',
              ],
              properties: {
                requirement: text,
                status,
                elements: { type: 'array', uniqueItems: true, items: text },
                explanation: text,
                gap: { type: 'string' },
                suggestion: { type: 'string' },
                evidence,
              },
            },
          },
          evidence,
          // Models routinely emit a process-level status even though the
          // server recomputes it from the requirements. Accept and ignore it
          // instead of failing the whole assessment over a discarded field.
          status,
        },
      },
    },
    recommendations: { type: 'array', items: { type: 'string' } },
    clarifications: { type: 'array', items: CLARIFICATION_SCHEMA },
  },
}
