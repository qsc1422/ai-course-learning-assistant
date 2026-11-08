import { signedFileUrl } from '@/server/storage'
import { q1 } from '@/server/db'

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const file = await q1('SELECT id FROM files WHERE id = $1', [id])
  if (!file) return Response.json({ ok: false, error: '文件不存在' }, { status: 404 })
  return Response.json({ ok: true, url: signedFileUrl(id) })
}
