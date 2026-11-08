import { describe, expect, it } from 'vitest'
import { chapterMastery, kpScore, bandOf } from '../mastery'
import { dailyCapacity, rankKps, type SchedulerKpInput } from '../scheduler'

function kp(overrides: Partial<Parameters<typeof kpScore>[0]> = {}) {
  return {
    id: 'k1',
    name: '图的基本术语',
    importance: '必背' as const,
    attempts: [
      { independence: '独立答对' as const, result: 'correct' as const },
      { independence: '提示后答对' as const, result: 'correct' as const },
    ],
    narration: { status: '已讲清' as const, disagreed: false },
    openMistake: false,
    ...overrides,
  }
}

describe('掌握度规则', () => {
  it('按公式计算知识点得分并截断到 0-1', () => {
    const score = kpScore(kp())
    expect(score).toBeCloseTo(0.6 * 0.75 + 0.4 * 1.0, 5)
  })

  it('复述被不认同时不参与计算', () => {
    const score = kpScore(kp({ narration: { status: '有缺口', disagreed: true } }))
    expect(score).toBeCloseTo(0.75, 5)
  })

  it('未通过错题扣 0.15 且不低于 0', () => {
    expect(kpScore(kp({ openMistake: true }))).toBeCloseTo(0.85 - 0.15, 5)
    expect(
      kpScore(
        kp({
          attempts: [{ independence: '未答对', result: 'wrong' }],
          narration: null,
          openMistake: true,
        }),
      ),
    ).toBe(0)
  })

  it('样本不足不输出档位', () => {
    const result = chapterMastery('c1', '第 1 章', [kp(), kp({ id: 'k2' })])
    expect(result.band).toBe('样本不足')
    expect(result.score).toBeNull()
  })

  it('章节档位按重要度加权', () => {
    const result = chapterMastery('c1', '第 1 章', [
      kp(),
      kp({ id: 'k2' }),
      kp({ id: 'k3' }),
    ])
    expect(result.band).toBe('稳固')
    expect(result.score).toBeGreaterThan(0.75)
  })

  it('档位阈值', () => {
    expect(bandOf(0.75)).toBe('稳固')
    expect(bandOf(0.449)).toBe('薄弱')
    expect(bandOf(0.45)).toBe('一般')
  })
})

describe('排期规则', () => {
  const base: SchedulerKpInput = {
    id: 'k1',
    chapterId: 'c1',
    chapterTitle: '第 1 章',
    kpName: '线性表',
    importance: '必背',
    band: '一般',
    openMistakes: 0,
    solutionShown: 0,
    daysSincePractice: 1,
    classChapter: false,
  }

  it('错题与薄弱章节排在最前', () => {
    const picks = rankKps(
      [
        base,
        { ...base, id: 'k2', band: '薄弱' },
        { ...base, id: 'k3', openMistakes: 2 },
      ],
      2,
    )
    expect(picks.map((p) => p.kpId)).toEqual(['k2', 'k3'])
  })

  it('上课章节强制置顶', () => {
    const picks = rankKps([{ ...base, id: 'k2', band: '薄弱' }, { ...base, id: 'k3', classChapter: true }], 1)
    expect(picks[0].kpId).toBe('k3')
    expect(picks[0].kind).toBe('课前预习')
  })

  it('未通过错题优先归为错题重做', () => {
    const picks = rankKps([{ ...base, openMistakes: 1 }], 1)
    expect(picks[0].kind).toBe('错题重做')
  })

  it('按剩余天数分配每日量且不超过容量', () => {
    expect(dailyCapacity(30, 5, 3)).toBe(3)
    expect(dailyCapacity(6, 10, 3)).toBe(1)
    expect(dailyCapacity(0, 10, 3)).toBe(0)
    expect(dailyCapacity(4, 0, 3)).toBe(3)
  })
})
