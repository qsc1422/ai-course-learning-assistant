import { run, asString } from '@/server/api'
import { importTimetable, type TimetableRow } from '@/server/services/courses'

export async function POST(request: Request) {
  return run(async () => {
    const body = (await request.json()) as Record<string, unknown>
    const rows = Array.isArray(body.rows) ? (body.rows as TimetableRow[]) : []
    if (rows.length === 0) throw new Error('没有可导入的课程行')
    const mode = asString(body.mode) || 'ask'
    if (!['ask', 'merge', 'overwrite'].includes(mode)) throw new Error('未知导入方式')
    const result = await importTimetable(rows, mode as 'ask' | 'merge' | 'overwrite')
    return { ...result }
  })
}
