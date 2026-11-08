import path from 'node:path'
import { newId, sha256 } from '../ids'
import { q, q1, parseJson } from '../db'
import type { SourceFile } from '../domain'
import { readBuffer, removeBuffer, saveBuffer, signedFileUrl } from '../storage'
import { enqueue } from '../jobs/queue'
import { logActivity } from '../activity'

const ALLOWED = new Set(['pdf', 'pptx', 'docx', 'txt', 'md', 'png', 'jpg', 'jpeg', 'ppt', 'doc'])
export const MAX_FILE_SIZE = 50 * 1024 * 1024

function extensionOf(filename: string): string {
  return filename.toLowerCase().split('.').pop() ?? ''
}

export async function listFiles(courseId: string): Promise<(SourceFile & { chapter_title: string | null })[]> {
  return q(
    `SELECT f.*, c.title AS chapter_title
     FROM files f LEFT JOIN chapters c ON c.id = f.chapter_id
     WHERE f.course_id = $1 ORDER BY f.created_at DESC`,
    [courseId],
  )
}

export async function countDrafts(courseId: string): Promise<number> {
  const row = await q1<{ count: string }>(
    `SELECT count(*)::text AS count FROM ai_drafts WHERE course_id = $1 AND status = 'draft'`,
    [courseId],
  )
  return Number(row?.count ?? 0)
}

