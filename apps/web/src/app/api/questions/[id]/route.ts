import { run, asString, asInt } from '@/server/api'
import {
  feedbackQuestion,
  requestHint,
  submitAttempt,
  viewSolution,
} from '@/server/services/practice'

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params
  return run(async () => {
    const body = (await request.json()) as Record<string, unknown>
    const action = asString(body.action)

    if (action === 'attempt') {
      const result = await submitAttempt(id, asString(body.answer), asInt(body.durationMs))
      return { ...result }
    }
    if (action === 'hint') {
      const level = asInt(body.level, 1)
      if (level < 1 || level > 3) throw new Error('提示级别不合法')
      const result = await requestHint(id, level as 1 | 2 | 3, asString(body.wrongAnswer))
      return { ...result }
    }
    if (action === 'solution') {
      const result = await viewSolution(id)
      return { ...result }
    }
    if (action === 'feedback') {
      const kind = asString(body.kind)
      if (kind !== 'too-easy' && kind !== 'reject') throw new Error('未知反馈类型')
      await feedbackQuestion(id, kind)
      return { questionId: id }
    }
    throw new Error('未知题目操作')
  })
}
