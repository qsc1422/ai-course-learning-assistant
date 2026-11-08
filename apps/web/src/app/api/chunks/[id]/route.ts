import { run } from '@/server/api'
import { getChunkSource } from '@/server/services/materials'

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params
  return run(async () => {
    const source = await getChunkSource(id)
    if (!source) throw new Error('原文片段不存在')
    return { source }
  })
}
