import type {
  ChapterMastery,
  Importance,
  Independence,
  MasteryBand,
  NarrationStatus,
} from '../domain'
import { RULES } from './config'

export interface KpMasteryInput {
  id: string
  name: string
  importance: Importance
  attempts: { independence: Independence; result: 'correct' | 'partial' | 'wrong' }[]
  narration: { status: NarrationStatus; disagreed: boolean } | null
  openMistake: boolean
}

export function clamp(value: number): number {
  return Math.max(0, Math.min(1, value))
}

export function kpScore(input: KpMasteryInput): number {
  const total = input.attempts.length
  const weighted = input.attempts.reduce(
    (sum, attempt) => sum + (RULES.attemptWeight[attempt.independence] ?? 0),
    0,
  )
  const attemptScore = total > 0 ? weighted / total : 0

  const narration = input.narration
  const useNarration =
    narration != null && !narration.disagreed && narration.status !== '未复述'
  const narrScore = useNarration
    ? (RULES.narrationScore as Record<string, number>)[narration.status] ?? 0
    : null

  const penalty = input.openMistake ? RULES.mistakePenalty : 0
  const score =
    narrScore != null
      ? 0.6 * attemptScore + RULES.narrationMix * narrScore - penalty
      : attemptScore - penalty

  return clamp(score)
}

export function bandOf(score: number): MasteryBand {
  if (score >= RULES.bandThresholds.solid) return '稳固'
  if (score >= RULES.bandThresholds.normal) return '一般'
  return '薄弱'
}

export function chapterMastery(
  chapterId: string,
  title: string,
  kps: KpMasteryInput[],
): ChapterMastery {
  const sampleSize = kps.reduce((sum, kp) => sum + kp.attempts.length, 0)
  const scored = kps.map((kp) => ({
    id: kp.id,
    name: kp.name,
    score: kpScore(kp),
    weight: RULES.importanceWeight[kp.importance],
  }))

  if (kps.length < RULES.sampleMinKps || sampleSize < RULES.sampleMinAttempts) {
    return {
      chapterId,
      title,
      score: null,
      band: '样本不足',
      sampleSize,
      kpCount: kps.length,
      weakKps: [],
    }
  }

  const weightSum = scored.reduce((sum, item) => sum + item.weight, 0)
  const score = weightSum > 0 ? scored.reduce((sum, item) => sum + item.weight * item.score, 0) / weightSum : 0
  const band = bandOf(score)
  const weakKps = scored
    .filter((item) => item.score < RULES.bandThresholds.normal)
    .sort((a, b) => a.score - b.score)
    .slice(0, 5)

  return {
    chapterId,
    title,
    score,
    band,
    sampleSize,
    kpCount: kps.length,
    weakKps,
  }
}
