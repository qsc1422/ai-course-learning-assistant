import type { Evidence, Importance, QuestionOption, QuestionType } from '../domain'
import { hashString, keywordsOf, normalizeText, splitSentences, truncate } from './text'
import type { AiChunk, AiProvider, GeneratedQuestion, KpForQuestion, NarrationResult } from './types'

const HEADING = /^(第[一二三四五六七八九十百\d]+[章节讲篇]|[一二三四五六七八九十]+、|\d+[.、]\s|（[一二三四五六七八九十]+）)/
// 定义句判定：必须从分句开头起算，避免把定语从句中间的名词算成术语；
// 单独的「是」也算定义连接词（中文讲义里最常见），但要求术语本身不像残句。
const DEFINE =
  /(?:^|[，。；：、！？\n（(「“《])([\u4e00-\u9fa5A-Za-z][\u4e00-\u9fa5A-Za-z0-9\-]{1,11})(?:是指|指的是|是一种|是一个|定义为|称为|叫做|简称|是)/g
const NOISE_TAIL = /(的|了|地|得|在|和|与|或|把|被|这|那|其|个|是|有)$/
const EMPHASIS = /必背|必考|重点|核心|必须掌握|熟练掌握|关键|掌握/
const LIGHT = /了解|知道|熟悉|背景|延伸|补充/

interface Candidate {
  term: string
  score: number
}

function collectCandidates(chunks: AiChunk[]): Candidate[] {
  const scores = new Map<string, number>()
  const bump = (term: string, value: number) => {
    const clean = term.trim()
    if (clean.length < 2 || clean.length > 16) return
    if (!/[\u4e00-\u9fa5A-Za-z]/.test(clean)) return
    if (NOISE_TAIL.test(clean)) return
    scores.set(clean, (scores.get(clean) ?? 0) + value)
  }

  for (const chunk of chunks) {
    const lines = chunk.content.split(/\n+/).map((line) => line.trim())
    for (const line of lines) {
      if (line.length <= 32 && HEADING.test(line)) bump(line.replace(HEADING, '').trim(), 4)
    }
    for (const match of chunk.content.matchAll(DEFINE)) bump(match[1], 4)
    for (const match of chunk.content.matchAll(/[「“《]([\u4e00-\u9fa5A-Za-z0-9\-]{2,12})[」”》]/g)) {
      bump(match[1], 3)
    }
    const segments = chunk.content.split(/[，。；：、\n]/)
    for (const segment of segments) {
      const clean = segment.trim()
      if (clean.length >= 3 && clean.length <= 10 && !/^\d+$/.test(clean)) {
        bump(clean, 0.5)
      }
    }
  }

  return [...scores.entries()]
    .map(([term, score]) => ({ term, score }))
    .sort((a, b) => b.score - a.score || b.term.length - a.term.length)
}

function pickCandidates(chunks: AiChunk[], max: number): Candidate[] {
  const raw = collectCandidates(chunks)
  const selected: Candidate[] = []
  for (const candidate of raw) {
    if (candidate.score < 2) continue
    if (selected.some((item) => item.term.includes(candidate.term) || candidate.term.includes(item.term))) continue
    selected.push(candidate)
    if (selected.length >= max) break
  }
  return selected
}

function bestEvidence(term: string, chunks: AiChunk[]): { chunk: AiChunk; quote: string } | null {
  let best: { chunk: AiChunk; quote: string; count: number } | null = null
  for (const chunk of chunks) {
    const occurrences = chunk.content.split(term).length - 1
    if (occurrences === 0) continue
    const sentence =
      splitSentences(chunk.content).find((item) => item.includes(term)) ??
      truncate(chunk.content, 120)
    if (!best || occurrences > best.count) best = { chunk, quote: truncate(sentence, 140), count: occurrences }
  }
  return best ? { chunk: best.chunk, quote: best.quote } : null
}

function importanceOf(term: string, quote: string, corpus: string): Importance {
  let score = 0
  if (HEADING.test(corpus.split('\n').find((line) => line.includes(term)) ?? '')) score += 1
  if (EMPHASIS.test(quote)) score += 2
  else if (EMPHASIS.test(corpus)) score += 0.5
  if (LIGHT.test(quote)) score -= 1
  if (corpus.split(term).length - 1 >= 3) score += 1
  if (score >= 2) return '必背'
  if (score >= 0) return '理解'
  return '了解'
}

function summaryOf(term: string, quote: string): string {
  const definition = splitSentences(quote).find((sentence) =>
    new RegExp(`${term}(是指|指的是|是一种|是一个|称为|叫做|定义为)`).test(sentence),
  )
  return truncate(definition ?? quote, 90)
}

function seededOrder<T>(items: T[], seed: string): T[] {
  return items
    .map((item, index) => ({ item, key: hashString(`${seed}-${index}-${String(item)}`) }))
    .sort((a, b) => a.key - b.key)
    .map((entry) => entry.item)
}

function buildSelection(kp: KpForQuestion, siblings: { name: string; summary: string }[], difficulty: GeneratedQuestion['difficulty']): GeneratedQuestion {
  const correct = truncate(kp.summary, 80)
  const distractors: string[] = []
  for (const sibling of siblings) {
    const text = truncate(sibling.summary.replace(kp.name, sibling.name), 80)
    if (text && text !== correct && !distractors.includes(text)) distractors.push(text)
    if (distractors.length >= 3) break
  }
  if (distractors.length < 3) {
    distractors.push(`「${kp.name}」不属于本章的考查范围。`)
  }
  if (distractors.length < 3) {
    distractors.push(`「${kp.name}」只在第一章出现，与其他章节没有关系。`)
  }
  if (distractors.length < 3) {
    distractors.push(`「${kp.name}」只要求了解，不涉及任何具体方法。`)
  }

  const options = seededOrder(
    [correct, ...distractors.slice(0, 3)].map((text, index) => ({
      key: 'ABCD'[index],
      text,
    })) as QuestionOption[],
    kp.id,
  )
  const correctIndex = options.findIndex((option) => option.text === correct)
  const answer = options[correctIndex]?.key ?? 'A'
  return {
    type: '选择',
    difficulty,
    stem: `关于「${kp.name}」，下列说法最准确的是：`,
    options,
    answer,
    rubric: null,
    source_refs: kp.evidence.map((item) => item.chunk_id),
  }
}

function buildFill(kp: KpForQuestion): GeneratedQuestion {
  const quote = kp.evidence[0]?.quote ?? kp.summary
  const target = quote.includes(kp.name)
    ? quote
    : quote.includes(kp.name.slice(0, 4))
      ? quote
      : truncate(kp.summary, 90)
  const term = target.includes(kp.name) ? kp.name : kp.name.slice(0, Math.min(4, kp.name.length))
  const stemText = target.replace(term, '____')
  return {
    type: '填空',
    difficulty: '变式',
    stem: `填空题：${stemText}${stemText.endsWith('。') ? '' : '。'}`,
    options: null,
    answer: term,
    rubric: null,
    source_refs: kp.evidence.map((item) => item.chunk_id),
  }
}

function buildShort(kp: KpForQuestion): GeneratedQuestion {
  const rubric = keywordsOf(`${kp.name}。${kp.summary}`, 4).filter((word) => word !== kp.name)
  const points = rubric.length > 0 ? rubric : [kp.name]
  return {
    type: '简答',
    difficulty: '综合',
    stem: `请用自己的话说明「${kp.name}」，并指出它的适用条件或作用。`,
    options: null,
    answer: kp.summary,
    rubric: points,
    source_refs: kp.evidence.map((item) => item.chunk_id),
  }
}

export function createLocalProvider(): AiProvider {
  return {
    id: 'local-rules',
    label: '本地规则引擎',
    kind: 'local',

    async extractKnowledgePoints({ chapterTitle, chunks }) {
      if (chunks.length === 0) return []
      const candidates = pickCandidates(chunks, 10)
      const points = [] as {
        name: string
        summary: string
        importance: Importance
        evidence: Evidence[]
        confidence: number
      }[]

      for (const candidate of candidates) {
        const found = bestEvidence(candidate.term, chunks)
        if (!found) continue
        const corpus = chunks.map((chunk) => chunk.content).join('\n')
        const name = candidate.term.slice(0, 24)
        if (points.some((point) => point.name.includes(name) || name.includes(point.name))) continue
        points.push({
          name,
          summary: summaryOf(name, found.quote) || truncate(found.chunk.content, 80),
          importance: importanceOf(name, found.quote, corpus),
          evidence: [{ chunk_id: found.chunk.id, quote: found.quote }],
          confidence: Math.min(0.86, 0.45 + candidate.score / 12),
        })
        if (points.length >= 8) break
      }

      if (points.length === 0) {
        const fallback = chunks[0]
        const first = splitSentences(fallback.content)[0]
        if (first) {
          points.push({
            name: truncate(chapterTitle.replace(/^第.*?[章节]\s*/, ''), 20) || '本章要点',
            summary: truncate(first, 80),
            importance: '理解',
            evidence: [{ chunk_id: fallback.id, quote: truncate(first, 120) }],
            confidence: 0.4,
          })
        }
      }
      return points
    },

    async generateQuestions({ kp, siblings, preferences }) {
      const typeTooEasy = (type: QuestionType) => preferences.tooEasyTypes.includes(type)
      const questions: GeneratedQuestion[] = [
        buildSelection(kp, siblings, typeTooEasy('选择') ? '变式' : '基础'),
        buildFill(kp),
        buildShort(kp),
      ]
      return questions.filter((question) => {
        if (question.type === '选择') {
          const texts = question.options?.map((option) => normalizeText(option.text)) ?? []
          if (new Set(texts).size !== texts.length) return false
        }
        return question.stem.length > 4 && question.source_refs.length > 0
      })
    },

    async hint({ level, kp, wrongAnswer, previousHints }) {
      const quote = truncate(kp.evidence[0]?.quote ?? kp.summary, 110)
      const keyword = keywordsOf(kp.summary, 1)[0] ?? kp.name
      if (level === 1) {
        return `先回到资料原文：${quote} 先只看这句话在解释什么，不要急着套公式。`
      }
      if (level === 2) {
        const wrong = wrongAnswer ? `你之前写的「${truncate(wrongAnswer, 24)}」` : '你之前的判断'
        return `把题目拆成两步：先确认「${kp.name}」的定义或适用条件，再检查${wrong}与原文的差别。${previousHints.length ? '上一级提示里的原文是关键。' : ''}`
      }
      return `接近答案：${truncate(kp.summary.replace(kp.name, '它'), 80)} 核心落在「${keyword}」上，按这个方向再答一次。`
    },

    async evaluateNarration({ kp, text, chunks }) {
      if (normalizeText(text).length < 20) {
        return { needsMore: true, covered: [], missing: [], wrong: [], followups: [] }
      }
      const targets = keywordsOf(`${kp.name}。${kp.summary}`, 5)
      const normalized = normalizeText(text)
      const covered = targets.filter((word) => normalized.includes(normalizeText(word)))
      const missing = targets.filter((word) => !covered.includes(word)).slice(0, 3)
      const followups = missing.slice(0, 2).map(
        (word) => `你的复述里没有提到「${word}」。它在这个概念里起什么作用？结合资料说明一下。`,
      )
      const wrong: NarrationResult['wrong'] = []
      if (missing.length === 0 && chunks[0]) {
        const quote = truncate(chunks[0].content, 60)
        if (normalized.length < 40 && quote.length > 0) {
          wrong.push({
            claim: truncate(text, 40),
            correction: `复述过短，资料中的关键表述是：${quote}`,
            source_refs: [chunks[0].id],
          })
        }
      }
      return {
        covered,
        missing,
        wrong,
        followups,
      }
    },
  }
}
