import { run, asString } from '@/server/api'
import { submitNarration } from '@/server/services/practice'

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params
  return run(async () => {
    const body = (await request.json()) as Record<string, unknown>
    const result = await submitNarration(id, asString(body.text))
    return { ...result }
  })
}
