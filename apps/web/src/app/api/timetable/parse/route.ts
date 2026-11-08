import { run } from '@/server/api'
import { parseTimetableFile } from '@/server/services/courses'

export async function POST(request: Request) {
  return run(async () => {
    const form = await request.formData()
    const file = form.get('file') as File | null
    if (!file || typeof file.arrayBuffer !== 'function') throw new Error('请选择课表文件')
    if (file.size > 20 * 1024 * 1024) throw new Error('课表文件超过 20MB')
    const buffer = Buffer.from(await file.arrayBuffer())
    const rows = await parseTimetableFile(buffer)
    return { rows }
  })
}
