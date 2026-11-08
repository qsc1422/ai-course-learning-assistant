import { newId } from '../ids'
import { parseJson, q, q1 } from '../db'
import type { AiDraft, SourceFile } from '../domain'
import { chunkPages } from '../pipeline/chunk'
import { embedText, toVectorLiteral } from '../pipeline/embed'
import { parseFile } from '../pipeline/parse'
import { readBuffer } from '../storage'
import { getProvider } from '../ai'
import { logActivity } from '../activity'
import { normalizeText } from '../ai/text'

export interface ParsePayload {
  fileId: string
}

export interface ExtractPayload {
  chapterId: string
}

export interface QuestionPayload {
  kpId: string
  force?: boolean
}

export async function handleParseFile(payload: ParsePayload): Promise<unknown> {
  const file = await q1<SourceFile & { filename: string; mime: string }>(
    'SELECT * FROM files WHERE id = $1',
    [payload.fileId],
  )
  if (!file) throw new Error('文件记录不存在')

  await q('UPDATE files SET parse_status = $2, parse_note = NULL WHERE id = $1', [file.id, '解析中'])

  let result
  try {
    result = await parseFile(file.filename, file.mime, readBuffer(file.storage_key))
  } catch (error) {
    const note = error instanceof Error ? error.message : '解析过程异常'
    await q('UPDATE files SET parse_status = $2, parse_note = $3 WHERE id = $1', [
      file.id,
      '解析失败',
      note,
    ])
    await logActivity(file.course_id, 'ai', `《${file.filename}》解析失败：${note}`)
    return { ok: false, note }
  }

  if (result.failed || result.pages.every((page) => page.text.trim().length === 0)) {
    const note = result.note ?? '未解析出可用正文，建议补充文字版'
    await q('UPDATE files SET parse_status = $2, parse_note = $3, page_count = $4 WHERE id = $1', [
      file.id,
      '解析失败',
      note,
      result.pageCount,
    ])
    await logActivity(file.course_id, 'ai', `《${file.filename}》未解析出可用正文`)
    return { ok: false, note }
  }

  const chunks = chunkPages(result.pages)
  const charCount = result.pages.reduce((sum, page) => sum + page.text.length, 0)
  const avgPerPage = result.pageCount > 0 ? charCount / result.pageCount : 0
  const notes: string[] = []
  if (result.note) notes.push(result.note)
  if (avgPerPage < 300) notes.push('可用内容较少，建议补充文字版')

  await q('DELETE FROM chunks WHERE file_id = $1', [file.id])

  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index]
    const vector = await embedText(chunk.content)
    await q(
      `INSERT INTO chunks (id, file_id, chapter_id, page_no, seq, content, source_type, embedding)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::vector)`,
      [
        newId(),
        file.id,
        file.chapter_id,
        chunk.page,
        index,
        chunk.content,
        'text',
        toVectorLiteral(vector),
      ],
    )
  }

  await q(
    'UPDATE files SET parse_status = $2, parse_note = $3, char_count = $4, page_count = $5 WHERE id = $1',
    [file.id, '已解析', notes.length ? notes.join('；') : null, charCount, result.pageCount],
  )
  await logActivity(
    file.course_id,
    'ai',
    `已解析《${file.filename}》：${result.pageCount} 页，切分为 ${chunks.length} 个片段。`,
  )
  return { ok: true, chunks: chunks.length, pageCount: result.pageCount }
}

export async function handleExtractKnowledgePoints(payload: ExtractPayload): Promise<unknown> {
  const chapter = await q1<{ id: string; title: string; course_id: string }>(
    'SELECT id, title, course_id FROM chapters WHERE id = $1',
    [payload.chapterId],
  )
  if (!chapter) throw new Error('章节不存在')

  const off = await q1(
    `SELECT 1 FROM preferences WHERE course_id = $1 AND kind = '本章不考' AND target_id = $2 AND active = true LIMIT 1`,
    [chapter.course_id, chapter.id],
  )
  if (off) throw new Error('本章已标记为不考，已跳过提取')

  const chunks = await q<{ id: string; content: string; page_no: number; filename: string }>(
    `SELECT c.id, c.content, c.page_no, f.filename
     FROM chunks c JOIN files f ON f.id = c.file_id
     WHERE c.chapter_id = $1 AND f.parse_status = '已解析'
     ORDER BY c.page_no, c.seq`,
    [chapter.id],
  )

  if (chunks.length === 0) {
    throw new Error('该章节还没有解析完成的资料，先上传或粘贴文字版')
  }

  const provider = getProvider()
  const points = await provider.extractKnowledgePoints({
    chapterTitle: chapter.title,
    chunks: chunks.map((chunk) => ({ ...chunk, filename: chunk.filename })),
  })

  const existing = await q<{ name: string }>(
    `SELECT name FROM knowledge_points WHERE chapter_id = $1
     UNION ALL
     SELECT payload->>'name' FROM ai_drafts WHERE chapter_id = $1 AND type = 'knowledge_points' AND status = 'draft'`,
    [chapter.id],
  )
  const existingNames = existing.map((item) => normalizeText(item.name))

  await q(
    `DELETE FROM ai_drafts WHERE chapter_id = $1 AND type = 'knowledge_points' AND status = 'draft'`,
    [chapter.id],
  )

  let inserted = 0
  for (const point of points) {
    const normalized = normalizeText(point.name)
    if (existingNames.some((name) => name === normalized || name.includes(normalized) || normalized.includes(name))) {
      continue
    }
    const refs = point.evidence.map((item) => item.chunk_id)
    await q(
      `INSERT INTO ai_drafts (id, course_id, chapter_id, type, payload, source_refs, status, prompt_version, model, note)
       VALUES ($1, $2, $3, $4, $5, $6, 'draft', $7, $8, $9)`,
      [
        newId(),
        chapter.course_id,
        chapter.id,
        'knowledge_points',
        JSON.stringify(point),
        JSON.stringify(refs),
        'extract-v1',
        provider.id,
        null,
      ],
    )
    inserted += 1
  }

  await logActivity(
    chapter.course_id,
    'ai',
    inserted > 0
      ? `按资料里的强调方式和篇幅，把《${chapter.title}》拆成 ${inserted} 个知识点草稿，分了三档。`
      : `《${chapter.title}》这次没有提取到新的知识点，已保留章节状态。`,
  )
  return { inserted, extracted: points.length }
}

