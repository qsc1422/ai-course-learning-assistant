import { newId, today, daysSince } from '../ids'
import { q, q1, parseJson } from '../db'
import type { Attempt, Chapter, Course, DailyTask, KnowledgePoint, Mistake, Narration } from '../domain'
import { chapterMastery, kpScore, type KpMasteryInput } from '../rules/mastery'
import { dailyCapacity, rankKps, type SchedulerKpInput } from '../rules/scheduler'
import { RULES } from '../rules/config'
import { notExamChapterIds, listPreferences, revokePreference } from './knowledge'
import { computeChapterMasteries } from './review'

export interface CourseState {
  course: Course
  chapters: Chapter[]
  kps: KnowledgePoint[]
  attempts: Attempt[]
  narrations: Narration[]
  mistakes: Mistake[]
  off: Set<string>
  scores: Map<string, number>
  chapterBands: Map<string, string>
}

export async function loadCourseState(courseId: string): Promise<CourseState | null> {
  const course = await q1<Course>('SELECT * FROM courses WHERE id = $1', [courseId])
  if (!course) return null
  const chapters = await q<Chapter>('SELECT * FROM chapters WHERE course_id = $1 ORDER BY seq', [courseId])
  const kps = await q<KnowledgePoint>('SELECT * FROM knowledge_points WHERE course_id = $1', [courseId])
  if (kps.length === 0) {
    return {
      course,
      chapters,
      kps,
      attempts: [],
      narrations: [],
      mistakes: [],
      off: await notExamChapterIds(courseId),
      scores: new Map(),
      chapterBands: new Map(),
    }
  }
  const ids = kps.map((kp) => kp.id)
  const attempts = await q<Attempt>('SELECT * FROM attempts WHERE kp_id = ANY($1::text[])', [ids])
  const narrations = await q<Narration>(
    'SELECT * FROM narrations WHERE kp_id = ANY($1::text[]) ORDER BY created_at DESC',
    [ids],
  )
  const mistakes = await q<Mistake>('SELECT * FROM mistakes WHERE course_id = $1', [courseId])
  const off = await notExamChapterIds(courseId)

  const scores = new Map<string, number>()
  const chapterBands = new Map<string, string>()
  for (const chapter of chapters) {
    if (off.has(chapter.id)) continue
    const inputs: KpMasteryInput[] = []
    for (const kp of kps.filter((item) => item.chapter_id === chapter.id)) {
      const attemptList = attempts.filter((attempt) => attempt.kp_id === kp.id)
      const narration = narrations.find((item) => item.kp_id === kp.id) ?? null
      const input: KpMasteryInput = {
        id: kp.id,
        name: kp.name,
        importance: kp.importance,
        attempts: attemptList.map((attempt) => ({
          independence: attempt.independence,
          result: attempt.result,
        })),
        narration: narration ? { status: narration.status, disagreed: narration.disagreed } : null,
        openMistake: mistakes.some((item) => item.kp_id === kp.id && item.status === '未通过'),
      }
      scores.set(kp.id, kpScore(input))
      inputs.push(input)
    }
    const mastery = chapterMastery(chapter.id, chapter.title, inputs)
    chapterBands.set(chapter.id, mastery.band)
  }

  return { course, chapters, kps, attempts, narrations, mistakes, off, scores, chapterBands }
}

function isClassDay(course: Course): boolean {
  if (!course.next_class_at) return false
  const next = new Date(course.next_class_at)
  const formatted = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(next)
  return formatted === today()
}

