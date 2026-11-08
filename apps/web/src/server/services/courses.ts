import * as XLSX from 'xlsx'
import { q, q1, OWNER_ID } from '../db'
import { newId, semesterInfo, today, weekdayOf } from '../ids'
import type { Chapter, ClassSlot, Course } from '../domain'
import { logActivity } from '../activity'

export interface TimetableRow {
  name: string
  weekday: number | null
  startTime: string
  endTime: string
  weekRange: string
  room: string
  confidence: number
  note?: string
}

const WEEKDAY_CHARS: Record<string, number> = {
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  日: 7,
  天: 7,
}

function parseWeekday(value: string): number | null {
  const match = value.match(/(?:周|星期|礼拜)\s*([一二三四五六日天1-7])/)
  if (match) {
    const key = match[1]
    if (/[1-7]/.test(key)) return Number(key)
    return WEEKDAY_CHARS[key] ?? null
  }
  const digit = value.match(/^[1-7]$/)
  return digit ? Number(value) : null
}

function parseTimeRange(value: string): { start: string; end: string } | null {
  const match = value.match(/(\d{1,2})[:：](\d{2})\s*[-–—~至]\s*(\d{1,2})[:：](\d{2})/)
  if (!match) return null
  return {
    start: `${match[1].padStart(2, '0')}:${match[2]}`,
    end: `${match[3].padStart(2, '0')}:${match[4]}`,
  }
}

export async function parseTimetableFile(buffer: Buffer): Promise<TimetableRow[]> {
  let workbook: XLSX.WorkBook
  try {
    workbook = XLSX.read(buffer, { type: 'buffer' })
  } catch {
    throw new Error('文件无法识别，请导出为 XLSX 或 CSV 后重试')
  }
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  if (!sheet) throw new Error('表格中没有可读取的工作表')
  const matrix = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, raw: false, defval: '' })
  const rows = matrix.map((row) => row.map((cell) => String(cell ?? '').trim()))

  const headerIndex = rows.findIndex((row) =>
    row.some((cell) => /课程|科目/.test(cell)),
  )
  const hasHeader = headerIndex >= 0
  const header = hasHeader ? rows[headerIndex] : []
  const columns = {
    name: hasHeader ? header.findIndex((cell) => /课程|科目/.test(cell)) : 0,
    weekday: hasHeader ? header.findIndex((cell) => /星期|周几|日期/.test(cell)) : 1,
    time: hasHeader ? header.findIndex((cell) => /时间|时段|节次/.test(cell)) : 2,
    weeks: hasHeader ? header.findIndex((cell) => /周次|起止/.test(cell)) : 3,
    room: hasHeader ? header.findIndex((cell) => /教室|地点/.test(cell)) : 4,
    teacher: hasHeader ? header.findIndex((cell) => /教师|老师/.test(cell)) : 5,
  }
  const pick = (row: string[], index: number) => (index >= 0 ? row[index] ?? '' : '')

  const dataRows = hasHeader ? rows.slice(headerIndex + 1) : rows
  const result: TimetableRow[] = []
  for (const row of dataRows) {
    const name = pick(row, columns.name)
    if (!name || /课程|科目/.test(name)) continue
    const weekdayText = pick(row, columns.weekday)
    const timeText = pick(row, columns.time)
    const range = parseTimeRange(timeText)
    const weekday = parseWeekday(weekdayText)
    const weekRange = pick(row, columns.weeks) || '1–16 周'
    const room = pick(row, columns.room)

    const missing: string[] = []
    if (weekday == null) missing.push('星期')
    if (!range) missing.push('时段')
    if (!room) missing.push('教室')

    let confidence = 96
    if (missing.length > 0) confidence = Math.max(45, 96 - missing.length * 18)
    result.push({
      name,
      weekday,
      startTime: range?.start ?? '',
      endTime: range?.end ?? '',
      weekRange,
      room,
      confidence,
      note: missing.length ? `未能识别：${missing.join('、')}，请核对后补充` : undefined,
    })
  }

  if (result.length === 0) throw new Error('没有识别到课程行，请确认表格包含课程名称列')
  return result
}