export async function handleGenerateQuestions(payload: QuestionPayload): Promise<unknown> {
  const kp = await q1<{
    id: string
    course_id: string
    chapter_id: string
    name: string
    summary: string
    importance: string
    source_refs: unknown
  }>('SELECT * FROM knowledge_points WHERE id = $1', [payload.kpId])
  if (!kp) throw new Error('知识点不存在')

  if (!payload.force) {
    const existing = await q1<{ count: string }>(
      `SELECT count(*)::text AS count FROM questions WHERE kp_id = $1 AND status != 'rejected'`,
      [kp.id],
    )
    if (existing && Number(existing.count) >= 2) return { skipped: true, created: 0 }
  }

  const evidenceRefs = parseJson<string[]>(kp.source_refs, [])
  const evidenceChunks = evidenceRefs.length
    ? await q<{ id: string; content: string; page_no: number }>(
        `SELECT id, content, page_no FROM chunks WHERE id = ANY($1::text[])`,
        [evidenceRefs],
      )
    : []
  const fallback = await q<{ id: string; content: string; page_no: number }>(
    `SELECT id, content, page_no FROM chunks WHERE chapter_id = $1 ORDER BY page_no, seq LIMIT 2`,
    [kp.chapter_id],
  )
  const refs = evidenceChunks.length ? evidenceChunks : fallback
  if (refs.length === 0) throw new Error('该知识点没有可用的原文片段，无法出题')

  const siblings = await q<{ name: string; summary: string }>(
    'SELECT name, summary FROM knowledge_points WHERE chapter_id = $1 AND id != $2 LIMIT 4',
    [kp.chapter_id, kp.id],
  )

  const preferences = await q<{ kind: string; target_id: string | null }>(
    'SELECT kind, target_id FROM preferences WHERE course_id = $1 AND active = true',
    [kp.course_id],
  )
  const tooEasyTypes = preferences
    .filter((item) => item.kind === '题型过易' && item.target_id)
    .map((item) => item.target_id as '选择' | '填空' | '简答')
  const bunnyQuestions = preferences
    .filter((item) => item.kind === '题目有误' && item.target_id)
    .map((item) => item.target_id as string)

  const provider = getProvider()
  const questions = await provider.generateQuestions({
    kp: {
      id: kp.id,
      name: kp.name,
      summary: kp.summary,
      importance: kp.importance as never,
      evidence: refs.map((chunk) => ({ chunk_id: chunk.id, quote: chunk.content.slice(0, 120) })),
      evidenceText: refs.map((chunk) => chunk.content).join('\n'),
    },
    siblings,
    preferences: {
      tooEasyTypes,
      bunnyQuestions,
      hintIneffective: preferences.some((item) => item.kind === '提示无效'),
    },
  })

  if (questions.length === 0) throw new Error('题目生成失败：没有通过校验的题目')

  for (const question of questions) {
    await q(
      `INSERT INTO questions (id, course_id, chapter_id, kp_id, type, difficulty, stem, options, answer, rubric, source_refs, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'draft')`,
      [
        newId(),
        kp.course_id,
        kp.chapter_id,
        kp.id,
        question.type,
        question.difficulty,
        question.stem,
        question.options ? JSON.stringify(question.options) : null,
        question.answer,
        question.rubric ? JSON.stringify(question.rubric) : null,
        JSON.stringify(question.source_refs),
      ],
    )
  }

  await logActivity(
    kp.course_id,
    'ai',
    `为「${kp.name}」生成了 ${questions.length} 道题（${questions.map((item) => `${item.type}·${item.difficulty}`).join('、')}）。`,
  )
  return { created: questions.length }
}

export async function handleJob(type: string, payload: unknown): Promise<unknown> {
  if (type === 'parse_file') return handleParseFile(payload as ParsePayload)
  if (type === 'extract_kp') return handleExtractKnowledgePoints(payload as ExtractPayload)
  if (type === 'generate_questions') return handleGenerateQuestions(payload as QuestionPayload)
  throw new Error(`未知任务类型：${type}`)
}
