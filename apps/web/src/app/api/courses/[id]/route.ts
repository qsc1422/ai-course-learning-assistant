import { run, asString } from '@/server/api'
import { setExamDate } from '@/server/services/courses'

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params
  return run(async () => {
    const body = (await request.json()) as Record<string, unknown>
    await setExamDate(id, asString(body.examDate) || null)
    return { courseId: id }
  })
}
