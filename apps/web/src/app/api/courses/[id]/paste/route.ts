import { run, asString } from '@/server/api'
import { pasteText } from '@/server/services/materials'

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params
  return run(async () => {
    const body = (await request.json()) as Record<string, unknown>
    const chapterId = asString(body.chapterId)
    const text = asString(body.text)
    const filename = asString(body.filename) || '手写文字版'
    if (!chapterId) throw new Error('先选择要归入的章节')
    const result = await pasteText(id, chapterId, filename, text)
    return { fileId: result.file.id, duplicate: result.duplicate }
  })
}
