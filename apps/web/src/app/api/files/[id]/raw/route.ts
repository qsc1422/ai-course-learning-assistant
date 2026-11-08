import { verifyFileSignature } from '@/server/storage'
import { readFileForDownload } from '@/server/services/materials'

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params
  const url = new URL(request.url)
  const expires = Number(url.searchParams.get('expires'))
  const sig = url.searchParams.get('sig') ?? ''
  if (!verifyFileSignature(id, expires, sig)) {
    return new Response('链接已过期或无效', { status: 403 })
  }
  const file = await readFileForDownload(id)
  if (!file) return new Response('文件不存在', { status: 404 })
  return new Response(new Uint8Array(file.buffer), {
    headers: {
      'content-type': file.mime || 'application/octet-stream',
      'content-disposition': `inline; filename="${encodeURIComponent(file.filename)}"`,
      'cache-control': 'private, max-age=300',
    },
  })
}
