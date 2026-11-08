import { run } from '@/server/api'
import { enqueue } from '@/server/jobs/queue'

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params
  return run(async () => {
    const jobId = await enqueue('extract_kp', { chapterId: id })
    return { jobId }
  })
}
