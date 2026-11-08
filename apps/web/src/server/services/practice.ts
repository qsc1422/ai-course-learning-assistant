import { newId, today } from '../ids'
import { q, q1, parseJson } from '../db'
import type {
  Attempt,
  Chapter,
  Course,
  KnowledgePoint,
  Narration,
  Question,
  QuestionOption,
} from '../domain'
import { kpScore, type KpMasteryInput } from '../rules/mastery'
import { getProvider } from '../ai'
import { normalizeText } from '../ai/text'
import { logActivity } from '../activity'
import { notExamChapterIds } from './knowledge'
import { enqueue } from '../jobs/queue'

export interface PracticeQuestionView {
  id: string
  type: string
  difficulty: string
  stem: string
  options: QuestionOption[] | null
  sourceRefs: string[]
  hintLevels: number
  hints: { level: number; text: string }[]
  solutionViewed: boolean
  lastResult: string | null
}

export interface PracticeView {
  course: Course
  chapter: Chapter
  kp: KnowledgePoint
  questions: PracticeQuestionView[]
  current: PracticeQuestionView | null
  answeredCount: number
  total: number
  done: boolean
  empty: boolean
}

async function fetchKpsWithScores(courseId: string): Promise<
  { kp: KnowledgePoint; chapter: Chapter; score: number; band: string }[]
> {
  const off = await notExamChapterIds(courseId)
  const kps = await q<KnowledgePoint & { chapter_title: string; chapter_status: string }>(
    `SELECT k.*, ch.title AS chapter_title, ch.status AS chapter_status
     FROM knowledge_points k JOIN chapters ch ON ch.id = k.chapter_id
     WHERE k.course_id = $1 ORDER BY k.created_at`,
    [courseId],
  )
  const active = kps.filter((kp) => !off.has(kp.chapter_id))
  if (active.length === 0) return []

  const ids = active.map((kp) => kp.id)
  const attempts = await q<Attempt>('SELECT * FROM attempts WHERE kp_id = ANY($1::text[])', [ids])
  const narrations = await q<Narration>(
    'SELECT * FROM narrations WHERE kp_id = ANY($1::text[]) ORDER BY created_at DESC',
    [ids],
  )
  const mistakes = await q<{ kp_id: string; status: string }>(
    'SELECT kp_id, status FROM mistakes WHERE course_id = $1',
    [courseId],
  )

  return active.map((kp) => {
    const kpAttempts = attempts.filter((attempt) => attempt.kp_id === kp.id)
    const narration = narrations.find((item) => item.kp_id === kp.id) ?? null
    const openMistake = mistakes.some((item) => item.kp_id === kp.id && item.status === '未通过')
    const input: KpMasteryInput = {
      id: kp.id,
      name: kp.name,
      importance: kp.importance,
      attempts: kpAttempts.map((attempt) => ({
        independence: attempt.independence,
        result: attempt.result,
      })),
      narration: narration ? { status: narration.status, disagreed: narration.disagreed } : null,
      openMistake,
    }
    const score = kpScore(input)
    return {
      kp: { ...kp, source_refs: parseJson<string[]>(kp.source_refs, []) },
      chapter: {
        id: kp.chapter_id,
        course_id: courseId,
        title: kp.chapter_title,
        seq: 0,
        status: kp.chapter_status as Chapter['status'],
      },
      score,
      band: score >= 0.75 ? '稳固' : score >= 0.45 ? '一般' : '薄弱',
    }
  })
}

export async function pickKp(
  courseId: string,
  kpId?: string,
  chapterId?: string,
): Promise<{ course: Course; chapter: Chapter; kp: KnowledgePoint; score: number } | null> {
  const course = await q1<Course>('SELECT * FROM courses WHERE id = $1', [courseId])
  if (!course) return null
  const list = await fetchKpsWithScores(courseId)
  if (list.length === 0) return null

  if (kpId) {
    const found = list.find((item) => item.kp.id === kpId)
    if (found) return { course, chapter: found.chapter, kp: found.kp, score: found.score }
  }
  if (chapterId) {
    const inChapter = list.filter((item) => item.chapter.id === chapterId)
    if (inChapter.length > 0) {
      const weakest = inChapter.sort((a, b) => a.score - b.score)[0]
      return { course, chapter: weakest.chapter, kp: weakest.kp, score: weakest.score }
    }
  }
  const weakest = list.sort((a, b) => a.score - b.score)[0]
  return { course, chapter: weakest.chapter, kp: weakest.kp, score: weakest.score }
}

