import { run } from '@/server/api'
import { getJob } from '@/server/jobs/queue'

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params
  return run(async () => {
    const job = await getJob(id)
    if (!job) throw new Error('任务不存在')
    return { job: { id: job.id, status: job.status, attempts: job.attempts, error: job.error, result: job.result } }
  })
}
