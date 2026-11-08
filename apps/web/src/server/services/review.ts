import { newId, today } from '../ids'
import { q, q1, parseJson } from '../db'
import type { ActivityEntry, Attempt, Chapter, ChapterMastery, Course, KnowledgePoint, Mistake, Narration } from '../domain'
import { chapterMastery, kpScore, type KpMasteryInput } from '../rules/mastery'
import { notExamChapterIds } from './knowledge'

export async function computeChapterMasteries(
  courseId: string,
  options: { snapshot?: boolean } = {},
): Promise<{ chapters: ChapterMastery[]; excluded: Chapter[] }> {
  const chapters = await q<Chapter>(
    'SELECT * FROM chapters WHERE course_id = $1 ORDER BY seq',
    [courseId],
  )
  const off = await notExamChapterIds(courseId)
  const kps = await q<KnowledgePoint>('SELECT * FROM knowledge_points WHERE course_id = $1', [courseId])
  const attempts = await q<Attempt>('SELECT * FROM attempts WHERE kp_id = ANY($1::text[])', [
    kps.map((kp) => kp.id).length ? kps.map((kp) => kp.id) : ['__none__'],
  ])
  const narrations = await q<Narration>(
    'SELECT * FROM narrations WHERE kp_id = ANY($1::text[]) ORDER BY created_at DESC',
    [kps.map((kp) => kp.id).length ? kps.map((kp) => kp.id) : ['__none__']],
  )
  const mistakes = await q<Mistake>('SELECT * FROM mistakes WHERE course_id = $1', [courseId])

  const result: ChapterMastery[] = []
  const excluded: Chapter[] = []
  for (const chapter of chapters) {
    if (off.has(chapter.id)) {
      excluded.push(chapter)
      continue
    }
    const chapterKps = kps.filter((kp) => kp.chapter_id === chapter.id)
    const inputs: KpMasteryInput[] = chapterKps.map((kp) => {
      const kpAttempts = attempts.filter((attempt) => attempt.kp_id === kp.id)
      const narration = narrations.find((item) => item.kp_id === kp.id) ?? null
      return {
        id: kp.id,
        name: kp.name,
        importance: kp.importance,
        attempts: kpAttempts.map((attempt) => ({
          independence: attempt.independence,
          result: attempt.result,
        })),
        narration: narration ? { status: narration.status, disagreed: narration.disagreed } : null,
        openMistake: mistakes.some((item) => item.kp_id === kp.id && item.status === '未通过'),
      }
    })
    const mastery = chapterMastery(chapter.id, chapter.title, inputs)
    result.push(mastery)

    if (options.snapshot && mastery.score != null) {
      await q(
        `INSERT INTO mastery_snapshots (id, course_id, chapter_id, score, band, sample_size, snap_date)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (chapter_id, snap_date) DO UPDATE SET score = $4, band = $5, sample_size = $6, computed_at = now()`,
        [newId(), courseId, chapter.id, mastery.score, mastery.band, mastery.sampleSize, today()],
      )
    }
  }

  return { chapters: result, excluded }
}

export interface MistakeRow {
  id: string
  kp_id: string
  kp_name: string
  chapter_title: string
  question_id: string
  wrong_count: number
  status: string
  last_attempt_at: string
}

export interface ReviewData {
  course: Course
  chapters: ChapterMastery[]
  excluded: Chapter[]
  openMistakes: MistakeRow[]
  clearedMistakes: MistakeRow[]
  trace: ActivityEntry[]
  hasData: boolean
  strongCount: number
  weakCount: number
  insufficientCount: number
}

export async function getReviewData(courseId: string): Promise<ReviewData | null> {
  const course = await q1<Course>('SELECT * FROM courses WHERE id = $1', [courseId])
  if (!course) return null

  const { chapters, excluded } = await computeChapterMasteries(courseId, { snapshot: true })
  const mistakes = await q<MistakeRow>(
    `SELECT m.id, m.kp_id, k.name AS kp_name, ch.title AS chapter_title, m.question_id,
            m.wrong_count, m.status, m.last_attempt_at
     FROM mistakes m
     JOIN knowledge_points k ON k.id = m.kp_id
     JOIN chapters ch ON ch.id = k.chapter_id
     WHERE m.course_id = $1
     ORDER BY m.status DESC, m.last_attempt_at DESC`,
    [courseId],
  )
  const trace = await q<ActivityEntry>(
    'SELECT * FROM activity_log WHERE course_id = $1 ORDER BY created_at DESC LIMIT 8',
    [courseId],
  )
  const kpCount = await q1<{ count: string }>(
    'SELECT count(*)::text AS count FROM knowledge_points WHERE course_id = $1',
    [courseId],
  )

  return {
    course,
    chapters,
    excluded,
    openMistakes: mistakes.filter((item) => item.status === '未通过'),
    clearedMistakes: mistakes.filter((item) => item.status === '已通过').slice(0, 6),
    trace,
    hasData: Number(kpCount?.count ?? 0) > 0,
    strongCount: chapters.filter((item) => item.band === '稳固').length,
    weakCount: chapters.filter((item) => item.band === '薄弱').length,
    insufficientCount: chapters.filter((item) => item.band === '样本不足').length,
  }
}

export interface TraceRow {
  id: string
  course_id: string
  course_name: string
  actor: string
  text: string
  created_at: string
}

export async function recentTrace(limit = 8): Promise<TraceRow[]> {
  return q<TraceRow>(
    `SELECT a.id, a.course_id, c.name AS course_name, a.actor, a.text, a.created_at
     FROM activity_log a JOIN courses c ON c.id = a.course_id
     ORDER BY a.created_at DESC LIMIT $1`,
    [limit],
  )
}

export function kpScoreOf(
  kp: KnowledgePoint,
  attempts: Attempt[],
  narration: Narration | null,
  openMistake: boolean,
): number {
  return kpScore({
    id: kp.id,
    name: kp.name,
    importance: kp.importance,
    attempts: attempts.map((attempt) => ({ independence: attempt.independence, result: attempt.result })),
    narration: narration ? { status: narration.status, disagreed: narration.disagreed } : null,
    openMistake,
  })
}

export function refsOf(kp: KnowledgePoint): string[] {
  return parseJson<string[]>(kp.source_refs, [])
}
