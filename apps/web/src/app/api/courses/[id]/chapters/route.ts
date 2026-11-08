import { run, asString } from '@/server/api'
import { createChapter } from '@/server/services/courses'

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params
  return run(async () => {
    const body = (await request.json()) as Record<string, unknown>
    const title = asString(body.title).trim()
    if (!title) throw new Error('章节名称不能为空')
    const chapter = await createChapter(id, title)
    return { chapter }
  })
}
