import type { ModelingResult } from '../shared/analysis.ts'
import type { Project } from './types.ts'
import { artifactVersion } from '../shared/workflow.ts'
import { freshness } from './workspace.ts'

export function resumeNarrative(project: Project): string {
  // Newly discovered questions can extend the catalogue without changing the
  // business revision. Resume with the saved basis, not that appended text.
  return project.plan?.basis?.narrative || project.understanding?.narrative || ''
}

export function prepareModelResume(project: Project, step: 'verify' | 'map'): ModelingResult {
  if (!project.candidate || !project.plan?.compiled || !project.understanding || freshness(project.revisions).candidate)
    throw new Error('当前候选的业务依据已变化，请先重新建模。')
  const candidate = project.candidate
  const prior = candidate.expressionReview
  if (step === 'map' && candidate.edited) throw new Error('模型已修改，请先重新检查，再建立映射。')
  const review = prior ? structuredClone(prior) : {
    status: 'incomplete' as const, snapshots: [{ model: candidate.model }], selectedSnapshot: 0,
    changes: [], warnings: [],
    lineage: {
      narrativeVersion: artifactVersion(resumeNarrative(project)), planVersion: artifactVersion(project.plan.plan),
      compiledModelVersion: artifactVersion(candidate.model),
      candidateVersion: artifactVersion(candidate.model),
    },
  }
  if (candidate.edited && prior) {
    review.snapshots.push({ model: candidate.model })
    review.selectedSnapshot = review.snapshots.length - 1
    review.status = 'incomplete'
    review.lineage = {
      narrativeVersion: artifactVersion(resumeNarrative(project)), planVersion: artifactVersion(project.plan.plan),
      compiledModelVersion: prior.lineage?.compiledModelVersion || artifactVersion(prior.snapshots[0].model),
      candidateVersion: artifactVersion(candidate.model),
    }
  }
  return {
    semanticPlan: project.plan.plan, model: candidate.model, expressionReview: review,
    semantic: project.plan.semantic, clarifications: [],
    provenance: { basis: 'business-understanding', evidence: 'unlinked' },
    validation: { elements: 0, warnings: project.plan.warnings || [] },
  }
}
