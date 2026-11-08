import { run, asString } from '@/server/api'
import { revokePreference } from '@/server/services/knowledge'

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params
  return run(async () => {
    const body = (await request.json()) as Record<string, unknown>
    if (asString(body.action) !== 'revoke') throw new Error('未知偏好操作')
    await revokePreference(id)
    return { preferenceId: id }
  })
}