export async function getPracticeView(
  courseId: string,
  kpId?: string,
  chapterId?: string,
): Promise<PracticeView | null> {
  const picked = await pickKp(courseId, kpId, chapterId)
  if (!picked) return null
  const { course, chapter, kp } = picked

  const questions = await q<Question>(
    `SELECT * FROM questions WHERE kp_id = $1 AND status != 'rejected' ORDER BY created_at, id`,
    [kp.id],
  )
  const attempts = await q<Attempt>('SELECT * FROM attempts WHERE kp_id = $1 ORDER BY created_at', [kp.id])
  const hints = await q<{ question_id: string; level: number; text: string }>(
    'SELECT question_id, level, text FROM hint_events WHERE question_id = ANY($1::text[]) ORDER BY level',
    [questions.map((question) => question.id).length ? questions.map((question) => question.id) : ['__none__']],
  )
  const solutions = await q<{ question_id: string }>(
    'SELECT question_id FROM solution_events WHERE question_id = ANY($1::text[])',
    [questions.map((question) => question.id).length ? questions.map((question) => question.id) : ['__none__']],
  )

  const views: PracticeQuestionView[] = questions.map((question) => {
    const questionAttempts = attempts.filter((attempt) => attempt.question_id === question.id)
    const questionHints = hints.filter((hint) => hint.question_id === question.id)
    const solutionViewed = solutions.some((item) => item.question_id === question.id)
    const last = questionAttempts[questionAttempts.length - 1]
    return {
      id: question.id,
      type: question.type,
      difficulty: question.difficulty,
      stem: question.stem,
      options: question.options ? parseJson<QuestionOption[]>(question.options, []) : null,
      sourceRefs: parseJson<string[]>(question.source_refs, []),
      hintLevels: Math.max(0, ...questionHints.map((hint) => hint.level)),
      hints: questionHints.map((hint) => ({ level: hint.level, text: hint.text })),
      solutionViewed,
      lastResult: last?.result ?? null,
    }
  })

  const answered = views.filter(
    (view) => view.solutionViewed || attempts.some((attempt) => attempt.question_id === view.id && attempt.result === 'correct'),
  )
  const current = views.find((view) => !answered.some((item) => item.id === view.id)) ?? null

  return {
    course,
    chapter,
    kp,
    questions: views,
    current,
    answeredCount: answered.length,
    total: views.length,
    done: views.length > 0 && current === null,
    empty: views.length === 0,
  }
}

export async function requestQuestions(kpId: string, force = false): Promise<string> {
  return enqueue('generate_questions', { kpId, force }, force ? null : `gen:${kpId}:v1`)
}

function gradeQuestion(question: Question, answer: string): 'correct' | 'partial' | 'wrong' {
  const normalized = normalizeText(answer)
  if (!normalized) return 'wrong'
  if (question.type === '选择') {
    return normalizeText(question.answer) === normalized ? 'correct' : 'wrong'
  }
  if (question.type === '填空') {
    const expected = normalizeText(question.answer)
    return expected.length >= 2 && (normalized === expected || normalized.includes(expected)) ? 'correct' : 'wrong'
  }
  const rubric = parseJson<string[]>(question.rubric, []).map((item) => normalizeText(item)).filter(Boolean)
  if (rubric.length === 0) {
    return normalizeText(question.answer).includes(normalized) ? 'correct' : 'wrong'
  }
  const matched = rubric.filter((item) => normalized.includes(item)).length
  const ratio = matched / rubric.length
  if (ratio >= 0.6) return 'correct'
  if (ratio >= 0.25) return 'partial'
  return 'wrong'
}

