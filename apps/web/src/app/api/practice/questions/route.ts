import { run, asString } from '@/server/api'
import { requestQuestions } from '@/server/services/practice'

export async function POST(request: Request) {
  return run(async () => {
    const body = (await request.json()) as Record<string, unknown>
    const kpId = asString(body.kpId)
    if (!kpId) throw new Error('缺少知识点')
    const jobId = await requestQuestions(kpId, Boolean(body.force))
    return { jobId }
  })
}
