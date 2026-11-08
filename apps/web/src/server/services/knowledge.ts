import { newId } from '../ids'
import { q, q1, parseJson } from '../db'
import type { AiDraft, Chapter, KnowledgePoint, KpPayload, Preference } from '../domain'
import { logActivity } from '../activity'
import { createChapter } from './courses'

export interface DraftItem extends Omit<AiDraft, 'payload'> {
  payload: KpPayload
}

export async function listDrafts(chapterId: string): Promise<DraftItem[]> {
  const rows = await q<AiDraft>(
    `SELECT * FROM ai_drafts WHERE chapter_id = $1 AND type = 'knowledge_points'
     ORDER BY created_at, id`,
    [chapterId],
  )
  return rows.map((row) => ({ ...row, payload: parseJson<KpPayload>(row.payload, {} as KpPayload) }))
}

export async function listKnowledgePoints(chapterId: string): Promise<KnowledgePoint[]> {
  const rows = await q<KnowledgePoint>(
    'SELECT * FROM knowledge_points WHERE chapter_id = $1 ORDER BY created_at, name',
    [chapterId],
  )
  return rows.map((row) => ({ ...row, source_refs: parseJson<string[]>(row.source_refs, []) }))
}

export async function listCourseKnowledgePoints(courseId: string): Promise<KnowledgePoint[]> {
  const rows = await q<KnowledgePoint>(
    'SELECT * FROM knowledge_points WHERE course_id = $1 ORDER BY chapter_id, created_at',
    [courseId],
  )
  return rows.map((row) => ({ ...row, source_refs: parseJson<string[]>(row.source_refs, []) }))
}