async function upsertMistake(
  courseId: string,
  kpId: string,
  questionId: string,
  passed: boolean,
): Promise<void> {
  const existing = await q1<{ id: string; wrong_count: number }>(
    'SELECT id, wrong_count FROM mistakes WHERE kp_id = $1',
    [kpId],
  )
  if (passed) {
    if (!existing) return
    await q(`UPDATE mistakes SET status = '已通过', last_attempt_at = now() WHERE id = $1`, [existing.id])
    return
  }
  if (existing) {
    await q(
      `UPDATE mistakes SET wrong_count = wrong_count + 1, status = '未通过', question_id = $2, last_attempt_at = now() WHERE id = $1`,
      [existing.id, questionId],
    )
    return
  }
  await q(
    `INSERT INTO mistakes (id, course_id, kp_id, question_id, wrong_count, status, last_attempt_at)
     VALUES ($1, $2, $3, $4, 1, '未通过', now())`,
    [newId(), courseId, kpId, questionId],
  )
}

async function markTaskDone(courseId: string, kpId: string): Promise<void> {
  await q('UPDATE daily_tasks SET done = true WHERE course_id = $1 AND kp_id = $2 AND task_date = $3', [
    courseId,
    kpId,
    today(),
  ])
}

export async function submitAttempt(
  questionId: string,
  answer: string,
  durationMs: number,
): Promise<{
  result: 'correct' | 'partial' | 'wrong'
  independence: string
  correctAnswer: string | null
  explanation: string | null
}> {
  const question = await q1<Question>('SELECT * FROM questions WHERE id = $1', [questionId])
  if (!question) throw new Error('题目不存在')
  if (question.status === 'rejected') throw new Error('这道题已被驳回，不能作答')

  const kp = await q1<KnowledgePoint>('SELECT * FROM knowledge_points WHERE id = $1', [question.kp_id])
  if (!kp) throw new Error('知识点不存在')

  const solution = await q1('SELECT 1 FROM solution_events WHERE question_id = $1 LIMIT 1', [questionId])
  if (solution) throw new Error('本题已查看完整解答，不能再提交新的答案')
  if (!answer.trim()) throw new Error('先写一个答案再提交')

  const hints = await q('SELECT level FROM hint_events WHERE question_id = $1', [questionId])
  const hintLevels = Math.max(0, ...hints.map((item) => Number((item as { level: number }).level)))

  const result = gradeQuestion(question, answer)
  const independence =
    result === 'correct' ? (hintLevels > 0 ? '提示后答对' : '独立答对') : '未答对'

  await q(
    `INSERT INTO attempts (id, question_id, kp_id, answer, result, independence, hint_levels, solution_shown, duration_ms)
     VALUES ($1, $2, $3, $4, $5, $6, $7, false, $8)`,
    [newId(), questionId, question.kp_id, answer, result, independence, hintLevels, Math.max(0, durationMs)],
  )

  if (result === 'correct') {
    await upsertMistake(question.course_id, question.kp_id, questionId, true)
    await logActivity(question.course_id, 'me', `答对了「${kp.name}」的题目。`)
  } else {
    await upsertMistake(question.course_id, question.kp_id, questionId, false)
  }

  await markTaskDone(question.course_id, question.kp_id)

  return {
    result,
    independence,
    correctAnswer: result === 'correct' ? question.answer : null,
    explanation: result === 'correct' ? kp.summary : null,
  }
}