export async function uploadFile(
  courseId: string,
  chapterId: string | null,
  file: File,
): Promise<{ file: SourceFile; duplicate: boolean }> {
  const filename = file.name || '未命名文件'
  const ext = extensionOf(filename)
  if (!ALLOWED.has(ext)) {
    throw new Error(`不支持的文件类型 .${ext || 'unknown'}，请上传 PDF / PPTX / DOCX / TXT / MD / 图片`)
  }
  if (file.size > MAX_FILE_SIZE) throw new Error('文件超过 50MB 限制')

  const buffer = Buffer.from(await file.arrayBuffer())
  const sha = sha256(buffer)
  const chapter = chapterId
    ? await q1<{ id: string }>('SELECT id FROM chapters WHERE id = $1 AND course_id = $2', [
        chapterId,
        courseId,
      ])
    : null
  if (chapterId && !chapter) throw new Error('章节不存在或不属于该课程')

  const duplicate = await q1<SourceFile>(
    'SELECT * FROM files WHERE course_id = $1 AND sha256 = $2',
    [courseId, sha],
  )
  if (duplicate) {
    if (chapterId && duplicate.chapter_id !== chapterId) {
      await moveFile(duplicate.id, chapterId)
    }
    return { file: duplicate, duplicate: true }
  }

  const id = newId()
  const key = saveBuffer(id, buffer)
  const status = '未解析'
  await q(
    `INSERT INTO files (id, course_id, chapter_id, storage_key, filename, mime, size, sha256, parse_status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [id, courseId, chapterId, key, filename, file.type || 'application/octet-stream', file.size, sha, status],
  )
  await enqueue('parse_file', { fileId: id }, `parse:${id}:v1`)
  await logActivity(courseId, 'me', `上传资料《${filename}》。`)
  return {
    file: (await q1<SourceFile>('SELECT * FROM files WHERE id = $1', [id]))!,
    duplicate: false,
  }
}

export async function pasteText(
  courseId: string,
  chapterId: string,
  filename: string,
  text: string,
): Promise<{ file: SourceFile; duplicate: boolean }> {
  if (text.trim().length < 30) throw new Error('文字版内容过短，至少需要 30 个字符')
  const buffer = Buffer.from(text, 'utf8')
  const sha = sha256(buffer)
  const existing = await q1<SourceFile>(
    'SELECT * FROM files WHERE course_id = $1 AND sha256 = $2',
    [courseId, sha],
  )
  if (existing) return { file: existing, duplicate: true }

  const id = newId()
  const key = saveBuffer(id, buffer)
  await q(
    `INSERT INTO files (id, course_id, chapter_id, storage_key, filename, mime, size, sha256, parse_status)
     VALUES ($1, $2, $3, $4, $5, 'text/plain', $6, $7, '未解析')`,
    [id, courseId, chapterId, key, filename.endsWith('.txt') ? filename : `${filename}.txt`, buffer.length, sha],
  )
  await enqueue('parse_file', { fileId: id }, `parse:${id}:v1`)
  await logActivity(courseId, 'me', `为章节补充文字版《${filename}》。`)
  return { file: (await q1<SourceFile>('SELECT * FROM files WHERE id = $1', [id]))!, duplicate: false }
}

export async function retryParse(fileId: string): Promise<void> {
  const file = await q1<SourceFile>('SELECT * FROM files WHERE id = $1', [fileId])
  if (!file) throw new Error('文件不存在')
  await q('UPDATE files SET parse_status = $2, parse_note = NULL WHERE id = $1', [fileId, '未解析'])
  await enqueue('parse_file', { fileId })
}

export async function moveFile(fileId: string, chapterId: string): Promise<void> {
  const file = await q1<SourceFile>('SELECT * FROM files WHERE id = $1', [fileId])
  if (!file) throw new Error('文件不存在')
  const chapter = await q1<{ id: string; title: string; course_id: string }>(
    'SELECT id, title, course_id FROM chapters WHERE id = $1 AND course_id = $2',
    [chapterId, file.course_id],
  )
  if (!chapter) throw new Error('目标章节不存在')

  const chunkIds = await q<{ id: string }>('SELECT id FROM chunks WHERE file_id = $1', [fileId])
  await markNeedsReview(file.course_id, chunkIds.map((chunk) => chunk.id))

  await q('UPDATE files SET chapter_id = $2 WHERE id = $1', [fileId, chapterId])
  await q('UPDATE chunks SET chapter_id = $2 WHERE file_id = $1', [fileId, chapterId])
  await logActivity(file.course_id, 'me', `把《${file.filename}》移到「${chapter.title}」，相关知识点已标记需复核。`)
}

async function markNeedsReview(courseId: string, chunkIds: string[]): Promise<void> {
  if (chunkIds.length === 0) return
  const kps = await q<{ id: string; source_refs: unknown }>(
    'SELECT id, source_refs FROM knowledge_points WHERE course_id = $1',
    [courseId],
  )
  for (const kp of kps) {
    const refs = parseJson<string[]>(kp.source_refs, [])
    if (refs.some((ref) => chunkIds.includes(ref))) {
      await q('UPDATE knowledge_points SET needs_review = true WHERE id = $1', [kp.id])
    }
  }
}

export async function deleteFile(fileId: string): Promise<void> {
  const file = await q1<SourceFile>('SELECT * FROM files WHERE id = $1', [fileId])
  if (!file) throw new Error('文件不存在')
  const chunks = await q<{ id: string }>('SELECT id FROM chunks WHERE file_id = $1', [fileId])
  await markNeedsReview(file.course_id, chunks.map((chunk) => chunk.id))
  await q('DELETE FROM files WHERE id = $1', [fileId])
  removeBuffer(file.storage_key)
  await logActivity(file.course_id, 'me', `删除了资料《${file.filename}》，相关知识点已标记需复核。`)
}

export async function readFileForDownload(fileId: string): Promise<{
  filename: string
  mime: string
  buffer: Buffer
} | null> {
  const file = await q1<SourceFile>('SELECT * FROM files WHERE id = $1', [fileId])
  if (!file) return null
  try {
    return { filename: file.filename, mime: file.mime, buffer: readBuffer(file.storage_key) }
  } catch {
    return null
  }
}

export async function getChunkSource(chunkId: string): Promise<{
  id: string
  content: string
  page_no: number
  filename: string
  file_id: string
  file_url: string
} | null> {
  const row = await q1<{
    id: string
    content: string
    page_no: number
    filename: string
    file_id: string
  }>(
    `SELECT c.id, c.content, c.page_no, f.filename, f.id AS file_id
     FROM chunks c JOIN files f ON f.id = c.file_id WHERE c.id = $1`,
    [chunkId],
  )
  if (!row) return null
  return { ...row, file_url: signedFileUrl(row.file_id) }
}

export async function markDraftsReviewed(chapterId: string): Promise<void> {
  await q('UPDATE ai_drafts SET status = $2, updated_at = now() WHERE chapter_id = $1 AND status = $3', [
    chapterId,
    'adopted',
    'draft',
  ])
}

export function safeFilename(filename: string): string {
  return path.basename(filename).replace(/[^\w\u4e00-\u9fa5.\-() ]/g, '_')
}

export function parseNoteOf(file: SourceFile): string | null {
  if (!file.parse_note) return null
  return file.parse_note
}

export function fileAge(createdAt: string): string {
  const date = new Date(createdAt)
  return `${date.getMonth() + 1}月${date.getDate()}日 ${String(date.getHours()).padStart(2, '0')}:${String(
    date.getMinutes(),
  ).padStart(2, '0')}`
}