export function computeNextClassAt(slots: Pick<ClassSlot, 'weekday' | 'start_time'>[]): string | null {
  if (slots.length === 0) return null
  const now = new Date()
  for (let offset = 0; offset < 15; offset += 1) {
    const date = new Date(now.getTime() + offset * 86400000)
    if (weekdayOf(date) !== slots[0]?.weekday && !slots.some((slot) => slot.weekday === weekdayOf(date))) continue
    for (const slot of slots) {
      if (slot.weekday !== weekdayOf(date)) continue
      const candidate = new Date(`${date.toISOString().slice(0, 10)}T${slot.start_time}:00`)
      if (candidate.getTime() > now.getTime()) return candidate.toISOString()
    }
  }
  return null
}

async function refreshNextClass(courseId: string): Promise<void> {
  const slots = await q<ClassSlot>(
    'SELECT weekday, start_time FROM class_slots WHERE course_id = $1 ORDER BY weekday, start_time',
    [courseId],
  )
  const next = computeNextClassAt(slots)
  await q('UPDATE courses SET next_class_at = $2 WHERE id = $1', [courseId, next])
}

export async function listCourses(): Promise<Course[]> {
  return q<Course>('SELECT * FROM courses WHERE owner_id = $1 ORDER BY created_at', [OWNER_ID])
}

export async function getCourse(id: string): Promise<Course | null> {
  return q1<Course>('SELECT * FROM courses WHERE id = $1 AND owner_id = $2', [id, OWNER_ID])
}

export async function listSlots(courseId: string): Promise<ClassSlot[]> {
  return q<ClassSlot>(
    'SELECT * FROM class_slots WHERE course_id = $1 ORDER BY weekday, start_time',
    [courseId],
  )
}

export async function listChapters(courseId: string): Promise<Chapter[]> {
  return q<Chapter>(
    'SELECT * FROM chapters WHERE course_id = $1 ORDER BY seq, created_at',
    [courseId],
  )
}

export async function createChapter(courseId: string, title: string): Promise<Chapter> {
  const seqRow = await q1<{ seq: string }>(
    'SELECT COALESCE(MAX(seq), 0)::text AS seq FROM chapters WHERE course_id = $1',
    [courseId],
  )
  const id = newId()
  const seq = Number(seqRow?.seq ?? 0) + 1
  await q('INSERT INTO chapters (id, course_id, title, seq, status) VALUES ($1, $2, $3, $4, $5)', [
    id,
    courseId,
    title,
    seq,
    '待整理',
  ])
  return { id, course_id: courseId, title, seq, status: '待整理' }
}

export interface CreateCourseInput {
  name: string
  code?: string
  teacher?: string
  room?: string
  weekday?: number | null
  startTime?: string
  endTime?: string
  weekRange?: string
  examDate?: string | null
}