export async function requestHint(
  questionId: string,
  level: 1 | 2 | 3,
  wrongAnswer: string,
): Promise<{ level: number; text: string; degraded: boolean; canSolution: boolean }> {
  const question = await q1<Question>('SELECT * FROM questions WHERE id = $1', [questionId])
  if (!question) throw new Error('题目不存在')
  const kp = await q1<KnowledgePoint>('SELECT * FROM knowledge_points WHERE id = $1', [question.kp_id])
  if (!kp) throw new Error('知识点不存在')

  const hints = await q<{ level: number; text: string }>(
    'SELECT level, text FROM hint_events WHERE question_id = $1 ORDER BY level',
    [questionId],
  )
  const maxLevel = Math.max(0, ...hints.map((hint) => hint.level))
  if (level > maxLevel + 1) throw new Error('请按顺序获取提示，先看上一级')
  const existing = hints.find((hint) => hint.level === level)
  if (existing) {
    return { level, text: existing.text, degraded: false, canSolution: maxLevel >= 2 }
  }

  const refs = parseJson<string[]>(question.source_refs, [])
  const chunks = refs.length
    ? await q<{ id: string; content: string; page_no: number }>(
        'SELECT id, content, page_no FROM chunks WHERE id = ANY($1::text[])',
        [refs],
      )
    : await q<{ id: string; content: string; page_no: number }>(
        'SELECT id, content, page_no FROM chunks WHERE chapter_id = $1 ORDER BY page_no, seq LIMIT 4',
        [question.chapter_id],
      )

  const provider = getProvider()
  let text = ''
  let degraded = false
  try {
    text = await provider.hint({
      level,
      kp: {
        id: kp.id,
        name: kp.name,
        summary: kp.summary,
        importance: kp.importance,
        evidence: chunks.map((chunk) => ({ chunk_id: chunk.id, quote: chunk.content.slice(0, 140) })),
        evidenceText: chunks.map((chunk) => chunk.content).join('\n'),
      },
      wrongAnswer,
      previousHints: hints.map((hint) => hint.text),
    })
  } catch {
    text = `提示生成失败，已降级为原文片段：${chunks[0]?.content.slice(0, 150) ?? kp.summary}`
    degraded = true
  }

  await q('INSERT INTO hint_events (id, question_id, level, text) VALUES ($1, $2, $3, $4)', [
    newId(),
    questionId,
    level,
    text,
  ])
  const newMax = Math.max(maxLevel, level)
  return { level, text, degraded, canSolution: newMax >= 2 }
}

export async function viewSolution(questionId: string): Promise<{
  answer: string
  summary: string
  quote: string
  page: number
  chunkId: string | null
}> {
  const question = await q1<Question>('SELECT * FROM questions WHERE id = $1', [questionId])
  if (!question) throw new Error('题目不存在')
  const kp = await q1<KnowledgePoint>('SELECT * FROM knowledge_points WHERE id = $1', [question.kp_id])
  if (!kp) throw new Error('知识点不存在')

  const hints = await q('SELECT level FROM hint_events WHERE question_id = $1', [questionId])
  const maxLevel = Math.max(0, ...(hints as { level: number }[]).map((hint) => hint.level))
  if (maxLevel < 2) throw new Error('至少使用两级提示且仍未答对，才能查看完整解答')

  const existing = await q1('SELECT 1 FROM solution_events WHERE question_id = $1 LIMIT 1', [questionId])
  if (existing) throw new Error('本题已查看过完整解答')

  await q('INSERT INTO solution_events (id, question_id) VALUES ($1, $2)', [newId(), questionId])
  await q(
    `INSERT INTO attempts (id, question_id, kp_id, answer, result, independence, hint_levels, solution_shown, duration_ms)
     VALUES ($1, $2, $3, '', 'wrong', '依赖提示通过', $4, true, 0)`,
    [newId(), questionId, question.kp_id, maxLevel],
  )
  await upsertMistake(question.course_id, question.kp_id, questionId, false)
  await markTaskDone(question.course_id, question.kp_id)

  const refs = parseJson<string[]>(question.source_refs, [])
  const chunks = refs.length
    ? await q<{ id: string; content: string; page_no: number }>(
        'SELECT id, content, page_no FROM chunks WHERE id = ANY($1::text[]) LIMIT 1',
        [refs],
      )
    : await q<{ id: string; content: string; page_no: number }>(
        'SELECT id, content, page_no FROM chunks WHERE chapter_id = $1 ORDER BY page_no, seq LIMIT 1',
        [question.chapter_id],
      )

  await logActivity(question.course_id, 'me', `「${kp.name}」这道题用了三级提示，记为依赖提示通过，明天会再出现。`)

  return {
    answer: question.answer,
    summary: kp.summary,
    quote: chunks[0]?.content.slice(0, 160) ?? kp.summary,
    page: chunks[0]?.page_no ?? 1,
    chunkId: chunks[0]?.id ?? null,
  }
}

