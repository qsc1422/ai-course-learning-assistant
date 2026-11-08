import { run } from '@/server/api'
import { toggleTask } from '@/server/services/plan'

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params
  return run(async () => {
    const body = (await request.json()) as Record<string, unknown>
    await toggleTask(id, Boolean(body.done))
    return { taskId: id }
  })
}
