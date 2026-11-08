import { run, asString } from '@/server/api'
import { createChapter, createCourse } from '@/server/services/courses'

export async function POST(request: Request) {
  return run(async () => {
    const body = (await request.json()) as Record<string, unknown>
    const name = asString(body.name).trim()
    if (!name) throw new Error('课程名称不能为空')
    const course = await createCourse({
      name,
      code: asString(body.code),
      teacher: asString(body.teacher),
      room: asString(body.room),
      weekday: body.weekday ? Number(body.weekday) : null,
      startTime: asString(body.startTime),
      endTime: asString(body.endTime),
      weekRange: asString(body.weekRange),
      examDate: asString(body.examDate) || null,
    })
    const chapters = Array.isArray(body.chapters)
      ? body.chapters.map((item) => asString(item).trim()).filter(Boolean)
      : []
    for (const title of chapters) {
      await createChapter(course.id, title)
    }
    return { course, courseId: course.id }
  })
}