export async function submitNarration(
  kpId: string,
  text: string,
): Promise<{
  needsMore: boolean
  narrationId: string | null
  status: string | null
  covered: string[]
  missing: string[]
  wrong: { claim: string; correction: string; source_refs: string[] }[]
  followups: string[]
}> {
  const kp = await q1<KnowledgePoint>('SELECT * FROM knowledge_points WHERE id = $1', [kpId])
  if (!kp) throw new Error('知识点不存在')
  if (text.trim().length < 10) throw new Error('先写下你的复述，至少 10 个字')

  const refs = parseJson<string[]>(kp.source_refs, [])
  const chunks = refs.length
    ? await q<{ id: string; content: string; page_no: number }>(
        'SELECT id, content, page_no FROM chunks WHERE id = ANY($1::text[])',
        [refs],
      )
    : await q<{ id: string; content: string; page_no: number }>(
        'SELECT id, content, page_no FROM chunks WHERE chapter_id = $1 ORDER BY page_no, seq LIMIT 4',
        [kp.chapter_id],
      )

  const provider = getProvider()
  const evidence = chunks.slice(0, 4).map((chunk) => ({
    chunk_id: chunk.id,
    quote: chunk.content.slice(0, 120),
  }))
  const evaluation = await provider.evaluateNarration({
    kp: {
      ...kp,
      evidence,
      evidenceText: chunks.map((chunk) => chunk.content).join('\n').slice(0, 4000),
    },
    text,
    chunks,
  })
  if (evaluation.needsMore) {
    return {
      needsMore: true,
      narrationId: null,
      status: null,
      covered: [],
      missing: [],
      wrong: [],
      followups: [],
    }
  }

  const status = evaluation.missing.length === 0 && evaluation.wrong.length === 0 ? '已讲清' : '有缺口'
  const id = newId()
  await q(
    `INSERT INTO narrations (id, kp_id, text, status, covered, missing, wrong, followups)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      id,
      kpId,
      text,
      status,
      JSON.stringify(evaluation.covered),
      JSON.stringify(evaluation.missing),
      JSON.stringify(evaluation.wrong),
      JSON.stringify(evaluation.followups),
    ],
  )
  await markTaskDone(kp.course_id, kpId)
  await logActivity(
    kp.course_id,
    'me',
    status === '已讲清'
      ? `用自己的话讲清了「${kp.name}」。`
      : `复述了「${kp.name}」，还有 ${evaluation.missing.length} 个缺口待补。`,
  )

  return {
    needsMore: false,
    narrationId: id,
    status,
    covered: evaluation.covered,
    missing: evaluation.missing,
    wrong: evaluation.wrong,
    followups: evaluation.followups,
  }
}

export async function disagreeNarration(narrationId: string): Promise<void> {
  const narration = await q1<Narration>('SELECT * FROM narrations WHERE id = $1', [narrationId])
  if (!narration) throw new Error('复述记录不存在')
  await q('UPDATE narrations SET disagreed = true WHERE id = $1', [narrationId])
  const kp = await q1<KnowledgePoint>('SELECT * FROM knowledge_points WHERE id = $1', [narration.kp_id])
  if (kp) {
    await q(
      `INSERT INTO preferences (id, course_id, kind, target_id, note, active)
       VALUES ($1, $2, '判断不认同', $3, '学生认为 AI 判断不准确，这条复述不计入掌握度', true)`,
      [newId(), kp.course_id, narrationId],
    )
    await logActivity(kp.course_id, 'me', `不认同 AI 对「${kp.name}」的复述判断，已排除该条记录。`)
  }
}

export async function feedbackQuestion(
  questionId: string,
  kind: 'too-easy' | 'reject',
): Promise<void> {
  const question = await q1<Question>('SELECT * FROM questions WHERE id = $1', [questionId])
  if (!question) throw new Error('题目不存在')

  if (kind === 'too-easy') {
    await q(
      `INSERT INTO preferences (id, course_id, kind, target_id, note, active)
       VALUES ($1, $2, '题型过易', $3, '该题型对当前学生过易', true)`,
      [newId(), question.course_id, question.type],
    )
    await logActivity(question.course_id, 'me', `标记「${question.type}」题型过易，后续出题会提高难度。`)
    return
  }

  await q(`UPDATE questions SET status = 'rejected' WHERE id = $1`, [questionId])
  await q(
    `INSERT INTO preferences (id, course_id, kind, target_id, note, active)
     VALUES ($1, $2, '题目有误', $3, '学生驳回：题干或答案不准确', true)`,
    [newId(), question.course_id, questionId],
  )
  await logActivity(question.course_id, 'me', '驳回了一道题目，后续不会再出现。')
}

export async function markTaskDonePublic(courseId: string, kpId: string): Promise<void> {
  await markTaskDone(courseId, kpId)
}