export async function ensureDailyTasks(courseId: string): Promise<DailyTask[]> {
  const state = await loadCourseState(courseId)
  if (!state) return []
  const { course, chapters, kps, attempts, mistakes, off, scores, chapterBands } = state
  const activeKps = kps.filter((kp) => !off.has(kp.chapter_id))
  if (activeKps.length === 0) return []

  const classDay = isClassDay(course)
  const targetChapter =
    chapters
      .filter((chapter) => !off.has(chapter.id) && kps.some((kp) => kp.chapter_id === chapter.id))
      .sort((a, b) => a.seq - b.seq)
      .find((chapter) => chapterBands.get(chapter.id) !== '稳固')?.id ?? null

  const inputs: SchedulerKpInput[] = activeKps.map((kp) => {
    const kpAttempts = attempts.filter((attempt) => attempt.kp_id === kp.id)
    const openMistakes = mistakes.filter((item) => item.kp_id === kp.id && item.status === '未通过').length
    const solutionShown = kpAttempts.filter((attempt) => attempt.solution_shown).length
    const lastAttempt = kpAttempts[kpAttempts.length - 1]
    return {
      id: kp.id,
      chapterId: kp.chapter_id,
      chapterTitle: chapters.find((chapter) => chapter.id === kp.chapter_id)?.title ?? '',
      kpName: kp.name,
      importance: kp.importance,
      band: (chapterBands.get(kp.chapter_id) as SchedulerKpInput['band']) ?? null,
      openMistakes,
      solutionShown,
      daysSincePractice: daysSince(lastAttempt?.created_at ?? null),
      classChapter: classDay && kp.chapter_id === targetChapter,
    }
  })

  const remaining = activeKps.filter((kp) => (scores.get(kp.id) ?? 0) < RULES.bandThresholds.solid).length
  let candidates = inputs
  let capacity = RULES.dailyCapacity

  if (course.exam_date) {
    const remainingDays = Math.max(
      1,
      Math.round(
        (new Date(`${course.exam_date}T00:00:00`).getTime() - new Date(`${today()}T00:00:00`).getTime()) /
          86400000,
      ),
    )
    capacity = dailyCapacity(remaining, remainingDays)
  } else {
    const needsAttention = inputs.filter(
      (input) => input.openMistakes > 0 || input.solutionShown > 0 || input.classChapter,
    )
    candidates = needsAttention.length > 0 ? needsAttention : inputs
  }

  const picks = rankKps(candidates, capacity)
  for (const pick of picks) {
    await q(
      `INSERT INTO daily_tasks (id, course_id, task_date, kp_id, kind, title, note)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (course_id, task_date, kp_id) DO NOTHING`,
      [newId(), courseId, today(), pick.kpId, pick.kind, pick.kpName, pick.note],
    )
  }

  return q<DailyTask>(
    'SELECT * FROM daily_tasks WHERE course_id = $1 AND task_date = $2 ORDER BY created_at, id',
    [courseId, today()],
  )
}

export async function toggleTask(taskId: string, done: boolean): Promise<void> {
  const task = await q1<DailyTask>('SELECT * FROM daily_tasks WHERE id = $1', [taskId])
  if (!task) throw new Error('任务不存在')
  await q('UPDATE daily_tasks SET done = $2 WHERE id = $1', [taskId, done])
}

export interface TrendPoint {
  date: string
  score: number
}

export interface TrendSeries {
  chapterId: string
  title: string
  points: TrendPoint[]
}

export interface PlanData {
  course: Course
  tasks: DailyTask[]
  backlog: number
  completedToday: number
  trends: TrendSeries[]
  preferences: Awaited<ReturnType<typeof listPreferences>>
  mastery: Awaited<ReturnType<typeof computeChapterMasteries>>
  hasData: boolean
}

export async function getPlanData(courseId: string): Promise<PlanData | null> {
  const course = await q1<Course>('SELECT * FROM courses WHERE id = $1', [courseId])
  if (!course) return null

  const tasks = await ensureDailyTasks(courseId)
  const backlogRow = await q1<{ count: string }>(
    `SELECT count(*)::text AS count FROM daily_tasks WHERE course_id = $1 AND task_date < $2 AND done = false`,
    [courseId, today()],
  )
  const preferences = await listPreferences(courseId)
  const mastery = await computeChapterMasteries(courseId, { snapshot: true })
  const snapshots = await q<{ chapter_id: string; title: string; snap_date: string; score: number | null }>(
    `SELECT s.chapter_id, c.title, s.snap_date::text AS snap_date, s.score
     FROM mastery_snapshots s JOIN chapters c ON c.id = s.chapter_id
     WHERE s.course_id = $1 AND s.snap_date >= $2::date - interval '14 days'
     ORDER BY s.snap_date`,
    [courseId, today()],
  )

  const trends = mastery.chapters.map((chapter) => ({
    chapterId: chapter.chapterId,
    title: chapter.title,
    points: snapshots
      .filter((snapshot) => snapshot.chapter_id === chapter.chapterId && snapshot.score != null)
      .map((snapshot) => ({
        date: snapshot.snap_date.slice(5),
        score: Number(snapshot.score),
      })),
  }))

  return {
    course,
    tasks,
    backlog: Number(backlogRow?.count ?? 0),
    completedToday: tasks.filter((task) => task.done).length,
    trends,
    preferences,
    mastery,
    hasData: mastery.chapters.some((chapter) => chapter.sampleSize > 0),
  }
}

export { revokePreference }
