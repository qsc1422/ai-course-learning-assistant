import { run } from '@/server/api'
import { adoptAllDrafts, confirmChapter, setChapterNotExam } from '@/server/services/knowledge'

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params
  return run(async () => {
    const body = (await request.json()) as Record<string, unknown>
    const action = String(body.action ?? '')
    if (action === 'adopt-all') await adoptAllDrafts(id)
    else if (action === 'confirm') await confirmChapter(id)
    else if (action === 'not-exam') await setChapterNotExam(id, Boolean(body.notExam))
    else throw new Error('未知章节操作')
    return { chapterId: id }
  })
}
