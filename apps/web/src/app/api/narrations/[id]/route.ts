import { run, asString } from '@/server/api'
import { disagreeNarration } from '@/server/services/practice'

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params
  return run(async () => {
    const body = (await request.json()) as Record<string, unknown>
    if (asString(body.action) !== 'disagree') throw new Error('未知复述操作')
    await disagreeNarration(id)
    return { narrationId: id }
  })
}