export async function createCourse(input: CreateCourseInput): Promise<Course> {
  const id = newId()
  const semester = semesterInfo().label
  await q(
    `INSERT INTO courses (id, owner_id, name, code, teacher, semester, exam_date, room)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      id,
      OWNER_ID,
      input.name,
      input.code ?? null,
      input.teacher ?? null,
      semester,
      input.examDate || null,
      input.room ?? null,
    ],
  )
  if (input.weekday && input.startTime && input.endTime) {
    await q(
      `INSERT INTO class_slots (id, course_id, weekday, start_time, end_time, week_range, room, confidence)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 100)`,
      [
        newId(),
        id,
        input.weekday,
        input.startTime,
        input.endTime,
        input.weekRange ?? '1–16 周',
        input.room ?? null,
      ],
    )
    await refreshNextClass(id)
  }
  await logActivity(id, 'me', `新建课程《${input.name}》。`)
  return (await getCourse(id))!
}

export interface ImportResult {
  imported: number
  created: number
  merged: number
  conflicts?: string[]
}

export async function importTimetable(
  rows: TimetableRow[],
  mode: 'ask' | 'merge' | 'overwrite' = 'ask',
): Promise<ImportResult> {
  const groups = new Map<string, TimetableRow[]>()
  for (const row of rows) {
    const list = groups.get(row.name) ?? []
    list.push(row)
    groups.set(row.name, list)
  }

  const owners = await listCourses()
  const conflicts = [...groups.keys()].filter((name) => owners.some((course) => course.name === name))
  if (conflicts.length > 0 && mode === 'ask') {
    return { imported: 0, created: 0, merged: 0, conflicts }
  }

  let created = 0
  let merged = 0
  const semester = semesterInfo().label
  for (const [name, group] of groups) {
    const existing = owners.find((course) => course.name === name)
    if (existing) {
      if (mode === 'overwrite') {
        await q('DELETE FROM class_slots WHERE course_id = $1', [existing.id])
        await q('UPDATE courses SET semester = $2, room = $3 WHERE id = $1', [
          existing.id,
          semester,
          group.find((row) => row.room)?.room ?? existing.room,
        ])
      }
      for (const row of group) {
        if (!row.weekday || !row.startTime || !row.endTime) continue
        if (mode === 'merge') {
          const duplicate = await q1(
            `SELECT 1 FROM class_slots WHERE course_id = $1 AND weekday = $2 AND start_time = $3 LIMIT 1`,
            [existing.id, row.weekday, row.startTime],
          )
          if (duplicate) continue
        }
        await q(
          `INSERT INTO class_slots (id, course_id, weekday, start_time, end_time, week_range, room, confidence)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [newId(), existing.id, row.weekday, row.startTime, row.endTime, row.weekRange, row.room, row.confidence],
        )
      }
      await refreshNextClass(existing.id)
      merged += 1
    } else {
      const course = await createCourse({
        name,
        room: group.find((row) => row.room)?.room,
        weekday: group[0]?.weekday ?? null,
        startTime: group[0]?.startTime,
        endTime: group[0]?.endTime,
        weekRange: group[0]?.weekRange,
      })
      for (const row of group.slice(1)) {
        if (!row.weekday || !row.startTime || !row.endTime) continue
        await q(
          `INSERT INTO class_slots (id, course_id, weekday, start_time, end_time, week_range, room, confidence)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [newId(), course.id, row.weekday, row.startTime, row.endTime, row.weekRange, row.room, row.confidence],
        )
      }
      await refreshNextClass(course.id)
      created += 1
    }
  }

  return { imported: groups.size, created, merged }
}

export async function setExamDate(courseId: string, examDate: string | null): Promise<void> {
  await q('UPDATE courses SET exam_date = $2 WHERE id = $1', [courseId, examDate || null])
  const course = await getCourse(courseId)
  if (course) {
    await logActivity(
      courseId,
      'me',
      examDate ? `设定期末考试日期为 ${examDate}。` : '清除了期末考试日期。',
    )
  }
}

export function formatSlot(slot: ClassSlot): string {
  const week = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日'][slot.weekday] ?? ''
  return `${week} ${slot.start_time}–${slot.end_time}`
}

export function courseMeta(course: Course, slots: ClassSlot[]): {
  nextClass: string
  slotText: string
  daysToExam: number | null
} {
  const slotText = slots.map((slot) => formatSlot(slot)).join('；') || '未安排上课时间'
  const nextClass = course.next_class_at
    ? new Date(course.next_class_at).toLocaleString('zh-CN', {
        timeZone: 'Asia/Shanghai',
        month: 'numeric',
        day: 'numeric',
        weekday: 'short',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '未安排'
  const daysToExam = course.exam_date
    ? Math.round(
        (new Date(`${course.exam_date}T00:00:00`).getTime() -
          new Date(`${today()}T00:00:00`).getTime()) /
          86400000,
      )
    : null
  return { nextClass, slotText, daysToExam }
}
