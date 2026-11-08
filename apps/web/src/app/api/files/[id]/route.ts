import { run, asString } from '@/server/api'
import { deleteFile, moveFile, retryParse } from '@/server/services/materials'

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params
  return run(async () => {
    const body = (await request.json()) as Record<string, unknown>
    const action = asString(body.action)
    if (action === 'move') {
      const chapterId = asString(body.chapterId)
      if (!chapterId) throw new Error('选择目标章节')
      await moveFile(id, chapterId)
    } else if (action === 'retry') {
      await retryParse(id)
    } else if (action === 'delete') {
      await deleteFile(id)
    } else {
      throw new Error('未知文件操作')
    }
    return { fileId: id }
  })
}
