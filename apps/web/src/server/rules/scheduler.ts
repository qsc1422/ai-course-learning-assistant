import type { Importance, MasteryBand } from '../domain'
import { RULES } from './config'

export interface SchedulerKpInput {
  id: string
  chapterId: string
  chapterTitle: string
  kpName: string
  importance: Importance
  band: MasteryBand | null
  openMistakes: number
  solutionShown: number
  daysSincePractice: number
  classChapter: boolean
}

export interface ScheduledPick {
  kpId: string
  chapterId: string
  chapterTitle: string
  kpName: string
  priority: number
  kind: '错题重做' | '复述检验' | '知识点练习' | '课前预习'
  note: string
}

function bandWeight(band: MasteryBand | null): number {
  if (band === '薄弱') return RULES.priority.weak
  if (band === '一般') return RULES.priority.normal
  if (band === '稳固') return RULES.priority.solid
  return RULES.priority.unknown
}

export function priorityOf(input: SchedulerKpInput): number {
  return (
    bandWeight(input.band) +
    Math.min(input.openMistakes, RULES.priority.mistakeCap) * RULES.priority.mistakeUnit +
    input.solutionShown * RULES.priority.solutionUnit +
    input.daysSincePractice * RULES.priority.idleUnit
  )
}

export function dailyCapacity(remainingKps: number, remainingDays: number, cap = RULES.dailyCapacity): number {
  if (remainingKps <= 0) return 0
  if (remainingDays <= 0) return cap
  return Math.max(1, Math.min(cap, Math.ceil(remainingKps / remainingDays)))
}

export function rankKps(inputs: SchedulerKpInput[], capacity = RULES.dailyCapacity): ScheduledPick[] {
  const ranked = inputs
    .map((input) => ({
      input,
      priority: priorityOf(input) + (input.classChapter ? 3.0 : 0),
    }))
    .sort((a, b) => b.priority - a.priority || a.input.id.localeCompare(b.input.id))
    .slice(0, capacity)

  return ranked.map(({ input, priority }) => {
    let kind: ScheduledPick['kind'] = '知识点练习'
    let note = `该知识点当前掌握度为「${input.band ?? '样本不足'}」，安排一次练习。`
    if (input.openMistakes > 0) {
      kind = '错题重做'
      note = `有 ${input.openMistakes} 道错题未通过，这次先重做，再决定是否给提示。`
    } else if (input.solutionShown > 0) {
      kind = '复述检验'
      note = '上次依赖提示才完成，今天换你用自己的话讲一遍。'
    } else if (input.classChapter) {
      kind = '课前预习'
      note = '这节课对应的章节排在最前，先完成它。'
    }
    return {
      kpId: input.id,
      chapterId: input.chapterId,
      chapterTitle: input.chapterTitle,
      kpName: input.kpName,
      priority,
      kind,
      note,
    }
  })
}
