import { run, asString } from '@/server/api'
import { uploadFile } from '@/server/services/materials'

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params
  return run(async () => {
    const form = await request.formData()
    const file = form.get('file') as File | null
    if (!file || typeof file.arrayBuffer !== 'function') throw new Error('请选择要上传的文件')
    const chapterId = asString(form.get('chapterId')) || null
    const result = await uploadFile(id, chapterId, file)
    return { fileId: result.file.id, duplicate: result.duplicate, parseStatus: result.file.parse_status }
  })
}
