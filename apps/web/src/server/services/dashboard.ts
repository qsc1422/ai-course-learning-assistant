import { q, q1 } from '../db'
import type { ChapterMastery, Course, DailyTask } from '../domain'
import { listCourses } from './courses'
import { ensureDailyTasks } from './plan'
import { computeChapterMasteries, recentTrace, type TraceRow } from './review'
import { today } from '../ids'

export interface TodayTaskRow extends DailyTask {
  course_name: string
  chapter_title: string | null
}

export interface DashboardData {
  courses: Course[]
  tasks: TodayTaskRow[]
  totalToday: number
  doneToday: number
  pendingDrafts: number
  adoptedKps: number
  weekRate: number | null
  weekDone: number
  weekTotal: number
  trace: TraceRow[]
  focusCourse: Course | null
  focusMastery: ChapterMastery[]
  daysToExam: number | null
  examCourseName: string | null
  hasCourses: boolean
}

export async function getDashboard(): Promise<DashboardData> {
  const courses = await listCourses()
  for (const course of courses) {
    await ensureDailyTasks(course.id)
  }

  const tasks = await q<TodayTaskRow>(
    `SELECT t.*, c.name AS course_name, ch.title AS chapter_title
     FROM daily_tasks t
     JOIN courses c ON c.id = t.course_id
     LEFT JOIN knowledge_points kp ON kp.id = t.kp_id
     LEFT JOIN chapters ch ON ch.id = kp.chapter_id
     WHERE t.task_date = $1
     ORDER BY c.created_at, t.created_at`,
    [today()],
  )

  const doneToday = tasks.filter((task) => task.done).length
  const draftRow = await q1<{ count: string }>(
    `SELECT count(*)::text AS count FROM ai_drafts WHERE status = 'draft'`,
  )
  const kpRow = await q1<{ count: string }>(
    `SELECT count(*)::text AS count FROM knowledge_points`,
  )
  const weekRow = await q1<{ total: string; done: string }>(
    `SELECT count(*)::text AS total, count(*) FILTER (WHERE done)::text AS done
     FROM daily_tasks WHERE task_date >= $1::date - interval '6 days'`,
    [today()],
  )

  const focus =
    [...courses].sort((a, b) => {
      const aTasks = tasks.filter((task) => task.course_id === a.id && !task.done).length
      const bTasks = tasks.filter((task) => task.course_id === b.id && !task.done).length
      return bTasks - aTasks
    })[0] ?? null
  const focusMastery = focus ? (await computeChapterMasteries(focus.id, { snapshot: true })).chapters : []

  const exams = courses
    .filter((course) => course.exam_date)
    .map((course) => ({
      course,
      days: Math.round(
        (new Date(`${course.exam_date}T00:00:00`).getTime() - new Date(`${today()}T00:00:00`).getTime()) /
          86400000,
      ),
    }))
    .filter((item) => item.days >= 0)
    .sort((a, b) => a.days - b.days)

  const weekDone = Number(weekRow?.done ?? 0)
  const weekTotal = Number(weekRow?.total ?? 0)

  return {
    courses,
    tasks,
    totalToday: tasks.length,
    doneToday,
    pendingDrafts: Number(draftRow?.count ?? 0),
    adoptedKps: Number(kpRow?.count ?? 0),
    weekRate: weekTotal > 0 ? weekDone / weekTotal : null,
    weekDone,
    weekTotal,
    trace: await recentTrace(8),
    focusCourse: focus,
    focusMastery,
    daysToExam: exams[0]?.days ?? null,
    examCourseName: exams[0]?.course.name ?? null,
    hasCourses: courses.length > 0,
  }
}
