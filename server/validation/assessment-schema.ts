import { evidence } from './model-schema.ts'

export const ASSESSMENT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'processAssessments', 'recommendations', 'questions'],
  properties: {
    summary: { type: 'string' },
    processAssessments: {
      type: 'array',
      items: {
        type: 'object',
        required: [
          'processId',
          'processName',
          'status',
          'coveredElements',
          'gaps',
          'evidence',
        ],
        additionalProperties: false,
        properties: {
          processId: { type: 'string' },
          processName: { type: 'string' },
          status: { enum: ['supported', 'partial', 'missing'] },
          coveredElements: { type: 'array', items: { type: 'string' } },
          gaps: { type: 'array', items: { type: 'string' } },
          evidence,
        },
      },
    },
    recommendations: { type: 'array', items: { type: 'string' } },
    questions: { type: 'array', items: { type: 'string' } },
  },
}