async function upsertKp(
  draft: AiDraft,
  payload: KpPayload,
  status: 'adopted' | 'modified',
): Promise<void> {
  const existing = await q1<{ id: string }>('SELECT id FROM knowledge_points WHERE draft_id = $1', [
    draft.id,
  ])
  const refs = payload.evidence.map((item) => item.chunk_id)
  if (existing) {
    await q(
      `UPDATE knowledge_points
       SET name = $2, summary = $3, importance = $4, source_refs = $5, status = $6, needs_review = false
       WHERE id = $1`,
      [existing.id, payload.name, payload.summary, payload.importance, JSON.stringify(refs), status],
    )
    return
  }
  await q(
    `INSERT INTO knowledge_points (id, course_id, chapter_id, draft_id, name, summary, importance, source_refs, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      newId(),
      draft.course_id,
      draft.chapter_id,
      draft.id,
      payload.name,
      payload.summary,
      payload.importance,
      JSON.stringify(refs),
      status,
    ],
  )
}

export async function adoptDraft(draftId: string): Promise<void> {
  const draft = await q1<AiDraft>('SELECT * FROM ai_drafts WHERE id = $1', [draftId])
  if (!draft) throw new Error('草稿不存在')
  const payload = parseJson<KpPayload>(draft.payload, {} as KpPayload)
  await upsertKp(draft, payload, 'adopted')
  await q(`UPDATE ai_drafts SET status = 'adopted', updated_at = now() WHERE id = $1`, [draftId])
  await logActivity(draft.course_id, 'me', `采纳了知识点「${payload.name}」。`)
}

export async function modifyDraft(
  draftId: string,
  changes: { name?: string; summary?: string; importance?: KpPayload['importance'] },
): Promise<void> {
  const draft = await q1<AiDraft>('SELECT * FROM ai_drafts WHERE id = $1', [draftId])
  if (!draft) throw new Error('草稿不存在')
  const original = parseJson<KpPayload>(draft.payload, {} as KpPayload)
  const payload: KpPayload = {
    ...original,
    name: (changes.name ?? original.name).trim(),
    summary: (changes.summary ?? original.summary).trim(),
    importance: changes.importance ?? original.importance,
  }
  if (payload.name.length < 2) throw new Error('知识点名称至少 2 个字')
  if (payload.summary.length < 4) throw new Error('知识点说明至少 4 个字')

  const originalPayload = draft.original_payload ?? draft.payload
  await q(
    `UPDATE ai_drafts SET payload = $2, original_payload = $3, status = 'modified', updated_at = now() WHERE id = $1`,
    [draftId, JSON.stringify(payload), JSON.stringify(originalPayload)],
  )
  await upsertKp(draft, payload, 'modified')
  await logActivity(
    draft.course_id,
    'me',
    original.name === payload.name
      ? `修改了知识点「${payload.name}」的说明或重要程度。`
      : `把知识点「${original.name}」改为「${payload.name}」。`,
  )
}

export async function rejectDraft(draftId: string, note?: string): Promise<void> {
  const draft = await q1<AiDraft>('SELECT * FROM ai_drafts WHERE id = $1', [draftId])
  if (!draft) throw new Error('草稿不存在')
  const payload = parseJson<KpPayload>(draft.payload, {} as KpPayload)
  await q(`UPDATE ai_drafts SET status = 'rejected', note = $2, updated_at = now() WHERE id = $1`, [
    draftId,
    note ?? '学生驳回',
  ])
  await q('DELETE FROM knowledge_points WHERE draft_id = $1', [draftId])
  await logActivity(draft.course_id, 'me', `驳回了知识点「${payload.name}」，误驳回可以找回。`)
}

export async function restoreDraft(draftId: string): Promise<void> {
  const draft = await q1<AiDraft>('SELECT * FROM ai_drafts WHERE id = $1', [draftId])
  if (!draft) throw new Error('草稿不存在')
  if (draft.status !== 'rejected') throw new Error('只有被驳回的草稿可以找回')
  const payload = parseJson<KpPayload>(draft.payload, {} as KpPayload)
  await upsertKp(draft, payload, 'adopted')
  await q(`UPDATE ai_drafts SET status = 'adopted', updated_at = now() WHERE id = $1`, [draftId])
  await logActivity(draft.course_id, 'me', `找回了知识点「${payload.name}」。`)
}

export async function adoptAllDrafts(chapterId: string): Promise<void> {
  const chapter = await q1<Chapter>('SELECT * FROM chapters WHERE id = $1', [chapterId])
  if (!chapter) throw new Error('章节不存在')
  const drafts = await q<AiDraft>(
    `SELECT * FROM ai_drafts WHERE chapter_id = $1 AND status = 'draft' AND type = 'knowledge_points'`,
    [chapterId],
  )
  for (const draft of drafts) {
    const payload = parseJson<KpPayload>(draft.payload, {} as KpPayload)
    await upsertKp(draft, payload, 'adopted')
    await q(`UPDATE ai_drafts SET status = 'adopted', updated_at = now() WHERE id = $1`, [draft.id])
  }
  await q('UPDATE chapters SET status = $2 WHERE id = $1', [chapterId, '可练习'])
  await logActivity(chapter.course_id, 'me', `整章采纳了《${chapter.title}》的知识点，章节进入可练习。`)
}

export async function confirmChapter(chapterId: string): Promise<void> {
  const chapter = await q1<Chapter>('SELECT * FROM chapters WHERE id = $1', [chapterId])
  if (!chapter) throw new Error('章节不存在')
  const kp = await q1<{ count: string }>(
    'SELECT count(*)::text AS count FROM knowledge_points WHERE chapter_id = $1',
    [chapterId],
  )
  if (Number(kp?.count ?? 0) === 0) throw new Error('本章还没有采纳任何知识点，先处理 AI 草稿')
  await q('UPDATE chapters SET status = $2 WHERE id = $1', [chapterId, '可练习'])
  await logActivity(chapter.course_id, 'me', `确认《${chapter.title}》可用于练习。`)
}

export async function setChapterNotExam(chapterId: string, notExam: boolean): Promise<void> {
  const chapter = await q1<Chapter>('SELECT * FROM chapters WHERE id = $1', [chapterId])
  if (!chapter) throw new Error('章节不存在')
  const existing = await q1<Preference>(
    `SELECT * FROM preferences WHERE course_id = $1 AND kind = '本章不考' AND target_id = $2 ORDER BY created_at DESC LIMIT 1`,
    [chapter.course_id, chapterId],
  )
  if (existing) {
    await q('UPDATE preferences SET active = $2 WHERE id = $1', [existing.id, notExam])
  } else if (notExam) {
    await q(
      `INSERT INTO preferences (id, course_id, kind, target_id, note, active)
       VALUES ($1, $2, '本章不考', $3, '学生标记：本章不考', true)`,
      [newId(), chapter.course_id, chapterId],
    )
  }
  await logActivity(
    chapter.course_id,
    'me',
    notExam
      ? `把《${chapter.title}》标记为不考，不再抽题、不再计入掌握度。`
      : `撤销《${chapter.title}》的不考标记。`,
  )
}

export async function listPreferences(courseId: string): Promise<Preference[]> {
  return q<Preference>(
    'SELECT * FROM preferences WHERE course_id = $1 AND active = true ORDER BY created_at DESC',
    [courseId],
  )
}

export async function revokePreference(id: string): Promise<void> {
  const pref = await q1<Preference>('SELECT * FROM preferences WHERE id = $1', [id])
  if (!pref) throw new Error('偏好不存在')
  await q('UPDATE preferences SET active = false WHERE id = $1', [id])
  await logActivity(pref.course_id, 'me', `撤销了一条偏好（${pref.kind}）。`)
}

export async function notExamChapterIds(courseId: string): Promise<Set<string>> {
  const rows = await q<{ target_id: string }>(
    `SELECT target_id FROM preferences WHERE course_id = $1 AND kind = '本章不考' AND active = true AND target_id IS NOT NULL`,
    [courseId],
  )
  return new Set(rows.map((row) => row.target_id))
}

export async function ensureChapterTitle(courseId: string, title: string): Promise<Chapter> {
  const existing = await q1<Chapter>('SELECT * FROM chapters WHERE course_id = $1 AND title = $2', [
    courseId,
    title,
  ])
  if (existing) return existing
  return createChapter(courseId, title)
}
