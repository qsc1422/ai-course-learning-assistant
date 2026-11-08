import type { Importance } from '../domain'

export const RULES = {
  importanceWeight: { 必背: 1.0, 理解: 0.8, 了解: 0.6 } as Record<Importance, number>,
  bandThresholds: { solid: 0.75, normal: 0.45 },
  sampleMinAttempts: 5,
  sampleMinKps: 3,
  dailyCapacity: 3,
  attemptWeight: { 独立答对: 1.0, 提示后答对: 0.5, 依赖提示通过: 0.5, 未答对: 0.0 },
  narrationScore: { 已讲清: 1.0, 有缺口: 0.7 },
  narrationMix: 0.4,
  mistakePenalty: 0.15,
  priority: { weak: 3, normal: 2, solid: 1, unknown: 2, mistakeCap: 3, mistakeUnit: 0.5, solutionUnit: 0.3, idleUnit: 0.1 },
}
