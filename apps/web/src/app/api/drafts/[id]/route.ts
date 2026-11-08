import { run, asString } from '@/server/api'
import { adoptDraft, modifyDraft, rejectDraft, restoreDraft } from '@/server/services/knowledge'

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params
  return run(async () => {
    const body = (await request.json()) as Record<string, unknown>
    const action = asString(body.action)
    if (action === 'adopt') await adoptDraft(id)
    else if (action === 'modify')
      await modifyDraft(id, {
        name: body.name != null ? asString(body.name) : undefined,
        summary: body.summary != null ? asString(body.summary) : undefined,
        importance: body.importance as '必背' | '理解' | '了解' | undefined,
      })
    else if (action === 'reject') await rejectDraft(id, asString(body.note) || undefined)
    else if (action === 'restore') await restoreDraft(id)
    else throw new Error('未知草稿操作')
    return { draftId: id }
  })
}
